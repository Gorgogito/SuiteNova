// Reading the text of a picture in the app: decode it, and read it with the shared OCR (`ocr-core`) and the Tesseract engine.
import { recognize, type Box, type OcrResult } from '@suitenova/ocr-core';
import { decodePixels } from '../images/canvas';
import { tesseractEngine } from './tesseract';

/** The bytes and type of a `data:` or `blob:` address. */
async function bytesOf(src: string): Promise<{ data: Uint8Array; mime: string }> {
  const blob = await (await fetch(src)).blob();
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/png' };
}

export interface ReadOptions {
  zone?: Box;
  /** Quarter turns to read it at; by default the program finds out. */
  turns?: 0 | 1 | 2 | 3 | 'auto';
  signal?: AbortSignal;
}

/** The text of a picture (a `data:` or `blob:` address) with where each word is. Rejects with an `AbortError` when `signal` is aborted. */
export async function readImage(src: string, lang: string, o: ReadOptions = {}): Promise<OcrResult> {
  const { data, mime } = await bytesOf(src);
  const pixels = await decodePixels(data, mime);
  return recognize(tesseractEngine, pixels, { lang, zone: o.zone, turns: o.turns ?? 'auto', signal: o.signal });
}

/** Only the text, for what is drawn to be read (handwriting turned into text). */
export async function readText(src: string, lang: string): Promise<string> {
  return (await readImage(src, lang, { turns: 0 })).text;
}
