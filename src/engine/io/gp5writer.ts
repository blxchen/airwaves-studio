// Guitar Pro 5.10 writer. Saves edited songs in a standard format that other tab programs open.
import { type Beat, type BendPoint, type Note, type Song, type Track } from '../model';

class Writer {
  private chunks: number[] = [];
  private enc = new TextEncoder();

  u8(v: number) {
    this.chunks.push(v & 0xff);
  }
  i8(v: number) {
    this.u8(v < 0 ? v + 256 : v);
  }
  bool(v: boolean) {
    this.u8(v ? 1 : 0);
  }
  i16(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }
  i32(v: number) {
    for (let i = 0; i < 4; i++) this.u8(v >> (8 * i));
  }
  f64(v: number) {
    const b = new Uint8Array(new Float64Array([v]).buffer);
    for (const x of b) this.u8(x);
  }
  private latin1(s: string): number[] {
    // Guitar Pro strings are single-byte (cp1252); drop characters outside Latin-1.
    return [...s].map((c) => c.charCodeAt(0)).map((c) => (c < 256 ? c : 63));
  }
  byteSizeString(s: string, size: number) {
    const bytes = this.latin1(s).slice(0, size);
    this.u8(bytes.length);
    for (let i = 0; i < size; i++) this.u8(bytes[i] ?? 0);
  }
  intByteSizeString(s: string) {
    const bytes = this.latin1(s).slice(0, 254);
    this.i32(bytes.length + 1);
    this.u8(bytes.length);
    for (const b of bytes) this.u8(b);
  }
  intSizeString(s: string) {
    const bytes = this.enc.encode(s);
    this.i32(bytes.length);
    for (const b of bytes) this.u8(b);
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

const DURATION_CODE: Record<number, number> = { 1: -2, 2: -1, 4: 0, 8: 1, 16: 2, 32: 3, 64: 4, 128: 4 };

function channelFor(track: Track, index: number): number {
  if (track.isPercussion) return 9;
  const c = index % 15;
  return c >= 9 ? c + 1 : c; // skip the drum channel
}

export function writeGp5(song: Song): Uint8Array {
  const w = new Writer();
  w.byteSizeString('FICHIER GUITAR PRO v5.10', 30);

  for (const s of [song.title, song.subtitle, song.artist, song.album, song.words, song.music, '', song.tabber, '']) w.intByteSizeString(s);
  w.i32(0); // notices

  w.i32(0); // lyrics track
  for (let i = 0; i < 5; i++) {
    w.i32(0);
    w.intSizeString('');
  }

  // RSE master effect.
  w.i32(100);
  w.i32(0);
  for (let i = 0; i < 11; i++) w.i8(0);

  // Page setup.
  for (const v of [210, 297, 10, 10, 15, 10, 100]) w.i32(v);
  w.i16(0x01ff);
  for (const s of ['%TITLE%', '%SUBTITLE%', '%ARTIST%', '%ALBUM%', 'Words by %WORDS%', 'Music by %MUSIC%', 'Words & Music by %WORDSMUSIC%', 'Copyright %COPYRIGHT%', 'All Rights Reserved - International Copyright Secured', 'Page %N%/%P%']) {
    w.intByteSizeString(s);
  }
  w.intByteSizeString('Moderate');
  w.i32(Math.round(song.tempo));
  w.bool(false); // hide tempo
  w.i8(song.measures[0]?.keySignature ?? 0);
  w.i32(0); // octave

  // 64 MIDI channels.
  const programs = new Map<number, Track>();
  song.tracks.forEach((t, i) => programs.set(channelFor(t, i), t));
  for (let i = 0; i < 64; i++) {
    const t = programs.get(i % 16);
    w.i32(t ? (t.isPercussion ? 0 : t.program) : 24);
    w.i8(t ? Math.round(Math.min(1, t.volume) * 16) : 13);
    w.i8(t ? Math.round(t.pan * 8 + 8) : 8);
    w.i8(0);
    w.i8(0);
    w.i8(0);
    w.i8(0);
    w.u8(0);
    w.u8(0);
  }
  for (let i = 0; i < 19; i++) w.i16(-1); // directions
  w.i32(0); // master reverb

  w.i32(song.measures.length);
  w.i32(song.tracks.length);

  // Measure headers.
  song.measures.forEach((h, i) => {
    const prev = song.measures[i - 1];
    if (i > 0) w.u8(0);
    let flags = 0;
    if (!prev || prev.numerator !== h.numerator) flags |= 0x01;
    if (!prev || prev.denominator !== h.denominator) flags |= 0x02;
    if (h.repeatOpen) flags |= 0x04;
    if (h.repeatClose > 0) flags |= 0x08;
    if (h.alternateEndings) flags |= 0x10;
    if (h.marker) flags |= 0x20;
    if (prev && prev.keySignature !== h.keySignature) flags |= 0x40;
    if (h.doubleBar) flags |= 0x80;
    w.u8(flags);
    if (flags & 0x01) w.i8(h.numerator);
    if (flags & 0x02) w.i8(h.denominator);
    if (flags & 0x08) w.i8(Math.max(2, h.repeatClose));
    if (flags & 0x20) {
      w.intByteSizeString(h.marker!);
      w.u8(200);
      w.u8(40);
      w.u8(40);
      w.u8(0);
    }
    if (flags & 0x40) {
      w.i8(h.keySignature);
      w.i8(0);
    }
    if (flags & 0x10) w.u8(h.alternateEndings);
    if (flags & 0x03) for (let k = 0; k < 4; k++) w.u8(2);
    if (!(flags & 0x10)) w.u8(0);
    w.u8(h.tripletFeel === 'eighth' ? 1 : h.tripletFeel === 'sixteenth' ? 2 : 0);
  });

  // Tracks.
  song.tracks.forEach((t, i) => {
    if (i === 0) w.u8(0);
    w.u8((t.isPercussion ? 0x01 : 0) | 0x08);
    w.byteSizeString(t.name, 40);
    const strings = t.isPercussion ? 6 : Math.max(1, Math.min(7, t.tuning.length));
    w.i32(strings);
    for (let k = 0; k < 7; k++) w.i32(t.isPercussion ? 0 : (t.tuning[k] ?? 0));
    w.i32(1); // port
    const ch = channelFor(t, i) + 1;
    w.i32(ch);
    w.i32(ch);
    w.i32(t.fretCount || 24);
    w.i32(t.capo);
    w.u8(255);
    w.u8(0);
    w.u8(0);
    w.u8(0);
    w.i16(0x0003); // show tablature + notation
    w.u8(0); // auto accentuation
    w.u8(0); // bank
    w.u8(0); // humanize
    w.i32(0);
    w.i32(0);
    w.i32(100);
    for (let k = 0; k < 12; k++) w.u8(0);
    w.i32(-1); // RSE instrument
    w.i32(0);
    w.i32(0);
    w.i32(-1);
    for (let k = 0; k < 4; k++) w.u8(0); // equalizer
    w.intByteSizeString('');
    w.intByteSizeString('');
  });
  w.u8(0);

  // Measures.
  song.measures.forEach((h, m) => {
    song.tracks.forEach((t, ti) => {
      const measure = t.measures[m];
      for (let v = 0; v < 2; v++) {
        let beats = measure?.voices[v]?.beats ?? [];
        if (v === 0 && beats.length === 0) beats = [{ ...restBeat(h.length) }];
        w.i32(beats.length);
        for (const beat of beats) writeBeat(w, song, t, ti, m, beat, v === 0);
      }
      w.u8(0); // line break
    });
  });
  return w.bytes();
}

function restBeat(length: number): Beat {
  return {
    start: 0,
    duration: length,
    value: 1,
    dots: 0,
    tuplet: null,
    rest: true,
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
  };
}

function writeBend(w: Writer, points: BendPoint[]) {
  const peak = Math.max(...points.map((p) => Math.abs(p.value)));
  w.i8(1);
  w.i32(Math.round(peak * 50));
  w.i32(points.length);
  for (const p of points) {
    w.i32(Math.round(p.position * 60));
    w.i32(Math.round(p.value * 50));
    w.bool(false);
  }
}

function writeBeat(w: Writer, song: Song, track: Track, trackIndex: number, measure: number, beat: Beat, primary: boolean) {
  // Mix table: tempo changes (first track only) and instrument changes.
  const tempo = primary && trackIndex === 0 ? song.tempoChanges.find((c) => c.measure === measure && c.tick === beat.start) : undefined;
  const instrumentChange = primary ? track.instrumentChanges.find((c) => c.measure === measure && c.tick === beat.start) : undefined;
  const hasMix = !!tempo || !!instrumentChange;
  const rest = beat.rest || beat.notes.length === 0;
  const hasEffects = beat.vibrato !== 'none' || beat.fadeIn || beat.slap !== 'none' || !!beat.tremoloBar || beat.stroke !== 'none' || beat.pickStroke !== 'none';

  let flags = 0;
  if (beat.dots) flags |= 0x01;
  if (beat.text) flags |= 0x04;
  if (hasEffects) flags |= 0x08;
  if (hasMix) flags |= 0x10;
  if (beat.tuplet) flags |= 0x20;
  if (rest) flags |= 0x40;
  w.u8(flags);
  if (rest) w.u8(2);
  w.i8(DURATION_CODE[beat.value] ?? 0);
  if (beat.tuplet) w.i32(beat.tuplet.enters);
  if (beat.text) w.intByteSizeString(beat.text);

  if (hasEffects) {
    let f1 = 0;
    let f2 = 0;
    if (beat.vibrato !== 'none') f1 |= 0x02;
    if (beat.fadeIn) f1 |= 0x10;
    if (beat.slap !== 'none') f1 |= 0x20;
    if (beat.stroke !== 'none') f1 |= 0x40;
    if (beat.tremoloBar) f2 |= 0x04;
    if (beat.pickStroke !== 'none') f2 |= 0x02;
    w.i8(f1);
    w.i8(f2);
    if (f1 & 0x20) w.i8(beat.slap === 'tap' ? 1 : beat.slap === 'slap' ? 2 : 3);
    if (f2 & 0x04) writeBend(w, beat.tremoloBar!);
    if (f1 & 0x40) {
      w.i8(beat.stroke === 'up' ? 2 : 0);
      w.i8(beat.stroke === 'down' ? 2 : 0);
    }
    if (f2 & 0x02) w.i8(beat.pickStroke === 'up' ? 1 : 2);
  }

  if (hasMix) {
    w.i8(instrumentChange ? instrumentChange.program : -1);
    w.i32(-1); // RSE instrument
    w.i32(0);
    w.i32(0);
    w.i32(-1);
    for (let k = 0; k < 6; k++) w.i8(-1); // volume, balance, chorus, reverb, phaser, tremolo
    w.intByteSizeString('');
    w.i32(tempo ? Math.round(tempo.bpm) : -1);
    if (tempo) {
      w.i8(0);
      w.bool(false);
    }
    w.i8(0); // apply-to-all flags
    w.i8(-1); // wah
    w.intByteSizeString('');
    w.intByteSizeString('');
  }

  // Notes, highest string first; one note per string.
  const byRow = new Map<number, Note>();
  if (!rest) {
    beat.notes.forEach((n, i) => {
      const row = track.isPercussion ? i : n.string;
      if (row >= 0 && row < 7 && !byRow.has(row)) byRow.set(row, n);
    });
  }
  let stringFlags = 0;
  for (const row of byRow.keys()) stringFlags |= 1 << (6 - row);
  w.u8(stringFlags);
  for (let row = 0; row < 7; row++) {
    const n = byRow.get(row);
    if (n) writeNote(w, track, n);
  }
  w.i16(0);
}

function writeNote(w: Writer, track: Track, n: Note) {
  const hasEffects =
    !!n.bend || n.hammer || n.letRing || !!n.grace || n.staccato || n.palmMute || !!n.tremoloPicking || !!n.slide || !!n.harmonic || !!n.trill || n.vibrato !== 'none';
  const percent = n.durationPercent && Math.abs(n.durationPercent - 1) > 0.001;
  let flags = 0x10 | 0x20;
  if (percent) flags |= 0x01;
  if (n.heavyAccent) flags |= 0x02;
  if (n.ghost) flags |= 0x04;
  if (hasEffects) flags |= 0x08;
  if (n.accent) flags |= 0x40;
  w.u8(flags);
  w.u8(n.tieDestination ? 2 : n.dead ? 3 : 1);
  w.i8(Math.max(1, Math.min(8, Math.round((n.velocity + 1) / 16))));
  const fret = track.isPercussion ? (n.midi ?? n.fret) : n.fret;
  w.i8(Math.max(0, Math.min(99, fret)));
  if (percent) w.f64(n.durationPercent);
  w.u8(0);

  if (!hasEffects) return;
  let f1 = 0;
  let f2 = 0;
  if (n.bend) f1 |= 0x01;
  if (n.hammer) f1 |= 0x02;
  if (n.letRing) f1 |= 0x08;
  if (n.grace) f1 |= 0x10;
  if (n.staccato) f2 |= 0x01;
  if (n.palmMute) f2 |= 0x02;
  if (n.tremoloPicking) f2 |= 0x04;
  if (n.slide) f2 |= 0x08;
  if (n.harmonic) f2 |= 0x10;
  if (n.trill) f2 |= 0x20;
  if (n.vibrato !== 'none') f2 |= 0x40;
  w.i8(f1);
  w.i8(f2);
  if (n.bend) writeBend(w, n.bend);
  if (n.grace) {
    const g = n.grace;
    w.u8(g.fret);
    w.u8(6);
    w.u8(g.transition === 'slide' ? 1 : g.transition === 'bend' ? 2 : g.transition === 'hammer' ? 3 : 0);
    w.u8(g.duration >= 480 ? 3 : g.duration >= 240 ? 2 : 1);
    w.u8((g.dead ? 0x01 : 0) | (g.onBeat ? 0x02 : 0));
  }
  if (n.tremoloPicking) w.i8(n.tremoloPicking >= 480 ? 1 : n.tremoloPicking >= 240 ? 2 : 3);
  if (n.slide) {
    const s = n.slide;
    w.u8((s.shift ? 0x01 : 0) | (s.legato ? 0x02 : 0) | (s.outDown ? 0x04 : 0) | (s.outUp ? 0x08 : 0) | (s.inBelow ? 0x10 : 0) | (s.inAbove ? 0x20 : 0));
  }
  if (n.harmonic) {
    const type = { natural: 1, artificial: 2, tapped: 3, pinch: 4, semi: 5, feedback: 1 }[n.harmonic];
    w.i8(type);
    if (type === 2) {
      w.u8(0);
      w.i8(0);
      w.u8(1);
    }
    if (type === 3) w.u8(n.harmonicFret || n.fret + 12);
  }
  if (n.trill) {
    w.i8(n.trill.fret);
    w.i8(n.trill.duration >= 240 ? 1 : n.trill.duration >= 120 ? 2 : 3);
  }
}
