import { isGlued, type End, type Page, type Shape } from './model';
import { stencilOf } from './stencils';

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Unit vector along an axis. */
export type Dir = { x: 1 | -1 | 0; y: 1 | -1 | 0 };

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotatePoint(p: Point, c: Point, deg: number): Point {
  if (!deg) return { x: p.x, y: p.y };
  const a = rad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export const centerOf = (s: Rect): Point => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

/** The four corners of the shape after rotation, clockwise from the top left. */
export function cornersOf(s: Shape): Point[] {
  const c = centerOf(s);
  return [
    { x: s.x, y: s.y },
    { x: s.x + s.w, y: s.y },
    { x: s.x + s.w, y: s.y + s.h },
    { x: s.x, y: s.y + s.h },
  ].map((p) => rotatePoint(p, c, s.rot));
}

/** Axis-aligned box that contains the rotated shape. */
export function boundsOf(s: Shape): Rect {
  const cs = cornersOf(s);
  const xs = cs.map((p) => p.x);
  const ys = cs.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionRects(rs: Rect[]): Rect | null {
  if (!rs.length) return null;
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

export const rectsIntersect = (a: Rect, b: Rect): boolean => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** Is the point inside the (rotated) shape's box? Stencils are treated as their bounding box for hit testing. */
export function hitShape(s: Shape, p: Point, margin = 0): boolean {
  const local = rotatePoint(p, centerOf(s), -s.rot);
  return local.x >= s.x - margin && local.x <= s.x + s.w + margin && local.y >= s.y - margin && local.y <= s.y + s.h + margin;
}

export interface Port {
  index: number;
  /** World coordinates. */
  point: Point;
  /** Direction pointing away from the shape, snapped to an axis. */
  dir: Dir;
}

const snapDir = (dx: number, dy: number): Dir => (Math.abs(dx) >= Math.abs(dy) ? { x: dx >= 0 ? 1 : -1, y: 0 } : { x: 0, y: dy >= 0 ? 1 : -1 });

export function portsOf(s: Shape): Port[] {
  const c = centerOf(s);
  return stencilOf(s.stencil).ports.map((p, index) => {
    // a mirrored shape has its connection points mirrored too
    const lx = s.flipH ? 1 - p.x : p.x;
    const ly = s.flipV ? 1 - p.y : p.y;
    const point = rotatePoint({ x: s.x + lx * s.w, y: s.y + ly * s.h }, c, s.rot);
    // direction in local space, then rotated with the shape
    let d = { x: p.dir === 'e' ? 1 : p.dir === 'w' ? -1 : 0, y: p.dir === 's' ? 1 : p.dir === 'n' ? -1 : 0 };
    if (s.flipH) d = { x: -d.x, y: d.y };
    if (s.flipV) d = { x: d.x, y: -d.y };
    const a = rad(s.rot);
    return { index, point, dir: snapDir(d.x * Math.cos(a) - d.y * Math.sin(a), d.x * Math.sin(a) + d.y * Math.cos(a)) };
  });
}

/** The port that is closest to `toward`; used for connectors glued to "auto". */
export function nearestPort(s: Shape, toward: Point): Port {
  const ports = portsOf(s);
  let best = ports[0]!;
  let bd = Infinity;
  for (const p of ports) {
    const d = Math.hypot(p.point.x - toward.x, p.point.y - toward.y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

export interface ResolvedEnd {
  point: Point;
  /** Axis the connector leaves in; null for free ends. */
  dir: Dir | null;
  shape?: Shape;
  port?: number;
}

/** Where a connector end is on the page. `other` is the reference for auto ports. */
export function resolveEnd(e: End, page: Page, other: Point): ResolvedEnd {
  if (!isGlued(e)) return { point: { x: e.x, y: e.y }, dir: null };
  const s = page.shapes.find((x) => x.id === e.shape);
  if (!s) return { point: other, dir: null };
  const ports = portsOf(s);
  const p = e.port === 'auto' ? nearestPort(s, other) : (ports[e.port] ?? ports[0]!);
  return { point: p.point, dir: p.dir, shape: s, port: p.index };
}

/** The point used to pick auto ports: the centre of the shape at the other end, or the free point. */
export function referencePoint(e: End, page: Page): Point {
  if (!isGlued(e)) return { x: e.x, y: e.y };
  const s = page.shapes.find((x) => x.id === e.shape);
  return s ? centerOf(s) : { x: 0, y: 0 };
}

export const snap = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Point, pts: Point[]): number {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(p, pts[i - 1]!, pts[i]!));
  return d;
}
