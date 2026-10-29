/**
 * OCR con Tesseract (tesseract.js, Apache-2.0). El motor, el trabajador y los datos de idioma se sirven desde la propia aplicación
 * (`public/ocr`): no se descarga nada de Internet.
 */
interface Worker {
  recognize(image: string): Promise<{ data: { text: string } }>;
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

/** El texto de una imagen (dirección `data:` o `blob:`). */
export async function recognizeImage(src: string, lang: string): Promise<string> {
  const w = await get(lang);
  const r = await w.recognize(src);
  return r.data.text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim();
}

export async function disposeOcr(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await w.terminate().catch(() => undefined);
}
