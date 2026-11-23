/** Geometry of a screen clip: the zone chosen on a capture, in the pixels of the capture itself. Pure functions, no interface. */

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
export interface Rect extends Point, Size {}

/** Smallest zone (in capture pixels) that counts as a choice; anything smaller is a click, not a zone. */
export const MIN_CLIP = 4;

/** The rectangle between two corners, whatever the direction of the drag. */
export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** A point inside the capture. */
export function clampPoint(p: Point, bounds: Size): Point {
  return { x: Math.max(0, Math.min(bounds.w, p.x)), y: Math.max(0, Math.min(bounds.h, p.y)) };
}

/** True when the zone is big enough to be a choice. */
export function isZone(r: Rect | null | undefined, min = MIN_CLIP): r is Rect {
  return !!r && r.w >= min && r.h >= min;
}

/** The zone moved by (dx, dy) without leaving the capture. */
export function moveRect(r: Rect, dx: number, dy: number, bounds: Size): Rect {
  return { ...r, x: Math.max(0, Math.min(bounds.w - r.w, r.x + dx)), y: Math.max(0, Math.min(bounds.h - r.h, r.y + dy)) };
}

/** The zone made wider or taller (negative values shrink it) from its bottom-right corner, kept inside the capture and at least `min` big. */
export function resizeRect(r: Rect, dw: number, dh: number, bounds: Size, min = MIN_CLIP): Rect {
  return { ...r, w: Math.max(min, Math.min(bounds.w - r.x, r.w + dw)), h: Math.max(min, Math.min(bounds.h - r.y, r.h + dh)) };
}

/** The whole capture as a zone. */
export function fullRect(bounds: Size): Rect {
  return { x: 0, y: 0, w: bounds.w, h: bounds.h };
}

/** The pixels to cut out: whole numbers inside the capture, never empty. With no usable zone, the whole capture. */
export function cropBox(r: Rect | null | undefined, bounds: Size): Rect {
  if (!isZone(r)) return fullRect(bounds);
  const x = Math.max(0, Math.min(bounds.w - 1, Math.round(r.x)));
  const y = Math.max(0, Math.min(bounds.h - 1, Math.round(r.y)));
  const w = Math.max(1, Math.min(bounds.w - x, Math.round(r.x + r.w) - x));
  const h = Math.max(1, Math.min(bounds.h - y, Math.round(r.y + r.h) - y));
  return { x, y, w, h };
}

/** How big the preview of a capture is: it fits in `max` and is never enlarged. */
export function fitScale(size: Size, max: Size): number {
  if (!size.w || !size.h) return 1;
  return Math.min(1, max.w / size.w, max.h / size.h);
}

/** The name of the file of a clip: «Recorte de pantalla 2026-11-23 10-30-00.png». The date is local time and has no characters a file name cannot hold. */
export function clipFileName(base: string, when: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())} ${p(when.getHours())}-${p(when.getMinutes())}-${p(when.getSeconds())}`;
  return `${base.replace(/[\/:*?"<>|]+/g, '-')} ${stamp}.png`;
}

/** «300 × 200 px». */
export function describeSize(r: Size): string {
  return `${Math.round(r.w)} × ${Math.round(r.h)} px`;
}

/** A zone drawn over a view of the capture (in the pixels of the view) in the pixels of the capture itself. */
export function viewToImage(r: Rect, view: Size, img: Size): Rect {
  const kx = img.w / (view.w || 1);
  const ky = img.h / (view.h || 1);
  return { x: r.x * kx, y: r.y * ky, w: r.w * kx, h: r.h * ky };
}
