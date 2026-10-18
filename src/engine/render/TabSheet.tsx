// SVG renderer for tablature and drum notation, driven by the layout engine.
import { memo, type ReactNode } from 'react';
import type { Beat, Note, Song, Track } from '../model';
import { GM_NAMES } from '../../lib/instruments';
import { DRUM_GAP, SIDE_PAD, TAB_GAP, fretLabel, type BeatLayout, type MeasureLayout, type SheetLayout, type SystemLayout } from './layout';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Drum key -> staff step (0 = bottom line, 8 = top line) and notehead style.
const DRUM_POSITIONS: Record<number, [number, 'x' | 'n']> = {
  35: [1, 'n'], 36: [1, 'n'],
  37: [5, 'x'], 38: [5, 'n'], 39: [5, 'x'], 40: [5, 'n'],
  41: [2, 'n'], 43: [3, 'n'], 45: [4, 'n'], 47: [6, 'n'], 48: [6, 'n'], 50: [7, 'n'],
  42: [9, 'x'], 44: [-1, 'x'], 46: [9, 'x'],
  49: [10, 'x'], 57: [10, 'x'], 52: [10, 'x'], 55: [10, 'x'],
  51: [8, 'x'], 59: [8, 'x'], 53: [8, 'x'], 56: [8, 'x'],
};

function drumPos(key: number | null): [number, 'x' | 'n'] {
  return DRUM_POSITIONS[key ?? 38] ?? [5, 'n'];
}

function bendLabel(semitones: number): string {
  const tones = Math.round(semitones * 2) / 4; // to quarter-tone steps, expressed in tones
  if (Math.abs(tones - 1) < 0.01) return 'full';
  if (Math.abs(tones) < 0.01) return '';
  const whole = Math.floor(tones);
  const frac = tones - whole;
  const fracLabel = Math.abs(frac - 0.5) < 0.01 ? '½' : Math.abs(frac - 0.25) < 0.01 ? '¼' : Math.abs(frac - 0.75) < 0.01 ? '¾' : '';
  return `${whole || ''}${fracLabel}` || String(tones);
}

interface Props {
  song: Song;
  track: Track;
  layout: SheetLayout;
  selection: { from: number; to: number } | null;
}

export default memo(function TabSheet({ song, track, layout, selection }: Props) {
  return (
    <>
      {layout.systems.map((system) => (
        <SystemView key={system.index} song={song} track={track} layout={layout} system={system} selection={selection} />
      ))}
    </>
  );
});

const SystemView = memo(function SystemView({
  song,
  track,
  layout,
  system,
  selection,
}: {
  song: Song;
  track: Track;
  layout: SheetLayout;
  system: SystemLayout;
  selection: Props['selection'];
}) {
  const drums = layout.drums;
  const gap = drums ? DRUM_GAP : TAB_GAP;
  const lines = drums ? 5 : layout.strings;
  const first = system.measures[0];
  const last = system.measures[system.measures.length - 1];
  const left = SIDE_PAD;
  const right = last.x + last.width;
  const lineY = (i: number) => system.staffTop + i * gap;
  const els: ReactNode[] = [];

  // Selected bars.
  if (selection) {
    for (const m of system.measures) {
      if (m.index >= selection.from && m.index <= selection.to) {
        els.push(<rect key={`sel${m.index}`} className="sel" x={m.x} y={system.staffTop - 10} width={m.width} height={system.staffBottom - system.staffTop + 20} />);
      }
    }
  }

  // Staff lines.
  for (let i = 0; i < lines; i++) els.push(<line key={`l${i}`} className="ln" x1={left} x2={right} y1={lineY(i)} y2={lineY(i)} />);
  els.push(<line key="lstart" className="bar" x1={left} x2={left} y1={system.staffTop} y2={system.staffBottom} />);

  // Clef.
  if (drums) {
    const mid = (system.staffTop + system.staffBottom) / 2;
    els.push(<rect key="clef1" className="ink" x={left + 9} y={mid - 8} width={3} height={16} />, <rect key="clef2" className="ink" x={left + 15} y={mid - 8} width={3} height={16} />);
  } else {
    const mid = (system.staffTop + system.staffBottom) / 2;
    const step = Math.min(15, (system.staffBottom - system.staffTop) / 3.2);
    ['T', 'A', 'B'].forEach((c, i) =>
      els.push(
        <text key={`clef${c}`} className="clef" x={left + 14} y={mid + (i - 1) * step + 5} textAnchor="middle">
          {c}
        </text>,
      ),
    );
    if (system.index === 0) {
      track.tuning.forEach((p, i) =>
        els.push(
          <text key={`tun${i}`} className="tuning" x={left - 5} y={lineY(i) + 3.5} textAnchor="end">
            {NOTE_NAMES[(p + track.capo) % 12]}
          </text>,
        ),
      );
    }
  }

  for (const m of system.measures) els.push(...measureElements(song, track, layout, system, m));
  els.push(...runEffects(system, track));
  els.push(...hairpins(system, layout));
  els.push(...tieArcs(system, track));

  return (
    <svg className="system" width={system.width} height={system.height} viewBox={`0 0 ${system.width} ${system.height}`} data-system={system.index}>
      {els}
      {first && null}
    </svg>
  );
});

function measureElements(song: Song, track: Track, layout: SheetLayout, system: SystemLayout, m: MeasureLayout): ReactNode[] {
  const drums = layout.drums;
  const header = song.measures[m.index];
  const out: ReactNode[] = [];
  const top = system.staffTop;
  const bottom = system.staffBottom;
  const x0 = m.x;
  const x1 = m.x + m.width;
  const key = `m${m.index}`;

  // Bar number.
  out.push(
    <text key={`${key}n`} className="barnum" x={x0 + 3} y={top - 5}>
      {m.index + 1}
    </text>,
  );

  // Repeat start.
  if (header.repeatOpen) {
    out.push(<rect key={`${key}ro`} className="ink" x={x0} y={top} width={3} height={bottom - top} />);
    out.push(<line key={`${key}ro2`} className="bar" x1={x0 + 6} x2={x0 + 6} y1={top} y2={bottom} />);
    out.push(...repeatDots(`${key}rod`, x0 + 10, top, bottom));
  }

  // End barline.
  const isLast = m.index === song.measures.length - 1;
  if (header.repeatClose) {
    out.push(...repeatDots(`${key}rcd`, x1 - 10, top, bottom));
    out.push(<line key={`${key}rc1`} className="bar" x1={x1 - 6} x2={x1 - 6} y1={top} y2={bottom} />);
    out.push(<rect key={`${key}rc2`} className="ink" x={x1 - 3} y={top} width={3} height={bottom - top} />);
    if (header.repeatClose > 2) {
      out.push(
        <text key={`${key}rcn`} className="fx-text" x={x1 - 2} y={top - 5} textAnchor="end">
          x{header.repeatClose}
        </text>,
      );
    }
  } else if (isLast) {
    out.push(<line key={`${key}e1`} className="bar" x1={x1 - 6} x2={x1 - 6} y1={top} y2={bottom} />);
    out.push(<rect key={`${key}e2`} className="ink" x={x1 - 3} y={top} width={3} height={bottom - top} />);
  } else if (header.doubleBar) {
    out.push(<line key={`${key}d1`} className="bar" x1={x1 - 4} x2={x1 - 4} y1={top} y2={bottom} />);
    out.push(<line key={`${key}d2`} className="bar" x1={x1} x2={x1} y1={top} y2={bottom} />);
  } else {
    out.push(<line key={`${key}b`} className="bar" x1={x1} x2={x1} y1={top} y2={bottom} />);
  }

  // Time signature.
  if (m.showTime) {
    const tx = x0 + (header.repeatOpen ? 24 : 14);
    const mid = (top + bottom) / 2;
    const size = drums ? 17 : Math.min(26, (bottom - top) * 0.42);
    out.push(
      <text key={`${key}ts1`} className="timesig" x={tx} y={mid - 2} fontSize={size} textAnchor="middle">
        {header.numerator}
      </text>,
      <text key={`${key}ts2`} className="timesig" x={tx} y={mid + size * 0.8} fontSize={size} textAnchor="middle">
        {header.denominator}
      </text>,
    );
  }

  // Section marker.
  if (header.marker && system.lanes.section !== undefined) {
    const y = system.lanes.section;
    const w = header.marker.length * 7.2 + 16;
    out.push(
      <g key={`${key}sec`} className="section">
        <rect x={x0} y={y} width={w} height={19} rx={4} />
        <text x={x0 + 8} y={y + 13.5}>
          {header.marker}
        </text>
      </g>,
    );
  }

  // Instrument changes partway through the track.
  if (system.lanes.instrument !== undefined) {
    for (const c of track.instrumentChanges.filter((x) => x.measure === m.index)) {
      const slot = m.slots.find((s) => s.tick >= c.tick) ?? m.slots[0];
      const ix = x0 + (slot?.x ?? m.contentX) - 6;
      const label = `♪ ${GM_NAMES[c.program] ?? 'Program ' + c.program}`;
      out.push(
        <g key={`${key}ins${c.tick}`} className="instr">
          <rect x={ix} y={system.lanes.instrument} width={label.length * 6.4 + 14} height={17} rx={8.5} />
          <text x={ix + 7} y={system.lanes.instrument + 12}>
            {label}
          </text>
        </g>,
      );
    }
  }

  // Alternate endings.
  if (header.alternateEndings && system.lanes.ending !== undefined) {
    const y = system.lanes.ending + 4;
    const nums: number[] = [];
    for (let i = 0; i < 8; i++) if (header.alternateEndings & (1 << i)) nums.push(i + 1);
    out.push(
      <path key={`${key}end`} className="fx-line" d={`M${x0 + 2} ${y + 12} V${y} H${x1 - 6}`} fill="none" />,
      <text key={`${key}endt`} className="fx-text" x={x0 + 6} y={y + 11}>
        {nums.join('., ')}.
      </text>,
    );
  }

  // Tempo markings.
  if (system.lanes.tempo !== undefined) {
    const marks = song.tempoChanges.filter((t) => t.measure === m.index).map((t) => ({ tick: t.tick, bpm: t.bpm }));
    if (m.index === 0 && !marks.some((t) => t.tick === 0)) marks.unshift({ tick: 0, bpm: song.tempo });
    for (const t of marks) {
      const slot = m.slots.find((s) => s.tick >= t.tick) ?? m.slots[0];
      const tx = x0 + (slot?.x ?? m.contentX) - 4;
      const ty = system.lanes.tempo + 14;
      out.push(
        <g key={`${key}tempo${t.tick}`} className="tempo">
          <ellipse cx={tx} cy={ty} rx={3.6} ry={2.7} transform={`rotate(-20 ${tx} ${ty})`} />
          <line x1={tx + 3.2} x2={tx + 3.2} y1={ty} y2={ty - 11} />
          <text x={tx + 8} y={ty + 1}>
            = {Math.round(t.bpm)}
          </text>
        </g>,
      );
    }
  }

  // Beats.
  for (const bl of m.beats) out.push(...beatElements(layout, system, m, bl));
  out.push(...rhythmElements(song, layout, system, m));
  return out;
}

function repeatDots(key: string, x: number, top: number, bottom: number): ReactNode[] {
  const mid = (top + bottom) / 2;
  const off = Math.max(5, (bottom - top) / 6);
  return [<circle key={`${key}1`} className="ink" cx={x} cy={mid - off} r={2} />, <circle key={`${key}2`} className="ink" cx={x} cy={mid + off} r={2} />];
}

function beatElements(layout: SheetLayout, system: SystemLayout, m: MeasureLayout, bl: BeatLayout): ReactNode[] {
  const out: ReactNode[] = [];
  const beat = bl.beat;
  const x = m.x + bl.x;
  const id = `${m.index}:${bl.voice}:${beat.start}`;
  const children: ReactNode[] = [];

  // Articulations above the staff.
  if (system.lanes.artic !== undefined && bl.voice === 0) {
    const ay = system.lanes.artic + 8;
    if (beat.notes.some((n) => n.heavyAccent)) children.push(<path key={`${id}hac`} className="artic" d={`M${x - 4} ${ay + 3} L${x} ${ay - 5} L${x + 4} ${ay + 3}`} />);
    else if (beat.notes.some((n) => n.accent)) children.push(<path key={`${id}ac`} className="artic" d={`M${x - 5} ${ay - 4} L${x + 5} ${ay} L${x - 5} ${ay + 4}`} />);
    if (beat.notes.some((n) => n.staccato)) children.push(<circle key={`${id}st`} className="ink" cx={x} cy={ay + (beat.notes.some((n) => n.accent || n.heavyAccent) ? -9 : 0)} r={1.8} />);
  }
  // Dynamic marking below the rhythm.
  const mark = bl.voice === 0 ? layout.marks.get(beat) : undefined;
  if (mark && system.dynamicsY !== null) {
    children.push(
      <text key={`${id}dyn`} className="dynamic" x={x - 3} y={system.dynamicsY + 13}>
        {mark}
      </text>,
    );
  }

  if (layout.drums) {
    const gap = DRUM_GAP;
    const yOf = (step: number) => system.staffBottom - step * (gap / 2);
    if (beat.rest) {
      if (bl.voice === 0) children.push(restGlyph(`${id}r`, beat, x, (system.staffTop + system.staffBottom) / 2));
    } else {
      let lowest = -Infinity;
      for (const [i, n] of beat.notes.entries()) {
        const [step, head] = drumPos(n.midi);
        const y = yOf(step);
        lowest = Math.max(lowest, y);
        if (step >= 10 || step <= -2) {
          for (let s = step >= 10 ? 10 : -2; step >= 10 ? s <= step : s >= step; s += step >= 10 ? 2 : -2) {
            children.push(<line key={`${id}led${i}${s}`} className="ln" x1={x - 7} x2={x + 7} y1={yOf(s)} y2={yOf(s)} />);
          }
        }
        // Tied hits (still ringing) and ghost hits are shown in parentheses.
        if (n.ghost || n.tieDestination) {
          children.push(
            <text key={`${id}pl${i}`} className="drum-paren" x={x - 7.5} y={y + 4} textAnchor="middle">
              (
            </text>,
            <text key={`${id}pr${i}`} className="drum-paren" x={x + 7.5} y={y + 4} textAnchor="middle">
              )
            </text>,
          );
        }
        if (head === 'x') {
          children.push(<path key={`${id}h${i}`} className="drumx" d={`M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x - 3.5} ${y + 3.5}L${x + 3.5} ${y - 3.5}`} />);
          if (n.midi === 46) children.push(<circle key={`${id}o${i}`} className="drumo" cx={x} cy={y - 8} r={2.5} />);
        } else {
          children.push(<ellipse key={`${id}h${i}`} className="drumhead" cx={x} cy={y} rx={4.3} ry={3.2} transform={`rotate(-20 ${x} ${y})`} />);
        }
      }
      // Stem up to the beam line.
      if (beat.value >= 2) {
        const stemTop = system.staffTop - 22;
        children.push(<line key={`${id}stem`} className="stem" x1={x + 4} x2={x + 4} y1={lowest - 1} y2={stemTop} />);
      }
    }
    out.push(
      <g key={id} className="beat" data-beat={id}>
        {children}
      </g>,
    );
    return out;
  }

  const gap = TAB_GAP;
  if (beat.rest) {
    if (bl.voice === 0) children.push(restGlyph(`${id}r`, beat, x, (system.staffTop + system.staffBottom) / 2));
  }
  for (const [i, n] of beat.notes.entries()) {
    const y = system.staffTop + n.string * gap;
    const label = fretLabel(n, false);
    const w = label.length * 8 + 4;
    children.push(
      <rect key={`${id}bg${i}`} className="fret-bg" x={x - w / 2} y={y - 7.5} width={w} height={15} />,
      <text key={`${id}f${i}`} className={`fret${bl.voice ? ' v2' : ''}${n.tieDestination ? ' tied' : ''}${n.ghost ? ' ghost' : ''}`} x={x} y={y + 5} textAnchor="middle">
        {label}
      </text>,
    );
    if (n.slide && (n.slide.inBelow || n.slide.inAbove)) {
      const dy = n.slide.inBelow ? 1 : -1;
      children.push(<line key={`${id}si${i}`} className="fx-line" x1={x - w / 2 - 9} y1={y + 4 * dy} x2={x - w / 2 - 2} y2={y - 1 * dy} />);
    }
    if (n.slide && (n.slide.outDown || n.slide.outUp)) {
      const dy = n.slide.outDown ? 1 : -1;
      children.push(<line key={`${id}so${i}`} className="fx-line" x1={x + w / 2 + 2} y1={y - 1 * dy} x2={x + w / 2 + 10} y2={y + 4 * dy} />);
    }
    if (n.bend && system.lanes.bend !== undefined) children.push(...bendElements(`${id}b${i}`, n, x + w / 2, y, bl.width, system.lanes.bend));
  }

  // Lane labels that belong to a single beat.
  const lanes = system.lanes;
  if (beat.text && lanes.text !== undefined) {
    children.push(
      <text key={`${id}txt`} className="fx-text" x={x - 4} y={lanes.text + 12}>
        {beat.text}
      </text>,
    );
  }
  if (beat.chord?.name && lanes.chord !== undefined) {
    children.push(
      <text key={`${id}ch`} className="chord" x={x - 4} y={lanes.chord + 12}>
        {beat.chord.name}
      </text>,
    );
  }
  const harmonic = beat.notes.find((n) => n.harmonic)?.harmonic;
  if (harmonic && lanes.harmonic !== undefined) {
    const label = { natural: 'N.H.', artificial: 'A.H.', pinch: 'P.H.', tapped: 'T.H.', semi: 'S.H.', feedback: 'Fb.' }[harmonic];
    children.push(
      <text key={`${id}hm`} className="fx-text" x={x - 6} y={lanes.harmonic + 11}>
        {label}
      </text>,
    );
  }
  const vib = beat.notes.some((n) => n.vibrato !== 'none') || beat.vibrato !== 'none';
  if (vib && lanes.vibrato !== undefined) {
    const wide = beat.notes.some((n) => n.vibrato === 'wide') || beat.vibrato === 'wide';
    children.push(<path key={`${id}vib`} className="vib" d={wavePath(x - 3, lanes.vibrato + 7, Math.max(14, bl.width - 6), wide ? 3 : 2)} />);
  }
  if (beat.tremoloBar && lanes.vibrato !== undefined) {
    children.push(
      <text key={`${id}wb`} className="fx-text" x={x - 4} y={lanes.vibrato + 11}>
        w/bar
      </text>,
    );
  }
  if (beat.notes.some((n) => n.tapped) || beat.slap !== 'none') {
    const t = beat.slap === 'slap' ? 'S' : beat.slap === 'pop' ? 'P' : 'T';
    children.push(
      <text key={`${id}tap`} className="fx-text" x={x} y={system.staffTop - 5} textAnchor="middle">
        {t}
      </text>,
    );
  }

  out.push(
    <g key={id} className="beat" data-beat={id}>
      {children}
    </g>,
  );
  return out;
}

function bendElements(key: string, n: Note, x: number, y: number, width: number, laneTop: number): ReactNode[] {
  const points = n.bend!;
  const peak = Math.max(...points.map((p) => p.value));
  const lastValue = points[points.length - 1].value;
  const startValue = points[0].value;
  const apexX = x + Math.max(8, Math.min(width * 0.45, 26));
  const apexY = laneTop + 10;
  const out: ReactNode[] = [];
  if (startValue > 0.01) {
    // Pre-bend: straight up.
    out.push(<path key={`${key}pb`} className="bend" d={`M${x - 2} ${y - 7} V${apexY + 2}`} />);
  } else {
    out.push(<path key={`${key}up`} className="bend" d={`M${x} ${y - 2} Q${apexX} ${y - 2} ${apexX} ${apexY + 2}`} />);
  }
  const ax = startValue > 0.01 ? x - 2 : apexX;
  out.push(<path key={`${key}ah`} className="bend-head" d={`M${ax - 3.5} ${apexY + 5} L${ax} ${apexY - 1} L${ax + 3.5} ${apexY + 5} Z`} />);
  out.push(
    <text key={`${key}bl`} className="bend-label" x={ax} y={apexY - 3} textAnchor="middle">
      {bendLabel(peak)}
    </text>,
  );
  if (peak - lastValue > 0.01) {
    const rx = apexX + Math.max(10, width * 0.35);
    out.push(<path key={`${key}rel`} className="bend dashed" d={`M${ax} ${apexY + 2} Q${rx} ${apexY + 2} ${rx} ${y - 8}`} />);
    out.push(<path key={`${key}rh`} className="bend-head" d={`M${rx - 3.5} ${y - 13} L${rx} ${y - 7} L${rx + 3.5} ${y - 13} Z`} />);
  }
  return out;
}

function wavePath(x: number, y: number, width: number, amp: number): string {
  let d = `M${x} ${y}`;
  const step = 4;
  for (let i = 0, cx = x; cx < x + width; i++, cx += step) d += ` Q${cx + step / 2} ${y + (i % 2 ? amp : -amp)} ${cx + step} ${y}`;
  return d;
}

function restGlyph(key: string, beat: Beat, x: number, mid: number): ReactNode {
  const v = beat.value;
  if (v <= 2) {
    // Whole hangs from a line, half sits on it.
    return <rect key={key} className="rest" x={x - 5} y={v === 1 ? mid - 6 : mid - 2} width={10} height={4} />;
  }
  if (v === 4) {
    return <path key={key} className="rest-q" d={`M${x - 2} ${mid - 9} l4 5 -3.5 3.5 4 5 c-3 -1.5 -5 0 -2.5 3`} />;
  }
  const flags = Math.max(1, Math.log2(v) - 2);
  const parts: ReactNode[] = [];
  for (let i = 0; i < flags; i++) {
    const fy = mid - 6 + i * 5;
    parts.push(<circle key={`${key}d${i}`} className="rest" cx={x - 2 - i} cy={fy} r={1.8} />, <path key={`${key}s${i}`} className="rest-q" d={`M${x - 2 - i} ${fy + 1} Q${x + 1} ${fy + 2} ${x + 3 - i} ${fy - 1.5}`} />);
  }
  parts.push(<line key={`${key}stem`} className="rest-q" x1={x + 3} y1={mid - 7.5} x2={x - 1 - flags} y2={mid + 6 + flags * 2} />);
  return <g key={key}>{parts}</g>;
}

// Stems, beams, flags, dots and tuplets for voice 1.
function rhythmElements(song: Song, layout: SheetLayout, system: SystemLayout, m: MeasureLayout): ReactNode[] {
  const header = song.measures[m.index];
  const beats = m.beats.filter((b) => b.voice === 0);
  const out: ReactNode[] = [];
  const drums = layout.drums;
  const stemTop = drums ? system.staffTop - 22 : system.rhythmTop + 2;
  const stemBottom = drums ? system.staffTop - 22 : system.rhythmTop + 24;
  const beamY = drums ? stemTop : stemBottom; // beams sit at the stem end
  const dir = drums ? 1 : -1; // secondary beams move toward the notes
  const unit = header.denominator === 8 && header.numerator % 3 === 0 ? 1440 : 960;
  const key = `r${m.index}`;

  // Stems (tab only; drum stems are drawn with the noteheads).
  if (!drums) {
    for (const bl of beats) {
      const b = bl.beat;
      if (b.rest || b.value < 2) continue;
      const x = m.x + bl.x;
      out.push(<line key={`${key}s${b.start}`} className="stem" x1={x} x2={x} y1={b.value === 2 ? stemTop + 11 : stemTop} y2={stemBottom} />);
    }
  }

  // Beam groups.
  const groups: BeatLayout[][] = [];
  let cur: BeatLayout[] = [];
  let curGroup = -1;
  for (const bl of beats) {
    const b = bl.beat;
    const g = Math.floor(b.start / unit);
    const beamable = !b.rest && b.value >= 8;
    if (!beamable || g !== curGroup) {
      if (cur.length) groups.push(cur);
      cur = [];
    }
    if (beamable) {
      cur.push(bl);
      curGroup = g;
    } else {
      curGroup = -1;
    }
  }
  if (cur.length) groups.push(cur);

  const stemX = (bl: BeatLayout) => m.x + bl.x + (drums ? 4 : 0);
  for (const group of groups) {
    if (group.length === 1) {
      // Flags.
      const bl = group[0];
      const x = stemX(bl);
      const flags = Math.log2(bl.beat.value) - 2;
      for (let i = 0; i < flags; i++) {
        const y = beamY - dir * -i * 5;
        out.push(<path key={`${key}fl${bl.beat.start}${i}`} className="flag" d={`M${x} ${y} q5 ${dir * 6} 7 ${dir * 11}`} />);
      }
      continue;
    }
    const xs = group.map(stemX);
    out.push(<rect key={`${key}bm${group[0].beat.start}`} className="beam" x={xs[0]} y={beamY - 1.5} width={xs[xs.length - 1] - xs[0]} height={3} />);
    for (let level = 1; level < 4; level++) {
      const need = 8 << level;
      const y = beamY + dir * level * 5 * -1;
      for (let i = 0; i < group.length; i++) {
        if (group[i].beat.value < need) continue;
        const nextOk = i + 1 < group.length && group[i + 1].beat.value >= need;
        const prevOk = i > 0 && group[i - 1].beat.value >= need;
        if (nextOk) {
          out.push(<rect key={`${key}b${level}-${i}`} className="beam" x={xs[i]} y={y - 1.5} width={xs[i + 1] - xs[i]} height={3} />);
        } else if (!prevOk) {
          // Partial beam stub toward the neighbour.
          const toward = i > 0 ? -1 : 1;
          const w = 7;
          out.push(<rect key={`${key}p${level}-${i}`} className="beam" x={toward > 0 ? xs[i] : xs[i] - w} y={y - 1.5} width={w} height={3} />);
        }
      }
    }
  }

  // Dots and tuplets.
  for (const bl of beats) {
    const b = bl.beat;
    if (!b.dots || b.rest) continue;
    const x = stemX(bl);
    out.push(<circle key={`${key}dot${b.start}`} className="ink" cx={x + 5} cy={drums ? stemTop + 6 : stemBottom - 3} r={1.6} />);
  }
  let i = 0;
  while (i < beats.length) {
    const t = beats[i].beat.tuplet;
    if (!t) {
      i++;
      continue;
    }
    let j = i;
    let ticks = 0;
    const span = beats[i].beat.duration * t.enters;
    while (j < beats.length && beats[j].beat.tuplet?.enters === t.enters && ticks < span - 1) {
      ticks += beats[j].beat.duration;
      j++;
    }
    const xa = stemX(beats[i]);
    const xb = stemX(beats[j - 1]);
    out.push(
      <text key={`${key}tup${i}`} className="tuplet" x={(xa + xb) / 2} y={drums ? stemTop - 5 : stemBottom + 12} textAnchor="middle">
        {t.enters}
      </text>,
    );
    i = j;
  }
  return out;
}

// Effects that span several beats: palm mute, let ring, slides and hammer-ons between notes.
function runEffects(system: SystemLayout, track: Track): ReactNode[] {
  if (track.isPercussion) return [];
  const out: ReactNode[] = [];
  const all = system.measures.flatMap((m) => m.beats.filter((b) => b.voice === 0).map((bl) => ({ m, bl, x: m.x + bl.x })));

  for (const [flag, lane, label] of [
    ['palmMute', system.lanes.palmMute, 'P.M.'],
    ['letRing', system.lanes.letRing, 'let ring'],
  ] as const) {
    if (lane === undefined) continue;
    let start = -1;
    const close = (end: number) => {
      const a = all[start];
      const b = all[end];
      const xEnd = b.x + Math.max(8, b.bl.width - 6);
      out.push(
        <text key={`${flag}${a.m.index}-${a.bl.beat.start}`} className="fx-text" x={a.x - 6} y={lane + 11}>
          {label}
        </text>,
      );
      const textEnd = a.x - 6 + label.length * 6.2 + 3;
      if (xEnd > textEnd + 4) {
        out.push(
          <path key={`${flag}l${a.m.index}-${a.bl.beat.start}`} className="fx-line dashed" d={`M${textEnd} ${lane + 7} H${xEnd} v4`} fill="none" />,
        );
      }
    };
    all.forEach((e, i) => {
      const on = e.bl.beat.notes.some((n) => n[flag]);
      if (on && start < 0) start = i;
      if (!on && start >= 0) {
        close(i - 1);
        start = -1;
      }
    });
    if (start >= 0) close(all.length - 1);
  }

  // Slides and hammer-ons connect to the next note on the same string.
  all.forEach((e, i) => {
    for (const n of e.bl.beat.notes) {
      const slide = n.slide && (n.slide.shift || n.slide.legato);
      if (!slide && !n.hammer) continue;
      let next: { x: number; note: Note } | null = null;
      for (let j = i + 1; j < all.length && !next; j++) {
        const nn = all[j].bl.beat.notes.find((x) => x.string === n.string);
        if (nn) next = { x: all[j].x, note: nn };
      }
      if (!next) continue;
      const y = system.staffTop + n.string * TAB_GAP;
      const w1 = fretLabel(n, false).length * 8 + 4;
      const w2 = fretLabel(next.note, false).length * 8 + 4;
      const k = `${e.m.index}-${e.bl.beat.start}-${n.string}`;
      if (slide) {
        const up = next.note.fret > n.fret;
        out.push(<line key={`sl${k}`} className="fx-line" x1={e.x + w1 / 2 + 1} y1={y + (up ? 3 : -3)} x2={next.x - w2 / 2 - 1} y2={y + (up ? -3 : 3)} />);
      }
      if (n.hammer) {
        const xa = e.x;
        const xb = next.x;
        const top = y - 9 - Math.min(6, (xb - xa) / 10);
        out.push(<path key={`hm${k}`} className="arc" d={`M${xa} ${y - 7} Q${(xa + xb) / 2} ${top - 4} ${xb} ${y - 7}`} />);
        out.push(
          <text key={`hmt${k}`} className="arc-text" x={(xa + xb) / 2} y={top - 3} textAnchor="middle">
            {next.note.fret >= n.fret ? 'H' : 'P'}
          </text>,
        );
      }
    }
  });
  return out;
}

// Crescendo / decrescendo wedges over runs of beats on one line.
function hairpins(system: SystemLayout, layout: SheetLayout): ReactNode[] {
  if (system.dynamicsY === null) return [];
  const out: ReactNode[] = [];
  const beats = system.measures.flatMap((m) => m.beats.filter((b) => b.voice === 0).map((bl) => ({ bl, x: m.x + bl.x })));
  const y = system.dynamicsY + 8;
  let i = 0;
  while (i < beats.length) {
    const kind = beats[i].bl.beat.hairpin;
    if (!kind) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < beats.length && beats[j + 1].bl.beat.hairpin === kind) j++;
    // Start after a dynamic marking printed on the first beat.
    const startX = beats[i].x + (layout.marks.has(beats[i].bl.beat) ? 18 : -2);
    const endX = beats[j].x + Math.max(10, beats[j].bl.width - 6);
    const open = kind === 'cresc' ? endX : startX;
    const point = kind === 'cresc' ? startX : endX;
    out.push(<path key={`hp${i}`} className="hairpin" d={`M${open} ${y - 5} L${point} ${y} L${open} ${y + 5}`} />);
    i = j + 1;
  }
  return out;
}

// Tie arcs: a curve from a note to the tied note that continues it. Ties that cross a
// line break end at the edge of the line and pick up again at the start of the next one.
function tieArcs(system: SystemLayout, track: Track): ReactNode[] {
  const drums = track.isPercussion;
  const out: ReactNode[] = [];
  // Tab ties sit under the fret number; drum ties sit under the notehead (stems point up).
  const tieY = (n: Note) => (drums ? system.staffBottom - drumPos(n.midi)[0] * (DRUM_GAP / 2) + 6 : system.staffTop + n.string * TAB_GAP + 7);
  const same = (a: Note, b: Note) => (drums ? a.midi === b.midi : a.string === b.string);
  const first = system.measures[0];
  const last = system.measures[system.measures.length - 1];
  const lineStart = first ? first.x + 4 : SIDE_PAD + 30;
  const lineEnd = last ? last.x + last.width - 4 : system.width - SIDE_PAD;
  const arc = (key: string, x1: number, x2: number, y: number, openLeft = false, openRight = false) => {
    const a = x1 + (openLeft ? 0 : 7);
    const b = x2 - (openRight ? 0 : 7);
    if (b - a < 4) return;
    const depth = Math.min(9, 3 + (b - a) / 10);
    out.push(<path key={key} className="tie" d={`M${a} ${y} Q${(a + b) / 2} ${y + depth * 2} ${b} ${y}`} />);
  };

  for (const voice of [0, 1]) {
    const beats = system.measures.flatMap((m) => m.beats.filter((b) => b.voice === voice).map((bl) => ({ m, bl, x: m.x + bl.x })));
    beats.forEach((e, i) => {
      for (const n of e.bl.beat.notes) {
        const y = tieY(n);
        const k = `tie${voice}-${e.m.index}-${e.bl.beat.start}-${n.string}`;
        if (n.tieDestination) {
          // Find the note this one continues, earlier on this line.
          let fromX: number | null = null;
          for (let j = i - 1; j >= 0 && fromX === null; j--) {
            if (beats[j].bl.beat.notes.some((x) => same(x, n))) fromX = beats[j].x;
          }
          if (fromX === null) arc(`${k}in`, lineStart, e.x, y, true, false);
          else arc(k, fromX, e.x, y);
        }
        if (n.tieOrigin) {
          // The continuation is on the next line: run off the end of this one.
          const continues = beats.slice(i + 1).some((x) => x.bl.beat.notes.some((nn) => same(nn, n)));
          if (!continues) arc(`${k}out`, e.x, lineEnd, y, false, true);
        }
      }
    });
  }
  return out;
}
