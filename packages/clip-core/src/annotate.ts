import type { Point } from './geometry';

/** Marks drawn on a capture, in the pixels of the capture. A stroke is a whole mark (what the eraser removes and undo takes back in one step). */

export type Tool = 'pen' | 'highlighter' | 'arrow' | 'rect';

export interface Stroke {
  id: number;
  tool: Tool;
  color: string;
  /** Thickness in capture pixels (the highlighter draws it wider, see `strokeWidth`). */
  width: number;
  /** Pen and highlighter: every point of the path. Arrow and rectangle: the start and the end. */
  points: Point[];
}

/** The colours offered (the ones of the Windows snipping tool: red, yellow, green, blue, black, white). */
export const CLIP_COLORS: { name: string; color: string }[] = [
  { name: 'Rojo', color: '#e81123' },
  { name: 'Amarillo', color: '#ffd800' },
  { name: 'Verde', color: '#16c60c' },
  { name: 'Azul', color: '#0078d4' },
  { name: 'Negro', color: '#000000' },
  { name: 'Blanco', color: '#ffffff' },
];

/** The thicknesses offered, in pixels on the screen (the dialog turns them into capture pixels). */
export const CLIP_WIDTHS: { name: string; px: number }[] = [
  { name: 'Fino', px: 2 },
  { name: 'Medio', px: 4 },
  { name: 'Grueso', px: 8 },
];

/** A highlighter is a fat, see-through pen. */
export const HIGHLIGHTER_ALPHA = 0.4;
export const HIGHLIGHTER_FACTOR = 4;

/** The width a stroke is really drawn with. */
export function strokeWidth(s: Pick<Stroke, 'tool' | 'width'>): number {
  return s.tool === 'highlighter' ? s.width * HIGHLIGHTER_FACTOR : s.width;
}

/** Distance from a point to a segment. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Drops the points that are closer than `min` to the one kept before, so a slow drag does not store thousands of points. The last point always stays. */
export function simplify(points: Point[], min: number): Point[] {
  if (points.length <= 2) return points.slice();
  const out = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1]!;
    if (Math.hypot(points[i]!.x - last.x, points[i]!.y - last.y) >= min) out.push(points[i]!);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** The two barbs of an arrow that goes from `a` to `b` (the tip is `b`); null when the arrow has no length. */
export function arrowHead(a: Point, b: Point, width: number): [Point, Point] | null {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return null;
  const size = Math.min(len, Math.max(12, width * 5));
  const ang = Math.atan2(a.y - b.y, a.x - b.x);
  const spread = (28 * Math.PI) / 180;
  return [
    { x: b.x + size * Math.cos(ang + spread), y: b.y + size * Math.sin(ang + spread) },
    { x: b.x + size * Math.cos(ang - spread), y: b.y + size * Math.sin(ang - spread) },
  ];
}

/** The segments a stroke is made of (what the eraser tests). */
function segments(s: Stroke): [Point, Point][] {
  const p = s.points;
  if (p.length === 0) return [];
  if (s.tool === 'rect') {
    if (p.length < 2) return [];
    const [a, b] = [p[0]!, p[p.length - 1]!];
    const c = { x: b.x, y: a.y };
    const d = { x: a.x, y: b.y };
    return [[a, c], [c, b], [b, d], [d, a]];
  }
  if (s.tool === 'arrow') {
    const [a, b] = [p[0]!, p[p.length - 1]!];
    const head = arrowHead(a, b, s.width);
    return [[a, b], ...(head ? head.map((h) => [b, h] as [Point, Point]) : [])];
  }
  if (p.length === 1) return [[p[0]!, p[0]!]];
  const out: [Point, Point][] = [];
  for (let i = 1; i < p.length; i++) out.push([p[i - 1]!, p[i]!]);
  return out;
}

/** True when the point is on the stroke, with `tol` pixels of margin (plus half its thickness). */
export function hitStroke(s: Stroke, p: Point, tol: number): boolean {
  const reach = tol + strokeWidth(s) / 2;
  return segments(s).some(([a, b]) => distToSegment(p, a, b) <= reach);
}

/** The strokes without the ones under the point. The same array when none is hit, so a caller can tell nothing changed. */
export function eraseAt(strokes: Stroke[], p: Point, tol: number): Stroke[] {
  const left = strokes.filter((s) => !hitStroke(s, p, tol));
  return left.length === strokes.length ? strokes : left;
}

/** The strokes without the ones the eraser touched going from `a` to `b` (a fast drag jumps many pixels between two pointer events, so the way between is checked too). */
export function eraseAlong(strokes: Stroke[], a: Point, b: Point, tol: number): Stroke[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, tol)));
  let out = strokes;
  for (let i = 0; i <= steps; i++) out = eraseAt(out, { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }, tol);
  return out;
}

/** Draws the strokes on a canvas. `k` scales capture pixels to canvas pixels (1 when drawing on the capture itself). */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], k = 1): void {
  for (const s of strokes) {
    if (!s.points.length) continue;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = Math.max(1, strokeWidth(s) * k);
    ctx.lineJoin = 'round';
    ctx.lineCap = s.tool === 'highlighter' ? 'butt' : 'round';
    if (s.tool === 'highlighter') ctx.globalAlpha = HIGHLIGHTER_ALPHA;
    const P = (p: Point): [number, number] => [p.x * k, p.y * k];
    const first = s.points[0]!;
    const last = s.points[s.points.length - 1]!;
    if (s.tool === 'rect') {
      if (s.points.length > 1) ctx.strokeRect(first.x * k, first.y * k, (last.x - first.x) * k, (last.y - first.y) * k);
    } else if (s.tool === 'arrow') {
      if (s.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(...P(first));
        ctx.lineTo(...P(last));
        const head = arrowHead(first, last, s.width);
        if (head) {
          ctx.moveTo(...P(head[0]));
          ctx.lineTo(...P(last));
          ctx.lineTo(...P(head[1]));
        }
        ctx.stroke();
      }
    } else if (s.points.length === 1) {
      ctx.beginPath();
      ctx.arc(first.x * k, first.y * k, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(...P(first));
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(...P(s.points[i]!));
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** A history of the strokes with undo and redo (every change is one step). */
export interface History {
  past: Stroke[][];
  present: Stroke[];
  future: Stroke[][];
}

export const emptyHistory = (): History => ({ past: [], present: [], future: [] });

/** The history after the strokes become `next` (it cannot be redone any more). The same history when nothing changed. */
export function commit(h: History, next: Stroke[]): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present], present: next, future: [] };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}
