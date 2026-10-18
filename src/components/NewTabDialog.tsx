import { useState } from 'react';
import { createBlankSong } from '../lib/library';
import { GM_NAMES, TUNING_PRESETS } from '../lib/instruments';
import { openSong } from '../App';
import Icon from './Icon';

const STARTERS = [
  { label: 'Electric guitar (clean)', program: 27, kind: 'guitar' },
  { label: 'Electric guitar (distortion)', program: 30, kind: 'guitar' },
  { label: 'Acoustic guitar (steel)', program: 25, kind: 'guitar' },
  { label: 'Acoustic guitar (nylon)', program: 24, kind: 'guitar' },
  { label: 'Bass guitar', program: 33, kind: 'bass' },
  { label: 'Drums', program: 0, kind: 'drums' },
] as const;

export default function NewTabDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [tempo, setTempo] = useState(120);
  const [starter, setStarter] = useState(0);
  const kind = STARTERS[starter].kind;
  const presets = TUNING_PRESETS.filter((t) => (kind === 'bass' ? t.label.startsWith('Bass') : !t.label.startsWith('Bass')));
  const [tuning, setTuning] = useState(0);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const s = STARTERS[starter];
    const preset = presets[Math.min(tuning, presets.length - 1)];
    const id = await createBlankSong(title.trim() || 'Untitled', artist.trim() || 'Unknown artist', Math.max(20, Math.min(400, tempo || 120)), {
      name: s.kind === 'drums' ? 'Drums' : GM_NAMES[s.program],
      program: s.program,
      tuning: s.kind === 'drums' ? [] : [...preset.strings],
      drums: s.kind === 'drums',
      capo: 0,
    });
    openSong(id, true);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-label="New tab"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="panel-head">
          <h3>New tab</h3>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="ed-form modal-body">
          <label>
            Song title
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" />
          </label>
          <label>
            Artist
            <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Unknown artist" />
          </label>
          <label>
            Tempo (BPM)
            <input type="number" min={20} max={400} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
          </label>
          <label>
            First instrument
            <select
              value={starter}
              onChange={(e) => {
                setStarter(Number(e.target.value));
                setTuning(0);
              }}
            >
              {STARTERS.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {kind !== 'drums' && (
            <label>
              Tuning
              <select value={tuning} onChange={(e) => setTuning(Number(e.target.value))}>
                {presets.map((t, i) => (
                  <option key={t.label} value={i}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted small">You can add more tracks, change instruments partway through, and set the time signature while editing.</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create and edit'}
          </button>
        </div>
      </form>
    </div>
  );
}
