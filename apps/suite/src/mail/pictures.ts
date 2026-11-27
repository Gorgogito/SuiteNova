import { applyPixelEdits, cropPixels, isCropped, normalizePixelEdits, visibleRect, type Crop, type FrameEdits, type PixelEdits, type Pixels } from '@suitenova/image-core';
import { canvasFromPixels, decodePixels, encode } from '../images/canvas';
import type { PictureHost } from '../images/host';

/*
 * A picture of the message being written, as the picture tools see it. Mail programs do not draw crops, shapes or effects, so
 * what is sent is the picture with its edits and crop already made; the original and the edits stay with it.
 */

export interface ComposePicture {
  id: string;
  name: string;
  /** The original, as it was added. */
  orig: { mime: string; data: Uint8Array };
  edits?: PixelEdits;
  crop?: Crop;
  /** What is sent: the original with the edits and the crop made (the original itself without them). */
  sent: { mime: string; data: Uint8Array };
  /** Displayed width in px; the height follows the picture. */
  width: number;
  alt: string;
  /** The text read from the original (OCR, `StoredOcr` of the shared OCR, opaque here): only for the person writing, it does not travel in the message. */
  ocr?: unknown;
}

/** The picture as it is sent, made from the original. */
export async function makeSent(p: Pick<ComposePicture, 'orig' | 'edits' | 'crop'>): Promise<ComposePicture['sent']> {
  const edits = normalizePixelEdits(p.edits);
  const crop = isCropped(p.crop) ? p.crop : undefined;
  if (!edits && !crop) return p.orig;
  let px: Pixels = await decodePixels(p.orig.data, p.orig.mime);
  if (edits) px = applyPixelEdits(px, edits);
  if (crop) px = cropPixels(px, visibleRect(px.w, px.h, crop));
  return { mime: 'image/png', data: await encode(canvasFromPixels(px), 'image/png') };
}

/** The picture tools' view of a picture being written; `get` reads the picture as it is now and `set` replaces it. */
export function mailPictureHost(get: () => ComposePicture | undefined, set: (p: ComposePicture) => void): PictureHost {
  const origPixels = async (): Promise<Pixels | null> => {
    const p = get();
    return p ? decodePixels(p.orig.data, p.orig.mime) : null;
  };
  return {
    count: () => (get() ? 1 : 0),
    pixelEdits: () => get()?.edits ?? {},
    setPixelEdits: async (next) => {
      const p = get();
      if (!p) return;
      const edits = normalizePixelEdits(next);
      const made: ComposePicture = { ...p, edits };
      made.sent = await makeSent(made);
      // the picture may have been taken off or changed while it was being made
      if (get()?.id === p.id) set(made);
    },
    frame: () => {
      const p = get();
      const f: FrameEdits = {};
      if (p?.crop) f.crop = p.crop;
      return f;
    },
    setFrame: async (next) => {
      const p = get();
      if (!p) return;
      const made: ComposePicture = { ...p, crop: isCropped(next.crop) ? next.crop : undefined };
      made.sent = await makeSent(made);
      if (get()?.id === p.id) set(made);
    },
    original: origPixels,
    naturalSize: async () => {
      const px = await origPixels();
      return px ? { w: px.w, h: px.h } : null;
    },
    accent: () => '#4472c4',
  };
}
