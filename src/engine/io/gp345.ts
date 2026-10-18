// Guitar Pro 3, 4 and 5 binary format reader.
import { BinaryReader } from './binaryReader';
import {
  beatTicks,
  measureTicks,
  newBeat,
  newNote,
  newSlide,
  type Beat,
  type BendPoint,
  type ChordDiagram,
  type DurationValue,
  type HarmonicKind,
  type MeasureHeader,
  type Note,
  type Song,
  type Track,
  type Tuplet,
} from '../model';

interface Channel {
  program: number;
  volume: number;
  balance: number;
}

const TUPLETS: Record<number, Tuplet> = {
  3: { enters: 3, times: 2 },
  5: { enters: 5, times: 4 },
  6: { enters: 6, times: 4 },
  7: { enters: 7, times: 4 },
  9: { enters: 9, times: 8 },
  10: { enters: 10, times: 8 },
  11: { enters: 11, times: 8 },
  12: { enters: 12, times: 8 },
  13: { enters: 13, times: 8 },
};

const TRACK_COLORS = ['#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#f08c00', '#0c8599', '#c2255c', '#5f3dc4'];

export function isGp345(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(1, 25));
  return head.startsWith('FICHIER GUITAR PRO') || head.startsWith('FICHIER GUITARE PRO');
}

export function parseGp345(bytes: Uint8Array): Song {
  return new Gp345Parser(bytes).read();
}

class Gp345Parser {
  private r: BinaryReader;
  private version = 0; // 300, 400, 406, 500, 510
  private channels: Channel[] = [];
  private song!: Song;

  constructor(bytes: Uint8Array) {
    this.r = new BinaryReader(bytes);
  }

  read(): Song {
    const r = this.r;
    const versionString = r.byteSizeString(30);
    const m = versionString.match(/(\d)\.(\d\d)/);
    if (!m) throw new Error(`Unknown Guitar Pro version "${versionString}"`);
    this.version = Number(m[1]) * 100 + Number(m[2]);
    if (this.version < 300 || this.version >= 600) throw new Error(`Unsupported Guitar Pro version ${versionString}`);
    const v = this.version;

    const song: Song = (this.song = {
      title: '',
      subtitle: '',
      artist: '',
      album: '',
      music: '',
      words: '',
      tabber: '',
      tempo: 120,
      measures: [],
      tracks: [],
      tempoChanges: [],
    });

    song.title = r.intByteSizeString();
    song.subtitle = r.intByteSizeString();
    song.artist = r.intByteSizeString();
    song.album = r.intByteSizeString();
    song.words = r.intByteSizeString();
    if (v >= 500) song.music = r.intByteSizeString();
    r.intByteSizeString(); // copyright
    song.tabber = r.intByteSizeString();
    r.intByteSizeString(); // instructions
    const notices = r.i32();
    for (let i = 0; i < notices; i++) r.intByteSizeString();

    let globalTripletFeel = false;
    if (v < 500) globalTripletFeel = r.bool();
    if (v >= 400) this.readLyrics();
    if (v > 500) r.skip(19); // RSE master effect: volume, reserved, 11-band equalizer
    if (v >= 500) {
      this.readPageSetup();
      r.intByteSizeString(); // tempo name
    }
    song.tempo = r.i32();
    if (v > 500) r.bool(); // hide tempo
    if (v >= 500) {
      r.i8(); // key
      r.i32(); // octave
    } else {
      r.i32(); // key
      if (v >= 400) r.i8(); // octave
    }
    this.readChannels();
    if (v >= 500) {
      r.skip(19 * 2); // directions (coda, segno, ...)
      r.i32(); // master reverb
    }
    const measureCount = r.i32();
    const trackCount = r.i32();
    if (measureCount <= 0 || measureCount > 10000 || trackCount <= 0 || trackCount > 128) {
      throw new Error('Corrupt Guitar Pro file (bad measure or track count)');
    }

    this.readMeasureHeaders(measureCount, globalTripletFeel);
    for (let i = 0; i < trackCount; i++) song.tracks.push(this.readTrack(i));
    if (v >= 500) r.skip(v === 500 ? 2 : 1);
    this.readMeasures();
    return song;
  }

  private readLyrics() {
    const r = this.r;
    r.i32(); // track
    for (let i = 0; i < 5; i++) {
      r.i32();
      r.intSizeString();
    }
  }

  private readPageSetup() {
    const r = this.r;
    r.skip(4 * 7); // page size (2), margins (4), score size proportion
    r.i16(); // header/footer flags
    for (let i = 0; i < 10; i++) r.intByteSizeString();
  }

  private readChannels() {
    const r = this.r;
    for (let i = 0; i < 64; i++) {
      const program = r.i32();
      const volume = r.i8();
      const balance = r.i8();
      r.skip(4); // chorus, reverb, phaser, tremolo
      r.skip(2);
      this.channels.push({ program: Math.max(0, program), volume, balance });
    }
  }

  private readColor() {
    this.r.skip(4);
  }

  private readMeasureHeaders(count: number, globalTripletFeel: boolean) {
    const r = this.r;
    const v = this.version;
    let numerator = 4;
    let denominator = 4;
    let keySignature = 0;
    let start = 0;
    let usedEndings = 0; // GP3/4 alternate endings since the last repeat start

    for (let i = 0; i < count; i++) {
      if (v >= 500 && i > 0) r.skip(1);
      const flags = r.u8();
      if (flags & 0x01) numerator = r.i8();
      if (flags & 0x02) denominator = r.i8();
      const repeatOpen = (flags & 0x04) !== 0;
      let repeatClose = 0;
      let alternateEndings = 0;
      let marker: string | null = null;
      if (repeatOpen) usedEndings = 0;

      if (flags & 0x08) {
        const raw = r.i8();
        repeatClose = v >= 500 ? raw : raw + 1;
      }
      if (v < 500) {
        if (flags & 0x10) {
          const value = r.u8();
          alternateEndings = ((1 << value) - 1) ^ usedEndings;
          usedEndings |= alternateEndings;
        }
        if (flags & 0x20) {
          marker = r.intByteSizeString();
          this.readColor();
        }
        if (flags & 0x40) {
          keySignature = r.i8();
          r.i8();
        }
      } else {
        if (flags & 0x20) {
          marker = r.intByteSizeString();
          this.readColor();
        }
        if (flags & 0x40) {
          keySignature = r.i8();
          r.i8();
        }
        if (flags & 0x10) alternateEndings = r.u8();
        if (flags & 0x03) r.skip(4); // beam grouping
        if (!(flags & 0x10)) r.skip(1);
      }
      let tripletFeel: MeasureHeader['tripletFeel'] = globalTripletFeel ? 'eighth' : 'none';
      if (v >= 500) {
        const tf = r.u8();
        tripletFeel = tf === 1 ? 'eighth' : tf === 2 ? 'sixteenth' : 'none';
      }

      const length = measureTicks(numerator, denominator);
      this.song.measures.push({
        index: i,
        numerator,
        denominator,
        start,
        length,
        repeatOpen,
        repeatClose,
        alternateEndings,
        marker: marker?.trim() || null,
        doubleBar: (flags & 0x80) !== 0,
        tripletFeel,
        keySignature,
      });
      start += length;
    }
  }

  private readTrack(index: number): Track {
    const r = this.r;
    const v = this.version;
    if (v >= 500 && (index === 0 || v === 500)) r.skip(1);
    const flags = r.u8();
    const name = r.byteSizeString(40);
    const stringCount = r.i32();
    const tuning: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = r.i32();
      if (i < stringCount) tuning.push(t);
    }
    r.i32(); // port
    const channelIndex = r.i32() - 1;
    r.i32(); // effect channel
    const fretCount = r.i32();
    const capo = r.i32();
    this.readColor();
    if (v >= 500) {
      r.i16(); // display flags
      r.u8(); // auto accentuation
      r.u8(); // MIDI bank
      r.u8(); // humanize
      r.skip(4 * 3);
      r.skip(12);
      r.skip(12); // RSE instrument, sound bank
      if (v === 500) {
        r.skip(2);
        r.skip(1);
      } else {
        r.skip(4);
        r.skip(4); // equalizer
        r.intByteSizeString(); // RSE effect
        r.intByteSizeString(); // RSE effect category
      }
    }

    const channel = this.channels[channelIndex] ?? { program: 25, volume: 13, balance: 8 };
    const isPercussion = (flags & 0x01) !== 0 || channelIndex === 9;
    return {
      index,
      name: name.trim() || `Track ${index + 1}`,
      program: channel.program,
      isPercussion,
      tuning,
      capo: isPercussion ? 0 : capo,
      fretCount: fretCount || 24,
      color: TRACK_COLORS[index % TRACK_COLORS.length],
      volume: Math.min(1, Math.max(0, channel.volume / 16)),
      pan: Math.min(1, Math.max(-1, (channel.balance - 8) / 8)),
      instrumentChanges: [],
      measures: [],
    };
  }

  private readMeasures() {
    const r = this.r;
    const voiceCount = this.version >= 500 ? 2 : 1;
    for (const header of this.song.measures) {
      for (const track of this.song.tracks) {
        const voices = [];
        for (let v = 0; v < voiceCount; v++) {
          const beats: Beat[] = [];
          this.currentVoice = beats;
          const count = r.i32();
          if (count < 0 || count > 1024) throw new Error(`Corrupt measure ${header.index + 1} in track "${track.name}"`);
          let start = 0;
          for (let b = 0; b < count; b++) {
            const beat = this.readBeat(track, header, start);
            if (beat) {
              beats.push(beat);
              start += beat.duration;
            }
          }
          voices.push({ beats });
        }
        track.measures.push({ voices });
        if (this.version >= 500 && r.remaining > 0) r.u8(); // line break
      }
    }
  }

  private readBeat(track: Track, header: MeasureHeader, start: number): Beat | null {
    const r = this.r;
    const v = this.version;
    const flags = r.u8();
    const status = flags & 0x40 ? r.u8() : 1;
    const rawDuration = r.i8();
    const value = (1 << Math.min(7, Math.max(0, rawDuration + 2))) as DurationValue;
    const dots = flags & 0x01 ? 1 : 0;
    let tuplet: Tuplet | null = null;
    if (flags & 0x20) tuplet = TUPLETS[r.i32()] ?? null;

    const beat = newBeat({ start, value, dots, tuplet, duration: beatTicks(value, dots, tuplet), rest: status === 2 });
    if (flags & 0x02) beat.chord = this.readChord(track.tuning.length);
    if (flags & 0x04) beat.text = r.intByteSizeString();

    let beatHarmonic: HarmonicKind | null = null;
    let beatNoteVibrato = false;
    if (flags & 0x08) {
      const fx = this.readBeatEffects(beat);
      beatHarmonic = fx.harmonic;
      beatNoteVibrato = fx.noteVibrato;
    }
    if (flags & 0x10) this.readMixTable(track, header, start);

    const stringFlags = r.u8();
    for (let i = 0; i < 7; i++) {
      if (stringFlags & (1 << (6 - i))) {
        const note = this.readNote(track, beat, i);
        if (beatHarmonic && !note.harmonic) note.harmonic = beatHarmonic;
        if (beatNoteVibrato && note.vibrato === 'none') note.vibrato = 'slight';
        beat.notes.push(note);
      }
    }
    if (v >= 500) {
      const flags2 = r.i16();
      if (flags2 & 0x0800) r.u8();
    }
    if (beat.notes.length === 0 && status !== 0) beat.rest = true;
    return status === 0 ? null : beat;
  }

  private readChord(stringCount: number): ChordDiagram {
    const r = this.r;
    const v = this.version;
    const chord: ChordDiagram = { name: '', firstFret: 0, frets: [] };
    const newFormat = r.bool();
    if (!newFormat) {
      chord.name = r.intByteSizeString();
      chord.firstFret = r.i32();
      if (chord.firstFret) for (let i = 0; i < 6; i++) chord.frets.push(r.i32());
    } else if (v < 400) {
      r.bool(); // sharp
      r.skip(3);
      r.skip(4 * 5); // root, type, extension, bass, tonality
      r.bool(); // add
      chord.name = r.byteSizeString(22);
      r.skip(4 * 3); // fifth, ninth, eleventh
      chord.firstFret = r.i32();
      for (let i = 0; i < 6; i++) chord.frets.push(r.i32());
      r.skip(4 * 7); // barres
      r.skip(7 + 1); // omissions + padding
    } else {
      r.bool();
      r.skip(3);
      r.skip(3); // root, type, extension
      r.skip(4 * 2); // bass, tonality
      r.bool(); // add
      chord.name = r.byteSizeString(22);
      r.skip(3); // fifth, ninth, eleventh
      chord.firstFret = r.i32();
      for (let i = 0; i < 7; i++) {
        const fret = r.i32();
        if (i < stringCount) chord.frets.push(fret);
      }
      r.skip(1 + 5 * 3); // barres
      r.skip(7 + 1); // omissions + padding
      r.skip(7); // fingerings
      r.bool(); // show
    }
    chord.name = chord.name.trim();
    return chord;
  }

  private readBend(): BendPoint[] {
    const r = this.r;
    r.i8(); // type
    r.i32(); // value
    const count = r.i32();
    const points: BendPoint[] = [];
    for (let i = 0; i < count; i++) {
      const position = r.i32();
      const value = r.i32();
      r.bool(); // vibrato
      points.push({ position: Math.min(1, Math.max(0, position / 60)), value: value / 50 });
    }
    return points;
  }

  private readBeatEffects(beat: Beat): { harmonic: HarmonicKind | null; noteVibrato: boolean } {
    const r = this.r;
    if (this.version < 400) {
      const flags = r.u8();
      const noteVibrato = (flags & 0x01) !== 0;
      if (flags & 0x02) beat.vibrato = 'wide';
      beat.fadeIn = (flags & 0x10) !== 0;
      if (flags & 0x20) {
        const slap = r.u8();
        const amount = r.i32();
        if (slap === 0) {
          beat.tremoloBar = [
            { position: 0, value: 0 },
            { position: 0.5, value: amount / 50 },
            { position: 1, value: 0 },
          ];
        } else {
          beat.slap = slap === 1 ? 'tap' : slap === 2 ? 'slap' : 'pop';
        }
      }
      if (flags & 0x40) this.readStroke(beat);
      const harmonic: HarmonicKind | null = flags & 0x04 ? 'natural' : flags & 0x08 ? 'artificial' : null;
      return { harmonic, noteVibrato };
    }
    const flags1 = r.i8();
    const flags2 = r.i8();
    if (flags1 & 0x02) beat.vibrato = 'slight';
    beat.fadeIn = (flags1 & 0x10) !== 0;
    if (flags1 & 0x20) {
      const slap = r.i8();
      beat.slap = slap === 1 ? 'tap' : slap === 2 ? 'slap' : slap === 3 ? 'pop' : 'none';
    }
    if (flags2 & 0x04) beat.tremoloBar = this.readBend();
    if (flags1 & 0x40) this.readStroke(beat);
    if (flags2 & 0x02) {
      const dir = r.i8();
      beat.pickStroke = dir === 1 ? 'up' : dir === 2 ? 'down' : 'none';
    }
    return { harmonic: null, noteVibrato: false };
  }

  private readStroke(beat: Beat) {
    const first = this.r.i8();
    const second = this.r.i8();
    // GP5 stores the directions swapped compared to GP3/4.
    const [down, up] = this.version >= 500 ? [second, first] : [first, second];
    beat.stroke = up > 0 ? 'up' : down > 0 ? 'down' : 'none';
  }

  private readMixTable(track: Track, header: MeasureHeader, tick: number) {
    const r = this.r;
    const v = this.version;
    const instrument = r.i8();
    if (instrument >= 0 && !track.isPercussion) {
      const current = track.instrumentChanges.length ? track.instrumentChanges[track.instrumentChanges.length - 1].program : track.program;
      if (instrument !== current) track.instrumentChanges.push({ measure: header.index, tick, program: instrument });
    }
    if (v >= 500) {
      r.skip(12);
      if (v === 500) {
        r.skip(2);
        r.skip(1);
      } else {
        r.skip(4);
      }
      if (v === 500) r.skip(1);
    }
    const values = [r.i8(), r.i8(), r.i8(), r.i8(), r.i8(), r.i8()]; // volume, balance, chorus, reverb, phaser, tremolo
    if (v >= 500) r.intByteSizeString(); // tempo name
    const tempo = r.i32();
    for (const value of values) if (value >= 0) r.i8();
    if (tempo >= 0) {
      r.i8();
      if (v > 500) r.bool();
      const exists = this.song.tempoChanges.some((t) => t.measure === header.index && t.tick === tick);
      if (!exists) this.song.tempoChanges.push({ measure: header.index, tick, bpm: tempo });
    }
    if (v >= 400) r.i8(); // apply-to-all flags
    if (v >= 500) {
      r.i8(); // wah
      if (v > 500) {
        r.intByteSizeString();
        r.intByteSizeString();
      }
    }
  }

  // Beats already read in the voice currently being parsed (for resolving ties).
  private currentVoice: Beat[] = [];

  private previousFret(track: Track, beat: Beat, string: number): number {
    const sources = [beat.notes, ...[...this.currentVoice].reverse().map((b) => b.notes)];
    for (const notes of sources) {
      const n = notes.find((x) => x.string === string);
      if (n) return n.fret;
    }
    for (let m = track.measures.length - 1; m >= 0; m--) {
      const beats = track.measures[m].voices[0]?.beats ?? [];
      for (let b = beats.length - 1; b >= 0; b--) {
        const n = beats[b].notes.find((x) => x.string === string);
        if (n) return n.fret;
      }
    }
    return 0;
  }

  private readNote(track: Track, beat: Beat, string: number): Note {
    const r = this.r;
    const v = this.version;
    const flags = r.u8();
    const note = newNote({ string });
    note.ghost = (flags & 0x04) !== 0;
    note.accent = (flags & 0x40) !== 0;
    if (v >= 500) note.heavyAccent = (flags & 0x02) !== 0;
    let type = 1;
    if (flags & 0x20) type = r.u8();
    if (v < 500 && flags & 0x01) r.skip(2); // independent duration + tuplet
    if (flags & 0x10) note.velocity = Math.min(127, Math.max(1, 16 * r.i8() - 1));
    if (flags & 0x20) {
      const fret = r.i8();
      note.fret = fret >= 0 && fret < 100 ? fret : 0;
    }
    if (flags & 0x80) r.skip(2); // fingering
    if (v >= 500) {
      if (flags & 0x01) note.durationPercent = r.f64();
      r.u8(); // flags2: swap accidentals
    }
    if (type === 2) {
      note.tieDestination = true;
      note.fret = this.previousFret(track, beat, string);
    } else if (type === 3) {
      note.dead = true;
    }
    if (flags & 0x08) {
      if (v < 400) this.readNoteEffectsGp3(note);
      else this.readNoteEffects(note);
    }
    if (track.isPercussion) note.midi = note.fret;
    return note;
  }

  private readGrace(): Note['grace'] {
    const r = this.r;
    if (this.version >= 500) {
      const fret = r.u8();
      r.u8(); // dynamic
      const transition = r.u8();
      const duration = r.u8();
      const flags = r.u8();
      return {
        fret,
        duration: graceTicks(duration),
        dead: (flags & 0x01) !== 0,
        onBeat: (flags & 0x02) !== 0,
        transition: graceTransition(transition),
      };
    }
    const fret = r.i8();
    r.u8();
    const duration = r.u8();
    const transition = r.i8();
    return { fret: Math.max(0, fret), duration: graceTicks(duration), dead: fret === -1, onBeat: false, transition: graceTransition(transition) };
  }

  private readNoteEffectsGp3(note: Note) {
    const flags = this.r.u8();
    note.hammer = (flags & 0x02) !== 0;
    note.letRing = (flags & 0x08) !== 0;
    if (flags & 0x01) note.bend = this.readBend();
    if (flags & 0x10) note.grace = this.readGrace();
    if (flags & 0x04) note.slide = newSlide({ shift: true });
  }

  private readNoteEffects(note: Note) {
    const r = this.r;
    const v = this.version;
    const flags1 = r.i8();
    const flags2 = r.i8();
    note.hammer = (flags1 & 0x02) !== 0;
    note.letRing = (flags1 & 0x08) !== 0;
    note.staccato = (flags2 & 0x01) !== 0;
    note.palmMute = (flags2 & 0x02) !== 0;
    if (flags2 & 0x40) note.vibrato = 'slight';
    if (flags1 & 0x01) note.bend = this.readBend();
    if (flags1 & 0x10) note.grace = this.readGrace();
    if (flags2 & 0x04) {
      const speed = r.i8();
      note.tremoloPicking = speed === 1 ? 480 : speed === 3 ? 120 : 240;
    }
    if (flags2 & 0x08) {
      if (v >= 500) {
        const s = r.u8();
        note.slide = newSlide({
          shift: (s & 0x01) !== 0,
          legato: (s & 0x02) !== 0,
          outDown: (s & 0x04) !== 0,
          outUp: (s & 0x08) !== 0,
          inBelow: (s & 0x10) !== 0,
          inAbove: (s & 0x20) !== 0,
        });
      } else {
        const s = r.i8();
        note.slide = newSlide({ shift: s === 1, legato: s === 2, outDown: s === 3, outUp: s === 4, inBelow: s === -1, inAbove: s === -2 });
      }
    }
    if (flags2 & 0x10) {
      const type = r.i8();
      if (v >= 500) {
        if (type === 2) r.skip(3);
        if (type === 3) note.harmonicFret = r.u8();
        note.harmonic = (['natural', 'artificial', 'tapped', 'pinch', 'semi'] as const)[type - 1] ?? 'natural';
      } else {
        note.harmonic =
          type === 1 ? 'natural' : type === 3 ? 'tapped' : type === 4 ? 'pinch' : type === 5 ? 'semi' : 'artificial';
      }
      if (note.harmonic === 'natural' && !note.harmonicFret) note.harmonicFret = note.fret;
    }
    if (flags2 & 0x20) {
      const fret = r.i8();
      const period = r.i8();
      note.trill = { fret, duration: period === 1 ? 240 : period === 2 ? 120 : 60 };
    }
  }
}

function graceTicks(raw: number): number {
  // 1 = 32nd, 2 = 16th, 3 = 8th
  return raw === 3 ? 480 : raw === 2 ? 240 : 120;
}

function graceTransition(raw: number): NonNullable<Note['grace']>['transition'] {
  return raw === 1 ? 'slide' : raw === 2 ? 'bend' : raw === 3 ? 'hammer' : 'none';
}
