// SoundFont 2 reader: turns presets into flat lists of playable sample regions.

export interface Region {
  keyLo: number;
  keyHi: number;
  velLo: number;
  velHi: number;
  start: number; // sample frame offsets into SoundFont.samples
  end: number;
  loopStart: number;
  loopEnd: number;
  sampleRate: number;
  rootKey: number;
  tune: number; // cents
  scaleTuning: number; // cents per key
  loopMode: number; // 0 none, 1 continuous, 3 until release
  attenuation: number; // centibels
  pan: number; // -0.5 .. 0.5
  attack: number; // seconds
  hold: number;
  decay: number;
  sustain: number; // centibels of attenuation
  release: number;
  filterFc: number; // cutoff in absolute cents (13500 = open)
  filterQ: number; // centibels of resonance
  modEnvToFilter: number; // cents the modulation envelope adds to the cutoff at its peak
  modAttack: number; // seconds
  modHold: number;
  modDecay: number;
  modSustain: number; // 0..1 of the peak
  modRelease: number;
  exclusiveClass: number;
}

export interface Preset {
  name: string;
  bank: number;
  program: number;
  regions: Region[];
}

const GEN = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  modEnvToFilterFc: 11,
  initialFilterFc: 8,
  initialFilterQ: 9,
  attackModEnv: 26,
  holdModEnv: 27,
  decayModEnv: 28,
  sustainModEnv: 29,
  releaseModEnv: 30,
  endAddrsCoarseOffset: 12,
  pan: 17,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
} as const;

// Generators whose preset-level values replace rather than add to instrument values.
const NON_ADDITIVE = new Set<number>([
  GEN.startAddrsOffset,
  GEN.endAddrsOffset,
  GEN.startloopAddrsOffset,
  GEN.endloopAddrsOffset,
  GEN.startAddrsCoarseOffset,
  GEN.endAddrsCoarseOffset,
  GEN.startloopAddrsCoarseOffset,
  GEN.endloopAddrsCoarseOffset,
  GEN.keyRange,
  GEN.velRange,
  GEN.sampleID,
  GEN.sampleModes,
  GEN.exclusiveClass,
  GEN.overridingRootKey,
  GEN.instrument,
]);

interface SampleHeader {
  start: number;
  end: number;
  loopStart: number;
  loopEnd: number;
  rate: number;
  pitch: number;
  correction: number;
}

type Gens = Map<number, number>; // generator id -> raw 16-bit amount (signed); ranges packed lo | hi << 8

interface Zone {
  gens: Gens;
}

function timecents(tc: number | undefined): number {
  return tc === undefined ? 0.001 : Math.pow(2, tc / 1200);
}

export class SoundFont {
  samples: Float32Array = new Float32Array(0);
  presets = new Map<string, Preset>();

  static parse(buffer: ArrayBuffer): SoundFont {
    const sf = new SoundFont();
    sf.read(new DataView(buffer));
    return sf;
  }

  getPreset(bank: number, program: number): Preset | undefined {
    return (
      this.presets.get(`${bank}:${program}`) ??
      (bank === 128 ? [...this.presets.values()].find((p) => p.bank === 128) : this.presets.get(`0:${program}`)) ??
      this.presets.get('0:0')
    );
  }

  private read(view: DataView) {
    const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('Not a SoundFont 2 file');

    const chunks = new Map<string, { offset: number; size: number }>();
    const walk = (offset: number, end: number) => {
      while (offset + 8 <= end) {
        const id = tag(offset);
        const size = view.getUint32(offset + 4, true);
        if (id === 'LIST') walk(offset + 12, offset + 8 + size);
        else chunks.set(id, { offset: offset + 8, size });
        offset += 8 + size + (size & 1);
      }
    };
    walk(12, view.byteLength);

    const smpl = chunks.get('smpl');
    if (!smpl) throw new Error('SoundFont has no sample data');
    const frames = smpl.size >> 1;
    this.samples = new Float32Array(frames);
    for (let i = 0; i < frames; i++) this.samples[i] = view.getInt16(smpl.offset + i * 2, true) / 32768;

    const records = <T>(id: string, size: number, read: (o: number) => T): T[] => {
      const c = chunks.get(id);
      if (!c) throw new Error(`SoundFont is missing the ${id} chunk`);
      const out: T[] = [];
      for (let o = c.offset; o + size <= c.offset + c.size; o += size) out.push(read(o));
      return out;
    };
    const name = (o: number) => {
      let s = '';
      for (let i = 0; i < 20; i++) {
        const c = view.getUint8(o + i);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s;
    };

    const phdr = records('phdr', 38, (o) => ({ name: name(o), program: view.getUint16(o + 20, true), bank: view.getUint16(o + 22, true), bag: view.getUint16(o + 24, true) }));
    const pbag = records('pbag', 4, (o) => view.getUint16(o, true));
    const pgen = records('pgen', 4, (o) => ({ op: view.getUint16(o, true), amount: view.getInt16(o + 2, true) }));
    const inst = records('inst', 22, (o) => ({ name: name(o), bag: view.getUint16(o + 20, true) }));
    const ibag = records('ibag', 4, (o) => view.getUint16(o, true));
    const igen = records('igen', 4, (o) => ({ op: view.getUint16(o, true), amount: view.getInt16(o + 2, true) }));
    const shdr = records<SampleHeader>('shdr', 46, (o) => ({
      start: view.getUint32(o + 20, true),
      end: view.getUint32(o + 24, true),
      loopStart: view.getUint32(o + 28, true),
      loopEnd: view.getUint32(o + 32, true),
      rate: view.getUint32(o + 36, true),
      pitch: view.getUint8(o + 40),
      correction: view.getInt8(o + 41),
    }));

    const zonesOf = (bags: number[], gens: { op: number; amount: number }[], from: number, to: number): Zone[] => {
      const zones: Zone[] = [];
      for (let b = from; b < to; b++) {
        const g: Gens = new Map();
        for (let k = bags[b]; k < bags[b + 1]; k++) g.set(gens[k].op, gens[k].amount);
        zones.push({ gens: g });
      }
      return zones;
    };

    // Instrument zones (global zone merged into each local zone).
    const instruments = inst.slice(0, -1).map((ins, i) => {
      const zones = zonesOf(ibag, igen, ins.bag, inst[i + 1].bag);
      let global: Gens = new Map();
      if (zones.length && !zones[0].gens.has(GEN.sampleID)) global = zones.shift()!.gens;
      return zones.filter((z) => z.gens.has(GEN.sampleID)).map((z) => new Map([...global, ...z.gens]));
    });

    for (let p = 0; p < phdr.length - 1; p++) {
      const h = phdr[p];
      const zones = zonesOf(pbag, pgen, h.bag, phdr[p + 1].bag);
      let global: Gens = new Map();
      if (zones.length && !zones[0].gens.has(GEN.instrument)) global = zones.shift()!.gens;
      const regions: Region[] = [];
      for (const z of zones) {
        if (!z.gens.has(GEN.instrument)) continue;
        const pg = new Map([...global, ...z.gens]);
        for (const ig of instruments[pg.get(GEN.instrument)!] ?? []) {
          const region = this.buildRegion(ig, pg, shdr[ig.get(GEN.sampleID)!]);
          if (region) regions.push(region);
        }
      }
      this.presets.set(`${h.bank}:${h.program}`, { name: h.name, bank: h.bank, program: h.program, regions });
    }
  }

  private buildRegion(ig: Gens, pg: Gens, sample: SampleHeader | undefined): Region | null {
    if (!sample) return null;
    const range = (id: number): [number, number] => {
      const a = ig.get(id);
      const b = pg.get(id);
      const lo = Math.max(a === undefined ? 0 : a & 0xff, b === undefined ? 0 : b & 0xff);
      const hi = Math.min(a === undefined ? 127 : (a >> 8) & 0xff, b === undefined ? 127 : (b >> 8) & 0xff);
      return [lo, hi];
    };
    const val = (id: number, def: number) => {
      const i = ig.get(id) ?? def;
      return NON_ADDITIVE.has(id) ? i : i + (pg.get(id) ?? 0);
    };
    const raw = (id: number) => (ig.get(id) === undefined && pg.get(id) === undefined ? undefined : val(id, 0));

    const [keyLo, keyHi] = range(GEN.keyRange);
    const [velLo, velHi] = range(GEN.velRange);
    if (keyLo > keyHi || velLo > velHi) return null;

    const start = sample.start + val(GEN.startAddrsOffset, 0) + val(GEN.startAddrsCoarseOffset, 0) * 32768;
    const end = sample.end + val(GEN.endAddrsOffset, 0) + val(GEN.endAddrsCoarseOffset, 0) * 32768;
    const loopStart = sample.loopStart + val(GEN.startloopAddrsOffset, 0) + val(GEN.startloopAddrsCoarseOffset, 0) * 32768;
    const loopEnd = sample.loopEnd + val(GEN.endloopAddrsOffset, 0) + val(GEN.endloopAddrsCoarseOffset, 0) * 32768;
    if (end <= start || end > this.samples.length) return null;

    const rootOverride = ig.get(GEN.overridingRootKey);
    const fc = val(GEN.initialFilterFc, 13500);
    return {
      keyLo,
      keyHi,
      velLo,
      velHi,
      start,
      end,
      loopStart,
      loopEnd,
      sampleRate: sample.rate || 22050,
      rootKey: rootOverride !== undefined && rootOverride >= 0 ? rootOverride : sample.pitch === 255 ? 60 : sample.pitch,
      tune: val(GEN.coarseTune, 0) * 100 + val(GEN.fineTune, 0) + sample.correction,
      scaleTuning: val(GEN.scaleTuning, 100),
      loopMode: ig.get(GEN.sampleModes) ?? 0,
      attenuation: Math.max(0, val(GEN.initialAttenuation, 0)),
      pan: Math.max(-0.5, Math.min(0.5, val(GEN.pan, 0) / 1000)),
      attack: timecents(raw(GEN.attackVolEnv)),
      hold: timecents(raw(GEN.holdVolEnv)),
      decay: timecents(raw(GEN.decayVolEnv)),
      sustain: Math.max(0, Math.min(1440, val(GEN.sustainVolEnv, 0))),
      release: Math.min(4, timecents(raw(GEN.releaseVolEnv))),
      filterFc: fc,
      filterQ: Math.max(0, val(GEN.initialFilterQ, 0)),
      modEnvToFilter: val(GEN.modEnvToFilterFc, 0),
      modAttack: timecents(raw(GEN.attackModEnv)),
      modHold: timecents(raw(GEN.holdModEnv)),
      modDecay: timecents(raw(GEN.decayModEnv)),
      modSustain: 1 - Math.max(0, Math.min(1000, val(GEN.sustainModEnv, 0))) / 1000,
      modRelease: Math.min(4, timecents(raw(GEN.releaseModEnv))),
      exclusiveClass: ig.get(GEN.exclusiveClass) ?? 0,
    };
  }
}
