// Per-track tone: amp/pedal chain for guitar and bass, kit styling for drums.

export type ToneKind = 'guitar' | 'bass' | 'drums' | 'other';
export type DriveType = 'overdrive' | 'distortion' | 'fuzz';

export interface SoundSource {
  bank: number;
  program: number;
}

export interface Pedals {
  compressor: boolean;
  drive: boolean;
  driveType: DriveType;
  driveAmount: number; // 0..1
  chorus: boolean;
  chorusDepth: number; // 0..1
  delay: boolean;
  delayTime: number; // seconds
  delayFeedback: number; // 0..0.9
  delayMix: number; // 0..1
}

export type DrumPiece = 'kick' | 'snare' | 'hihat' | 'tomHigh' | 'tomMid' | 'tomFloor' | 'crash' | 'ride' | 'china' | 'splash' | 'perc';

export interface PieceSettings {
  volume: number; // 0..1.5
  tune: number; // semitones -12..12
  decay: number; // 0.2..2 (1 = natural)
  kit: number | null; // take this piece from another kit (bank 128 program), null = style kit
  sampleId: string | null; // user sample (e.g. from their own sample library)
  sampleName: string | null;
}

export interface ToneSettings {
  kind: ToneKind;
  preset: string;
  source: SoundSource | null; // null = instrument from the file
  gain: number; // amp gain 0..1
  tight: number; // 0..1 low cut before the amp
  bass: number; // dB -12..12
  mids: number;
  treble: number;
  presence: number;
  tone: number; // 0..1, high-cut brightness
  cabinet: boolean;
  reverb: number; // 0..1 send
  pedals: Pedals;
  // Drums
  kit: number; // bank 128 program
  pieces: Record<DrumPiece, PieceSettings>;
  punch: number; // 0..1 bus compression
}

export const DRUM_PIECES: { id: DrumPiece; name: string; keys: number[] }[] = [
  { id: 'kick', name: 'Kick', keys: [35, 36] },
  { id: 'snare', name: 'Snare', keys: [37, 38, 39, 40] },
  { id: 'hihat', name: 'Hi-hat', keys: [42, 44, 46] },
  { id: 'tomHigh', name: 'High tom', keys: [48, 50] },
  { id: 'tomMid', name: 'Mid tom', keys: [45, 47] },
  { id: 'tomFloor', name: 'Floor tom', keys: [41, 43] },
  { id: 'crash', name: 'Crash', keys: [49, 57] },
  { id: 'ride', name: 'Ride', keys: [51, 53, 59] },
  { id: 'china', name: 'China', keys: [52] },
  { id: 'splash', name: 'Splash', keys: [55] },
  { id: 'perc', name: 'Percussion', keys: [] },
];

export function pieceOf(key: number): DrumPiece {
  return DRUM_PIECES.find((p) => p.keys.includes(key))?.id ?? 'perc';
}

export const KITS: { program: number; name: string }[] = [
  { program: 0, name: 'Standard' },
  { program: 1, name: 'Standard 2' },
  { program: 2, name: 'Standard 3' },
  { program: 8, name: 'Room' },
  { program: 16, name: 'Power' },
  { program: 24, name: 'Electronic' },
  { program: 25, name: '808 / 909' },
  { program: 26, name: 'Dance' },
  { program: 32, name: 'Jazz' },
  { program: 40, name: 'Brush' },
  { program: 48, name: 'Orchestral' },
];

const piece = (p: Partial<PieceSettings> = {}): PieceSettings => ({ volume: 1, tune: 0, decay: 1, kit: null, sampleId: null, sampleName: null, ...p });

function defaultPieces(): Record<DrumPiece, PieceSettings> {
  return Object.fromEntries(DRUM_PIECES.map((p) => [p.id, piece()])) as Record<DrumPiece, PieceSettings>;
}

const NO_PEDALS: Pedals = {
  compressor: false,
  drive: false,
  driveType: 'overdrive',
  driveAmount: 0.5,
  chorus: false,
  chorusDepth: 0.4,
  delay: false,
  delayTime: 0.32,
  delayFeedback: 0.3,
  delayMix: 0.25,
};

export function defaultTone(kind: ToneKind): ToneSettings {
  return {
    kind,
    preset: 'original',
    source: null,
    gain: 0,
    tight: 0,
    bass: 0,
    mids: 0,
    treble: 0,
    presence: 0,
    tone: 1,
    cabinet: false,
    reverb: 0.15,
    pedals: { ...NO_PEDALS },
    kit: 0,
    pieces: defaultPieces(),
    punch: 0,
  };
}

export interface TonePreset {
  id: string;
  name: string;
  kind: ToneKind;
  blurb: string;
  apply: (base: ToneSettings) => ToneSettings;
}

const CLEAN = { bank: 0, program: 27 };
const g = (id: string, name: string, blurb: string, patch: Omit<Partial<ToneSettings>, 'pedals'> & { pedals?: Partial<Pedals> }): TonePreset => ({
  id,
  name,
  kind: 'guitar',
  blurb,
  apply: (b) => ({ ...b, cabinet: true, tone: 1, tight: 0, presence: 0, ...patch, preset: id, pedals: { ...NO_PEDALS, ...patch.pedals } }),
});
const bs = (id: string, name: string, blurb: string, patch: Omit<Partial<ToneSettings>, 'pedals'> & { pedals?: Partial<Pedals> }): TonePreset => ({
  id,
  name,
  kind: 'bass',
  blurb,
  apply: (b) => ({ ...b, cabinet: true, tone: 1, tight: 0, presence: 0, ...patch, preset: id, pedals: { ...NO_PEDALS, ...patch.pedals } }),
});
const d = (id: string, name: string, blurb: string, kit: number, punch: number, reverb: number, pieces: Partial<Record<DrumPiece, Partial<PieceSettings>>> = {}): TonePreset => ({
  id,
  name,
  kind: 'drums',
  blurb,
  apply: (b) => {
    const p = defaultPieces();
    for (const [k, v] of Object.entries(pieces)) p[k as DrumPiece] = piece(v);
    // Keep any samples the user loaded.
    for (const k of Object.keys(p) as DrumPiece[]) {
      if (b.pieces[k]?.sampleId) p[k] = { ...p[k], sampleId: b.pieces[k].sampleId, sampleName: b.pieces[k].sampleName };
    }
    return { ...b, preset: id, kit, punch, reverb, pieces: p, bass: 0, mids: 0, treble: 0 };
  },
});

export const PRESETS: TonePreset[] = [
  // Guitar
  { id: 'original', name: 'Original', kind: 'guitar', blurb: 'The sound saved in the file', apply: (b) => ({ ...defaultTone(b.kind), pieces: b.pieces, kind: b.kind }) },
  g('clean', 'Clean', 'Glassy clean amp with a touch of chorus', { source: CLEAN, gain: 0.05, bass: 1, treble: 2, reverb: 0.3, pedals: { chorus: true, chorusDepth: 0.3, compressor: true } }),
  g('pop', 'Pop', 'Bright, compressed and polished', { source: CLEAN, gain: 0.12, treble: 3, presence: 2, reverb: 0.22, pedals: { compressor: true, chorus: true, chorusDepth: 0.2 } }),
  g('poppunk', 'Pop-punk', 'Tight, bright crunch for fast power chords', { source: CLEAN, gain: 0.62, tight: 0.45, bass: 2, mids: 2, treble: 3, presence: 3, reverb: 0.1 }),
  g('punk', 'Punk', 'Raw, mid-heavy and loud', { source: CLEAN, gain: 0.68, tight: 0.25, bass: 1, mids: 5, treble: 2, reverb: 0.05 }),
  g('rock', 'Rock', 'Classic crunch with plenty of mids', { source: CLEAN, gain: 0.45, mids: 3, treble: 1, reverb: 0.15 }),
  g('classicrock', 'Classic rock', 'Overdrive pedal into a warm amp', { source: CLEAN, gain: 0.32, mids: 3, treble: -1, reverb: 0.22, pedals: { drive: true, driveType: 'overdrive', driveAmount: 0.45 } }),
  g('hardrock', 'Hard rock', 'Saturated and punchy', { source: CLEAN, gain: 0.72, tight: 0.3, bass: 2, mids: 2, treble: 2, presence: 2, reverb: 0.12 }),
  g('metal', 'Metal', 'High gain, scooped mids, tight low end', { source: CLEAN, gain: 0.9, tight: 0.7, bass: 4, mids: -5, treble: 4, presence: 4, reverb: 0.08, pedals: { drive: true, driveType: 'overdrive', driveAmount: 0.3, compressor: true } }),
  g('djent', 'Djent', 'Very tight, percussive high gain', { source: CLEAN, gain: 0.95, tight: 1, bass: 2, mids: -2, treble: 3, presence: 6, reverb: 0.05, pedals: { drive: true, driveType: 'overdrive', driveAmount: 0.2, compressor: true } }),
  g('grunge', 'Grunge', 'Fuzzy, thick and dark', { source: CLEAN, gain: 0.5, bass: 3, mids: -1, treble: -2, reverb: 0.12, pedals: { drive: true, driveType: 'fuzz', driveAmount: 0.6 } }),
  g('alt', 'Alternative', 'Driven with a slapback delay', { source: CLEAN, gain: 0.5, mids: 1, treble: 2, reverb: 0.18, pedals: { delay: true, delayTime: 0.12, delayFeedback: 0.15, delayMix: 0.2 } }),
  g('blues', 'Blues', 'Warm edge-of-breakup overdrive', { source: CLEAN, gain: 0.25, mids: 3, treble: 1, reverb: 0.3, pedals: { drive: true, driveType: 'overdrive', driveAmount: 0.35 } }),
  g('indie', 'Indie', 'Jangly with chorus and echoes', { source: CLEAN, gain: 0.18, treble: 3, reverb: 0.35, pedals: { chorus: true, chorusDepth: 0.45, delay: true, delayTime: 0.36, delayFeedback: 0.3, delayMix: 0.22 } }),
  g('shoegaze', 'Shoegaze', 'Wall of fuzz, chorus and big ambience', { source: CLEAN, gain: 0.35, tone: 0.75, reverb: 0.7, pedals: { drive: true, driveType: 'fuzz', driveAmount: 0.7, chorus: true, chorusDepth: 0.6, delay: true, delayTime: 0.42, delayFeedback: 0.5, delayMix: 0.35 } }),
  g('funk', 'Funk', 'Snappy, compressed single-coil', { source: { bank: 8, program: 28 }, gain: 0.05, treble: 4, mids: 1, reverb: 0.1, pedals: { compressor: true } }),
  g('jazz', 'Jazz', 'Warm hollow-body, rolled-off highs', { source: { bank: 0, program: 26 }, gain: 0, bass: 2, treble: -4, tone: 0.55, reverb: 0.25 }),
  g('country', 'Country', 'Twangy, compressed with slapback', { source: CLEAN, gain: 0.08, treble: 5, mids: -1, reverb: 0.15, pedals: { compressor: true, delay: true, delayTime: 0.11, delayFeedback: 0.1, delayMix: 0.25 } }),
  g('acoustic', 'Acoustic', 'Steel-string acoustic', { source: { bank: 0, program: 25 }, cabinet: false, gain: 0, reverb: 0.25 }),
  g('nylon', 'Nylon', 'Classical nylon-string', { source: { bank: 0, program: 24 }, cabinet: false, gain: 0, reverb: 0.3 }),
  g('twelve', '12-string', 'Shimmering 12-string acoustic', { source: { bank: 8, program: 25 }, cabinet: false, gain: 0, reverb: 0.3 }),
  // Bass
  { id: 'original', name: 'Original', kind: 'bass', blurb: 'The sound saved in the file', apply: () => ({ ...defaultTone('bass'), kind: 'bass' }) },
  bs('finger', 'Finger', 'Round, warm fingerstyle', { source: { bank: 0, program: 33 }, bass: 3, mids: 1, treble: -2, pedals: { compressor: true } }),
  bs('pick', 'Pick', 'Punchy pick attack', { source: { bank: 0, program: 34 }, bass: 2, mids: 3, treble: 2, pedals: { compressor: true } }),
  bs('punkbass', 'Punk', 'Gritty pick with grind', { source: { bank: 0, program: 34 }, gain: 0.3, bass: 2, mids: 4, treble: 3, pedals: { compressor: true } }),
  bs('metalbass', 'Metal', 'Tight growl under heavy guitars', { source: { bank: 0, program: 34 }, gain: 0.5, tight: 0.3, bass: 3, mids: 2, treble: 4, presence: 3, pedals: { compressor: true } }),
  bs('popbass', 'Pop', 'Smooth and even', { source: { bank: 0, program: 33 }, bass: 2, treble: 1, pedals: { compressor: true } }),
  bs('slap', 'Slap / funk', 'Bright slap tone', { source: { bank: 0, program: 36 }, bass: 3, mids: -3, treble: 4, pedals: { compressor: true } }),
  bs('fretless', 'Fretless', 'Singing fretless', { source: { bank: 0, program: 35 }, bass: 2, treble: -1 }),
  bs('dub', 'Dub / reggae', 'Deep sub, dark top', { source: { bank: 0, program: 33 }, bass: 6, mids: -2, treble: -7, tone: 0.5 }),
  bs('synthbass', 'Synth', 'Synth bass', { source: { bank: 0, program: 38 }, cabinet: false, bass: 2 }),
  // Drums
  d('original', 'Original', 'Standard kit, no processing', 0, 0, 0.15),
  d('rock', 'Rock', 'Big open kit', 1, 0.45, 0.2, { kick: { volume: 1.1 }, snare: { volume: 1.05 } }),
  d('punk', 'Punk', 'Fast, bright and trashy', 8, 0.55, 0.12, { snare: { tune: 1, volume: 1.1 }, crash: { volume: 1.1 }, kick: { decay: 0.8 } }),
  d('poppunk', 'Pop-punk', 'Tight kick, cracking snare', 16, 0.6, 0.12, { kick: { volume: 1.15, decay: 0.7 }, snare: { tune: 1, volume: 1.15 } }),
  d('pop', 'Pop', 'Polished and controlled', 2, 0.5, 0.18, { hihat: { volume: 0.85 } }),
  d('metal', 'Metal', 'Clicky kick, tight toms, heavy compression', 16, 0.75, 0.08, { kick: { volume: 1.3, decay: 0.55, tune: 1 }, snare: { volume: 1.1, decay: 0.8 }, tomFloor: { decay: 0.8 }, tomMid: { decay: 0.8 }, tomHigh: { decay: 0.8 } }),
  d('indie', 'Indie', 'Roomy and natural', 8, 0.3, 0.3),
  d('funk', 'Funk', 'Dry and snappy', 8, 0.4, 0.06, { snare: { tune: 2, decay: 0.7 }, kick: { decay: 0.7 } }),
  d('jazz', 'Jazz', 'Jazz kit with sizzle', 32, 0.1, 0.25),
  d('brush', 'Brushes', 'Soft brush kit', 40, 0.1, 0.25),
  d('electronic', 'Electronic', 'Electronic kit', 24, 0.4, 0.12),
  d('808', '808 / Trap', 'Booming 808 / 909', 25, 0.4, 0.08, { kick: { volume: 1.2, decay: 1.4 } }),
  d('dance', 'Dance', 'Four-on-the-floor dance kit', 26, 0.5, 0.12),
  d('lofi', 'Lo-fi', 'Muffled, small and dusty', 8, 0.3, 0.2, { snare: { tune: -1 }, kick: { tune: -1 } }),
];

export function presetsFor(kind: ToneKind): TonePreset[] {
  const k = kind === 'other' ? 'guitar' : kind;
  return PRESETS.filter((p) => p.kind === k);
}

export function toneKindOf(program: number, isPercussion: boolean): ToneKind {
  if (isPercussion) return 'drums';
  if (program >= 24 && program <= 31) return 'guitar';
  if (program >= 32 && program <= 39) return 'bass';
  return 'other';
}

// ---------------------------------------------------------------------------------
// Audio graph

function driveCurve(type: DriveType | 'amp', amount: number): Float32Array {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + amount * (type === 'fuzz' ? 60 : type === 'distortion' ? 45 : type === 'amp' ? 80 : 18);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y: number;
    if (type === 'overdrive') y = Math.tanh(k * x) / Math.tanh(k);
    else if (type === 'distortion') y = Math.sign(x) * (1 - Math.exp(-k * Math.abs(x))) / (1 - Math.exp(-k));
    else if (type === 'fuzz') y = x >= 0 ? Math.tanh(k * x) : Math.tanh(k * 0.55 * x) * 0.85; // asymmetric
    else y = (2 / Math.PI) * Math.atan(k * x) / ((2 / Math.PI) * Math.atan(k));
    curve[i] = y;
  }
  return curve;
}

// Per-track effects chain. Sits between the voices and the track's volume/pan.
export class ToneChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private nodes: AudioNode[] = [];
  private lfos: OscillatorNode[] = [];
  private reverbSend: GainNode;
  private signature = '';
  private params: {
    preAmp?: GainNode;
    ampShaper?: WaveShaperNode;
    ampPost?: GainNode;
    tight?: BiquadFilterNode;
    bass?: BiquadFilterNode;
    mids?: BiquadFilterNode;
    treble?: BiquadFilterNode;
    presence?: BiquadFilterNode;
    tone?: BiquadFilterNode;
    drivePre?: GainNode;
    driveShaper?: WaveShaperNode;
    chorusDepth?: GainNode;
    delay?: DelayNode;
    feedback?: GainNode;
    delayMix?: GainNode;
    comp?: DynamicsCompressorNode;
  } = {};

  constructor(private ctx: AudioContext, reverbBus: AudioNode) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(reverbBus);
    this.input.connect(this.output);
  }

  // Structural changes rebuild the graph; knob moves only update parameters.
  apply(s: ToneSettings) {
    const p = s.pedals;
    const signature = [s.kind, s.cabinet, s.gain > 0.01, p.compressor, p.drive, p.driveType, p.chorus, p.delay, s.punch > 0.01].join('|');
    if (signature !== this.signature) this.rebuild(s);
    this.signature = signature;
    this.update(s);
  }

  private teardown() {
    this.input.disconnect();
    for (const n of this.nodes) n.disconnect();
    for (const l of this.lfos) l.stop();
    this.nodes = [];
    this.lfos = [];
    this.params = {};
  }

  private rebuild(s: ToneSettings) {
    const ctx = this.ctx;
    this.teardown();
    const chain: AudioNode[] = [];
    const add = <T extends AudioNode>(n: T) => {
      chain.push(n);
      this.nodes.push(n);
      return n;
    };
    const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const p = s.pedals;

    if (s.kind === 'drums') {
      if (s.punch > 0.01) this.params.comp = add(ctx.createDynamicsCompressor());
      this.params.bass = add(filter('lowshelf', 90));
      this.params.mids = add(filter('peaking', 900, 0.8));
      this.params.treble = add(filter('highshelf', 5000));
    } else {
      if (p.compressor) this.params.comp = add(ctx.createDynamicsCompressor());
      if (p.drive) {
        this.params.drivePre = add(ctx.createGain());
        this.params.driveShaper = add(ctx.createWaveShaper());
        this.params.driveShaper.oversample = '4x';
        add(filter('lowpass', p.driveType === 'fuzz' ? 4200 : 6000));
      }
      if (s.gain > 0.01) {
        this.params.tight = add(filter('highpass', 40));
        this.params.preAmp = add(ctx.createGain());
        this.params.ampShaper = add(ctx.createWaveShaper());
        this.params.ampShaper.oversample = '4x';
        this.params.ampPost = add(ctx.createGain());
      }
      this.params.bass = add(filter('lowshelf', s.kind === 'bass' ? 80 : 120));
      this.params.mids = add(filter('peaking', s.kind === 'bass' ? 600 : 750, 0.9));
      this.params.treble = add(filter('highshelf', s.kind === 'bass' ? 2500 : 3200));
      this.params.presence = add(filter('peaking', 4500, 1.2));
      this.params.tone = add(filter('lowpass', 18000, 0.5));
      if (s.cabinet) {
        // Speaker cabinet: band-limit like a guitar/bass speaker.
        add(filter('highpass', s.kind === 'bass' ? 35 : 75));
        add(filter('peaking', s.kind === 'bass' ? 120 : 2200, 1)).gain.value = 3;
        add(filter('lowpass', s.kind === 'bass' ? 4500 : 5600, 0.9));
        add(filter('lowpass', s.kind === 'bass' ? 6000 : 7200, 0.7));
      }
    }

    // Wire the serial part.
    let head: AudioNode = this.input;
    for (const n of chain) {
      head.connect(n);
      head = n;
    }

    // Parallel modulation and time effects, mixed back in.
    const dry = ctx.createGain();
    this.nodes.push(dry);
    head.connect(dry).connect(this.output);
    if (p.chorus && s.kind !== 'drums') {
      const delay = ctx.createDelay(0.05);
      delay.delayTime.value = 0.014;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.9;
      const depth = ctx.createGain();
      lfo.connect(depth).connect(delay.delayTime);
      lfo.start();
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      head.connect(delay).connect(wet).connect(this.output);
      this.nodes.push(delay, depth, wet);
      this.lfos.push(lfo);
      this.params.chorusDepth = depth;
    }
    if (p.delay && s.kind !== 'drums') {
      const delay = ctx.createDelay(2);
      const feedback = ctx.createGain();
      const mix = ctx.createGain();
      const damp = filter('lowpass', 3500);
      head.connect(delay);
      delay.connect(damp).connect(feedback).connect(delay);
      delay.connect(mix).connect(this.output);
      this.nodes.push(delay, feedback, mix, damp);
      Object.assign(this.params, { delay, feedback, delayMix: mix });
    }
    head.connect(this.reverbSend);
    this.nodes.push(head);
  }

  private update(s: ToneSettings) {
    const t = this.ctx.currentTime;
    const set = (param: AudioParam | undefined, v: number) => param?.setTargetAtTime(v, t, 0.02);
    const p = s.pedals;
    const P = this.params;
    if (P.comp) {
      const strength = s.kind === 'drums' ? s.punch : 0.6;
      P.comp.threshold.value = -10 - strength * 18;
      P.comp.ratio.value = 2 + strength * 6;
      P.comp.attack.value = s.kind === 'drums' ? 0.01 : 0.004;
      P.comp.release.value = 0.15;
    }
    if (P.driveShaper && P.drivePre) {
      P.driveShaper.curve = driveCurve(p.driveType, p.driveAmount);
      P.drivePre.gain.value = 1 + p.driveAmount * 2;
    }
    if (P.ampShaper && P.preAmp && P.ampPost && P.tight) {
      P.ampShaper.curve = driveCurve('amp', s.gain);
      set(P.preAmp.gain, 1 + s.gain * 6);
      set(P.ampPost.gain, 0.9 - s.gain * 0.45); // keep loudness roughly level
      set(P.tight.frequency, 40 + s.tight * 260);
    }
    set(P.bass?.gain, s.bass);
    set(P.mids?.gain, s.mids);
    set(P.treble?.gain, s.treble);
    set(P.presence?.gain, s.presence);
    set(P.tone?.frequency, 1200 * Math.pow(15, Math.max(0, Math.min(1, s.tone))));
    set(P.chorusDepth?.gain, 0.001 + p.chorusDepth * 0.005);
    set(P.delay?.delayTime, p.delayTime);
    set(P.feedback?.gain, Math.min(0.9, p.delayFeedback));
    set(P.delayMix?.gain, p.delayMix);
    set(this.reverbSend.gain, s.reverb * 0.9);
  }

  dispose() {
    this.teardown();
    this.reverbSend.disconnect();
    this.output.disconnect();
  }
}
