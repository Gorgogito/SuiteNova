import { boundsOf, distToPolyline, referencePoint, resolveEnd, type Dir, type Point, type ResolvedEnd } from './geometry';
import { isGlued, type Arrow, type Connector, type Page } from './model';

export interface Route {
  /** Polyline used for hit tests, arrows and labels. For curves it is a sampled version of the curve. */
  points: Point[];
  /** SVG path data of what is drawn. */
  d: string;
  /** Point where the label goes. */
  mid: Point;
  /** Direction the line leaves the start / arrives at the end (pointing along the line, away from the ends). */
  startDir: Point;
  endDir: Point;
}

const STUB = 24;

const add = (p: Point, d: Dir, k: number): Point => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

/** Remove repeated and collinear points. */
export function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    if (out.length && same(out[out.length - 1]!, p)) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1]!;
    const b = out[i]!;
    const c = out[i + 1]!;
    if ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)) out.splice(i, 1);
  }
  return out;
}

const horiz = (d: Dir) => d.y === 0;

/**
 * Orthogonal path between two points that leave in the given directions. It does not look for other shapes in the way:
 * connectors are drawn over them.
 */
export function elbow(s: Point, ds: Dir | null, e: Point, de: Dir | null): Point[] {
  // free ends head toward the other end
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const d1: Dir = ds ?? (Math.abs(dx) >= Math.abs(dy) ? { x: dx >= 0 ? 1 : -1, y: 0 } : { x: 0, y: dy >= 0 ? 1 : -1 });
  const d2: Dir = de ?? (Math.abs(dx) >= Math.abs(dy) ? { x: dx >= 0 ? -1 : 1, y: 0 } : { x: 0, y: dy >= 0 ? -1 : 1 });
  const s1 = ds ? add(s, d1, STUB) : s;
  const e1 = de ? add(e, d2, STUB) : e;
  const mid: Point[] = [];
  if (horiz(d1) && horiz(d2)) {
    if ((e1.x - s1.x) * d1.x > 0 && d1.x !== d2.x) {
      const mx = (s1.x + e1.x) / 2;
      mid.push({ x: mx, y: s1.y }, { x: mx, y: e1.y });
    } else {
      // go around: leave, run along a free row, come back
      const my = Math.abs(e1.y - s1.y) > 2 * STUB ? (s1.y + e1.y) / 2 : Math.min(s1.y, e1.y) - 2 * STUB;
      mid.push({ x: s1.x, y: my }, { x: e1.x, y: my });
    }
  } else if (!horiz(d1) && !horiz(d2)) {
    if ((e1.y - s1.y) * d1.y > 0 && d1.y !== d2.y) {
      const my = (s1.y + e1.y) / 2;
      mid.push({ x: s1.x, y: my }, { x: e1.x, y: my });
    } else {
      const mx = Math.abs(e1.x - s1.x) > 2 * STUB ? (s1.x + e1.x) / 2 : Math.min(s1.x, e1.x) - 2 * STUB;
      mid.push({ x: mx, y: s1.y }, { x: mx, y: e1.y });
    }
  } else if (horiz(d1)) {
    // one corner, when it lies in front of both ends
    const c = { x: e1.x, y: s1.y };
    if ((c.x - s1.x) * d1.x > 0 && (c.y - e1.y) * d2.y > 0) mid.push(c);
    else mid.push({ x: s1.x, y: (s1.y + e1.y) / 2 }, { x: e1.x, y: (s1.y + e1.y) / 2 });
  } else {
    const c = { x: s1.x, y: e1.y };
    if ((c.y - s1.y) * d1.y > 0 && (c.x - e1.x) * d2.x > 0) mid.push(c);
    else mid.push({ x: (s1.x + e1.x) / 2, y: s1.y }, { x: (s1.x + e1.x) / 2, y: e1.y });
  }
  return simplify([s, ...(ds ? [s1] : []), ...mid, ...(de ? [e1] : []), e]);
}

function bezier(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);
const pathOf = (pts: Point[]) => `M${pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' L')}`;

const unit = (a: Point, b: Point): Point => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

/** Default distance between connectors that end at the same connection point. */
export const DEFAULT_SPREAD = 10;

/** Where both ends of a connector are, before connectors that share a connection point are moved apart. */
function baseEnds(c: Connector, page: Page): { a: ResolvedEnd; b: ResolvedEnd } {
  // auto ports are chosen against the centre of the other shape first, then once more against the exact other end
  const first = resolveEnd(c.to, page, referencePoint(c.from, page));
  const a = resolveEnd(c.from, page, first.point);
  const b = resolveEnd(c.to, page, a.point);
  return { a, b };
}

type Slots = Map<string, number>;
const slotCache = new WeakMap<Page, { spread: number; slots: Slots }>();

/**
 * Connectors that end at the same connection point of a shape are spread along that side of the shape, `spread` apart, in the
 * order of where their other ends lie, so that they do not run on top of each other (and do not cross near the shape).
 * The result maps "connector id + end" to its distance from the connection point, along the side.
 */
function slotsOf(page: Page): Slots {
  const spread = page.spread ?? DEFAULT_SPREAD;
  const hit = slotCache.get(page);
  if (hit && hit.spread === spread) return hit.slots;
  const slots: Slots = new Map();
  if (spread > 0) {
    const groups = new Map<string, { id: string; which: 'from' | 'to'; other: Point; shape: string; dir: Dir; point: Point }[]>();
    for (const c of page.connectors) {
      const { a, b } = baseEnds(c, page);
      for (const [which, mine, other] of [['from', a, b], ['to', b, a]] as const) {
        const e = which === 'from' ? c.from : c.to;
        if (!isGlued(e) || !mine.shape || !mine.dir) continue;
        const key = `${mine.shape.id}#${mine.port}`;
        const list = groups.get(key) ?? [];
        list.push({ id: c.id, which, other: other.point, shape: mine.shape.id, dir: mine.dir, point: mine.point });
        groups.set(key, list);
      }
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const first = list[0]!;
      const tangent = { x: -first.dir.y, y: first.dir.x };
      const shape = page.shapes.find((s) => s.id === first.shape)!;
      const bb = boundsOf(shape);
      const side = first.dir.x !== 0 ? bb.h : bb.w;
      const room = Math.max(0, side / 2 - 8);
      const along = (p: Point) => (p.x - first.point.x) * tangent.x + (p.y - first.point.y) * tangent.y;
      list.sort((p, q) => along(p.other) - along(q.other));
      const step = Math.min(spread, list.length > 1 ? (2 * room) / (list.length - 1) : spread);
      list.forEach((it, i) => slots.set(`${it.id}:${it.which}`, (i - (list.length - 1) / 2) * step));
    }
  }
  slotCache.set(page, { spread, slots });
  return slots;
}

/** How far a connector end is moved from its connection point (0 when it has the point to itself). */
export function slotOffset(c: Connector, which: 'from' | 'to', page: Page): number {
  return slotsOf(page).get(`${c.id}:${which}`) ?? 0;
}

const shiftEnd = (r: ResolvedEnd, off: number): ResolvedEnd => (off && r.dir ? { ...r, point: { x: r.point.x - r.dir.y * off, y: r.point.y + r.dir.x * off } } : r);

export function routeOf(c: Connector, page: Page): Route {
  const ends = baseEnds(c, page);
  const rs2 = shiftEnd(ends.a, slotOffset(c, 'from', page));
  const re2 = shiftEnd(ends.b, slotOffset(c, 'to', page));
  const s = rs2.point;
  const e = re2.point;
  if (c.routing === 'curve') {
    const k = Math.max(40, Math.hypot(e.x - s.x, e.y - s.y) / 2.5);
    const ds: Dir = rs2.dir ?? { x: e.x >= s.x ? 1 : -1, y: 0 };
    const de: Dir = re2.dir ?? { x: s.x >= e.x ? 1 : -1, y: 0 };
    const c1 = add(s, ds, k);
    const c2 = add(e, de, k);
    const pts = Array.from({ length: 33 }, (_, i) => bezier(s, c1, c2, e, i / 32));
    return { points: pts, d: `M${fmt(s.x)},${fmt(s.y)} C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(e.x)},${fmt(e.y)}`, mid: pts[16]!, startDir: unit(s, pts[1]!), endDir: unit(e, pts[31]!) };
  }
  const pts = c.routing === 'elbow' ? elbow(s, rs2.dir, e, re2.dir) : [s, e];
  return { points: pts, d: pathOf(pts), mid: midOf(pts), startDir: unit(pts[0]!, pts[1] ?? pts[0]!), endDir: unit(pts[pts.length - 1]!, pts[pts.length - 2] ?? pts[pts.length - 1]!) };
}

/** The point halfway along the polyline. */
export function midOf(pts: Point[]): Point {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    if (half <= seg && seg > 0) {
      const t = half / seg;
      return { x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * t, y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * t };
    }
    half -= seg;
  }
  return pts[0] ?? { x: 0, y: 0 };
}

export const hitConnector = (c: Connector, page: Page, p: Point, tol = 6): boolean => distToPolyline(p, routeOf(c, page).points) <= tol;

/** Arrow head as SVG path data, with its tip at `tip` and `dir` pointing from the tip back along the line. */
export function arrowPath(kind: Arrow, tip: Point, dir: Point, size: number): { d: string; fill: boolean } | null {
  if (kind === 'none') return null;
  const nx = -dir.y;
  const ny = dir.x;
  const pt = (along: number, side: number) => `${fmt(tip.x + dir.x * along + nx * side)},${fmt(tip.y + dir.y * along + ny * side)}`;
  switch (kind) {
    case 'arrow': return { d: `M${pt(0, 0)} L${pt(size, size / 2.4)} L${pt(size, -size / 2.4)} Z`, fill: true };
    case 'open': return { d: `M${pt(size, size / 2.2)} L${pt(0, 0)} L${pt(size, -size / 2.2)}`, fill: false };
    case 'diamond': return { d: `M${pt(0, 0)} L${pt(size / 2, size / 3)} L${pt(size, 0)} L${pt(size / 2, -size / 3)} Z`, fill: true };
    case 'diamondOpen': return { d: `M${pt(0, 0)} L${pt(size / 2, size / 3)} L${pt(size, 0)} L${pt(size / 2, -size / 3)} Z`, fill: false };
    case 'oval': {
      const r = size / 3;
      const cx = tip.x + dir.x * r;
      const cy = tip.y + dir.y * r;
      return { d: `M${fmt(cx - r)},${fmt(cy)} A${fmt(r)},${fmt(r)} 0 1 0 ${fmt(cx + r)},${fmt(cy)} A${fmt(r)},${fmt(r)} 0 1 0 ${fmt(cx - r)},${fmt(cy)} Z`, fill: false };
    }
    case 'bar': return { d: `M${pt(size / 3, size / 2)} L${pt(size / 3, -size / 2)}`, fill: false };
  }
}
