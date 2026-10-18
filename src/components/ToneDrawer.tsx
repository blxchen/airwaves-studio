import { useRef, useState } from 'react';
import type { Track } from '../engine/model';
import { DRUM_PIECES, KITS, presetsFor, type DrumPiece, type Pedals, type PieceSettings, type ToneSettings } from '../engine/audio/tone';
import { GM_NAMES } from '../lib/instruments';
import Knob from './Knob';
import DrumIcon from './DrumIcon';
import Icon from './Icon';

interface Props {
  track: Track;
  tone: ToneSettings;
  onChange(tone: ToneSettings): void;
  onImportSample(file: File): Promise<{ id: string; name: string }>;
  onClose(): void;
}

const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

const GUITAR_SOURCES = [24, 25, 26, 27, 28, 29, 30];
const BASS_SOURCES = [32, 33, 34, 35, 36, 37, 38];

export default function ToneDrawer({ track, tone, onChange, onImportSample, onClose }: Props) {
  const set = (patch: Partial<ToneSettings>) => onChange({ ...tone, ...patch, preset: patch.preset ?? 'custom' });
  const pedal = (patch: Partial<Pedals>) => onChange({ ...tone, preset: 'custom', pedals: { ...tone.pedals, ...patch } });
  const presets = presetsFor(tone.kind);
  const kindLabel = { guitar: 'Guitar tone', bass: 'Bass tone', drums: 'Drum kit', other: 'Tone' }[tone.kind];

  return (
    <aside className="tone-drawer" aria-label={`${kindLabel} for ${track.name}`}>
      <div className="tone-head">
        <div>
          <span className="tone-kicker">{kindLabel}</span>
          <h3>{track.name}</h3>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close tone panel">
          <Icon name="close" size={16} />
        </button>
      </div>

      <section>
        <h4>Style</h4>
        <div className="preset-grid">
          {presets.map((p) => (
            <button key={p.id} className={`preset ${tone.preset === p.id ? 'on' : ''}`} title={p.blurb} onClick={() => onChange(p.apply(tone))}>
              <strong>{p.name}</strong>
              <span>{p.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      {tone.kind === 'drums' ? <DrumControls tone={tone} onChange={onChange} onImportSample={onImportSample} /> : <AmpControls tone={tone} set={set} pedal={pedal} />}
    </aside>
  );
}

function AmpControls({ tone, set, pedal }: { tone: ToneSettings; set(p: Partial<ToneSettings>): void; pedal(p: Partial<Pedals>): void }) {
  const p = tone.pedals;
  const sources = tone.kind === 'bass' ? BASS_SOURCES : GUITAR_SOURCES;
  const isBass = tone.kind === 'bass';
  return (
    <>
      <section>
        <h4>Amp</h4>
        <div className="amp">
          <Knob label={isBass ? 'Grit' : 'Gain'} value={tone.gain} min={0} max={1} defaultValue={0} format={pct} color="#ff7a45" onChange={(v) => set({ gain: v })} />
          {!isBass && <Knob label="Tight" value={tone.tight} min={0} max={1} defaultValue={0} format={pct} onChange={(v) => set({ tight: v })} />}
          <Knob label="Bass" value={tone.bass} min={-12} max={12} step={0.5} defaultValue={0} format={db} onChange={(v) => set({ bass: v })} />
          <Knob label="Mids" value={tone.mids} min={-12} max={12} step={0.5} defaultValue={0} format={db} onChange={(v) => set({ mids: v })} />
          <Knob label="Treble" value={tone.treble} min={-12} max={12} step={0.5} defaultValue={0} format={db} onChange={(v) => set({ treble: v })} />
          <Knob label="Presence" value={tone.presence} min={-12} max={12} step={0.5} defaultValue={0} format={db} onChange={(v) => set({ presence: v })} />
          <Knob label="Tone" value={tone.tone} min={0} max={1} defaultValue={1} format={pct} onChange={(v) => set({ tone: v })} />
          <Knob label="Reverb" value={tone.reverb} min={0} max={1} defaultValue={0.15} format={pct} color="#2bb6c9" onChange={(v) => set({ reverb: v })} />
        </div>
        <div className="amp-row">
          <label className="switch">
            <input type="checkbox" checked={tone.cabinet} onChange={(e) => set({ cabinet: e.target.checked })} />
            <span>Speaker cabinet</span>
          </label>
          <label className="source">
            Sound
            <select
              value={tone.source ? `${tone.source.bank}:${tone.source.program}` : 'file'}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'file') set({ source: null });
                else {
                  const [bank, program] = v.split(':').map(Number);
                  set({ source: { bank, program } });
                }
              }}
            >
              <option value="file">From the tab file</option>
              {sources.map((s) => (
                <option key={s} value={`0:${s}`}>
                  {GM_NAMES[s]}
                </option>
              ))}
              {!isBass && <option value="8:28">Funk Guitar</option>}
              {!isBass && <option value="8:25">12-String Guitar</option>}
              {!isBass && <option value="8:27">Chorused Clean Guitar</option>}
            </select>
          </label>
        </div>
      </section>

      <section>
        <h4>Pedalboard</h4>
        <div className="pedalboard">
          <Pedal name="Compressor" color="#3d7bfd" on={p.compressor} onToggle={(v) => pedal({ compressor: v })} />
          <Pedal name={isBass ? 'Bass drive' : 'Drive'} color="#ff7a45" on={p.drive} onToggle={(v) => pedal({ drive: v })}>
            <div className="pedal-type">
              {(['overdrive', 'distortion', 'fuzz'] as const).map((t) => (
                <button key={t} className={p.driveType === t ? 'on' : ''} onClick={() => pedal({ driveType: t, drive: true })}>
                  {t === 'overdrive' ? 'OD' : t === 'distortion' ? 'DIST' : 'FUZZ'}
                </button>
              ))}
            </div>
            <Knob label="Drive" size={40} value={p.driveAmount} min={0} max={1} defaultValue={0.5} format={pct} color="#ff7a45" onChange={(v) => pedal({ driveAmount: v })} />
          </Pedal>
          {!isBass && (
            <Pedal name="Chorus" color="#22b07d" on={p.chorus} onToggle={(v) => pedal({ chorus: v })}>
              <Knob label="Depth" size={40} value={p.chorusDepth} min={0} max={1} defaultValue={0.4} format={pct} color="#22b07d" onChange={(v) => pedal({ chorusDepth: v })} />
            </Pedal>
          )}
          <Pedal name="Delay" color="#9b5cff" on={p.delay} onToggle={(v) => pedal({ delay: v })}>
            <Knob label="Time" size={40} value={p.delayTime} min={0.05} max={1} defaultValue={0.32} format={(v) => `${Math.round(v * 1000)} ms`} color="#9b5cff" onChange={(v) => pedal({ delayTime: v })} />
            <Knob label="Repeats" size={40} value={p.delayFeedback} min={0} max={0.9} defaultValue={0.3} format={pct} color="#9b5cff" onChange={(v) => pedal({ delayFeedback: v })} />
            <Knob label="Mix" size={40} value={p.delayMix} min={0} max={1} defaultValue={0.25} format={pct} color="#9b5cff" onChange={(v) => pedal({ delayMix: v })} />
          </Pedal>
        </div>
      </section>
    </>
  );
}

function Pedal({ name, color, on, onToggle, children }: { name: string; color: string; on: boolean; onToggle(v: boolean): void; children?: React.ReactNode }) {
  return (
    <div className={`pedal ${on ? 'on' : ''}`} style={{ ['--pedal' as string]: color }}>
      <div className="pedal-top">
        <span className="pedal-led" />
        <span className="pedal-name">{name}</span>
      </div>
      {children && <div className="pedal-body">{children}</div>}
      <button className="pedal-switch" aria-pressed={on} onClick={() => onToggle(!on)}>
        {on ? 'On' : 'Off'}
      </button>
    </div>
  );
}

function DrumControls({ tone, onChange, onImportSample }: { tone: ToneSettings; onChange(t: ToneSettings): void; onImportSample(file: File): Promise<{ id: string; name: string }> }) {
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const loadingFor = useRef<DrumPiece | null>(null);
  const setPiece = (id: DrumPiece, patch: Partial<PieceSettings>) =>
    onChange({ ...tone, preset: 'custom', pieces: { ...tone.pieces, [id]: { ...tone.pieces[id], ...patch } } });

  return (
    <>
      <section>
        <h4>Kit</h4>
        <div className="amp">
          <label className="source wide">
            Drum kit
            <select value={tone.kit} onChange={(e) => onChange({ ...tone, preset: 'custom', kit: Number(e.target.value) })}>
              {KITS.map((k) => (
                <option key={k.program} value={k.program}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <Knob label="Punch" value={tone.punch} min={0} max={1} defaultValue={0} format={pct} color="#ff7a45" onChange={(v) => onChange({ ...tone, preset: 'custom', punch: v })} />
          <Knob label="Room" value={tone.reverb} min={0} max={1} defaultValue={0.15} format={pct} color="#2bb6c9" onChange={(v) => onChange({ ...tone, preset: 'custom', reverb: v })} />
          <Knob label="Low" value={tone.bass} min={-12} max={12} step={0.5} defaultValue={0} format={db} onChange={(v) => onChange({ ...tone, preset: 'custom', bass: v })} />
          <Knob label="Mid" value={tone.mids} min={-12} max={12} step={0.5} defaultValue={0} format={db} onChange={(v) => onChange({ ...tone, preset: 'custom', mids: v })} />
          <Knob label="High" value={tone.treble} min={-12} max={12} step={0.5} defaultValue={0} format={db} onChange={(v) => onChange({ ...tone, preset: 'custom', treble: v })} />
        </div>
      </section>

      <section>
        <h4>Kit pieces</h4>
        <p className="muted small">Adjust each drum, take it from another kit, or load your own sample (WAV, MP3, OGG, e.g. from your sample library).</p>
        {error && <p className="tone-error">{error}</p>}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            const id = loadingFor.current;
            if (!file || !id) return;
            try {
              setError(null);
              const s = await onImportSample(file);
              setPiece(id, { sampleId: s.id, sampleName: s.name });
            } catch {
              setError(`“${file.name}” couldn’t be read as audio.`);
            }
          }}
        />
        <ul className="pieces">
          {DRUM_PIECES.filter((p) => p.id !== 'perc').map((p) => {
            const ps = tone.pieces[p.id];
            return (
              <li key={p.id}>
                <div className="piece-name">
                  <DrumIcon piece={p.id} />
                  <strong>{p.name}</strong>
                </div>
                <div className="piece-controls">
                  <Knob label="Level" size={38} value={ps.volume} min={0} max={1.5} defaultValue={1} format={pct} onChange={(v) => setPiece(p.id, { volume: v })} />
                  <Knob label="Tune" size={38} value={ps.tune} min={-12} max={12} step={0.5} defaultValue={0} format={(v) => `${v > 0 ? '+' : ''}${v}`} onChange={(v) => setPiece(p.id, { tune: v })} />
                  <Knob label="Decay" size={38} value={ps.decay} min={0.2} max={2} defaultValue={1} format={pct} onChange={(v) => setPiece(p.id, { decay: v })} />
                </div>
                <div className="piece-source">
                  {ps.sampleId ? (
                    <span className="sample-chip" title={ps.sampleName ?? ''}>
                      ♪ {ps.sampleName}
                      <button aria-label="Remove sample" onClick={() => setPiece(p.id, { sampleId: null, sampleName: null })}>
                        ×
                      </button>
                    </span>
                  ) : (
                    <select value={ps.kit ?? -1} onChange={(e) => setPiece(p.id, { kit: Number(e.target.value) < 0 ? null : Number(e.target.value) })} aria-label={`${p.name} sound`}>
                      <option value={-1}>Kit sound</option>
                      {KITS.map((k) => (
                        <option key={k.program} value={k.program}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="load-sample"
                    onClick={() => {
                      loadingFor.current = p.id;
                      fileRef.current?.click();
                    }}
                  >
                    Load sample…
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
