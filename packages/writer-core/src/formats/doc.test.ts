import { describe, expect, it } from 'vitest';
import { plainText, readDoc, writeCfb } from '../index';

/** A minimal Word 97 file built from the MS-DOC layout: FIB, one ANSI piece, one CHPX page and one PAPX page. */
function buildDoc(opts: { text: string; chpx?: { from: number; to: number; sprms: number[] }[]; papx?: { to: number; istd?: number; sprms: number[] }[]; flags?: number; wIdent?: number }): Uint8Array {
  const word = new Uint8Array(0x1400);
  const dv = new DataView(word.buffer);
  const TEXT_AT = 0x800;
  const latin = new Uint8Array([...opts.text].map((c) => (c.charCodeAt(0) > 255 ? 63 : c.charCodeAt(0))));
  word.set(latin, TEXT_AT);
  const len = latin.length;
  dv.setUint16(0, opts.wIdent ?? 0xa5ec, true);
  dv.setUint16(0x0a, opts.flags ?? 0x0200, true);
  dv.setUint16(32, 14, true);
  dv.setUint16(62, 22, true);
  dv.setUint32(76, len, true); // ccpText
  dv.setUint16(152, 93, true);
  const pair = (idx: number, fc: number, lcb: number) => {
    dv.setUint32(154 + idx * 8, fc, true);
    dv.setUint32(154 + idx * 8 + 4, lcb, true);
  };
  // table stream
  const table: number[] = [];
  const push32 = (v: number) => table.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  const clxAt = table.length;
  table.push(2);
  push32(4 * 2 + 8);
  push32(0);
  push32(len);
  table.push(0, 0);
  push32((TEXT_AT * 2) | 0x40000000);
  table.push(0, 0);
  pair(33, clxAt, table.length - clxAt);
  // CHPX page (page number 8 = offset 0x1000)
  const chpx = opts.chpx ?? [];
  if (chpx.length) {
    const page = word.subarray(0x1000, 0x1200);
    const pv = new DataView(page.buffer, page.byteOffset, 512);
    page[511] = chpx.length;
    let off = 400;
    chpx.forEach((c, i) => {
      pv.setUint32(i * 4, TEXT_AT + c.from, true);
      pv.setUint32((i + 1) * 4, TEXT_AT + c.to, true);
      page[(chpx.length + 1) * 4 + i] = off / 2;
      page[off] = c.sprms.length;
      page.set(c.sprms, off + 1);
      off += 2 * Math.ceil((c.sprms.length + 1) / 2);
    });
    const fcChpx = table.length;
    push32(TEXT_AT);
    push32(TEXT_AT + len);
    push32(8);
    pair(12, fcChpx, 12);
  }
  // PAPX page (page 9 = 0x1200)
  const papx = opts.papx ?? [];
  if (papx.length) {
    const page = word.subarray(0x1200, 0x1400);
    const pv = new DataView(page.buffer, page.byteOffset, 512);
    page[511] = papx.length;
    let off = 300;
    let start = 0;
    papx.forEach((c, i) => {
      pv.setUint32(i * 4, TEXT_AT + start, true);
      pv.setUint32((i + 1) * 4, TEXT_AT + c.to, true);
      start = c.to;
      page[(papx.length + 1) * 4 + i * 13] = off / 2;
      const grp = [(c.istd ?? 0) & 255, ((c.istd ?? 0) >> 8) & 255, ...c.sprms];
      const cb = Math.ceil((grp.length + 1) / 2);
      page[off] = cb;
      page.set(grp, off + 1);
      off += cb * 2;
    });
    const fcPapx = table.length;
    push32(TEXT_AT);
    push32(TEXT_AT + len);
    push32(9);
    pair(13, fcPapx, 12);
  }
  return writeCfb([
    { path: 'WordDocument', data: word },
    { path: '1Table', data: new Uint8Array(table) },
  ]);
}

const sp16 = (op: number, v: number) => [op & 255, op >> 8, v & 255, (v >> 8) & 255];
const sp8 = (op: number, v: number) => [op & 255, op >> 8, v];

describe('.doc reader', () => {
  it('reads paragraphs and accented text', () => {
    const { doc } = readDoc(buildDoc({ text: 'Primera línea\rSegunda año\r' }));
    expect(plainText(doc.body)).toBe('Primera línea\nSegunda año');
  });

  it('applies character formatting from the CHPX runs', () => {
    const text = 'Hola negrita y cursiva fin\r';
    const { doc } = readDoc(buildDoc({ text, chpx: [{ from: 5, to: 12, sprms: sp8(0x0835, 1) }, { from: 15, to: 22, sprms: [...sp8(0x0836, 1), ...sp16(0x4a43, 28)] }] }));
    const marks = (w: string) => {
      let m: string[] = [];
      let size: number | null = null;
      doc.body.descendants((n: any) => {
        if (n.isText && n.text.includes(w)) {
          m = n.marks.map((x: any) => x.type.name);
          size = n.marks.find((x: any) => x.type.name === 'fontSize')?.attrs.value ?? null;
        }
      });
      return { m, size };
    };
    expect(marks('negrita').m).toContain('strong');
    expect(marks('cursiva').m).toContain('em');
    expect(marks('cursiva').size).toBe(14);
    expect(marks('Hola').m).toEqual([]);
  });

  it('applies paragraph formatting: alignment, indent and heading style', () => {
    const { doc } = readDoc(buildDoc({ text: 'Título\rCuerpo centrado\r', papx: [{ to: 7, istd: 1, sprms: [] }, { to: 23, sprms: [...sp8(0x2461, 1), ...sp16(0x845e, 720)] }] }));
    const paras: any[] = [];
    doc.body.descendants((n: any) => {
      if (n.type.name === 'paragraph') paras.push(n);
    });
    expect(paras[0].attrs.style).toBe('Heading1');
    expect(paras[1].attrs.align).toBe('center');
    expect(paras[1].attrs.indentLeft).toBe(36);
  });

  it('reads tables (cell marks) and page breaks', () => {
    const { doc } = readDoc(buildDoc({ text: 'A\x07B\x07\x07antes\r\x0cdespués\r', papx: [{ to: 4, sprms: [...sp8(0x2416, 1)] }, { to: 5, sprms: [...sp8(0x2416, 1), ...sp8(0x2417, 1)] }] }));
    let tables = 0;
    let cells = 0;
    let breaks = 0;
    doc.body.descendants((n: any) => {
      if (n.type.name === 'table') tables++;
      if (n.type.name === 'table_cell') cells++;
      if (n.type.name === 'paragraph' && n.attrs.pageBreakBefore) breaks++;
    });
    expect(tables).toBe(1);
    expect(cells).toBe(2);
    expect(breaks).toBe(1);
    expect(plainText(doc.body)).toContain('después');
  });

  it('keeps the result of fields and turns HYPERLINK into a link', () => {
    const text = 'Ver \x13 HYPERLINK "https://example.org/" \x14ejemplo\x15 y \x13 PAGE \x14' + '3\x15.\r';
    const { doc } = readDoc(buildDoc({ text }));
    let link: string | null = null;
    doc.body.descendants((n: any) => {
      if (n.isText && n.text === 'ejemplo') link = n.marks.find((m: any) => m.type.name === 'link')?.attrs.href ?? null;
    });
    expect(link).toBe('https://example.org/');
    expect(plainText(doc.body)).toBe('Ver ejemplo y 3.');
  });

  it('refuses encrypted and old files with a clear message', () => {
    expect(() => readDoc(buildDoc({ text: 'x\r', flags: 0x0300 }))).toThrow(/contraseña/);
    expect(() => readDoc(buildDoc({ text: 'x\r', wIdent: 0xa5dc }))).toThrow(/anterior a 97/);
    expect(() => readDoc(new Uint8Array(1000))).toThrow();
  });
});
