import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** Una página de un PDF ya dibujada como imagen, con el texto que trae el propio PDF (no hace falta OCR). */
export interface PdfPage {
  png: Blob;
  width: number;
  height: number;
  text: string;
}

export const MAX_PDF_PAGES = 50;

/** Dibuja las páginas de un PDF (hasta `MAX_PDF_PAGES`) y saca su texto, como la «impresión de archivo» de OneNote. Nada sale del equipo. */
export async function renderPdf(data: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<{ pages: PdfPage[]; total: number }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
  try {
    const total = doc.numPages;
    const n = Math.min(total, MAX_PDF_PAGES);
    const pages: PdfPage[] = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const content = await page.getTextContent();
      const text = content.items.map((it) => ('str' in it ? it.str + ('hasEOL' in it && it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!png) throw new Error('No se pudo dibujar la página ' + i);
      pages.push({ png, width: canvas.width, height: canvas.height, text });
      page.cleanup();
      onProgress?.(i, n);
    }
    return { pages, total };
  } finally {
    await doc.cleanup();
  }
}
