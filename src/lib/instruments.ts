// General MIDI program families, used to label and colour tracks.
const FAMILIES: [number, string, string][] = [
  [0, 'Piano', 'keys'],
  [8, 'Chromatic perc.', 'keys'],
  [16, 'Organ', 'keys'],
  [24, 'Acoustic guitar', 'guitar'],
  [26, 'Electric guitar', 'guitar'],
  [29, 'Distorted guitar', 'guitar'],
  [32, 'Bass', 'bass'],
  [40, 'Strings', 'strings'],
  [48, 'Ensemble', 'strings'],
  [56, 'Brass', 'wind'],
  [64, 'Reed', 'wind'],
  [72, 'Pipe', 'wind'],
  [80, 'Synth lead', 'synth'],
  [88, 'Synth pad', 'synth'],
  [96, 'Synth FX', 'synth'],
  [104, 'Ethnic', 'strings'],
  [112, 'Percussive', 'drums'],
  [120, 'Sound FX', 'synth'],
];

export type InstrumentKind = 'guitar' | 'bass' | 'drums' | 'keys' | 'strings' | 'wind' | 'synth';

export function instrumentOf(program: number, isPercussion: boolean): { family: string; kind: InstrumentKind } {
  if (isPercussion) return { family: 'Drums', kind: 'drums' };
  let match = FAMILIES[0];
  for (const f of FAMILIES) if (program >= f[0]) match = f;
  return { family: match[1], kind: match[2] as InstrumentKind };
}

export const KIND_ICON: Record<InstrumentKind, string> = {
  guitar: 'M14.5 3.5l6 6-2 2-1-1-4.6 4.6a4 4 0 01-1.4 4.4 4.5 4.5 0 01-6.5-.6 4.5 4.5 0 01-.6-6.5 4 4 0 014.4-1.4l4.6-4.6-1-1z',
  bass: 'M15 2l7 7-2 2-1.5-1.5-4 4a4.5 4.5 0 01-1 5.2 5 5 0 01-7-.3 5 5 0 01-.3-7 4.5 4.5 0 015.2-1l4-4L14 4z',
  drums: 'M12 6c5 0 8 1.5 8 3.5v6C20 17.5 17 19 12 19s-8-1.5-8-3.5v-6C4 7.5 7 6 12 6zm0 2c-3.6 0-6 1-6 1.5S8.4 11 12 11s6-1 6-1.5S15.6 8 12 8z',
  keys: 'M3 5h18v14H3zM7 5v8M11 5v8M15 5v8M19 5v8',
  strings: 'M12 2c2 3 3 6 3 9a3 3 0 01-6 0c0-3 1-6 3-9zM12 14v8',
  wind: 'M4 10h11l5-4v12l-5-4H4z',
  synth: 'M3 6h18v12H3zM7 10v4M11 9v6M15 11v2M19 10v4',
};

export const KIND_COLOR: Record<InstrumentKind, string> = {
  guitar: '#f0743e',
  bass: '#2f9e6f',
  drums: '#7a5af5',
  keys: '#2b88d8',
  strings: '#c9488a',
  wind: '#c99a15',
  synth: '#14a3b8',
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi: number, withOctave = false): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

// General MIDI program names (0-127).
export const GM_NAMES = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdrive Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Square Lead', 'Sawtooth Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifths Lead', 'Bass + Lead',
  'New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad',
  'Rain', 'Soundtrack', 'Crystal', 'Atmosphere', 'Brightness', 'Goblins', 'Echoes', 'Sci-fi',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

// Common picks for the instrument picker, grouped.
export const INSTRUMENT_GROUPS: { label: string; programs: number[] }[] = [
  { label: 'Guitar', programs: [24, 25, 26, 27, 28, 29, 30, 31] },
  { label: 'Bass', programs: [32, 33, 34, 35, 36, 37, 38] },
  { label: 'Keys', programs: [0, 1, 2, 4, 5, 6, 7, 16, 17, 18, 19] },
  { label: 'Strings & more', programs: [40, 41, 42, 48, 52, 56, 61, 65, 66, 73, 80, 81, 89, 104, 105] },
];

export const TUNING_PRESETS: { label: string; strings: number[] }[] = [
  { label: 'Guitar · Standard (E A D G B E)', strings: [64, 59, 55, 50, 45, 40] },
  { label: 'Guitar · Drop D', strings: [64, 59, 55, 50, 45, 38] },
  { label: 'Guitar · Half step down', strings: [63, 58, 54, 49, 44, 39] },
  { label: 'Guitar · Drop C', strings: [62, 57, 53, 48, 43, 36] },
  { label: 'Guitar · Open G', strings: [62, 59, 55, 50, 43, 38] },
  { label: 'Guitar · DADGAD', strings: [62, 57, 55, 50, 45, 38] },
  { label: 'Guitar · 7-string (B)', strings: [64, 59, 55, 50, 45, 40, 35] },
  { label: 'Bass · Standard (E A D G)', strings: [43, 38, 33, 28] },
  { label: 'Bass · Drop D', strings: [43, 38, 33, 26] },
  { label: 'Bass · 5-string (B)', strings: [43, 38, 33, 28, 23] },
  { label: 'Ukulele · G C E A', strings: [69, 64, 60, 67] },
];
