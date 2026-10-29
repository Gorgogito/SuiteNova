import { cropBy, panCrop, type CropHandle, type PicEl, addNodeAt, newId, clearCells, scaleTable, curveThrough, dragHandle, findElement, geometryOf, localToSlide, moveHandle, moveNode, nearestOnPaths, newFreeform, newLine, newShape, newTextBox, pathsToSvg, presetDefaults, simplify, slideToLocal, updateElement, visualBox, type Box, type Paths, type Pt, type ConnEl, type ShapeEl, type SlideElement, type TableEl, type Xfrm } from '@suitenova/slides-core';
import { CommentMarks } from './comments';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ShapeTextEditor } from './edit/TextEditor';
import { stepCell, TableLayer } from './TableTools';
import { pasteFormat } from './commands';
import type { SlidesCtl } from './ctl';
import { SlideCanvas, shapeLayout, useSlideEnv } from './render/SlideCanvas';

/*
 * The slide editing surface: the slide drawn by SlideCanvas, with a layer on top for selecting, moving, resizing, rotating,
 * drawing and editing the text of objects. Coordinates in the layer are slide points; the whole surface is scaled to fit.
 */

const GRID = 6;
const SNAP = 6; // screen px

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: { h: Handle; fx: number; fy: number; cursor: string }[] = [
  { h: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { h: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { h: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { h: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { h: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { h: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { h: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { h: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

type Gesture =
  | { kind: 'move'; start: { x: number; y: number }; orig: Record<string, Xfrm>; moved: boolean; copy: boolean }
  | { kind: 'resize'; handle: Handle; orig: Record<string, Xfrm>; box: Xfrm; keep: boolean }
  | { kind: 'rotate'; id: string; center: { x: number; y: number }; orig: Xfrm }
  | { kind: 'marquee'; start: { x: number; y: number }; add: boolean }
  | { kind: 'draw'; start: { x: number; y: number } }
  | { kind: 'adjust'; id: string; index: number }
  | { kind: 'guide'; id: string }
  | { kind: 'scribble' }
  | { kind: 'lineend'; id: string; which: 'a' | 'b'; fixed: { x: number; y: number } }
  | { kind: 'cells'; id: string; ar: number; ac: number; moved: boolean }
  | { kind: 'crop'; id: string; handle: CropHandle | 'pan'; start: { x: number; y: number }; el: PicEl; xf: Xfrm }
  | { kind: 'pt-node'; id: string; si: number; ni: number; paths0: Paths; x0: Xfrm }
  | { kind: 'pt-handle'; id: string; si: number; ni: number; which: 'hin' | 'hout'; paths0: Paths; x0: Xfrm };

interface FreeformDraft {
  pts: Pt[];
  hover: Pt | null;
  mode: 'polygon' | 'curve' | 'scribble';
}
const dist2 = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

const rotPoint = (px: number, py: number, cx: number, cy: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
};

export function Stage({ ctl, onContext }: { ctl: SlidesCtl; onContext?: (e: React.MouseEvent, id: string | null) => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const { deck } = ctl;
  const slide = ctl.slide;
  const w = deck.size.w;
  const h = deck.size.h;
  const wrap = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gref = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [smart, setSmart] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [draw, setDraw] = useState<Box | null>(null);
  const [ff, setFf] = useState<FreeformDraft | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const zoom = ctl.zoom > 0 ? ctl.zoom / 100 : fit;
  useEffect(() => {
    const pct = Math.round(fit * 100);
    if (ctl.fitPercent !== pct) {
      ctl.fitPercent = pct;
      queueMicrotask(() => ctl.touch());
    }
  }, [fit, ctl]);

  // fit the slide in the available space
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const k = Math.min((el.clientWidth - 48) / w, (el.clientHeight - 48) / h);
      setFit(Math.max(0.1, Math.min(4, k)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  const { ctx } = useSlideEnv(deck, slide, ctl.urls, ctl.index + 1, true, undefined);
  const editCtx = useMemo(() => ({ ...ctx, editingId: ctl.editing }), [ctx, ctl.editing]);

  const toSlide = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = surface.current!.getBoundingClientRect();
      return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
    },
    [zoom],
  );

  // ---- hit testing
  const hit = useCallback(
    (p: { x: number; y: number }): SlideElement | null => {
      const tol = 4 / zoom;
      for (let i = slide.shapes.length - 1; i >= 0; i--) {
        const el = slide.shapes[i]!;
        if (el.hidden || el.locked) continue;
        let x = ctl.xfrmOf(el);
        if (el.kind === 'table') {
          // rows grow with their text: the table is as tall as it is drawn
          const dom = surface.current?.querySelector<HTMLElement>(`.sl-table[data-id="${el.id}"]`);
          if (dom) x = { ...x, h: Math.max(x.h, dom.getBoundingClientRect().height / zoom) };
        }
        const c = { x: x.x + x.w / 2, y: x.y + x.h / 2 };
        const q = x.rot ? rotPoint(p.x, p.y, c.x, c.y, -x.rot) : p;
        const inside = q.x >= x.x - tol && q.x <= x.x + x.w + tol && q.y >= x.y - tol && q.y <= x.y + x.h + tol;
        if (!inside) continue;
        if (el.kind === 'cxn') {
          // a line is selected near the line itself
          if (x.h < 1 && Math.abs(q.y - x.y) > tol * 2) continue;
          if (x.w < 1 && Math.abs(q.x - x.x) > tol * 2) continue;
        } else if (el.kind === 'shape') {
          const filled = !!((el.fill && el.fill.t !== 'none') || el.style?.fill?.idx || (!el.isTextBox && !el.ph));
          const hasText = !!el.text && JSON.stringify(el.text.doc).includes('"text"');
          if (!filled && !hasText && !el.ph) {
            // an unfilled shape without text is selected by its outline
            const near = q.x <= x.x + tol * 2 || q.x >= x.x + x.w - tol * 2 || q.y <= x.y + tol * 2 || q.y >= x.y + x.h - tol * 2;
            if (!near) continue;
          }
        }
        return el;
      }
      return null;
    },
    [slide, ctl, zoom],
  );

  // ---- snapping
  const snapBox = useCallback(
    (b: Box, exclude: string[]): { dx: number; dy: number; v: number[]; hh: number[] } => {
      const tol = SNAP / zoom;
      const xs: number[] = [0, w / 2, w];
      const ys: number[] = [0, h / 2, h];
      for (const g of deck.guides ?? []) (g.orient === 'v' ? xs : ys).push(g.pos);
      for (const el of slide.shapes) {
        if (exclude.includes(el.id) || el.hidden) continue;
        const v = visualBox(ctl.xfrmOf(el));
        xs.push(v.x, v.x + v.w / 2, v.x + v.w);
        ys.push(v.y, v.y + v.h / 2, v.y + v.h);
      }
      let dx = 0;
      let dy = 0;
      let bestX = tol + 0.001;
      let bestY = tol + 0.001;
      const vlines: number[] = [];
      const hlines: number[] = [];
      for (const mine of [b.x, b.x + b.w / 2, b.x + b.w]) {
        for (const t of xs) {
          const d = t - mine;
          if (Math.abs(d) < bestX) {
            bestX = Math.abs(d);
            dx = d;
          }
        }
      }
      for (const mine of [b.y, b.y + b.h / 2, b.y + b.h]) {
        for (const t of ys) {
          const d = t - mine;
          if (Math.abs(d) < bestY) {
            bestY = Math.abs(d);
            dy = d;
          }
        }
      }
      if (bestX <= tol) for (const mine of [b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w]) if (xs.some((t) => Math.abs(t - mine) < 0.01)) vlines.push(mine);
      if (bestY <= tol) for (const mine of [b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h]) if (ys.some((t) => Math.abs(t - mine) < 0.01)) hlines.push(mine);
      if (ctl.showGrid && ctl.snap) {
        if (bestX > tol) dx = Math.round(b.x / GRID) * GRID - b.x;
        if (bestY > tol) dy = Math.round(b.y / GRID) * GRID - b.y;
      }
      return { dx, dy, v: vlines, hh: hlines };
    },
    [deck.guides, slide, ctl, w, h, zoom],
  );

  // ---- selection geometry
  const selected = ctl.selected;
  const editEl = ctl.editPoints && !ctl.editing ? (ctl.element(ctl.editPoints) as ShapeEl | null) : null;
  const editOn = !!editEl && editEl.kind === 'shape' && selected.length === 1 && selected[0]!.id === editEl.id;
  const selBox: Xfrm | null = useMemo(() => {
    if (!selected.length) return null;
    if (selected.length === 1) return ctl.xfrmOf(selected[0]!);
    const vb = selected.map((e) => visualBox(ctl.xfrmOf(e)));
    const x1 = Math.min(...vb.map((b) => b.x));
    const y1 = Math.min(...vb.map((b) => b.y));
    const x2 = Math.max(...vb.map((b) => b.x + b.w));
    const y2 = Math.max(...vb.map((b) => b.y + b.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, deck]);

  const setG = (g: Gesture | null) => {
    gref.current = g;
    setGesture(g);
  };

  // ---- freeform drawing (polygon, curve, scribble)
  const finishFreeform = (closed: boolean, from: FreeformDraft | null = ff) => {
    setFf(null);
    if (!from) return;
    let pts = from.pts.filter((q, i) => i === 0 || dist2(q, from.pts[i - 1]!) > 2 / zoom);
    if (from.mode === 'scribble') pts = simplify(pts, 2);
    if (pts.length < (closed ? 3 : 2)) {
      ctl.setTool({ kind: 'select' });
      return;
    }
    const sub = from.mode === 'polygon' ? { nodes: pts.map((q) => ({ x: q.x, y: q.y, kind: 'corner' as const })), closed } : curveThrough(pts, closed && from.mode === 'curve');
    ctl.addElement(newFreeform([sub], from.mode === 'scribble' ? 'Garabato' : from.mode === 'curve' ? 'Curva' : 'Forma libre'));
    ctl.setTool({ kind: 'select' });
  };
  const startFreeform = (e: React.PointerEvent, p: Pt) => {
    const mode = ctl.tool.kind === 'freeform' ? ctl.tool.mode : 'polygon';
    if (mode === 'scribble') {
      surface.current!.setPointerCapture(e.pointerId);
      setG({ kind: 'scribble' });
      setFf({ pts: [p], hover: null, mode });
      return;
    }
    if (ff && ff.pts.length >= 3 && dist2(p, ff.pts[0]!) < 8 / zoom) {
      finishFreeform(true);
      return;
    }
    setFf({ pts: [...(ff?.pts ?? []), p], hover: p, mode });
  };

  // ---- edit points: handles and nodes of the shape being edited
  const editDown = (e: React.PointerEvent, p: Pt): boolean => {
    if (!editOn || !editEl) return false;
    const x = ctl.xfrmOf(editEl);
    const paths = ctl.pointsOf(editEl);
    const lp = slideToLocal(p, x);
    const tol = 7 / zoom;
    const sel = ctl.editPt;
    if (sel) {
      const n = paths[sel.si]?.nodes[sel.ni];
      for (const which of ['hin', 'hout'] as const) {
        const hp = n?.[which];
        if (hp && dist2(hp, lp) < tol) {
          surface.current!.setPointerCapture(e.pointerId);
          setG({ kind: 'pt-handle', id: editEl.id, ...sel, which, paths0: paths, x0: x });
          return true;
        }
      }
    }
    for (let si = 0; si < paths.length; si++) {
      for (let ni = 0; ni < paths[si]!.nodes.length; ni++) {
        if (dist2(paths[si]!.nodes[ni]!, lp) < tol) {
          ctl.editPt = { si, ni };
          ctl.touch();
          surface.current!.setPointerCapture(e.pointerId);
          setG({ kind: 'pt-node', id: editEl.id, si, ni, paths0: paths, x0: x });
          return true;
        }
      }
    }
    const near = nearestOnPaths(paths, lp);
    if (near && near.d < tol) {
      const r = addNodeAt(paths, near.si, near.seg, near.t);
      ctl.setPaths(editEl, r.paths, 'Agregar punto');
      ctl.editPt = { si: near.si, ni: r.index };
      ctl.touch();
      return true;
    }
    return false;
  };

  // ---- table cells
  /** The cell of a table under a screen point (its origin cell), or null. */
  const cellAtPoint = (clientX: number, clientY: number, id: string): { r: number; c: number } | null => {
    for (const n of document.elementsFromPoint(clientX, clientY)) {
      const td = (n as HTMLElement).closest?.('td[data-r]') as HTMLElement | null;
      if (td && td.closest('.sl-table')?.getAttribute('data-id') === id) return { r: Number(td.dataset.r), c: Number(td.dataset.c) };
    }
    return null;
  };
  /** The outer edge of a table is for moving it; inside that edge a click goes to the cells. */
  const inTableEdge = (clientX: number, clientY: number, id: string): boolean => {
    const dom = surface.current?.querySelector<HTMLElement>(`.sl-table[data-id="${id}"]`);
    if (!dom) return false;
    const b = dom.getBoundingClientRect();
    const band = 6;
    return clientX < b.left + band || clientX > b.right - band || clientY < b.top + band || clientY > b.bottom - band;
  };

  // ---- pointer down on the surface
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.sl-handle, .sl-adjust, .sl-edit-wrap, .sl-grip')) return;
    const p = toSlide(e);
    surface.current!.setPointerCapture(e.pointerId);
    ctl.containerFocus?.();
    if (ctl.tool.kind === 'freeform') {
      startFreeform(e, p);
      return;
    }
    if (editOn && editDown(e, p)) return;
    // insert tools
    if (ctl.tool.kind !== 'select') {
      setG({ kind: 'draw', start: p });
      setDraw({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    // format painter
    const target = hit(p);
    if (ctl.painter && target) {
      pasteFormat(ctl, [target.id]);
      if (!ctl.painter.sticky) ctl.painter = null;
      ctl.touch();
      return;
    }
    if (target && ctl.cropPic && target.id === ctl.cropPic.id) {
      setG({ kind: 'crop', id: target.id, handle: 'pan', start: p, el: target as PicEl, xf: ctl.xfrmOf(target) });
      return;
    }
    if (target) {
      if (target.kind === 'table' && !e.ctrlKey) {
        const cell = cellAtPoint(e.clientX, e.clientY, target.id);
        if (cell && !inTableEdge(e.clientX, e.clientY, target.id)) {
          const cur = ctl.cellSelection;
          const extend = e.shiftKey && !!cur && cur.id === target.id;
          if (extend) ctl.selectCells(target.id, cur!.ar, cur!.ac, cell.r, cell.c);
          else ctl.selectCells(target.id, cell.r, cell.c);
          setG({ kind: 'cells', id: target.id, ar: extend ? cur!.ar : cell.r, ac: extend ? cur!.ac : cell.c, moved: extend });
          return;
        }
        if (!e.shiftKey) ctl.selectTable(target.id);
      }
      if (e.shiftKey || e.ctrlKey) {
        ctl.toggleSelect(target.id);
        return;
      }
      if (!ctl.selection.includes(target.id)) ctl.select([target.id]);
      else if (ctl.editing && ctl.editing !== target.id) ctl.select([target.id]);
      if (ctl.editing === target.id) return;
      const ids = ctl.selection.includes(target.id) ? ctl.selection : [target.id];
      const orig: Record<string, Xfrm> = {};
      for (const id of ids) {
        const el = ctl.element(id);
        if (el) orig[id] = ctl.xfrmOf(el);
      }
      setG({ kind: 'move', start: p, orig, moved: false, copy: e.ctrlKey });
    } else {
      if (!e.shiftKey) ctl.select([]);
      setG({ kind: 'marquee', start: p, add: e.shiftKey });
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gref.current;
    if (!g) {
      if (ff && ff.mode !== 'scribble') setFf({ ...ff, hover: toSlide(e) });
      return;
    }
    const p = toSlide(e);
    if (g.kind === 'scribble') {
      setFf((cur) => (cur && dist2(p, cur.pts[cur.pts.length - 1]!) > 1.5 / zoom ? { ...cur, pts: [...cur.pts, p] } : cur));
      return;
    }
    if (g.kind === 'pt-node' || g.kind === 'pt-handle') {
      const el = ctl.element(g.id) as ShapeEl | null;
      if (!el) return;
      const lp = slideToLocal(p, g.x0);
      ctl.beginGesture('Mover punto');
      ctl.setPaths(el, g.kind === 'pt-node' ? moveNode(g.paths0, g.si, g.ni, lp) : moveHandle(g.paths0, g.si, g.ni, g.which, lp), null, g.x0);
      return;
    }
    if (g.kind === 'crop') {
      const rot = g.xf.rot ?? 0;
      const d = rot ? rotPoint(p.x - g.start.x, p.y - g.start.y, 0, 0, -rot) : { x: p.x - g.start.x, y: p.y - g.start.y };
      ctl.beginGesture('Recortar');
      if (g.handle === 'pan') ctl.liveDeck((dk) => updateElement(dk, slide.id, g.id, (el) => ({ ...el, srcRect: panCrop(g.el, g.xf, d.x, d.y) }) as SlideElement));
      else {
        const r = cropBy(g.el, g.xf, g.handle, d.x, d.y);
        ctl.liveDeck((dk) => updateElement(dk, slide.id, g.id, (el) => ({ ...el, xfrm: r.xfrm, srcRect: r.srcRect }) as SlideElement));
      }
      return;
    }
    if (g.kind === 'cells') {
      const cell = cellAtPoint(e.clientX, e.clientY, g.id);
      const cur = ctl.cellSelection;
      if (cell && (!cur || cur.fr !== cell.r || cur.fc !== cell.c)) {
        if (cell.r !== g.ar || cell.c !== g.ac) g.moved = true;
        ctl.selectCells(g.id, g.ar, g.ac, cell.r, cell.c);
      }
      return;
    }
    if (g.kind === 'marquee') {
      setMarquee({ x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y) });
      return;
    }
    if (g.kind === 'draw') {
      let x2 = p.x;
      let y2 = p.y;
      if (e.shiftKey && ctl.tool.kind !== 'line') {
        const m = Math.max(Math.abs(p.x - g.start.x), Math.abs(p.y - g.start.y));
        x2 = g.start.x + Math.sign(p.x - g.start.x || 1) * m;
        y2 = g.start.y + Math.sign(p.y - g.start.y || 1) * m;
      }
      setDraw({ x: Math.min(g.start.x, x2), y: Math.min(g.start.y, y2), w: Math.abs(x2 - g.start.x), h: Math.abs(y2 - g.start.y), ...(ctl.tool.kind === 'line' ? { x1: g.start.x, y1: g.start.y, x2, y2 } : {}) } as Box);
      return;
    }
    if (g.kind === 'guide') {
      const gd = deck.guides?.find((q) => q.id === g.id);
      if (gd) {
        let pos = gd.orient === 'v' ? p.x : p.y;
        if (!e.altKey) pos = Math.round(pos / 3.5433) * 3.5433;
        ctl.liveDeck((d) => ({ ...d, guides: d.guides!.map((q) => (q.id === g.id ? { ...q, pos } : q)) }));
        const outside = pos < 0 || pos > (gd.orient === 'v' ? w : h);
        setTip({ x: p.x, y: p.y, text: outside ? 'Soltar para quitar la guía' : `${(pos / 28.3465).toFixed(2)} cm` });
      }
      return;
    }
    if (g.kind === 'lineend') {
      const el = ctl.element(g.id) as ConnEl | null;
      if (!el) return;
      let q = p;
      if (e.shiftKey) {
        const a = Math.atan2(p.y - g.fixed.y, p.x - g.fixed.x);
        const r = Math.hypot(p.x - g.fixed.x, p.y - g.fixed.y);
        const s15 = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        q = { x: g.fixed.x + r * Math.cos(s15), y: g.fixed.y + r * Math.sin(s15) };
      } else if (!e.altKey) {
        const sn = snapBox({ x: p.x, y: p.y, w: 0, h: 0 }, [g.id]);
        q = { x: p.x + sn.dx, y: p.y + sn.dy };
        setSmart({ v: sn.v, h: sn.hh });
      }
      const a = g.which === 'a' ? q : g.fixed;
      const b = g.which === 'a' ? g.fixed : q;
      const nx: Xfrm = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), ...(a.x > b.x ? { flipH: true } : {}), ...(a.y > b.y ? { flipV: true } : {}) };
      ctl.beginGesture('Mover el extremo de la línea');
      ctl.liveDeck((d) => updateElement(d, slide.id, g.id, (e2) => {
        const c2 = { ...(e2 as ConnEl), xfrm: nx } as ConnEl;
        // an end that is dragged no longer follows the shape it was glued to
        if (g.which === 'a') delete c2.start;
        else delete c2.end;
        return c2 as SlideElement;
      }));
      return;
    }
    if (g.kind === 'move') {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * zoom < 3) return;
      if (!g.moved) {
        ctl.beginGesture('Mover');
        g.moved = true;
      }
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const ids = Object.keys(g.orig);
      const boxes = ids.map((id) => visualBox(g.orig[id]!));
      const ub: Box = { x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)), w: 0, h: 0 };
      ub.w = Math.max(...boxes.map((b) => b.x + b.w)) - ub.x;
      ub.h = Math.max(...boxes.map((b) => b.y + b.h)) - ub.y;
      if (!e.altKey) {
        const s = snapBox({ ...ub, x: ub.x + dx, y: ub.y + dy }, ids);
        dx += s.dx;
        dy += s.dy;
        setSmart({ v: s.v, h: s.hh });
      } else setSmart({ v: [], h: [] });
      ctl.liveDeck((d) => {
        let nd = d;
        for (const id of ids) nd = updateElement(nd, slide.id, id, (el) => ({ ...el, xfrm: { ...g.orig[id]!, x: g.orig[id]!.x + dx, y: g.orig[id]!.y + dy } }) as SlideElement);
        return nd;
      });
      return;
    }
    if (g.kind === 'rotate') {
      let a = (Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180) / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      a = ((a % 360) + 360) % 360;
      ctl.beginGesture('Girar');
      ctl.liveDeck((d) => updateElement(d, slide.id, g.id, (el) => ({ ...el, xfrm: { ...g.orig, rot: Math.round(a * 10) / 10 } }) as SlideElement));
      return;
    }
    if (g.kind === 'adjust') {
      const el = ctl.element(g.id) as ShapeEl | undefined;
      if (!el?.geom || !('prst' in el.geom)) return;
      const x = ctl.xfrmOf(el);
      const c = { x: x.x + x.w / 2, y: x.y + x.h / 2 };
      let q = x.rot ? rotPoint(p.x, p.y, c.x, c.y, -x.rot) : p;
      q = { x: q.x - x.x, y: q.y - x.y };
      const geom = el.geom;
      const adj = dragHandle(geom.prst, x.w, x.h, geom.adj ?? {}, g.index, q.x, q.y);
      ctl.beginGesture('Ajustar forma');
      ctl.liveDeck((d) => updateElement(d, slide.id, g.id, (s) => ({ ...s, geom: { prst: geom.prst, adj } }) as SlideElement));
      return;
    }
    if (g.kind === 'resize') {
      const b = g.box;
      const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const rot = b.rot ?? 0;
      const q = rot ? rotPoint(p.x, p.y, c.x, c.y, -rot) : p;
      let x1 = b.x;
      let y1 = b.y;
      let x2 = b.x + b.w;
      let y2 = b.y + b.h;
      const hd = g.handle;
      if (hd.includes('w')) x1 = q.x;
      if (hd.includes('e')) x2 = q.x;
      if (hd.includes('n')) y1 = q.y;
      if (hd.includes('s')) y2 = q.y;
      if (e.altKey) {
        // from the centre
        if (hd.includes('w')) x2 = 2 * c.x - x1;
        if (hd.includes('e')) x1 = 2 * c.x - x2;
        if (hd.includes('n')) y2 = 2 * c.y - y1;
        if (hd.includes('s')) y1 = 2 * c.y - y2;
      }
      if (!e.altKey && !rot && !e.ctrlKey && ctl.snap) {
        const s = snapBox({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }, Object.keys(g.orig));
        if (hd.includes('w')) x1 += s.dx;
        if (hd.includes('e')) x2 += s.dx;
        if (hd.includes('n')) y1 += s.dy;
        if (hd.includes('s')) y2 += s.dy;
        setSmart({ v: s.v, h: s.hh });
      }
      if (g.keep || e.shiftKey) {
        const ratio = b.w / (b.h || 1);
        let nw = Math.abs(x2 - x1);
        let nh = Math.abs(y2 - y1);
        if (hd === 'n' || hd === 's') nw = nh * ratio;
        else if (hd === 'e' || hd === 'w') nh = nw / ratio;
        else if (nw / (nh || 1) > ratio) nh = nw / ratio;
        else nw = nh * ratio;
        if (hd.includes('w')) x1 = x2 - nw * Math.sign(x2 - x1 || 1);
        else if (hd.includes('e')) x2 = x1 + nw * Math.sign(x2 - x1 || 1);
        else {
          x1 = c.x - nw / 2;
          x2 = c.x + nw / 2;
        }
        if (hd.includes('n')) y1 = y2 - nh * Math.sign(y2 - y1 || 1);
        else if (hd.includes('s')) y2 = y1 + nh * Math.sign(y2 - y1 || 1);
        else {
          y1 = c.y - nh / 2;
          y2 = c.y + nh / 2;
        }
      }
      const nb = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)) };
      const flipX = x2 < x1;
      const flipY = y2 < y1;
      ctl.beginGesture('Cambiar tamaño');
      const ids = Object.keys(g.orig);
      ctl.liveDeck((d) => {
        let nd = d;
        for (const id of ids) {
          const o = g.orig[id]!;
          // objects of a multiple selection are scaled together inside the new box
          const sx = nb.w / (b.w || 1);
          const sy = nb.h / (b.h || 1);
          const nx: Xfrm = ids.length > 1 ? { ...o, x: nb.x + (o.x - b.x) * sx, y: nb.y + (o.y - b.y) * sy, w: o.w * sx, h: o.h * sy } : { ...o, ...nb, ...(flipX ? { flipH: !o.flipH } : {}), ...(flipY ? { flipV: !o.flipV } : {}) };
          // a rotated object keeps its rotation about the new centre
          if (ids.length === 1 && rot) {
            const nc = rotPoint(nb.x + nb.w / 2, nb.y + nb.h / 2, c.x, c.y, rot);
            nx.x = nc.x - nb.w / 2;
            nx.y = nc.y - nb.h / 2;
          }
          nd = updateElement(nd, slide.id, id, (el) => (el.kind === 'table' ? scaleTable({ ...el, xfrm: nx } as TableEl, nx.w, nx.h) : { ...el, xfrm: nx }) as SlideElement);
        }
        return nd;
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gref.current;
    if (!g) return;
    const p = toSlide(e);
    setG(null);
    setSmart({ v: [], h: [] });
    try {
      surface.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ya soltado */
    }
    if (g.kind === 'lineend') {
      ctl.endGesture();
      return;
    }
    if (g.kind === 'guide') {
      const gd = deck.guides?.find((q) => q.id === g.id);
      setTip(null);
      if (gd && (gd.pos < 0 || gd.pos > (gd.orient === 'v' ? w : h))) ctl.liveDeck((d) => ({ ...d, guides: d.guides!.filter((q) => q.id !== g.id) }));
      ctl.endGesture();
      return;
    }
    if (g.kind === 'crop') {
      ctl.endGesture();
      return;
    }
    if (g.kind === 'cells') {
      // a click (no drag) puts the cursor in the cell
      if (!g.moved) ctl.beginCellEdit(g.id, g.ar, g.ac, { x: e.clientX, y: e.clientY });
      return;
    }
    if (g.kind === 'scribble') {
      finishFreeform(false);
      return;
    }
    if (g.kind === 'marquee') {
      const m = marquee;
      setMarquee(null);
      if (m && (m.w > 3 || m.h > 3)) {
        const ids = slide.shapes.filter((el) => !el.hidden && !el.locked).filter((el) => {
          const v = visualBox(ctl.xfrmOf(el));
          return v.x >= m.x && v.y >= m.y && v.x + v.w <= m.x + m.w && v.y + v.h <= m.y + m.h;
        });
        ctl.select(ids.map((x) => x.id), g.add);
      }
      return;
    }
    if (g.kind === 'draw') {
      const d = draw;
      setDraw(null);
      const tool = ctl.tool;
      const clickOnly = !d || (d.w < 4 && d.h < 4);
      const box: Box = clickOnly ? { x: p.x, y: p.y, w: tool.kind === 'text' ? 240 : 144, h: tool.kind === 'text' ? 40 : 108 } : d!;
      if (clickOnly && tool.kind !== 'text') {
        box.x -= box.w / 2;
        box.y -= box.h / 2;
      }
      let el: SlideElement;
      if (tool.kind === 'text') {
        el = newTextBox(box.x, box.y, Math.max(40, clickOnly ? 240 : box.w), Math.max(28, box.h));
      } else if (tool.kind === 'line') {
        const dd = d as (Box & { x1?: number; y1?: number; x2?: number; y2?: number }) | null;
        el = clickOnly || !dd || dd.x1 === undefined ? newLine(tool.prst, p.x - 72, p.y, p.x + 72, p.y) : newLine(tool.prst, dd.x1, dd.y1!, dd.x2!, dd.y2!);
      } else if (tool.kind === 'shape') el = newShape(tool.prst, box.x, box.y, box.w, box.h);
      else return;
      ctl.addElement(el);
      ctl.setTool({ kind: 'select' });
      if (tool.kind === 'text' || (el.kind === 'shape' && tool.kind === 'shape')) ctl.beginEdit(el.id);
      return;
    }
    if (g.kind === 'move') {
      if (g.moved) ctl.endGesture();
      else if (ctl.selection.length === 1) {
        // a click on an already selected shape with text puts the cursor in it
        const el = ctl.element(ctl.selection[0]!);
        if (el && isTextual(el) && el.kind === 'shape' && el.ph && !hasText(el)) ctl.beginEdit(el.id);
      }
      return;
    }
    ctl.endGesture();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (ff && ff.mode !== 'scribble') {
      finishFreeform(false);
      return;
    }
    if ((e.target as HTMLElement).closest('.sl-edit-wrap')) return;
    const p = toSlide(e);
    const target = hit(p);
    if (!target) return;
    if (target.kind === 'shape') ctl.beginEdit(target.id);
    else if (target.kind === 'table') {
      const cell = ctl.editing ? null : cellAtPoint(e.clientX, e.clientY, target.id);
      if (cell) ctl.beginCellEdit(target.id, cell.r, cell.c, { x: e.clientX, y: e.clientY });
    }
    else if (target.kind === 'pic') ctl.emit(target.name === 'Ecuación' ? 'equation' : 'format', target.id);
    else if (target.kind === 'chart') ctl.emit('chart', target.id);
  };

  // ---- handles
  const startResize = (handle: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!selBox) return;
    surface.current!.setPointerCapture(e.pointerId);
    const orig: Record<string, Xfrm> = {};
    for (const el of selected) orig[el.id] = ctl.xfrmOf(el);
    const keep = selected.some((s) => s.kind === 'pic' || s.kind === 'media') && selected.length === 1;
    setG({ kind: 'resize', handle, orig, box: selBox, keep });
  };
  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = selected[0];
    if (!el || selected.length !== 1) return;
    surface.current!.setPointerCapture(e.pointerId);
    const x = ctl.xfrmOf(el);
    setG({ kind: 'rotate', id: el.id, center: { x: x.x + x.w / 2, y: x.y + x.h / 2 }, orig: x });
  };
  const startAdjust = (index: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = selected[0];
    if (!el) return;
    surface.current!.setPointerCapture(e.pointerId);
    setG({ kind: 'adjust', id: el.id, index });
  };

  const startLine = (which: 'a' | 'b') => (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = single as ConnEl | null;
    if (!el || el.kind !== 'cxn') return;
    const x = ctl.xfrmOf(el);
    const pa = { x: x.flipH ? x.x + x.w : x.x, y: x.flipV ? x.y + x.h : x.y };
    const pb = { x: x.flipH ? x.x : x.x + x.w, y: x.flipV ? x.y : x.y + x.h };
    surface.current!.setPointerCapture(e.pointerId);
    setG({ kind: 'lineend', id: el.id, which, fixed: which === 'a' ? pb : pa });
  };
  const startRulerGuide = (orient: 'h' | 'v') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    surface.current!.setPointerCapture(e.pointerId);
    const id = newId('g');
    const p = toSlide(e);
    ctl.showGuides = true;
    ctl.beginGesture('Agregar guía');
    ctl.liveDeck((d) => ({ ...d, guides: [...(d.guides ?? []), { id, orient, pos: orient === 'v' ? p.x : p.y }] }));
    setG({ kind: 'guide', id });
  };

  // ---- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (ff) {
      if (e.key === 'Enter') (e.preventDefault(), finishFreeform(false));
      else if (e.key === 'Escape') (e.preventDefault(), setFf(null), ctl.setTool({ kind: 'select' }));
      return;
    }
    if (editOn && !ctl.editing) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && ctl.editPt) {
        e.preventDefault();
        ctl.pointOp('Eliminar punto', (p, s) => ({ paths: p.map((sp, i) => (i === s.si ? { ...sp, nodes: sp.nodes.filter((_, k) => k !== s.ni) } : sp)).filter((sp) => sp.nodes.length >= 2), sel: null }));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        ctl.leavePoints();
        ctl.touch();
        return;
      }
    }
    if (ctl.editing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        const id = ctl.editing;
        ctl.endEdit();
        ctl.select([id]);
      }
      return;
    }
    if (ctl.cropPic && (e.key === 'Escape' || e.key === 'Enter')) {
      e.preventDefault();
      ctl.cropping = null;
      ctl.touch();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const tbl = ctl.table;
    const cs = ctl.cellSelection;
    if (tbl && cs) {
      const k = e.key;
      if (k.startsWith('Arrow') && !mod) {
        e.preventDefault();
        const nr = Math.max(0, Math.min(tbl.rows.length - 1, cs.fr + (k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0)));
        const nc = Math.max(0, Math.min(tbl.cols.length - 1, cs.fc + (k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0)));
        if (e.shiftKey) ctl.selectCells(tbl.id, cs.ar, cs.ac, nr, nc);
        else ctl.selectCells(tbl.id, nr, nc);
        return;
      }
      if (k === 'Tab') {
        e.preventDefault();
        stepCell(ctl, tbl, cs.fr, cs.fc, e.shiftKey ? -1 : 1, false);
        return;
      }
      if (k === 'Enter' || k === 'F2') {
        e.preventDefault();
        ctl.beginCellEdit(tbl.id, cs.ar, cs.ac);
        return;
      }
      if (k === 'Delete' || k === 'Backspace') {
        e.preventDefault();
        ctl.tableApply('Borrar el contenido de las celdas', (t, rg) => clearCells(t, rg));
        return;
      }
      if (mod && k.toLowerCase() === 'a') {
        e.preventDefault();
        ctl.selectCells(tbl.id, 0, 0, tbl.rows.length - 1, tbl.cols.length - 1);
        return;
      }
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      ctl.selectAll();
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      ctl.duplicateSelected();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (ctl.selection.length) {
        e.preventDefault();
        ctl.deleteSelected();
      }
    } else if (e.key === 'Escape') {
      if (ctl.tool.kind !== 'select') ctl.setTool({ kind: 'select' });
      else if (ctl.painter) {
        ctl.painter = null;
        ctl.touch();
      } else ctl.select([]);
    } else if (e.key === 'Enter' && ctl.selection.length === 1) {
      const el = ctl.element(ctl.selection[0]!);
      if (el?.kind === 'shape') {
        e.preventDefault();
        ctl.beginEdit(el.id);
      }
    } else if (e.key === 'F2' && ctl.selection.length === 1) {
      ctl.beginEdit(ctl.selection[0]!);
    } else if (e.key.startsWith('Arrow') && ctl.selection.length) {
      e.preventDefault();
      const d = e.shiftKey ? 1 : e.altKey ? 0.25 : 6;
      ctl.moveBy(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
    } else if (e.key === 'Tab' && slide.shapes.length) {
      e.preventDefault();
      const ids = slide.shapes.filter((s) => !s.hidden).map((s) => s.id);
      const cur = ids.indexOf(ctl.selection[0] ?? '');
      ctl.select([ids[(cur + (e.shiftKey ? -1 : 1) + ids.length) % ids.length]!]);
    } else if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      ctl.zoom = Math.min(400, Math.round(zoom * 100) + 10);
      ctl.touch();
    } else if (mod && e.key === '-') {
      e.preventDefault();
      ctl.zoom = Math.max(10, Math.round(zoom * 100) - 10);
      ctl.touch();
    }
  };

  useEffect(() => {
    ctl.containerFocus = () => wrap.current?.focus();
    return () => {
      ctl.containerFocus = undefined;
    };
  }, [ctl]);

  const editingEl = ctl.editing ? (ctl.element(ctl.editing) as ShapeEl | null) : null;
  const handleSize = 9 / zoom;
  const showHandles = !!selBox && !ctl.cropPic && !ctl.editing && !editOn && !gesture?.kind.startsWith('draw');
  const single = selected.length === 1 ? selected[0]! : null;
  const adj = single && single.kind === 'shape' && single.geom && 'prst' in single.geom ? geometryOf(single.geom, ctl.xfrmOf(single).w, ctl.xfrmOf(single).h).handles : [];
  const isLine = single?.kind === 'cxn';

  return (
    <div ref={wrap} className={`sl-stagearea tool-${ctl.tool.kind}${ctl.painter ? ' painter-on' : ''}`} tabIndex={0} onKeyDown={onKeyDown} onPointerDown={(e) => e.currentTarget.focus({ preventScroll: true })} data-testid="stage-area" onContextMenu={(e) => onContext?.(e, hit(toSlide(e))?.id ?? null)}>
      <div className="sl-stagewrap" style={{ width: w * zoom, height: h * zoom }}>
        {ctl.showRuler && <Rulers w={w} h={h} zoom={zoom} onStart={startRulerGuide} />}
        <div ref={surface} className="sl-surface" style={{ width: w, height: h, transform: `scale(${zoom})`, transformOrigin: '0 0' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick}>
          <SlideCanvas deck={deck} slide={slide} urls={ctl.urls} slideNumber={ctl.index + 1} mode="edit" prompts editingId={ctl.editing} editingCell={ctl.editingCell} />
          {ctl.table && ctl.tool.kind === 'select' && !ctl.inMaster && <TableLayer ctl={ctl} el={ctl.table} ctx={editCtx} surface={surface} zoom={zoom} />}
          {ctl.showGrid && <div className="sl-grid" style={{ backgroundSize: `${GRID * 2}px ${GRID * 2}px` }} />}
          {ctl.showGuides && (deck.guides ?? []).map((g) => (
            <div
              key={g.id}
              className={`sl-guide sl-guide--${g.orient}`}
              style={g.orient === 'v' ? { left: g.pos, top: 0, bottom: 0, width: 1 / zoom } : { top: g.pos, left: 0, right: 0, height: 1 / zoom }}
              onPointerDown={(e) => {
                e.stopPropagation();
                surface.current!.setPointerCapture(e.pointerId);
                ctl.beginGesture('Mover guía');
                setG({ kind: 'guide', id: g.id });
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                ctl.apply('Quitar guía', (d) => ({ ...d, guides: d.guides!.filter((q) => q.id !== g.id) }));
              }}
            />
          ))}
          <CommentMarks ctl={ctl} zoom={zoom} />
          {smart.v.map((x, i) => <div key={`v${i}`} className="sl-smart" style={{ left: x, top: 0, bottom: 0, width: 1 / zoom }} />)}
          {smart.h.map((y, i) => <div key={`h${i}`} className="sl-smart" style={{ top: y, left: 0, right: 0, height: 1 / zoom }} />)}
          {editingEl && editingEl.kind === 'shape' && <ShapeTextEditor ctl={ctl} el={editingEl} ctx={editCtx} />}
          {ctl.cropPic && (() => {
            const el = ctl.cropPic!;
            const x = ctl.xfrmOf(el);
            const c0 = { x: x.x + x.w / 2, y: x.y + x.h / 2 };
            return HANDLES.map((hd) => {
              const pt = rotPoint(x.x + x.w * hd.fx, x.y + x.h * hd.fy, c0.x, c0.y, x.rot ?? 0);
              const s2 = handleSize * 1.4;
              return <div key={hd.h} className="sl-cropgrip" role="button" aria-label={`Recortar (${hd.h})`} data-testid={`crop-${hd.h}`} style={{ left: pt.x - s2 / 2, top: pt.y - s2 / 2, width: s2, height: s2, cursor: hd.cursor }} onPointerDown={(ev) => { ev.stopPropagation(); surface.current!.setPointerCapture(ev.pointerId); setG({ kind: 'crop', id: el.id, handle: hd.h, start: toSlide(ev), el, xf: x }); }} />;
            });
          })()}
          {showHandles && selected.map((el) => <SelectionOutline key={el.id} xf={ctl.xfrmOf(el)} zoom={zoom} single={selected.length === 1} />)}
          {showHandles && selBox && selected.length > 1 && <SelectionOutline xf={selBox} zoom={zoom} single={false} dashed />}
          {showHandles && selBox && !isLine &&
            HANDLES.map((hd) => {
              const rot = selected.length === 1 ? (selBox.rot ?? 0) : 0;
              const c = { x: selBox.x + selBox.w / 2, y: selBox.y + selBox.h / 2 };
              const pt = rotPoint(selBox.x + selBox.w * hd.fx, selBox.y + selBox.h * hd.fy, c.x, c.y, rot);
              return <div key={hd.h} className="sl-handle" role="button" aria-label={`Cambiar tamaño (${hd.h})`} style={{ left: pt.x - handleSize / 2, top: pt.y - handleSize / 2, width: handleSize, height: handleSize, cursor: hd.cursor, borderWidth: 1 / zoom }} onPointerDown={startResize(hd.h)} />;
            })}
          {showHandles && single && isLine && lineHandles(single as ConnEl, ctl.xfrmOf(single), handleSize, zoom, startLine)}
          {showHandles && selBox && single && !isLine && (() => {
            const rot = selBox.rot ?? 0;
            const c = { x: selBox.x + selBox.w / 2, y: selBox.y + selBox.h / 2 };
            const pt = rotPoint(c.x, selBox.y - 26 / zoom, c.x, c.y, rot);
            return <div className="sl-handle sl-rotate" role="button" aria-label="Girar" style={{ left: pt.x - handleSize / 2, top: pt.y - handleSize / 2, width: handleSize, height: handleSize, borderWidth: 1 / zoom }} onPointerDown={startRotate} />;
          })()}
          {showHandles && single && adj.map((a, i) => {
            const x = ctl.xfrmOf(single);
            const c = { x: x.x + x.w / 2, y: x.y + x.h / 2 };
            const pt = rotPoint(x.x + a.x, x.y + a.y, c.x, c.y, x.rot ?? 0);
            return <div key={i} className="sl-adjust" role="button" aria-label="Ajustar forma" style={{ left: pt.x - handleSize / 2, top: pt.y - handleSize / 2, width: handleSize, height: handleSize }} onPointerDown={startAdjust(i)} />;
          })}
          {tip && <div className="sl-guidetip" style={{ left: tip.x + 10 / zoom, top: tip.y + 10 / zoom, fontSize: 11 / zoom, padding: `${2 / zoom}px ${6 / zoom}px` }}>{tip.text}</div>}
          {marquee && <div className="sl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / zoom }} />}
          {draw && <DrawPreview draw={draw} tool={ctl.tool} zoom={zoom} />}
          {ff && <FreeformPreview ff={ff} zoom={zoom} w={w} h={h} />}
          {editOn && editEl && <PointsOverlay paths={ctl.pointsOf(editEl)} xf={ctl.xfrmOf(editEl)} sel={ctl.editPt} zoom={zoom} w={w} h={h} />}
        </div>
      </div>
    </div>
  );
}

function FreeformPreview({ ff, zoom, w, h }: { ff: FreeformDraft; zoom: number; w: number; h: number }) {
  const pts = ff.hover && ff.mode !== 'scribble' ? [...ff.pts, ff.hover] : ff.pts;
  const sub = ff.mode === 'curve' ? curveThrough(pts) : { nodes: pts.map((q) => ({ x: q.x, y: q.y })), closed: false };
  return (
    <svg className="sl-drawprev" width={w} height={h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {sub.nodes.length > 1 && <path d={pathsToSvg([sub])} fill="none" stroke="#0f6cbd" strokeWidth={2 / zoom} />}
      {ff.mode !== 'scribble' && ff.pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={(i === 0 ? 5 : 3.5) / zoom} fill={i === 0 ? '#fff' : '#0f6cbd'} stroke="#0f6cbd" strokeWidth={1.5 / zoom} />)}
    </svg>
  );
}

function PointsOverlay({ paths, xf, sel, zoom, w, h }: { paths: Paths; xf: Xfrm; sel: { si: number; ni: number } | null; zoom: number; w: number; h: number }) {
  const S = (q: Pt) => localToSlide(q, xf);
  const r = 4.5 / zoom;
  return (
    <svg className="sl-points" width={w} height={h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} aria-label="Puntos de la forma">
      {paths.flatMap((sp, si) =>
        sp.nodes.map((n, ni) => {
          const on = sel?.si === si && sel.ni === ni;
          const p = S(n);
          const hs = on ? (['hin', 'hout'] as const).map((k) => (n[k] ? { k, q: S(n[k]!) } : null)).filter(Boolean) : [];
          return (
            <g key={`n${si}-${ni}`}>
              {hs.map((hh) => (
                <g key={hh!.k}>
                  <line x1={p.x} y1={p.y} x2={hh!.q.x} y2={hh!.q.y} stroke="#0f6cbd" strokeWidth={1 / zoom} />
                  <circle cx={hh!.q.x} cy={hh!.q.y} r={r * 0.8} fill="#fff" stroke="#0f6cbd" strokeWidth={1.5 / zoom} data-handle={hh!.k} />
                </g>
              ))}
              <rect x={p.x - r} y={p.y - r} width={2 * r} height={2 * r} fill={on ? '#0f6cbd' : '#fff'} stroke="#0f6cbd" strokeWidth={1.5 / zoom} data-node={`${si}-${ni}`} />
            </g>
          );
        }),
      )}
    </svg>
  );
}

function isTextual(el: SlideElement): boolean {
  return el.kind === 'shape';
}
function hasText(el: ShapeEl): boolean {
  return !!el.text && JSON.stringify(el.text.doc).includes('"text"');
}

function SelectionOutline({ xf, zoom, single, dashed }: { xf: Xfrm; zoom: number; single: boolean; dashed?: boolean }) {
  void single;
  return <div className="sl-selbox" style={{ left: xf.x, top: xf.y, width: xf.w, height: xf.h, transform: xf.rot ? `rotate(${xf.rot}deg)` : undefined, borderWidth: 1.5 / zoom, borderStyle: dashed ? 'dashed' : 'solid' }} />;
}

function lineHandles(el: ConnEl, x: Xfrm, size: number, zoom: number, start: (w: 'a' | 'b') => (e: React.PointerEvent) => void) {
  const x1 = x.flipH ? x.x + x.w : x.x;
  const y1 = x.flipV ? x.y + x.h : x.y;
  const x2 = x.flipH ? x.x : x.x + x.w;
  const y2 = x.flipV ? x.y : x.y + x.h;
  void el;
  return [
    <div key="a" className="sl-handle" role="button" aria-label="Mover el inicio de la línea" data-testid="line-start" style={{ left: x1 - size / 2, top: y1 - size / 2, width: size, height: size, borderWidth: 1 / zoom, cursor: 'move' }} onPointerDown={start('a')} />,
    <div key="b" className="sl-handle" role="button" aria-label="Mover el final de la línea" data-testid="line-end" style={{ left: x2 - size / 2, top: y2 - size / 2, width: size, height: size, borderWidth: 1 / zoom, cursor: 'move' }} onPointerDown={start('b')} />,
  ];
}

function DrawPreview({ draw, tool, zoom }: { draw: Box; tool: { kind: string; prst?: string }; zoom: number }) {
  const d = draw as Box & { x1?: number; y1?: number; x2?: number; y2?: number };
  if (tool.kind === 'line' && d.x1 !== undefined) return <svg className="sl-drawprev" width="100%" height="100%" style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}><line x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="#0f6cbd" strokeWidth={2 / zoom} /></svg>;
  const geom = tool.kind === 'shape' ? geometryOf({ prst: tool.prst ?? 'rect' }, Math.max(1, draw.w), Math.max(1, draw.h)) : null;
  if (geom)
    return (
      <svg className="sl-drawprev" style={{ position: 'absolute', left: draw.x, top: draw.y, overflow: 'visible', pointerEvents: 'none' }} width={Math.max(1, draw.w)} height={Math.max(1, draw.h)}>
        {geom.paths.map((p, i) => <path key={i} d={p.d} fill="rgba(15,108,189,.15)" stroke="#0f6cbd" strokeWidth={1.5 / zoom} />)}
      </svg>
    );
  return <div className="sl-marquee" style={{ left: draw.x, top: draw.y, width: draw.w, height: draw.h, borderWidth: 1 / zoom }} />;
}

export { findElement, presetDefaults, shapeLayout };

/** Rulers along the top and left of the slide, in centimetres; dragging from one makes a guide. */
function Rulers({ w, h, zoom, onStart }: { w: number; h: number; zoom: number; onStart: (o: 'h' | 'v') => (e: React.PointerEvent) => void }) {
  const cmPx = 28.3465 * zoom;
  const label = [1, 2, 5, 10].find((l) => l * cmPx >= 34) ?? 10;
  const ticks = (len: number, vertical: boolean) => {
    const n = Math.floor(len / 28.3465 / 0.5);
    const out: React.ReactNode[] = [];
    for (let i = 0; i <= n; i++) {
      const cm = i * 0.5;
      const pos = cm * cmPx;
      const major = Number.isInteger(cm);
      if (!major && cmPx < 24) continue;
      const big = major && cm % label === 0;
      const size = big ? 10 : major ? 6 : 4;
      out.push(vertical ? <line key={i} x1={18 - size} x2={18} y1={pos} y2={pos} stroke="#666" strokeWidth={1} /> : <line key={i} y1={18 - size} y2={18} x1={pos} x2={pos} stroke="#666" strokeWidth={1} />);
      if (big) out.push(vertical ? <text key={`t${i}`} x={2} y={pos + 11} fontSize={9} fill="#444">{cm}</text> : <text key={`t${i}`} x={pos + 2} y={9} fontSize={9} fill="#444">{cm}</text>);
    }
    return out;
  };
  return (
    <>
      <svg className="sl-ruler sl-ruler--h" data-testid="ruler-h" width={w * zoom} height={18} style={{ position: 'absolute', left: 0, top: -18, cursor: 'row-resize' }} onPointerDown={onStart('h')}>
        <rect width="100%" height="18" fill="#f3f3f3" />
        {ticks(w, false)}
      </svg>
      <svg className="sl-ruler sl-ruler--v" data-testid="ruler-v" width={18} height={h * zoom} style={{ position: 'absolute', left: -18, top: 0, cursor: 'col-resize' }} onPointerDown={onStart('v')}>
        <rect width="18" height="100%" fill="#f3f3f3" />
        {ticks(h, true)}
      </svg>
    </>
  );
}
