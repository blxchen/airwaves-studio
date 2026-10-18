import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Song, Track } from '../engine/model';
import { cursorPosition, hitTest, layoutSheet, DRUM_GAP, TAB_GAP } from '../engine/render/layout';
import TabSheet from '../engine/render/TabSheet';
import { DRUM_ROWS, isOverfilled, type Caret } from '../engine/edit';
import type { Selection } from '../player/usePlayer';
import { instrumentOf } from '../lib/instruments';

const TRACKER_WIDTH = 18;

const NOTE_NAMES =['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Drum key -> staff step, mirroring the renderer, for caret placement.
const DRUM_STEPS: Record<number, number> = { 49: 10, 42: 9, 46: 9, 51: 8, 50: 7, 47: 6, 38: 5, 43: 3, 36: 1, 44: -1 };

export interface SheetHandle {
  // Moves the playback tracker to a score position.
  update(measure: number, tick: number, scroll: boolean): void;
}

interface Props {
  song: Song;
  track: Track;
  zoom: number;
  selection: Selection | null;
  scrollRef: React.RefObject<HTMLDivElement>;
  editing: boolean;
  caret: Caret | null;
  typing: boolean;
  onSeek(measure: number, tick: number): void;
  onSelect(range: Selection | null): void;
  onCaret(caret: Caret): void;
  onMeta(patch: { title?: string; artist?: string }): void;
}

export default forwardRef<SheetHandle, Props>(function SheetView(props, ref) {
  const { song, track, zoom, selection, scrollRef, editing, caret, typing, onSeek, onSelect, onCaret, onMeta } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const systemsRef = useRef<HTMLDivElement>(null);
  const trackerRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const highlighted = useRef<Element[]>([]);
  const lastSystem = useRef(-1);
  const [width, setWidth] = useState(0);
  const [dragRange, setDragRange] = useState<Selection | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    // Measure right away too: ResizeObserver doesn't fire while the page is hidden.
    setWidth(Math.floor(el.clientWidth));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => (width > 0 ? layoutSheet(song, track, width / zoom) : null), [song, track, width, zoom]);

  useImperativeHandle(
    ref,
    () => ({
      update(measure, tick, scroll) {
        const tracker = trackerRef.current;
        const tint = tintRef.current;
        const header = song.measures[measure];
        if (!layout || !tracker || !tint || !header) return;
        const pos = cursorPosition(layout, measure, tick, header.length);
        if (!pos) return;
        const { system, measure: m } = pos;
        const top = system.y + system.staffTop - 12;
        const height = system.staffBottom - system.staffTop + 24;
        // The tracker glides continuously with the audio clock (called every frame).
        tracker.style.transform = `translate(${pos.x - TRACKER_WIDTH / 2}px, ${top}px)`;
        tracker.style.height = `${height}px`;
        tracker.hidden = false;
        tint.style.transform = `translate(${m.x}px, ${top}px)`;
        tint.style.width = `${m.width}px`;
        tint.style.height = `${height}px`;
        tint.hidden = false;

        // Highlight the notes under the tracker.
        const root = systemsRef.current;
        const ids = [`${measure}:0:${pos.slotTick}`, `${measure}:1:${pos.slotTick}`];
        const now = root ? ids.flatMap((id) => [...root.querySelectorAll(`[data-beat="${id}"]`)]) : [];
        if (now.length !== highlighted.current.length || now.some((e, i) => e !== highlighted.current[i])) {
          for (const e of highlighted.current) e.classList.remove('on');
          for (const e of now) e.classList.add('on');
          highlighted.current = now;
        }

        // Keep the current line in view, easing the scroll a little every frame.
        const viewport = scrollRef.current;
        if (scroll && viewport && root) {
          const systemTop = root.offsetTop + system.y * zoom;
          const target = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, systemTop - viewport.clientHeight * 0.2));
          const diff = target - viewport.scrollTop;
          if (Math.abs(diff) > 0.5) viewport.scrollTop += Math.abs(diff) > viewport.clientHeight * 1.5 ? diff : diff * 0.12;
        }
        lastSystem.current = system.index;
      },
    }),
    [layout, song, zoom, scrollRef],
  );

  // Position the editing caret.
  useLayoutEffect(() => {
    const el = caretRef.current;
    if (!el) return;
    if (!editing || !caret || !layout) {
      el.hidden = true;
      return;
    }
    const system = layout.systems[layout.measureToSystem[caret.measure]];
    const m = system?.measures.find((x) => x.index === caret.measure);
    const beat = track.measures[caret.measure]?.voices[0]?.beats[caret.beat];
    const bl = m?.beats.find((b) => b.voice === 0 && b.beat === beat);
    if (!system || !m || !bl) {
      el.hidden = true;
      return;
    }
    const y = layout.drums
      ? system.staffBottom - (DRUM_STEPS[DRUM_ROWS[caret.string]?.key] ?? 5) * (DRUM_GAP / 2)
      : system.staffTop + caret.string * TAB_GAP;
    el.style.transform = `translate(${m.x + bl.x - 11}px, ${system.y + y - 8.5}px)`;
    el.hidden = false;
    el.classList.toggle('typing', typing);

    // Scroll the caret into view.
    const viewport = scrollRef.current;
    const root = systemsRef.current;
    if (viewport && root) {
      const top = root.offsetTop + (system.y + y) * zoom;
      if (top < viewport.scrollTop + 60 || top > viewport.scrollTop + viewport.clientHeight - 60) {
        viewport.scrollTo({ top: top - viewport.clientHeight / 2, behavior: 'smooth' });
      }
    }
  }, [editing, caret, layout, track, typing, zoom, scrollRef]);

  // Click: place the caret (editing) or the playback position. Drag: select bars to loop.
  const toSheet = (e: React.PointerEvent) => {
    const rect = systemsRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  };
  const drag = useRef<{ x: number; y: number; measure: number; tick: number; row: number; moved: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!layout || e.button !== 0) return;
    const p = toSheet(e);
    const hit = hitTest(layout, p.x, p.y);
    if (!hit) return;
    drag.current = { x: e.clientX, y: e.clientY, measure: hit.measure, tick: hit.tick, row: hit.row, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !layout) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    const p = toSheet(e);
    const hit = hitTest(layout, p.x, p.y);
    if (hit) setDragRange({ from: Math.min(d.measure, hit.measure), to: Math.max(d.measure, hit.measure) });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved && dragRange) {
      onSelect(dragRange);
      onSeek(dragRange.from, 0);
    } else if (editing) {
      const beats = track.measures[d.measure]?.voices[0]?.beats ?? [];
      let index = beats.findIndex((b) => b.start <= d.tick && d.tick < b.start + b.duration);
      if (index < 0) index = Math.max(0, beats.length - 1);
      onCaret({ measure: d.measure, beat: index, string: rowFromStaff(d.row) });
    } else {
      onSeek(d.measure, d.tick);
    }
    setDragRange(null);
  };

  // Maps a vertical staff position to a tab string or drum row.
  const rowFromStaff = (row: number): number => {
    if (!track.isPercussion) return Math.max(0, Math.min(track.tuning.length - 1, Math.round(row)));
    const step = (4 - row) * 2; // drum staff: row 4 = bottom line = step 0
    let best = 0;
    DRUM_ROWS.forEach((r, i) => {
      if (Math.abs((DRUM_STEPS[r.key] ?? 5) - step) < Math.abs((DRUM_STEPS[DRUM_ROWS[best].key] ?? 5) - step)) best = i;
    });
    return best;
  };

  const tuning = track.isPercussion ? '' : track.tuning.map((p) => NOTE_NAMES[p % 12]).reverse().join(' ');
  const { family } = instrumentOf(track.program, track.isPercussion);
  const overfilled = editing && caret && isOverfilled(song, track, caret.measure);

  return (
    <div className="sheet" ref={hostRef}>
      <header className="sheet-head">
        {editing ? (
          <>
            <input className="title-input" value={song.title} placeholder="Song title" aria-label="Song title" onChange={(e) => onMeta({ title: e.target.value })} />
            <input className="artist-input" value={song.artist} placeholder="Artist" aria-label="Artist" onChange={(e) => onMeta({ artist: e.target.value })} />
          </>
        ) : (
          <>
            <h1>{song.title || 'Untitled'}</h1>
            {song.subtitle && <p className="sub">{song.subtitle}</p>}
            <p className="by">{song.artist}</p>
          </>
        )}
        <p className="meta">
          {track.name} · {family}
          {tuning && ` · Tuning: ${tuning}`}
          {track.capo ? ` · Capo fret ${track.capo}` : ''}
        </p>
        {overfilled && <p className="overfill">Bar {caret!.measure + 1} has too many beats. Shorten or delete a beat.</p>}
      </header>
      <div
        className="systems"
        ref={systemsRef}
        style={{ height: layout ? layout.height * zoom : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
          setDragRange(null);
        }}
      >
        {layout && (
          <div className="systems-inner" style={{ width: width / zoom, transform: `scale(${zoom})` }}>
            <div className="bar-tint" ref={tintRef} hidden />
            <TabSheet song={song} track={track} layout={layout} selection={dragRange ?? selection} />
            <div className="tracker" ref={trackerRef} hidden />
            <div className="caret" ref={caretRef} hidden />
          </div>
        )}
      </div>
    </div>
  );
});
