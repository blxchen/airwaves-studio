import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '../engine/model';
import { loadSoundFont, Player, type Channel } from '../engine/audio/player';
import type { ToneSettings } from '../engine/audio/tone';
import { getSample, putSample } from '../lib/db';

const SOUNDFONT_URL = `${import.meta.env.BASE_URL}soundfont/GeneralUser-GS.sf2`;

export interface Selection {
  from: number; // measure index
  to: number;
}

export function useTabPlayer() {
  const playerRef = useRef<Player | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [soundProgress, setSoundProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [looping, setLoopingState] = useState(false);
  const [selection, setSelectionState] = useState<Selection | null>(null);
  const [metronome, setMetronomeState] = useState(false);
  const [countIn, setCountInState] = useState(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [tones, setTones] = useState<ToneSettings[]>([]);
  const pendingSong = useRef<Song | null>(null);

  // Load the instrument sounds once and create the audio engine.
  useEffect(() => {
    let cancelled = false;
    loadSoundFont(SOUNDFONT_URL, (f) => !cancelled && setSoundProgress(f))
      .then((sf) => {
        if (cancelled) return;
        const player = new Player(sf);
        player.onStateChange = (p) => setPlaying(p);
        playerRef.current = player;
        if (pendingSong.current) {
          player.load(pendingSong.current);
          setChannels(player.getChannels());
          setTones(player.getTones());
        }
        setReady(true);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const load = useCallback((next: Song, initialTrack = 0) => {
    setSong(next);
    setTrackIndex(Math.min(initialTrack, next.tracks.length - 1));
    setSelectionState(null);
    setLoopingState(false);
    pendingSong.current = next;
    const player = playerRef.current;
    if (player) {
      player.load(next);
      player.setSpeed(1);
      setChannels(player.getChannels());
          setTones(player.getTones());
    }
  }, []);

  // Replaces the song after an edit, keeping playback state.
  const replaceSong = useCallback((next: Song) => {
    setSong(next);
    setTrackIndex((i) => Math.min(i, next.tracks.length - 1));
    pendingSong.current = next;
    const player = playerRef.current;
    if (player) {
      player.update(next);
      setChannels(player.getChannels());
          setTones(player.getTones());
    }
  }, []);

  const playPause = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying) p.pause();
    else void p.play();
  }, []);

  const stop = useCallback(() => playerRef.current?.stop(), []);

  const setSpeed = useCallback((value: number) => {
    const s = Math.min(2, Math.max(0.25, Math.round(value * 100) / 100));
    playerRef.current?.setSpeed(s);
    setSpeedState(s);
  }, []);

  const setLoop = useCallback((on: boolean, range: Selection | null) => {
    playerRef.current?.setLooping(on, range);
    setLoopingState(on);
  }, []);

  const setSelection = useCallback(
    (range: Selection | null) => {
      setSelectionState(range);
      const p = playerRef.current;
      if (p && (p.looping || range)) {
        p.setLooping(!!range || p.looping, range);
        setLoopingState(!!range || p.looping);
      }
    },
    [],
  );

  const setMetronome = useCallback((on: boolean) => {
    if (playerRef.current) playerRef.current.metronome = on;
    setMetronomeState(on);
  }, []);

  const setCountIn = useCallback((on: boolean) => {
    if (playerRef.current) playerRef.current.countIn = on;
    setCountInState(on);
  }, []);

  const setChannel = useCallback((index: number, patch: Partial<Channel>) => {
    const p = playerRef.current;
    if (!p) return;
    p.setChannel(index, patch);
    setChannels(p.getChannels());
  }, []);

  // Applies a track's tone, loading any user samples it refers to first.
  const setTone = useCallback(async (index: number, tone: ToneSettings) => {
    const p = playerRef.current;
    if (!p) return;
    for (const piece of Object.values(tone.pieces ?? {})) {
      if (piece.sampleId) {
        const stored = await getSample(piece.sampleId);
        if (stored) await p.addSample(piece.sampleId, stored.data);
      }
    }
    p.setTone(index, tone);
    setTones(p.getTones());
  }, []);

  // Stores an audio file the user picked and returns its id for a drum piece.
  const importSample = useCallback(async (file: File): Promise<{ id: string; name: string }> => {
    const data = await file.arrayBuffer();
    const id = crypto.randomUUID();
    await playerRef.current?.addSample(id, data); // decodes; throws if not audio
    await putSample(id, file.name, data);
    return { id, name: file.name.replace(/.[^.]+$/, '') };
  }, []);

  const seekTo = useCallback((measure: number, tick: number) => {
    const p = playerRef.current;
    if (!p) return;
    const current = p.toScore(p.currentTick());
    p.seek(p.fromScore(measure, tick, current.orderIndex));
  }, []);

  return {
    playerRef,
    song,
    trackIndex,
    track: song?.tracks[trackIndex] ?? null,
    setTrackIndex,
    ready,
    soundProgress,
    error,
    playing,
    speed,
    looping,
    selection,
    metronome,
    countIn,
    channels,
    tones,
    setTone,
    importSample,
    load,
    replaceSong,
    playPause,
    stop,
    setSpeed,
    setLoop,
    setSelection,
    setMetronome,
    setCountIn,
    setChannel,
    seekTo,
  };
}

export type TabPlayer = ReturnType<typeof useTabPlayer>;
