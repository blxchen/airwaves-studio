// Transport: look-ahead scheduling of note events, tempo scaling, looping,
// metronome / count-in and per-track mixing.
import type { Song } from '../model';
import { playOrder, TempoMap, type PlayedMeasure } from '../timing';
import { buildEvents, swing, type NoteEvent } from './sequence';
import { defaultTone, pieceOf, toneKindOf, type ToneSettings } from './tone';
import { SoundFont } from './sf2';
import { Synth, TrackBus } from './synth';

export interface ScorePosition {
  measure: number; // index into song.measures
  tick: number; // offset inside the measure
  orderIndex: number; // index into the play order
}

export interface Channel {
  volume: number; // 0..1.5
  mute: boolean;
  solo: boolean;
}

const LOOKAHEAD = 0.15; // seconds scheduled ahead of the audio clock
const START_DELAY = 0.06;

let soundFontPromise: Promise<SoundFont> | null = null;

export function loadSoundFont(url: string, onProgress?: (fraction: number) => void): Promise<SoundFont> {
  soundFontPromise ??= (async () => {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Could not load instrument sounds (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      if (total) onProgress?.(loaded / total);
    }
    const all = new Uint8Array(loaded);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    onProgress?.(1);
    return SoundFont.parse(all.buffer);
  })();
  return soundFontPromise;
}

export class Player {
  readonly ctx: AudioContext;
  private synth: Synth;
  private song: Song | null = null;
  private buses: TrackBus[] = [];
  private channels: Channel[] = [];
  private tones: ToneSettings[] = [];

  order: PlayedMeasure[] = [];
  private fullOrder: PlayedMeasure[] = [];
  private tempo!: TempoMap;
  private events: NoteEvent[] = [];
  private endTick = 0;

  private playing = false;
  private anchorTime = 0; // audio time at which anchorTick sounds
  private anchorTick = 0;
  private pausedTick = 0;
  private nextEvent = 0;
  private nextClickTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  speed = 1;
  looping = false;
  loopRange: { from: number; to: number } | null = null;
  metronome = false;
  countIn = false;

  onStateChange: (playing: boolean) => void = () => {};
  onEnded: () => void = () => {};

  constructor(sf: SoundFont) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.synth = new Synth(this.ctx, sf);
  }

  get isPlaying() {
    return this.playing;
  }

  get duration(): number {
    return this.tempo ? this.tempo.secondsAt(this.endTick) / this.speed : 0;
  }

  load(song: Song) {
    this.pause();
    this.song = song;
    this.buses = song.tracks.map(() => this.synth.createBus());
    this.channels = song.tracks.map((t) => ({ volume: t.volume || 0.8, mute: false, solo: false }));
    this.tones = song.tracks.map((t) => defaultTone(toneKindOf(t.program, t.isPercussion)));
    this.buses.forEach((b, i) => b.setTone(this.tones[i]));
    this.applyMix();
    this.fullOrder = playOrder(song);
    this.loopRange = null;
    this.rebuild(0);
  }

  // Swaps in an edited song, keeping position, mixer and loop settings.
  update(song: Song) {
    const tick = this.currentTick();
    const wasPlaying = this.playing;
    if (wasPlaying) this.halt();
    this.song = song;
    while (this.buses.length < song.tracks.length) {
      const t = song.tracks[this.buses.length];
      const bus = this.synth.createBus();
      const tone = defaultTone(toneKindOf(t.program, t.isPercussion));
      bus.setTone(tone);
      this.buses.push(bus);
      this.tones.push(tone);
      this.channels.push({ volume: 0.8, mute: false, solo: false });
    }
    this.buses.length = song.tracks.length;
    this.channels.length = song.tracks.length;
    this.tones.length = song.tracks.length;
    this.applyMix();
    this.fullOrder = playOrder(song);
    if (this.loopRange) {
      const last = song.measures.length - 1;
      this.loopRange = { from: Math.min(this.loopRange.from, last), to: Math.min(this.loopRange.to, last) };
    }
    this.rebuild(tick);
    if (wasPlaying) void this.play();
  }

  // Rebuilds the timeline (e.g. when the loop range changes) keeping the score position.
  private rebuild(tick: number) {
    if (!this.song) return;
    const pos = this.order.length ? this.toScore(tick) : null;
    this.order = this.looping && this.loopRange ? playOrder(this.song, this.loopRange) : this.fullOrder;
    this.tempo = new TempoMap(this.song, this.order);
    this.events = buildEvents(this.song, this.order);
    const last = this.order[this.order.length - 1];
    this.endTick = last ? last.start + last.length : 0;
    this.pausedTick = pos ? this.fromScore(pos.measure, pos.tick) : 0;
  }

  setChannel(track: number, patch: Partial<Channel>) {
    this.channels[track] = { ...this.channels[track], ...patch };
    this.applyMix();
  }

  setTone(track: number, tone: ToneSettings) {
    if (!this.buses[track]) return;
    this.tones[track] = tone;
    this.buses[track].setTone(tone);
  }

  getTones(): ToneSettings[] {
    return this.tones.map((t) => structuredClone(t));
  }

  // Loads a user sample so drum pieces can use it.
  addSample(id: string, data: ArrayBuffer) {
    return this.synth.addSample(id, data);
  }

  getChannels(): Channel[] {
    return this.channels.map((c) => ({ ...c }));
  }

  private applyMix() {
    const anySolo = this.channels.some((c) => c.solo);
    this.buses.forEach((bus, i) => {
      const c = this.channels[i];
      const audible = !c.mute && (!anySolo || c.solo);
      bus.set(c.volume, audible, this.song?.tracks[i]?.pan ?? 0);
    });
  }

  // --- position mapping -------------------------------------------------------

  toScore(tick: number): ScorePosition {
    const order = this.order;
    let lo = 0;
    let hi = order.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (order[mid].start <= tick) lo = mid;
      else hi = mid - 1;
    }
    const pm = order[lo];
    if (!pm) return { measure: 0, tick: 0, orderIndex: 0 };
    return { measure: pm.measure, tick: Math.min(pm.length, Math.max(0, tick - pm.start)), orderIndex: lo };
  }

  // First time the given score position is heard, starting from the current play-through if possible.
  fromScore(measure: number, tick: number, after = -1): number {
    let candidate = -1;
    for (let i = 0; i < this.order.length; i++) {
      if (this.order[i].measure !== measure) continue;
      if (candidate < 0) candidate = i;
      if (i >= after) {
        candidate = i;
        break;
      }
    }
    if (candidate < 0) return this.looping && this.loopRange ? 0 : this.pausedTick;
    return this.order[candidate].start + tick;
  }

  // The audio time currently coming out of the speakers (accounts for output latency),
  // so the tracker lines up with what you hear rather than what was just scheduled.
  private heardTime(): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      if (t > 0 && Math.abs(t - this.ctx.currentTime) < 1) return t;
    }
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  // Score position for display: in swing feel, notes sound later than written,
  // so map the clock back onto the written positions.
  displayPosition(tick: number): ScorePosition {
    const pos = this.toScore(tick);
    const feel = this.song?.measures[pos.measure]?.tripletFeel ?? 'none';
    if (feel === 'none') return pos;
    let lo = 0;
    let hi = this.song!.measures[pos.measure].length;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (swing(Math.round(mid), feel) <= pos.tick) lo = mid;
      else hi = mid;
    }
    return { ...pos, tick: lo };
  }

  currentTick(): number {
    if (!this.playing) return this.pausedTick;
    const elapsed = (this.heardTime() - this.anchorTime) * this.speed;
    if (elapsed < 0) return this.anchorTick;
    return Math.min(this.endTick, this.tempo.tickAt(this.tempo.secondsAt(this.anchorTick) + elapsed));
  }

  currentSeconds(): number {
    return this.tempo ? this.tempo.secondsAt(this.currentTick()) / this.speed : 0;
  }

  bpmAt(tick: number): number {
    return this.tempo ? this.tempo.bpmAt(tick) * this.speed : 0;
  }

  // --- transport ----------------------------------------------------------------

  async play() {
    if (this.playing || !this.song) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.pausedTick >= this.endTick) this.pausedTick = 0;

    let start = this.ctx.currentTime + START_DELAY;
    if (this.countIn) start = this.scheduleCountIn(start, this.pausedTick);
    this.anchorTime = start;
    this.anchorTick = this.pausedTick;
    this.seekIndexes(this.pausedTick);
    this.playing = true;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    this.onStateChange(true);
  }

  pause() {
    if (!this.playing) return;
    this.pausedTick = this.currentTick();
    this.halt();
    this.onStateChange(false);
  }

  stop() {
    const wasPlaying = this.playing;
    this.halt();
    this.pausedTick = this.looping && this.loopRange ? 0 : 0;
    if (wasPlaying) this.onStateChange(false);
  }

  private halt() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.synth.stopAll();
  }

  seek(tick: number) {
    const t = Math.max(0, Math.min(this.endTick, tick));
    if (this.playing) {
      this.synth.stopAll();
      this.anchorTime = this.ctx.currentTime + START_DELAY;
      this.anchorTick = t;
      this.seekIndexes(t);
    } else {
      this.pausedTick = t;
    }
  }

  setSpeed(speed: number) {
    const tick = this.currentTick();
    this.speed = speed;
    if (this.playing) {
      this.anchorTime = this.ctx.currentTime;
      this.anchorTick = tick;
    }
  }

  setLooping(looping: boolean, range: { from: number; to: number } | null) {
    const tick = this.currentTick();
    const wasPlaying = this.playing;
    if (wasPlaying) this.halt();
    this.looping = looping;
    this.loopRange = range;
    this.pausedTick = tick;
    this.rebuild(tick);
    // Starting outside the loop range jumps to its start.
    if (looping && range) {
      const pos = this.toScore(this.pausedTick);
      if (pos.measure < range.from || pos.measure > range.to) this.pausedTick = 0;
    }
    if (wasPlaying) void this.play();
  }

  private seekIndexes(tick: number) {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].tick < tick) lo = mid + 1;
      else hi = mid;
    }
    this.nextEvent = lo;
    this.nextClickTick = this.nextBeatTick(tick);
  }

  private timeOf(tick: number): number {
    return this.anchorTime + (this.tempo.secondsAt(tick) - this.tempo.secondsAt(this.anchorTick)) / this.speed;
  }

  private schedule() {
    if (!this.playing || !this.song) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;

    for (let guard = 0; guard < 4; guard++) {
      while (this.nextEvent < this.events.length) {
        const ev = this.events[this.nextEvent];
        const time = this.timeOf(ev.tick);
        if (time > horizon) break;
        this.nextEvent++;
        this.playEvent(ev, time);
      }
      if (this.metronome) {
        while (this.nextClickTick < this.endTick) {
          const time = this.timeOf(this.nextClickTick);
          if (time > horizon) break;
          const pos = this.toScore(this.nextClickTick);
          this.synth.click(time, pos.tick === 0);
          this.nextClickTick = this.nextBeatTick(this.nextClickTick + 1);
        }
      }

      const endTime = this.timeOf(this.endTick);
      if (endTime > horizon) return;
      if (this.looping) {
        // Wrap the timeline seamlessly.
        this.anchorTime = endTime;
        this.anchorTick = 0;
        this.nextEvent = 0;
        this.nextClickTick = 0;
        continue;
      }
      if (this.ctx.currentTime >= endTime) {
        this.halt();
        this.pausedTick = 0;
        this.onStateChange(false);
        this.onEnded();
      }
      return;
    }
  }

  private playEvent(ev: NoteEvent, time: number) {
    const song = this.song!;
    const track = song.tracks[ev.track];
    const bus = this.buses[ev.track];
    if (!track || !bus || bus.muted) return;
    const end = this.timeOf(ev.end);
    const tone = this.tones[ev.track];
    if (track.isPercussion && tone) {
      // Route each hit to its kit piece: user sample, another kit, tuning and decay.
      const id = pieceOf(ev.key);
      const ps = tone.pieces[id];
      const dest = bus.piece(id);
      if (ps?.sampleId && this.synth.playSample(ps.sampleId, dest, time, ev.velocity, ps.tune * 100, ps.decay)) return;
      this.synth.play(bus, 128, ps?.kit ?? tone.kit, {
        time,
        duration: Math.max(0.02, end - time),
        key: ev.key,
        velocity: ev.velocity,
        destination: dest,
        cents: (ps?.tune ?? 0) * 100,
        decay: ps?.decay ?? 1,
      });
      return;
    }
    const source = tone?.source;
    this.synth.play(bus, source ? source.bank : 0, source ? source.program : ev.program, {
      time,
      duration: Math.max(0.02, end - time),
      key: ev.key,
      velocity: ev.velocity,
      pitch: ev.pitch.map((p) => ({ time: this.timeOf(p.tick), cents: p.cents })),
      vibrato: ev.vibrato,
      muted: ev.muted,
      dead: ev.dead,
      fadeIn: ev.fadeIn,
    });
  }

  // Next metronome beat at or after `tick`.
  private nextBeatTick(tick: number): number {
    const pos = this.toScore(tick);
    const pm = this.order[pos.orderIndex];
    if (!pm || !this.song) return this.endTick;
    const header = this.song.measures[pm.measure];
    const beat = this.beatUnit(header.numerator, header.denominator);
    const local = Math.ceil(pos.tick / beat) * beat;
    if (local >= pm.length) return pm.start + pm.length;
    return pm.start + local;
  }

  private beatUnit(numerator: number, denominator: number) {
    const unit = 3840 / denominator;
    // Compound meters (6/8, 9/8, 12/8) click on dotted quarters.
    return denominator === 8 && numerator % 3 === 0 && numerator > 3 ? unit * 3 : unit;
  }

  private scheduleCountIn(start: number, tick: number): number {
    const pos = this.toScore(tick);
    const header = this.song!.measures[pos.measure];
    const beat = this.beatUnit(header.numerator, header.denominator);
    const clicks = Math.round(header.length / beat);
    const seconds = (beat / 960) * (60 / this.tempo.bpmAt(tick)) / this.speed;
    for (let i = 0; i < clicks; i++) this.synth.click(start + i * seconds, i === 0, 0.6);
    return start + clicks * seconds;
  }

  dispose() {
    this.halt();
    void this.ctx.close();
  }
}
