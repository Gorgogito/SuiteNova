import { applyPixelEdits, isCropped, normalizePixelEdits, type FrameEdits, type PixelEdits, type Pixels } from '@suitenova/image-core';
import type { SheetImage } from '@suitenova/calc-engine';
import { canvasFromPixels, decodePixels, encode } from '../images/canvas';
import type { PictureHost } from '../images/host';
import { reframeBox } from '../images/reframe';
import type { CalcDoc } from './doc';

/*
 * Calc's side of the shared picture tools. A picture of a sheet keeps `media` (what shows: the original with the pixel edits made) and,
 * when it was edited, `orig` (the original in the media store) and `edits`. Crop (as `a:srcRect`), shape, outline, shadow, rotation and
 * flips are the picture's own; the box (x, y, width, height) is the part that shows.
 */

export const selectedPicture = (doc: CalcDoc): SheetImage | undefined => (doc.x.selectedImage ? doc.sheet.images.find((i) => i.id === doc.x.selectedImage && !i.smartart) : undefined);

const mediaPixels = async (doc: CalcDoc, key: string): Promise<Pixels | null> => {
  const m = doc.wb.media.get(key);
  return m ? decodePixels(m.data, m.mime) : null;
};

/** What a picture gets with these pixel edits (the picture is made here, from the original; nothing to do goes back to the original). */
export async function editedImagePatch(doc: CalcDoc, im: SheetImage, next: PixelEdits): Promise<Partial<SheetImage> | null> {
  const orig = im.orig ?? im.media;
  const edits = normalizePixelEdits(next);
  if (!edits) return { media: orig, orig: undefined, edits: undefined };
  const px = await mediaPixels(doc, orig);
  if (!px) return null;
  const bytes = await encode(canvasFromPixels(applyPixelEdits(px, edits)), 'image/png');
  return { media: doc.wb.addMedia('image/png', bytes), orig, edits };
}

export function calcPictureHost(doc: CalcDoc): PictureHost {
  const cur = () => selectedPicture(doc);
  return {
    count: () => (cur() ? 1 : 0),
    pixelEdits: () => (cur()?.edits as PixelEdits | undefined) ?? {},
    setPixelEdits: async (next, label) => {
      const im = cur();
      if (!im) return;
      const patch = await editedImagePatch(doc, im, next);
      // the picture may have been changed or deleted while it was being made
      if (patch && cur()?.id === im.id && cur()!.media === im.media) doc.x.updateImage(im.id, patch, label);
    },
    frame: () => {
      const im = cur();
      const f: FrameEdits = {};
      if (im?.crop) f.crop = im.crop;
      if (im?.shape) f.shape = im.shape;
      if (im?.border) f.border = im.border;
      if (im?.shadow) f.fx = { shadow: im.shadow };
      return f;
    },
    setFrame: (next, label) => {
      const im = cur();
      if (!im) return;
      const crop = isCropped(next.crop) ? next.crop : undefined;
      const patch: Partial<SheetImage> = { crop, shape: next.shape, border: next.border, shadow: next.fx?.shadow };
      if (JSON.stringify(im.crop ?? null) !== JSON.stringify(crop ?? null)) {
        const r = reframeBox({ x: im.x, y: im.y, w: im.width, h: im.height, rot: im.rotation, flipH: im.flipH, flipV: im.flipV }, im.crop, crop);
        Object.assign(patch, { x: r.x, y: r.y, width: r.w, height: r.h });
      }
      doc.x.updateImage(im.id, patch, label);
    },
    original: async () => {
      const im = cur();
      return im ? mediaPixels(doc, im.orig ?? im.media) : null;
    },
    naturalSize: async () => {
      const im = cur();
      const px = im ? await mediaPixels(doc, im.orig ?? im.media) : null;
      return px ? { w: px.w, h: px.h } : null;
    },
    accent: () => '#4472c4',
  };
}
