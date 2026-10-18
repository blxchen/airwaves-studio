import type { DrumPiece } from '../engine/audio/tone';

// Original line icons for each part of the kit.
export default function DrumIcon({ piece, size = 30 }: { piece: DrumPiece; size?: number }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: React.ReactNode;
  switch (piece) {
    case 'kick':
      body = (
        <>
          <circle cx="16" cy="15" r="11" {...common} />
          <circle cx="16" cy="15" r="6.5" {...common} />
          <circle cx="16" cy="15" r="1.6" fill="currentColor" />
          <path d="M8 26 L5 30 M24 26 L27 30" {...common} />
        </>
      );
      break;
    case 'snare':
      body = (
        <>
          <ellipse cx="16" cy="12" rx="11" ry="3.5" {...common} />
          <path d="M5 12 V20 Q16 25 27 20 V12" {...common} />
          <path d="M9 14.5 V22 M16 15.5 V23.5 M23 14.5 V22" {...common} strokeWidth={1} />
          <path d="M20 4 L12 10 M26 5 L17 10" {...common} />
        </>
      );
      break;
    case 'hihat':
      body = (
        <>
          <path d="M5 9 Q16 4 27 9 Z" {...common} />
          <path d="M5 13 Q16 18 27 13 Z" {...common} />
          <path d="M16 6 V30 M11 30 H21" {...common} />
        </>
      );
      break;
    case 'tomHigh':
    case 'tomMid':
      body = (
        <>
          <ellipse cx="16" cy="11" rx={piece === 'tomHigh' ? 8 : 10} ry="3" {...common} />
          <path d={piece === 'tomHigh' ? 'M8 11 V19 Q16 23 24 19 V11' : 'M6 11 V21 Q16 25 26 21 V11'} {...common} />
          <path d="M16 23 V30" {...common} />
        </>
      );
      break;
    case 'tomFloor':
      body = (
        <>
          <ellipse cx="16" cy="9" rx="11" ry="3.5" {...common} />
          <path d="M5 9 V23 Q16 27 27 23 V9" {...common} />
          <path d="M7 24 L5 30 M25 24 L27 30" {...common} />
        </>
      );
      break;
    case 'crash':
    case 'splash':
      body = (
        <>
          <path d={piece === 'crash' ? 'M3 12 Q16 4 29 9 Q16 13 3 12 Z' : 'M8 12 Q16 7 24 10 Q16 13 8 12 Z'} {...common} />
          <path d="M16 10 V30 M11 30 H21" {...common} />
        </>
      );
      break;
    case 'ride':
      body = (
        <>
          <path d="M2 13 Q16 6 30 13 Q16 16 2 13 Z" {...common} />
          <ellipse cx="16" cy="10.5" rx="3.5" ry="1.8" {...common} />
          <path d="M16 13 V30 M11 30 H21" {...common} />
        </>
      );
      break;
    case 'china':
      body = (
        <>
          <path d="M3 9 Q6 13 10 12 Q16 15 22 12 Q26 13 29 9" {...common} />
          <path d="M10 12 Q16 9 22 12" {...common} />
          <path d="M16 12 V30 M11 30 H21" {...common} />
        </>
      );
      break;
    default:
      body = (
        <>
          <path d="M10 6 H22 L25 24 H7 Z" {...common} />
          <path d="M16 6 V2" {...common} />
        </>
      );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="drum-icon">
      {body}
    </svg>
  );
}
