import { expandReplacement, findInText, type Compiled, type Match } from '@suitenova/find-core';
import type { Node as PMNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type { FindFilters } from '../find';

/** The text of the document as find-core reads it: the paragraphs one after the other with «\n» between them, and the map back to positions. */
export interface DocText {
  text: string;
  /** `off`: where the paragraph starts in `text`; `pos`: where its content starts in the document; `len`: its length (one character for one position). */
  segs: { off: number; pos: number; len: number }[];
}

export function docText(doc: PMNode): DocText {
  const segs: DocText['segs'] = [];
  let text = '';
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const s = node.textBetween(0, node.content.size, undefined, (leaf) => (leaf.type.name === 'hard_break' ? '\v' : '￼'));
    if (segs.length) text += '\n';
    segs.push({ off: text.length, pos: pos + 1, len: s.length });
    text += s;
    return false;
  });
  return { text, segs };
}

/** The position in the document of an offset in `text` (a «\n» is the end of its paragraph). */
export function toPos(dt: DocText, off: number): number {
  let lo = 0;
  let hi = dt.segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dt.segs[mid]!.off <= off) lo = mid;
    else hi = mid - 1;
  }
  const s = dt.segs[lo];
  return s ? s.pos + Math.min(off - s.off, s.len) : 0;
}

export interface DocMatch {
  from: number;
  to: number;
  match: Match;
}

const MARKS: Record<string, string> = { bold: 'strong', italic: 'em', underline: 'underline' };

/** Every text node of the range has the mark (so «find bold» finds text that is all bold). */
function allMarked(doc: PMNode, from: number, to: number, mark: string): boolean {
  let any = false;
  let all = true;
  doc.nodesBetween(from, to, (n) => {
    if (n.isText) {
      any = true;
      if (!n.marks.some((m) => m.type.name === mark)) all = false;
    }
    return true;
  });
  return any && all;
}

/** The matches of the query in the document that also have the formatting asked for. */
export function findRanges(doc: PMNode, q: Compiled, filters: FindFilters = {}): DocMatch[] {
  const dt = docText(doc);
  const out: DocMatch[] = [];
  for (const m of findInText(q, dt.text)) {
    const from = toPos(dt, m.start);
    const to = toPos(dt, m.end);
    if (to <= from && m.text !== '') continue;
    let ok = true;
    for (const [id, v] of Object.entries(filters)) {
      if (MARKS[id]) ok &&= v !== true || allMarked(doc, from, to, MARKS[id]!);
      else if (id === 'style' && typeof v === 'string' && v) ok &&= ((doc.resolve(from).parent.attrs.style as string | null) || 'Normal') === v;
    }
    if (ok) out.push({ from, to, match: m });
  }
  return out;
}

/** Puts `template` (as `expandReplacement` reads it) in place of a match; a paragraph mark or a line break in it become one. */
export function replaceRange(tr: Transaction, q: Compiled, d: DocMatch, template: string): void {
  const text = expandReplacement(q, d.match, template).replace(/\f/g, '');
  const from = tr.mapping.map(d.from);
  const to = tr.mapping.map(d.to);
  if (!/[\n\v]/.test(text)) {
    if (text) tr.insertText(text, from, to);
    else tr.delete(from, to);
    return;
  }
  const hardBreak = tr.doc.type.schema.nodes.hard_break;
  tr.delete(from, to);
  let at = from;
  for (const part of text.split(/([\n\v])/)) {
    if (part === '\n') {
      tr.split(at);
      at += 2;
    } else if (part === '\v' && hardBreak) {
      tr.insert(at, hardBreak.create());
      at += 1;
    } else if (part) {
      tr.insertText(part, at);
      at += part.length;
    }
  }
}
