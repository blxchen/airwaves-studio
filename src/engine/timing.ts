// Playback timeline: expands repeats / alternate endings and maps ticks to seconds.
import { TICKS_PER_QUARTER, type Song } from './model';

export interface PlayedMeasure {
  measure: number; // index into song.measures
  start: number; // tick on the playback timeline
  length: number;
}

// Order in which measures are heard. With `range`, plays from..to once, straight through.
export function playOrder(song: Song, range?: { from: number; to: number }): PlayedMeasure[] {
  const out: PlayedMeasure[] = [];
  let tick = 0;
  const push = (i: number) => {
    const m = song.measures[i];
    out.push({ measure: i, start: tick, length: m.length });
    tick += m.length;
  };

  if (range) {
    for (let i = range.from; i <= range.to; i++) push(i);
    return out;
  }

  const measures = song.measures;
  const closeCounts = new Map<number, number>();
  let repeatStart = 0;
  let pass = 1; // which time through the current repeat (for alternate endings)
  let jumpedBack = false;
  let i = 0;
  let guard = 0;

  while (i < measures.length && guard++ < 100000) {
    const m = measures[i];
    if (m.repeatOpen && !jumpedBack) {
      repeatStart = i;
      pass = 1;
    }
    jumpedBack = false;

    if (m.alternateEndings && !(m.alternateEndings & (1 << (pass - 1)))) {
      i++;
      continue;
    }
    push(i);

    if (m.repeatClose > 0) {
      const done = closeCounts.get(i) ?? 1;
      if (done < m.repeatClose) {
        closeCounts.set(i, done + 1);
        pass++;
        i = repeatStart;
        jumpedBack = true;
        continue;
      }
      closeCounts.delete(i);
    }
    i++;
  }
  return out;
}

interface Segment {
  tick: number;
  seconds: number;
  bpm: number;
}

export class TempoMap {
  private segments: Segment[] = [];

  constructor(song: Song, order: PlayedMeasure[]) {
    // Tempo at a score position is the last change at or before it, in score order.
    const changes = song.tempoChanges;
    const bpmAt = (measure: number, tick: number) => {
      let bpm = song.tempo;
      for (const c of changes) {
        if (c.measure < measure || (c.measure === measure && c.tick <= tick)) bpm = c.bpm;
        else break;
      }
      return bpm;
    };

    const points: { tick: number; bpm: number }[] = [];
    for (const pm of order) {
      points.push({ tick: pm.start, bpm: bpmAt(pm.measure, 0) });
      for (const c of changes) if (c.measure === pm.measure && c.tick > 0) points.push({ tick: pm.start + c.tick, bpm: c.bpm });
    }
    if (!points.length) points.push({ tick: 0, bpm: song.tempo });

    let seconds = 0;
    let prev: Segment | null = null;
    for (const p of points) {
      if (prev) {
        if (p.bpm === prev.bpm) continue;
        seconds = prev.seconds + this.span(p.tick - prev.tick, prev.bpm);
      }
      const seg: Segment = { tick: p.tick, seconds, bpm: p.bpm };
      this.segments.push(seg);
      prev = seg;
    }
  }

  private span(ticks: number, bpm: number) {
    return (ticks / TICKS_PER_QUARTER) * (60 / bpm);
  }

  private segmentAtTick(tick: number): Segment {
    const s = this.segments;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  secondsAt(tick: number): number {
    const seg = this.segmentAtTick(tick);
    return seg.seconds + this.span(tick - seg.tick, seg.bpm);
  }

  tickAt(seconds: number): number {
    const s = this.segments;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].seconds <= seconds) lo = mid;
      else hi = mid - 1;
    }
    const seg = s[lo];
    return seg.tick + ((seconds - seg.seconds) * seg.bpm * TICKS_PER_QUARTER) / 60;
  }

  bpmAt(tick: number): number {
    return this.segmentAtTick(tick).bpm;
  }
}
