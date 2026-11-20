// The Tesseract engine of the shared OCR (tesseract.js, Apache-2.0). The engine, the worker and the language data are served from the program itself
// (`public/ocr`): nothing is downloaded from the Internet. One worker is kept while the language does not change.
import type { OcrEngine, OcrOptions, RawLine, RawOcr } from '@suitenova/ocr-core';

interface TessBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface TessWord {
  text: string;
  confidence: number;
  bbox: TessBox;
}
interface TessResult {
  data: { text: string; blocks?: { paragraphs: { lines: { words: TessWord[] }[] }[] }[] | null };
}
interface Worker {
  recognize(image: unknown, options?: object, output?: object): Promise<TessResult>;
  terminate(): Promise<unknown>;
}

let worker: Worker | null = null;
let workerLang = '';
let creating: Promise<Worker> | null = null;

const abs = (rel: string): string => new URL(`${import.meta.env.BASE_URL}${rel}`, location.href).href.replace(/\/$/, '');

async function get(lang: string): Promise<Worker> {
  if (worker && workerLang === lang) return worker;
  if (creating) {
    await creating.catch(() => undefined);
    if (worker && workerLang === lang) return worker;
  }
  const old = worker;
  worker = null;
  creating = (async () => {
    if (old) await old.terminate().catch(() => undefined);
    const { createWorker } = await import('tesseract.js');
    const w = (await createWorker(lang.split('+'), 1, {
      workerPath: abs('ocr/worker.min.js'),
      corePath: abs('ocr'),
      langPath: abs('ocr/lang'),
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
    })) as unknown as Worker;
    worker = w;
    workerLang = lang;
    return w;
  })();
  try {
    return await creating;
  } finally {
    creating = null;
  }
}

/** Raw RGBA pixels as a canvas, which is what the worker reads. */
function canvasOf(image: { data: Uint8ClampedArray; w: number; h: number }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = image.w;
  c.height = image.h;
  c.getContext('2d')!.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.w, image.h), 0, 0);
  return c;
}

export const tesseractEngine: OcrEngine = {
  async recognize(image, options: OcrOptions): Promise<RawOcr> {
    const w = await get(options.lang);
    if (options.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const r = await w.recognize(canvasOf(image), {}, { blocks: true });
    const lines: RawLine[] = [];
    for (const b of r.data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines)
          lines.push({ words: l.words.map((x) => ({ text: x.text, confidence: x.confidence, box: { x: x.bbox.x0, y: x.bbox.y0, w: x.bbox.x1 - x.bbox.x0, h: x.bbox.y1 - x.bbox.y0 } })) });
    return { lines };
  },
};

/** Free the worker (and its memory) when no more readings are expected. */
export async function disposeTesseract(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await w.terminate().catch(() => undefined);
}
