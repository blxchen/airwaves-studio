import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DYNAMIC_LEVELS, dynamicName, type DurationValue, type Song, type Track } from '../engine/model';
import {
  bendKind,
  beatAt,
  deleteBeat,
  deleteMeasure,
  insertBeat,
  insertMeasure,
  noteAt,
  removeTrack,
  setBend,
  setDuration,
  setEndings,
  setInstrumentChange,
  setRepeatClose,
  setSection,
  setTempoChange,
  setTimeSignature,
  addTrack,
  updateTrack,
  tempoAt,
  toggleDot,
  toggleHarmonic,
  toggleNoteFlag,
  toggleRepeatOpen,
  toggleRest,
  toggleSlide,
  toggleTriplet,
  toggleVibrato,
  setDynamic,
  toggleHairpin,
  toggleGrace,
  type BendKind,
  type Caret,
} from '../engine/edit';
import { GM_NAMES, INSTRUMENT_GROUPS, TUNING_PRESETS } from '../lib/instruments';
import Icon from './Icon';

export type EditOp = (song: Song, track: Track, caret: Caret) => Caret | void;

interface Props {
  song: Song;
  track: Track;
  trackIndex: number;
  caret: Caret;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  apply(op: EditOp): void;
  onUndo(): void;
  onRedo(): void;
  onSave(): void;
  onExport(): void;
  onDone(): void;
  onSelectTrack(index: number): void;
}

const DURATION_LABELS: Record<number, string> = { 1: 'Whole', 2: 'Half', 4: 'Quarter', 8: 'Eighth', 16: '16th', 32: '32nd', 64: '64th' };

function NoteIcon({ value }: { value: DurationValue }) {
  const hollow = value <= 2;
  const flags = Math.max(0, Math.log2(value) - 2);
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true">
      <ellipse cx="6.5" cy="17" rx="4.6" ry="3.4" transform="rotate(-20 6.5 17)" fill={hollow ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="1.6" />
      {value > 1 && <line x1="10.6" y1="16" x2="10.6" y2="2" stroke="currentColor" strokeWidth="1.6" />}
      {Array.from({ length: flags }, (_, i) => (
        <path key={i} d={`M10.6 ${2 + i * 4} q5 2 5 7`} fill="none" stroke="currentColor" strokeWidth="1.6" />
      ))}
    </svg>
  );
}

function Popover({ label, title, children, wide }: { label: ReactNode; title: string; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="ed-pop" ref={ref}>
      <button className={`ed-btn wide ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} title={title} aria-expanded={open}>
        {label}
        <Icon name="chevron" size={13} />
      </button>
      {open && <div className={`ed-panel ${wide ? 'wide' : ''}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function ProgramSelect({ value, onChange, id }: { value: number; onChange: (p: number) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {INSTRUMENT_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.programs.map((p) => (
            <option key={p} value={p}>
              {GM_NAMES[p]}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="All General MIDI">
        {GM_NAMES.map((n, p) => (
          <option key={`all${p}`} value={p}>
            {p + 1}. {n}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

export default function EditorToolbar(p: Props) {
  const { song, track, caret, apply } = p;
  const beat = beatAt(track, caret);
  const note = noteAt(track, caret);
  // Dynamics apply to the whole beat, wherever the caret's string is.
  const beatNote = beat?.notes[0];
  const header = song.measures[caret.measure];
  const drums = track.isPercussion;
  const flag = (on: boolean | undefined) => (on ? 'on' : '');

  const noteButton = (label: ReactNode, title: string, on: boolean | undefined, op: EditOp, key?: string) => (
    <button className={`ed-btn ${flag(on)}`} disabled={!note} title={key ? `${title} (${key})` : title} onClick={() => apply(op)} aria-pressed={!!on}>
      {label}
    </button>
  );

  return (
    <div className="editor-bar" role="toolbar" aria-label="Tab editor">
      <div className="ed-group" aria-label="Duration">
        {([1, 2, 4, 8, 16, 32] as DurationValue[]).map((v) => (
          <button
            key={v}
            className={`ed-btn icon ${beat?.value === v ? 'on' : ''}`}
            title={`${DURATION_LABELS[v]} note`}
            onClick={() => apply((s, t, c) => setDuration(s, t, c, v))}
            aria-pressed={beat?.value === v}
          >
            <NoteIcon value={v} />
          </button>
        ))}
        <button className={`ed-btn ${flag(!!beat?.dots)}`} title="Dotted (.)" onClick={() => apply(toggleDot)}>
          •
        </button>
        <button className={`ed-btn ${flag(!!beat?.tuplet)}`} title="Triplet (T)" onClick={() => apply(toggleTriplet)}>
          3
        </button>
        <button className={`ed-btn ${flag(beat?.rest)}`} title="Rest (R)" onClick={() => apply(toggleRest)}>
          𝄽
        </button>
      </div>

      {!drums && (
        <div className="ed-group" aria-label="Note effects">
          {noteButton('P.M.', 'Palm mute', note?.palmMute, (s, t, c) => toggleNoteFlag(s, t, c, 'palmMute'), 'P')}
          {noteButton('L.R.', 'Let ring', note?.letRing, (s, t, c) => toggleNoteFlag(s, t, c, 'letRing'), 'L')}
          {noteButton('~', 'Vibrato (click again for wide)', note && note.vibrato !== 'none', toggleVibrato, 'V')}
          {noteButton('H/P', 'Hammer-on / pull-off to the next note', note?.hammer, (s, t, c) => toggleNoteFlag(s, t, c, 'hammer'), 'H')}
          {noteButton('/', 'Slide to the next note', note?.slide?.shift, (s, t, c) => toggleSlide(s, t, c, 'shift'), 'S')}
          <Popover label={<>↗ {note ? { none: 'Bend', half: '½', full: 'Full', release: 'B+R', prebend: 'Pre' }[bendKind(note)] : 'Bend'}</>} title="Bends">
            {(close) => (
              <div className="ed-list">
                {(['half', 'full', 'release', 'prebend', 'none'] as BendKind[]).map((k) => (
                  <button
                    key={k}
                    className={bendKind(note) === k ? 'on' : ''}
                    disabled={!note}
                    onClick={() => {
                      apply((s, t, c) => setBend(s, t, c, k));
                      close();
                    }}
                  >
                    {{ half: 'Half-step bend (½)', full: 'Full bend', release: 'Bend and release', prebend: 'Pre-bend and release', none: 'No bend' }[k]}
                  </button>
                ))}
              </div>
            )}
          </Popover>
          <Popover label="More" title="More effects">
            {() => (
              <div className="ed-list">
                {[
                  ['Grace note (F)', !!note?.grace, toggleGrace],
                  ['Natural harmonic', note?.harmonic, toggleHarmonic],
                  ['Slide in from below', note?.slide?.inBelow, ((s, t, c) => toggleSlide(s, t, c, 'inBelow')) as EditOp],
                  ['Slide in from above', note?.slide?.inAbove, ((s, t, c) => toggleSlide(s, t, c, 'inAbove')) as EditOp],
                  ['Slide out downwards', note?.slide?.outDown, ((s, t, c) => toggleSlide(s, t, c, 'outDown')) as EditOp],
                  ['Slide out upwards', note?.slide?.outUp, ((s, t, c) => toggleSlide(s, t, c, 'outUp')) as EditOp],
                  ['Legato slide', note?.slide?.legato, ((s, t, c) => toggleSlide(s, t, c, 'legato')) as EditOp],
                  ['Tapping', note?.tapped, ((s, t, c) => toggleNoteFlag(s, t, c, 'tapped')) as EditOp],
                  ['Staccato', note?.staccato, ((s, t, c) => toggleNoteFlag(s, t, c, 'staccato')) as EditOp],
                  ['Heavy accent', note?.heavyAccent, ((s, t, c) => toggleNoteFlag(s, t, c, 'heavyAccent')) as EditOp],
                ].map(([label, on, op]) => (
                  <button key={label as string} className={on ? 'on' : ''} disabled={!note} onClick={() => apply(op as EditOp)}>
                    {on ? '✓ ' : ''}
                    {label as string}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        </div>
      )}
      <div className="ed-group" aria-label="Note style">
        {drums && noteButton('Flam', 'Flam: a grace stroke just before the hit', !!note?.grace, toggleGrace, 'F')}
        {!drums && noteButton('x', 'Dead note', note?.dead, (s, t, c) => toggleNoteFlag(s, t, c, 'dead'), 'X')}
        {noteButton('( )', 'Ghost note', note?.ghost, (s, t, c) => toggleNoteFlag(s, t, c, 'ghost'), 'G')}
        {noteButton('>', 'Accent', note?.accent, (s, t, c) => toggleNoteFlag(s, t, c, 'accent'), 'A')}
        {!drums && noteButton('⁀', 'Tie to the previous note', note?.tieDestination, (s, t, c) => toggleNoteFlag(s, t, c, 'tieDestination'))}
      </div>

      <div className="ed-group" aria-label="Dynamics">
        <Popover label={<span className="dyn-label">{beatNote ? dynamicName(beatNote.velocity) : 'mf'}</span>} title="Dynamics (how loud)">
          {(close) => (
            <div className="dyn-grid">
              {DYNAMIC_LEVELS.map((d) => (
                <button
                  key={d.name}
                  className={beatNote && dynamicName(beatNote.velocity) === d.name ? 'on' : ''}
                  disabled={!beatNote}
                  onClick={() => {
                    apply((s, t, c) => setDynamic(s, t, c, d.velocity));
                    close();
                  }}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </Popover>
        <button className={`ed-btn ${beat?.hairpin === 'cresc' ? 'on' : ''}`} title="Crescendo: get louder (<)" onClick={() => apply((s, t, c) => toggleHairpin(s, t, c, 'cresc'))}>
          <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><path d="M21 1 L1 6 L21 11" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        </button>
        <button className={`ed-btn ${beat?.hairpin === 'dim' ? 'on' : ''}`} title="Decrescendo: get softer (>)" onClick={() => apply((s, t, c) => toggleHairpin(s, t, c, 'dim'))}>
          <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden="true"><path d="M1 1 L21 6 L1 11" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        </button>
      </div>

      <div className="ed-group" aria-label="Bar">
        <button className="ed-btn" title="Insert a beat here (Insert)" onClick={() => apply(insertBeat)}>
          +Beat
        </button>
        <button className="ed-btn" title="Delete this beat (Ctrl+Backspace)" onClick={() => apply(deleteBeat)}>
          −Beat
        </button>
        <Popover label={`Bar ${caret.measure + 1}`} title="Bar settings" wide>
          {(close) => <BarPanel song={song} caret={caret} apply={apply} close={close} header={header} />}
        </Popover>
        {!drums && (
          <Popover label="♪ Instrument" title="Change instrument partway through the track" wide>
            {(close) => <InstrumentPanel song={song} track={track} trackIndex={p.trackIndex} caret={caret} apply={apply} close={close} />}
          </Popover>
        )}
        <Popover label="Track" title="Track settings" wide>
          {(close) => <TrackPanel song={song} track={track} trackIndex={p.trackIndex} apply={apply} close={close} onSelectTrack={p.onSelectTrack} />}
        </Popover>
      </div>

      <div className="ed-group end">
        <button className="ed-btn" disabled={!p.canUndo} onClick={p.onUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="ed-btn" disabled={!p.canRedo} onClick={p.onRedo} title="Redo (Ctrl+Y)">
          ↷
        </button>
        <button className="ed-btn" onClick={p.onExport} title="Download as a Guitar Pro 5 file">
          Export
        </button>
        <button className={`ed-btn save ${p.dirty ? 'dirty' : ''}`} onClick={p.onSave} title="Save (Ctrl+S)">
          {p.dirty ? 'Save' : 'Saved'}
        </button>
        <button className="ed-btn done" onClick={p.onDone} title="Stop editing (Esc twice)">
          Done
        </button>
      </div>
    </div>
  );
}

function BarPanel({ song, caret, apply, close, header }: { song: Song; caret: Caret; apply(op: EditOp): void; close(): void; header: Song['measures'][number] }) {
  const m = caret.measure;
  const [num, setNum] = useState(header.numerator);
  const [den, setDen] = useState(header.denominator);
  const [tempo, setTempo] = useState(Math.round(tempoAt(song, m)));
  const [section, setSectionText] = useState(header.marker ?? '');
  const endings = [1, 2, 3, 4].filter((e) => header.alternateEndings & (1 << (e - 1)));
  const run = (op: (s: Song) => void) => apply((s) => op(s));

  return (
    <div className="ed-form">
      <div className="ed-row">
        <button onClick={() => apply((s, _t, c) => (insertMeasure(s, c.measure), { ...c, beat: 0 }))}>Insert bar before</button>
        <button onClick={() => apply((s, _t, c) => (insertMeasure(s, c.measure + 1), { ...c, measure: c.measure + 1, beat: 0 }))}>Insert bar after</button>
        <button
          className="danger"
          disabled={song.measures.length <= 1}
          onClick={() => {
            apply((s, _t, c) => (deleteMeasure(s, c.measure), { ...c, measure: Math.min(c.measure, s.measures.length - 1), beat: 0 }));
            close();
          }}
        >
          Delete bar
        </button>
      </div>
      <label>
        Time signature
        <span className="ed-inline">
          <input type="number" min={1} max={32} value={num} onChange={(e) => setNum(Number(e.target.value))} aria-label="Beats per bar" />
          /
          <select value={den} onChange={(e) => setDen(Number(e.target.value))} aria-label="Beat unit">
            {[2, 4, 8, 16].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <button onClick={() => run((s) => setTimeSignature(s, m, Math.max(1, Math.min(32, num || 4)), den))}>Apply</button>
        </span>
      </label>
      <label>
        Tempo from this bar (BPM)
        <span className="ed-inline">
          <input type="number" min={20} max={400} value={tempo} onChange={(e) => setTempo(Number(e.target.value))} />
          <button onClick={() => run((s) => setTempoChange(s, m, Math.max(20, Math.min(400, tempo || 120))))}>Apply</button>
          {song.tempoChanges.some((t) => t.measure === m && t.tick === 0) && <button onClick={() => run((s) => setTempoChange(s, m, null))}>Remove</button>}
        </span>
      </label>
      <label>
        Section name
        <span className="ed-inline">
          <input value={section} placeholder="e.g. Chorus" onChange={(e) => setSectionText(e.target.value)} />
          <button onClick={() => run((s) => setSection(s, m, section))}>Apply</button>
        </span>
      </label>
      <div className="ed-row">
        <label className="check">
          <input type="checkbox" checked={header.repeatOpen} onChange={() => run((s) => toggleRepeatOpen(s, m))} />
          Repeat starts here
        </label>
        <label className="check">
          Repeat ends here:
          <select value={header.repeatClose} onChange={(e) => run((s) => setRepeatClose(s, m, Number(e.target.value)))}>
            <option value={0}>No</option>
            {[2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                Play {n}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ed-row">
        Ending:
        {[1, 2, 3, 4].map((e) => (
          <label key={e} className="check">
            <input
              type="checkbox"
              checked={endings.includes(e)}
              onChange={() => run((s) => setEndings(s, m, endings.includes(e) ? endings.filter((x) => x !== e) : [...endings, e]))}
            />
            {e}.
          </label>
        ))}
      </div>
    </div>
  );
}

function InstrumentPanel({ song, track, trackIndex, caret, apply, close }: { song: Song; track: Track; trackIndex: number; caret: Caret; apply(op: EditOp): void; close(): void }) {
  const beat = beatAt(track, caret);
  const tick = beat?.start ?? 0;
  const existing = track.instrumentChanges.find((c) => c.measure === caret.measure && c.tick === tick);
  const [program, setProgram] = useState(existing?.program ?? track.program);
  void song;
  return (
    <div className="ed-form">
      <p className="muted small">
        Switch this track to a different sound from bar {caret.measure + 1}, beat {caret.beat + 1} onward (for example, clean verse → distorted chorus).
      </p>
      <label>
        New instrument
        <ProgramSelect value={program} onChange={setProgram} />
      </label>
      <div className="ed-row">
        <button
          className="primary"
          onClick={() => {
            apply((s, _t, c) => setInstrumentChange(s, trackIndex, c.measure, tick, program));
            close();
          }}
        >
          Change instrument here
        </button>
        {existing && (
          <button
            onClick={() => {
              apply((s, _t, c) => setInstrumentChange(s, trackIndex, c.measure, tick, null));
              close();
            }}
          >
            Remove change
          </button>
        )}
      </div>
      {track.instrumentChanges.length > 0 && (
        <ul className="ed-changes">
          {track.instrumentChanges.map((c) => (
            <li key={`${c.measure}:${c.tick}`}>
              Bar {c.measure + 1}: {GM_NAMES[c.program]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrackPanel({ song, track, trackIndex, apply, close, onSelectTrack }: { song: Song; track: Track; trackIndex: number; apply(op: EditOp): void; close(): void; onSelectTrack(i: number): void }) {
  const [name, setName] = useState(track.name);
  const [program, setProgram] = useState(track.program);
  const [capo, setCapo] = useState(track.capo);
  const [newKind, setNewKind] = useState<'guitar' | 'bass' | 'drums'>('guitar');
  const presetIndex = TUNING_PRESETS.findIndex((t) => t.strings.join() === track.tuning.join());

  return (
    <div className="ed-form">
      <label>
        Track name
        <span className="ed-inline">
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={() => apply((s) => updateTrack(s, trackIndex, { name }))}>Apply</button>
        </span>
      </label>
      {!track.isPercussion && (
        <>
          <label>
            Instrument (from the start)
            <span className="ed-inline">
              <ProgramSelect value={program} onChange={setProgram} />
              <button onClick={() => apply((s) => updateTrack(s, trackIndex, { program }))}>Apply</button>
            </span>
          </label>
          <label>
            Tuning
            <select
              value={presetIndex}
              onChange={(e) => {
                const preset = TUNING_PRESETS[Number(e.target.value)];
                if (preset) apply((s) => updateTrack(s, trackIndex, { tuning: [...preset.strings] }));
              }}
            >
              {presetIndex < 0 && <option value={-1}>Custom</option>}
              {TUNING_PRESETS.map((t, i) => (
                <option key={t.label} value={i}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Capo fret
            <span className="ed-inline">
              <input type="number" min={0} max={24} value={capo} onChange={(e) => setCapo(Number(e.target.value))} />
              <button onClick={() => apply((s) => updateTrack(s, trackIndex, { capo }))}>Apply</button>
            </span>
          </label>
        </>
      )}
      <hr />
      <label>
        Add a new track
        <span className="ed-inline">
          <select value={newKind} onChange={(e) => setNewKind(e.target.value as typeof newKind)}>
            <option value="guitar">Guitar</option>
            <option value="bass">Bass</option>
            <option value="drums">Drums</option>
          </select>
          <button
            onClick={() => {
              const spec =
                newKind === 'drums'
                  ? { name: 'Drums', program: 0, tuning: [], drums: true, capo: 0 }
                  : newKind === 'bass'
                    ? { name: 'Bass', program: 33, tuning: [43, 38, 33, 28], drums: false, capo: 0 }
                    : { name: 'Guitar', program: 27, tuning: [64, 59, 55, 50, 45, 40], drums: false, capo: 0 };
              let added = -1;
              apply((s) => {
                added = addTrack(s, spec);
              });
              if (added >= 0) onSelectTrack(added);
              close();
            }}
          >
            Add track
          </button>
        </span>
      </label>
      <button
        className="danger"
        disabled={song.tracks.length <= 1}
        onClick={() => {
          apply((s) => removeTrack(s, trackIndex));
          onSelectTrack(Math.max(0, trackIndex - 1));
          close();
        }}
      >
        Delete this track
      </button>
    </div>
  );
}
