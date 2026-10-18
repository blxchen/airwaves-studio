// Local library persisted in IndexedDB. Metadata and file bytes live in
// separate stores so listing the library never loads every file into memory.

export interface TrackSummary {
  name: string;
  program: number;
  isPercussion: boolean;
  strings: number;
}

import type { ToneSettings } from '../engine/audio/tone';

export interface SongPrefs {
  tones?: Record<number, ToneSettings>;
  trackIndex?: number;
  speed?: number;
  mixer?: Record<number, { volume: number; mute: boolean; solo: boolean }>;
}

export interface SongMeta {
  id: string;
  title: string;
  artist: string;
  album: string;
  fileName: string;
  format: string;
  tempo: number;
  bars: number;
  tracks: TrackSummary[];
  addedAt: number;
  openedAt: number;
  favorite: boolean;
  prefs: SongPrefs;
}

const DB_NAME = 'riffbox';
const DB_VERSION = 2;
const META = 'songs';
const FILES = 'files';
const SAMPLES = 'samples';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(SAMPLES)) db.createObjectStore(SAMPLES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listSongs(): Promise<SongMeta[]> {
  const db = await openDb();
  return result(db.transaction(META).objectStore(META).getAll() as IDBRequest<SongMeta[]>);
}

export async function getSong(id: string): Promise<SongMeta | undefined> {
  const db = await openDb();
  return result(db.transaction(META).objectStore(META).get(id) as IDBRequest<SongMeta | undefined>);
}

export async function getSongFile(id: string): Promise<Uint8Array | undefined> {
  const db = await openDb();
  const buf = await result(db.transaction(FILES).objectStore(FILES).get(id) as IDBRequest<ArrayBuffer | undefined>);
  return buf ? new Uint8Array(buf) : undefined;
}

export async function addSong(meta: SongMeta, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, FILES], 'readwrite');
  tx.objectStore(META).put(meta);
  tx.objectStore(FILES).put(bytes.slice().buffer, meta.id);
  await done(tx);
}

export async function updateSong(id: string, patch: Partial<SongMeta>): Promise<SongMeta | undefined> {
  const db = await openDb();
  const tx = db.transaction(META, 'readwrite');
  const store = tx.objectStore(META);
  const current = await result(store.get(id) as IDBRequest<SongMeta | undefined>);
  if (!current) return undefined;
  const next = { ...current, ...patch, prefs: { ...current.prefs, ...patch.prefs } };
  store.put(next);
  await done(tx);
  return next;
}

export async function deleteSong(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, FILES], 'readwrite');
  tx.objectStore(META).delete(id);
  tx.objectStore(FILES).delete(id);
  await done(tx);
}

// Replaces a song's file (after editing) together with its metadata.
export async function saveSongFile(id: string, bytes: Uint8Array, patch: Partial<SongMeta>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, FILES], 'readwrite');
  const metaStore = tx.objectStore(META);
  const current = await result(metaStore.get(id) as IDBRequest<SongMeta | undefined>);
  if (current) metaStore.put({ ...current, ...patch, prefs: { ...current.prefs, ...patch.prefs } });
  tx.objectStore(FILES).put(bytes.slice().buffer, id);
  await done(tx);
}

// User-loaded audio samples (e.g. drum hits from the user's own sample library).
export async function putSample(id: string, name: string, data: ArrayBuffer): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SAMPLES, 'readwrite');
  tx.objectStore(SAMPLES).put({ name, data }, id);
  await done(tx);
}

export async function getSample(id: string): Promise<{ name: string; data: ArrayBuffer } | undefined> {
  const db = await openDb();
  return result(db.transaction(SAMPLES).objectStore(SAMPLES).get(id) as IDBRequest<{ name: string; data: ArrayBuffer } | undefined>);
}
