// Core score model shared by every parser, the renderer and the audio engine.
// Durations are in ticks: 960 per quarter note.

export const TICKS_PER_QUARTER = 960;

export interface Song {
  title: string;
  subtitle: string;
  artist: string;
  album: string;
  music: string;
  words: string;
  tabber: string;
  tempo: number; // initial BPM (quarter notes)
  measures: MeasureHeader[];
  tracks: Track[];
  tempoChanges: TempoChange[];
}

export interface TempoChange {
  measure: number;
  tick: number; // offset inside the measure
  bpm: number;
}

export interface MeasureHeader {
  index: number;
  numerator: number;
  denominator: number;
  start: number; // absolute tick, ignoring repeats
  length: number; // ticks
  repeatOpen: boolean;
  repeatClose: number; // total number of plays, 0 = no repeat sign
  alternateEndings: number; // bitmask: bit 0 = 1st ending
  marker: string | null;
  doubleBar: boolean;
  tripletFeel: 'none' | 'eighth' | 'sixteenth';
  keySignature: number; // -7..7 sharps/flats
}

export interface Track {
  index: number;
  name: string;
  program: number; // General MIDI program
  isPercussion: boolean;
  tuning: number[]; // MIDI pitch per string, top (highest) string first
  capo: number;
  fretCount: number;
  color: string;
  volume: number; // 0..1
  pan: number; // -1..1
  instrumentChanges: InstrumentChange[]; // switches of sound partway through the song
  measures: Measure[]; // one per MeasureHeader
}

export interface InstrumentChange {
  measure: number;
  tick: number; // offset inside the measure
  program: number;
}

// Program in effect at a score position.
export function programAt(track: Track, measure: number, tick: number): number {
  let program = track.program;
  for (const c of track.instrumentChanges) {
    if (c.measure < measure || (c.measure === measure && c.tick <= tick)) program = c.program;
  }
  return program;
}

export interface Measure {
  voices: Voice[];
}

export interface Voice {
  beats: Beat[];
}

export type DurationValue = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128;

export interface Tuplet {
  enters: number; // e.g. 3 notes ...
  times: number; // ... in the time of 2
}

export interface Beat {
  start: number; // tick offset inside the measure
  duration: number; // ticks
  value: DurationValue;
  dots: number;
  tuplet: Tuplet | null;
  rest: boolean;
  notes: Note[];
  text: string | null;
  chord: ChordDiagram | null;
  vibrato: 'none' | 'slight' | 'wide';
  tremoloBar: BendPoint[] | null;
  fadeIn: boolean;
  stroke: 'none' | 'up' | 'down';
  slap: 'none' | 'tap' | 'slap' | 'pop';
  pickStroke: 'none' | 'up' | 'down';
  hairpin: 'cresc' | 'dim' | null; // crescendo / decrescendo wedge over this beat
}

export interface ChordDiagram {
  name: string;
  firstFret: number;
  frets: number[]; // per string, top first; -1 = not played
}

export interface BendPoint {
  position: number; // 0..1 of the note duration
  value: number; // semitones
}

export interface Slide {
  shift: boolean; // slide to next note, re-picked
  legato: boolean; // slide to next note, not re-picked
  outDown: boolean;
  outUp: boolean;
  inBelow: boolean;
  inAbove: boolean;
}

export type HarmonicKind = 'natural' | 'artificial' | 'pinch' | 'tapped' | 'semi' | 'feedback';

export interface Grace {
  fret: number;
  duration: number; // ticks
  dead: boolean;
  onBeat: boolean;
  transition: 'none' | 'slide' | 'bend' | 'hammer';
}

export interface Note {
  string: number; // 0 = top (highest) string
  fret: number;
  midi: number | null; // explicit pitch, used for percussion
  velocity: number; // 1..127
  tieDestination: boolean;
  tieOrigin: boolean;
  dead: boolean;
  ghost: boolean;
  accent: boolean;
  heavyAccent: boolean;
  staccato: boolean;
  palmMute: boolean;
  letRing: boolean;
  hammer: boolean; // hammer-on / pull-off to the next note on this string
  hammerDestination: boolean;
  vibrato: 'none' | 'slight' | 'wide';
  bend: BendPoint[] | null;
  slide: Slide | null;
  harmonic: HarmonicKind | null;
  harmonicFret: number;
  grace: Grace | null;
  trill: { fret: number; duration: number } | null;
  tremoloPicking: number | null; // ticks per repeated note
  tapped: boolean;
  durationPercent: number;
}

export function newBeat(partial: Partial<Beat> = {}): Beat {
  return {
    start: 0,
    duration: TICKS_PER_QUARTER,
    value: 4,
    dots: 0,
    tuplet: null,
    rest: false,
    notes: [],
    text: null,
    chord: null,
    vibrato: 'none',
    tremoloBar: null,
    fadeIn: false,
    stroke: 'none',
    slap: 'none',
    pickStroke: 'none',
    hairpin: null,
    ...partial,
  };
}

export function newNote(partial: Partial<Note> = {}): Note {
  return {
    string: 0,
    fret: 0,
    midi: null,
    velocity: 95,
    tieDestination: false,
    tieOrigin: false,
    dead: false,
    ghost: false,
    accent: false,
    heavyAccent: false,
    staccato: false,
    palmMute: false,
    letRing: false,
    hammer: false,
    hammerDestination: false,
    vibrato: 'none',
    bend: null,
    slide: null,
    harmonic: null,
    harmonicFret: 0,
    grace: null,
    trill: null,
    tremoloPicking: null,
    tapped: false,
    durationPercent: 1,
    ...partial,
  };
}

export function newSlide(partial: Partial<Slide> = {}): Slide {
  return { shift: false, legato: false, outDown: false, outUp: false, inBelow: false, inAbove: false, ...partial };
}

export function beatTicks(value: DurationValue, dots: number, tuplet: Tuplet | null): number {
  let ticks = (TICKS_PER_QUARTER * 4) / value;
  let add = ticks / 2;
  for (let i = 0; i < dots; i++) {
    ticks += add;
    add /= 2;
  }
  if (tuplet && tuplet.enters > 0) ticks = (ticks * tuplet.times) / tuplet.enters;
  return Math.round(ticks);
}

export const DYNAMIC_LEVELS: { name: string; velocity: number }[] = [
  { name: 'ppp', velocity: 15 },
  { name: 'pp', velocity: 31 },
  { name: 'p', velocity: 47 },
  { name: 'mp', velocity: 63 },
  { name: 'mf', velocity: 79 },
  { name: 'f', velocity: 95 },
  { name: 'ff', velocity: 111 },
  { name: 'fff', velocity: 127 },
];

export function dynamicName(velocity: number): string {
  let best = DYNAMIC_LEVELS[0];
  for (const d of DYNAMIC_LEVELS) if (Math.abs(d.velocity - velocity) < Math.abs(best.velocity - velocity)) best = d;
  return best.name;
}

export function measureTicks(numerator: number, denominator: number): number {
  return Math.round((TICKS_PER_QUARTER * 4 * numerator) / denominator);
}

// Pitch a note sounds at, before effects such as harmonics or bends.
export function notePitch(track: Track, note: Note): number {
  if (note.midi !== null) return note.midi;
  return (track.tuning[note.string] ?? 0) + track.capo + note.fret;
}
