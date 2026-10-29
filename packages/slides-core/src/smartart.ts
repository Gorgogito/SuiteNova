import { newId } from './defaults';
import { LINE_STYLE } from './factory';
import { makeDoc } from './text';
import type { Clr, ConnEl, GroupEl, ShapeEl, SlideElement } from './types';

/*
 * Diagrams (the SmartArt of Nova Slides). A diagram is generated from a list of items and a layout as a group of ordinary shapes,
 * connectors and text, like the result of "Convert to shapes" in PowerPoint: it is edited as shapes, and PowerPoint opens it as
 * shapes. It is not tied to diagram data, so changing the list means generating the diagram again.
 */

export interface DiagramItem {
  text: string;
  /** 0 (top level), 1 or 2 */
  level: number;
}
export interface DiagramLayout {
  id: string;
  name: string;
  description: string;
}
export const DIAGRAM_LAYOUTS: DiagramLayout[] = [
  { id: 'list', name: 'Lista básica', description: 'Los elementos en filas de cuadros' },
  { id: 'vlist', name: 'Lista vertical', description: 'Barras apiladas; los subelementos van a la derecha' },
  { id: 'process', name: 'Proceso básico', description: 'Pasos unidos por flechas' },
  { id: 'cycle', name: 'Ciclo', description: 'Elementos en círculo con flechas' },
  { id: 'hier', name: 'Jerarquía', description: 'Organigrama de arriba abajo' },
  { id: 'pyramid', name: 'Pirámide', description: 'Niveles apilados, del vértice a la base' },
  { id: 'venn', name: 'Relación (Venn)', description: 'Círculos que se solapan' },
];

/** One item per line; each leading tab or pair of spaces is a level (up to two). */
export function parseDiagramText(text: string): DiagramItem[] {
  const out: DiagramItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^((?:\t| {2})*)(.*)$/.exec(raw.replace(/^[-•*]\s+/, (s) => s));
    const body = (m?.[2] ?? '').trim().replace(/^[-•*]\s+/, '');
    if (!body) continue;
    out.push({ text: body, level: Math.min(2, (m?.[1] ?? '').replace(/ {2}/g, '\t').length) });
  }
  return out;
}

const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;
const accent = (i: number): Clr => ({ scheme: ACCENTS[((i % 6) + 6) % 6]! });
const darker = (i: number): Clr => ({ scheme: ACCENTS[((i % 6) + 6) % 6]!, mods: [{ t: 'lumMod', v: 75000 }] });

interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

function box(prst: string, x: number, y: number, w: number, h: number, text: string, sz: number, ci: number, o: { alpha?: number; dark?: boolean; light?: boolean } = {}): ShapeEl {
  const fillC: Clr = o.alpha ? { ...accent(ci), mods: [{ t: 'alpha', v: o.alpha }] } : accent(ci);
  const r = { sz: Math.max(8, Math.round(sz)), color: o.light ? ({ scheme: 'tx1' } as Clr) : ({ scheme: 'bg1' } as Clr) };
  return {
    kind: 'shape',
    id: newId(),
    name: text.slice(0, 24) || prst,
    geom: { prst },
    xfrm: { x, y, w, h },
    fill: { t: 'solid', c: fillC },
    ln: { w: 1, fill: { t: 'solid', c: o.dark === false ? fillC : darker(ci) } },
    text: { body: { anchor: 'ctr', fit: { t: 'norm' }, lIns: 4, rIns: 4, tIns: 2, bIns: 2 }, doc: makeDoc([{ p: { algn: 'ctr' }, runs: text ? [{ text, r }] : [], end: r }]).toJSON() },
  };
}

function line(x1: number, y1: number, x2: number, y2: number, arrow = false): ConnEl {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return {
    kind: 'cxn',
    id: newId(),
    name: 'Conector',
    geom: { prst: 'straightConnector1' },
    xfrm: { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), ...(x2 < x1 ? { flipH: true } : {}), ...(y2 < y1 ? { flipV: true } : {}) },
    style: LINE_STYLE,
    ln: { w: 1.5, fill: { t: 'solid', c: { scheme: 'tx2' } }, ...(arrow ? { tail: { type: 'triangle' as const } } : {}) },
  };
}

const textSize = (w: number, h: number, text: string, max = 24): number => {
  // enough room for the words at this size: shrink until the estimate fits
  for (let s = max; s > 8; s -= 1) {
    const perLine = Math.max(1, Math.floor((w - 8) / (s * 0.52)));
    const lines = Math.ceil(text.length / perLine);
    if (lines * s * 1.2 <= h - 4) return s;
  }
  return 8;
};

function tops(items: DiagramItem[]): { item: DiagramItem; kids: DiagramItem[] }[] {
  const out: { item: DiagramItem; kids: DiagramItem[] }[] = [];
  for (const it of items) {
    if (it.level === 0 || !out.length) out.push({ item: { ...it, level: 0 }, kids: [] });
    else out[out.length - 1]!.kids.push(it);
  }
  return out;
}

export function buildDiagram(layout: string, items: DiagramItem[], a: Area, colour = 0): GroupEl {
  const els: SlideElement[] = [];
  const list = items.length ? items : [{ text: '', level: 0 }];
  const top = tops(list);
  const gap = 12;

  if (layout === 'list') {
    const n = top.length;
    const cols = n <= 3 ? n : n === 4 ? 2 : 3;
    const rows = Math.ceil(n / cols);
    const w = (a.w - gap * (cols - 1)) / cols;
    const h = Math.min(120, (a.h - gap * (rows - 1)) / rows);
    const y0 = a.y + (a.h - (rows * h + (rows - 1) * gap)) / 2;
    top.forEach((t, i) => {
      const txt = [t.item.text, ...t.kids.map((k) => k.text)].join('\n');
      els.push(box('roundRect', a.x + (i % cols) * (w + gap), y0 + Math.floor(i / cols) * (h + gap), w, h, txt, textSize(w, h, txt), colour + i));
    });
  } else if (layout === 'vlist') {
    const n = top.length;
    const h = Math.min(70, (a.h - gap * (n - 1)) / n);
    const y0 = a.y + (a.h - (n * h + (n - 1) * gap)) / 2;
    const hasKids = top.some((t) => t.kids.length);
    const w = hasKids ? a.w * 0.38 : a.w;
    top.forEach((t, i) => {
      const y = y0 + i * (h + gap);
      els.push(box('roundRect', a.x, y, w, h, t.item.text, textSize(w, h, t.item.text, 22), colour + i));
      if (t.kids.length) {
        const kw = (a.w - w - gap) / t.kids.length - gap / 2;
        t.kids.forEach((k, j) => els.push(box('roundRect', a.x + w + gap + j * (kw + gap / 2), y, kw, h, k.text, textSize(kw, h, k.text, 18), colour + i, { alpha: 60000, light: true, dark: false })));
      }
    });
  } else if (layout === 'process') {
    const n = top.length;
    const arrow = 26;
    const w = (a.w - (n - 1) * (arrow + gap)) / n;
    const h = Math.min(130, a.h);
    const y = a.y + (a.h - h) / 2;
    top.forEach((t, i) => {
      const x = a.x + i * (w + arrow + gap);
      const txt = [t.item.text, ...t.kids.map((k) => k.text)].join('\n');
      els.push(box('roundRect', x, y, w, h, txt, textSize(w, h, txt, 22), colour + i));
      if (i < n - 1) els.push({ ...box('rightArrow', x + w + gap / 2, y + h / 2 - 14, arrow, 28, '', 10, colour + i, { alpha: 70000 }), name: 'Flecha' });
    });
  } else if (layout === 'cycle') {
    const n = top.length;
    const R = Math.min(a.w, a.h) / 2;
    const bw = Math.min(150, R * 0.9);
    const bh = Math.min(64, R * 0.42);
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    const rr = R - bh / 2 - 4;
    const pts = top.map((_, i) => ({ x: cx + rr * Math.cos((2 * Math.PI * i) / n - Math.PI / 2), y: cy + rr * Math.sin((2 * Math.PI * i) / n - Math.PI / 2) }));
    if (n > 1)
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % n]!;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(0.5, (Math.min(bw, bh) * 0.9) / d);
        els.push(line(p.x + dx * (0.5 - k / 2 - 0.12), p.y + dy * (0.5 - k / 2 - 0.12), q.x - dx * (0.5 - k / 2 - 0.12), q.y - dy * (0.5 - k / 2 - 0.12), true));
      });
    top.forEach((t, i) => els.push(box('ellipse', pts[i]!.x - bw / 2, pts[i]!.y - bh / 2, bw, bh, t.item.text, textSize(bw * 0.75, bh * 0.75, t.item.text, 18), colour + i)));
  } else if (layout === 'hier') {
    // level 0 is the root; level 1 its children; level 2 under each child
    const root = list[0]!;
    const kids: { item: DiagramItem; sub: DiagramItem[] }[] = [];
    for (const it of list.slice(1)) {
      if (it.level <= 1 || !kids.length) kids.push({ item: it, sub: [] });
      else kids[kids.length - 1]!.sub.push(it);
    }
    const levels = 1 + (kids.length ? 1 : 0) + (kids.some((k) => k.sub.length) ? 1 : 0);
    const bh = Math.min(56, (a.h - (levels - 1) * 40) / levels);
    const rowY = (l: number) => a.y + l * (bh + (levels > 1 ? (a.h - levels * bh) / (levels - 1) : 0));
    const leaves = Math.max(1, kids.reduce((s, k) => s + Math.max(1, k.sub.length), 0));
    const lw = Math.min(150, (a.w - gap * (leaves - 1)) / leaves);
    const rootBox = { w: Math.min(220, a.w * 0.4), h: bh };
    const cx = a.x + a.w / 2;
    els.push(box('roundRect', cx - rootBox.w / 2, rowY(0), rootBox.w, bh, root.text, textSize(rootBox.w, bh, root.text, 20), colour));
    let li = 0;
    const totalW = leaves * lw + (leaves - 1) * gap;
    const x0 = a.x + (a.w - totalW) / 2;
    kids.forEach((k, i) => {
      const span = Math.max(1, k.sub.length);
      const kx = x0 + li * (lw + gap) + (span * lw + (span - 1) * gap) / 2;
      els.push(line(cx, rowY(0) + bh, cx, rowY(0) + bh + (rowY(1) - rowY(0) - bh) / 2));
      els.push(line(kx, rowY(0) + bh + (rowY(1) - rowY(0) - bh) / 2, kx, rowY(1)));
      els.push(box('roundRect', kx - lw / 2, rowY(1), lw, bh, k.item.text, textSize(lw, bh, k.item.text, 18), colour + i + 1));
      k.sub.forEach((s, j) => {
        const sx = x0 + (li + j) * (lw + gap) + lw / 2;
        els.push(line(kx, rowY(1) + bh, kx, rowY(1) + bh + (rowY(2) - rowY(1) - bh) / 2));
        els.push(line(sx, rowY(1) + bh + (rowY(2) - rowY(1) - bh) / 2, sx, rowY(2)));
        els.push(box('roundRect', sx - lw / 2, rowY(2), lw, bh, s.text, textSize(lw, bh, s.text, 16), colour + i + 1, { alpha: 70000, light: true, dark: false }));
      });
      if (k.sub.length > 1) {
        const first = x0 + li * (lw + gap) + lw / 2;
        const last = x0 + (li + k.sub.length - 1) * (lw + gap) + lw / 2;
        els.push(line(first, rowY(1) + bh + (rowY(2) - rowY(1) - bh) / 2, last, rowY(1) + bh + (rowY(2) - rowY(1) - bh) / 2));
      }
      li += span;
    });
    if (kids.length > 1) {
      const centres = (() => {
        let l = 0;
        return kids.map((k) => {
          const span = Math.max(1, k.sub.length);
          const c = x0 + l * (lw + gap) + (span * lw + (span - 1) * gap) / 2;
          l += span;
          return c;
        });
      })();
      const yb = rowY(0) + bh + (rowY(1) - rowY(0) - bh) / 2;
      els.push(line(Math.min(...centres, cx), yb, Math.max(...centres, cx), yb));
    }
  } else if (layout === 'pyramid') {
    const n = top.length;
    const h = Math.min(90, a.h / n);
    const total = h * n;
    const y0 = a.y + (a.h - total) / 2;
    const base = Math.min(a.w, total * 1.6);
    top.forEach((t, i) => {
      const wTop = (base * i) / n;
      const wBot = (base * (i + 1)) / n;
      const y = y0 + i * h;
      const cx = a.x + a.w / 2;
      if (i === 0) els.push(box('triangle', cx - wBot / 2, y, wBot, h, '', 10, colour + i));
      else els.push(box('trapezoid', cx - wBot / 2, y, wBot, h, t.item.text, textSize(wTop + 20, h, t.item.text, 18), colour + i));
      if (i === 0) {
        const tt = box('rect', cx - 50, y + h * 0.45, 100, h * 0.5, t.item.text, textSize(100, h * 0.5, t.item.text, 14), colour);
        els.push({ ...tt, fill: { t: 'none' }, ln: { fill: { t: 'none' } } });
      }
    });
  } else if (layout === 'venn') {
    const n = Math.min(top.length, 6);
    const d = Math.min(a.h, a.w / (n > 1 ? 1 + (n - 1) * 0.6 : 1));
    const step = d * 0.6;
    const total = d + step * (n - 1);
    const x0 = a.x + (a.w - total) / 2;
    const y = a.y + (a.h - d) / 2;
    top.slice(0, n).forEach((_, i) => {
      els.push(box('ellipse', x0 + i * step, y, d, d, '', 10, colour + i, { alpha: 50000 }));
    });
    top.slice(0, n).forEach((t, i) => {
      const w = i === n - 1 ? d * 0.6 : step * 0.8;
      const tb = box('rect', x0 + i * step + (i === n - 1 ? d * 0.2 : d * 0.1), y + d / 2 - 22, w, 44, t.item.text, textSize(w, 44, t.item.text, 18), colour + i, { light: true });
      els.push({ ...tb, fill: { t: 'none' }, ln: { fill: { t: 'none' } } });
    });
  }

  return {
    kind: 'group',
    id: newId(),
    name: 'Diagrama',
    xfrm: { x: a.x, y: a.y, w: a.w, h: a.h },
    chOff: { x: a.x, y: a.y },
    chExt: { w: a.w, h: a.h },
    children: els,
  };
}

/** The area on a slide a new diagram fills. */
export const diagramArea = (slide: { w: number; h: number }): Area => ({ x: slide.w * 0.1, y: slide.h * 0.24, w: slide.w * 0.8, h: slide.h * 0.64 });
