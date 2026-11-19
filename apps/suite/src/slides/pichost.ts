import { NO_CROP, applyBaked, frameForCrop, isCropped, type FrameEdits, type PixelEdits, type Pixels } from '@suitenova/image-core';
import { newId, frameOf, pixelEditsOf, splitForPicture, updateElement, withFrame, type Asset, type Deck, type PicEl, type SlideElement } from '@suitenova/slides-core';
import { assetToCanvas, canvasFromPixels, decodePixels, encode, readPixels } from '../images/canvas';
import type { PictureHost } from '../images/host';
import type { SlidesCtl } from './ctl';

/*
 * Slides' side of the shared picture tools. A picture keeps its pixel edits apart from the picture: `orig` is the original image and
 * `src` the original with the edits that PowerPoint cannot do by itself (`edits`: background, artistic effect, sharpness, saturation,
 * temperature) already made; brightness, contrast, recolor and transparency stay in `adjust`. Taking the edits off goes back to `orig`.
 */

export const pictures = (c: SlidesCtl): PicEl[] => c.selected.filter((e): e is PicEl => e.kind === 'pic');

/** The original image of a picture: its `orig` when it has edits, else its `src`. */
export const originalOf = (p: PicEl): string => p.orig ?? p.src;

/** The edited image: the original with the baked edits made, as a new PNG asset. */
async function bakeFrom(a: Asset, baked: PixelEdits): Promise<Asset> {
  const out = applyBaked(readPixels(await assetToCanvas(a.data, a.mime)), baked);
  const data = await encode(canvasFromPixels(out), 'image/png');
  const id = newId('a');
  return { id, mime: 'image/png', data, name: (a.name ?? 'Imagen').replace(/\.[^.]+$/, '') + '.png' };
}

/** What `src`, `orig`, `edits` and `adjust` of a picture become with these pixel edits (the new image is made here, from the original). */
export async function editedPicture(deck: Deck, p: PicEl, full: PixelEdits): Promise<{ patch: Partial<PicEl> & Pick<PicEl, 'src'>; asset?: Asset } | null> {
  const { adjust, baked } = splitForPicture(full);
  const orig = originalOf(p);
  const a = deck.assets[orig];
  if (!a) return null;
  if (!baked) return { patch: { src: orig, orig: undefined, edits: undefined, adjust } };
  const made = await bakeFrom(a, baked);
  return { patch: { src: made.id, orig, edits: baked, adjust }, asset: made };
}

const withPatch = (p: PicEl, patch: Partial<PicEl>): PicEl => {
  const out = { ...p, ...patch } as PicEl & Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as PicEl;
};

/**
 * Gives these pictures these pixel edits in one undo step. Every picture keeps its own background marks (points of its own image) unless
 * `next.background` is different from the first one's.
 */
export async function setPictureEdits(c: SlidesCtl, pics: PicEl[], next: PixelEdits, label: string): Promise<void> {
  if (!pics.length) return;
  const firstBg = JSON.stringify(pixelEditsOf(pics[0]!).background ?? null);
  const sameBg = JSON.stringify(next.background ?? null) === firstBg;
  const assets: Record<string, Asset> = {};
  const patches = new Map<string, Partial<PicEl>>();
  c.say(t0('Aplicando los cambios…'));
  try {
    for (const p of pics) {
      const full: PixelEdits = { ...next, background: sameBg ? pixelEditsOf(p).background : next.background };
      const r = await editedPicture(c.deck, p, full);
      if (!r) continue;
      patches.set(p.id, r.patch);
      if (r.asset) assets[r.asset.id] = r.asset;
    }
  } finally {
    c.say('');
  }
  if (!patches.size) return;
  c.apply(label, (d) => {
    let out: Deck = { ...d, assets: { ...d.assets, ...assets } };
    for (const [id, patch] of patches) out = updateElement(out, c.slide.id, id, (e: SlideElement) => withPatch(e as PicEl, patch));
    return out;
  });
}

const t0 = (s: string) => s;

/** The same edits applied to a new original (change picture, compress): the picture is made again from it. */
export async function remakePicture(deck: Deck, p: PicEl, origId: string, edits: PixelEdits | undefined): Promise<{ patch: Partial<PicEl> & Pick<PicEl, 'src'>; asset?: Asset } | null> {
  return editedPicture(deck, { ...p, orig: origId === p.src && !p.edits ? undefined : origId, src: origId, edits: undefined }, { ...pixelEditsOf({ ...p, edits }), ...(edits ?? {}) });
}

/** Moves and resizes a picture's box when its crop changes, so that the image stays where it is on the slide (rotation and flips respected). */
export function reframeForCrop(p: PicEl, x: { x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }, to: FrameEdits['crop']): PicEl['xfrm'] {
  const from = frameOf(p).crop ?? NO_CROP;
  const target = to ?? NO_CROP;
  const f = frameForCrop(x.w, x.h, from, target);
  const sx = x.flipH ? -(f.dx + (f.w - x.w)) : f.dx;
  const sy = x.flipV ? -(f.dy + (f.h - x.h)) : f.dy;
  const lx = sx + (f.w - x.w) / 2;
  const ly = sy + (f.h - x.h) / 2;
  const a = ((x.rot ?? 0) * Math.PI) / 180;
  const cx = x.x + x.w / 2 + lx * Math.cos(a) - ly * Math.sin(a);
  const cy = x.y + x.h / 2 + lx * Math.sin(a) + ly * Math.cos(a);
  return { ...(p.xfrm as object), x: cx - f.w / 2, y: cy - f.h / 2, w: f.w, h: f.h } as PicEl['xfrm'];
}

/** The picture tools' view of Slides: the selected pictures of the current slide. */
export function slidesPictureHost(c: SlidesCtl): PictureHost {
  const first = () => pictures(c)[0];
  return {
    count: () => pictures(c).length,
    pixelEdits: () => (first() ? pixelEditsOf(first()!) : {}),
    setPixelEdits: (next, label) => setPictureEdits(c, pictures(c), next, label),
    frame: () => (first() ? frameOf(first()!) : {}),
    setFrame: (next, label) => {
      const ids = pictures(c).map((p) => p.id);
      c.patch(ids, label, (e) => {
        const p = e as PicEl;
        const before = frameOf(p).crop;
        let q = withFrame(p, next);
        const crop = isCropped(next.crop) ? next.crop : undefined;
        if (JSON.stringify(before ?? null) !== JSON.stringify(crop ?? null)) {
          q = { ...q, xfrm: reframeForCrop(p, c.xfrmOf(p) as never, crop) };
          if (crop) q.srcRect = crop;
          else delete q.srcRect;
        } else if (crop) q.srcRect = crop;
        return q;
      });
    },
    original: async () => {
      const p = first();
      const a = p && c.deck.assets[originalOf(p)];
      return a ? decodePixels(a.data, a.mime) : null;
    },
    naturalSize: async () => {
      const p = first();
      const a = p && c.deck.assets[originalOf(p)];
      if (!a) return null;
      const bmp = await createImageBitmap(new Blob([a.data as BlobPart], { type: a.mime }));
      const size = { w: bmp.width, h: bmp.height };
      bmp.close();
      return size;
    },
    accent: () => '#4472c4',
  };
}

export type { Pixels };
