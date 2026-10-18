import { useCallback, useEffect, useRef, useState } from 'react';
import { getSong, getSongFile, updateSong, type SongMeta } from '../lib/db';
import { downloadSong, saveEditedSong } from '../lib/library';
import { loadSong } from '../engine/io/load';
import type { DurationValue, Note, Song } from '../engine/model';
import {
  beatAt,
  bendKind,
  clampCaret,
  cloneSong,
  deleteBeat,
  DURATIONS,
  insertBeat,
  insertMeasure,
  removeNote,
  rowCount,
  setBend,
  setDuration,
  setFret,
  stepCaret,
  toggleDot,
  toggleNoteFlag,
  toggleRest,
  toggleSlide,
  toggleTriplet,
  toggleVibrato,
  toggleHairpin,
  toggleGrace,
  type Caret,
} from '../engine/edit';
import { useTabPlayer } from '../player/usePlayer';
import { openLibrary } from '../App';
import ControlBar, { type Readout } from './ControlBar';
import EditorToolbar, { type EditOp } from './EditorToolbar';
import Fretboard from './Fretboard';
import SheetView, { type SheetHandle } from './SheetView';
import TrackList from './TrackList';
import ToneDrawer from './ToneDrawer';
import Icon from './Icon';
import { Logo } from './Library';

const PLAY_SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['E', 'Edit the tab'],
  ['Esc', 'Clear selection, or back to start'],
  ['← / →', 'Previous / next bar'],
  ['↑ / ↓', 'Previous / next track'],
  ['1–9', 'Show track'],
  ['+ / −', 'Speed up / slow down'],
  ['L', 'Loop (the current bar if nothing is selected)'],
  ['C', 'Count-in'],
  ['M', 'Metronome'],
  ['F', 'Fretboard'],
  ['Shift+F', 'Fullscreen'],
  ['S', 'Solo the shown track'],
  ['Click', 'Move the tracker to a note'],
  ['Drag', 'Select bars to loop'],
];

const EDIT_SHORTCUTS: [string, string][] = [
  ['0–9', 'Type a fret (two digits quickly for 10–24)'],
  ['← → ↑ ↓', 'Move between beats and strings'],
  ['Del', 'Remove the note'],
  ['Ins', 'Insert a beat'],
  ['Ctrl+⌫', 'Delete the beat'],
  ['+ / −', 'Longer / shorter note'],
  ['. / T / R', 'Dotted / triplet / rest'],
  ['P L V H S', 'Palm mute, let ring, vibrato, hammer, slide'],
  ['B', 'Full bend on / off'],
  ['X G A', 'Dead note, ghost note, accent'],
  ['< / >', 'Crescendo / decrescendo'],
  ['F', 'Flam (drums) / grace note'],
  ['Ctrl+Z / Y', 'Undo / redo'],
  ['Ctrl+S', 'Save'],
  ['Esc', 'Stop editing'],
];

const EMPTY_READOUT: Readout = { seconds: 0, duration: 0, tick: 0, endTick: 0, measure: 0, bpm: 0 };
const HISTORY_LIMIT = 200;

export default function PlayerView({ songId, startEditing = false }: { songId: string; startEditing?: boolean }) {
  const player = useTabPlayer();
  const sheetRef = useRef<SheetHandle>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<SongMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readout, setReadout] = useState<Readout>(EMPTY_READOUT);
  const [activeNotes, setActiveNotes] = useState<Note[]>([]);
  const [showFretboard, setShowFretboard] = useState(() => localStorage.getItem('riffbox.fretboard') === '1');
  const [follow, setFollow] = useState(true);
  const [zoom, setZoomState] = useState(() => Number(localStorage.getItem('riffbox.zoom')) || 1);
  const [showHelp, setShowHelp] = useState(false);
  const [toneFor, setToneFor] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem('riffbox.sidebar') !== '0');

  // Editing state.
  const [editing, setEditing] = useState(startEditing);
  const [caret, setCaret] = useState<Caret>({ measure: 0, beat: 0, string: 0 });
  const [typing, setTyping] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leavePrompt, setLeavePrompt] = useState(false);
  const undoStack = useRef<{ song: Song; caret: Caret }[]>([]);
  const redoStack = useRef<{ song: Song; caret: Caret }[]>([]);
  const [, bumpHistory] = useState(0);
  const fretBuffer = useRef<{ value: number; at: number } | null>(null);

  const { load, song, track, trackIndex, playerRef, replaceSong } = player;

  // Read the file from the library and parse it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [m, bytes] = await Promise.all([getSong(songId), getSongFile(songId)]);
        if (cancelled) return;
        if (!m || !bytes) throw new Error('That song is not in your library.');
        const parsed = await loadSong(m.fileName, bytes);
        if (cancelled) return;
        setMeta(m);
        document.title = `${parsed.title || m.title} · ${parsed.artist || m.artist} — Riffbox`;
        load(parsed, m.prefs.trackIndex ?? 0);
        updateSong(songId, { openedAt: Date.now() });
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      document.title = 'Riffbox';
    };
  }, [songId, load]);

  // Restore saved speed / mixer once the engine and song are ready.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !player.ready || !song || !meta) return;
    restored.current = true;
    if (meta.prefs.speed) player.setSpeed(meta.prefs.speed);
    for (const [i, ch] of Object.entries(meta.prefs.mixer ?? {})) if (Number(i) < song.tracks.length) player.setChannel(Number(i), ch);
    for (const [i, tone] of Object.entries(meta.prefs.tones ?? {})) if (Number(i) < song.tracks.length) void player.setTone(Number(i), tone);
  }, [player, song, meta]);

  // Save playback preferences.
  useEffect(() => {
    if (!song || !restored.current) return;
    const t = setTimeout(() => {
      const mixer: Record<number, { volume: number; mute: boolean; solo: boolean }> = {};
      player.channels.forEach((c, i) => (mixer[i] = c));
      const tones: Record<number, (typeof player.tones)[number]> = {};
      player.tones.forEach((t, i) => (tones[i] = t));
      updateSong(songId, { prefs: { trackIndex, speed: player.speed, mixer, tones } });
    }, 400);
    return () => clearTimeout(t);
  }, [song, songId, trackIndex, player.speed, player.channels, player.tones]);

  // Fullscreen: hide the track list for the biggest possible tab.
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => setFullscreen((v) => !v));
  };
  useEffect(() => localStorage.setItem('riffbox.sidebar', sidebar ? '1' : '0'), [sidebar]);

  useEffect(() => localStorage.setItem('riffbox.fretboard', showFretboard ? '1' : '0'), [showFretboard]);
  const setZoom = (z: number) => {
    const v = Math.min(1.8, Math.max(0.6, Math.round(z * 10) / 10));
    setZoomState(v);
    localStorage.setItem('riffbox.zoom', String(v));
  };

  // Keep the caret valid when the track or song changes.
  useEffect(() => {
    if (song && track) setCaret((c) => clampCaret(song, track, c));
  }, [song, track]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // --- editing ------------------------------------------------------------------

  const songRef = useRef(song);
  songRef.current = song;
  const caretRef = useRef(caret);
  caretRef.current = caret;

  const apply = useCallback(
    (op: EditOp, coalesce = false) => {
      const current = songRef.current;
      if (!current) return;
      const next = cloneSong(current);
      const t = next.tracks[Math.min(trackIndex, next.tracks.length - 1)];
      const moved = op(next, t, caretRef.current);
      const finalTrack = next.tracks[Math.min(trackIndex, next.tracks.length - 1)];
      // A second digit of a fret replaces the first, so it shares its undo step.
      if (!coalesce || !undoStack.current.length) undoStack.current.push({ song: current, caret: caretRef.current });
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      replaceSong(next);
      setCaret(clampCaret(next, finalTrack, moved ?? caretRef.current));
      setDirty(true);
      bumpHistory((v) => v + 1);
    },
    [trackIndex, replaceSong],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev || !songRef.current) return;
    redoStack.current.push({ song: songRef.current, caret: caretRef.current });
    replaceSong(prev.song);
    setCaret(prev.caret);
    setDirty(true);
    bumpHistory((v) => v + 1);
  }, [replaceSong]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next || !songRef.current) return;
    undoStack.current.push({ song: songRef.current, caret: caretRef.current });
    replaceSong(next.song);
    setCaret(next.caret);
    setDirty(true);
    bumpHistory((v) => v + 1);
  }, [replaceSong]);

  const save = useCallback(async () => {
    const current = songRef.current;
    if (!current) return;
    setSaving(true);
    try {
      await saveEditedSong(songId, current);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [songId]);

  const leave = () => (dirty ? setLeavePrompt(true) : openLibrary());

  // --- animation loop: tracker, readout, fretboard ---------------------------------

  const followRef = useRef(follow);
  followRef.current = follow;
  useEffect(() => {
    if (!song || !track) return;
    let raf = 0;
    let lastReadout = 0;
    let lastBeatKey = '';
    let lastFrame = 0;
    const update = (now: number) => {
      const p = playerRef.current;
      if (!p || !p.order.length) return;
      const tick = p.currentTick();
      const pos = p.displayPosition(tick);
      sheetRef.current?.update(pos.measure, pos.tick, p.isPlaying && followRef.current);

      const measure = track.measures[pos.measure];
      const notes: Note[] = [];
      let key = `${pos.measure}`;
      for (const voice of measure?.voices ?? []) {
        for (const b of voice.beats) {
          if (b.start <= pos.tick && pos.tick < b.start + b.duration) {
            notes.push(...b.notes);
            key += `:${b.start}`;
          }
        }
      }
      if (key !== lastBeatKey) {
        lastBeatKey = key;
        setActiveNotes(notes);
      }
      if (now - lastReadout > 120) {
        lastReadout = now;
        const last = p.order[p.order.length - 1];
        setReadout({ seconds: p.currentSeconds(), duration: p.duration, tick, endTick: last.start + last.length, measure: pos.measure, bpm: p.bpmAt(tick) });
      }
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      lastFrame = now;
      update(now);
    };
    raf = requestAnimationFrame(frame);
    // Backup when the browser stops drawing frames (background tab, hidden window).
    const timer = setInterval(() => {
      const now = performance.now();
      if (now - lastFrame > 200) update(now);
    }, 120);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [song, track, playerRef, player.ready, player.looping, player.selection]);

  const gotoBar = useCallback(
    (delta: number) => {
      if (!song) return;
      player.seekTo(Math.min(song.measures.length - 1, Math.max(0, readout.measure + delta)), 0);
    },
    [song, readout.measure, player],
  );

  const toggleLoop = useCallback(() => {
    if (player.looping) player.setLoop(false, player.selection);
    else if (player.selection) player.setLoop(true, player.selection);
    else player.setSelection({ from: readout.measure, to: readout.measure });
  }, [player, readout.measure]);

  // --- keyboard ----------------------------------------------------------------------

  const editKey = (e: KeyboardEvent): boolean => {
    if (!song || !track) return false;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'z' || k === 'Z') && !e.shiftKey) return undo(), true;
    if (ctrl && (k === 'y' || k === 'Y' || ((k === 'z' || k === 'Z') && e.shiftKey))) return redo(), true;
    if (ctrl && (k === 's' || k === 'S')) return void save(), true;
    if (ctrl && k === 'Backspace') return apply(deleteBeat), true;
    if (ctrl || e.altKey) return false;

    if (/^[0-9]$/.test(k)) {
      const d = Number(k);
      const now = performance.now();
      const buf = fretBuffer.current;
      let fret = d;
      let second = false;
      if (buf && now - buf.at < 800 && buf.value * 10 + d <= 30 && buf.value > 0) {
        fret = buf.value * 10 + d;
        second = true;
        fretBuffer.current = null;
      } else {
        fretBuffer.current = { value: d, at: now };
      }
      apply((s, t, c) => setFret(s, t, c, fret), second);
      setTyping(true);
      setTimeout(() => setTyping(false), 250);
      return true;
    }
    fretBuffer.current = null;
    const step = (dir: 1 | -1) => {
      const c = caretRef.current;
      const next = stepCaret(song, track, c, dir);
      if (next === c && dir > 0) {
        // Past the last beat: add a bar and keep going.
        apply((s, _t, cc) => (insertMeasure(s, s.measures.length), { ...cc, measure: s.measures.length - 1, beat: 0 }));
      } else setCaret(next);
    };
    const flag = (f: Parameters<typeof toggleNoteFlag>[3]): EditOp => (s, t, c) => toggleNoteFlag(s, t, c, f);
    const lower = k.length === 1 ? k.toLowerCase() : k;
    switch (lower) {
      case 'ArrowRight':
        step(1);
        return true;
      case 'ArrowLeft':
        step(-1);
        return true;
      case 'ArrowUp':
        setCaret((c) => ({ ...c, string: Math.max(0, c.string - 1) }));
        return true;
      case 'ArrowDown':
        setCaret((c) => ({ ...c, string: Math.min(rowCount(track) - 1, c.string + 1) }));
        return true;
      case 'Delete':
      case 'Backspace':
        apply(removeNote);
        return true;
      case 'Insert':
        apply(insertBeat);
        return true;
      case '+':
      case '=':
      case '-':
      case '_': {
        const beat = beatAt(track, caretRef.current);
        if (!beat) return true;
        const i = DURATIONS.indexOf(beat.value);
        const next = DURATIONS[Math.max(0, Math.min(DURATIONS.length - 1, i + (lower === '-' || lower === '_' ? 1 : -1)))] as DurationValue;
        apply((s, t, c) => setDuration(s, t, c, next));
        return true;
      }
      case '.':
        apply(toggleDot);
        return true;
      case 't':
        apply(toggleTriplet);
        return true;
      case 'r':
        apply(toggleRest);
        return true;
      case 'p':
        apply(flag('palmMute'));
        return true;
      case 'l':
        apply(flag('letRing'));
        return true;
      case 'v':
        apply(toggleVibrato);
        return true;
      case 'h':
        apply(flag('hammer'));
        return true;
      case 's':
        apply((s, t, c) => toggleSlide(s, t, c, 'shift'));
        return true;
      case 'x':
        apply(flag('dead'));
        return true;
      case 'g':
        apply(flag('ghost'));
        return true;
      case 'a':
        apply(flag('accent'));
        return true;
      case 'f':
        apply(toggleGrace);
        return true;
      case '<':
        apply((s, t, c) => toggleHairpin(s, t, c, 'cresc'));
        return true;
      case '>':
        apply((s, t, c) => toggleHairpin(s, t, c, 'dim'));
        return true;
      case 'b':
        apply((s, t, c) => setBend(s, t, c, bendKind(t.measures[c.measure]?.voices[0]?.beats[c.beat]?.notes.find((n) => n.string === c.string)) === 'none' ? 'full' : 'none'));
        return true;
      default:
        return false;
    }
  };

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input:not([type="range"]):not([type="checkbox"]), textarea, select')) return;
    if (!song) return;
    const k = e.key;
    if (k === '?') {
      setShowHelp((v) => !v);
      e.preventDefault();
      return;
    }
    if (k === 'Escape' && showHelp) return setShowHelp(false);
    if (editing) {
      if (k === 'Escape') {
        if (player.selection) player.setSelection(null);
        else setEditing(false);
        e.preventDefault();
        return;
      }
      if (k !== ' ' && editKey(e)) {
        e.preventDefault();
        return;
      }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    if (k === ' ') player.playPause();
    else if (k === 'e' || k === 'E') setEditing(true);
    else if (k === 'ArrowLeft') gotoBar(-1);
    else if (k === 'ArrowRight') gotoBar(1);
    else if (k === 'ArrowUp') player.setTrackIndex(Math.max(0, trackIndex - 1));
    else if (k === 'ArrowDown') player.setTrackIndex(Math.min(song.tracks.length - 1, trackIndex + 1));
    else if (k === '+' || k === '=') player.setSpeed(player.speed + 0.05);
    else if (k === '-' || k === '_') player.setSpeed(player.speed - 0.05);
    else if (k === 'l' || k === 'L') toggleLoop();
    else if (k === 'c' || k === 'C') player.setCountIn(!player.countIn);
    else if (k === 'm' || k === 'M') player.setMetronome(!player.metronome);
    else if (k === 'F' && e.shiftKey) toggleFullscreen();
    else if (k === 'f' || k === 'F') setShowFretboard((v) => !v);
    else if (k === 's' || k === 'S') player.setChannel(trackIndex, { solo: !player.channels[trackIndex]?.solo });
    else if (k === 'Escape') {
      if (player.selection) player.setSelection(null);
      else player.stop();
    } else if (/^[1-9]$/.test(k) && Number(k) <= song.tracks.length) player.setTrackIndex(Number(k) - 1);
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyHandler.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' && (e.target as HTMLElement).closest('button')) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  if (loadError) {
    return (
      <div className="missing">
        <h2>Couldn’t open this tab</h2>
        <p className="muted">{loadError}</p>
        <button className="btn primary" onClick={openLibrary}>
          Back to library
        </button>
      </div>
    );
  }

  return (
    <div className={`player ${editing ? 'editing' : ''} ${fullscreen ? 'fullscreen' : ''}`}>
      <header className="player-header">
        <button className="icon-btn" onClick={leave} aria-label="Back to library" title="Library">
          <Icon name="back" />
        </button>
        <button className="brand plain" onClick={leave} aria-label="Riffbox library">
          <Logo />
        </button>
        <div className="song-heading">
          <h1>{song?.title || meta?.title || ' '}</h1>
          <span className="muted">{song?.artist || meta?.artist}</span>
          {dirty && <span className="unsaved">Unsaved changes</span>}
        </div>
        <button className={`btn ${editing ? 'primary' : ''}`} onClick={() => setEditing((v) => !v)} title="Edit the tab (E)" disabled={!song}>
          <Icon name="edit" size={16} />
          {editing ? 'Editing' : 'Edit'}
        </button>
        <button className="icon-btn" onClick={() => setSidebar((v) => !v)} aria-label={sidebar ? 'Hide tracks' : 'Show tracks'} title={sidebar ? 'Hide the track list' : 'Show the track list'} aria-pressed={sidebar}>
          <Icon name="mixer" />
        </button>
        <button className="icon-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (Shift+F)">
          <Icon name={fullscreen ? 'shrink' : 'expand'} />
        </button>
        <button className="icon-btn" onClick={() => setShowHelp(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Icon name="keyboard" />
        </button>
      </header>

      <div className={`workspace ${sidebar && !fullscreen ? '' : 'no-sidebar'}`}>
        <TrackList player={player} toneFor={toneFor} onTone={(i) => setToneFor((cur) => (cur === i ? null : i))} />
        <main className="viewport" ref={viewportRef}>
          {editing && song && track && (
            <EditorToolbar
              song={song}
              track={track}
              trackIndex={trackIndex}
              caret={caret}
              canUndo={undoStack.current.length > 0}
              canRedo={redoStack.current.length > 0}
              dirty={dirty || saving}
              apply={apply}
              onUndo={undo}
              onRedo={redo}
              onSave={() => void save()}
              onExport={() => song && downloadSong(song)}
              onDone={() => setEditing(false)}
              onSelectTrack={player.setTrackIndex}
            />
          )}
          {song && track ? (
            <SheetView
              ref={sheetRef}
              song={song}
              track={track}
              zoom={zoom}
              selection={player.selection}
              scrollRef={viewportRef}
              editing={editing}
              caret={caret}
              typing={typing}
              onSeek={player.seekTo}
              onSelect={player.setSelection}
              onCaret={(c) => {
                setCaret(c);
                player.seekTo(c.measure, beatAt(track, c)?.start ?? 0);
              }}
              onMeta={(patch) =>
                apply((s) => {
                  if (patch.title !== undefined) s.title = patch.title;
                  if (patch.artist !== undefined) s.artist = patch.artist;
                })
              }
            />
          ) : (
            <div className="stage-status">Loading tab…</div>
          )}
        </main>
        {toneFor !== null && song?.tracks[toneFor] && player.tones[toneFor] && (
          <ToneDrawer
            track={song.tracks[toneFor]}
            tone={player.tones[toneFor]}
            onChange={(t) => void player.setTone(toneFor, t)}
            onImportSample={player.importSample}
            onClose={() => setToneFor(null)}
          />
        )}
      </div>

      {showFretboard && track && (
        <section className="fretboard-panel" aria-label="Fretboard">
          <Fretboard track={track} notes={activeNotes} />
        </section>
      )}

      {(!player.ready || player.error) && (
        <div className={`soundfont-bar ${player.error ? 'err' : ''}`} role="status">
          {player.error ?? `Loading instrument sounds… ${Math.round(player.soundProgress * 100)}%`}
          {!player.error && <span style={{ width: `${player.soundProgress * 100}%` }} />}
        </div>
      )}

      <ControlBar
        player={player}
        readout={readout}
        measureCount={song?.measures.length ?? 0}
        showFretboard={showFretboard}
        follow={follow}
        zoom={zoom}
        onToggleFretboard={() => setShowFretboard((v) => !v)}
        onToggleFollow={() => setFollow((v) => !v)}
        onZoom={setZoom}
        onLoopToggle={toggleLoop}
        onSeekTick={(t) => playerRef.current?.seek(t)}
      />

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h3>Keyboard shortcuts</h3>
              <button className="icon-btn" aria-label="Close" onClick={() => setShowHelp(false)}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <dl className="shortcuts">
              <h4>Playing</h4>
              {PLAY_SHORTCUTS.map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <h4>Editing</h4>
              {EDIT_SHORTCUTS.map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {leavePrompt && (
        <div className="modal-backdrop" onClick={() => setLeavePrompt(false)}>
          <div className="modal" role="dialog" aria-label="Unsaved changes" onClick={(e) => e.stopPropagation()}>
            <div className="panel-head">
              <h3>Save your changes?</h3>
            </div>
            <p className="modal-body">You edited this tab. Save it before going back to the library?</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setLeavePrompt(false)}>
                Cancel
              </button>
              <button className="btn" onClick={openLibrary}>
                Discard changes
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  await save();
                  openLibrary();
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
