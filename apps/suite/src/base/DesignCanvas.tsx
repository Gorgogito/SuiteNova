import { GRID, normalizeBox, type Box } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useRef, useState, type ReactNode } from 'react';

export interface CanvasItem extends Box {
  id: string;
  /** Accessible name: what the control is, for screen readers. */
  label: string;
  /** Lines are thin: they are drawn and selected by their top edge. */
  thin?: boolean;
}

interface Props {
  width: number;
  height: number;
  items: CanvasItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** A move or a resize ended (one call per gesture, or per key press). */
  onChange: (id: string, box: Box) => void;
  onDelete?: (id: string) => void;
  render: (item: CanvasItem) => ReactNode;
  className?: string;
  ariaLabel: string;
}

type Gesture = { id: string; mode: 'move' | 'resize'; sx: number; sy: number; start: Box; box: Box };

/**
 * A canvas of boxes that can be dragged and resized with the mouse, and moved with the arrow keys
 * (Shift+arrows resize, Delete removes). Positions snap to a grid. Every box is also reachable through the property panel.
 */
export function DesignCanvas({ width, height, items, selected, onSelect, onChange, onDelete, render, className, ariaLabel }: Props) {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const ref = useRef<Gesture | null>(null);

  const begin = (e: React.PointerEvent, item: CanvasItem, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(item.id);
    const g: Gesture = { id: item.id, mode, sx: e.clientX, sy: e.clientY, start: { x: item.x, y: item.y, w: item.w, h: item.h }, box: { x: item.x, y: item.y, w: item.w, h: item.h } };
    ref.current = g;
    setGesture(g);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const g = ref.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    const s = g.start;
    const box = g.mode === 'move' ? { ...s, x: s.x + dx, y: s.y + dy } : { ...s, w: s.w + dx, h: s.h + dy };
    const next = { ...g, box: normalizeBox(box, { grid: e.altKey ? 0 : GRID, maxW: width }) };
    ref.current = next;
    setGesture(next);
  };
  const end = () => {
    const g = ref.current;
    ref.current = null;
    setGesture(null);
    if (g && (g.box.x !== g.start.x || g.box.y !== g.start.y || g.box.w !== g.start.w || g.box.h !== g.start.h)) onChange(g.id, g.box);
  };

  const onKey = (e: React.KeyboardEvent, item: CanvasItem) => {
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[e.key];
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      const step = e.altKey ? 1 : GRID;
      const b: Box = e.shiftKey ? { ...item, w: item.w + a[0] * step, h: item.h + a[1] * step } : { ...item, x: item.x + a[0] * step, y: item.y + a[1] * step };
      onChange(item.id, normalizeBox(b, { grid: e.altKey ? 0 : GRID, maxW: width }));
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && onDelete) {
      e.preventDefault();
      e.stopPropagation();
      onDelete(item.id);
    } else if (e.key === 'Escape') onSelect(null);
  };

  return (
    <div
      className={`bs-canvas${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={ariaLabel}
      style={{ width, height }}
      onPointerDown={() => onSelect(null)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {items.map((it) => {
        const g = gesture?.id === it.id ? gesture.box : it;
        const on = selected === it.id;
        return (
          <div
            key={it.id}
            role="button"
            tabIndex={0}
            aria-label={it.label}
            aria-pressed={on}
            className={`bs-cv-item${on ? ' is-sel' : ''}${it.thin ? ' is-thin' : ''}`}
            style={{ left: g.x, top: g.y, width: g.w, height: it.thin ? Math.max(g.h, 6) : g.h }}
            onPointerDown={(e) => begin(e, it, 'move')}
            onFocus={() => onSelect(it.id)}
            onKeyDown={(e) => onKey(e, it)}
          >
            <div className="bs-cv-body">{render(it)}</div>
            {on && <div className="bs-cv-grip" aria-hidden="true" title={t('Cambiar tamaño')} onPointerDown={(e) => begin(e, it, 'resize')} />}
          </div>
        );
      })}
    </div>
  );
}

/** Undo and redo for edits of a design (a stack of snapshots). */
export function pushHistory<T>(past: T[], current: T, limit = 100): T[] {
  return [...past, current].slice(-limit);
}
