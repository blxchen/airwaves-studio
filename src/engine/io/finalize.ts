// Post-processing shared by all formats: links ties and hammer-ons, sorts tempo changes.
import type { Note, Song } from '../model';

export function finalizeSong(song: Song): Song {
  song.tempoChanges.sort((a, b) => a.measure - b.measure || a.tick - b.tick);
  if (!song.tempo || song.tempo < 10) song.tempo = 120;

  for (const track of song.tracks) {
    // Walk every voice in order, remembering the last note per string.
    const voiceCount = Math.max(...track.measures.map((m) => m.voices.length));
    for (let v = 0; v < voiceCount; v++) {
      const last = new Map<number, Note>();
      for (const measure of track.measures) {
        for (const beat of measure.voices[v]?.beats ?? []) {
          for (const note of beat.notes) {
            const key = track.isPercussion ? 1000 + (note.midi ?? note.fret) : note.string;
            const prev = last.get(key);
            if (prev) {
              if (note.tieDestination) {
                prev.tieOrigin = true;
                note.fret = prev.fret;
              }
              if (prev.hammer) note.hammerDestination = true;
            } else {
              note.tieDestination = false;
            }
            last.set(key, note);
          }
        }
      }
    }
  }
  return song;
}
