import { NO_CROP, frameForCrop, type Crop } from '@suitenova/image-core';

/**
 * The box of a picture when its crop changes from `from` to `to` and the image must stay where it is: the box gains or loses what was cut at
 * each side. The box is the unrotated one (`x`, `y`, `w`, `h`); the rotation (degrees) and flips of the picture are respected.
 */
export function reframeBox(b: { x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }, from: Crop | undefined, to: Crop | undefined): { x: number; y: number; w: number; h: number } {
  const f = frameForCrop(b.w, b.h, from ?? NO_CROP, to ?? NO_CROP);
  const sx = b.flipH ? -(f.dx + (f.w - b.w)) : f.dx;
  const sy = b.flipV ? -(f.dy + (f.h - b.h)) : f.dy;
  const lx = sx + (f.w - b.w) / 2;
  const ly = sy + (f.h - b.h) / 2;
  const a = ((b.rot ?? 0) * Math.PI) / 180;
  const cx = b.x + b.w / 2 + lx * Math.cos(a) - ly * Math.sin(a);
  const cy = b.y + b.h / 2 + lx * Math.sin(a) + ly * Math.cos(a);
  return { x: cx - f.w / 2, y: cy - f.h / 2, w: f.w, h: f.h };
}
