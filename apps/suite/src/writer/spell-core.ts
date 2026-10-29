import type { Node as PMNode } from 'prosemirror-model';

/** The part of nspell that the checker uses. */
export interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
  add(word: string): unknown;
}

export interface Misspelling {
  /** Position in the document (start of the word). */
  from: number;
  to: number;
  word: string;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

/** Words in a text with their offsets. Hyphenated compounds are checked part by part. */
export function findWords(text: string): { word: string; start: number; end: number }[] {
  const out: { word: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(WORD)) out.push({ word: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** Whether a word should not be checked at all: acronyms, parts of e-mail addresses, paths, identifiers with digits. */
export function skipWord(text: string, w: { word: string; start: number; end: number }): boolean {
  if (w.word.length < 2) return true;
  if (w.word === w.word.toUpperCase() && /\p{Lu}/u.test(w.word)) return true;
  const before = text[w.start - 1] ?? '';
  const after = text[w.end] ?? '';
  if (/[@/\\_\d#]/.test(before) || /[@/\\_\d]/.test(after)) return true;
  // internet addresses and file names: a dot joined to letters on both sides
  if ((before === '.' && /[\p{L}\d]/u.test(text[w.start - 2] ?? '')) || (after === '.' && /[\p{L}\d]/u.test(text[w.end + 1] ?? ''))) return true;
  return false;
}

interface Seg {
  pos: number;
  from: number;
  len: number;
  noCheck: boolean;
}

/** The text of a textblock as one string (non-text inline content breaks words) with the document position of each piece. */
function blockText(block: PMNode, blockPos: number): { text: string; segs: Seg[] } {
  let text = '';
  const segs: Seg[] = [];
  block.descendants((n, pos) => {
    if (n.isText) {
      const noCheck = n.marks.some((m) => m.type.name === 'link' || m.type.name === 'code');
      segs.push({ pos: blockPos + 1 + pos, from: text.length, len: n.text!.length, noCheck });
      text += n.text!;
    } else if (n.isLeaf || n.isInline || n.isBlock) {
      text += '\n';
      segs.push({ pos: blockPos + 1 + pos, from: text.length - 1, len: 1, noCheck: true });
    }
    return true;
  });
  return { text, segs };
}

const offsetToPos = (segs: Seg[], off: number): { pos: number; noCheck: boolean } => {
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (off >= s.from) return { pos: s.pos + (off - s.from), noCheck: s.noCheck };
  }
  return { pos: 0, noCheck: false };
};

export class SpellEngine {
  private known = new Map<string, boolean>();
  /** Words the person said to ignore (for this session) or added to the dictionary. */
  readonly ignored = new Set<string>();
  constructor(private speller: Speller, extra: Iterable<string> = []) {
    for (const w of extra) this.ignored.add(w.toLowerCase());
  }

  isCorrect(word: string): boolean {
    const w = word.replace(/’/g, "'");
    const hit = this.known.get(w);
    if (hit !== undefined) return hit;
    const lower = w.toLowerCase();
    let ok = this.ignored.has(lower) || this.speller.correct(w);
    // a capitalised word at the start of a sentence is also right in lower case, and nspell knows that; ALL CAPS are skipped before
    if (!ok && w !== lower) ok = this.speller.correct(lower) && /^\p{Lu}\p{Ll}+$/u.test(w);
    this.known.set(w, ok);
    return ok;
  }

  suggest(word: string): string[] {
    return this.speller.suggest(word.replace(/’/g, "'")).slice(0, 8);
  }

  ignore(word: string): void {
    this.ignored.add(word.toLowerCase());
    this.known.clear();
  }

  add(word: string): void {
    this.speller.add(word);
    this.ignore(word);
  }

  /** Misspelled words of one textblock. */
  inBlock(block: PMNode, blockPos: number): Misspelling[] {
    if (!block.isTextblock || !block.textContent.trim()) return [];
    const { text, segs } = blockText(block, blockPos);
    const out: Misspelling[] = [];
    for (const w of findWords(text)) {
      if (skipWord(text, w)) continue;
      const a = offsetToPos(segs, w.start);
      if (a.noCheck) continue;
      if (this.isCorrect(w.word)) continue;
      out.push({ from: a.pos, to: a.pos + (w.end - w.start), word: w.word });
    }
    return out;
  }

  /** Every misspelled word of a document, in order. */
  inDoc(doc: PMNode): Misspelling[] {
    const out: Misspelling[] = [];
    doc.descendants((n, pos) => {
      if (n.isTextblock) {
        out.push(...this.inBlock(n, pos));
        return false;
      }
      return true;
    });
    return out;
  }
}
