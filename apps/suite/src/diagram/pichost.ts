import { applyPixelEdits, cropPixels, isCropped, normalizePixelEdits, parseEdits, serializeEdits, visibleRect, type Crop, type FrameEdits, type PixelEdits, type Pixels } from '@suitenova/image-core';
import { setShapeImage, type Shape, type ShapeImage } from '@suitenova/diagram-core';
import { canvasFromPixels, decodePixels, encode } from '../images/canvas';
import type { PictureHost } from '../images/host';
import type { DiagramCtl } from './ctl';

/*
 * Diagram's side of the shared picture tools (the reduced set, like Visio: corrections, colour, artistic effects, background removal and
 * crop to a proportion, plus alternative text). A shape's picture keeps in `src` what is drawn (and what Visio and every other reader gets:
 * the original with the edits and the crop made), and, when it was edited, the original in `orig` and the edits in `edits`.
 */

const dataUri = (mime: string, bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(s)}`;
};
const parseUri = (uri: string): { mime: string; data: Uint8Array } | null => {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (!m) return null;
  const bin = atob(m[2]!);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { mime: m[1]!, data };
};
const pixelsOf = async (uri: string): Promise<Pixels | null> => {
  const p = parseUri(uri);
  if (!p || /svg/.test(p.mime)) return null;
  try {
    return await decodePixels(p.data, p.mime);
  } catch {
    return null;
  }
};

/** The edits of a picture (its pixels and its crop), as `image-core` keeps them. */
export const editsOf = (im: ShapeImage | undefined): { pixels: PixelEdits; crop?: Crop } => {
  const e = im?.edits ? parseEdits(im.edits) : null;
  return { pixels: e?.pixels ?? {}, ...(e?.frame?.crop ? { crop: e.frame.crop } : {}) };
};

/** The picture a shape gets with these edits: made from the original, or the original itself when there are none. Null when it cannot be read. */
export async function editedImage(im: ShapeImage, pixels: PixelEdits, crop: Crop | undefined): Promise<ShapeImage | null> {
  const orig = im.orig ?? im.src;
  const edits = normalizePixelEdits(pixels);
  const cr = isCropped(crop) ? crop : undefined;
  const { orig: _o, edits: _e, ...rest } = im;
  if (!edits && !cr) return { ...rest, src: orig };
  let px = await pixelsOf(orig);
  if (!px) return null;
  if (edits) px = applyPixelEdits(px, edits);
  if (cr) px = cropPixels(px, visibleRect(px.w, px.h, cr));
  return { ...rest, src: dataUri('image/png', await encode(canvasFromPixels(px), 'image/png')), orig, edits: serializeEdits({ ...(edits ? { pixels: edits } : {}), ...(cr ? { frame: { crop: cr } } : {}) }) };
}

/** Every selected picture gets these edits, in one undo step. */
async function apply(ctl: DiagramCtl, pick: (s: Shape) => { pixels: PixelEdits; crop?: Crop }): Promise<void> {
  const shapes = ctl.selectedShapes().filter((s) => s.image && !s.locked);
  if (!shapes.length) return;
  const made = new Map<string, ShapeImage>();
  for (const s of shapes) {
    const e = pick(s);
    const im = await editedImage(s.image!, e.pixels, e.crop);
    if (im) made.set(s.id, im);
  }
  if (!made.size) return;
  ctl.edit((p) => {
    let q = p;
    for (const [id, im] of made) {
      const now = q.shapes.find((x) => x.id === id);
      // the picture may have been replaced while it was being made
      if (now?.image && (now.image.orig ?? now.image.src) === (shapes.find((x) => x.id === id)!.image!.orig ?? shapes.find((x) => x.id === id)!.image!.src)) q = setShapeImage(q, [id], im);
    }
    return q;
  });
}

export function diagramPictureHost(ctl: DiagramCtl): PictureHost {
  const first = () => ctl.selectedShapes().find((s) => s.image && !s.locked);
  return {
    count: () => ctl.selectedShapes().filter((s) => s.image && !s.locked).length,
    pixelEdits: () => editsOf(first()?.image).pixels,
    setPixelEdits: (next) => apply(ctl, (s) => ({ pixels: next, crop: editsOf(s.image).crop })),
    frame: () => {
      const f: FrameEdits = {};
      const c = editsOf(first()?.image).crop;
      if (c) f.crop = c;
      return f;
    },
    // a crop is made in the picture (the shape keeps its box and its fit decides how the cropped picture is shown)
    setFrame: (next) => void apply(ctl, (s) => ({ pixels: editsOf(s.image).pixels, crop: next.crop })),
    original: async () => {
      const s = first();
      return s ? pixelsOf(s.image!.orig ?? s.image!.src) : null;
    },
    naturalSize: async () => {
      const s = first();
      const px = s ? await pixelsOf(s.image!.orig ?? s.image!.src) : null;
      return px ? { w: px.w, h: px.h } : null;
    },
    accent: () => '#4472c4',
  };
}

/** «Restablecer imagen»: the original, with no edit and no crop. */
export const resetPicture = (ctl: DiagramCtl): Promise<void> => apply(ctl, () => ({ pixels: {} }));
