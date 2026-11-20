import { unionBoxes, type Box, type OcrResult } from './model';

export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface SearchOptions {
  caseSensitive?: boolean;
  /** Only whole words. */
  wholeWord?: boolean;
  /** Accents do not matter (on by default: a text read from a picture often loses them, or gains them). */
  ignoreAccents?: boolean;
}

export interface Match {
  /** The text that matched, as it was read. */
  text: string;
  /** The line it is in, in full. */
  line: string;
  /** Where it is in the picture: one box for each line it spans (a match is within a line, so one), or none when the text has no positions. */
  boxes: Box[];
  /** Offset of the match in `result.text`. */
  index: number;
}

const isWord = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_]/u.test(c);

/** Search a reading for a text. The boxes are those of the words the match covers (the whole words, even if the match is part of one). */
export function searchResult(result: OcrResult, query: string, o: SearchOptions = {}): Match[] {
  const q = query.trim();
  if (!q) return [];
  const norm = (s: string): string => {
    const t = o.ignoreAccents === false ? s : s.normalize('NFD').replace(/\p{M}/gu, '');
    return o.caseSensitive ? t : t.toLowerCase();
  };
  const needle = norm(q);
  const out: Match[] = [];
  let lineStart = 0;
  const lines = result.text.split('\n');
  // the positions are by line, so lines of the text are paired with the lines of the reading (blank ones are paragraph breaks)
  let li = 0;
  for (const text of lines) {
    if (text === '') {
      lineStart += 1;
      continue;
    }
    const hay = norm(text);
    // `norm` can change the length of a text (decomposed letters); then the offsets are not reliable and the match is taken on the original text
    const comparable = hay.length === text.length;
    const h = comparable ? hay : text.toLowerCase();
    const nd = comparable ? needle : q.toLowerCase();
    const line = result.lines[li++];
    for (let at = h.indexOf(nd); at >= 0; at = h.indexOf(nd, at + Math.max(1, nd.length))) {
      const end = at + nd.length;
      if (o.wholeWord && (isWord(text[at - 1]) || isWord(text[end]))) continue;
      out.push({ text: text.slice(at, end), line: text, boxes: line ? boxesOf(line.words.map((w) => w.text), line.words.map((w) => w.box), at, end) : [], index: lineStart + at });
    }
    lineStart += text.length + 1;
  }
  return out;
}

/** The union of the boxes of the words that overlap the character range [from, to) of a line made by joining the words with spaces. */
function boxesOf(words: string[], boxes: Box[], from: number, to: number): Box[] {
  const covered: Box[] = [];
  let pos = 0;
  words.forEach((w, i) => {
    const a = pos;
    const b = pos + w.length;
    if (a < to && b > from) covered.push(boxes[i]!);
    pos = b + 1;
  });
  const u = unionBoxes(covered);
  return u ? [u] : [];
}

/** The readings (by an id the product gives) that contain the text, each with its matches. */
export function searchMany(results: ReadonlyMap<string, OcrResult>, query: string, o: SearchOptions = {}): { id: string; matches: Match[] }[] {
  const out: { id: string; matches: Match[] }[] = [];
  for (const [id, r] of results) {
    const matches = searchResult(r, query, o);
    if (matches.length) out.push({ id, matches });
  }
  return out;
}
