import type { SheetImage } from '@suitenova/calc-engine';
import type { CSSProperties } from 'react';

/*
 * How a picture of a sheet is drawn with CSS (on screen and in print): the box (rotation, flips, shadow), the clip (shape and outline) and
 * the image inside it, made bigger and moved when the picture is cropped so that only the part that shows is seen.
 */

const RAD = Math.PI / 180;

export interface PictureCss {
  box: CSSProperties;
  clip: CSSProperties;
  img: CSSProperties;
}

export function pictureCss(im: Pick<SheetImage, 'crop' | 'shape' | 'border' | 'shadow' | 'rotation' | 'flipH' | 'flipV'>): PictureCss {
  const box: CSSProperties = {};
  const tf = [im.rotation ? `rotate(${im.rotation}deg)` : '', im.flipH ? 'scaleX(-1)' : '', im.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  if (tf) box.transform = tf;
  const sh = im.shadow;
  if (sh) {
    // points to pixels (×4/3); the angle is clockwise from the right, as in DrawingML
    const dx = Math.cos(sh.angle * RAD) * sh.dist * (4 / 3);
    const dy = Math.sin(sh.angle * RAD) * sh.dist * (4 / 3);
    box.filter = `drop-shadow(${dx.toFixed(1)}px ${dy.toFixed(1)}px ${((sh.blur * 4) / 3 / 2).toFixed(1)}px ${rgba(sh.color, sh.alpha)})`;
  }
  const clip: CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden', boxSizing: 'border-box' };
  if (im.shape === 'roundRect') clip.borderRadius = '16.67%';
  else if (im.shape === 'ellipse') clip.borderRadius = '50%';
  const b = im.border;
  if (b) clip.border = `${Math.max(1, (b.width * 4) / 3)}px ${b.dash === 'dot' ? 'dotted' : b.dash === 'dash' || b.dash === 'dashdot' ? 'dashed' : 'solid'} ${b.color}`;
  const img: CSSProperties = { display: 'block', userSelect: 'none' };
  const c = im.crop;
  if (c && (c.l || c.t || c.r || c.b)) {
    const kx = 1 - (c.l + c.r) / 100000;
    const ky = 1 - (c.t + c.b) / 100000;
    Object.assign(img, { position: 'absolute', width: `${100 / kx}%`, height: `${100 / ky}%`, left: `${-(c.l / 100000 / kx) * 100}%`, top: `${-(c.t / 100000 / ky) * 100}%`, maxWidth: 'none' });
  } else Object.assign(img, { width: '100%', height: '100%', objectFit: 'fill' });
  return { box, clip, img };
}

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** The same styles as the text of a `style` attribute (print). */
export const cssText = (s: CSSProperties): string =>
  Object.entries(s)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
    .join(';');
