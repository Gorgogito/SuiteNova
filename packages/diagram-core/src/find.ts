import type { Diagram } from './model';

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

export interface Hit {
  pageId: string;
  pageName: string;
  /** Where the text is: the text of a shape or of a connector, or the text read from a picture (OCR). */
  where: 'shape' | 'connector' | 'picture';
  /** The shape or connector. */
  id: string;
  /** The line of text that matched, for the list of results. */
  context: string;
}

const isWord = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}_]/u.test(c);

/** Does `text` have `query` in it? */
function has(text: string, query: string, o: FindOptions): boolean {
  const hay = o.matchCase ? text : text.toLocaleLowerCase();
  const q = o.matchCase ? query : query.toLocaleLowerCase();
  let i = hay.indexOf(q);
  while (i !== -1) {
    if (!o.wholeWord || (!isWord(hay[i - 1]) && !isWord(hay[i + q.length]))) return true;
    i = hay.indexOf(q, i + q.length);
  }
  return false;
}

/**
 * Every shape, connector and picture whose text has `query`, page by page (shapes back to front, then connectors). The text of a picture is the
 * one read from it (OCR); a picture is one result. Nothing is replaced: a diagram's text is found, and the text of a picture is not the diagram's.
 */
export function findInDiagram(d: Diagram, query: string, o: FindOptions = {}): Hit[] {
  const out: Hit[] = [];
  if (!query) return out;
  const line = (text: string) => text.split('\n').find((l) => has(l, query, o))?.trim() ?? '';
  for (const p of d.pages) {
    for (const s of p.shapes) {
      if (has(s.text, query, o)) out.push({ pageId: p.id, pageName: p.name, where: 'shape', id: s.id, context: line(s.text) });
      const ocr = (s.image?.ocr as { text?: unknown } | undefined)?.text;
      if (typeof ocr === 'string' && has(ocr, query, o)) out.push({ pageId: p.id, pageName: p.name, where: 'picture', id: s.id, context: line(ocr) });
    }
    for (const c of p.connectors) if (has(c.text, query, o)) out.push({ pageId: p.id, pageName: p.name, where: 'connector', id: c.id, context: line(c.text) });
  }
  return out;
}
