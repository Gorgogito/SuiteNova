import { SpellEngine, findWords, skipWord } from '@suitenova/spell-core';
import type { Node as PMNode } from 'prosemirror-model';

export type { Speller } from '@suitenova/spell-core';

export interface Misspelling {
  /** Posición en el documento (inicio de la palabra). */
  from: number;
  to: number;
  word: string;
}

interface Seg {
  pos: number;
  from: number;
  len: number;
  noCheck: boolean;
}

/** El texto de un bloque as one string (non-text inline content breaks words) with the document position of each piece. */
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

/** El motor de `spell-core` con las palabras mal escritas de un documento de ProseMirror (Writer, Notes). */
export class DocSpellEngine extends SpellEngine {
  /** Palabras mal escritas de un bloque de texto. */
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

  /** Todas las palabras mal escritas de un documento, en orden. */
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
