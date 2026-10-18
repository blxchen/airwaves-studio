import type { Note, Track } from '../engine/model';
import { noteName } from '../lib/instruments';

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_INLAYS = [12, 24];

export default function Fretboard({ track, notes }: { track: Track; notes: Note[] }) {
  const tuning = track.tuning;
  const strings = tuning.length;
  if (track.isPercussion || strings === 0) {
    return <div className="fretboard-empty muted">The fretboard shows notes for stringed instruments.</div>;
  }

  const highestUsed = notes.reduce((m, n) => Math.max(m, n.fret), 0);
  const frets = Math.max(15, Math.min(24, highestUsed + 2));
  const left = 44;
  const nut = 30;
  const fretW = 46;
  const rowH = 20;
  const top = 18;
  const width = left + nut + frets * fretW + 8;
  const height = top + (strings - 1) * rowH + 22;
  const fretX = (fret: number) => (fret === 0 ? left + nut / 2 : left + nut + (fret - 0.5) * fretW);
  const midY = top + ((strings - 1) * rowH) / 2;
  const boardH = (strings - 1) * rowH + 16;

  return (
    <div className="fretboard-scroll">
      <svg className="fretboard" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Fretboard showing the notes being played">
        <rect x={left + nut} y={top - 8} width={frets * fretW} height={boardH} className="fb-wood" rx="3" />
        {INLAYS.filter((f) => f <= frets).map((f) => (
          <circle key={f} cx={fretX(f)} cy={midY} r="5" className="fb-inlay" />
        ))}
        {DOUBLE_INLAYS.filter((f) => f <= frets).map((f) => (
          <g key={f}>
            <circle cx={fretX(f)} cy={midY - rowH} r="5" className="fb-inlay" />
            <circle cx={fretX(f)} cy={midY + rowH} r="5" className="fb-inlay" />
          </g>
        ))}
        <rect x={left + nut - 4} y={top - 8} width="5" height={boardH} className="fb-nut" />
        {Array.from({ length: frets }, (_, i) => (
          <line key={i} x1={left + nut + (i + 1) * fretW} x2={left + nut + (i + 1) * fretW} y1={top - 8} y2={top + (strings - 1) * rowH + 8} className="fb-fret" />
        ))}
        {tuning.map((pitch, row) => (
          <g key={row}>
            <line x1={left + 4} x2={width - 8} y1={top + row * rowH} y2={top + row * rowH} className="fb-string" strokeWidth={1 + row * (1.6 / Math.max(1, strings - 1))} />
            <text x={left - 10} y={top + row * rowH + 4} className="fb-tuning" textAnchor="end">
              {noteName(pitch + track.capo)}
            </text>
          </g>
        ))}
        {[1, 3, 5, 7, 9, 12, 15, 17, 19, 21, 24]
          .filter((f) => f <= frets)
          .map((f) => (
            <text key={f} x={fretX(f)} y={height - 4} className="fb-number" textAnchor="middle">
              {f}
            </text>
          ))}
        {notes.map((n, i) => {
          if (n.string < 0 || n.string >= strings) return null;
          const pitch = tuning[n.string] + track.capo + n.fret;
          return (
            <g key={i} className={`fb-note ${n.dead ? 'dead' : ''}`} transform={`translate(${fretX(n.fret)} ${top + n.string * rowH})`}>
              <circle r="9.5" />
              <text y="3.5" textAnchor="middle">
                {n.dead ? '×' : noteName(pitch)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
