import { resample, type Pixels } from '@suitenova/image-core';

/* Decoding and encoding of pictures with the browser's canvas: the only DOM part of the picture tools, shared by every product. */

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

/** The pixels of an encoded picture. */
export async function decodePixels(data: Uint8Array, mime: string): Promise<Pixels> {
  return readPixels(await assetToCanvas(data, mime));
}

/** The pixels of an encoded picture, shrunk (never enlarged) so that no side is longer than `max`: for previews while a slider moves. */
export async function decodeSmall(data: Uint8Array, mime: string, max: number): Promise<{ pixels: Pixels; scale: number; full: { w: number; h: number } }> {
  const full = await decodePixels(data, mime);
  const k = Math.min(1, max / Math.max(full.w, full.h));
  return { pixels: k < 1 ? resample(full, full.w * k, full.h * k) : full, scale: k, full: { w: full.w, h: full.h } };
}

/** Draws pixels on a canvas element (the canvas takes the size of the pixels), over a chessboard when `board` is set so that transparency shows. */
export function paint(cv: HTMLCanvasElement, p: Pixels, board = true): void {
  cv.width = p.w;
  cv.height = p.h;
  const g = cv.getContext('2d')!;
  if (board) for (let y = 0; y < p.h; y += 10) for (let x = 0; x < p.w; x += 10) ((g.fillStyle = (x / 10 + y / 10) % 2 ? '#ddd' : '#fff'), g.fillRect(x, y, 10, 10));
  g.drawImage(canvasFromPixels(p), 0, 0);
}
