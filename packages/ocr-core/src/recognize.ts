import type { Pixels } from '@suitenova/image-core';
import { unionBoxes, type Box, type OcrEngine, type OcrLine, type OcrResult, type RawOcr } from './model';
import { prepare, unmapBox, type Transform } from './prepare';

/** Words the engine is not sure about at all (below this) are not kept: they are almost always specks and edges read as letters. */
export const MIN_WORD_CONFIDENCE = 25;

/**
 * The result from what an engine gave: the words in the pixels of the original picture, lines joined and paragraphs separated by the space
 * between lines (more than a line and a half is a new paragraph).
 */
export function buildResult(raw: RawOcr, t: Transform, size: { w: number; h: number }, lang: string, rotation: OcrResult['rotation'], zone?: Box, now = Date.now()): OcrResult {
  const lines: OcrLine[] = [];
  for (const rl of raw.lines) {
    const words = rl.words
      .map((w) => ({ text: w.text.trim(), box: unmapBox(w.box, t), confidence: Math.max(0, Math.min(100, w.confidence)) }))
      .filter((w) => w.text && w.confidence >= MIN_WORD_CONFIDENCE);
    if (!words.length) continue;
    lines.push({ text: words.map((w) => w.text).join(' '), box: unionBoxes(words.map((w) => w.box))!, words });
  }
  // reading order: top to bottom, left to right within a line
  lines.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const all = lines.flatMap((l) => l.words);
  const confidence = all.length ? Math.round(all.reduce((s, w) => s + w.confidence, 0) / all.length) : 0;
  return { text: joinLines(lines), lines, lang, width: size.w, height: size.h, confidence, rotation, at: now, ...(zone ? { zone } : {}) };
}

/** Lines of text with a blank line where the gap above a line is more than a line and a half. */
export function joinLines(lines: readonly OcrLine[]): string {
  let out = '';
  lines.forEach((l, i) => {
    if (i > 0) {
      const prev = lines[i - 1]!;
      const gap = l.box.y - (prev.box.y + prev.box.h);
      out += gap > Math.max(prev.box.h, l.box.h) * 1.5 ? '\n\n' : '\n';
    }
    out += l.text;
  });
  return out;
}

export interface RecognizeOptions {
  lang: string;
  /** Only this part of the picture. */
  zone?: Box;
  /** Turn the picture before reading (quarter turns clockwise); `'auto'` tries the four and keeps the one read best. */
  turns?: 0 | 1 | 2 | 3 | 'auto';
  signal?: AbortSignal;
  /** Below this mean confidence, `turns: 'auto'` tries the other turns. */
  autoBelow?: number;
}

async function readOnce(engine: OcrEngine, p: Pixels, o: RecognizeOptions, turns: 0 | 1 | 2 | 3): Promise<OcrResult> {
  const { pixels, transform } = prepare(p, { zone: o.zone, turns });
  const raw = await engine.recognize(pixels, { lang: o.lang, signal: o.signal });
  return buildResult(raw, transform, { w: p.w, h: p.h }, o.lang, (turns * 90) as OcrResult['rotation'], o.zone);
}

/** Letters in words of three or more letters: what a page read the right way up has a lot of, and what a page read sideways or upside down hardly has. */
export const readableChars = (r: OcrResult): number => r.lines.reduce((n, l) => n + l.words.reduce((m, w) => m + (/^\p{L}{3,}[\p{L}\p{N}.,;:!?'’-]*$/u.test(w.text) ? w.text.length : 0), 0), 0);
const totalChars = (r: OcrResult): number => r.lines.reduce((n, l) => n + l.words.reduce((m, w) => m + w.text.length, 0), 0);

/** A reading is better when more of it is readable words, and the surer the engine is the better: a page read turned gives a lot of confident nonsense. */
const score = (r: OcrResult): number => readableChars(r) * (r.confidence / 100);

/** Does the reading look like text read the right way up? (Enough of it is words, and the engine is sure enough.) */
const looksRight = (r: OcrResult, below: number): boolean => r.confidence >= below && readableChars(r) >= 6 && readableChars(r) / Math.max(1, totalChars(r)) >= 0.6;

/** Read the text of a picture (raw pixels) with an engine. */
export async function recognize(engine: OcrEngine, p: Pixels, o: RecognizeOptions): Promise<OcrResult> {
  if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
  const first = o.turns === 'auto' || o.turns === undefined ? 0 : o.turns;
  let best = await readOnce(engine, p, o, first);
  if (o.turns === 'auto' && !looksRight(best, o.autoBelow ?? 60)) {
    for (const turns of [1, 3, 2] as const) {
      if (o.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      const r = await readOnce(engine, p, o, turns);
      if (score(r) > score(best) * 1.3 || (score(best) === 0 && score(r) > 0)) best = r;
    }
  }
  return best;
}

/** The text a PDF (or any source that already has it) gives, as a result without positions. */
export function textResult(text: string, lang = 'pdf', now = Date.now()): OcrResult {
  const clean = text.replace(/\r/g, '').trim();
  return { text: clean, lines: [], lang, width: 0, height: 0, confidence: 100, rotation: 0, at: now };
}
