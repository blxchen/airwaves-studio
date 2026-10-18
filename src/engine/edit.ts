// Editing operations. Each takes a (cloned) Song and mutates it in place;
// callers clone first so the previous version can go on the undo stack.
import {
  beatTicks,
  measureTicks,
  newBeat,
  newNote,
  newSlide,
  type Beat,
  type DurationValue,
  type Note,
  type Song,
  type Track,
} from './model';

export interface Caret {
  measure: number;
  beat: number; // index into voice 0 of the measure
  string: number; // tab row (0 = top string), or drum row for percussion
}

export const DURATIONS: DurationValue[] = [1, 2, 4, 8, 16, 32, 64];

// Drum rows offered in the editor, top to bottom (matches staff positions).
export const DRUM_ROWS: { key: number; name: string }[] = [
  { key: 49, name: 'Crash' },
  { key: 42, name: 'Hi-hat' },
  { key: 46, name: 'Open hi-hat' },
  { key: 51, name: 'Ride' },
  { key: 50, name: 'High tom' },
  { key: 47, name: 'Mid tom' },
  { key: 38, name: 'Snare' },
  { key: 43, name: 'Floor tom' },
  { key: 36, name: 'Kick' },
  { key: 44, name: 'Pedal hi-hat' },
];

export function cloneSong(song: Song): Song {
  return structuredClone(song);
}

export function rowCount(track: Track): number {
  return track.isPercussion ? DRUM_ROWS.length : track.tuning.length;
}

// --- measure bookkeeping -------------------------------------------------------

export function recomputeHeaders(song: Song) {
  let start = 0;
  song.measures.forEach((h, i) => {
    h.index = i;
    h.length = measureTicks(h.numerator, h.denominator);
    h.start = start;
    start += h.length;
  });
}

function restOf(value: DurationValue, start: number): Beat {
  return newBeat({ rest: true, value, start, duration: beatTicks(value, 0, null) });
}

// Fills gaps with rests, drops trailing rests that overflow, recomputes positions.
export function normalizeMeasure(song: Song, track: Track, m: number) {
  const header = song.measures[m];
  const measure = (track.measures[m] ??= { voices: [{ beats: [] }] });
  if (!measure.voices.length) measure.voices.push({ beats: [] });
  for (const voice of measure.voices) {
    let start = 0;
    for (const b of voice.beats) {
      b.duration = beatTicks(b.value, b.dots, b.tuplet);
      b.start = start;
      start += b.duration;
      if (!b.notes.length) b.rest = true;
    }
    // Trim trailing rests that push the bar over.
    while (start > header.length && voice.beats.length > 1) {
      const last = voice.beats[voice.beats.length - 1];
      if (!last.rest || start - last.duration < header.length) break;
      voice.beats.pop();
      start -= last.duration;
    }
    // Fill the remainder with the largest rests that fit.
    if (voice === measure.voices[0] || voice.beats.length) {
      let remaining = header.length - start;
      while (remaining > 0) {
        const value = DURATIONS.find((v) => beatTicks(v, 0, null) <= remaining);
        if (!value) break;
        voice.beats.push(restOf(value, start));
        start += beatTicks(value, 0, null);
        remaining = header.length - start;
      }
    }
  }
}

export function isOverfilled(song: Song, track: Track, m: number): boolean {
  const total = (track.measures[m]?.voices[0]?.beats ?? []).reduce((a, b) => a + b.duration, 0);
  return total > song.measures[m].length;
}

// --- caret helpers ---------------------------------------------------------------

export function beatAt(track: Track, c: Caret): Beat | undefined {
  return track.measures[c.measure]?.voices[0]?.beats[c.beat];
}

function noteKey(track: Track, c: Caret): (n: Note) => boolean {
  if (track.isPercussion) {
    const key = DRUM_ROWS[c.string]?.key;
    return (n) => n.midi === key;
  }
  return (n) => n.string === c.string;
}

export function noteAt(track: Track, c: Caret): Note | undefined {
  return beatAt(track, c)?.notes.find(noteKey(track, c));
}

export function clampCaret(song: Song, track: Track, c: Caret): Caret {
  const measure = Math.max(0, Math.min(song.measures.length - 1, c.measure));
  const beats = track.measures[measure]?.voices[0]?.beats.length ?? 1;
  return {
    measure,
    beat: Math.max(0, Math.min(beats - 1, c.beat)),
    string: Math.max(0, Math.min(rowCount(track) - 1, c.string)),
  };
}

// Moves the caret one beat left/right, crossing bar lines.
export function stepCaret(song: Song, track: Track, c: Caret, dir: 1 | -1): Caret {
  const beats = track.measures[c.measure]?.voices[0]?.beats.length ?? 0;
  if (dir > 0 && c.beat + 1 < beats) return { ...c, beat: c.beat + 1 };
  if (dir < 0 && c.beat > 0) return { ...c, beat: c.beat - 1 };
  if (dir > 0 && c.measure + 1 < song.measures.length) return { ...c, measure: c.measure + 1, beat: 0 };
  if (dir < 0 && c.measure > 0) {
    const prev = track.measures[c.measure - 1]?.voices[0]?.beats.length ?? 1;
    return { ...c, measure: c.measure - 1, beat: prev - 1 };
  }
  return c;
}

// --- note edits -------------------------------------------------------------------

export function setFret(_song: Song, track: Track, c: Caret, fret: number) {
  const beat = beatAt(track, c);
  if (!beat) return;
  beat.rest = false;
  if (track.isPercussion) {
    const key = DRUM_ROWS[c.string].key;
    if (!beat.notes.some((n) => n.midi === key)) beat.notes.push(newNote({ string: c.string, fret: key, midi: key }));
    return;
  }
  const existing = beat.notes.find((n) => n.string === c.string);
  if (existing) {
    existing.fret = fret;
    existing.dead = false;
  } else {
    beat.notes.push(newNote({ string: c.string, fret }));
    beat.notes.sort((a, b) => a.string - b.string);
  }
}

export function removeNote(_song: Song, track: Track, c: Caret) {
  const beat = beatAt(track, c);
  if (!beat) return;
  beat.notes = beat.notes.filter((n) => !noteKey(track, c)(n));
  if (!beat.notes.length) beat.rest = true;
}

export function toggleRest(song: Song, track: Track, c: Caret) {
  const beat = beatAt(track, c);
  if (!beat) return;
  if (beat.rest) {
    setFret(song, track, c, 0);
  } else {
    beat.notes = [];
    beat.rest = true;
  }
}

export type NoteFlag = 'palmMute' | 'letRing' | 'hammer' | 'dead' | 'ghost' | 'accent' | 'heavyAccent' | 'staccato' | 'tieDestination' | 'tapped';

export function toggleNoteFlag(_song: Song, track: Track, c: Caret, flag: NoteFlag) {
  const note = noteAt(track, c);
  if (!note) return;
  note[flag] = !note[flag];
}

export function toggleVibrato(_song: Song, track: Track, c: Caret) {
  const note = noteAt(track, c);
  if (note) note.vibrato = note.vibrato === 'none' ? 'slight' : note.vibrato === 'slight' ? 'wide' : 'none';
}

export type BendKind = 'half' | 'full' | 'release' | 'prebend' | 'none';

export function setBend(_song: Song, track: Track, c: Caret, kind: BendKind) {
  const note = noteAt(track, c);
  if (!note) return;
  if (kind === 'none') note.bend = null;
  else if (kind === 'half') note.bend = [{ position: 0, value: 0 }, { position: 0.5, value: 1 }, { position: 1, value: 1 }];
  else if (kind === 'full') note.bend = [{ position: 0, value: 0 }, { position: 0.5, value: 2 }, { position: 1, value: 2 }];
  else if (kind === 'release') note.bend = [{ position: 0, value: 0 }, { position: 0.3, value: 2 }, { position: 0.6, value: 2 }, { position: 1, value: 0 }];
  else note.bend = [{ position: 0, value: 2 }, { position: 1, value: 0 }];
}

export function bendKind(note: Note | undefined): BendKind {
  if (!note?.bend) return 'none';
  const first = note.bend[0].value;
  const last = note.bend[note.bend.length - 1].value;
  const peak = Math.max(...note.bend.map((p) => p.value));
  if (first > 0.01) return 'prebend';
  if (peak - last > 0.01) return 'release';
  return peak <= 1.01 ? 'half' : 'full';
}

export type SlideKind = 'shift' | 'legato' | 'inBelow' | 'inAbove' | 'outDown' | 'outUp';

export function toggleSlide(_song: Song, track: Track, c: Caret, kind: SlideKind) {
  const note = noteAt(track, c);
  if (!note) return;
  const on = !note.slide?.[kind];
  note.slide = on ? newSlide({ ...(note.slide ?? {}), [kind]: true }) : note.slide && { ...note.slide, [kind]: false };
  if (note.slide && !Object.values(note.slide).some(Boolean)) note.slide = null;
}

export function toggleHarmonic(_song: Song, track: Track, c: Caret) {
  const note = noteAt(track, c);
  if (!note) return;
  if (note.harmonic) note.harmonic = null;
  else {
    note.harmonic = 'natural';
    note.harmonicFret = note.fret;
  }
}

export function setBeatText(_song: Song, track: Track, c: Caret, text: string) {
  const beat = beatAt(track, c);
  if (beat) beat.text = text.trim() || null;
}

// --- rhythm edits -----------------------------------------------------------------

export function setDuration(song: Song, track: Track, c: Caret, value: DurationValue) {
  const beat = beatAt(track, c);
  if (!beat) return;
  beat.value = value;
  normalizeMeasure(song, track, c.measure);
}

export function toggleDot(song: Song, track: Track, c: Caret) {
  const beat = beatAt(track, c);
  if (!beat) return;
  beat.dots = beat.dots ? 0 : 1;
  normalizeMeasure(song, track, c.measure);
}

export function toggleTriplet(song: Song, track: Track, c: Caret) {
  const beat = beatAt(track, c);
  if (!beat) return;
  beat.tuplet = beat.tuplet ? null : { enters: 3, times: 2 };
  normalizeMeasure(song, track, c.measure);
}

export function insertBeat(song: Song, track: Track, c: Caret) {
  const voice = track.measures[c.measure]?.voices[0];
  const current = beatAt(track, c);
  if (!voice || !current) return;
  voice.beats.splice(c.beat, 0, newBeat({ rest: true, value: current.value, dots: current.dots, tuplet: current.tuplet }));
  normalizeMeasure(song, track, c.measure);
}

export function deleteBeat(song: Song, track: Track, c: Caret) {
  const voice = track.measures[c.measure]?.voices[0];
  if (!voice || voice.beats.length === 0) return;
  voice.beats.splice(c.beat, 1);
  normalizeMeasure(song, track, c.measure);
}

// --- bar edits --------------------------------------------------------------------

export function insertMeasure(song: Song, at: number) {
  const template = song.measures[Math.max(0, Math.min(song.measures.length - 1, at - 1))] ?? song.measures[0];
  song.measures.splice(at, 0, {
    index: at,
    numerator: template?.numerator ?? 4,
    denominator: template?.denominator ?? 4,
    start: 0,
    length: 0,
    repeatOpen: false,
    repeatClose: 0,
    alternateEndings: 0,
    marker: null,
    doubleBar: false,
    tripletFeel: template?.tripletFeel ?? 'none',
    keySignature: template?.keySignature ?? 0,
  });
  for (const track of song.tracks) track.measures.splice(at, 0, { voices: [{ beats: [] }] });
  shiftMeasureRefs(song, at, 1);
  recomputeHeaders(song);
  for (const track of song.tracks) normalizeMeasure(song, track, at);
}

export function deleteMeasure(song: Song, at: number) {
  if (song.measures.length <= 1) return;
  song.measures.splice(at, 1);
  for (const track of song.tracks) track.measures.splice(at, 1);
  song.tempoChanges = song.tempoChanges.filter((t) => t.measure !== at);
  for (const track of song.tracks) track.instrumentChanges = track.instrumentChanges.filter((c) => c.measure !== at);
  shiftMeasureRefs(song, at + 1, -1);
  recomputeHeaders(song);
}

function shiftMeasureRefs(song: Song, from: number, delta: number) {
  for (const t of song.tempoChanges) if (t.measure >= from) t.measure += delta;
  for (const track of song.tracks) for (const c of track.instrumentChanges) if (c.measure >= from) c.measure += delta;
}

// Changes the time signature from bar `m` up to the next explicit change.
export function setTimeSignature(song: Song, m: number, numerator: number, denominator: number) {
  const old = song.measures[m];
  const oldSig = `${old.numerator}/${old.denominator}`;
  for (let i = m; i < song.measures.length; i++) {
    const h = song.measures[i];
    if (i > m && `${h.numerator}/${h.denominator}` !== oldSig) break;
    h.numerator = numerator;
    h.denominator = denominator;
  }
  recomputeHeaders(song);
  for (const track of song.tracks) for (let i = m; i < song.measures.length; i++) normalizeMeasure(song, track, i);
}

export function setTempoChange(song: Song, m: number, bpm: number | null) {
  song.tempoChanges = song.tempoChanges.filter((t) => !(t.measure === m && t.tick === 0));
  if (m === 0 && bpm) song.tempo = bpm;
  else if (bpm) song.tempoChanges.push({ measure: m, tick: 0, bpm });
  song.tempoChanges.sort((a, b) => a.measure - b.measure || a.tick - b.tick);
}

export function tempoAt(song: Song, m: number): number {
  let bpm = song.tempo;
  for (const t of song.tempoChanges) if (t.measure <= m) bpm = t.bpm;
  return bpm;
}

export function setSection(song: Song, m: number, text: string | null) {
  song.measures[m].marker = text?.trim() || null;
}

export function toggleRepeatOpen(song: Song, m: number) {
  song.measures[m].repeatOpen = !song.measures[m].repeatOpen;
}

export function setRepeatClose(song: Song, m: number, plays: number) {
  song.measures[m].repeatClose = plays >= 2 ? plays : 0;
}

export function setEndings(song: Song, m: number, endings: number[]) {
  song.measures[m].alternateEndings = endings.reduce((mask, e) => mask | (1 << (e - 1)), 0);
}

// --- instruments and tracks -------------------------------------------------------

export function setInstrumentChange(song: Song, trackIndex: number, m: number, tick: number, program: number | null) {
  const track = song.tracks[trackIndex];
  track.instrumentChanges = track.instrumentChanges.filter((c) => !(c.measure === m && c.tick === tick));
  if (program !== null) {
    if (m === 0 && tick === 0) track.program = program;
    else track.instrumentChanges.push({ measure: m, tick, program });
  }
  track.instrumentChanges.sort((a, b) => a.measure - b.measure || a.tick - b.tick);
}

export interface TrackSpec {
  name: string;
  program: number;
  tuning: number[];
  drums: boolean;
  capo: number;
}

const COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#f08c00', '#0c8599', '#c2255c', '#5f3dc4'];

export function addTrack(song: Song, spec: TrackSpec): number {
  const index = song.tracks.length;
  const track: Track = {
    index,
    name: spec.name || `Track ${index + 1}`,
    program: spec.drums ? 0 : spec.program,
    isPercussion: spec.drums,
    tuning: spec.drums ? [] : spec.tuning,
    capo: spec.drums ? 0 : spec.capo,
    fretCount: 24,
    color: COLORS[index % COLORS.length],
    volume: 0.8,
    pan: 0,
    instrumentChanges: [],
    measures: song.measures.map(() => ({ voices: [{ beats: [] }] })),
  };
  song.tracks.push(track);
  song.measures.forEach((_, m) => normalizeMeasure(song, track, m));
  return index;
}

export function updateTrack(song: Song, index: number, spec: Partial<TrackSpec>) {
  const track = song.tracks[index];
  if (spec.name !== undefined) track.name = spec.name || track.name;
  if (spec.program !== undefined && !track.isPercussion) track.program = spec.program;
  if (spec.capo !== undefined && !track.isPercussion) track.capo = Math.max(0, Math.min(24, spec.capo));
  if (spec.tuning && !track.isPercussion) {
    track.tuning = spec.tuning;
    // Drop notes on strings that no longer exist.
    for (const m of track.measures) for (const v of m.voices) for (const b of v.beats) {
      b.notes = b.notes.filter((n) => n.string < spec.tuning!.length);
      if (!b.notes.length) b.rest = true;
    }
  }
}

export function removeTrack(song: Song, index: number) {
  if (song.tracks.length <= 1) return;
  song.tracks.splice(index, 1);
  song.tracks.forEach((t, i) => (t.index = i));
}

export function createSong(title: string, artist: string, tempo: number, spec: TrackSpec, bars = 16): Song {
  const song: Song = {
    title: title || 'Untitled',
    subtitle: '',
    artist: artist || 'Unknown artist',
    album: '',
    music: '',
    words: '',
    tabber: '',
    tempo,
    measures: [],
    tracks: [],
    tempoChanges: [],
  };
  for (let i = 0; i < bars; i++) insertMeasure(song, i);
  addTrack(song, spec);
  return song;
}

// --- dynamics -----------------------------------------------------------------------

// Sets the dynamic from the caret onward, until the music reaches a different dynamic.
export function setDynamic(_song: Song, track: Track, c: Caret, velocity: number) {
  const first = beatAt(track, c);
  const old = first?.notes[0]?.velocity;
  let started = false;
  for (let m = c.measure; m < track.measures.length; m++) {
    const beats = track.measures[m]?.voices[0]?.beats ?? [];
    for (let i = m === c.measure ? c.beat : 0; i < beats.length; i++) {
      const b = beats[i];
      if (!b.notes.length) continue;
      if (started && b.notes.some((n) => n.velocity !== old)) return;
      for (const n of b.notes) n.velocity = velocity;
      started = true;
    }
  }
}

export function toggleHairpin(_song: Song, track: Track, c: Caret, kind: 'cresc' | 'dim') {
  const beat = beatAt(track, c);
  if (beat) beat.hairpin = beat.hairpin === kind ? null : kind;
}
