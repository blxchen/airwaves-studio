// Turns the score + play order into a flat, tick-sorted list of note events.
import { notePitch, programAt, type Beat, type Note, type Song, type Track } from '../model';
import type { PlayedMeasure } from '../timing';

export interface PitchTick {
  tick: number;
  cents: number;
}

export interface NoteEvent {
  tick: number; // timeline tick
  end: number; // timeline tick of note-off
  track: number;
  program: number; // instrument in effect for this note
  key: number;
  velocity: number;
  pitch: PitchTick[];
  vibrato: number;
  muted: boolean;
  dead: boolean;
  fadeIn: boolean;
  string: number; // -1 for percussion
}

const HARMONIC_INTERVALS: [number, number][] = [
  [12, 12],
  [24, 24],
  [7, 19],
  [19, 19],
  [5, 24],
  [4, 28],
  [9, 28],
  [16, 28],
  [3.2, 31],
  [3, 31],
  [2.7, 34],
];

function naturalHarmonicOffset(fret: number): number {
  for (const [f, interval] of HARMONIC_INTERVALS) if (Math.abs(fret - f) < 0.15) return interval;
  return 12;
}

// Delays off-beat eighths/sixteenths to a triplet feel.
export function swing(localTick: number, feel: 'none' | 'eighth' | 'sixteenth'): number {
  if (feel === 'none') return localTick;
  const unit = feel === 'eighth' ? 480 : 240;
  const pos = localTick % (unit * 2);
  const base = localTick - pos;
  if (pos === 0) return localTick;
  if (pos === unit) return base + Math.round((unit * 4) / 3);
  return base + (pos < unit ? Math.round((pos * 4) / 3) : Math.round((unit * 4) / 3 + ((pos - unit) * 2) / 3));
}

export function buildEvents(song: Song, order: PlayedMeasure[]): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (const track of song.tracks) events.push(...trackEvents(song, track, order));
  events.sort((a, b) => a.tick - b.tick);
  return events;
}

function velocityOf(note: Note): number {
  let v = note.velocity;
  if (note.ghost) v *= 0.6;
  if (note.accent) v *= 1.15;
  if (note.heavyAccent) v *= 1.25;
  if (note.hammerDestination) v *= 0.75;
  if (note.dead) v *= 0.7;
  return Math.min(127, Math.max(1, v));
}

// Velocity multipliers for beats under a crescendo / decrescendo wedge.
function hairpinFactors(track: Track): Map<Beat, number> {
  const factors = new Map<Beat, number>();
  const voices = Math.max(1, ...track.measures.map((m) => m.voices.length));
  for (let v = 0; v < voices; v++) {
    let run: Beat[] = [];
    const flush = () => {
      run.forEach((b, i) => {
        const pos = run.length > 1 ? i / (run.length - 1) : 1;
        factors.set(b, b.hairpin === 'cresc' ? 0.8 + 0.5 * pos : 1.15 - 0.5 * pos);
      });
      run = [];
    };
    for (const m of track.measures) {
      for (const b of m.voices[v]?.beats ?? []) {
        if (b.hairpin && (!run.length || run[0].hairpin === b.hairpin)) run.push(b);
        else {
          flush();
          if (b.hairpin) run.push(b);
        }
      }
    }
    flush();
  }
  return factors;
}

function trackEvents(song: Song, track: Track, order: PlayedMeasure[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  const hairpins = hairpinFactors(track);
  const drums = track.isPercussion;
  // Most recent event per voice+string, for ties and slides.
  const lastOnString = new Map<string, { ev: NoteEvent; note: Note; beat: Beat }>();

  for (const pm of order) {
    const header = song.measures[pm.measure];
    const measure = track.measures[pm.measure];
    if (!measure) continue;
    measure.voices.forEach((voice, v) => {
      for (const beat of voice.beats) {
        if (beat.rest || !beat.notes.length) continue;
        const startLocal = swing(beat.start, header.tripletFeel);
        const endLocal = swing(beat.start + beat.duration, header.tripletFeel);
        const t = pm.start + startLocal;
        const program = programAt(track, pm.measure, beat.start);
        const dur = Math.max(30, endLocal - startLocal);

        // Strums spread chord notes slightly in time.
        const ordered = [...beat.notes].sort((a, b) => (beat.stroke === 'up' ? a.string - b.string : b.string - a.string));
        const strumStep = beat.stroke !== 'none' ? Math.min(40, dur / (ordered.length * 2)) : 0;

        ordered.forEach((note, k) => {
          const slot = `${v}:${drums ? `d${note.midi}` : note.string}`;
          const prev = lastOnString.get(slot);

          if (note.tieDestination && prev) {
            prev.ev.end = Math.max(prev.ev.end, t + dur);
            if (drums) return;
            if (note.bend) addBend(prev.ev, note.bend, t, dur);
            if (note.vibrato !== 'none') prev.ev.vibrato = note.vibrato === 'wide' ? 45 : 22;
            return;
          }

          const start = t + k * strumStep;
          let key = drums ? (note.midi ?? 38) : notePitch(track, note);
          if (!drums && note.harmonic) {
            if (note.harmonic === 'natural') key = track.tuning[note.string] + track.capo + naturalHarmonicOffset(note.harmonicFret || note.fret);
            else if (note.harmonic === 'pinch') key += 19;
            else key += 12;
          }

          let length = dur;
          if (drums) length = Math.min(dur, 480);
          else if (note.dead) length = Math.min(dur, 70);
          else if (note.staccato) length = dur / 2;
          else if (note.palmMute) length = Math.min(dur, Math.max(120, dur * 0.6));
          else if (note.letRing) length = dur + 3840;
          length *= note.durationPercent || 1;

          const ev: NoteEvent = {
            tick: start,
            end: start + Math.max(20, length),
            track: track.index,
            program,
            key,
            velocity: Math.min(127, velocityOf(note) * (hairpins.get(beat) ?? 1)),
            pitch: [],
            vibrato: note.vibrato === 'wide' || beat.vibrato === 'wide' ? 45 : note.vibrato === 'slight' || beat.vibrato === 'slight' ? 22 : 0,
            muted: note.palmMute,
            dead: note.dead,
            fadeIn: beat.fadeIn,
            string: drums ? -1 : note.string,
          };

          if (note.bend) addBend(ev, note.bend, start, dur);
          if (beat.tremoloBar) addBend(ev, beat.tremoloBar, start, dur);
          if (note.slide) {
            const s = note.slide;
            if (s.inBelow || s.inAbove) {
              const glide = Math.min(dur * 0.4, 240);
              ev.pitch.unshift({ tick: start, cents: s.inBelow ? -300 : 300 });
              ev.pitch.push({ tick: start + glide, cents: 0 });
            }
            if (s.outDown || s.outUp) {
              ev.pitch.push({ tick: start + dur * 0.55, cents: 0 }, { tick: start + dur, cents: s.outDown ? -700 : 700 });
              ev.end = Math.min(ev.end, start + dur);
            }
          }
          // A shift/legato slide from the previous note glides into this one.
          if (prev && prev.note.slide && (prev.note.slide.shift || prev.note.slide.legato) && !drums) {
            const p = prev.ev;
            const from = p.tick + (start - p.tick) * 0.55;
            p.pitch.push({ tick: from, cents: 0 }, { tick: start, cents: (key - p.key) * 100 });
            p.end = Math.min(p.end, start);
            if (prev.note.slide.legato) ev.velocity *= 0.6;
          }

          // Grace notes are squeezed in just before the beat.
          if (note.grace && drums) {
            // Flam: a quieter grace stroke a few milliseconds ahead of the main hit.
            const gLen = Math.min(note.grace.duration, 60);
            out.push({ ...ev, tick: Math.max(0, start - gLen), end: start, key: note.grace.fret || key, velocity: ev.velocity * 0.5, pitch: [] });
          }
          if (note.grace && !drums) {
            const g = note.grace;
            const gLen = Math.min(g.duration, 120);
            const gStart = g.onBeat ? start : Math.max(0, start - gLen);
            out.push({ ...ev, tick: gStart, end: gStart + gLen, key: notePitch(track, { ...note, fret: g.fret }), pitch: [], dead: g.dead, vibrato: 0 });
            if (g.onBeat) ev.tick += gLen;
          }

          // Trills and tremolo picking repeat the note.
          if (note.trill && !drums) {
            const step = Math.max(30, note.trill.duration);
            const other = key + (note.trill.fret - note.fret);
            for (let x = start, i = 0; x < start + dur; x += step, i++) {
              out.push({ ...ev, tick: x, end: Math.min(start + dur, x + step), key: i % 2 ? other : key, pitch: [] });
            }
          } else if (note.tremoloPicking) {
            const step = Math.max(30, note.tremoloPicking);
            for (let x = start; x < start + dur; x += step) {
              out.push({ ...ev, tick: x, end: Math.min(start + dur, x + step), pitch: [] });
            }
          } else {
            out.push(ev);
          }
          lastOnString.set(slot, { ev, note, beat });
        });
      }
    });
  }

  if (!drums) {
    // A new note on a string cuts off the previous note on that string.
    out.sort((a, b) => a.tick - b.tick);
    const ringing = new Map<number, NoteEvent>();
    for (const ev of out) {
      const prev = ringing.get(ev.string);
      if (prev && prev.end > ev.tick) prev.end = Math.max(prev.tick + 10, ev.tick);
      ringing.set(ev.string, ev);
    }
  }
  return out;
}

function addBend(ev: NoteEvent, points: { position: number; value: number }[], start: number, dur: number) {
  for (const p of points) ev.pitch.push({ tick: start + p.position * dur, cents: p.value * 100 });
  ev.pitch.sort((a, b) => a.tick - b.tick);
}
