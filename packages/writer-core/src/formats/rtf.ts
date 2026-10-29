import type { Mark, Node as PMNode } from 'prosemirror-model';
import { newSectionId, defaultSection, type SectionProps } from '../sections';
import { makeSection, emptyWriterDoc, type ReadResult, type WriteResult, type WriterDoc } from '../docx/model';
import { noteBodyOf } from '../notes';
import { defaultPage } from '../page';
import { nodeTypes, writerSchema, type ListFormat } from '../schema';
import { DEFAULT_DOC_DEFAULTS } from '../styles';
import { toBase64 } from '../crypto/sha512';

// ================================================================================================ reading

interface Fmt {
  b: boolean;
  i: boolean;
  ul: boolean;
  strike: boolean;
  vert: 0 | 1 | 2;
  fs: number | null;
  f: number | null;
  cf: number | null;
  hl: number | null;
  caps: boolean;
}
const plainFmt = (): Fmt => ({ b: false, i: false, ul: false, strike: false, vert: 0, fs: null, f: null, cf: null, hl: null, caps: false });

interface ParaProps {
  align: string | null;
  li: number;
  ri: number;
  fi: number;
  sb: number | null;
  sa: number | null;
  sl: number | null;
  style: number | null;
  keepNext: boolean;
  pageBreakBefore: boolean;
  intbl: boolean;
  ls: number | null;
  ilvl: number;
}
const plainPara = (): ParaProps => ({ align: null, li: 0, ri: 0, fi: 0, sb: null, sa: null, sl: null, style: null, keepNext: false, pageBreakBefore: false, intbl: false, ls: null, ilvl: 0 });

interface Builder {
  blocks: PMNode[];
  inl: PMNode[];
  pp: ParaProps;
  rowCells: PMNode[];
  cell: PMNode[];
  cellx: number[];
  rows: PMNode[];
  list: { ls: number; ilvl: number; para: PMNode }[];
}
const newBuilder = (): Builder => ({ blocks: [], inl: [], pp: plainPara(), rowCells: [], cell: [], cellx: [], rows: [], list: [] });

interface Group {
  fmt: Fmt;
  dest: string;
  uc: number;
  skip: number;
  onClose?: () => void;
  builder?: Builder;
  text?: string;
}

const STYLE_NAMES: Record<string, string> = { title: 'Title', subtitle: 'Subtitle', quote: 'Quote', caption: 'Caption', 'heading 1': 'Heading1', 'heading 2': 'Heading2', 'heading 3': 'Heading3', 'heading 4': 'Heading4', 'heading 5': 'Heading5', 'heading 6': 'Heading6' };
const NFC: Record<number, ListFormat> = { 0: 'decimal', 1: 'upperRoman', 2: 'lowerRoman', 3: 'upperLetter', 4: 'lowerLetter' };
const SPECIAL: Record<string, string> = { emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', enspace: ' ', emspace: ' ', tab: '\t' };
const SKIP_DESTS = new Set(['pn', 'pntext', 'pntxta', 'pntxtb', 'generator', 'nonshppict', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'rsidtbl', 'xmlnstbl', 'listtext', 'leveltext', 'levelnumbers', 'bkmkstart', 'bkmkend', 'shpinst', 'private', 'revtbl', 'userprops', 'fchars', 'lchars', 'listname', 'pgdsctbl', 'template', 'stylesheet_skip']);

const decoderFor = (cp: number): TextDecoder => {
  for (const label of [`windows-${cp}`, `cp${cp}`, `ibm${cp}`, String(cp)]) {
    try {
      return new TextDecoder(label);
    } catch {
      /* try next */
    }
  }
  return new TextDecoder('windows-1252');
};

export function readRtf(input: Uint8Array | string): ReadResult {
  const s = typeof input === 'string' ? input : new TextDecoder('latin1').decode(input);
  const warnings: string[] = [];
  if (!/^\s*\{\\rtf/.test(s)) throw new Error('El archivo no es un documento RTF.');
  const doc = emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS });
  const fonts = new Map<number, string>();
  const colors: (string | null)[] = [];
  const styleNames = new Map<number, string>();
  const lists = new Map<number, ListFormat | 'bullet'>();
  const overrides = new Map<number, number>();
  const parts: Record<string, PMNode> = {};
  let defaultFont = 0;
  let cp = 1252;
  let dec = decoderFor(cp);
  let docPage = defaultPage();
  docPage = { ...docPage, width: 12240 / 20, height: 15840 / 20, marginLeft: 90, marginRight: 90, marginTop: 72, marginBottom: 72 };
  let secPage: Partial<typeof docPage> = {};
  let landscape = false;
  let cols = { count: 1, space: 36, sep: false };
  let sectionStart: SectionProps['start'] = 'nextPage';
  const sections: { blocks: PMNode[]; props: SectionProps }[] = [];
  const hf: { header: { default: string | null; first: string | null; even: string | null }; footer: { default: string | null; first: string | null; even: string | null } } = { header: { default: null, first: null, even: null }, footer: { default: null, first: null, even: null } };
  let titlePg = false;

  const main = newBuilder();
  let b = main;
  const stack: Group[] = [];
  let g: Group = { fmt: plainFmt(), dest: 'body', uc: 1, skip: 0 };
  let hexBytes: number[] = [];
  let fontIdx = 0;
  let color = { r: 0, g: 0, b: 0, set: false };
  let styleIdx: number | null = null;
  let curList: { id: number; levels: (ListFormat | 'bullet')[] } | null = null;
  let curLevel = -1;
  let ovList = 0;
  let ovLs = 0;
  let fieldInstr = '';
  let fieldStart = 0;
  let fieldBuilder: Builder | null = null;
  let picture: { kind: string; w: number; h: number; hex: string } | null = null;

  const defaultSize = DEFAULT_DOC_DEFAULTS.fontSize;
  const marksOf = (f: Fmt): Mark[] => {
    const m: Mark[] = [];
    const M = writerSchema.marks;
    if (f.b) m.push(M.strong!.create());
    if (f.i) m.push(M.em!.create());
    if (f.ul) m.push(M.underline!.create());
    if (f.strike) m.push(M.strike!.create());
    if (f.vert === 1) m.push(M.superscript!.create());
    if (f.vert === 2) m.push(M.subscript!.create());
    if (f.caps) m.push(M.caps!.create({ value: 'all' }));
    if (f.cf !== null && colors[f.cf]) m.push(M.color!.create({ value: colors[f.cf] }));
    if (f.hl !== null && colors[f.hl]) m.push(M.highlight!.create({ value: colors[f.hl] }));
    if (f.f !== null && f.f !== defaultFont && fonts.get(f.f)) m.push(M.fontFamily!.create({ value: fonts.get(f.f) }));
    if (f.fs !== null && f.fs / 2 !== defaultSize) m.push(M.fontSize!.create({ value: f.fs / 2 }));
    return m;
  };

  const flushHex = () => {
    if (!hexBytes.length) return;
    const text = dec.decode(new Uint8Array(hexBytes));
    hexBytes = [];
    emit(text);
  };
  const emit = (text: string) => {
    if (!text) return;
    const d = g.dest;
    if (d === 'fonttbl') {
      for (const ch of text) {
        if (ch === ';') {
          fonts.set(fontIdx, (g.text ?? '').trim());
          g.text = '';
        } else g.text = (g.text ?? '') + ch;
      }
      return;
    }
    if (d === 'colortbl') {
      for (const ch of text) if (ch === ';') commitColor();
      return;
    }
    if (d === 'stylesheet') {
      for (const ch of text) {
        if (ch === ';') {
          if (styleIdx !== null) styleNames.set(styleIdx, (g.text ?? '').trim().toLowerCase());
          g.text = '';
          styleIdx = null;
        } else g.text = (g.text ?? '') + ch;
      }
      return;
    }
    if (d === 'title' || d === 'author') {
      g.text = (g.text ?? '') + text;
      return;
    }
    if (d === 'fldinst') {
      fieldInstr += text;
      return;
    }
    if (d === 'pict') {
      if (picture) picture.hex += text.replace(/[^0-9a-fA-F]/g, '');
      return;
    }
    if (d !== 'body') return;
    b.inl.push(writerSchema.text(text, marksOf(g.fmt)));
  };
  const commitColor = () => {
    colors.push(color.set ? `#${[color.r, color.g, color.b].map((v) => v.toString(16).padStart(2, '0')).join('')}` : null);
    color = { r: 0, g: 0, b: 0, set: false };
  };

  const paraNode = (): PMNode => {
    const p = b.pp;
    const attrs: Record<string, unknown> = {};
    if (p.align) attrs.align = p.align;
    attrs.indentLeft = p.li / 20;
    attrs.indentRight = p.ri / 20;
    attrs.indentFirst = p.fi / 20;
    if (p.sb !== null) attrs.spaceBefore = p.sb / 20;
    if (p.sa !== null) attrs.spaceAfter = p.sa / 20;
    if (p.sl !== null && p.sl > 0) attrs.lineHeight = Math.round((p.sl / 240) * 100) / 100;
    if (p.style !== null) {
      const id = STYLE_NAMES[styleNames.get(p.style) ?? ''];
      if (id) attrs.style = id;
    }
    if (p.keepNext) attrs.keepNext = true;
    if (p.pageBreakBefore) attrs.pageBreakBefore = true;
    const inl = b.inl;
    b.inl = [];
    return nodeTypes.paragraph!.create(attrs, inl);
  };
  const flushList = () => {
    if (!b.list.length) return;
    const items = b.list;
    b.list = [];
    const kindOf = (ls: number) => lists.get(overrides.get(ls) ?? ls) ?? 'bullet';
    const build = (from: number, level: number): { node: PMNode; next: number } => {
      const first = items[from]!;
      const kind = kindOf(first.ls);
      const li: PMNode[] = [];
      let i = from;
      while (i < items.length && items[i]!.ilvl >= level && (items[i]!.ilvl > level || items[i]!.ls === first.ls)) {
        const it = items[i]!;
        if (it.ilvl === level) {
          const content: PMNode[] = [it.para];
          i++;
          if (i < items.length && items[i]!.ilvl > level) {
            const sub = build(i, level + 1);
            content.push(sub.node);
            i = sub.next;
          }
          li.push(nodeTypes.list_item!.create(null, content));
        } else {
          const sub = build(i, it.ilvl);
          li.push(nodeTypes.list_item!.create(null, [nodeTypes.paragraph!.create(), sub.node]));
          i = sub.next;
        }
      }
      const node = kind === 'bullet' ? nodeTypes.bullet_list!.create(null, li) : nodeTypes.ordered_list!.create({ format: kind, start: 1 }, li);
      return { node, next: i };
    };
    let i = 0;
    while (i < items.length) {
      const r = build(i, Math.min(items[i]!.ilvl, 0));
      b.blocks.push(r.node);
      i = r.next;
    }
  };
  const flushTable = () => {
    if (b.rows.length) {
      b.blocks.push(nodeTypes.table!.create({ borders: true }, b.rows));
      b.rows = [];
    }
  };
  const endPara = () => {
    const p = paraNode();
    if (b.pp.intbl) {
      b.cell.push(p);
      return;
    }
    flushTable();
    if (b.pp.ls !== null) {
      b.list.push({ ls: b.pp.ls, ilvl: b.pp.ilvl, para: p });
      return;
    }
    flushList();
    b.blocks.push(p);
  };
  const endCell = () => {
    if (b.inl.length || !b.cell.length) b.cell.push(paraNode());
    const i = b.rowCells.length;
    const w = b.cellx[i] !== undefined ? Math.max(20, Math.round(((b.cellx[i]! - (b.cellx[i - 1] ?? 0)) / 20) * (96 / 72))) : 100;
    b.rowCells.push(nodeTypes.table_cell!.create({ colwidth: [w] }, b.cell));
    b.cell = [];
  };
  const endRow = () => {
    if (b.rowCells.length) b.rows.push(nodeTypes.table_row!.create(null, b.rowCells));
    b.rowCells = [];
    b.cellx = [];
  };
  const finishBuilder = (x: Builder): PMNode[] => {
    const save = b;
    b = x;
    if (x.inl.length) endPara();
    flushTable();
    flushList();
    b = save;
    return x.blocks.length ? x.blocks : [nodeTypes.paragraph!.create()];
  };
  const pageProps = (): SectionProps['page'] => {
    const p = { ...docPage, ...secPage };
    return landscape && p.width < p.height ? { ...p, width: p.height, height: p.width } : p;
  };
  const endSection = (last: boolean) => {
    const blocks = finishBuilder(main);
    main.blocks = [];
    const props: SectionProps = { ...defaultSection(), id: newSectionId(), start: sections.length ? sectionStart : 'nextPage', page: pageProps(), cols: { count: cols.count, space: cols.space, sep: cols.sep, widths: null }, titlePg, header: { ...hf.header }, footer: { ...hf.footer } };
    sections.push({ blocks, props });
    void last;
  };

  const startHF = (kind: 'header' | 'footer', variant: 'default' | 'first' | 'even') => {
    const nb = newBuilder();
    g.builder = nb;
    const save = b;
    b = nb;
    g.dest = 'body';
    g.onClose = () => {
      const blocks = finishBuilder(nb);
      b = save;
      const id = `${kind}-${variant}-${newSectionId()}`;
      parts[id] = nodeTypes.doc!.create(null, blocks);
      hf[kind][variant] = id;
    };
  };

  const control = (word: string, param: number | null, star: boolean) => {
    flushHex();
    const n = param ?? 0;
    const f = g.fmt;
    switch (word) {
      case 'ansicpg': cp = n; dec = decoderFor(cp); return;
      case 'deff': defaultFont = n; return;
      case 'fonttbl': g.dest = 'fonttbl'; return;
      case 'colortbl': g.dest = 'colortbl'; color = { r: 0, g: 0, b: 0, set: false }; return;
      case 'red': color.r = n; color.set = true; return;
      case 'green': color.g = n; color.set = true; return;
      case 'blue': color.b = n; color.set = true; return;
      case 'stylesheet': g.dest = 'stylesheet'; return;
      case 'info': g.dest = 'info'; return;
      case 'title': if (g.dest === 'info') { g.dest = 'title'; g.onClose = () => { doc.title = g.text; }; } return;
      case 'author': if (g.dest === 'info') { g.dest = 'author'; g.onClose = () => { doc.author = g.text; }; } return;
      case 'listtable': g.dest = 'listtable'; return;
      case 'listoverridetable': g.dest = 'listoverride'; return;
      case 'list': if (g.dest === 'listtable') { curLevel = -1; curList = { id: 0, levels: [] }; g.onClose = () => { if (curList) lists.set(curList.id, curList.levels[0] ?? 'bullet'); curList = null; }; } return;
      case 'listid': if (g.dest === 'listtable' && curList) curList.id = n; else if (g.dest === 'listoverride') ovList = n; return;
      case 'listlevel': curLevel++; return;
      case 'levelnfc': if (curList) curList.levels[Math.max(curLevel, 0)] = n === 23 || n === 255 ? 'bullet' : (NFC[n] ?? 'decimal'); return;
      case 'listoverride': ovList = 0; ovLs = 0; g.onClose = () => { if (ovLs) overrides.set(ovLs, ovList); }; return;
      case 'ls': if (g.dest === 'listoverride') ovLs = n; else b.pp.ls = n; return;
      case 'ilvl': b.pp.ilvl = n; return;
      case 'fldinst': g.dest = 'fldinst'; return;
      case 'field': fieldInstr = ''; fieldBuilder = b; fieldStart = b.inl.length; g.onClose = () => closeField(); return;
      case 'fldrslt': return;
      case 'pict': g.dest = 'pict'; picture = { kind: '', w: 0, h: 0, hex: '' }; g.onClose = () => closePicture(); return;
      case 'pngblip': case 'jpegblip': case 'emfblip': case 'wmetafile': case 'dibitmap': case 'wbitmap': if (picture) picture.kind = word; return;
      case 'picwgoal': if (picture) picture.w = n / 15; return;
      case 'pichgoal': if (picture) picture.h = n / 15; return;
      case 'picw': if (picture && !picture.w) picture.w = n; return;
      case 'pich': if (picture && !picture.h) picture.h = n; return;
      case 'header': case 'headerr': startHF('header', 'default'); return;
      case 'headerl': startHF('header', 'even'); return;
      case 'headerf': startHF('header', 'first'); return;
      case 'footer': case 'footerr': startHF('footer', 'default'); return;
      case 'footerl': startHF('footer', 'even'); return;
      case 'footerf': startHF('footer', 'first'); return;
      case 'titlepg': titlePg = true; return;
      case 'footnote': {
        const nb = newBuilder();
        const parent = b;
        b = nb;
        g.dest = 'body';
        g.onClose = () => {
          const blocks = finishBuilder(nb);
          b = parent;
          parent.inl.push(nodeTypes.footnote!.create({ kind: 'footnote', id: `fn${Math.random().toString(36).slice(2, 8)}`, body: noteBodyOf(blocks) }));
        };
        return;
      }
      case 'chftn': return;
      case 'paperw': docPage = { ...docPage, width: n / 20 }; return;
      case 'paperh': docPage = { ...docPage, height: n / 20 }; return;
      case 'margl': docPage = { ...docPage, marginLeft: n / 20 }; return;
      case 'margr': docPage = { ...docPage, marginRight: n / 20 }; return;
      case 'margt': docPage = { ...docPage, marginTop: n / 20 }; return;
      case 'margb': docPage = { ...docPage, marginBottom: n / 20 }; return;
      case 'landscape': landscape = true; return;
      case 'sectd': secPage = {}; cols = { count: 1, space: 36, sep: false }; sectionStart = 'nextPage'; titlePg = false; hf.header = { default: null, first: null, even: null }; hf.footer = { default: null, first: null, even: null }; return;
      case 'pgwsxn': secPage.width = n / 20; return;
      case 'pghsxn': secPage.height = n / 20; return;
      case 'marglsxn': secPage.marginLeft = n / 20; return;
      case 'margrsxn': secPage.marginRight = n / 20; return;
      case 'margtsxn': secPage.marginTop = n / 20; return;
      case 'margbsxn': secPage.marginBottom = n / 20; return;
      case 'lndscpsxn': landscape = true; return;
      case 'cols': cols.count = Math.max(1, n); return;
      case 'colsx': cols.space = n / 20; return;
      case 'linebetcol': cols.sep = true; return;
      case 'sbknone': sectionStart = 'continuous'; return;
      case 'sbkpage': sectionStart = 'nextPage'; return;
      case 'sbkeven': sectionStart = 'evenPage'; return;
      case 'sbkodd': sectionStart = 'oddPage'; return;
      case 'sect': endSection(false); return;
      case 'pard': flushHexSafe(); b.pp = plainPara(); return;
      case 'plain': g.fmt = plainFmt(); return;
      case 'par': endPara(); return;
      case 'line': b.inl.push(nodeTypes.hard_break!.create()); return;
      case 'page': { if (b.inl.length) endPara(); flushTable(); flushList(); b.blocks.push(nodeTypes.page_break!.create()); return; }
      case 'tab': emit('\t'); return;
      case 'trowd': b.cellx = []; b.rowCells = []; return;
      case 'cellx': b.cellx.push(n); return;
      case 'intbl': b.pp.intbl = true; return;
      case 'cell': endCell(); return;
      case 'row': endRow(); return;
      case 'qc': b.pp.align = 'center'; return;
      case 'qr': b.pp.align = 'right'; return;
      case 'qj': b.pp.align = 'justify'; return;
      case 'ql': b.pp.align = null; return;
      case 'li': b.pp.li = n; return;
      case 'ri': b.pp.ri = n; return;
      case 'fi': b.pp.fi = n; return;
      case 'sb': b.pp.sb = n; return;
      case 'sa': b.pp.sa = n; return;
      case 'sl': b.pp.sl = n; return;
      case 'keepn': b.pp.keepNext = true; return;
      case 'pagebb': b.pp.pageBreakBefore = true; return;
      case 's': if (g.dest === 'stylesheet') styleIdx = n; else b.pp.style = n; return;
      case 'b': f.b = param !== 0; return;
      case 'i': f.i = param !== 0; return;
      case 'ul': case 'uld': case 'uldb': case 'ulw': case 'ulth': f.ul = param !== 0; return;
      case 'ulnone': f.ul = false; return;
      case 'strike': case 'striked': f.strike = param !== 0; return;
      case 'super': f.vert = param === 0 ? 0 : 1; return;
      case 'sub': f.vert = param === 0 ? 0 : 2; return;
      case 'nosupersub': f.vert = 0; return;
      case 'caps': case 'scaps': f.caps = param !== 0; return;
      case 'fs': f.fs = n; return;
      case 'f': if (g.dest === 'fonttbl') fontIdx = n; else f.f = n; return;
      case 'cf': f.cf = n === 0 ? null : n; return;
      case 'highlight': case 'chcbpat': f.hl = n === 0 ? null : n; return;
      case 'u': {
        const code = n < 0 ? n + 65536 : n;
        emit(String.fromCharCode(code));
        g.skip = g.uc;
        return;
      }
      case 'uc': g.uc = n; return;
      default:
        if (SPECIAL[word] !== undefined) emit(SPECIAL[word]!);
        else if (star || SKIP_DESTS.has(word)) {
          if (star && ['fldinst', 'listtable', 'listoverridetable'].includes(word)) return;
          if (star && word === 'shppict') return;
          g.dest = 'skip';
        }
    }
  };
  const flushHexSafe = () => undefined;

  const closeField = () => {
    const fb = fieldBuilder;
    if (!fb) return;
    const instr = fieldInstr.trim();
    const word = instr.split(/\s+/)[0]?.toUpperCase();
    const result = fb.inl.splice(fieldStart);
    if (word === 'HYPERLINK') {
      const href = /"([^"]*)"/.exec(instr)?.[1];
      if (href) {
        const link = writerSchema.marks.link!.create({ href });
        fb.inl.push(...result.map((n) => (n.isText ? n.mark(link.addToSet(n.marks)) : n)));
        return;
      }
    } else if (word === 'PAGE' || word === 'NUMPAGES') {
      fb.inl.push(nodeTypes.field!.create({ kind: word === 'PAGE' ? 'page' : 'pages' }));
      return;
    }
    fb.inl.push(...result);
  };
  const closePicture = () => {
    const pic = picture;
    picture = null;
    if (!pic || !pic.hex) return;
    if (pic.kind !== 'pngblip' && pic.kind !== 'jpegblip') {
      warnings.push('Una imagen en formato vectorial (WMF/EMF) o de mapa de bits antiguo no se pudo importar.');
      return;
    }
    const bytes = new Uint8Array(pic.hex.length >> 1);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(pic.hex.slice(i * 2, i * 2 + 2), 16);
    const mime = pic.kind === 'pngblip' ? 'image/png' : 'image/jpeg';
    b.inl.push(nodeTypes.image!.create({ src: `data:${mime};base64,${toBase64(bytes)}`, alt: '', width: pic.w ? Math.round(pic.w) : null, height: pic.h ? Math.round(pic.h) : null }));
  };

  let i = 0;
  const len = s.length;
  while (i < len) {
    const c = s[i]!;
    if (c === '{') {
      flushHex();
      stack.push(g);
      g = { ...g, fmt: { ...g.fmt }, onClose: undefined, builder: undefined, text: g.dest === 'fonttbl' || g.dest === 'stylesheet' ? '' : undefined };
      i++;
    } else if (c === '}') {
      flushHex();
      g.onClose?.();
      g = stack.pop() ?? g;
      i++;
    } else if (c === '\\') {
      const nx = s[i + 1] ?? '';
      if (nx === '\\' || nx === '{' || nx === '}') {
        if (g.skip > 0) g.skip--;
        else {
          flushHex();
          emit(nx);
        }
        i += 2;
      } else if (nx === "'") {
        const v = parseInt(s.slice(i + 2, i + 4), 16);
        if (g.skip > 0) g.skip--;
        else if (!Number.isNaN(v)) hexBytes.push(v);
        i += 4;
      } else if (nx === '*') {
        i += 2;
        // the destination word follows
        const m = /^\\([a-zA-Z]+)(-?\d+)?/.exec(s.slice(i, i + 40));
        if (m) {
          i += m[0].length;
          if (s[i] === ' ') i++;
          control(m[1]!, m[2] ? Number(m[2]) : null, true);
        } else g.dest = 'skip';
      } else if (nx === '~') {
        flushHex();
        emit('\u00a0');
        i += 2;
      } else if (nx === '-' || nx === '_') {
        flushHex();
        emit(nx === '_' ? '‑' : '');
        i += 2;
      } else if (nx === '\n' || nx === '\r') {
        flushHex();
        endPara();
        i += 2;
      } else if (/[a-zA-Z]/.test(nx)) {
        const m = /^\\([a-zA-Z]+)(-?\d+)?( ?)/.exec(s.slice(i, i + 50))!;
        i += m[0].length;
        control(m[1]!, m[2] !== undefined ? Number(m[2]) : null, false);
      } else i += 2;
    } else if (c === '\r' || c === '\n') {
      i++;
    } else {
      let j = i;
      while (j < len && s[j] !== '{' && s[j] !== '}' && s[j] !== '\\' && s[j] !== '\r' && s[j] !== '\n') j++;
      let text = s.slice(i, j);
      i = j;
      if (g.skip > 0) {
        const k = Math.min(g.skip, text.length);
        g.skip -= k;
        text = text.slice(k);
      }
      if (text) {
        flushHex();
        emit(text);
      }
    }
  }
  flushHex();
  endSection(true);
  if (sections.length === 1) sections[0]!.props.start = 'nextPage';
  doc.body = nodeTypes.doc!.create(null, sections.map((sec) => makeSection(sec.blocks, sec.props)));
  doc.parts = parts;
  if (/\\sbknone/.test(s) === false) void 0;
  return { doc: doc as WriterDoc, warnings: [...new Set(warnings)] };
}

// ================================================================================================ writing

const rtfEsc = (t: string): string => {
  let out = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
    else if (ch === '\t') out += '\\tab ';
    else if (ch === '\n') out += '\\line ';
    else if (cp < 128) out += ch;
    else if (cp < 0x10000) out += `\\u${cp > 32767 ? cp - 65536 : cp}?`;
    else {
      const v = cp - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      out += `\\u${hi - 65536}?\\u${lo - 65536}?`;
    }
  }
  return out;
};

const hexToRgb = (h: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

export function writeRtf(d: WriterDoc): WriteResult {
  const warnings: string[] = [];
  const fonts: string[] = [d.defaults.fontFamily];
  const colors: string[] = [];
  const fontIdx = (name: string) => {
    let i = fonts.indexOf(name);
    if (i < 0) i = fonts.push(name) - 1;
    return i;
  };
  const colorIdx = (hex: string) => {
    let i = colors.indexOf(hex.toLowerCase());
    if (i < 0) i = colors.push(hex.toLowerCase()) - 1;
    return i + 1;
  };
  const lists: { bullet: boolean; format: ListFormat }[] = [];
  const tw = (pt: number) => Math.round(pt * 20);

  const inline = (n: PMNode): string => {
    switch (n.type.name) {
      case 'text': {
        const ctrl: string[] = [];
        let link: string | null = null;
        for (const m of n.marks) {
          switch (m.type.name) {
            case 'strong': ctrl.push('\\b'); break;
            case 'em': ctrl.push('\\i'); break;
            case 'underline': ctrl.push('\\ul'); break;
            case 'strike': ctrl.push('\\strike'); break;
            case 'superscript': ctrl.push('\\super'); break;
            case 'subscript': ctrl.push('\\sub'); break;
            case 'caps': ctrl.push('\\caps'); break;
            case 'color': if (hexToRgb(m.attrs.value)) ctrl.push(`\\cf${colorIdx(m.attrs.value)}`); break;
            case 'highlight': if (hexToRgb(m.attrs.value)) ctrl.push(`\\highlight${colorIdx(m.attrs.value)}`); break;
            case 'fontFamily': ctrl.push(`\\f${fontIdx(m.attrs.value)}`); break;
            case 'fontSize': ctrl.push(`\\fs${Math.round(m.attrs.value * 2)}`); break;
            case 'link': link = m.attrs.href; break;
          }
        }
        let body = ctrl.length ? `{${ctrl.join('')} ${rtfEsc(n.text!)}}` : rtfEsc(n.text!);
        if (link) body = `{\\field{\\*\\fldinst HYPERLINK "${link.replace(/"/g, '')}"}{\\fldrslt{\\ul ${body}}}}`;
        return body;
      }
      case 'hard_break': return '\\line ';
      case 'image': {
        const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(String(n.attrs.src));
        if (!m) {
          warnings.push('Una imagen que no estaba incrustada no se guardó en el RTF.');
          return '';
        }
        const bin = atob(m[2]!);
        let h = '';
        for (let i = 0; i < bin.length; i++) h += bin.charCodeAt(i).toString(16).padStart(2, '0');
        const w = n.attrs.width ?? 100;
        const hh = n.attrs.height ?? 100;
        return `{\\pict\\${m[1] === 'png' ? 'pngblip' : 'jpegblip'}\\picw${w}\\pich${hh}\\picwgoal${Math.round(w * 15)}\\pichgoal${Math.round(hh * 15)} ${h}}`;
      }
      case 'field': {
        const k = n.attrs.kind;
        if (k === 'page' || k === 'pages') return `{\\field{\\*\\fldinst ${k === 'page' ? 'PAGE' : 'NUMPAGES'}}{\\fldrslt 1}}`;
        return rtfEsc(String(n.attrs.result ?? ''));
      }
      case 'footnote': {
        const body = (n.attrs.body as { content?: unknown[] } | null) ?? null;
        void body;
        let text = '';
        try {
          const nd = writerSchema.nodeFromJSON(n.attrs.body as never);
          nd.forEach((p) => (text += `\\pard\\plain ${p.textContent ? rtfEsc(p.textContent) : ''}\\par `));
        } catch {
          /* empty note */
        }
        return `{\\super\\chftn}{\\footnote\\pard\\plain{\\super\\chftn} ${text}}`;
      }
      case 'math': return rtfEsc(String(n.attrs.tex));
      case 'shape': case 'content_control': {
        let out = '';
        n.forEach((c) => (out += c.isBlock ? `${inlineContent(c)}\\line ` : inline(c)));
        return out;
      }
      default: return rtfEsc(n.textContent);
    }
  };
  const inlineContent = (p: PMNode): string => {
    let out = '';
    p.forEach((c) => (out += inline(c)));
    return out;
  };
  const paraProps = (p: PMNode, extra = ''): string => {
    const a = p.attrs;
    let s = '\\pard\\plain' + extra;
    if (a.align === 'center') s += '\\qc';
    else if (a.align === 'right') s += '\\qr';
    else if (a.align === 'justify') s += '\\qj';
    if (a.indentLeft) s += `\\li${tw(a.indentLeft)}`;
    if (a.indentRight) s += `\\ri${tw(a.indentRight)}`;
    if (a.indentFirst) s += `\\fi${tw(a.indentFirst)}`;
    if (a.spaceBefore !== null) s += `\\sb${tw(a.spaceBefore)}`;
    if (a.spaceAfter !== null) s += `\\sa${tw(a.spaceAfter)}`;
    if (a.lineHeight) s += `\\sl${Math.round(a.lineHeight * 240)}\\slmult1`;
    if (a.keepNext) s += '\\keepn';
    if (a.pageBreakBefore) s += '\\pagebb';
    const hm = /^Heading(\d)$/.exec(a.style ?? '');
    if (hm) s += `\\s${hm[1]}\\outlinelevel${Number(hm[1]) - 1}\\b\\fs${Math.round((28 - Number(hm[1]) * 2) * 2)}`;
    else if (a.style === 'Title') s += '\\s10\\fs56';
    return s;
  };
  const para = (p: PMNode, extra = ''): string => `${paraProps(p, extra)} ${inlineContent(p)}\\par\n`;

  const block = (n: PMNode, level = 0, inCell = false): string => {
    switch (n.type.name) {
      case 'paragraph': return para(n, inCell ? '\\intbl' : '');
      case 'page_break': return '\\page\n';
      case 'bullet_list':
      case 'ordered_list': {
        const idx = lists.push({ bullet: n.type.name === 'bullet_list', format: (n.attrs.format as ListFormat) ?? 'decimal' }) ;
        let out = '';
        n.forEach((li) => {
          li.forEach((c, _o, i) => {
            if (c.type.name === 'paragraph') out += `${paraProps(c, `\\ls${idx}\\ilvl${Math.min(level, 8)}\\li${720 * (level + 1)}\\fi-360`)} ${i === 0 ? (lists[idx - 1]!.bullet ? '{\\listtext\\f0\\\'b7\\tab}' : '') : ''}${inlineContent(c)}\\par\n`;
            else out += block(c, level + 1, inCell);
          });
        });
        return out;
      }
      case 'table': {
        let out = '';
        n.forEach((row) => {
          let x = 0;
          let def = '\\trowd\\trgaph108';
          row.forEach((cell) => {
            x += Math.round((((cell.attrs.colwidth as number[] | null)?.[0] ?? 100) * 72 * 20) / 96);
            def += (n.attrs.borders ? '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10' : '') + `\\cellx${x}`;
          });
          out += def + '\n';
          row.forEach((cell) => {
            cell.forEach((c) => (out += block(c, level, true)));
            out += '\\cell\n';
          });
          out += '\\row\n';
        });
        return out;
      }
      case 'generated': case 'content_control_block': {
        let out = '';
        n.forEach((c) => (out += block(c, level, inCell)));
        return out;
      }
      default: return para(nodeTypes.paragraph!.create(null, n.textContent ? writerSchema.text(n.textContent) : []));
    }
  };
  const partRtf = (id: string | null, tag: string): string => {
    const part = id ? d.parts[id] : null;
    if (!part) return '';
    let out = '';
    part.forEach((c) => (out += block(c)));
    return `{\\${tag} ${out}}`;
  };

  let body = '';
  let first = true;
  d.body.forEach((sec) => {
    const a = sec.attrs;
    const page = a.page ?? defaultPage();
    const cols = a.cols as { count: number; space: number; sep: boolean } | null;
    let props = `\\sectd\\${a.start === 'continuous' ? 'sbknone' : a.start === 'evenPage' ? 'sbkeven' : a.start === 'oddPage' ? 'sbkodd' : 'sbkpage'}\\pgwsxn${tw(page.width)}\\pghsxn${tw(page.height)}\\marglsxn${tw(page.marginLeft)}\\margrsxn${tw(page.marginRight)}\\margtsxn${tw(page.marginTop)}\\margbsxn${tw(page.marginBottom)}`;
    if (page.width > page.height) props += '\\lndscpsxn';
    if (cols && cols.count > 1) props += `\\cols${cols.count}\\colsx${tw(cols.space)}${cols.sep ? '\\linebetcol' : ''}`;
    if (a.titlePg) props += '\\titlepg';
    const h = a.header ?? {};
    const f = a.footer ?? {};
    props += partRtf(h.default, 'headerr') + partRtf(h.even, 'headerl') + partRtf(h.first, 'headerf') + partRtf(f.default, 'footerr') + partRtf(f.even, 'footerl') + partRtf(f.first, 'footerf');
    if (!first) body += '\\sect\n';
    first = false;
    body += props + '\n';
    sec.forEach((c) => (body += block(c)));
  });

  const page0 = d.body.firstChild?.attrs.page ?? defaultPage();
  const fontTbl = fonts.map((f, i) => `{\\f${i}\\fnil\\fcharset0 ${rtfEsc(f)};}`).join('');
  const colorTbl = ';' + colors.map((c) => { const r = hexToRgb(c)!; return `\\red${r[0]}\\green${r[1]}\\blue${r[2]};`; }).join('');
  let listTbl = '';
  let listOv = '';
  lists.forEach((l, i) => {
    const nfc = l.bullet ? 23 : ({ decimal: 0, upperRoman: 1, lowerRoman: 2, upperLetter: 3, lowerLetter: 4 } as const)[l.format];
    const levels = Array.from({ length: 9 }, (_v, k) => `{\\listlevel\\levelnfc${nfc}\\leveljc0\\levelstartat1\\levelfollow0{\\leveltext\\'01${l.bullet ? "\\'b7" : '\\\'00.'};}{\\levelnumbers;}\\fi-360\\li${720 * (k + 1)}}`).join('');
    listTbl += `{\\list\\listtemplateid${i + 1}\\listhybrid${levels}\\listid${i + 1}}`;
    listOv += `{\\listoverride\\listid${i + 1}\\listoverridecount0\\ls${i + 1}}`;
  });
  const info = `{\\info${d.title ? `{\\title ${rtfEsc(d.title)}}` : ''}${d.author ? `{\\author ${rtfEsc(d.author)}}` : ''}}`;
  const head = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl${fontTbl}}{\\colortbl${colorTbl}}${lists.length ? `{\\*\\listtable${listTbl}}{\\*\\listoverridetable${listOv}}` : ''}${info}\\paperw${tw(page0.width)}\\paperh${tw(page0.height)}\\margl${tw(page0.marginLeft)}\\margr${tw(page0.marginRight)}\\margt${tw(page0.marginTop)}\\margb${tw(page0.marginBottom)}\\fs${Math.round(d.defaults.fontSize * 2)}\n`;
  if (d.comments.length) warnings.push('Los comentarios no se guardan en RTF.');
  if (d.watermark) warnings.push('La marca de agua no se guarda en RTF.');
  return { data: new TextEncoder().encode(head + body + '}'), warnings };
}
