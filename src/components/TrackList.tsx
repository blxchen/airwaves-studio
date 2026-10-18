import type { TabPlayer } from '../player/usePlayer';
import { instrumentOf, KIND_COLOR, KIND_ICON, noteName } from '../lib/instruments';

export default function TrackList({ player, toneFor, onTone }: { player: TabPlayer; toneFor: number | null; onTone(index: number): void }) {
  const song = player.song;
  if (!song) return <aside className="tracks" />;
  const anySolo = player.channels.some((c) => c.solo);

  return (
    <aside className="tracks" aria-label="Tracks">
      <h2>Tracks</h2>
      <ul>
        {song.tracks.map((t) => {
          const { kind, family } = instrumentOf(t.program, t.isPercussion);
          const ch = player.channels[t.index] ?? { volume: 0.8, mute: false, solo: false };
          const silent = ch.mute || (anySolo && !ch.solo);
          const tuning = t.isPercussion ? 'Drum kit' : [...t.tuning].reverse().map((p) => noteName(p)).join(' ');
          return (
            <li key={t.index} className={`${t.index === player.trackIndex ? 'current' : ''} ${silent ? 'silent' : ''}`}>
              <button className="track-main" onClick={() => player.setTrackIndex(t.index)} aria-current={t.index === player.trackIndex} title={`Show ${t.name}`}>
                <span className="track-icon" style={{ background: KIND_COLOR[kind] }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
                    <path d={KIND_ICON[kind]} />
                  </svg>
                </span>
                <span className="track-text">
                  <strong>{t.name}</strong>
                  <span>
                    {family} · {tuning}
                  </span>
                </span>
                {t.index < 9 && <kbd>{t.index + 1}</kbd>}
              </button>
              <div className="track-mix">
                <button className={`ms mute ${ch.mute ? 'on' : ''}`} aria-pressed={ch.mute} title="Mute" onClick={() => player.setChannel(t.index, { mute: !ch.mute })}>
                  M
                </button>
                <button className={`ms solo ${ch.solo ? 'on' : ''}`} aria-pressed={ch.solo} title="Solo" onClick={() => player.setChannel(t.index, { solo: !ch.solo })}>
                  S
                </button>
                <button className={`tone-btn ${toneFor === t.index ? 'on' : ''}`} title={t.isPercussion ? 'Drum kit and sounds' : 'Tone: amp, EQ and pedals'} onClick={() => onTone(t.index)}>
                  {t.isPercussion ? 'Kit' : 'Tone'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={ch.volume}
                  aria-label={`${t.name} volume`}
                  style={{ accentColor: KIND_COLOR[kind] }}
                  onChange={(e) => player.setChannel(t.index, { volume: Number(e.target.value) })}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
