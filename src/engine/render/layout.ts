// Tab layout: measure widths, line breaking, and vertical bands per system.
import { dynamicName, type Beat, type MeasureHeader, type Note, type Song, type Track } from '../model';

export const TAB_GAP = 15; // distance between tab string lines
export const DRUM_GAP = 9; // distance between drum staff lines
export const SIDE_PAD = 24;

export type Lane = 'section' | 'instrument' | 'tempo' | 'ending' | 'text' | 'chord' | 'letRing' | 'palmMute' | 'harmonic' | 'vibrato' | 'bend' | 'drumStems' | 'artic';

const LANE_HEIGHT: Record<Lane, number> = {
  section: 26,
  instrument: 22,
  tempo: 20,
  ending: 18,
  text: 16,
  chord: 16,
  letRing: 15,
  palmMute: 15,
  harmonic: 15,
  vibrato: 13,
  bend: 30,
  drumStems: 30,
  artic: 13,
};

const LANE_ORDER: Lane[] = ['section', 'instrument', 'tempo', 'ending', 'text', 'chord', 'letRing', 'palmMute', 'harmonic', 'vibrato', 'bend', 'drumStems', 'artic'];

export interface BeatLayout {
  beat: Beat;
  voice: number;
  x: number; // relative to the measure
  width: number; // space until the next slot
}

export interface MeasureLayout {
  index: number;
  x: number; // relative to the system
  width: number;
  contentX: number; // where beat positions start, relative to the measure
  showTime: boolean;
  beats: BeatLayout[];
  slots: { tick: number; x: number }[]; // rhythmic grid used by the cursor
}

export interface SystemLayout {
  index: number;
  y: number; // top of the system in sheet coordinates
  height: number;
  lanes: Partial<Record<Lane, number>>; // lane top, relative to the system
  staffTop: number;
  staffBottom: number;
  rhythmTop: number;
  dynamicsY: number | null; // baseline for dynamics and hairpins, if this line has any
  measures: MeasureLayout[];
  width: number;
}

export interface SheetLayout {
  marks: Map<Beat, string>; // dynamic marking shown at a beat (p, mf, f ...)
  width: number;
  height: number;
  systems: SystemLayout[];
  measureToSystem: number[];
  drums: boolean;
  strings: number;
}

export function fretLabel(note: Note, drums: boolean): string {
  if (drums) return '';
  if (note.dead) return 'x';
  let s = String(note.fret);
  if (note.harmonic === 'natural') s = `<${note.harmonicFret || note.fret}>`;
  else if (note.harmonic) s = `${note.fret}<${note.fret + 12}>`;
  if (note.ghost || note.tieDestination) s = `(${s})`;
  return s;
}

function slotWidth(ticks: number): number {
  return 14 + 30 * Math.pow(Math.max(30, ticks) / 960, 0.6);
}

function naturalMeasure(header: MeasureHeader, track: Track, showTime: boolean, drums: boolean) {
  const measure = track.measures[header.index];
  const starts = new Set<number>([0]);
  for (const voice of measure?.voices ?? []) for (const b of voice.beats) starts.add(b.start);
  const ticks = [...starts].filter((t) => t < header.length).sort((a, b) => a - b);

  const slots = ticks.map((tick, i) => {
    const next = ticks[i + 1] ?? header.length;
    // Long fret labels like "(12)" or "<12>" need room.
    let widest = 1;
    for (const voice of measure?.voices ?? []) {
      for (const b of voice.beats) if (b.start === tick) for (const n of b.notes) widest = Math.max(widest, fretLabel(n, drums).length);
    }
    return { tick, width: Math.max(slotWidth(next - tick), 10 + widest * 8) };
  });

  const lead = 12 + (showTime ? 26 : 0) + (header.repeatOpen ? 10 : 0);
  const tail = 8 + (header.repeatClose ? 8 : 0);
  return { slots, lead, tail, width: lead + tail + slots.reduce((a, s) => a + s.width, 0) };
}

export function layoutSheet(song: Song, track: Track, availableWidth: number): SheetLayout {
  const drums = track.isPercussion;
  const marks = dynamicMarks(track);
  const strings = drums ? 5 : Math.max(1, track.tuning.length);
  const inner = Math.max(320, availableWidth - SIDE_PAD * 2);
  const clefWidth = 30;

  // Natural (unjustified) widths.
  const natural = song.measures.map((h, i) => {
    const prev = song.measures[i - 1];
    const showTime = !prev || prev.numerator !== h.numerator || prev.denominator !== h.denominator;
    return { header: h, showTime, ...naturalMeasure(h, track, showTime, drums) };
  });

  // Greedy line breaking.
  const lines: (typeof natural)[] = [];
  let line: typeof natural = [];
  let used = clefWidth;
  for (const m of natural) {
    if (line.length && used + m.width > inner) {
      lines.push(line);
      line = [];
      used = clefWidth;
    }
    line.push(m);
    used += m.width;
  }
  if (line.length) lines.push(line);

  const systems: SystemLayout[] = [];
  const measureToSystem: number[] = [];
  let y = 0;

  lines.forEach((ms, li) => {
    const total = clefWidth + ms.reduce((a, m) => a + m.width, 0);
    const isLast = li === lines.length - 1;
    // Stretch to the full width, except a short final line.
    const stretch = isLast && total < inner * 0.7 ? 1 : inner / total;

    const measures: MeasureLayout[] = [];
    let x = SIDE_PAD + clefWidth * stretch;
    for (const m of ms) {
      const measure = track.measures[m.header.index];
      const slotX: number[] = [];
      let sx = m.lead;
      const extra = (stretch - 1) * (m.width - m.lead - m.tail);
      const slotTotal = m.slots.reduce((a, s) => a + s.width, 0) || 1;
      for (const s of m.slots) {
        slotX.push(sx);
        sx += s.width + (extra * s.width) / slotTotal;
      }
      const width = sx + m.tail;
      const slots = m.slots.map((s, i) => ({ tick: s.tick, x: slotX[i] }));
      const beats: BeatLayout[] = [];
      (measure?.voices ?? []).forEach((voice, v) => {
        for (const beat of voice.beats) {
          const i = slots.findIndex((s) => s.tick === beat.start);
          const bx = i >= 0 ? slots[i].x : m.lead;
          const next = slots.find((s) => s.tick >= beat.start + beat.duration);
          beats.push({ beat, voice: v, x: bx, width: (next ? next.x : width - m.tail) - bx });
        }
      });
      measures.push({ index: m.header.index, x, width, contentX: m.lead, showTime: m.showTime, beats, slots });
      measureToSystem[m.header.index] = li;
      x += width;
    }

    // Which effect lanes this system needs.
    const need = new Set<Lane>();
    for (const m of ms) {
      const h = m.header;
      if (h.marker) need.add('section');
      if (track.instrumentChanges.some((c) => c.measure === h.index)) need.add('instrument');
      if (h.alternateEndings) need.add('ending');
      if (song.tempoChanges.some((t) => t.measure === h.index) || h.index === 0) need.add('tempo');
      for (const voice of track.measures[h.index]?.voices ?? []) {
        for (const b of voice.beats) {
          if (b.text) need.add('text');
          if (b.chord?.name) need.add('chord');
          if (b.vibrato !== 'none' || b.tremoloBar) need.add('vibrato');
          for (const n of b.notes) {
            if (n.letRing) need.add('letRing');
            if (n.palmMute) need.add('palmMute');
            if (n.harmonic) need.add('harmonic');
            if (n.vibrato !== 'none') need.add('vibrato');
            if (n.bend) need.add('bend');
          }
        }
      }
    }
    if (drums) need.add('drumStems');
    let hasDynamics = false;
    for (const m of ms) {
      for (const b of track.measures[m.header.index]?.voices[0]?.beats ?? []) {
        if (marks.has(b) || b.hairpin) hasDynamics = true;
        if (b.notes.some((n) => n.accent || n.heavyAccent || n.staccato)) need.add('artic');
      }
    }

    const lanes: Partial<Record<Lane, number>> = {};
    let top = 10;
    for (const lane of LANE_ORDER) {
      if (!need.has(lane)) continue;
      lanes[lane] = top;
      top += LANE_HEIGHT[lane];
    }
    // Room for bar numbers between the effect lanes and the staff.
    const staffTop = top + (drums ? 10 : 14);
    const gap = drums ? DRUM_GAP : TAB_GAP;
    const staffBottom = staffTop + (strings - 1) * gap;
    const rhythmTop = staffBottom + 6;
    const baseHeight = drums ? staffBottom + 26 : rhythmTop + 40;
    const dynamicsY = hasDynamics ? baseHeight + 6 : null;
    const height = baseHeight + (hasDynamics ? 22 : 0);

    systems.push({ index: li, y, height, lanes, staffTop, staffBottom, rhythmTop, dynamicsY, measures, width: availableWidth });
    y += height + 18;
  });

  return { width: availableWidth, height: y, systems, measureToSystem, drums, strings, marks };
}

// Position of a score location (measure + tick) on the sheet, for the cursor.
export function cursorPosition(layout: SheetLayout, measure: number, tick: number, length: number) {
  const system = layout.systems[layout.measureToSystem[measure]];
  const m = system?.measures.find((x) => x.index === measure);
  if (!system || !m) return null;
  const slots = m.slots;
  let i = 0;
  while (i + 1 < slots.length && slots[i + 1].tick <= tick) i++;
  const a = slots[i] ?? { tick: 0, x: m.contentX };
  // After the last beat, glide toward the next bar's first beat when it's on the same line,
  // so the tracker crosses bar lines smoothly instead of jumping.
  const next = system.measures.find((x) => x.index === measure + 1);
  const endX = next ? next.x - m.x + (next.slots[0]?.x ?? next.contentX) : m.width - 8;
  const b = slots[i + 1] ?? { tick: length, x: endX };
  const f = b.tick > a.tick ? Math.min(1, Math.max(0, (tick - a.tick) / (b.tick - a.tick))) : 0;
  return { system, measure: m, x: m.x + a.x + (b.x - a.x) * f, slotTick: a.tick, boxX: m.x + a.x, boxWidth: Math.max(14, b.x - a.x) };
}

// Finds the measure and slot under a point (sheet coordinates).
export function hitTest(layout: SheetLayout, x: number, y: number) {
  const system = layout.systems.find((s) => y >= s.y && y < s.y + s.height + 18);
  if (!system) return null;
  const m = system.measures.find((mm) => x >= mm.x && x < mm.x + mm.width) ?? (x < SIDE_PAD + 30 ? system.measures[0] : null);
  if (!m) return null;
  const local = x - m.x;
  let slot = m.slots[0];
  for (const s of m.slots) if (s.x - 6 <= local) slot = s;
  const gap = layout.drums ? DRUM_GAP : TAB_GAP;
  const row = (y - system.y - system.staffTop) / gap;
  return { measure: m.index, tick: slot?.tick ?? 0, row, staffY: y - system.y - system.staffTop };
}

// Where to print dynamics: at the first note, then whenever the level changes.
function dynamicMarks(track: Track): Map<Beat, string> {
  const marks = new Map<Beat, string>();
  let current = '';
  for (const m of track.measures) {
    for (const b of m.voices[0]?.beats ?? []) {
      const played = b.notes.filter((n) => !n.tieDestination && !n.ghost);
      if (!played.length) continue;
      const name = dynamicName(Math.max(...played.map((n) => n.velocity)));
      if (name !== current) marks.set(b, name);
      current = name;
    }
  }
  // A whole song at one default level doesn't need a marking.
  if (marks.size === 1 && [...marks.values()][0] === 'f') marks.clear();
  return marks;
}
