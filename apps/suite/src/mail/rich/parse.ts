/** A document for the editor, from HTML or from plain text. */
import { encodeBase64 } from '@suitenova/mail-core';
import { createTable } from '../../writer/editing';
import { docFromText, writerSchema } from '@suitenova/writer-core';
import { DEFAULT_OPTIONS } from '@suitenova/table-core';
import { DOMParser as PMParser, Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import { sanitizeMailHtml } from './sanitize';

export { docFromText };

interface Picture {
  cid?: string;
  contentType: string;
  data: Uint8Array;
}

/** A table of a draft saved by Nova Mail 0.0.14 (`data-nova` holds its cells as written, formulas included). */
function oldTable(data: string): PMNode | null {
  try {
    const d = JSON.parse(data) as { rows?: unknown; styleId?: string | null; options?: object };
    if (!Array.isArray(d.rows) || !d.rows.length) return null;
    const cells = d.rows.map((r) => (Array.isArray(r) ? r.map(String) : []));
    const width = Math.max(1, ...cells.map((r) => r.length));
    const blank = createTable(cells.length, width, 560);
    const rows: PMNode[] = [];
    blank.forEach((row, _o, r) => {
      const out: PMNode[] = [];
      row.forEach((cell, _c, c) => {
        const text = cells[r]?.[c] ?? '';
        out.push(cell.type.create(cell.attrs, writerSchema.node('paragraph', null, text ? [writerSchema.text(text)] : [])));
      });
      rows.push(row.type.create(row.attrs, out));
    });
    return blank.type.create({ ...blank.attrs, tstyle: d.styleId ?? null, topts: d.styleId ? { ...DEFAULT_OPTIONS, ...d.options } : null }, rows);
  } catch {
    return null;
  }
}

/** HTML as a document. Only pictures that come with the message are kept: remote ones would be asked for while writing. */
export function htmlToDoc(html: string, pictures: Picture[] = []): PMNode {
  const { body } = sanitizeMailHtml(html);
  body.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const part = src.startsWith('cid:') ? pictures.find((p) => p.cid === src.slice(4)) : undefined;
    if (part) img.setAttribute('src', `data:${part.contentType};base64,${encodeBase64(part.data)}`);
    else if (!src.startsWith('data:image/')) img.remove();
  });
  const tables: PMNode[] = [];
  body.querySelectorAll('table[data-nova]').forEach((el) => {
    const made = oldTable(el.getAttribute('data-nova') ?? '');
    if (!made) return;
    const mark = el.ownerDocument.createElement('p');
    mark.textContent = `\u0002${tables.length}\u0002`;
    tables.push(made);
    el.replaceWith(mark);
  });
  const parsed = PMParser.fromSchema(writerSchema).parse(body);
  if (!tables.length) return parsed;
  const blocks: PMNode[] = [];
  parsed.forEach((node) => {
    const m = /^\u0002(\d+)\u0002$/.exec(node.textContent);
    blocks.push(m ? tables[Number(m[1])]! : node);
  });
  return parsed.type.create(parsed.attrs, blocks);
}

/** What is pasted keeps its formatting but not pictures that would be fetched from somewhere else. */
export function withoutRemotePictures(slice: Slice): Slice {
  const clean = (fragment: Fragment): Fragment => {
    const out: PMNode[] = [];
    fragment.forEach((node) => {
      if (node.type.name === 'image' && !String(node.attrs.src).startsWith('data:image/')) return;
      out.push(node.isText ? node : node.copy(clean(node.content)));
    });
    return Fragment.fromArray(out);
  };
  return new Slice(clean(slice.content), slice.openStart, slice.openEnd);
}
