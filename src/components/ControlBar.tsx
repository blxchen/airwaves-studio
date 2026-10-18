import { useEffect, useRef, useState } from 'react';
import type { TabPlayer } from '../player/usePlayer';
import Icon, { type IconName } from './Icon';

const SPEED_PRESETS = [0.25, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 2];

export interface Readout {
  seconds: number;
  duration: number;
  tick: number;
  endTick: number;
  measure: number;
  bpm: number;
}

function formatTime(s: number): string {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function Toggle({ icon, label, on, onClick, hotkey }: { icon: IconName; label: string; on: boolean; onClick: () => void; hotkey?: string }) {
  return (
    <button className={`tool ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick} title={hotkey ? `${label} (${hotkey})` : label}>
      <Icon name={icon} />
      <span className="tool-label">{label}</span>
    </button>
  );
}

interface Props {
  player: TabPlayer;
  readout: Readout;
  measureCount: number;
  showFretboard: boolean;
  follow: boolean;
  zoom: number;
  onToggleFretboard(): void;
  onToggleFollow(): void;
  onZoom(z: number): void;
  onLoopToggle(): void;
  onSeekTick(tick: number): void;
}

export default function ControlBar(p: Props) {
  const { player, readout } = p;
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);
  const disabled = !player.ready || !player.song;

  useEffect(() => {
    if (!speedOpen) return;
    const close = (e: MouseEvent) => {
      if (!speedRef.current?.contains(e.target as Node)) setSpeedOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [speedOpen]);

  const progress = readout.endTick ? readout.tick / readout.endTick : 0;

  return (
    <footer className="controlbar">
      <div className="timeline" style={{ ['--p' as string]: `${progress * 100}%` }}>
        <input
          type="range"
          min={0}
          max={readout.endTick || 1}
          value={readout.tick}
          step={1}
          disabled={disabled}
          aria-label="Song position"
          onChange={(e) => p.onSeekTick(Number(e.target.value))}
        />
      </div>
      <div className="controls">
        <div className="transport">
          <button className="play" onClick={player.playPause} disabled={disabled} aria-label={player.playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
            <Icon name={player.playing ? 'pause' : 'play'} size={22} />
          </button>
          <button className="icon-btn" onClick={player.stop} disabled={disabled} aria-label="Stop" title="Back to start (Esc)">
            <Icon name="stop" />
          </button>
          <div className="readout">
            <span>
              {formatTime(readout.seconds)} <span className="muted">/ {formatTime(readout.duration)}</span>
            </span>
            <span className="muted small">
              Bar {readout.measure + 1} of {p.measureCount}
              {readout.bpm ? ` · ${Math.round(readout.bpm)} BPM` : ''}
            </span>
          </div>
        </div>

        <div className="tools">
          <Toggle icon="loop" label={player.selection ? `Loop ${player.selection.from + 1}–${player.selection.to + 1}` : 'Loop'} on={player.looping} onClick={p.onLoopToggle} hotkey="L" />
          {player.selection && (
            <button className="link-btn small" onClick={() => player.setSelection(null)} title="Clear the selected bars (Esc)">
              Clear
            </button>
          )}
          <Toggle icon="countin" label="Count-in" on={player.countIn} onClick={() => player.setCountIn(!player.countIn)} hotkey="C" />
          <Toggle icon="metronome" label="Metronome" on={player.metronome} onClick={() => player.setMetronome(!player.metronome)} hotkey="M" />

          <div className="speed" ref={speedRef}>
            <button className={`tool ${player.speed !== 1 ? 'on' : ''}`} onClick={() => setSpeedOpen((o) => !o)} aria-expanded={speedOpen} title="Playback speed (+ / −)">
              <span className="speed-value">{Math.round(player.speed * 100)}%</span>
              <span className="tool-label">Speed</span>
            </button>
            {speedOpen && (
              <div className="popover speed-pop">
                <div className="speed-slider">
                  <button className="icon-btn" aria-label="Slower" onClick={() => player.setSpeed(player.speed - 0.05)}>
                    −
                  </button>
                  <input type="range" min={0.25} max={2} step={0.05} value={player.speed} aria-label="Playback speed" onChange={(e) => player.setSpeed(Number(e.target.value))} />
                  <button className="icon-btn" aria-label="Faster" onClick={() => player.setSpeed(player.speed + 0.05)}>
                    +
                  </button>
                  <strong>{Math.round(player.speed * 100)}%</strong>
                </div>
                <div className="speed-presets">
                  {SPEED_PRESETS.map((s) => (
                    <button key={s} className={Math.abs(player.speed - s) < 0.001 ? 'on' : ''} onClick={() => player.setSpeed(s)}>
                      {Math.round(s * 100)}%
                    </button>
                  ))}
                </div>
                <p className="muted small">Slower or faster playback keeps the original pitch.</p>
              </div>
            )}
          </div>

          <span className="divider" />
          <Toggle icon="fretboard" label="Fretboard" on={p.showFretboard} onClick={p.onToggleFretboard} hotkey="F" />
          <Toggle icon="follow" label="Follow" on={p.follow} onClick={p.onToggleFollow} />
          <div className="zoom">
            <button className="icon-btn" onClick={() => p.onZoom(p.zoom - 0.1)} aria-label="Zoom out" title="Zoom out">
              <Icon name="zoomOut" size={17} />
            </button>
            <span className="small">{Math.round(p.zoom * 100)}%</span>
            <button className="icon-btn" onClick={() => p.onZoom(p.zoom + 0.1)} aria-label="Zoom in" title="Zoom in">
              <Icon name="zoomIn" size={17} />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
