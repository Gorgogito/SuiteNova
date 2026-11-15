import { shapeIdMap } from './anim';
import { localToSlide } from './freeform';
import { geometryOf } from '@suitenova/shapes-core';
import type { ConnEl, Deck, Slide, SlideElement, Xfrm } from './types';

/*
 * Connectors that stick to shapes. A shape offers connection sites (the points its outline defines; four on the middle of the sides for
 * the rest). A connector remembers the shape (by its number in the file) and the site of each end, and when the shapes move the
 * connector is laid again between their sites.
 */

export interface Site {
  idx: number;
  x: number;
  y: number;
}

const rect4 = (w: number, h: number) => [
  { x: w / 2, y: 0 },
  { x: 0, y: h / 2 },
  { x: w / 2, y: h },
  { x: w, y: h / 2 },
];
const CONNECTABLE = new Set(['shape', 'pic', 'table', 'chart']);

/** Connection sites of an object in slide coordinates (rotation and flips applied). */
export function sitesOf(el: SlideElement, x: Xfrm): Site[] {
  let local = rect4(x.w, x.h);
  if (el.kind === 'shape' && el.geom && 'prst' in el.geom) {
    const s = geometryOf(el.geom, x.w, x.h).sites;
    if (s.length) local = s.map((p) => ({ x: p.x, y: p.y }));
  }
  return local.map((p, idx) => ({ idx, ...localToSlide(p, x) }));
}

/** The site closest to a point, within `max` points, among the objects that can be connected. */
export function nearestSite(slide: Slide, xf: (e: SlideElement) => Xfrm, pt: { x: number; y: number }, max: number, exclude: string[] = []): { el: SlideElement; site: Site; d: number } | null {
  let best: { el: SlideElement; site: Site; d: number } | null = null;
  for (const el of slide.shapes) {
    if (!CONNECTABLE.has(el.kind) || exclude.includes(el.id) || el.hidden) continue;
    for (const s of sitesOf(el, xf(el))) {
      const d = Math.hypot(s.x - pt.x, s.y - pt.y);
      if (d <= max && (!best || d < best.d)) best = { el, site: s, d };
    }
  }
  return best;
}

/** Start and end points of a connector. */
export const endsOf = (x: Xfrm): { a: { x: number; y: number }; b: { x: number; y: number } } => ({
  a: { x: x.flipH ? x.x + x.w : x.x, y: x.flipV ? x.y + x.h : x.y },
  b: { x: x.flipH ? x.x : x.x + x.w, y: x.flipV ? x.y : x.y + x.h },
});

export function xfrmBetween(a: { x: number; y: number }, b: { x: number; y: number }): Xfrm {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), ...(a.x > b.x ? { flipH: true } : {}), ...(a.y > b.y ? { flipV: true } : {}) };
}

/** Connects (or, with null, frees) one end of a connector. The target gets a stable number in the file if it had none. */
export function connectEnd(deck: Deck, slideId: string, connId: string, which: 'start' | 'end', target: { id: string; idx: number } | null): Deck {
  return {
    ...deck,
    slides: deck.slides.map((s): Slide => {
      if (s.id !== slideId) return s;
      const ids = shapeIdMap(s);
      return {
        ...s,
        shapes: s.shapes.map((e): SlideElement => {
          if (e.id === connId && e.kind === 'cxn') {
            const c: ConnEl = { ...e };
            if (target) c[which] = { id: ids.get(target.id) ?? 0, idx: target.idx };
            else delete c[which];
            return c;
          }
          if (target && e.id === target.id && e.srcId === undefined) return { ...e, srcId: ids.get(e.id) };
          return e;
        }),
      };
    }),
  };
}

/** Lays the connectors of a slide again between the sites they are stuck to. Returns the same deck when nothing moves. */
export function rerouteConnectors(deck: Deck, slideId: string | undefined, xf: (slide: Slide, e: SlideElement) => Xfrm): Deck {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide || !slide.shapes.some((e) => e.kind === 'cxn' && (e.start || e.end))) return deck;
  const ids = shapeIdMap(slide);
  const byNum = new Map<number, SlideElement>();
  for (const e of slide.shapes) {
    const n = ids.get(e.id);
    if (n !== undefined) byNum.set(n, e);
  }
  let changed = false;
  const shapes = slide.shapes.map((e): SlideElement => {
    if (e.kind !== 'cxn' || (!e.start && !e.end)) return e;
    const cur = e.xfrm;
    if (!cur) return e;
    const ends = endsOf(cur);
    const at = (link: { id: number; idx: number } | undefined, fallback: { x: number; y: number }) => {
      const t = link && byNum.get(link.id);
      if (!t || t.kind === 'cxn') return fallback;
      const sites = sitesOf(t, xf(slide, t));
      const s = sites[link.idx] ?? sites[0];
      return s ? { x: s.x, y: s.y } : fallback;
    };
    const a = at(e.start, ends.a);
    const b = at(e.end, ends.b);
    const nx = xfrmBetween(a, b);
    const same = (['x', 'y', 'w', 'h'] as const).every((k) => Math.abs(nx[k] - cur[k]) < 0.01) && !!nx.flipH === !!cur.flipH && !!nx.flipV === !!cur.flipV;
    if (same) return e;
    changed = true;
    return { ...e, xfrm: { ...nx } };
  });
  return changed ? { ...deck, slides: deck.slides.map((s) => (s.id === slide.id ? { ...s, shapes } : s)) } : deck;
}
