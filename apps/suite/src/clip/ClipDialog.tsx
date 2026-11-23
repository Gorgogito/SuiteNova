import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import {
  CLIP_COLORS,
  CLIP_WIDTHS,
  clampPoint,
  clipFileName,
  commit,
  cropBox,
  describeSize,
  drawStrokes,
  emptyHistory,
  eraseAlong,
  fitScale,
  isZone,
  moveRect,
  rectBetween,
  redo,
  resizeRect,
  simplify,
  undo,
  type History,
  type Point,
  type Rect,
  type Stroke,
  type Tool,
} from '@suitenova/clip-core';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import './messages';
import { useRestorePage } from './restorePage';
import { cropToPng } from './source';

type Mode = 'zone' | Tool | 'eraser';

const TOOLS: { id: Mode; label: string }[] = [
  { id: 'zone', label: 'Zona' },
  { id: 'pen', label: 'Lápiz' },
  { id: 'highlighter', label: 'Resaltador' },
  { id: 'arrow', label: 'Flecha' },
  { id: 'rect', label: 'Rectángulo' },
  { id: 'eraser', label: 'Borrador' },
];

/** The capture with the marks drawn on it (the capture itself when there are none). */
function marked(canvas: HTMLCanvasElement, strokes: Stroke[]): HTMLCanvasElement {
  if (!strokes.length) return canvas;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const g = out.getContext('2d')!;
  g.drawImage(canvas, 0, 0);
  drawStrokes(g, strokes);
  return out;
}

/**
 * The screen clip dialog shared by every product: the capture is shown and the person chooses the area with the pointer or the keyboard, marks it
 * (pen, highlighter, arrow, rectangle, eraser, undo), then inserts it, copies it or saves it as a PNG. With no area, the whole capture is used.
 * What to do with the PNG when inserting is the product's.
 */
export function ClipDialog({ canvas, initialZone, onInsert, onClose }: { canvas: HTMLCanvasElement; /** The area already chosen (on the real screen), if any. */ initialZone?: Rect | null; onInsert: (png: Blob, w: number, h: number) => void | Promise<void>; onClose: () => void }) {
  useRestorePage();
  const bounds = { w: canvas.width, h: canvas.height };
  const view = useRef<HTMLCanvasElement>(null);
  const [zone, setZone] = useState<Rect | null>(initialZone && isZone(initialZone) ? initialZone : null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('zone');
  const [color, setColor] = useState(CLIP_COLORS[0]!.color);
  const [widthPx, setWidthPx] = useState(CLIP_WIDTHS[1]!.px);
  const [hist, setHist] = useState<History>(emptyHistory());
  const [live, setLive] = useState<Stroke | null>(null);
  const drag = useRef<{ mode: 'new' | 'move' | 'draw' | 'erase'; from: Point; start: Rect | null } | null>(null);
  const erased = useRef(false);
  const nextId = useRef(1);
  const scale = fitScale(bounds, { w: 860, h: 400 });
  const strokes = hist.present;

  useEffect(() => {
    const v = view.current!;
    v.width = Math.max(1, Math.round(bounds.w * scale));
    v.height = Math.max(1, Math.round(bounds.h * scale));
    const g = v.getContext('2d')!;
    g.drawImage(canvas, 0, 0, v.width, v.height);
    drawStrokes(g, live ? [...strokes, live] : strokes, scale);
  }, [canvas, bounds.w, bounds.h, scale, strokes, live]);

  /** Where the pointer is, in pixels of the capture. */
  const at = (e: PointerEvent): Point => {
    const r = view.current!.getBoundingClientRect();
    return clampPoint({ x: ((e.clientX - r.left) / (r.width || 1)) * bounds.w, y: ((e.clientY - r.top) / (r.height || 1)) * bounds.h }, bounds);
  };
  /** Capture pixels per screen pixel: a mark drawn 4 px thick on the screen is 4 × this thick in the capture. */
  const perScreenPx = () => bounds.w / (view.current!.getBoundingClientRect().width || bounds.w);
  const inside = (p: Point, z: Rect | null) => !!z && isZone(z) && p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

  /** Erases what the pointer touched on its way from `from` to `to`; one drag of the eraser is one step of the history. */
  const erase = (from: Point, to: Point) => {
    const tol = 6 * perScreenPx();
    if (eraseAlong(hist.present, from, to, tol) === hist.present) return;
    const first = !erased.current;
    erased.current = true;
    setHist((h) => {
      const next = eraseAlong(h.present, from, to, tol);
      return next === h.present ? h : first ? commit(h, next) : { ...h, present: next };
    });
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    const p = at(e);
    if (mode === 'eraser') {
      drag.current = { mode: 'erase', from: p, start: null };
      erased.current = false;
      erase(p, p);
    } else if (mode !== 'zone') {
      drag.current = { mode: 'draw', from: p, start: null };
      setLive({ id: nextId.current++, tool: mode, color, width: widthPx * perScreenPx(), points: [p] });
    } else {
      drag.current = inside(p, zone) ? { mode: 'move', from: p, start: zone } : { mode: 'new', from: p, start: null };
      if (drag.current.mode === 'new') setZone({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  };
  const moveTo = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    if (d.mode === 'erase') {
      erase(d.from, p);
      d.from = p;
    }
    else if (d.mode === 'draw') setLive((s) => (s ? { ...s, points: s.tool === 'arrow' || s.tool === 'rect' ? [d.from, p] : [...s.points, p] } : s));
    else setZone(d.mode === 'new' ? rectBetween(d.from, p) : moveRect(d.start!, p.x - d.from.x, p.y - d.from.y, bounds));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'draw' && live) {
      const [a, b] = [live.points[0]!, live.points[live.points.length - 1]!];
      const tiny = (live.tool === 'arrow' || live.tool === 'rect') && Math.hypot(b.x - a.x, b.y - a.y) < 3 * perScreenPx();
      if (!tiny) {
        const done = live.tool === 'pen' || live.tool === 'highlighter' ? { ...live, points: simplify(live.points, perScreenPx()) } : live;
        setHist((h) => commit(h, [...h.present, done]));
      }
      setLive(null);
    } else if (d && d.mode !== 'erase') setZone((z) => (isZone(z) ? z : null));
  };

  // Ctrl+Z / Ctrl+Y work wherever the focus is while the dialog is open (a button that just got disabled leaves the focus on the page)
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
      else if (k === 'y') setHist(redo);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const key = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== view.current || mode !== 'zone') return;
    const step = e.shiftKey ? 10 : 1;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as string];
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setZone(null);
    } else if (dir) {
      e.preventDefault();
      // with no zone yet the first arrow starts one in the middle of the capture
      const z = isZone(zone) ? zone : { x: bounds.w / 4, y: bounds.h / 4, w: bounds.w / 2, h: bounds.h / 2 };
      setZone(e.ctrlKey ? resizeRect(z, dir[0]! * step, dir[1]! * step, bounds) : moveRect(z, dir[0]! * step, dir[1]! * step, bounds));
    }
  };

  const box = cropBox(zone, bounds);
  const png = () => cropToPng(marked(canvas, strokes), box);
  const insert = async () => {
    setBusy(true);
    try {
      await onInsert(await png(), box.w, box.h);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })]);
      setNote(t('Copiado al portapapeles.'));
    } catch {
      setNote(t('No se pudo copiar la imagen al portapapeles.'));
    }
  };
  const save = async () => {
    const url = URL.createObjectURL(await png());
    const a = document.createElement('a');
    a.href = url;
    a.download = clipFileName(t('Recorte de pantalla'));
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const marks = strokes.length ? `, ${strokes.length === 1 ? t('1 anotación') : t('{n} anotaciones', { n: strokes.length })}` : '';
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 940, width: '96vw' }}>
        <DialogBody>
          <DialogTitle>{t('Recorte de pantalla')}</DialogTitle>
          <DialogContent onKeyDown={key}>
            <div role="toolbar" aria-label={t('Herramientas de anotación')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <div role="radiogroup" aria-label={t('Herramienta')} style={{ display: 'flex', gap: 4 }}>
                {TOOLS.map((tl) => (
                  <Button key={tl.id} size="small" role="radio" aria-checked={mode === tl.id} appearance={mode === tl.id ? 'primary' : 'secondary'} onClick={() => setMode(tl.id)}>
                    {t(tl.label)}
                  </Button>
                ))}
              </div>
              <div role="group" aria-label={t('Color')} style={{ display: 'flex', gap: 4 }}>
                {CLIP_COLORS.map((c) => (
                  <button key={c.color} type="button" title={t(c.name)} aria-label={t(c.name)} aria-pressed={color === c.color} onClick={() => setColor(c.color)} style={{ width: 22, height: 22, borderRadius: 11, background: c.color, border: color === c.color ? '3px solid #0f6cbd' : '1px solid #8a8a8a', cursor: 'pointer' }} />
                ))}
              </div>
              <div role="radiogroup" aria-label={t('Grosor')} style={{ display: 'flex', gap: 4 }}>
                {CLIP_WIDTHS.map((w) => (
                  <Button key={w.px} size="small" role="radio" aria-checked={widthPx === w.px} appearance={widthPx === w.px ? 'primary' : 'secondary'} onClick={() => setWidthPx(w.px)}>
                    {t(w.name)}
                  </Button>
                ))}
              </div>
              <Button size="small" disabled={!hist.past.length} onClick={() => setHist(undo)}>
                {t('Deshacer')}
              </Button>
              <Button size="small" disabled={!hist.future.length} onClick={() => setHist(redo)}>
                {t('Rehacer')}
              </Button>
              <Button size="small" disabled={!strokes.length} onClick={() => setHist((h) => commit(h, []))}>
                {t('Quitar anotaciones')}
              </Button>
            </div>
            <p style={{ marginTop: 0 }}>{t('Arrastra sobre la captura para elegir la zona, o arrástrala desde dentro para moverla. Con el teclado: flechas para mover, Ctrl y flechas para cambiar el tamaño, Mayús para ir de 10 en 10, Supr para quitar la zona. Si no eliges ninguna se usa la captura entera.')} {t('Para anotar, elige una herramienta y dibuja con el puntero (Ctrl+Z deshace, Ctrl+Y rehace); con el teclado solo se elige la zona.')}</p>
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', overflow: 'hidden', touchAction: 'none', lineHeight: 0 }}>
              <canvas
                ref={view}
                tabIndex={0}
                role="application"
                aria-label={`${t('Captura de pantalla')}: ${isZone(zone) ? `${t('Zona elegida')} ${describeSize(box)}` : t('Toda la captura')}${marks}`}
                data-testid="clip-canvas"
                style={{ maxWidth: '100%', height: 'auto', cursor: mode === 'eraser' ? 'cell' : 'crosshair', display: 'block' }}
                onPointerDown={down}
                onPointerMove={moveTo}
                onPointerUp={up}
              />
              {isZone(zone) && <div data-testid="clip-zone" style={{ position: 'absolute', left: pct(zone.x, bounds.w), top: pct(zone.y, bounds.h), width: pct(zone.w, bounds.w), height: pct(zone.h, bounds.h), border: '2px dashed #ffffff', outline: '1px solid #0f6cbd', boxShadow: '0 0 0 9999px rgba(0,0,0,.45)', pointerEvents: 'none' }} />}
            </div>
            <div aria-live="polite" style={{ marginTop: 6, minHeight: 20, opacity: 0.8 }}>
              {note || `${isZone(zone) ? t('Zona elegida') : t('Toda la captura')}: ${describeSize(box)}${marks}`}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => void copy()}>{t('Copiar')}</Button>
            <Button onClick={() => void save()}>{t('Guardar como PNG')}</Button>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button appearance="primary" disabled={busy} onClick={() => void insert()}>
              {isZone(zone) ? t('Insertar el recorte') : t('Insertar todo')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
