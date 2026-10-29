import type { Node as PMNode } from 'prosemirror-model';
import { bibliographyEntry, bibliographyTitle, citationText, isNumeric, sortSources } from './citations';
import type { CiteStyle, Source } from './docx/model';
import { markTypes, nodeTypes } from './schema';

export interface RefContext {
  /** Page label shown for a document position, or null when it is not laid out. */
  pageOf(pos: number): string | null;
  /** Width of the text area in points (where the right tab of an entry goes). */
  textWidthPt: number;
  sources: Source[];
  citeStyle: CiteStyle;
  /** Label of a footnote/endnote by id (for NOTEREF). */
  noteLabel(id: string): string | null;
}

// ------------------------------------------------------------------------------------------------ headings and bookmarks

export interface HeadingEntry {
  /** Position of the paragraph. */
  pos: number;
  level: number;
  text: string;
  /** Name of the bookmark at its start, if there already is one. */
  bookmark: string | null;
}

const headingLevel = (p: PMNode): number => {
  const m = /^Heading(\d)$/.exec(p.attrs.style ?? '');
  return m ? Number(m[1]) : p.attrs.style === 'Title' ? 1 : 0;
};

/** Paragraph text without bookmarks, hidden index entries and the like. */
export function plainOf(p: PMNode): string {
  let out = '';
  p.descendants((n) => {
    if (n.isText) out += n.text;
    else if (n.type.name === 'field' && n.attrs.result !== null && n.attrs.kind !== 'xe') out += n.attrs.result;
    else if (n.type.name === 'math') out += n.attrs.tex;
    else if (n.type.name === 'footnote' || n.type.name === 'bookmark' || n.type.name === 'shape') return false;
    return true;
  });
  return out.replace(/\t/g, ' ').trim();
}

export function collectHeadings(doc: PMNode, minLevel = 1, maxLevel = 3): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'generated') return false;
    if (node.type.name === 'paragraph') {
      const lv = headingLevel(node);
      if (lv >= minLevel && lv <= maxLevel && node.textContent.trim()) {
        const first = node.firstChild;
        out.push({ pos, level: lv, text: plainOf(node), bookmark: first && first.type.name === 'bookmark' ? first.attrs.name : null });
      }
      return false;
    }
    return true;
  });
  return out;
}

export interface BookmarkInfo {
  name: string;
  /** Position of the bookmark node. */
  pos: number;
  /** Position of the paragraph that holds it. */
  para: number;
  text: string;
}

export function collectBookmarks(doc: PMNode): Map<string, BookmarkInfo> {
  const out = new Map<string, BookmarkInfo>();
  doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') {
      node.forEach((child, off) => {
        if (child.type.name === 'bookmark') out.set(child.attrs.name, { name: child.attrs.name, pos: pos + 1 + off, para: pos, text: plainOf(node) });
      });
      return false;
    }
    return true;
  });
  return out;
}

let counter = 0;
export const uniqueBookmark = (prefix: string, taken: Set<string>): string => {
  for (;;) {
    const name = `${prefix}${Date.now().toString().slice(-8)}${counter++}`;
    if (!taken.has(name)) return name;
  }
};

// ------------------------------------------------------------------------------------------------ table of contents

export interface TocOptions {
  /** Raw field instruction, kept for the .docx file. */
  instr: string;
  minLevel: number;
  maxLevel: number;
  pageNumbers: boolean;
  rightAlign: boolean;
  leader: 'dot' | 'hyphen' | 'underscore' | 'none';
  hyperlinks: boolean;
  title: string | null;
}

export const defaultTocOptions = (): TocOptions => ({ instr: ' TOC \\o "1-3" \\h \\z \\u ', minLevel: 1, maxLevel: 3, pageNumbers: true, rightAlign: true, leader: 'dot', hyperlinks: true, title: 'Contenido' });

export const tocInstr = (o: TocOptions): string => ` TOC \\o "${o.minLevel}-${o.maxLevel}"${o.hyperlinks ? ' \\h' : ''} \\z \\u${o.pageNumbers ? '' : ' \\n'}${!o.rightAlign ? ' \\p " "' : ''} `;

/** Read the options back from the field instruction of a generated block. */
export function tocOptionsOf(attrs: Record<string, unknown>): TocOptions {
  const o = { ...defaultTocOptions(), ...((attrs.opts ?? {}) as Partial<TocOptions>) };
  const instr = o.instr ?? '';
  const lv = /\\o\s+"(\d)-(\d)"/.exec(instr);
  if (lv) {
    o.minLevel = Number(lv[1]);
    o.maxLevel = Number(lv[2]);
  }
  o.hyperlinks = /\\h\b/.test(instr);
  o.pageNumbers = !/\\n\b/.test(instr);
  return o;
}

const link = (name: string) => markTypes.link!.create({ href: `#${name}` });
const para = (style: string, content: PMNode[], extra: Record<string, unknown> = {}) => nodeTypes.paragraph!.create({ style, ...extra }, content);
const text = (s: string, marks: ReturnType<typeof link>[] = []) => nodeTypes.paragraph!.schema.text(s, marks);

function entryParagraph(style: string, label: string, bookmark: string | null, page: string | null, o: Pick<TocOptions, 'pageNumbers' | 'rightAlign' | 'leader' | 'hyperlinks'>, textWidthPt: number): PMNode {
  const marks = o.hyperlinks && bookmark ? [link(bookmark)] : [];
  const kids: PMNode[] = [text(label || ' ', marks)];
  const extra: Record<string, unknown> = {};
  if (o.pageNumbers && page !== null) {
    if (o.rightAlign) {
      kids.push(text('\t', marks));
      extra.tabs = [{ pos: Math.round(textWidthPt * 10) / 10, kind: 'right', ...(o.leader !== 'none' ? { leader: o.leader } : {}) }];
    } else kids.push(text(' ', marks));
    kids.push(nodeTypes.field!.create({ kind: 'pageref', arg: bookmark, result: page }, null, marks));
  }
  return para(style, kids, extra);
}

/** The paragraphs of a table of contents for the headings of the document. */
export function buildTocContent(entries: (HeadingEntry & { bookmark: string })[], o: TocOptions, ctx: RefContext): PMNode[] {
  const out: PMNode[] = [];
  if (o.title) out.push(para('TOCHeading', [text(o.title)]));
  for (const e of entries) {
    out.push(entryParagraph(`TOC${Math.min(6, e.level - o.minLevel + 1)}`, e.text, e.bookmark, ctx.pageOf(e.pos), o, ctx.textWidthPt));
  }
  if (!entries.length) out.push(para('Normal', [text('No se encontraron títulos. Aplique los estilos Título 1 a 3 y actualice la tabla.')]));
  return out;
}

// ------------------------------------------------------------------------------------------------ captions

export interface CaptionEntry {
  pos: number;
  label: string;
  number: number;
  /** "Figura 1: texto" */
  text: string;
  bookmark: string | null;
}

/** Number each captioned item by label (SEQ fields), in document order. */
export function collectCaptions(doc: PMNode, label?: string): CaptionEntry[] {
  const out: CaptionEntry[] = [];
  const counters = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name === 'generated') return false;
    if (node.type.name === 'paragraph') {
      let bookmark: string | null = null;
      node.forEach((c) => {
        if (c.type.name === 'bookmark' && !bookmark) bookmark = c.attrs.name;
      });
      node.forEach((c) => {
        if (c.type.name === 'field' && c.attrs.kind === 'seq') {
          const l: string = c.attrs.arg ?? 'Figura';
          const n = (counters.get(l) ?? 0) + 1;
          counters.set(l, n);
          if (!label || l === label) out.push({ pos, label: l, number: n, text: plainOf(node), bookmark });
        }
      });
      return false;
    }
    return true;
  });
  return out;
}

export function captionLabels(doc: PMNode): string[] {
  const set = new Set<string>();
  for (const c of collectCaptions(doc)) set.add(c.label);
  return [...set];
}

export function buildTofContent(entries: (CaptionEntry & { bookmark: string })[], o: TocOptions, ctx: RefContext): PMNode[] {
  const out: PMNode[] = [];
  if (o.title) out.push(para('TOCHeading', [text(o.title)]));
  for (const e of entries) out.push(entryParagraph('TableofFigures', e.text, e.bookmark, ctx.pageOf(e.pos), o, ctx.textWidthPt));
  if (!entries.length) out.push(para('Normal', [text('No se encontraron elementos con ese título.')]));
  return out;
}

// ------------------------------------------------------------------------------------------------ field results

/** The text each cross-reference style field shows. Keys are the positions of the field nodes. */
export function computeFieldResults(doc: PMNode, ctx: RefContext): Map<number, string> {
  const out = new Map<number, string>();
  const bookmarks = collectBookmarks(doc);
  const counters = new Map<string, number>();
  const cited: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'field' && node.attrs.kind === 'citation') {
      for (const tag of String(node.attrs.arg ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean)) if (!cited.includes(tag)) cited.push(tag);
    }
    return true;
  });
  const bySource = new Map(ctx.sources.map((s) => [s.tag, s]));
  doc.descendants((node, pos) => {
    if (node.type.name !== 'field') return true;
    const a = node.attrs;
    switch (a.kind) {
      case 'seq': {
        const l: string = a.arg ?? 'Figura';
        const n = (counters.get(l) ?? 0) + 1;
        counters.set(l, n);
        out.set(pos, String(n));
        break;
      }
      case 'ref': {
        const b = bookmarks.get(a.arg);
        if (!b) {
          out.set(pos, 'Error: no se encuentra el origen de la referencia.');
          break;
        }
        const sw: string = a.switches ?? '';
        const para = doc.nodeAt(b.para);
        if (/\\n\b/.test(sw) && para) {
          // "label and number" of a caption: up to the end of the number
          let s = '';
          let done = false;
          para.forEach((c) => {
            if (done) return;
            if (c.isText) s += c.text;
            else if (c.type.name === 'field' && c.attrs.kind === 'seq') {
              s += String(seqAt(doc, b.para, c.attrs.arg ?? 'Figura'));
              done = true;
            }
          });
          out.set(pos, s.trim());
        } else if (/\\p\b/.test(sw)) out.set(pos, b.para < pos ? 'arriba' : 'abajo');
        else out.set(pos, b.text);
        break;
      }
      case 'pageref': {
        const b = bookmarks.get(a.arg);
        out.set(pos, (b && ctx.pageOf(b.pos)) ?? '?');
        break;
      }
      case 'noteref': {
        const b = bookmarks.get(a.arg);
        let label: string | null = null;
        if (b) {
          const next = doc.nodeAt(b.pos + 1);
          if (next && next.type.name === 'footnote') label = ctx.noteLabel(next.attrs.id);
        }
        out.set(pos, label ?? '?');
        break;
      }
      case 'citation': {
        const tags = String(a.arg ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
        const parts = tags.map((t) => {
          const s = bySource.get(t);
          if (!s) return '(Fuente desconocida)';
          const opts = parseCiteSwitches(a.switches);
          return citationText(s, ctx.citeStyle, opts, cited.indexOf(t) + 1);
        });
        // several sources in one pair of parentheses / brackets
        out.set(pos, parts.length > 1 ? (isNumeric(ctx.citeStyle) ? `[${tags.map((t) => cited.indexOf(t) + 1).join(', ')}]` : `(${parts.map((p) => p.replace(/^\(|\)$/g, '')).join('; ')})`) : (parts[0] ?? ''));
        break;
      }
      default:
    }
    return true;
  });
  return out;
}

function seqAt(doc: PMNode, paraPos: number, label: string): number {
  let n = 0;
  let found = 0;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === 'generated') return false;
    if (node.type.name === 'field' && node.attrs.kind === 'seq' && (node.attrs.arg ?? 'Figura') === label) {
      n++;
      if (pos > paraPos && pos < paraPos + (doc.nodeAt(paraPos)?.nodeSize ?? 0)) found = n;
    }
    return true;
  });
  return found;
}

function parseCiteSwitches(sw: string | null): { pages?: string; suppressAuthor?: boolean; suppressYear?: boolean } {
  if (!sw) return {};
  const pages = /\\p\s+"([^"]*)"/.exec(sw)?.[1];
  return { pages, suppressAuthor: /\\n\b/.test(sw), suppressYear: /\\y\b/.test(sw) };
}

// ------------------------------------------------------------------------------------------------ bibliography and index

/** The tags of the sources cited in the document, in order of first appearance. */
export function citedTags(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === 'field' && n.attrs.kind === 'citation') {
      for (const t of String(n.attrs.arg ?? '').split(/[;,]/).map((s) => s.trim()).filter(Boolean)) if (!out.includes(t)) out.push(t);
    }
    return true;
  });
  return out;
}

export function buildBibliographyContent(doc: PMNode, ctx: RefContext, all = false): PMNode[] {
  const cited = citedTags(doc);
  const used = ctx.sources.filter((s) => all || cited.includes(s.tag));
  const sorted = sortSources(used, ctx.citeStyle, cited);
  const out: PMNode[] = [para('TOCHeading', [text(bibliographyTitle(ctx.citeStyle))])];
  sorted.forEach((s, i) => {
    const hang = ctx.citeStyle === 'apa' || ctx.citeStyle === 'mla' || ctx.citeStyle === 'chicago';
    out.push(para('Bibliography', [text(bibliographyEntry(s, ctx.citeStyle, isNumeric(ctx.citeStyle) ? cited.indexOf(s.tag) + 1 || i + 1 : i + 1))], hang ? { indentLeft: 36, indentFirst: -36 } : {}));
  });
  if (!sorted.length) out.push(para('Normal', [text('No hay fuentes citadas en el documento.')]));
  return out;
}

export interface IndexEntry {
  /** "Main" or "Main:Sub". */
  entry: string;
  pos: number;
  switches: string | null;
}

export function collectIndexEntries(doc: PMNode): IndexEntry[] {
  const out: IndexEntry[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'generated') return false;
    if (node.type.name === 'field' && node.attrs.kind === 'xe' && node.attrs.arg) out.push({ entry: String(node.attrs.arg), pos, switches: node.attrs.switches ?? null });
    return true;
  });
  return out;
}

const compact = (pages: string[]): string => {
  const uniq = [...new Set(pages)];
  const nums = uniq.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n))) return uniq.join(', ');
  const out: string[] = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j++;
    out.push(j - i >= 2 ? `${nums[i]}–${nums[j]}` : nums.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return out.join(', ');
};

export function buildIndexContent(entries: IndexEntry[], ctx: RefContext): PMNode[] {
  type Node = { name: string; pages: string[]; subs: Map<string, Node>; see?: string };
  const root = new Map<string, Node>();
  for (const e of entries) {
    const [main, sub] = e.entry.split(':').map((s) => s.trim());
    if (!main) continue;
    let n = root.get(main);
    if (!n) root.set(main, (n = { name: main, pages: [], subs: new Map() }));
    const page = ctx.pageOf(e.pos);
    const see = /\\t\s+"([^"]*)"/.exec(e.switches ?? '')?.[1];
    if (sub) {
      let s = n.subs.get(sub);
      if (!s) n.subs.set(sub, (s = { name: sub, pages: [], subs: new Map() }));
      if (page) s.pages.push(page);
      if (see) s.see = see;
    } else {
      if (page) n.pages.push(page);
      if (see) n.see = see;
    }
  }
  const out: PMNode[] = [];
  const sorted = [...root.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  let letter = '';
  for (const n of sorted) {
    const l = n.name[0]!.toLocaleUpperCase('es');
    if (l !== letter) {
      letter = l;
      out.push(para('IndexHeading', [text(l)]));
    }
    out.push(para('Index1', [text(`${n.name}${n.see ? `, ${n.see}` : n.pages.length ? `, ${compact(n.pages)}` : ''}`)]));
    for (const s of [...n.subs.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
      out.push(para('Index1', [text(`${s.name}${s.see ? `, ${s.see}` : s.pages.length ? `, ${compact(s.pages)}` : ''}`)], { indentLeft: 14 }));
    }
  }
  if (!out.length) out.push(para('Normal', [text('No hay entradas de índice. Marque entradas y actualice el índice.')]));
  return out;
}
