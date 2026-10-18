// GPIF reader: the XML score format inside Guitar Pro 6 (.gpx) and 7/8 (.gp) files.
import { child, children, parseXml, path, text, type XmlNode } from './xml';
import {
  beatTicks,
  measureTicks,
  newBeat,
  newNote,
  newSlide,
  type Beat,
  type BendPoint,
  type DurationValue,
  type HarmonicKind,
  type MeasureHeader,
  type Note,
  type Song,
  type Track,
  type Tuplet,
} from '../model';

const NOTE_VALUES: Record<string, DurationValue> = {
  Whole: 1,
  Half: 2,
  Quarter: 4,
  Eighth: 8,
  '16th': 16,
  '32nd': 32,
  '64th': 64,
  '128th': 128,
};

const DYNAMICS: Record<string, number> = { PPP: 15, PP: 31, P: 47, MP: 63, MF: 79, F: 95, FF: 111, FFF: 127 };

const TRACK_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#f08c00', '#0c8599', '#c2255c', '#5f3dc4'];

// GP6 drum kit: element index -> MIDI key per variation.
const GP6_DRUMS: number[][] = [
  [36, 36, 36], // kick
  [38, 40, 37], // snare: hit, rim shot, side stick
  [56, 56, 56], // cowbell low
  [56, 56, 56], // cowbell medium
  [56, 56, 56], // cowbell high
  [41, 41, 41], // tom very low
  [43, 43, 43], // tom low
  [45, 45, 45], // tom medium
  [48, 48, 48], // tom high
  [50, 50, 50], // tom very high
  [42, 42, 46], // hi-hat: closed, half, open
  [44, 44, 44], // pedal hi-hat
  [57, 57, 57], // crash medium
  [49, 49, 49], // crash high
  [55, 55, 55], // splash
  [51, 59, 53], // ride: middle, edge, bell
  [52, 52, 52], // china
];

const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];

interface RawTrack {
  track: Track;
  drumMap: number[]; // GP7 InstrumentArticulation index -> MIDI key
}

function ids(s: string): number[] {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}

function byId(list: XmlNode | undefined, name: string): Map<string, XmlNode> {
  const map = new Map<string, XmlNode>();
  for (const n of children(list, name)) map.set(n.attrs.id, n);
  return map;
}

function properties(node: XmlNode | undefined): Map<string, XmlNode> {
  const map = new Map<string, XmlNode>();
  for (const p of children(child(node, 'Properties'), 'Property')) map.set(p.attrs.name, p);
  return map;
}

function propValue(props: Map<string, XmlNode>, name: string, field: string): string | null {
  const p = props.get(name);
  if (!p) return null;
  const f = child(p, field);
  return f ? text(f) : null;
}

export function parseGpif(xml: string): Song {
  const root = parseXml(xml);
  if (root.name !== 'GPIF') throw new Error('Not a GPIF document');

  const score = child(root, 'Score');
  const song: Song = {
    title: text(child(score, 'Title')),
    subtitle: text(child(score, 'SubTitle')),
    artist: text(child(score, 'Artist')),
    album: text(child(score, 'Album')),
    music: text(child(score, 'Music')),
    words: text(child(score, 'Words')),
    tabber: text(child(score, 'Tabber')),
    tempo: 120,
    measures: [],
    tracks: [],
    tempoChanges: [],
  };

  const masterBarNodes = children(child(root, 'MasterBars'), 'MasterBar');
  const bars = byId(child(root, 'Bars'), 'Bar');
  const voices = byId(child(root, 'Voices'), 'Voice');
  const beats = byId(child(root, 'Beats'), 'Beat');
  const notes = byId(child(root, 'Notes'), 'Note');
  const rhythms = byId(child(root, 'Rhythms'), 'Rhythm');

  // Measure headers.
  let start = 0;
  let numerator = 4;
  let denominator = 4;
  masterBarNodes.forEach((mb, index) => {
    const time = text(child(mb, 'Time'));
    if (time) [numerator, denominator] = time.split('/').map(Number);
    const repeat = child(mb, 'Repeat');
    const endings = text(child(mb, 'AlternateEndings'));
    let alternateEndings = 0;
    for (const e of ids(endings)) alternateEndings |= 1 << (e - 1);
    const section = child(mb, 'Section');
    const marker = section ? text(child(section, 'Text')) || text(child(section, 'Letter')) : '';
    const feel = text(child(mb, 'TripletFeel'));
    const length = measureTicks(numerator, denominator);
    const header: MeasureHeader = {
      index,
      numerator,
      denominator,
      start,
      length,
      repeatOpen: repeat?.attrs.start === 'true',
      repeatClose: repeat?.attrs.end === 'true' ? Math.max(2, Number(repeat.attrs.count) || 2) : 0,
      alternateEndings,
      marker: marker || null,
      doubleBar: !!child(mb, 'DoubleBar'),
      tripletFeel: feel.startsWith('Triplet8') ? 'eighth' : feel.startsWith('Triplet16') ? 'sixteenth' : 'none',
      keySignature: Number(text(path(mb, 'Key', 'AccidentalCount'))) || 0,
    };
    song.measures.push(header);
    start += length;
  });

  // Tempo automations.
  for (const a of children(path(root, 'MasterTrack', 'Automations'), 'Automation')) {
    if (text(child(a, 'Type')) !== 'Tempo') continue;
    const bar = Number(text(child(a, 'Bar'))) || 0;
    const position = Number(text(child(a, 'Position'))) || 0;
    const [value, unit] = text(child(a, 'Value')).split(/\s+/).map(Number);
    // GP7 tempo reference: 1 eighth, 2 quarter, 3 dotted quarter, 4 half, 5 dotted half.
    const factor = { 1: 0.5, 2: 1, 3: 1.5, 4: 2, 5: 3 }[unit] ?? 1;
    const bpm = value * factor;
    if (!bpm || !song.measures[bar]) continue;
    const tick = Math.round((position <= 1 ? position : 0) * song.measures[bar].length);
    if (bar === 0 && tick === 0) song.tempo = bpm;
    else song.tempoChanges.push({ measure: bar, tick, bpm });
  }

  // Tracks, ordered as the master track lists them.
  const trackNodes = byId(child(root, 'Tracks'), 'Track');
  const order = ids(text(path(root, 'MasterTrack', 'Tracks')));
  const orderedIds = order.length ? order.map(String) : [...trackNodes.keys()];
  const raw: RawTrack[] = orderedIds.map((id, index) => readTrack(trackNodes.get(id)!, index));
  song.tracks = raw.map((r) => r.track);

  // Bars -> voices -> beats -> notes.
  masterBarNodes.forEach((mb, mIndex) => {
    const barIds = ids(text(child(mb, 'Bars')));
    raw.forEach((rt, tIndex) => {
      const barNode = bars.get(String(barIds[tIndex]));
      const voiceIds = barNode ? ids(text(child(barNode, 'Voices'))) : [];
      const measureVoices = voiceIds
        .filter((v) => v >= 0)
        .slice(0, 2)
        .map((v) => ({ beats: readVoice(voices.get(String(v)), beats, notes, rhythms, rt) }));
      if (measureVoices.length === 0) measureVoices.push({ beats: [] });
      if (measureVoices[0].beats.length === 0) {
        const header = song.measures[mIndex];
        measureVoices[0].beats.push(newBeat({ rest: true, value: 1, duration: header.length }));
      }
      rt.track.measures.push({ voices: measureVoices });
    });
  });
  return song;
}

function readTrack(node: XmlNode, index: number): RawTrack {
  const iset = child(node, 'InstrumentSet');
  const gm = child(node, 'GeneralMidi');
  const midiConn = child(node, 'MidiConnection');
  const channel = Number(text(child(midiConn ?? gm, 'PrimaryChannel')) || -1);
  const isPercussion =
    text(child(iset, 'Type')) === 'drumKit' ||
    gm?.attrs.table === 'Percussion' ||
    (child(node, 'Instrument')?.attrs.ref ?? '').startsWith('drmkt') ||
    channel === 9;

  // GP7 tracks list their sounds; automations switch between them partway through.
  const sounds = children(child(node, 'Sounds'), 'Sound').map((s) => ({
    name: text(child(s, 'Name')),
    path: text(child(s, 'Path')),
    program: Number(text(path(s, 'MIDI', 'Program')) || 0),
  }));
  const program = sounds[0]?.program ?? Number(text(child(gm, 'Program')) || 0);
  const instrumentChanges: { measure: number; tick: number; program: number }[] = [];
  for (const a of children(child(node, 'Automations'), 'Automation')) {
    const type = text(child(a, 'Type'));
    const value = text(child(a, 'Value'));
    let changeTo: number | undefined;
    if (type === 'Sound') {
      const [soundPath, soundName] = value.split(';');
      changeTo = sounds.find((s) => (soundPath && s.path === soundPath) || (soundName && s.name === soundName))?.program;
    } else if (type === 'Instrument') {
      changeTo = Number(value);
    }
    if (changeTo === undefined || Number.isNaN(changeTo)) continue;
    const measure = Number(text(child(a, 'Bar'))) || 0;
    if (measure === 0 && (Number(text(child(a, 'Position'))) || 0) === 0) continue; // initial sound
    instrumentChanges.push({ measure, tick: 0, program: changeTo });
  }

  // GP7 keeps tuning on the staff, GP6 on the track.
  const staffProps = properties(path(node, 'Staves', 'Staff'));
  const trackProps = properties(node);
  const pitches = propValue(staffProps, 'Tuning', 'Pitches') ?? propValue(trackProps, 'Tuning', 'Pitches');
  const capo = Number(propValue(staffProps, 'CapoFret', 'Fret') ?? propValue(trackProps, 'CapoFret', 'Fret') ?? 0);
  const tuning = pitches ? ids(pitches).reverse() : isPercussion ? [] : STANDARD_TUNING;

  const drumMap: number[] = [];
  for (const el of children(child(iset, 'Elements'), 'Element')) {
    for (const art of children(child(el, 'Articulations'), 'Articulation')) {
      drumMap.push(Number(text(child(art, 'OutputMidiNumber'))) || 38);
    }
  }

  return {
    track: {
      index,
      name: text(child(node, 'Name')) || `Track ${index + 1}`,
      program: isPercussion ? 0 : program,
      isPercussion,
      tuning,
      capo: isPercussion ? 0 : capo,
      fretCount: 24,
      color: TRACK_COLORS[index % TRACK_COLORS.length],
      volume: 0.8,
      pan: 0,
      instrumentChanges: isPercussion ? [] : instrumentChanges,
      measures: [],
    },
    drumMap,
  };
}

function readVoice(
  voice: XmlNode | undefined,
  beatNodes: Map<string, XmlNode>,
  noteNodes: Map<string, XmlNode>,
  rhythms: Map<string, XmlNode>,
  rt: RawTrack,
): Beat[] {
  if (!voice) return [];
  const out: Beat[] = [];
  let start = 0;
  let pendingGrace: Note[] = [];

  for (const id of ids(text(child(voice, 'Beats')))) {
    const node = beatNodes.get(String(id));
    if (!node) continue;
    const rhythm = rhythms.get(child(node, 'Rhythm')?.attrs.ref ?? '');
    const value = NOTE_VALUES[text(child(rhythm, 'NoteValue'))] ?? 4;
    const dots = Number(child(rhythm, 'AugmentationDot')?.attrs.count ?? 0);
    const tupletNode = child(rhythm, 'PrimaryTuplet');
    const tuplet: Tuplet | null = tupletNode ? { enters: Number(tupletNode.attrs.num), times: Number(tupletNode.attrs.den) } : null;
    const duration = beatTicks(value, dots, tuplet);

    const velocity = DYNAMICS[text(child(node, 'Dynamic'))] ?? 95;
    const beatNotes = ids(text(child(node, 'Notes')))
      .map((n) => noteNodes.get(String(n)))
      .filter((n): n is XmlNode => !!n)
      .map((n) => readNote(n, rt, velocity));

    // Grace beats take no time; attach them to the next real beat.
    if (child(node, 'GraceNotes')) {
      const onBeat = text(child(node, 'GraceNotes')) === 'OnBeat';
      pendingGrace = beatNotes.map((n) => ({ ...n, grace: { fret: n.fret, duration, dead: n.dead, onBeat, transition: 'none' } }));
      continue;
    }

    const beat = newBeat({ start, value, dots, tuplet, duration, rest: beatNotes.length === 0, notes: beatNotes });
    const freeText = text(child(node, 'FreeText'));
    if (freeText) beat.text = freeText;
    if (text(child(node, 'Fadding')) === 'FadeIn') beat.fadeIn = true;
    const hairpin = (text(child(node, 'Hairpin')) || propValue(props0(node), 'Hairpin', 'Type') || '').toLowerCase();
    if (hairpin.startsWith('cresc')) beat.hairpin = 'cresc';
    else if (hairpin.startsWith('decresc') || hairpin.startsWith('dim')) beat.hairpin = 'dim';
    const tremolo = text(child(node, 'Tremolo'));
    if (tremolo) {
      const per = tremolo === '1/8' ? 480 : tremolo === '1/32' ? 120 : 240;
      for (const n of beat.notes) n.tremoloPicking = per;
    }
    const props = properties(node);
    const brush = propValue(props, 'Brush', 'Direction');
    if (brush) beat.stroke = brush === 'Up' ? 'up' : 'down';
    const arpeggio = text(child(node, 'Arpeggio'));
    if (arpeggio) beat.stroke = arpeggio === 'Up' ? 'up' : 'down';
    const pick = propValue(props, 'PickStroke', 'Direction');
    if (pick) beat.pickStroke = pick === 'Up' ? 'up' : 'down';
    if (props.has('Slapped')) beat.slap = 'slap';
    if (props.has('Popped')) beat.slap = 'pop';
    if (props.has('WhammyBar')) beat.tremoloBar = whammy(props);

    for (const g of pendingGrace) {
      const target = beat.notes.find((n) => (rt.track.isPercussion ? n.midi === g.midi : n.string === g.string)) ?? (rt.track.isPercussion ? beat.notes[0] : undefined);
      if (target) target.grace = g.grace;
    }
    pendingGrace = [];
    out.push(beat);
    start += duration;
  }
  return out;
}

function props0(node: XmlNode) {
  return properties(node);
}

function float(props: Map<string, XmlNode>, name: string): number | null {
  const v = propValue(props, name, 'Float');
  return v === null ? null : Number(v);
}

function whammy(props: Map<string, XmlNode>): BendPoint[] {
  const origin = float(props, 'WhammyBarOriginValue') ?? 0;
  const middle = float(props, 'WhammyBarMiddleValue');
  const dest = float(props, 'WhammyBarDestinationValue') ?? 0;
  const points: BendPoint[] = [{ position: (float(props, 'WhammyBarOriginOffset') ?? 0) / 100, value: origin / 50 }];
  if (middle !== null) points.push({ position: (float(props, 'WhammyBarMiddleOffset1') ?? 50) / 100, value: middle / 50 });
  points.push({ position: (float(props, 'WhammyBarDestinationOffset') ?? 100) / 100, value: dest / 50 });
  return points;
}

function readNote(node: XmlNode, rt: RawTrack, velocity: number): Note {
  const props = properties(node);
  const track = rt.track;
  const note = newNote({ velocity });

  const tie = child(node, 'Tie');
  if (tie) {
    note.tieOrigin = tie.attrs.origin === 'true';
    note.tieDestination = tie.attrs.destination === 'true';
  }
  const vibrato = text(child(node, 'Vibrato'));
  if (vibrato) note.vibrato = vibrato === 'Wide' ? 'wide' : 'slight';
  note.letRing = !!child(node, 'LetRing');
  note.ghost = !!child(node, 'AntiAccent');
  for (const accent of children(node, 'Accent')) {
    const flags = Number(text(accent));
    if (flags & 0x01) note.staccato = true;
    if (flags & 0x04) note.heavyAccent = true;
    if (flags & 0x08) note.accent = true;
  }
  const trill = text(child(node, 'Trill'));
  if (trill) note.trill = { fret: Number(trill), duration: 120 };

  if (track.isPercussion) {
    const articulation = text(child(node, 'InstrumentArticulation'));
    const midiProp = propValue(props, 'Midi', 'Number');
    const element = propValue(props, 'Element', 'Element');
    if (articulation && rt.drumMap.length) note.midi = rt.drumMap[Number(articulation)] ?? 38;
    else if (midiProp) note.midi = Number(midiProp);
    else if (element !== null) {
      const variation = Number(propValue(props, 'Variation', 'Variation') ?? 0);
      note.midi = GP6_DRUMS[Number(element)]?.[variation] ?? 38;
    } else note.midi = 38;
    note.fret = note.midi;
    return note;
  }

  const strings = track.tuning.length;
  const s = Number(propValue(props, 'String', 'String') ?? 0);
  note.string = Math.min(strings - 1, Math.max(0, strings - 1 - s));
  note.fret = Number(propValue(props, 'Fret', 'Fret') ?? 0);
  if (props.has('PalmMuted')) note.palmMute = true;
  if (props.has('Muted')) note.dead = true;
  if (props.has('HopoOrigin')) note.hammer = true;
  if (props.has('HopoDestination')) note.hammerDestination = true;
  if (props.has('Tapped') || props.has('LeftHandTapped')) note.tapped = true;

  const slideFlags = propValue(props, 'Slide', 'Flags');
  if (slideFlags !== null) {
    const f = Number(slideFlags);
    note.slide = newSlide({
      shift: (f & 0x01) !== 0,
      legato: (f & 0x02) !== 0,
      outDown: (f & 0x04) !== 0,
      outUp: (f & 0x08) !== 0,
      inBelow: (f & 0x10) !== 0,
      inAbove: (f & 0x20) !== 0,
    });
  }

  const htype = propValue(props, 'HarmonicType', 'HType');
  if (htype || props.has('Harmonic')) {
    const kind = (htype ?? 'Natural').toLowerCase();
    note.harmonic = (['natural', 'artificial', 'pinch', 'tapped', 'semi', 'feedback'].includes(kind) ? kind : 'natural') as HarmonicKind;
    note.harmonicFret = Number(propValue(props, 'HarmonicFret', 'HFret') ?? note.fret);
  }

  if (props.has('Bended')) {
    const origin = float(props, 'BendOriginValue') ?? 0;
    const middle = float(props, 'BendMiddleValue');
    const dest = float(props, 'BendDestinationValue') ?? 0;
    const points: BendPoint[] = [{ position: (float(props, 'BendOriginOffset') ?? 0) / 100, value: origin / 50 }];
    if (middle !== null) {
      points.push({ position: (float(props, 'BendMiddleOffset1') ?? 50) / 100, value: middle / 50 });
      const m2 = float(props, 'BendMiddleOffset2');
      if (m2 !== null) points.push({ position: m2 / 100, value: middle / 50 });
    }
    points.push({ position: (float(props, 'BendDestinationOffset') ?? 100) / 100, value: dest / 50 });
    note.bend = points;
  }
  return note;
}
