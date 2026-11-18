import { DEFAULT_REVIEW_OPTIONS, SpellEngine, findWords, skipWordWith, type ReviewOptions } from '@suitenova/spell-core';
import type { Node as PMNode } from 'prosemirror-model';

export type { Speller } from '@suitenova/spell-core';

export interface Misspelling {
  /** Posición en el documento (inicio de la palabra). */
  from: number;
  to: number;
  word: string;
}

export interface Seg {
  pos: number;
  from: number;
  len: number;
  noCheck: boolean;
  /** Etiqueta de idioma del texto (`es-MX`), o `null` si usa el del documento. */
  lang: string | null;
}

/** Lo que cada producto sabe decir de un trozo de texto: si no se revisa y en qué idioma está. */
export type MarkInfo = (n: PMNode) => { noCheck: boolean; lang: string | null };

/** Writer y Notes: enlaces, código y «no revisar» se omiten; la marca `lang` fija el idioma. */
export const writerMarkInfo: MarkInfo = (n) => {
  let noCheck = false;
  let lang: string | null = null;
  for (const m of n.marks) {
    const name = m.type.name;
    if (name === 'link' || name === 'code' || name === 'noproof') noCheck = true;
    else if (name === 'lang') lang = (m.attrs.value as string) || null;
  }
  return { noCheck, lang };
};

/** El texto de un bloque as one string (non-text inline content breaks words) with the document position of each piece. */
export function blockText(block: PMNode, blockPos: number, info: MarkInfo = writerMarkInfo): { text: string; segs: Seg[] } {
  let text = '';
  const segs: Seg[] = [];
  block.descendants((n, pos) => {
    if (n.isText) {
      const mi = info(n);
      segs.push({ pos: blockPos + 1 + pos, from: text.length, len: n.text!.length, noCheck: mi.noCheck, lang: mi.lang });
      text += n.text!;
    } else if (n.isLeaf || n.isInline || n.isBlock) {
      text += '\n';
      segs.push({ pos: blockPos + 1 + pos, from: text.length - 1, len: 1, noCheck: true, lang: null });
    }
    return true;
  });
  return { text, segs };
}

export const offsetToPos = (segs: Seg[], off: number): { pos: number; noCheck: boolean } => {
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (off >= s.from) return { pos: s.pos + (off - s.from), noCheck: s.noCheck };
  }
  return { pos: 0, noCheck: false };
};

/** El motor de `spell-core` con las palabras mal escritas de un documento de ProseMirror (Writer, Notes). */
export class DocSpellEngine extends SpellEngine {
  /** Palabras mal escritas de un bloque de texto. */
  inBlock(block: PMNode, blockPos: number, options: ReviewOptions = DEFAULT_REVIEW_OPTIONS): Misspelling[] {
    if (!block.isTextblock || !block.textContent.trim()) return [];
    const { text, segs } = blockText(block, blockPos);
    const out: Misspelling[] = [];
    for (const w of findWords(text)) {
      if (skipWordWith(text, w, options)) continue;
      const a = offsetToPos(segs, w.start);
      if (a.noCheck) continue;
      if (this.isCorrect(w.word)) continue;
      out.push({ from: a.pos, to: a.pos + (w.end - w.start), word: w.word });
    }
    return out;
  }

  /** Todas las palabras mal escritas de un documento, en orden. */
  inDoc(doc: PMNode, options: ReviewOptions = DEFAULT_REVIEW_OPTIONS): Misspelling[] {
    const out: Misspelling[] = [];
    doc.descendants((n, pos) => {
      if (n.isTextblock) {
        out.push(...this.inBlock(n, pos, options));
        return false;
      }
      return true;
    });
    return out;
  }
}
