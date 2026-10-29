import type { Mark, Node as PMNode } from 'prosemirror-model';
import { isCfb, readCfb } from '../crypto/cfb';
import { emptyWriterDoc, makeSection, type ReadResult, type WriterDoc } from '../docx/model';
import { noteBodyOf } from '../notes';
import { defaultPage } from '../page';
import { defaultSection, newSectionId } from '../sections';
import { nodeTypes, writerSchema } from '../schema';
import { DEFAULT_DOC_DEFAULTS } from '../styles';

/**
 * Reader of binary Word documents (.doc, Word 97 to 2003). It recovers the text with its paragraphs, tables, character
 * formatting (bold, italic, underline, strike, size, colour, super/subscript), alignment, indents, spacing, heading
 * levels, hyperlinks, footnotes and the page size. Pictures, text boxes, headers and footers, list numbering and
 * styles are not imported (see docs/LIMITACIONES.md).
 */

const ICO = ['', '#000000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#ffff00', '#ffffff', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0'];

interface Sprm {
  op: number;
  data: Uint8Array;
}

function parseSprms(b: Uint8Array): Sprm[] {
  const out: Sprm[] = [];
  let i = 0;
  while (i + 2 <= b.length) {
    const op = b[i]! | (b[i + 1]! << 8);
    const spra = op >> 13;
    i += 2;
    let size: number;
    switch (spra) {
      case 0: case 1: size = 1; break;
      case 2: case 4: case 5: size = 2; break;
      case 3: size = 4; break;
      case 7: size = 3; break;
      default: size = (b[i] ?? 0) + 1; // 6: variable, first byte is the length
    }
    if (i + size > b.length) break;
    out.push({ op, data: b.subarray(i, i + size) });
    i += size;
  }
  return out;
}

const u16 = (d: Uint8Array, o = 0) => d[o]! | (d[o + 1]! << 8);
const s16 = (d: Uint8Array, o = 0) => (u16(d, o) << 16) >> 16;
const u32 = (d: Uint8Array, o = 0) => (d[o]! | (d[o + 1]! << 8) | (d[o + 2]! << 16) | (d[o + 3]! << 24)) >>> 0;

interface ChProps {
  b?: boolean;
  i?: boolean;
  strike?: boolean;
  ul?: boolean;
  caps?: boolean;
  size?: number;
  color?: string;
  hl?: string;
  vert?: number;
}
interface PaProps {
  istd: number;
  jc?: number;
  left?: number;
  right?: number;
  first?: number;
  before?: number;
  after?: number;
  keepNext?: boolean;
  pageBreak?: boolean;
  inTable?: boolean;
  ttp?: boolean;
  ilfo?: number;
  ilvl?: number;
}

const toggle = (d: Uint8Array): boolean | undefined => (d[0] === 0 ? false : d[0] === 1 ? true : undefined);

function chProps(sprms: Sprm[]): ChProps {
  const p: ChProps = {};
  for (const s of sprms) {
    switch (s.op) {
      case 0x0835: p.b = toggle(s.data) ?? p.b; break;
      case 0x0836: p.i = toggle(s.data) ?? p.i; break;
      case 0x0837: p.strike = toggle(s.data) ?? p.strike; break;
      case 0x083b: p.caps = toggle(s.data) ?? p.caps; break;
      case 0x2a3e: p.ul = s.data[0] !== 0; break;
      case 0x4a43: p.size = u16(s.data) / 2; break;
      case 0x2a42: if (ICO[s.data[0]!] ) p.color = ICO[s.data[0]!]; break;
      case 0x6870: p.color = '#' + [s.data[0]!, s.data[1]!, s.data[2]!].map((v) => v.toString(16).padStart(2, '0')).join(''); break;
      case 0x2a0c: if (ICO[s.data[0]!]) p.hl = ICO[s.data[0]!]; break;
      case 0x2a48: p.vert = s.data[0]; break;
    }
  }
  return p;
}

function paProps(istd: number, sprms: Sprm[]): PaProps {
  const p: PaProps = { istd };
  for (const s of sprms) {
    switch (s.op) {
      case 0x2461: case 0x2403: p.jc = s.data[0]; break;
      case 0x845e: case 0x840f: p.left = s16(s.data); break;
      case 0x845d: case 0x840e: p.right = s16(s.data); break;
      case 0x8460: case 0x8411: p.first = s16(s.data); break;
      case 0xa413: p.before = u16(s.data); break;
      case 0xa414: p.after = u16(s.data); break;
      case 0x2406: p.keepNext = s.data[0] === 1; break;
      case 0x2407: p.pageBreak = s.data[0] === 1; break;
      case 0x2416: p.inTable = s.data[0] === 1; break;
      case 0x2417: p.ttp = s.data[0] === 1; break;
      case 0x460b: p.ilfo = u16(s.data); break;
      case 0x260a: p.ilvl = s.data[0]; break;
    }
  }
  return p;
}

interface Run<T> {
  start: number;
  end: number;
  props: T;
}

/** Formatting runs of the FKP pages listed in a PlcfBte (file offsets, 512-byte pages in the WordDocument stream). */
function readFkps<T>(word: Uint8Array, table: Uint8Array, fc: number, lcb: number, parse: (page: Uint8Array, i: number, crun: number) => T): Run<T>[] {
  const out: Run<T>[] = [];
  if (!lcb) return out;
  const n = Math.floor((lcb - 4) / 8);
  for (let i = 0; i < n; i++) {
    const pn = u32(table, fc + (n + 1) * 4 + i * 4) & 0x3fffff;
    const page = word.subarray(pn * 512, pn * 512 + 512);
    if (page.length < 512) continue;
    const crun = page[511]!;
    for (let r = 0; r < crun; r++) {
      out.push({ start: u32(page, r * 4), end: u32(page, (r + 1) * 4), props: parse(page, r, crun) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function readDoc(bytes: Uint8Array): ReadResult {
  if (!isCfb(bytes)) throw new Error('El archivo no es un documento de Word binario (.doc).');
  const entries = readCfb(bytes);
  const word = entries.find((e) => e.path === 'WordDocument')?.data;
  if (!word) throw new Error('El archivo no contiene un documento de Word.');
  const wIdent = u16(word, 0);
  if (wIdent !== 0xa5ec) throw new Error('Este .doc es de una versión de Word anterior a 97, que Nova Writer no abre.');
  const flags = u16(word, 0x0a);
  if (flags & 0x0100) throw new Error('El documento .doc está protegido con contraseña. Ábralo en Word y guárdelo como .docx sin contraseña.');
  const tableName = flags & 0x0200 ? '1Table' : '0Table';
  const table = entries.find((e) => e.path === tableName)?.data;
  if (!table) throw new Error('Falta la tabla de datos del documento .doc.');
  const warnings: string[] = [];

  // FIB
  const csw = u16(word, 32);
  const lwBase = 34 + csw * 2 + 2;
  const ccpText = u32(word, lwBase + 12);
  const ccpFtn = u32(word, lwBase + 16);
  const cslw = u16(word, 34 + csw * 2);
  const fcBase = lwBase + cslw * 4 + 2;
  const pair = (idx: number): [number, number] => [u32(word, fcBase + idx * 8), u32(word, fcBase + idx * 8 + 4)];
  const [fcClx, lcbClx] = pair(33);
  const [fcChpx, lcbChpx] = pair(12);
  const [fcPapx, lcbPapx] = pair(13);
  const [fcSed, lcbSed] = pair(6);

  // piece table
  let p = fcClx;
  const clxEnd = fcClx + lcbClx;
  while (p < clxEnd && table[p] === 1) p += 3 + u16(table, p + 1); // Prc
  if (table[p] !== 2) throw new Error('No se encontró la tabla de fragmentos de texto del documento.');
  const plcLen = u32(table, p + 1);
  const n = Math.floor((plcLen - 4) / 12);
  const cps: number[] = [];
  for (let i = 0; i <= n; i++) cps.push(u32(table, p + 5 + i * 4));
  const total = cps[n]!;
  const chars: string[] = new Array(total).fill('');
  const fcs = new Uint32Array(total);
  const latin = new TextDecoder('windows-1252');
  for (let i = 0; i < n; i++) {
    const pcd = p + 5 + (n + 1) * 4 + i * 8;
    const raw = u32(table, pcd + 2);
    const compressed = (raw & 0x40000000) !== 0;
    const fc = raw & 0x3fffffff;
    const len = cps[i + 1]! - cps[i]!;
    if (compressed) {
      const off = fc >> 1;
      const text = latin.decode(word.subarray(off, off + len));
      for (let k = 0; k < len; k++) {
        chars[cps[i]! + k] = text[k] ?? '';
        fcs[cps[i]! + k] = off + k;
      }
    } else {
      for (let k = 0; k < len; k++) {
        chars[cps[i]! + k] = String.fromCharCode(u16(word, fc + k * 2));
        fcs[cps[i]! + k] = fc + k * 2;
      }
    }
  }

  // formatting
  const chRuns = readFkps(word, table, fcChpx, lcbChpx, (page, r) => {
    const off = page[(page[511]! + 1) * 4 + r]! * 2;
    if (!off) return {} as ChProps;
    const cb = page[off]!;
    return chProps(parseSprms(page.subarray(off + 1, off + 1 + cb)));
  });
  const paRuns = readFkps(word, table, fcPapx, lcbPapx, (page, r) => {
    const crun = page[511]!;
    const off = page[(crun + 1) * 4 + r * 13]! * 2;
    if (!off) return { istd: 0 } as PaProps;
    let cb = page[off]!;
    let start = off + 1;
    if (cb === 0) {
      cb = page[off + 1]! * 2;
      start = off + 2;
    } else cb = cb * 2 - 1;
    const grp = page.subarray(start, start + cb);
    return paProps(u16(grp, 0), parseSprms(grp.subarray(2)));
  });
  const findRun = <T,>(runs: Run<T>[], fc: number, hint: { i: number }): T | null => {
    let i = hint.i;
    if (i >= runs.length || runs[i]!.start > fc) i = 0;
    while (i < runs.length && runs[i]!.end <= fc) i++;
    hint.i = i;
    const r = runs[i];
    return r && r.start <= fc && fc < r.end ? r.props : null;
  };

  // page setup of the first section
  let page = { ...defaultPage() };
  try {
    if (lcbSed) {
      const sedFc = u32(table, fcSed + 8 + 2);
      if (sedFc !== 0xffffffff && sedFc + 2 < word.length) {
        const cb = u16(word, sedFc);
        for (const s of parseSprms(word.subarray(sedFc + 2, sedFc + 2 + cb))) {
          const tw = (v: number) => v / 20;
          switch (s.op) {
            case 0xb01f: page.width = tw(u16(s.data)); break;
            case 0xb020: page.height = tw(u16(s.data)); break;
            case 0xb021: page.marginLeft = tw(u16(s.data)); break;
            case 0xb022: page.marginRight = tw(u16(s.data)); break;
            case 0x9023: page.marginTop = tw(Math.abs(s16(s.data))); break;
            case 0x9024: page.marginBottom = tw(Math.abs(s16(s.data))); break;
          }
        }
      }
    }
  } catch {
    page = { ...defaultPage() };
  }

  // build the document
  const defaultSize = DEFAULT_DOC_DEFAULTS.fontSize;
  const marks = (c: ChProps | null, link: string | null): Mark[] => {
    const M = writerSchema.marks;
    const m: Mark[] = [];
    if (c?.b) m.push(M.strong!.create());
    if (c?.i) m.push(M.em!.create());
    if (c?.ul) m.push(M.underline!.create());
    if (c?.strike) m.push(M.strike!.create());
    if (c?.caps) m.push(M.caps!.create({ value: 'all' }));
    if (c?.vert === 1) m.push(M.superscript!.create());
    if (c?.vert === 2) m.push(M.subscript!.create());
    if (c?.color && c.color !== '#000000') m.push(M.color!.create({ value: c.color }));
    if (c?.hl) m.push(M.highlight!.create({ value: c.hl }));
    if (c?.size && c.size !== defaultSize) m.push(M.fontSize!.create({ value: c.size }));
    if (link) m.push(M.link!.create({ href: link }));
    return m;
  };

  const footnotes: PMNode[][] = [];
  // footnote texts follow the main text, each one a paragraph run starting with the auto-number mark
  const mainEnd = ccpText;
  const chHint = { i: 0 };
  const paHint = { i: 0 };

  interface Para {
    inl: PMNode[];
    pa: PaProps | null;
    cell: boolean;
    rowEnd: boolean;
    brk?: boolean;
  }
  const build = (from: number, to: number, notes: PMNode[][] | null): Para[] => {
    const paras: Para[] = [];
    let inl: PMNode[] = [];
    let buf = '';
    let bufMarks: Mark[] = [];
    let bufKey = '';
    let fieldDepth = 0;
    let instr = '';
    let inInstr = false;
    let link: string | null = null;
    let noteIdx = 0;
    let pendingBreak = false;
    const flush = () => {
      if (buf) inl.push(writerSchema.text(buf, bufMarks));
      buf = '';
    };
    const addText = (s: string, c: ChProps | null) => {
      const key = JSON.stringify(c) + (link ?? '');
      if (key !== bufKey) {
        flush();
        bufKey = key;
        bufMarks = marks(c, link);
      }
      buf += s;
    };
    for (let cp = from; cp < to; cp++) {
      const ch = chars[cp] ?? '';
      if (!ch) continue;
      const code = ch.charCodeAt(0);
      const c = findRun(chRuns, fcs[cp]!, chHint);
      if (code === 0x13) {
        fieldDepth++;
        inInstr = true;
        instr = '';
        continue;
      }
      if (code === 0x14) {
        inInstr = false;
        const m = /HYPERLINK\s+"([^"]+)"/i.exec(instr);
        link = m && /^(https?:|mailto:)/i.test(m[1]!) ? m[1]! : null;
        continue;
      }
      if (code === 0x15) {
        fieldDepth = Math.max(0, fieldDepth - 1);
        flush();
        link = null;
        inInstr = false;
        continue;
      }
      if (inInstr) {
        instr += ch;
        continue;
      }
      if (code === 0x0d || code === 0x07) {
        flush();
        const pa = findRun(paRuns, fcs[cp]!, paHint);
        const isCellMark = code === 0x07;
        const rowEnd = isCellMark && inl.length === 0 && (pa?.ttp ?? false);
        paras.push({ brk: pendingBreak, inl, pa, cell: isCellMark, rowEnd: rowEnd || (isCellMark && inl.length === 0 && (paras[paras.length - 1]?.cell ?? false) && !!pa?.inTable && !!pa?.ttp) });
        inl = [];
        pendingBreak = false;
        bufKey = '';
        continue;
      }
      if (code === 0x0c) {
        flush();
        pendingBreak = true;
        continue;
      }
      if (code === 0x0b) {
        flush();
        inl.push(nodeTypes.hard_break!.create());
        continue;
      }
      if (code === 0x09) {
        addText('\t', c);
        continue;
      }
      if (code === 0x1e) {
        addText('‑', c);
        continue;
      }
      if (code === 0x1f) continue;
      if (code === 0x02) {
        flush();
        if (notes && notes[noteIdx]) inl.push(nodeTypes.footnote!.create({ kind: 'footnote', id: `fn${Math.random().toString(36).slice(2, 8)}`, body: noteBodyOf(notes[noteIdx]!) }));
        noteIdx++;
        continue;
      }
      if (code === 0x01 || code === 0x08) {
        warnings.push('Las imágenes y objetos dibujados del .doc no se importan.');
        continue;
      }
      if (code < 0x20) continue;
      addText(ch, c);
    }
    flush();
    if (inl.length) paras.push({ inl, pa: null, cell: false, rowEnd: false });
    void fieldDepth;
    return paras;
  };

  const paraNode = (pr: Para): PMNode | null => {
    const pa = pr.pa;
    const attrs: Record<string, unknown> = {};
    if (pa) {
      if (pa.jc === 1) attrs.align = 'center';
      else if (pa.jc === 2) attrs.align = 'right';
      else if (pa.jc === 3) attrs.align = 'justify';
      if (pa.left) attrs.indentLeft = pa.left / 20;
      if (pa.right) attrs.indentRight = pa.right / 20;
      if (pa.first) attrs.indentFirst = pa.first / 20;
      if (pa.before !== undefined) attrs.spaceBefore = pa.before / 20;
      if (pa.after !== undefined) attrs.spaceAfter = pa.after / 20;
      if (pa.keepNext) attrs.keepNext = true;
      if (pa.pageBreak) attrs.pageBreakBefore = true;
      if (pa.istd >= 1 && pa.istd <= 6) attrs.style = `Heading${pa.istd}`;
    }
    // a form feed inside the paragraph is a page break: split around it
    if (pr.brk) attrs.pageBreakBefore = true;
    return nodeTypes.paragraph!.create(attrs, pr.inl);
  };

  // footnotes: paragraphs of the footnote story, one footnote per "\u0002 ... \r" group
  if (ccpFtn > 0) {
    const fparas = build(mainEnd, mainEnd + ccpFtn, null);
    for (const fp of fparas) {
      const inl = fp.inl.filter((n, i) => !(i === 0 && n.isText && /^\s*$/.test(n.text ?? '')));
      footnotes.push([nodeTypes.paragraph!.create(null, inl)]);
    }
  }
  const paras = build(0, mainEnd, footnotes);

  const blocks: PMNode[] = [];
  let rowCells: PMNode[] = [];
  let cellParas: PMNode[] = [];
  let rows: PMNode[] = [];
  let listItems: { lvl: number; para: PMNode }[] = [];
  const flushTable = () => {
    if (rows.length) blocks.push(nodeTypes.table!.create({ borders: true }, rows));
    rows = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    const build2 = (from: number, lvl: number): { node: PMNode; next: number } => {
      const items: PMNode[] = [];
      let i = from;
      while (i < listItems.length && listItems[i]!.lvl >= lvl) {
        const it = listItems[i]!;
        if (it.lvl === lvl) {
          const content: PMNode[] = [it.para];
          i++;
          if (i < listItems.length && listItems[i]!.lvl > lvl) {
            const sub = build2(i, lvl + 1);
            content.push(sub.node);
            i = sub.next;
          }
          items.push(nodeTypes.list_item!.create(null, content));
        } else {
          const sub = build2(i, it.lvl);
          items.push(nodeTypes.list_item!.create(null, [nodeTypes.paragraph!.create(), sub.node]));
          i = sub.next;
        }
      }
      return { node: nodeTypes.bullet_list!.create(null, items), next: i };
    };
    let i = 0;
    while (i < listItems.length) {
      const r = build2(i, 0);
      blocks.push(r.node);
      i = r.next;
    }
    listItems = [];
  };
  for (const pr of paras) {
    if (pr.cell) {
      if (pr.rowEnd) {
        if (rowCells.length) rows.push(nodeTypes.table_row!.create(null, rowCells));
        rowCells = [];
        continue;
      }
      cellParas.push(paraNode(pr)!);
      rowCells.push(nodeTypes.table_cell!.create({ colwidth: [100] }, cellParas));
      cellParas = [];
      continue;
    }
    if (rowCells.length || rows.length) {
      if (rowCells.length) rows.push(nodeTypes.table_row!.create(null, rowCells));
      rowCells = [];
      flushTable();
    }
    const node = paraNode(pr)!;
    if (pr.pa?.ilfo) {
      listItems.push({ lvl: Math.min(pr.pa.ilvl ?? 0, 8), para: node });
      continue;
    }
    flushList();
    blocks.push(node);
  }
  if (rowCells.length) rows.push(nodeTypes.table_row!.create(null, rowCells));
  flushTable();
  flushList();
  if (paras.some((x) => x.pa?.ilfo)) warnings.push('Las listas del .doc se importan como viñetas: la numeración original no se conserva.');
  warnings.push('Los encabezados, pies de página y estilos del .doc no se importan.');

  const doc = emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }) as WriterDoc;
  doc.body = nodeTypes.doc!.create(null, [makeSection(blocks.length ? blocks : [nodeTypes.paragraph!.create()], { ...defaultSection(), id: newSectionId(), page })]);
  return { doc, warnings: [...new Set(warnings)] };
}
