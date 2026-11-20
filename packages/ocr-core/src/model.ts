/*
 * Shared model of the text found in pictures. Every product keeps its pictures its own way; what the reading of one gives (the text, where each word
 * is, how sure the engine was) is the same everywhere.
 */

/** A box in pixels of the picture the text was read from (the whole picture, not a crop or a scaled copy). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrWord {
  text: string;
  box: Box;
  /** 0 to 100. */
  confidence: number;
}

export interface OcrLine {
  text: string;
  box: Box;
  words: OcrWord[];
}

export interface OcrResult {
  /** The text, lines joined with a line break and paragraphs with a blank line. */
  text: string;
  lines: OcrLine[];
  /** Language codes of the models used, joined with «+» (`spa+eng`); `pdf` for the text a PDF already had. */
  lang: string;
  /** Size of the picture the boxes refer to; 0 when the text has no positions. */
  width: number;
  height: number;
  /** Mean confidence of the words, 0 to 100 (100 for text that was not read but written, as in a PDF). */
  confidence: number;
  /** Quarter turns clockwise the picture had to be turned to be read (0, 90, 180 or 270). */
  rotation: 0 | 90 | 180 | 270;
  /** When it was read (ms since epoch). */
  at: number;
  /** The part of the picture that was read, when it was not the whole one. */
  zone?: Box;
}

/** What an engine hands back: words with boxes in the pixels of the picture it was given, grouped in lines. */
export interface RawLine {
  words: { text: string; box: Box; confidence: number }[];
}
export interface RawOcr {
  lines: RawLine[];
}

export interface OcrOptions {
  /** `spa`, `eng` or `spa+eng`. */
  lang: string;
  signal?: AbortSignal;
}

/** The recognition engine (Tesseract in the app, a fake one in the tests). It reads one picture of raw RGBA pixels. */
export interface OcrEngine {
  recognize(image: { data: Uint8ClampedArray; w: number; h: number }, options: OcrOptions): Promise<RawOcr>;
}

export const LANGS = ['spa', 'eng', 'spa+eng'] as const;
export type OcrLang = (typeof LANGS)[number];

export const boxRight = (b: Box): number => b.x + b.w;
export const boxBottom = (b: Box): number => b.y + b.h;
export const unionBox = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(boxRight(a), boxRight(b)) - x, h: Math.max(boxBottom(a), boxBottom(b)) - y };
};
export const unionBoxes = (list: readonly Box[]): Box | null => (list.length ? list.reduce(unionBox) : null);
