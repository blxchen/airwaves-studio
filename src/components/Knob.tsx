import { useRef } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  format?: (v: number) => string;
  color?: string;
  size?: number;
  onChange(v: number): void;
}

// Rotary knob: drag up/down, scroll, arrow keys; double-click resets.
export default function Knob({ label, value, min, max, step = 0.01, defaultValue, format, color = '#7c5cff', size = 46, onChange }: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const frac = (value - min) / (max - min);
  const start = -135;
  const angle = start + frac * 270;
  const r = size / 2 - 5;
  const c = size / 2;
  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = polar(from);
    const [x2, y2] = polar(to);
    return `M${x1} ${y1} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const [px, py] = polar(angle);

  return (
    <div className="knob">
      <svg
        width={size}
        height={size}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format ? format(value) : String(value)}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, v: value };
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const delta = ((drag.current.y - e.clientY) / 160) * (max - min);
          onChange(clamp(drag.current.v + delta));
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => onChange(clamp(value - Math.sign(e.deltaY) * (max - min) * 0.04))}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + (max - min) * 0.05));
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - (max - min) * 0.05));
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <path d={arc(start, 135)} className="knob-track" />
        {frac > 0.002 && <path d={arc(start, angle)} stroke={color} className="knob-value" />}
        <circle cx={c} cy={c} r={r - 6} className="knob-cap" />
        <line x1={c} y1={c} x2={c + (px - c) * 0.62} y2={c + (py - c) * 0.62} className="knob-pointer" />
      </svg>
      <span className="knob-label">{label}</span>
      <span className="knob-value-text">{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}
