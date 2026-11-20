import type { Box, OcrResult } from './model';

/**
 * How a reading is kept in a file. The words are written as short arrays (`[text, x, y, w, h, confidence]`) so a page of text does not weigh ten
 * times what the text does. What older versions kept (`{ text, lang, at }`, Nova Notes before there was a shared reading) is read as a reading
 * without positions.
 */
export interface StoredOcr {
  text: string;
  lang: string;
  at: number;
  /** Size of the picture and the lines as `[x, y, w, h, [word…]]`. */
  size?: [number, number];
  lines?: [number, number, number, number, [string, number, number, number, number, number][]][];
  confidence?: number;
  rotation?: number;
  zone?: [number, number, number, number];
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

export function packResult(r: OcrResult): StoredOcr {
  const out: StoredOcr = { text: r.text, lang: r.lang, at: r.at };
  if (r.lines.length) {
    out.size = [r.width, r.height];
    out.lines = r.lines.map((l) => [r1(l.box.x), r1(l.box.y), r1(l.box.w), r1(l.box.h), l.words.map((w) => [w.text, r1(w.box.x), r1(w.box.y), r1(w.box.w), r1(w.box.h), Math.round(w.confidence)])]);
  }
  if (r.confidence !== 100 || r.lines.length) out.confidence = r.confidence;
  if (r.rotation) out.rotation = r.rotation;
  if (r.zone) out.zone = [r1(r.zone.x), r1(r.zone.y), r1(r.zone.w), r1(r.zone.h)];
  return out;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const box = (x: unknown, y: unknown, w: unknown, h: unknown): Box | null => (num(x) && num(y) && num(w) && num(h) && w >= 0 && h >= 0 ? { x, y, w, h } : null);

/** A reading from what a file holds: anything damaged is dropped (a word, a line), and anything that is not a reading gives null. */
export function unpackResult(raw: unknown): OcrResult | null {
  const s = raw as Partial<StoredOcr> | null;
  if (!s || typeof s !== 'object' || typeof s.text !== 'string') return null;
  const lines: OcrResult['lines'] = [];
  for (const l of Array.isArray(s.lines) ? s.lines.slice(0, 20000) : []) {
    if (!Array.isArray(l)) continue;
    const lb = box(l[0], l[1], l[2], l[3]);
    const words = (Array.isArray(l[4]) ? l[4] : []).flatMap((w) => {
      const wb = Array.isArray(w) && typeof w[0] === 'string' ? box(w[1], w[2], w[3], w[4]) : null;
      return wb ? [{ text: w[0] as string, box: wb, confidence: num(w[5]) ? Math.max(0, Math.min(100, w[5]!)) : 0 }] : [];
    });
    if (lb && words.length) lines.push({ text: words.map((w) => w.text).join(' '), box: lb, words });
  }
  const zone = Array.isArray(s.zone) ? box(s.zone[0], s.zone[1], s.zone[2], s.zone[3]) : null;
  const rot = s.rotation === 90 || s.rotation === 180 || s.rotation === 270 ? s.rotation : 0;
  return {
    text: s.text,
    lines,
    lang: typeof s.lang === 'string' ? s.lang : '',
    width: Array.isArray(s.size) && num(s.size[0]) ? s.size[0] : 0,
    height: Array.isArray(s.size) && num(s.size[1]) ? s.size[1] : 0,
    confidence: num(s.confidence) ? Math.max(0, Math.min(100, s.confidence)) : 100,
    rotation: rot,
    at: num(s.at) ? s.at : 0,
    ...(zone ? { zone } : {}),
  };
}

/** Does the reading know where its words are? (A PDF's text, and what older versions kept, do not.) */
export const hasPositions = (r: OcrResult): boolean => r.lines.length > 0 && r.width > 0;
