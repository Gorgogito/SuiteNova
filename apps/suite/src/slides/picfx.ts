import { newId, updateElement, type Deck, type PicEl, type Pixels, type SlideElement } from '@suitenova/slides-core';
import type { SlidesCtl } from './ctl';

/*
 * Picture work that has to change the pixels (remove background, artistic effects, compress): the picture is decoded to a canvas,
 * processed, and stored as a new asset in the same undo step that points the picture at it.
 */

export async function assetToCanvas(data: Uint8Array, mime: string): Promise<HTMLCanvasElement> {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth || 1;
    cv.height = img.naturalHeight || 1;
    cv.getContext('2d')!.drawImage(img, 0, 0);
    return cv;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const readPixels = (cv: HTMLCanvasElement): Pixels => {
  const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
  return { data: d.data, w: d.width, h: d.height };
};

export function canvasFromPixels(p: Pixels): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = p.w;
  cv.height = p.h;
  cv.getContext('2d')!.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.w, p.h), 0, 0);
  return cv;
}

export const hasAlpha = (p: Pixels): boolean => {
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i]! < 250) return true;
  return false;
};

export const encode = (cv: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.85): Promise<Uint8Array> =>
  new Promise((ok, bad) => cv.toBlob(async (b) => (b ? ok(new Uint8Array(await b.arrayBuffer())) : bad(new Error('No se pudo crear la imagen.'))), type, quality));

export const pictures = (ctl: SlidesCtl): PicEl[] => ctl.selected.filter((e): e is PicEl => e.kind === 'pic');

/** Replaces the pixels of a picture. `fn` gets the decoded canvas and returns the new one. One undo step. */
export async function bakePicture(ctl: SlidesCtl, pic: PicEl, label: string, fn: (cv: HTMLCanvasElement) => HTMLCanvasElement | Promise<HTMLCanvasElement>, format: 'png' | 'auto' = 'png'): Promise<boolean> {
  const asset = ctl.deck.assets[pic.src];
  if (!asset) return false;
  const out = await fn(await assetToCanvas(asset.data, asset.mime));
  const jpeg = format === 'auto' && !hasAlpha(readPixels(out));
  const data = await encode(out, jpeg ? 'image/jpeg' : 'image/png');
  const id = newId('a');
  const name = (asset.name ?? 'Imagen').replace(/\.[^.]+$/, '') + (jpeg ? '.jpg' : '.png');
  ctl.apply(label, (d: Deck) => updateElement({ ...d, assets: { ...d.assets, [id]: { id, mime: jpeg ? 'image/jpeg' : 'image/png', data, name } } }, ctl.slide.id, pic.id, (e: SlideElement) => ({ ...e, src: id }) as SlideElement));
  return true;
}
