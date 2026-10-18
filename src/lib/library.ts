import { addSong, listSongs, saveSongFile, type SongMeta } from './db';
import { writeGp5 } from '../engine/io/gp5writer';
import { createSong, type TrackSpec } from '../engine/edit';
import { loadSong, serializeSong, SUPPORTED_EXTENSIONS } from '../engine/io/load';
import type { Song } from '../engine/model';

export const ACCEPTED_EXTENSIONS = SUPPORTED_EXTENSIONS;
// File-system safe name (Windows forbids \ / : * ? " < > |).
const safeName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'tab';

const SEEDED_KEY = 'riffbox.seeded.v2';
const DEMO_URL = `${import.meta.env.BASE_URL}demo/night-drive.gp5`;

function formatOf(name: string, bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(1, 31));
  const m = head.match(/v(\d)\.(\d\d)/);
  if (m) return `GP${m[1]}`;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'GP7';
  if (name.toLowerCase().endsWith('.gpx')) return 'GP6';
  return 'GP';
}

function metaFrom(song: Song, fileName: string, format: string): SongMeta {
  return {
    id: crypto.randomUUID(),
    title: song.title.trim() || fileName.replace(/\.[^.]+$/, ''),
    artist: song.artist.trim() || 'Unknown artist',
    album: song.album.trim(),
    fileName,
    format,
    tempo: song.tempo,
    bars: song.measures.length,
    tracks: song.tracks.map((t) => ({ name: t.name, program: t.program, isPercussion: t.isPercussion, strings: t.tuning.length })),
    addedAt: Date.now(),
    openedAt: 0,
    favorite: false,
    prefs: {},
  };
}

export async function importFile(file: File): Promise<SongMeta> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let song: Song;
  try {
    song = await loadSong(file.name, bytes);
  } catch (e) {
    throw new Error(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const meta = metaFrom(song, file.name, formatOf(file.name, bytes));
  await addSong(meta, bytes);
  return meta;
}

let seeding: Promise<void> | null = null;

// Adds the bundled original demo song the first time the app runs.
export function seedDemoIfNeeded(): Promise<void> {
  seeding ??= seedDemo();
  return seeding;
}

async function seedDemo(): Promise<void> {
  if (localStorage.getItem(SEEDED_KEY)) return;
  const existing = await listSongs();
  if (!existing.some((s) => s.fileName === 'night-drive.gp5')) {
    const res = await fetch(DEMO_URL);
    if (!res.ok) throw new Error('Demo song missing');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const song = await loadSong('night-drive.gp5', bytes);
    await addSong({ ...metaFrom(song, 'night-drive.gp5', 'GP5'), favorite: true }, bytes);
  }
  localStorage.setItem(SEEDED_KEY, '1');
}

// Saves an edited song back into the library in the lossless Riffbox format.
export async function saveEditedSong(id: string, song: Song): Promise<void> {
  const bytes = serializeSong(song);
  const m = metaFrom(song, '', 'Riffbox');
  await saveSongFile(id, bytes, {
    title: m.title,
    artist: m.artist,
    album: m.album,
    format: 'Edited',
    fileName: `${safeName(m.title)}.riffbox`,
    tempo: m.tempo,
    bars: m.bars,
    tracks: m.tracks,
  });
}

// Creates a blank tab and returns its id.
export async function createBlankSong(title: string, artist: string, tempo: number, spec: TrackSpec): Promise<string> {
  const song = createSong(title, artist, tempo, spec);
  const bytes = writeGp5(song);
  const fileName = `${safeName(song.title)}.gp5`;
  const meta = metaFrom(song, fileName, 'GP5');
  await addSong({ ...meta, openedAt: Date.now() }, bytes);
  return meta.id;
}

export function downloadSong(song: Song) {
  const blob = new Blob([writeGp5(song)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName(song.title)}.gp5`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
