import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteSong, listSongs, updateSong, type SongMeta } from '../lib/db';
import { ACCEPTED_EXTENSIONS, importFile } from '../lib/library';
import { instrumentOf, KIND_COLOR, KIND_ICON } from '../lib/instruments';
import { openSong } from '../App';
import Icon from './Icon';
import NewTabDialog from './NewTabDialog';

type Filter = 'all' | 'favorites' | 'recent';

export default function Library() {
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [messages, setMessages] = useState<{ kind: 'ok' | 'error'; text: string }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const refresh = useCallback(() => listSongs().then(setSongs), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchInput.current) {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      setBusy(true);
      const results: { kind: 'ok' | 'error'; text: string }[] = [];
      let last: SongMeta | null = null;
      for (const file of Array.from(files)) {
        try {
          last = await importFile(file);
          results.push({ kind: 'ok', text: `Added “${last.title}”` });
        } catch (e) {
          results.push({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
        }
      }
      setMessages(results);
      setBusy(false);
      await refresh();
      // A single successful import opens straight into the player.
      if (results.length === 1 && last) openSong(last.id);
    },
    [refresh],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = songs.filter(
      (s) => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.album.toLowerCase().includes(q),
    );
    if (filter === 'favorites') list = list.filter((s) => s.favorite);
    if (filter === 'recent') list = list.filter((s) => s.openedAt > 0).sort((a, b) => b.openedAt - a.openedAt);
    else list = list.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    return list;
  }, [songs, query, filter]);

  const toggleFavorite = async (song: SongMeta) => {
    await updateSong(song.id, { favorite: !song.favorite });
    refresh();
  };

  const remove = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    await deleteSong(id);
    setConfirmDelete(null);
    refresh();
  };

  return (
    <div
      className="library"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
      }}
    >
      <header className="lib-header">
        <div className="brand">
          <Logo />
          <span>Riffbox</span>
        </div>
        <label className="search">
          <Icon name="search" size={16} />
          <input
            ref={searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your tabs by song or artist"
            aria-label="Search library"
          />
          <kbd>/</kbd>
        </label>
        <button className="btn" onClick={() => setShowNew(true)}>
          <Icon name="plus" size={16} />
          New tab
        </button>
        <button className="btn primary" onClick={() => fileInput.current?.click()} disabled={busy}>
          <Icon name="upload" size={16} />
          {busy ? 'Importing…' : 'Import tabs'}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={ACCEPTED_EXTENSIONS.join(',')}
          onChange={(e) => {
            if (e.target.files?.length) importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </header>

      <main className="lib-main">
        <div className="lib-toolbar">
          <div className="segmented" role="tablist">
            {(['all', 'favorites', 'recent'] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All tabs' : f === 'favorites' ? 'Favorites' : 'Recently played'}
              </button>
            ))}
          </div>
          <span className="muted">
            {visible.length} of {songs.length} {songs.length === 1 ? 'song' : 'songs'}
          </span>
        </div>

        {messages.length > 0 && (
          <div className="notices">
            {messages.map((m, i) => (
              <div key={i} className={`notice ${m.kind}`}>
                {m.text}
              </div>
            ))}
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setMessages([])}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="empty">
            {songs.length === 0 ? (
              <>
                <h2>Your library is empty</h2>
                <p>Drop Guitar Pro files here, or use Import tabs.</p>
              </>
            ) : (
              <p>No songs match “{query}”.</p>
            )}
          </div>
        ) : (
          <ul className="song-list">
            {visible.map((s) => (
              <li key={s.id} className="song-row" onClick={() => openSong(s.id)}>
                <button
                  className={`star ${s.favorite ? 'on' : ''}`}
                  aria-label={s.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(s);
                  }}
                >
                  <Icon name="star" size={16} filled={s.favorite} />
                </button>
                <div className="song-text">
                  <a
                    href={`#/song/${s.id}`}
                    className="song-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {s.title}
                  </a>
                  <span className="song-artist">{s.artist}</span>
                </div>
                <div className="song-tracks" aria-label={`${s.tracks.length} tracks`}>
                  {s.tracks.slice(0, 6).map((t, i) => {
                    const { kind, family } = instrumentOf(t.program, t.isPercussion);
                    return (
                      <span key={i} className="track-dot" title={`${t.name} · ${family}`} style={{ color: KIND_COLOR[kind] }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <path d={KIND_ICON[kind]} />
                        </svg>
                      </span>
                    );
                  })}
                  {s.tracks.length > 6 && <span className="muted small">+{s.tracks.length - 6}</span>}
                </div>
                <span className="badge">{s.format}</span>
                <button
                  className={`icon-btn danger ${confirmDelete === s.id ? 'confirm' : ''}`}
                  aria-label={confirmDelete === s.id ? 'Click again to delete' : 'Delete song'}
                  title={confirmDelete === s.id ? 'Click again to delete' : 'Delete'}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(s.id);
                  }}
                  onBlur={() => setConfirmDelete((c) => (c === s.id ? null : c))}
                >
                  {confirmDelete === s.id ? <span className="small">Delete?</span> : <Icon name="trash" size={16} />}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="formats muted small">
          Opens Guitar Pro 3–8 files (.gp3 .gp4 .gp5 .gpx .gp). Everything stays on this device.
        </p>
      </main>

      {showNew && <NewTabDialog onClose={() => setShowNew(false)} />}

      {dragging && (
        <div className="drop-overlay">
          <div>
            <Icon name="upload" size={36} />
            <p>Drop tab files to add them to your library</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M7 11h18M7 16h18M7 21h18" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".9" />
      <circle cx="13" cy="16" r="3.2" fill="var(--warm)" />
    </svg>
  );
}
