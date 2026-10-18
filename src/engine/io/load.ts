// Detects the file type, parses it, and normalises the result.
import type { Song } from '../model';
import { isGp345, parseGp345 } from './gp345';
import { isGpx, isZip, readGpxFiles, readZipEntries, type Inflate } from './containers';
import { parseGpif } from './gpif';
import { finalizeSong } from './finalize';

export const SUPPORTED_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx'];

let inflate: Inflate = async (data) => {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

// Lets Node-based tests swap in zlib.
export function setInflate(fn: Inflate) {
  inflate = fn;
}

// Riffbox's own lossless format for edited tabs (keeps everything, e.g. hairpins).
const MAGIC = 'RIFFBOX1';

export function serializeSong(song: Song): Uint8Array {
  return new TextEncoder().encode(MAGIC + JSON.stringify(song));
}

function isRiffbox(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) === MAGIC;
}

export async function loadSong(fileName: string, bytes: Uint8Array): Promise<Song> {
  let song: Song;
  if (isRiffbox(bytes)) {
    song = JSON.parse(new TextDecoder().decode(bytes.subarray(MAGIC.length))) as Song;
    // Older saves may miss newer fields.
    for (const t of song.tracks) {
      t.instrumentChanges ??= [];
      for (const m of t.measures) for (const v of m.voices) for (const b of v.beats) b.hairpin ??= null;
    }
  } else if (isGp345(bytes)) {
    song = parseGp345(bytes);
  } else if (isZip(bytes)) {
    const entries = await readZipEntries(bytes, inflate, (n) => n.endsWith('score.gpif'));
    const gpif = [...entries.values()][0];
    if (!gpif) throw new Error('This .gp file has no score inside');
    song = parseGpif(new TextDecoder().decode(gpif));
  } else if (isGpx(bytes)) {
    const gpif = readGpxFiles(bytes).get('score.gpif');
    if (!gpif) throw new Error('This .gpx file has no score inside');
    song = parseGpif(new TextDecoder().decode(gpif));
  } else {
    throw new Error(`${fileName} is not a Guitar Pro file (supported: ${SUPPORTED_EXTENSIONS.join(' ')})`);
  }
  if (!song.measures.length || !song.tracks.length) throw new Error('The file contains no music');
  return finalizeSong(song);
}
