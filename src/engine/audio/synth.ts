// Sample-based synthesizer on the Web Audio API, driven by a parsed SoundFont.
import { SoundFont, type Region } from './sf2';
import { DRUM_PIECES, pieceOf, ToneChain, type DrumPiece, type ToneSettings } from './tone';

export interface PitchPoint {
  time: number; // AudioContext time
  cents: number; // offset from the note's base pitch
}

export interface VoiceOptions {
  time: number;
  duration: number; // seconds until note-off
  key: number;
  velocity: number; // 1..127
  pitch?: PitchPoint[];
  vibrato?: number; // depth in cents, 0 = none
  muted?: boolean; // palm mute: darker and shorter
  dead?: boolean; // dead note: very short, filtered
  fadeIn?: boolean;
  destination?: AudioNode; // defaults to the track bus input
  cents?: number; // extra tuning
  decay?: number; // scales the natural decay/release (drums)
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  end: number;
  exclusive: number;
  bus: TrackBus;
}

const MAX_CENTS = 13500;
const centsToHz = (c: number) => Math.min(20000, Math.max(20, 8.176 * Math.pow(2, c / 1200)));

export class TrackBus {
  readonly input: GainNode;
  readonly chain: ToneChain;
  private volumeNode: GainNode;
  private panner: StereoPannerNode;
  private pieces = new Map<DrumPiece, GainNode>();
  tone: ToneSettings | null = null;
  volume = 1;
  muted = false;

  constructor(private ctx: AudioContext, destination: AudioNode, reverb: AudioNode) {
    this.chain = new ToneChain(ctx, reverb);
    this.input = this.chain.input;
    this.volumeNode = ctx.createGain();
    this.panner = ctx.createStereoPanner();
    this.chain.output.connect(this.volumeNode).connect(this.panner).connect(destination);
  }

  setTone(tone: ToneSettings) {
    this.tone = tone;
    this.chain.apply(tone);
    if (tone.kind === 'drums') {
      for (const p of DRUM_PIECES) this.piece(p.id).gain.setTargetAtTime(tone.pieces[p.id]?.volume ?? 1, this.ctx.currentTime, 0.02);
    }
  }

  // Per drum-piece channel, so each part of the kit has its own level.
  piece(id: DrumPiece): GainNode {
    let node = this.pieces.get(id);
    if (!node) {
      node = this.ctx.createGain();
      node.connect(this.input);
      this.pieces.set(id, node);
    }
    return node;
  }

  pieceFor(key: number): DrumPiece {
    return pieceOf(key);
  }

  set(volume: number, audible: boolean, pan: number) {
    this.volume = volume;
    this.muted = !audible;
    const target = audible ? volume : 0;
    this.volumeNode.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
    this.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.015);
  }
}

export class Synth {
  readonly master: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Set<Voice>();
  private clicks: { accent: AudioBuffer; normal: AudioBuffer };
  private reverbIn: GainNode;
  private userSamples = new Map<string, AudioBuffer>();

  constructor(readonly ctx: AudioContext, private sf: SoundFont) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 12;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(compressor);

    // Shared room reverb; each track sends to it from its tone chain.
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(1.8);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.35;
    this.reverbIn.connect(reverb).connect(compressor);

    this.clicks = { accent: this.makeClick(1760), normal: this.makeClick(1175) };
  }

  createBus(): TrackBus {
    return new TrackBus(this.ctx, this.master, this.reverbIn);
  }

  hasSample(id: string) {
    return this.userSamples.has(id);
  }

  async addSample(id: string, data: ArrayBuffer) {
    if (this.userSamples.has(id)) return;
    this.userSamples.set(id, await this.ctx.decodeAudioData(data.slice(0)));
  }

  // Plays a user-loaded one-shot sample (e.g. a drum hit).
  playSample(id: string, dest: AudioNode, time: number, velocity: number, cents: number, decay: number) {
    const buffer = this.userSamples.get(id);
    if (!buffer) return false;
    const t = Math.max(time, this.ctx.currentTime);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.detune.value = cents;
    const gain = this.ctx.createGain();
    const level = Math.pow(Math.max(1, velocity) / 127, 1.5);
    gain.gain.setValueAtTime(level, t);
    const length = buffer.duration * Math.min(1, decay);
    if (decay < 0.999) gain.gain.setTargetAtTime(0, t + length * 0.6, length * 0.15);
    source.connect(gain).connect(dest);
    source.start(t);
    source.stop(t + buffer.duration + 0.05);
    const voice: Voice = { source, gain, end: t + buffer.duration, exclusive: 0, bus: null as unknown as TrackBus };
    this.voices.add(voice);
    source.onended = () => {
      this.voices.delete(voice);
      gain.disconnect();
    };
    return true;
  }

  private bufferFor(r: Region): AudioBuffer {
    const key = `${r.start}:${r.end}:${r.sampleRate}`;
    let buf = this.buffers.get(key);
    if (!buf) {
      buf = this.ctx.createBuffer(1, r.end - r.start, Math.min(96000, Math.max(3000, r.sampleRate)));
      buf.copyToChannel(this.sf.samples.subarray(r.start, r.end), 0);
      this.buffers.set(key, buf);
    }
    return buf;
  }

  // Plays one note on a bank/program. Everything (including note-off) is scheduled up front.
  play(bus: TrackBus, bank: number, program: number, o: VoiceOptions) {
    const preset = this.sf.getPreset(bank, program);
    if (!preset) return;
    const key = Math.max(0, Math.min(127, Math.round(o.key)));
    const vel = Math.max(1, Math.min(127, Math.round(o.velocity)));
    const regions = preset.regions.filter((r) => key >= r.keyLo && key <= r.keyHi && vel >= r.velLo && vel <= r.velHi);
    const ctx = this.ctx;
    const t = Math.max(o.time, ctx.currentTime);

    for (const r of regions) {
      // Exclusive classes: e.g. a closed hi-hat chokes an open one.
      if (r.exclusiveClass) {
        for (const v of this.voices) {
          if (v.bus === bus && v.exclusive === r.exclusiveClass && v.end > t) this.fadeOut(v, t);
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = this.bufferFor(r);
      const looping = r.loopMode === 1 || r.loopMode === 3;
      if (looping && r.loopEnd > r.loopStart) {
        source.loop = true;
        source.loopStart = (r.loopStart - r.start) / r.sampleRate;
        source.loopEnd = (r.loopEnd - r.start) / r.sampleRate;
      }
      const base = (key - r.rootKey) * r.scaleTuning + r.tune + (o.key - key) * 100 + (o.cents ?? 0);
      const first = o.pitch?.[0];
      source.detune.setValueAtTime(base + (first && first.time <= t + 0.001 ? first.cents : 0), t);
      for (const p of o.pitch ?? []) if (p.time > t) source.detune.linearRampToValueAtTime(base + p.cents, p.time);

      const off = t + Math.max(0.01, o.duration);
      const decayScale = o.decay ?? 1;
      const release = (o.dead ? 0.03 : o.muted ? Math.min(r.release, 0.08) : r.release) * Math.min(1, decayScale);

      // Low-pass filter: SoundFont cutoff + modulation envelope, darker for soft notes.
      let head: AudioNode = source;
      const velocityCents = -1200 * (1 - vel / 127);
      const baseCents = r.filterFc + velocityCents;
      const forced = o.dead ? 900 : o.muted ? 1700 : 0;
      if (forced || r.filterFc < MAX_CENTS || r.modEnvToFilter) {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = Math.min(12, r.filterQ / 10);
        const f = filter.frequency;
        if (forced) {
          f.value = Math.min(forced, centsToHz(baseCents + r.modEnvToFilter));
        } else {
          const peak = baseCents + r.modEnvToFilter;
          const sustain = baseCents + r.modEnvToFilter * r.modSustain;
          f.setValueAtTime(centsToHz(baseCents), t);
          f.linearRampToValueAtTime(centsToHz(peak), t + r.modAttack);
          f.setValueAtTime(centsToHz(peak), t + r.modAttack + r.modHold);
          f.setTargetAtTime(centsToHz(sustain), t + r.modAttack + r.modHold, Math.max(0.005, r.modDecay / 4));
          f.setTargetAtTime(centsToHz(baseCents), off, Math.max(0.005, r.modRelease / 4));
        }
        head.connect(filter);
        head = filter;
      }

      if (o.vibrato) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5.5;
        depth.gain.value = o.vibrato;
        lfo.connect(depth).connect(source.detune);
        lfo.start(t);
        lfo.stop(off + release + 0.1);
      }

      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, r.pan * 2));
      head.connect(gain).connect(pan).connect(o.destination ?? bus.input);

      // Volume envelope. Attenuation uses the EMU convention (x0.4) that SoundFonts are voiced for.
      const velocityGain = Math.pow(vel / 127, 1.7);
      const peak = velocityGain * Math.pow(10, (-r.attenuation * 0.4) / 200);
      const sustainLevel = peak * Math.pow(10, -r.sustain / 200);
      const attack = o.fadeIn ? Math.max(r.attack, Math.min(o.duration * 0.8, 1)) : r.attack;
      const g = gain.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + attack);
      const decayStart = t + attack + r.hold;
      g.setValueAtTime(peak, decayStart);
      g.setTargetAtTime(Math.max(sustainLevel, 0.00001), decayStart, (r.decay * decayScale) / 4);
      g.setTargetAtTime(0, off, Math.max(0.005, release / 4));
      const end = off + release + 0.05;
      source.start(t);
      source.stop(end);

      const voice: Voice = { source, gain, end, exclusive: r.exclusiveClass, bus };
      this.voices.add(voice);
      source.onended = () => {
        this.voices.delete(voice);
        gain.disconnect();
        pan.disconnect();
      };
    }
  }

  private fadeOut(v: Voice, at: number) {
    try {
      v.gain.gain.cancelScheduledValues(at);
      v.gain.gain.setTargetAtTime(0, at, 0.01);
      v.source.stop(at + 0.08);
      v.end = at;
    } catch {
      // already stopped
    }
  }

  // Quickly silences everything (used on pause, stop and seek).
  stopAll() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) this.fadeOut(v, now);
    this.voices.clear();
  }

  click(time: number, accent: boolean, volume = 0.5) {
    const source = this.ctx.createBufferSource();
    source.buffer = accent ? this.clicks.accent : this.clicks.normal;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.ctx.destination);
    source.start(Math.max(time, this.ctx.currentTime));
    const voice: Voice = { source, gain, end: time + 0.1, exclusive: 0, bus: null as unknown as TrackBus };
    this.voices.add(voice);
    source.onended = () => this.voices.delete(voice);
  }

  private makeClick(freq: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * 0.05);
    const buf = this.ctx.createBuffer(1, length, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      data[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 90);
    }
    return buf;
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let seed = ch ? 1234567 : 7654321;
      for (let i = 0; i < length; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const noise = seed / 0x3fffffff - 1;
        const t = i / length;
        // Short pre-delay, then an exponential tail.
        data[i] = i < rate * 0.012 ? 0 : noise * Math.pow(1 - t, 3.2) * 0.6;
      }
    }
    return buf;
  }
}
