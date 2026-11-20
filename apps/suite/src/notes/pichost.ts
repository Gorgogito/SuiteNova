import { cropPixels, isCropped, visibleRect, type Crop, type FrameEdits } from '@suitenova/image-core';
import type { PictureHost } from '../images/host';
import { canvasFromPixels, decodePixels, encode } from '../images/canvas';
import type { NotesCtl } from './ctl';

/*
 * The picture tools of a Nova Notes image box. Notes has the reduced set (like OneNote): turn, flips, crop to a proportion and alternative
 * text. There are no pixel edits here, so the host only reads and writes the frame (the crop); the rest of the tools are not offered.
 */
export function notesPictureHost(ctl: NotesCtl, id: string): PictureHost {
  const box = () => {
    const c = ctl.page.containers.find((x) => x.id === id);
    return c && c.kind === 'image' ? c : null;
  };
  const pixels = async () => {
    const c = box();
    const a = c ? ctl.nb.assets[c.asset] : null;
    if (!a) return null;
    const bin = atob(a.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return decodePixels(bytes, a.mime);
  };
  return {
    count: () => (box() ? 1 : 0),
    pixelEdits: () => ({}),
    setPixelEdits: async () => undefined,
    frame: () => {
      const f: FrameEdits = {};
      const c = box();
      if (c?.crop) f.crop = c.crop as Crop;
      return f;
    },
    setFrame: (next) => {
      const c = box();
      if (c) ctl.setImageFrame(id, { rotation: c.rotation, flipH: c.flipH, flipV: c.flipV, crop: next.crop });
    },
    original: pixels,
    naturalSize: async () => {
      const px = await pixels();
      return px ? { w: px.w, h: px.h } : null;
    },
    accent: () => '#4472c4',
  };
}

/** The picture with its crop, turn and flips made (for what leaves Nova as an image: mail). Without them, the same bytes. */
export async function bakeFrame(data: Uint8Array, mime: string, f: { crop?: Crop; rotation?: number; flipH?: boolean; flipV?: boolean }): Promise<{ mime: string; data: Uint8Array }> {
  const crop = isCropped(f.crop) ? f.crop : undefined;
  const rot = ((f.rotation ?? 0) % 360 + 360) % 360;
  if (!crop && !rot && !f.flipH && !f.flipV) return { mime, data };
  try {
    let px = await decodePixels(data, mime);
    if (crop) px = cropPixels(px, visibleRect(px.w, px.h, crop));
    const src = canvasFromPixels(px);
    const a = (rot * Math.PI) / 180;
    // the box of the turned picture
    const w = Math.round(Math.abs(px.w * Math.cos(a)) + Math.abs(px.h * Math.sin(a)));
    const h = Math.round(Math.abs(px.w * Math.sin(a)) + Math.abs(px.h * Math.cos(a)));
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const g = out.getContext('2d')!;
    g.translate(w / 2, h / 2);
    g.rotate(a);
    g.scale(f.flipH ? -1 : 1, f.flipV ? -1 : 1);
    g.drawImage(src as CanvasImageSource, -px.w / 2, -px.h / 2);
    return { mime: 'image/png', data: await encode(out, 'image/png') };
  } catch {
    return { mime, data };
  }
}
