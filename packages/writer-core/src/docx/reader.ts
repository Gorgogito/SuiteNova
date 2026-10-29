import JSZip from 'jszip';
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import { markTypes, nodeTypes, writerSchema, type Align, type ListFormat } from '../schema';
import { DEFAULT_DOC_DEFAULTS, type DocDefaults } from '../styles';
import { EMU_PER_PX, emptyWriterDoc, makeSection, twipsToPt, type CommentData, type NotesOptions, type Protection, type ReadResult, type Source, type Watermark, type WriterDoc } from './model';
import { defaultSection, newSectionId, noRefs, oneColumn, type Columns, type HFRefs, type SectionProps } from '../sections';
import { fromOMML, toTex } from '../math';
import { noteBodyOf } from '../notes';
import { PRST_SHAPE, parseFieldInstr } from './shared';
import { attrOf, findKid, findKids, kidsOf, parseXml, rootOf, tagOf, textOfNode, toggle, type XNode } from './xml';

// ---------- property bags ----------

interface RP {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  color?: string;
  hl?: string;
  font?: string;
  sz?: number;
  vert?: 'superscript' | 'subscript';
  caps?: 'all' | 'small';
  lang?: string;
}
interface TabDef {
  pos: number;
  kind: 'left' | 'center' | 'right' | 'decimal' | 'bar';
  leader?: string;
}
interface Rev {
  author: string;
  date: string;
  id: string;
}
interface PP {
  jc?: Align;
  left?: number;
  right?: number;
  first?: number;
  before?: number;
  after?: number;
  line?: number;
  keepNext?: boolean;
  pageBreakBefore?: boolean;
  contextual?: boolean;
  numId?: number;
  ilvl?: number;
  tabs?: TabDef[];
  shade?: string;
  border?: { width: number; color: string; space: number };
  insMark?: Rev;
  delMark?: Rev;
}
interface StyleDef {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  pp: PP;
  rp: RP;
  borders?: boolean;
}
interface Fonts {
  major?: string;
  minor?: string;
}

const HIGHLIGHT: Record<string, string> = {
  yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '000080', darkCyan: '008080', darkGreen: '008000',
  darkMagenta: '800080', darkRed: '800000', darkYellow: '808000', darkGray: '808080', lightGray: 'C0C0C0', black: '000000', white: 'FFFFFF',
};
const BUILTIN_BY_NAME: Record<string, string> = {
  title: 'Title', subtitle: 'Subtitle', quote: 'Quote', caption: 'Caption', 'heading 1': 'Heading1', 'heading 2': 'Heading2', 'heading 3': 'Heading3', 'heading 4': 'Heading4', 'heading 5': 'Heading5', 'heading 6': 'Heading6',
  'toc heading': 'TOCHeading', 'toc 1': 'TOC1', 'toc 2': 'TOC2', 'toc 3': 'TOC3', 'toc 4': 'TOC4', 'toc 5': 'TOC5', 'toc 6': 'TOC6', 'table of figures': 'TableofFigures', bibliography: 'Bibliography', 'footnote text': 'FootnoteText', 'endnote text': 'EndnoteText', header: 'Header', footer: 'Footer', 'index heading': 'IndexHeading', 'index 1': 'Index1', 'annotation text': 'CommentText',
};
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };

const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const setDef = <T extends object>(o: T, k: keyof T, v: unknown) => {
  if (v !== undefined) (o as any)[k] = v;
};
const revOf = (n: XNode | undefined): Rev | undefined => (n ? { id: attrOf(n, 'id') ?? '', author: attrOf(n, 'author') ?? '', date: attrOf(n, 'date') ?? '' } : undefined);

function parseRPr(n: XNode | undefined, fonts: Fonts): RP {
  const rp: RP = {};
  if (!n) return rp;
  for (const k of kidsOf(n)) {
    switch (tagOf(k)) {
      case 'b': setDef(rp, 'b', toggle(k)); break;
      case 'i': setDef(rp, 'i', toggle(k)); break;
      case 'strike':
      case 'dstrike': setDef(rp, 'strike', toggle(k)); break;
      case 'caps': if (toggle(k)) rp.caps = 'all'; break;
      case 'smallCaps': if (toggle(k)) rp.caps = 'small'; break;
      case 'u': rp.u = attrOf(k, 'val') !== 'none'; break;
      case 'lang': {
        const v = attrOf(k, 'val');
        if (v) rp.lang = v;
        break;
      }
      case 'color': {
        const v = attrOf(k, 'val');
        if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v)) rp.color = '#' + v.toLowerCase();
        break;
      }
      case 'highlight': {
        const v = attrOf(k, 'val');
        if (v && v !== 'none' && HIGHLIGHT[v]) rp.hl = '#' + HIGHLIGHT[v]!.toLowerCase();
        break;
      }
      case 'shd': {
        const f = attrOf(k, 'fill');
        if (f && f !== 'auto' && /^[0-9a-f]{6}$/i.test(f)) rp.hl = '#' + f.toLowerCase();
        break;
      }
      case 'sz': {
        const v = num(attrOf(k, 'val'));
        if (v) rp.sz = v / 2;
        break;
      }
      case 'vertAlign': {
        const v = attrOf(k, 'val');
        if (v === 'superscript' || v === 'subscript') rp.vert = v;
        break;
      }
      case 'rFonts': {
        const theme = attrOf(k, 'asciiTheme') ?? attrOf(k, 'hAnsiTheme');
        const f = attrOf(k, 'ascii') ?? attrOf(k, 'hAnsi');
        if (theme) rp.font = (theme.startsWith('major') ? fonts.major : fonts.minor) ?? f;
        else if (f) rp.font = f;
        break;
      }
    }
  }
  return rp;
}

function parsePPr(n: XNode | undefined): PP {
  const pp: PP = {};
  if (!n) return pp;
  for (const k of kidsOf(n)) {
    switch (tagOf(k)) {
      case 'jc': {
        const v = attrOf(k, 'val');
        pp.jc = v === 'both' || v === 'distribute' ? 'justify' : v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : v === 'left' || v === 'start' ? 'left' : undefined;
        if (!pp.jc) delete pp.jc;
        break;
      }
      case 'ind': {
        const t = (name: string, alt?: string) => num(attrOf(k, name) ?? (alt ? attrOf(k, alt) : undefined));
        const l = t('left', 'start'), r = t('right', 'end'), f = t('firstLine'), h = t('hanging');
        if (l !== undefined) pp.left = twipsToPt(l);
        if (r !== undefined) pp.right = twipsToPt(r);
        if (f !== undefined) pp.first = twipsToPt(f);
        if (h !== undefined) pp.first = -twipsToPt(h);
        break;
      }
      case 'spacing': {
        const b = num(attrOf(k, 'before')), a = num(attrOf(k, 'after')), l = num(attrOf(k, 'line'));
        if (b !== undefined) pp.before = twipsToPt(b);
        if (a !== undefined) pp.after = twipsToPt(a);
        const rule = attrOf(k, 'lineRule') ?? 'auto';
        if (l !== undefined && rule === 'auto') pp.line = Math.round((l / 240) * 100) / 100;
        break;
      }
      case 'keepNext': setDef(pp, 'keepNext', toggle(k)); break;
      case 'pageBreakBefore': setDef(pp, 'pageBreakBefore', toggle(k)); break;
      case 'contextualSpacing': setDef(pp, 'contextual', toggle(k)); break;
      case 'numPr': {
        const id = num(attrOf(findKid(k, 'numId') ?? {}, 'val'));
        const lvl = num(attrOf(findKid(k, 'ilvl') ?? {}, 'val'));
        if (id !== undefined) pp.numId = id;
        if (lvl !== undefined) pp.ilvl = lvl;
        break;
      }
      case 'tabs': {
        const tabs: TabDef[] = [];
        for (const t of findKids(k, 'tab')) {
          const v = attrOf(t, 'val') ?? 'left';
          const pos = num(attrOf(t, 'pos'));
          if (pos === undefined || v === 'clear') continue;
          const kind = v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : v === 'decimal' ? 'decimal' : v === 'bar' ? 'bar' : 'left';
          const leader = attrOf(t, 'leader');
          tabs.push({ pos: twipsToPt(pos), kind, ...(leader && leader !== 'none' ? { leader: leader === 'underscore' || leader === 'hyphen' || leader === 'dot' || leader === 'middleDot' ? leader : 'dot' } : {}) });
        }
        if (tabs.length) pp.tabs = tabs;
        break;
      }
      case 'shd': {
        const f = attrOf(k, 'fill');
        if (f && f !== 'auto' && /^[0-9a-f]{6}$/i.test(f)) pp.shade = '#' + f.toLowerCase();
        break;
      }
      case 'pBdr': {
        const side = findKid(k, 'top') ?? findKid(k, 'bottom') ?? findKid(k, 'left') ?? findKid(k, 'right');
        if (side && attrOf(side, 'val') !== 'nil' && attrOf(side, 'val') !== 'none') {
          const c = attrOf(side, 'color');
          pp.border = { width: (num(attrOf(side, 'sz')) ?? 4) / 8, color: c && c !== 'auto' && /^[0-9a-f]{6}$/i.test(c) ? '#' + c.toLowerCase() : '#000000', space: num(attrOf(side, 'space')) ?? 1 };
        }
        break;
      }
      case 'rPr': {
        const ins = findKid(k, 'ins');
        const del = findKid(k, 'del');
        if (ins) pp.insMark = revOf(ins);
        if (del) pp.delMark = revOf(del);
        break;
      }
    }
  }
  return pp;
}

const merge = <T extends object>(...parts: T[]): T => Object.assign({}, ...parts.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)))) as T;

// ---------- package-level info ----------

interface Rel {
  type: string;
  target: string;
  external: boolean;
}

function parseRels(xml: string | null): Map<string, Rel> {
  const map = new Map<string, Rel>();
  if (!xml) return map;
  const root = rootOf(parseXml(xml), 'Relationships');
  for (const r of findKids(root, 'Relationship')) {
    const id = attrOf(r, 'Id');
    if (id) map.set(id, { type: attrOf(r, 'Type') ?? '', target: attrOf(r, 'Target') ?? '', external: attrOf(r, 'TargetMode') === 'External' });
  }
  return map;
}

interface CommentInfo {
  id: string;
  parent: string | null;
}

interface Shared {
  zip: JSZip;
  styles: Map<string, StyleDef>;
  baseRP: RP;
  basePP: PP;
  fonts: Fonts;
  numbering: Map<number, { abstract: number; start: Map<number, number> }>;
  abstracts: Map<number, Map<number, { fmt: ListFormat | 'bullet'; start: number }>>;
  media: Map<string, string>; // zip path → data URI
  warnings: Set<string>;
  counters: Map<string, number>;
  sections: number;
  comments: Map<string, CommentInfo>;
  footnotes: Map<string, PMNode>;
  endnotes: Map<string, PMNode>;
  noteSeq: number;
}

function resolveChain(sh: Shared, id: string | undefined, depth = 0): { pp: PP; rp: RP; borders: boolean } {
  const s = id ? sh.styles.get(id) : undefined;
  if (!s || depth > 20) return { pp: {}, rp: {}, borders: false };
  const parent = s.basedOn ? resolveChain(sh, s.basedOn, depth + 1) : { pp: {}, rp: {}, borders: false };
  return { pp: merge(parent.pp, s.pp), rp: merge(parent.rp, s.rp), borders: s.borders ?? parent.borders };
}

const builtinOf = (sh: Shared, id: string | undefined): string | null => {
  for (let cur = id, d = 0; cur && d < 20; d++) {
    const s = sh.styles.get(cur);
    if (!s) return null;
    const b = BUILTIN_BY_NAME[s.name.toLowerCase()];
    if (b) return b;
    cur = s.basedOn;
  }
  return null;
};

// ---------- converter ----------

interface ListItem {
  numId: number;
  level: number;
  kind: ListFormat | 'bullet';
  ordinal: number;
  para: PMNode;
}
interface FieldState {
  instr: string;
  phase: 'instr' | 'result';
  mode: 'normal' | 'link' | 'capture';
  href?: string;
  spec?: { kind: string; arg: string | null; switches: string | null };
  result: string;
  marks: Mark[];
}

const findDeep = (n: XNode, tag: string): XNode | undefined => {
  if (tagOf(n) === tag) return n;
  for (const k of kidsOf(n)) {
    const f = findDeep(k, tag);
    if (f) return f;
  }
  return undefined;
};
const allDeep = (n: XNode, tag: string, out: XNode[] = []): XNode[] => {
  if (tagOf(n) === tag) out.push(n);
  for (const k of kidsOf(n)) allDeep(k, tag, out);
  return out;
};

class Converter {
  constructor(private sh: Shared, private rels: Map<string, Rel>, private baseDir = 'word/') {}
  private fields: FieldState[] = [];
  /** Comments whose range is open (they stay open across paragraphs). */
  private activeComments: string[] = [];
  private ins: Rev | null = null;
  private del: Rev | null = null;

  private warn(m: string) {
    this.sh.warnings.add(m);
  }

  blocks(kids: XNode[]): PMNode[] {
    const out: PMNode[] = [];
    let pending: ListItem[] = [];
    const flush = () => {
      if (pending.length) out.push(...buildLists(pending));
      pending = [];
    };
    const visit = (list: XNode[]) => {
      for (const k of list) {
        switch (tagOf(k)) {
          case 'p': {
            const r = this.paragraph(k);
            for (const piece of r.pieces) {
              if (r.list && piece.type.name === 'paragraph') {
                const d = this.listInfo(r.list.numId, r.list.ilvl);
                pending.push({ numId: r.list.numId, level: r.list.ilvl, kind: d.fmt, ordinal: this.nextOrdinal(r.list.numId, r.list.ilvl), para: piece });
              } else if (!(r.list && piece.type.name === 'page_break')) {
                flush();
                out.push(piece);
              }
            }
            break;
          }
          case 'tbl': flush(); out.push(this.table(k)); break;
          case 'sdt': {
            const block = this.blockSdt(k);
            if (block) {
              flush();
              out.push(...block);
            }
            break;
          }
          case 'ins':
          case 'moveTo':
          case 'del':
          case 'moveFrom': visit(kidsOf(k)); break;
          case 'AlternateContent': {
            const ch = findKid(k, 'Choice');
            if (ch) visit(kidsOf(ch));
            break;
          }
        }
      }
    };
    visit(kids);
    flush();
    return out;
  }

  /** A structured document tag around blocks: a table of contents, a bibliography, or a rich-text content control. */
  private blockSdt(sdt: XNode): PMNode[] | null {
    const pr = findKid(sdt, 'sdtPr');
    const content = findKid(sdt, 'sdtContent');
    if (!content) return null;
    const gallery = attrOf(findDeep(pr ?? {}, 'docPartGallery') ?? {}, 'val') ?? '';
    const inner = this.blocks(kidsOf(content));
    if (!inner.length) return null;
    const instrNode = allDeep(content, 'instrText').find((n) => /^\s*(TOC|BIBLIOGRAPHY|INDEX)\b/i.test(textOfNode(n)));
    const instr = instrNode ? textOfNode(instrNode) : null;
    const kindFromInstr = instr ? (/^\s*BIBLIOGRAPHY/i.test(instr) ? 'bibliography' : /^\s*INDEX/i.test(instr) ? 'index' : /\\c\s/.test(instr) ? 'tof' : 'toc') : null;
    if (/table of contents|tabla de contenido|contents/i.test(gallery) || (kindFromInstr && /^(toc|tof)$/.test(kindFromInstr) && !gallery)) {
      return [nodeTypes.generated!.create({ kind: kindFromInstr ?? 'toc', opts: { instr: instr ?? ' TOC \\o "1-3" \\h \\z \\u ' } }, inner)];
    }
    if (/bibliograph/i.test(gallery) || kindFromInstr === 'bibliography') return [nodeTypes.generated!.create({ kind: 'bibliography', opts: { instr: instr ?? ' BIBLIOGRAPHY ' } }, inner)];
    const alias = attrOf(findKid(pr, 'alias') ?? {}, 'val') ?? '';
    const tag = attrOf(findKid(pr, 'tag') ?? {}, 'val') ?? '';
    const lock = attrOf(findKid(pr, 'lock') ?? {}, 'val') ?? null;
    if (inner.some((b) => b.type.name === 'paragraph' || b.type.name === 'table' || b.type.name === 'bullet_list' || b.type.name === 'ordered_list')) {
      return [nodeTypes.content_control_block!.create({ id: attrOf(findKid(pr, 'id') ?? {}, 'val') ?? '', tag, title: alias, lock }, inner)];
    }
    return inner;
  }

  private listInfo(numId: number, ilvl: number) {
    const n = this.sh.numbering.get(numId);
    const abs = n ? this.sh.abstracts.get(n.abstract) : undefined;
    const lvl = abs?.get(ilvl);
    return { fmt: lvl?.fmt ?? ('bullet' as const), start: n?.start.get(ilvl) ?? lvl?.start ?? 1 };
  }

  private nextOrdinal(numId: number, ilvl: number): number {
    const c = this.sh.counters;
    const key = `${numId}:${ilvl}`;
    for (const k of [...c.keys()]) {
      const [id, lv] = k.split(':').map(Number);
      if (id === numId && lv! > ilvl) c.delete(k);
    }
    const v = c.has(key) ? c.get(key)! + 1 : this.listInfo(numId, ilvl).start;
    c.set(key, v);
    return v;
  }

  // -- paragraphs --

  private paragraph(p: XNode): { pieces: PMNode[]; list?: { numId: number; ilvl: number } } {
    const sh = this.sh;
    const pPrNode = findKid(p, 'pPr');
    const direct = parsePPr(pPrNode);
    const styleId = attrOf(findKid(pPrNode, 'pStyle') ?? {}, 'val');
    const builtin = builtinOf(sh, styleId);
    const chain = resolveChain(sh, styleId);
    const pp = builtin ? direct : merge(chain.pp, direct);
    const list = pp.numId && pp.numId > 0 ? { numId: pp.numId, ilvl: Math.min(pp.ilvl ?? 0, 8) } : undefined;
    // properties of the style only apply for flattening; compare with document defaults
    const base = sh.basePP;
    const attrs: Record<string, unknown> = { style: builtin && builtin !== 'Normal' ? builtin : null };
    if (pp.jc && pp.jc !== base.jc) attrs.align = pp.jc;
    if (!list) {
      attrs.indentLeft = pp.left ?? 0;
      attrs.indentRight = pp.right ?? 0;
      attrs.indentFirst = pp.first ?? 0;
    }
    if (pp.before !== undefined && pp.before !== base.before) attrs.spaceBefore = pp.before;
    if (pp.after !== undefined && pp.after !== base.after) attrs.spaceAfter = pp.after;
    if (list && pp.contextual) {
      attrs.spaceBefore = 0;
      attrs.spaceAfter = 0;
    }
    if (pp.line !== undefined && pp.line !== base.line) attrs.lineHeight = pp.line;
    if (pp.keepNext) attrs.keepNext = true;
    if (pp.pageBreakBefore) attrs.pageBreakBefore = true;
    const tabs = direct.tabs ?? (builtin ? undefined : chain.pp.tabs);
    if (tabs) attrs.tabs = tabs;
    if (pp.shade) attrs.shade = pp.shade;
    if (pp.border) attrs.border = pp.border;
    if (direct.insMark) attrs.ins = { id: direct.insMark.id, author: direct.insMark.author, date: direct.insMark.date };
    if (direct.delMark) attrs.del = { id: direct.delMark.id, author: direct.delMark.author, date: direct.delMark.date };

    const runBase = merge(builtin ? {} : chain.rp);
    const pieces: (PMNode[] | 'break')[] = [[]];
    const cur = () => pieces[pieces.length - 1] as PMNode[];
    const runCtx = { base: runBase, builtin: !!builtin };
    this.inline(kidsOf(p), null, runCtx, cur, () => pieces.push('break', []));

    const hadBreak = pieces.includes('break');
    const out: PMNode[] = [];
    for (const piece of pieces) {
      if (piece === 'break') out.push(nodeTypes.page_break!.create());
      else if (piece.length || !hadBreak) out.push(nodeTypes.paragraph!.create(attrs, piece));
    }
    return { pieces: out, list };
  }

  // -- inline content --

  private inline(kids: XNode[], link: string | null, rc: { base: RP; builtin: boolean }, cur: () => PMNode[], onPageBreak: () => void) {
    for (const k of kids) {
      switch (tagOf(k)) {
        case 'r': this.run(k, link, rc, cur, onPageBreak); break;
        case 'hyperlink': {
          const rid = attrOf(k, 'id');
          const anchor = attrOf(k, 'anchor');
          const href = rid ? this.rels.get(rid)?.target : anchor ? '#' + anchor : undefined;
          this.inline(kidsOf(k), href ?? link, rc, cur, onPageBreak);
          break;
        }
        case 'ins':
        case 'moveTo': {
          const prev = this.ins;
          this.ins = revOf(k) ?? null;
          this.inline(kidsOf(k), link, rc, cur, onPageBreak);
          this.ins = prev;
          break;
        }
        case 'del':
        case 'moveFrom': {
          const prev = this.del;
          this.del = revOf(k) ?? null;
          this.inline(kidsOf(k), link, rc, cur, onPageBreak);
          this.del = prev;
          break;
        }
        case 'smartTag':
        case 'customXml':
        case 'dir':
        case 'bdo': this.inline(kidsOf(k), link, rc, cur, onPageBreak); break;
        case 'sdt': this.inlineSdt(k, link, rc, cur, onPageBreak); break;
        case 'fldSimple': {
          const instr = attrOf(k, 'instr') ?? '';
          const spec = parseFieldInstr(instr);
          if (spec && !this.suppressed()) {
            const result = textOfNode(k);
            cur().push(nodeTypes.field!.create({ kind: spec.kind, arg: spec.arg, switches: spec.switches, result: result || null }, null, this.marks({}, {}, null)));
          } else this.inline(kidsOf(k), link, rc, cur, onPageBreak);
          break;
        }
        case 'bookmarkStart': {
          const name = attrOf(k, 'name') ?? '';
          if (name && name !== '_GoBack' && !this.suppressed()) cur().push(nodeTypes.bookmark!.create({ name }));
          break;
        }
        case 'commentRangeStart': {
          const id = 'c' + (attrOf(k, 'id') ?? '');
          if (this.sh.comments.has(id) && !this.activeComments.includes(id)) this.activeComments.push(id);
          break;
        }
        case 'commentRangeEnd': {
          const id = 'c' + (attrOf(k, 'id') ?? '');
          this.activeComments = this.activeComments.filter((x) => x !== id);
          break;
        }
        case 'oMathPara':
          for (const m of kidsOf(k)) if (tagOf(m) === 'oMath') this.math(m, true, cur);
          break;
        case 'oMath': this.math(k, false, cur); break;
        default:
      }
    }
  }

  private math(m: XNode, display: boolean, cur: () => PMNode[]) {
    if (this.suppressed()) return;
    const tree = fromOMML(kidsOf(m), tagOf, kidsOf, (n, a) => attrOf(n, a), textOfNode);
    const tex = toTex(tree).trim();
    if (tex) cur().push(nodeTypes.math!.create({ tex, display }));
  }

  private inlineSdt(sdt: XNode, link: string | null, rc: { base: RP; builtin: boolean }, cur: () => PMNode[], onPageBreak: () => void) {
    const pr = findKid(sdt, 'sdtPr');
    const content = findKid(sdt, 'sdtContent');
    if (!content) return;
    const alias = attrOf(findKid(pr, 'alias') ?? {}, 'val') ?? '';
    const tag = attrOf(findKid(pr, 'tag') ?? {}, 'val') ?? '';
    const id = attrOf(findKid(pr, 'id') ?? {}, 'val') ?? '';
    const lock = attrOf(findKid(pr, 'lock') ?? {}, 'val') ?? null;
    const showing = !!findKid(pr, 'showingPlcHdr');
    let type = 'richText';
    let items: { label: string; value: string }[] | null = null;
    let dateFormat = 'dd/MM/yyyy';
    let checked = false;
    if (findKid(pr, 'text')) type = 'text';
    else if (findKid(pr, 'dropDownList') || findKid(pr, 'comboBox')) {
      const node = findKid(pr, 'dropDownList') ?? findKid(pr, 'comboBox')!;
      type = findKid(pr, 'comboBox') ? 'combo' : 'dropdown';
      items = findKids(node, 'listItem').map((i) => ({ label: attrOf(i, 'displayText') ?? attrOf(i, 'value') ?? '', value: attrOf(i, 'value') ?? '' }));
    } else if (findKid(pr, 'date')) {
      type = 'date';
      dateFormat = attrOf(findKid(findKid(pr, 'date')!, 'dateFormat') ?? {}, 'val') ?? dateFormat;
    } else if (findDeep(pr ?? {}, 'checkbox')) {
      type = 'checkbox';
      const ch = attrOf(findDeep(pr ?? {}, 'checked') ?? {}, 'val');
      checked = ch === '1' || ch === 'true';
    } else if (findKid(pr, 'picture') || findKid(pr, 'docPartObj')) {
      // not modelled: keep the content
      this.inline(kidsOf(content), link, rc, cur, onPageBreak);
      return;
    }
    const inner: PMNode[] = [];
    this.inline(kidsOf(content), link, rc, () => inner, onPageBreak);
    const control = nodeTypes.content_control!.create({ id, type, tag, title: alias, showing, checked, items, dateFormat, lock }, inner);
    cur().push(control);
  }

  private suppressed(): boolean {
    return this.fields.some((f) => f.phase === 'instr');
  }

  private captureField(): FieldState | undefined {
    for (let i = this.fields.length - 1; i >= 0; i--) if (this.fields[i]!.mode === 'capture' && this.fields[i]!.phase === 'result') return this.fields[i];
    return undefined;
  }

  private run(r: XNode, link: string | null, rc: { base: RP; builtin: boolean }, cur: () => PMNode[], onPageBreak: () => void) {
    const sh = this.sh;
    const direct = parseRPr(findKid(r, 'rPr'), sh.fonts);
    const rStyle = attrOf(findKid(findKid(r, 'rPr') ?? {}, 'rStyle') ?? {}, 'val');
    const charRP = rStyle && sh.styles.get(rStyle)?.name.toLowerCase() !== 'hyperlink' ? resolveChain(sh, rStyle).rp : {};
    const eff = merge(rc.builtin ? {} : sh.baseRP, rc.base, charRP, direct);
    // a field with mode "link" turns its result runs into a link
    const lf = [...this.fields].reverse().find((f) => f.mode === 'link' && f.phase === 'result');
    const marks = this.marks(eff, rc.builtin ? {} : sh.baseRP, lf?.href ?? link);
    let buf = '';
    const flush = () => {
      if (buf) cur().push(writerSchema.text(buf, marks));
      buf = '';
    };
    const children = (list: XNode[]) => {
      for (const c of list) {
        const t = tagOf(c);
        if (t === 'fldChar') {
          const ty = attrOf(c, 'fldCharType');
          if (ty === 'begin') this.fields.push({ instr: '', phase: 'instr', mode: 'normal', result: '', marks });
          else if (ty === 'separate') {
            const f = this.fields[this.fields.length - 1];
            if (f) {
              f.phase = 'result';
              const spec = parseFieldInstr(f.instr);
              const href = hyperlinkOf(f.instr);
              if (spec && !this.captureField()) {
                f.mode = 'capture';
                f.spec = spec;
              } else if (href) {
                f.mode = 'link';
                f.href = href;
              }
            }
          } else if (ty === 'end') {
            flush();
            const f = this.fields.pop();
            if (f && f.mode === 'capture' && f.spec) {
              const result = f.result;
              const outer = this.captureField();
              if (outer) outer.result += result;
              else cur().push(nodeTypes.field!.create({ kind: f.spec.kind, arg: f.spec.arg, switches: f.spec.switches, result: result || null }, null, f.marks));
            } else if (f && !f.spec && f.phase === 'instr') {
              // a field without result (XE entries): keep what we understand
              const spec = parseFieldInstr(f.instr);
              if (spec && !this.suppressed()) cur().push(nodeTypes.field!.create({ kind: spec.kind, arg: spec.arg, switches: spec.switches, result: '' }, null, f.marks));
            }
          }
          continue;
        }
        if (t === 'instrText') {
          const f = this.fields[this.fields.length - 1];
          if (f && f.phase === 'instr') f.instr += textOfNode(c);
          continue;
        }
        if (this.suppressed()) continue;
        const cap = this.captureField();
        if (cap) {
          if (t === 't' || t === 'delText') cap.result += textOfNode(c);
          else if (t === 'tab') cap.result += '\t';
          continue;
        }
        switch (t) {
          case 't':
          case 'delText': buf += textOfNode(c); break;
          case 'tab': buf += '\t'; break;
          case 'noBreakHyphen': buf += '‑'; break;
          case 'br': {
            const ty = attrOf(c, 'type');
            flush();
            if (ty === 'page') onPageBreak();
            else cur().push(nodeTypes.hard_break!.create());
            break;
          }
          case 'cr': flush(); cur().push(nodeTypes.hard_break!.create()); break;
          case 'drawing': flush(); this.drawing(c, cur, marks); break;
          case 'pict': flush(); this.pict(c, cur); break;
          case 'AlternateContent': {
            flush();
            const choice = findKid(c, 'Choice');
            if (choice) children(kidsOf(choice));
            break;
          }
          case 'footnoteReference':
          case 'endnoteReference': {
            flush();
            const kind = t === 'footnoteReference' ? 'footnote' : 'endnote';
            const id = attrOf(c, 'id') ?? '';
            const body = (kind === 'footnote' ? this.sh.footnotes : this.sh.endnotes).get(id);
            cur().push(nodeTypes.footnote!.create({ kind, id: `${kind[0]}${id}-${++this.sh.noteSeq}`, body: body ? noteBodyOf(blocksOf(body)) : null }, null, marks.filter((m) => m.type.name !== 'comment')));
            break;
          }
          default:
        }
      }
    };
    children(kidsOf(r));
    flush();
  }

  private marks(eff: RP, base: RP, href: string | null): Mark[] {
    const m: Mark[] = [];
    if (eff.b && !base.b) m.push(markTypes.strong!.create());
    if (eff.i && !base.i) m.push(markTypes.em!.create());
    if (eff.u && !base.u) m.push(markTypes.underline!.create());
    if (eff.strike && !base.strike) m.push(markTypes.strike!.create());
    if (eff.color && eff.color !== base.color) m.push(markTypes.color!.create({ value: eff.color }));
    if (eff.hl && eff.hl !== base.hl) m.push(markTypes.highlight!.create({ value: eff.hl }));
    if (eff.font && eff.font !== base.font) m.push(markTypes.fontFamily!.create({ value: eff.font }));
    if (eff.sz && eff.sz !== base.sz) m.push(markTypes.fontSize!.create({ value: eff.sz }));
    if (eff.vert) m.push((eff.vert === 'superscript' ? markTypes.superscript : markTypes.subscript)!.create());
    if (eff.caps) m.push(markTypes.caps!.create({ value: eff.caps }));
    if (eff.lang && eff.lang !== base.lang) m.push(markTypes.lang!.create({ value: eff.lang }));
    if (href) m.push(markTypes.link!.create({ href }));
    for (const id of this.activeComments) {
      const info = this.sh.comments.get(id);
      if (info && !info.parent) m.push(markTypes.comment!.create({ id }));
    }
    if (this.ins) m.push(markTypes.ins!.create({ id: this.ins.id, author: this.ins.author, date: this.ins.date }));
    if (this.del) m.push(markTypes.del!.create({ id: this.del.id, author: this.del.author, date: this.del.date }));
    return m;
  }

  private image(rid: string | undefined, w: number | null, h: number | null, alt: string, cur: () => PMNode[], marks: Mark[] = []) {
    const rel = rid ? this.rels.get(rid) : undefined;
    if (!rel) return;
    if (rel.external) {
      this.warn('Hay imágenes vinculadas a un archivo externo; se omiten.');
      return;
    }
    const path = this.baseDir + rel.target.replace(/^\//, '').replace(/^word\//, '');
    const uri = this.sh.media.get(path.replace(/^word\/word\//, 'word/'));
    if (!uri) {
      this.warn(`Formato de imagen no admitido (${rel.target.split('.').pop()}); se omite.`);
      return;
    }
    cur().push(nodeTypes.image!.create({ src: uri, alt, width: w, height: h }, null, marks.filter((m) => m.type.name === 'ins' || m.type.name === 'del' || m.type.name === 'comment')));
  }

  private drawing(d: XNode, cur: () => PMNode[], marks: Mark[]) {
    const wsp = findDeep(d, 'wsp');
    if (wsp) {
      this.shape(d, wsp, cur);
      return;
    }
    if (findDeep(d, 'wgp') || findDeep(d, 'grpSp')) {
      this.warn('Los grupos de formas no se admiten y se omiten.');
      return;
    }
    if (findDeep(d, 'anchor')) this.warn('Las imágenes flotantes se convierten en imágenes en línea.');
    const blip = findDeep(d, 'blip');
    if (!blip) {
      if (findDeep(d, 'chart') || findDeep(d, 'dgm')) this.warn('Los gráficos y diagramas incrustados no se admiten y se omiten.');
      return;
    }
    const ext = findDeep(d, 'extent');
    const cx = num(ext && attrOf(ext, 'cx')), cy = num(ext && attrOf(ext, 'cy'));
    const pr = findDeep(d, 'docPr');
    this.image(attrOf(blip, 'embed'), cx ? Math.round(cx / EMU_PER_PX) : null, cy ? Math.round(cy / EMU_PER_PX) : null, (pr && (attrOf(pr, 'descr') ?? attrOf(pr, 'title'))) || '', cur, marks);
  }

  /** A DrawingML shape (`wps:wsp`) or text box. */
  private shape(d: XNode, wsp: XNode, cur: () => PMNode[]) {
    const ext = findDeep(d, 'extent');
    const w = Math.max(10, Math.round((num(ext && attrOf(ext, 'cx')) ?? 1143000) / EMU_PER_PX));
    const h = Math.max(10, Math.round((num(ext && attrOf(ext, 'cy')) ?? 762000) / EMU_PER_PX));
    const spPr = findKid(wsp, 'spPr');
    const geom = findKid(spPr, 'prstGeom');
    const prst = attrOf(geom ?? {}, 'prst') ?? 'rect';
    const isTxBox = !!attrOf(findKid(wsp, 'cNvSpPr') ?? {}, 'txBox');
    let kind = PRST_SHAPE[prst] ?? 'rect';
    if (!PRST_SHAPE[prst] && prst !== 'rect') this.warn(`La forma "${prst}" se muestra como un rectángulo.`);
    if (isTxBox && kind === 'rect') kind = 'textbox';
    const colorOf = (n: XNode | undefined): string | null => {
      const sf = n && findKid(n, 'solidFill');
      const c = sf && findKid(sf, 'srgbClr');
      const v = c && attrOf(c, 'val');
      return v && /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null;
    };
    const noFill = !!(spPr && findKid(spPr, 'noFill'));
    const fill = noFill ? '#ffffff' : (colorOf(spPr) ?? '#ffffff');
    const ln = spPr && findKid(spPr, 'ln');
    const noLine = !!(ln && findKid(ln, 'noFill'));
    const stroke = colorOf(ln) ?? '#000000';
    const strokeWidth = noLine ? 0 : Math.max(0, (num(ln && attrOf(ln, 'w')) ?? 12700) / 9525);
    const xfrm = spPr && findKid(spPr, 'xfrm');
    const rot = num(xfrm && attrOf(xfrm, 'rot'));
    // text of the shape
    const tx = findKid(findKid(wsp, 'txbx') ?? {}, 'txbxContent');
    const paras: PMNode[] = [];
    if (tx) for (const b of this.blocks(kidsOf(tx))) if (b.type.name === 'paragraph') paras.push(b);
    // anchoring
    const anchor = findDeep(d, 'anchor');
    let wrap = 'inline';
    let x = 0, y = 0;
    if (anchor) {
      const behind = attrOf(anchor, 'behindDoc') === '1' || attrOf(anchor, 'behindDoc') === 'true';
      const ph = findKid(anchor, 'positionH');
      const pv = findKid(anchor, 'positionV');
      if (findKid(anchor, 'wrapTopAndBottom')) wrap = 'topBottom';
      else if (findKid(anchor, 'wrapSquare') || findKid(anchor, 'wrapTight') || findKid(anchor, 'wrapThrough')) {
        const align = textOfNode(findKid(ph ?? {}, 'align') ?? {});
        wrap = align === 'right' ? 'right' : 'left';
      } else wrap = behind ? 'behind' : 'front';
      x = Math.round((num(textOfNode(findKid(ph ?? {}, 'posOffset') ?? {})) ?? 0) / EMU_PER_PX);
      y = Math.round((num(textOfNode(findKid(pv ?? {}, 'posOffset') ?? {})) ?? 0) / EMU_PER_PX);
    }
    const pr = findDeep(d, 'docPr');
    cur().push(
      nodeTypes.shape!.create(
        { kind, width: w, height: h, fill, stroke, strokeWidth, rotation: rot ? Math.round((rot / 60000) * 10) / 10 : 0, wrap, x, y, alt: (pr && attrOf(pr, 'descr')) || '' },
        paras,
      ),
    );
  }

  private pict(p: XNode, cur: () => PMNode[]) {
    const img = findDeep(p, 'imagedata');
    const shape = findDeep(p, 'shape');
    const style = (shape && attrOf(shape, 'style')) || '';
    const px = (name: string) => {
      const m = new RegExp(`${name}:([\\d.]+)(pt|px)?`).exec(style);
      return m ? Math.round(parseFloat(m[1]!) * (m[2] === 'px' ? 1 : 96 / 72)) : null;
    };
    if (shape && /PowerPlusWaterMarkObject|WordPictureWatermark/i.test(attrOf(shape, 'id') ?? '')) return; // read as the document watermark
    if (img) {
      this.image(attrOf(img, 'id'), px('width'), px('height'), attrOf(img, 'title') ?? '', cur);
      return;
    }
    const tbx = findDeep(p, 'txbxContent');
    if (tbx) {
      const paras = this.blocks(kidsOf(tbx)).filter((b) => b.type.name === 'paragraph');
      cur().push(nodeTypes.shape!.create({ kind: 'textbox', width: px('width') ?? 200, height: px('height') ?? 80, fill: '#ffffff', stroke: '#000000', strokeWidth: 1 }, paras));
      return;
    }
    if (kidsOf(p).length) this.warn('Algunas formas (VML) no se admiten y se omiten.');
  }

  // -- tables --

  private table(t: XNode): PMNode {
    const sh = this.sh;
    const tblPr = findKid(t, 'tblPr');
    const styleId = attrOf(findKid(tblPr, 'tblStyle') ?? {}, 'val');
    const bordersNode = findKid(tblPr, 'tblBorders');
    let borders = resolveChain(sh, styleId).borders;
    if (bordersNode) borders = kidsOf(bordersNode).some((e) => !['nil', 'none'].includes(attrOf(e, 'val') ?? 'nil'));
    const grid = findKids(findKid(t, 'tblGrid'), 'gridCol').map((g) => Math.round((num(attrOf(g, 'w')) ?? 0) / 15));

    interface Cell { col: number; span: number; rowspan: number; node: XNode }
    const rows: Cell[][] = [];
    const origin: (Cell | undefined)[] = [];
    for (const tr of findKids(t, 'tr')) {
      const row: Cell[] = [];
      let col = 0;
      const trPr = findKid(tr, 'trPr');
      if (findKid(trPr, 'gridBefore')) col += num(attrOf(findKid(trPr, 'gridBefore')!, 'val')) ?? 0;
      for (const tc of findKids(tr, 'tc')) {
        const tcPr = findKid(tc, 'tcPr');
        const span = num(attrOf(findKid(tcPr, 'gridSpan') ?? {}, 'val')) ?? 1;
        const vm = findKid(tcPr, 'vMerge');
        const vmVal = vm ? (attrOf(vm, 'val') ?? 'continue') : null;
        if (vmVal === 'continue' && origin[col]) {
          origin[col]!.rowspan++;
        } else {
          const cell: Cell = { col, span, rowspan: 1, node: tc };
          row.push(cell);
          origin[col] = cell;
        }
        col += span;
      }
      rows.push(row);
    }
    const trNodes = rows.map((row) => {
      const cells = row.map((c) => {
        const tcPr = findKid(c.node, 'tcPr');
        const shd = attrOf(findKid(tcPr, 'shd') ?? {}, 'fill');
        const va = attrOf(findKid(tcPr, 'vAlign') ?? {}, 'val');
        const widths = Array.from({ length: c.span }, (_, i) => grid[c.col + i] || 0);
        const content = this.blocks(kidsOf(c.node).filter((k) => tagOf(k) !== 'tcPr'));
        return nodeTypes.table_cell!.create(
          { colspan: c.span, rowspan: c.rowspan, colwidth: widths.every((w) => w > 0) ? widths : null, background: shd && shd !== 'auto' ? '#' + shd.toLowerCase() : null, vAlign: va === 'center' ? 'middle' : va === 'bottom' ? 'bottom' : va === 'top' ? 'top' : null },
          content.length ? content : [nodeTypes.paragraph!.create()],
        );
      });
      return nodeTypes.table_row!.create(null, cells.length ? cells : [nodeTypes.table_cell!.create(null, [nodeTypes.paragraph!.create()])]);
    });
    return nodeTypes.table!.create({ borders }, trNodes.length ? trNodes : [nodeTypes.table_row!.create(null, [nodeTypes.table_cell!.create(null, [nodeTypes.paragraph!.create()])])]);
  }
}

const blocksOf = (doc: PMNode): PMNode[] => {
  const out: PMNode[] = [];
  doc.forEach((b) => {
    if (b.type.name === 'paragraph') out.push(b);
  });
  return out;
};

function hyperlinkOf(instr: string): string | null {
  const m = /^\s*HYPERLINK\s+(?:\\l\s+)?"([^"]*)"/i.exec(instr);
  if (!m) return null;
  return /\\l\s/i.test(instr) ? '#' + m[1] : m[1]!;
}

function buildLists(items: ListItem[]): PMNode[] {
  let prev = -1;
  for (const it of items) {
    it.level = Math.min(it.level, prev + 1);
    prev = it.level;
  }
  const li = (content: PMNode[]) => nodeTypes.list_item!.create(null, content);
  const build = (i: number, level: number): { nodes: PMNode[]; next: number } => {
    const nodes: PMNode[] = [];
    while (i < items.length && items[i]!.level >= level) {
      const kind = items[i]!.kind;
      const start = items[i]!.ordinal;
      const lis: PMNode[] = [];
      while (i < items.length && items[i]!.level === level && items[i]!.kind === kind) {
        const content = [items[i]!.para];
        i++;
        if (i < items.length && items[i]!.level > level) {
          const r = build(i, level + 1);
          content.push(...r.nodes);
          i = r.next;
        }
        lis.push(li(content));
      }
      nodes.push(kind === 'bullet' ? nodeTypes.bullet_list!.create(null, lis) : nodeTypes.ordered_list!.create({ format: kind, start }, lis));
    }
    return { nodes, next: i };
  };
  return build(0, 0).nodes;
}

// ---------- entry point ----------

async function text(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path);
  return f ? f.async('string') : null;
}

function parseNumbering(xml: string | null): Pick<Shared, 'numbering' | 'abstracts'> {
  const numbering: Shared['numbering'] = new Map();
  const abstracts: Shared['abstracts'] = new Map();
  if (!xml) return { numbering, abstracts };
  const root = rootOf(parseXml(xml), 'numbering');
  for (const a of findKids(root, 'abstractNum')) {
    const id = num(attrOf(a, 'abstractNumId'));
    if (id === undefined) continue;
    const lv = new Map<number, { fmt: ListFormat | 'bullet'; start: number }>();
    for (const l of findKids(a, 'lvl')) {
      const il = num(attrOf(l, 'ilvl')) ?? 0;
      const f = attrOf(findKid(l, 'numFmt') ?? {}, 'val') ?? 'decimal';
      const fmt: ListFormat | 'bullet' = f === 'bullet' || f === 'none' ? 'bullet' : f === 'lowerLetter' || f === 'upperLetter' || f === 'lowerRoman' || f === 'upperRoman' ? f : 'decimal';
      lv.set(il, { fmt, start: num(attrOf(findKid(l, 'start') ?? {}, 'val')) ?? 1 });
    }
    abstracts.set(id, lv);
  }
  for (const n of findKids(root, 'num')) {
    const id = num(attrOf(n, 'numId'));
    const abs = num(attrOf(findKid(n, 'abstractNumId') ?? {}, 'val'));
    if (id === undefined || abs === undefined) continue;
    const start = new Map<number, number>();
    for (const o of findKids(n, 'lvlOverride')) {
      const s = findKid(o, 'startOverride');
      if (s) start.set(num(attrOf(o, 'ilvl')) ?? 0, num(attrOf(s, 'val')) ?? 1);
    }
    numbering.set(id, { abstract: abs, start });
  }
  return { numbering, abstracts };
}

function parseStyles(xml: string | null, fonts: Fonts): { styles: Map<string, StyleDef>; docRP: RP; docPP: PP } {
  const styles = new Map<string, StyleDef>();
  let docRP: RP = {}, docPP: PP = {};
  if (!xml) return { styles, docRP, docPP };
  const root = rootOf(parseXml(xml), 'styles');
  const dd = findKid(root, 'docDefaults');
  docRP = parseRPr(findKid(findKid(dd, 'rPrDefault'), 'rPr'), fonts);
  docPP = parsePPr(findKid(findKid(dd, 'pPrDefault'), 'pPr'));
  for (const s of findKids(root, 'style')) {
    const id = attrOf(s, 'styleId');
    if (!id) continue;
    const tb = findKid(findKid(s, 'tblPr'), 'tblBorders');
    styles.set(id, {
      id,
      type: attrOf(s, 'type') ?? 'paragraph',
      name: attrOf(findKid(s, 'name') ?? {}, 'val') ?? id,
      basedOn: attrOf(findKid(s, 'basedOn') ?? {}, 'val'),
      pp: parsePPr(findKid(s, 'pPr')),
      rp: parseRPr(findKid(s, 'rPr'), fonts),
      borders: tb ? kidsOf(tb).some((e) => !['nil', 'none'].includes(attrOf(e, 'val') ?? 'nil')) : undefined,
    });
  }
  return { styles, docRP, docPP };
}

/** Scale images that do not fit the text area of a page, keeping their proportions (inline images cannot overflow a page). */
function clampImages(node: PMNode, maxW: number, maxH: number): PMNode {
  if (node.type.name === 'image') {
    const w: number | null = node.attrs.width, h: number | null = node.attrs.height;
    if (!w || !h) return node;
    const k = Math.min(1, maxW / w, maxH / h);
    return k < 1 ? node.type.create({ ...node.attrs, width: Math.round(w * k), height: Math.round(h * k) }, null, node.marks) : node;
  }
  if (node.isLeaf) return node;
  const kids: PMNode[] = [];
  let changed = false;
  node.forEach((c) => {
    const n = clampImages(c, maxW, maxH);
    if (n !== c) changed = true;
    kids.push(n);
  });
  return changed ? node.copy(Fragment.fromArray(kids)) : node;
}

// ---------- comments, notes, settings ----------

function readComments(xml: string | null, extXml: string | null): { data: CommentData[]; info: Map<string, CommentInfo> } {
  const data: CommentData[] = [];
  const info = new Map<string, CommentInfo>();
  if (!xml) return { data, info };
  const root = rootOf(parseXml(xml), 'comments');
  const paraOfId = new Map<string, string>(); // last paragraph id of each comment → comment id
  const list = findKids(root, 'comment');
  for (const c of list) {
    const wid = attrOf(c, 'id') ?? '';
    const id = 'c' + wid;
    const paras = findKids(c, 'p');
    const textParts = paras.map((p) => textOfNode(p).replace(/\s+$/, ''));
    const pid = paras.length ? attrOf(paras[paras.length - 1]!, 'paraId') : undefined;
    if (pid) paraOfId.set(pid.toUpperCase(), id);
    data.push({ id, author: attrOf(c, 'author') ?? '', initials: attrOf(c, 'initials') ?? '', date: attrOf(c, 'date') ?? '', text: textParts.join('\n').trim(), parent: null, done: false });
  }
  if (extXml) {
    const eroot = rootOf(parseXml(extXml), 'commentsEx');
    for (const e of findKids(eroot, 'commentEx')) {
      const pid = (attrOf(e, 'paraId') ?? '').toUpperCase();
      const parentPid = (attrOf(e, 'paraIdParent') ?? '').toUpperCase();
      const cid = paraOfId.get(pid);
      const d = data.find((x) => x.id === cid);
      if (!d) continue;
      if (parentPid && paraOfId.has(parentPid)) d.parent = paraOfId.get(parentPid)!;
      d.done = attrOf(e, 'done') === '1' || attrOf(e, 'done') === 'true';
    }
  }
  for (const d of data) info.set(d.id, { id: d.id, parent: d.parent });
  return { data, info };
}

async function readNotes(zip: JSZip, file: string, root: 'footnotes' | 'endnotes', sh: Shared, store: Map<string, PMNode>): Promise<void> {
  const xml = await text(zip, file);
  if (!xml) return;
  const rels = parseRels(await text(zip, file.replace('word/', 'word/_rels/') + '.rels'));
  const r = rootOf(parseXml(xml), root);
  const tag = root === 'footnotes' ? 'footnote' : 'endnote';
  for (const n of findKids(r, tag)) {
    const type = attrOf(n, 'type');
    if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue;
    const id = attrOf(n, 'id') ?? '';
    const conv = new Converter(sh, rels);
    const blocks = conv.blocks(kidsOf(n));
    // the reference mark and the space that follows it are drawn by the editor
    const fixed = blocks.map((b, i) => {
      if (i !== 0 || b.type.name !== 'paragraph') return b;
      const first = b.firstChild;
      if (first && first.isText && first.text!.startsWith(' ')) {
        const rest = first.text!.slice(1);
        const kids: PMNode[] = [];
        if (rest) kids.push(writerSchema.text(rest, first.marks));
        b.forEach((c, _o, idx) => {
          if (idx > 0) kids.push(c);
        });
        return b.type.create(b.attrs, kids, b.marks);
      }
      return b;
    });
    store.set(id, nodeTypes.doc!.create(null, fixed.length ? fixed : [nodeTypes.paragraph!.create()]));
  }
}

function readProtection(settings: XNode | undefined): Protection | null {
  const dp = findKid(settings, 'documentProtection');
  if (!dp) return null;
  const enforced = attrOf(dp, 'enforcement');
  if (enforced !== '1' && enforced !== 'true') return null;
  const edit = attrOf(dp, 'edit');
  if (edit !== 'readOnly' && edit !== 'forms' && edit !== 'comments' && edit !== 'trackedChanges') return null;
  const hash = attrOf(dp, 'hash');
  const salt = attrOf(dp, 'salt');
  const out: Protection = { mode: edit };
  if (hash && salt) out.hash = { algorithm: 'SHA-512', hash, salt, spin: num(attrOf(dp, 'spinCount')) ?? num(attrOf(dp, 'cryptSpinCount')) ?? 100000 };
  return out;
}

function readNotesOptions(settings: XNode | undefined): Partial<NotesOptions> {
  const out: Partial<NotesOptions> = {};
  const fmt = (n: XNode | undefined): NotesOptions['footnoteFormat'] | undefined => {
    const v = attrOf(findKid(n, 'numFmt') ?? {}, 'val');
    if (!v) return undefined;
    return v === 'lowerLetter' || v === 'upperLetter' || v === 'lowerRoman' || v === 'upperRoman' ? v : v === 'chicago' ? 'symbols' : 'decimal';
  };
  const fp = findKid(settings, 'footnotePr');
  const ep = findKid(settings, 'endnotePr');
  const f = fmt(fp);
  if (f) out.footnoteFormat = f;
  if (attrOf(findKid(fp, 'numRestart') ?? {}, 'val') === 'eachSect') out.footnoteRestart = 'section';
  const e = fmt(ep);
  if (e) out.endnoteFormat = e;
  return out;
}

const SRC_TYPE: Record<string, Source['type']> = { Book: 'book', BookSection: 'bookSection', JournalArticle: 'article', ConferenceProceedings: 'conference', Report: 'report', InternetSite: 'web', DocumentFromInternetSite: 'website', Film: 'film', Interview: 'interview' };

function readSources(xml: string): Source[] {
  const root = rootOf(parseXml(xml), 'Sources');
  const out: Source[] = [];
  const val = (n: XNode, tag: string) => textOfNode(findKid(n, tag) ?? {});
  for (const s of findKids(root, 'Source')) {
    const names = allDeep(s, 'Person').map((p) => {
      const last = textOfNode(findKid(p, 'Last') ?? {});
      const first = textOfNode(findKid(p, 'First') ?? {});
      return first ? `${last}, ${first}` : last;
    });
    out.push({
      tag: val(s, 'Tag'), type: SRC_TYPE[val(s, 'SourceType')] ?? 'other', authors: names, title: val(s, 'Title'), year: val(s, 'Year'), publisher: val(s, 'Publisher'), city: val(s, 'City'),
      journal: val(s, 'JournalName'), volume: val(s, 'Volume'), issue: val(s, 'Issue'), pages: val(s, 'Pages'), url: val(s, 'URL'), accessed: '', doi: val(s, 'DOI'), edition: val(s, 'Edition'),
    });
  }
  return out;
}

/** Look for a watermark in a header: the VML WordArt (or picture) shape Word writes. */
function findWatermark(root: XNode, rels: Map<string, Rel>, media: Map<string, string>): Watermark | null {
  for (const shape of allDeep(root, 'shape')) {
    const id = attrOf(shape, 'id') ?? '';
    if (!/PowerPlusWaterMarkObject|WordPictureWatermark/i.test(id)) continue;
    const style = attrOf(shape, 'style') ?? '';
    const tp = findDeep(shape, 'textpath');
    const fill = findDeep(shape, 'fill');
    const semi = !!fill && attrOf(fill, 'opacity') !== undefined;
    const rotated = /rotation:\s*(315|-45)/.test(style);
    if (tp) {
      const font = /font-family:"?'?([^";']+)/.exec(attrOf(tp, 'style') ?? '')?.[1] ?? 'Calibri';
      const color = (attrOf(shape, 'fillcolor') ?? '#c0c0c0').toString();
      const named: Record<string, string> = { silver: '#c0c0c0', gray: '#808080', red: '#ff0000', black: '#000000' };
      const c = /^#[0-9a-f]{6}$/i.test(color) ? color : (named[color.toLowerCase()] ?? '#c0c0c0');
      return { text: attrOf(tp, 'string') ?? '', image: null, font, color: c, size: 0, semitransparent: semi, layout: rotated ? 'diagonal' : 'horizontal', scale: 100 };
    }
    const img = findDeep(shape, 'imagedata');
    if (img) {
      const rel = rels.get(attrOf(img, 'id') ?? '');
      const uri = rel && media.get('word/' + rel.target.replace(/^\/?(word\/)?/, ''));
      if (uri) return { text: null, image: uri, font: 'Calibri', color: '#c0c0c0', size: 0, semitransparent: semi, layout: rotated ? 'diagonal' : 'horizontal', scale: 100 };
    }
  }
  return null;
}

export async function readDocx(data: Uint8Array | ArrayBuffer): Promise<ReadResult> {
  const zip = await JSZip.loadAsync(data);
  const warnings = new Set<string>();
  const docXml = await text(zip, 'word/document.xml');
  if (!docXml) throw new Error('El archivo no es un documento de Word válido (falta word/document.xml).');

  const theme = await text(zip, 'word/theme/theme1.xml');
  const fonts: Fonts = {
    minor: theme ? /<(?:a:)?minorFont>\s*<(?:a:)?latin\s+typeface="([^"]*)"/.exec(theme)?.[1] : undefined,
    major: theme ? /<(?:a:)?majorFont>\s*<(?:a:)?latin\s+typeface="([^"]*)"/.exec(theme)?.[1] : undefined,
  };
  const { styles, docRP, docPP } = parseStyles(await text(zip, 'word/styles.xml'), fonts);
  const normal = [...styles.values()].find((s) => s.type === 'paragraph' && s.name.toLowerCase() === 'normal');
  const baseRP = merge(docRP, normal?.rp ?? {});
  const basePP = merge(docPP, normal?.pp ?? {});
  const { numbering, abstracts } = parseNumbering(await text(zip, 'word/numbering.xml'));

  const media = new Map<string, string>();
  await Promise.all(
    Object.keys(zip.files)
      .filter((p) => p.startsWith('word/media/'))
      .map(async (p) => {
        const mime = MIME[p.split('.').pop()!.toLowerCase()];
        if (mime) media.set(p, `data:${mime};base64,${await zip.file(p)!.async('base64')}`);
      }),
  );

  const commentsRead = readComments(await text(zip, 'word/comments.xml'), await text(zip, 'word/commentsExtended.xml'));
  const sh: Shared = {
    zip, styles, baseRP, basePP, fonts, numbering, abstracts, media, warnings, counters: new Map(), sections: 0,
    comments: commentsRead.info, footnotes: new Map(), endnotes: new Map(), noteSeq: 0,
  };
  await readNotes(zip, 'word/footnotes.xml', 'footnotes', sh, sh.footnotes);
  await readNotes(zip, 'word/endnotes.xml', 'endnotes', sh, sh.endnotes);

  const mainRels = parseRels(await text(zip, 'word/_rels/document.xml.rels'));
  const main = new Converter(sh, mainRels);
  const root = rootOf(parseXml(docXml), 'document');
  const bodyNode = findKid(root, 'body');
  const bodyKids = kidsOf(bodyNode ?? {});

  const settingsXml = await text(zip, 'word/settings.xml');
  const settings = settingsXml ? rootOf(parseXml(settingsXml), 'settings') : undefined;
  const evenAndOdd = !!findKid(settings, 'evenAndOddHeaders');
  const trackChanges = !!findKid(settings, 'trackRevisions');
  const protection = readProtection(settings);
  const noteOpts = readNotesOptions(settings);

  // header and footer parts (read once, shared by the sections that point at them)
  const parts: Record<string, PMNode> = {};
  let watermark: Watermark | null = null;
  const readPart = async (relId: string | undefined, kind: 'header' | 'footer'): Promise<string | null> => {
    const rel = relId ? mainRels.get(relId) : undefined;
    if (!rel) return null;
    const file = 'word/' + rel.target.replace(/^\/?(word\/)?/, '');
    if (parts[file]) return file;
    const xml = await text(zip, file);
    if (!xml) return null;
    const rels = parseRels(await text(zip, file.replace('word/', 'word/_rels/') + '.rels'));
    const r = rootOf(parseXml(xml), kind === 'header' ? 'hdr' : 'ftr');
    let kids = kidsOf(r ?? {});
    let onlyWatermark = false;
    if (kind === 'header' && r) {
      const wm = findWatermark(r, rels, media);
      if (wm) {
        watermark ??= wm;
        // the paragraph that only holds the watermark is not part of the header text
        const before = kids.length;
        kids = kids.filter((k) => !(tagOf(k) === 'p' && allDeep(k, 'shape').some((s) => /PowerPlusWaterMarkObject|WordPictureWatermark/i.test(attrOf(s, 'id') ?? '')) && textOfNode(k).trim() === ''));
        onlyWatermark = before > 0 && kids.every((k) => tagOf(k) === 'p' && textOfNode(k).trim() === '' && !findDeep(k, 'drawing') && !findDeep(k, 'pict'));
      }
    }
    if (onlyWatermark) return null;
    const content = new Converter(sh, rels).blocks(kids);
    parts[file] = nodeTypes.doc!.create(null, content.length ? content : [nodeTypes.paragraph!.create()]);
    return file;
  };

  const sectionOf = async (sect: XNode | undefined): Promise<SectionProps> => {
    const props = defaultSection();
    props.id = newSectionId();
    if (!sect) return props;
    const page = props.page;
    const sz = findKid(sect, 'pgSz');
    const mar = findKid(sect, 'pgMar');
    const pt = (n: XNode | undefined, at: string, fb: number) => {
      const v = n && num(attrOf(n, at));
      return v ? twipsToPt(v) : fb;
    };
    page.width = pt(sz, 'w', page.width);
    page.height = pt(sz, 'h', page.height);
    page.marginTop = pt(mar, 'top', page.marginTop);
    page.marginBottom = pt(mar, 'bottom', page.marginBottom);
    page.marginLeft = pt(mar, 'left', page.marginLeft);
    page.marginRight = pt(mar, 'right', page.marginRight);
    page.headerDistance = pt(mar, 'header', page.headerDistance);
    page.footerDistance = pt(mar, 'footer', page.footerDistance);
    const type = attrOf(findKid(sect, 'type') ?? {}, 'val');
    props.start = type === 'continuous' ? 'continuous' : type === 'evenPage' ? 'evenPage' : type === 'oddPage' ? 'oddPage' : 'nextPage';
    props.titlePg = !!findKid(sect, 'titlePg');
    const cols = findKid(sect, 'cols');
    if (cols) {
      const n = num(attrOf(cols, 'num')) ?? 1;
      const c: Columns = { ...oneColumn(), count: Math.max(1, Math.min(12, n)) };
      const space = num(attrOf(cols, 'space'));
      if (space !== undefined) c.space = twipsToPt(space);
      c.sep = attrOf(cols, 'sep') === '1' || attrOf(cols, 'sep') === 'true';
      const kids = findKids(cols, 'col');
      if (attrOf(cols, 'equalWidth') === '0' && kids.length === c.count) {
        c.widths = kids.map((k) => twipsToPt(num(attrOf(k, 'w')) ?? 0));
        const sp = num(attrOf(kids[0]!, 'space'));
        if (sp !== undefined) c.space = twipsToPt(sp);
      }
      props.cols = c;
    }
    const pn = findKid(sect, 'pgNumType');
    if (pn) {
      const st = num(attrOf(pn, 'start'));
      if (st !== undefined) props.pgNumStart = st;
      const f = attrOf(pn, 'fmt');
      if (f === 'lowerLetter' || f === 'upperLetter' || f === 'lowerRoman' || f === 'upperRoman') props.pgNumFmt = f;
    }
    for (const kind of ['header', 'footer'] as const) {
      const refs: HFRefs = noRefs();
      for (const ref of findKids(sect, kind + 'Reference')) {
        const t = attrOf(ref, 'type');
        const key = t === 'first' ? 'first' : t === 'even' ? 'even' : 'default';
        refs[key] = await readPart(attrOf(ref, 'id'), kind);
      }
      props[kind] = refs;
    }
    return props;
  };

  // split the body at the paragraphs that end a section
  const groups: { kids: XNode[]; sect: XNode | undefined }[] = [];
  let cur: XNode[] = [];
  for (const k of bodyKids) {
    const t = tagOf(k);
    if (t === 'sectPr') continue;
    cur.push(k);
    if (t === 'p') {
      const sp = findKid(findKid(k, 'pPr'), 'sectPr');
      if (sp) {
        groups.push({ kids: cur, sect: sp });
        cur = [];
      }
    }
  }
  groups.push({ kids: cur, sect: findKids(bodyNode, 'sectPr').pop() });

  const sections: PMNode[] = [];
  for (const g of groups) {
    const props = await sectionOf(g.sect);
    let blocks = main.blocks(g.kids);
    if (!blocks.length) blocks = [nodeTypes.paragraph!.create()];
    const px = (v: number) => (v * 96) / 72;
    blocks = blocks.map((b) => clampImages(b, px(props.page.width - props.page.marginLeft - props.page.marginRight), px(props.page.height - props.page.marginTop - props.page.marginBottom)));
    sections.push(makeSection(blocks, props));
  }
  const body = nodeTypes.doc!.create(null, sections);

  const defaults: DocDefaults = {
    fontFamily: baseRP.font ?? DEFAULT_DOC_DEFAULTS.fontFamily,
    fontSize: baseRP.sz ?? 10,
    lineHeight: basePP.line ?? 1,
    spaceAfter: basePP.after ?? 0,
  };
  const core = await text(zip, 'docProps/core.xml');
  const title = core && /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1];
  const author = core && /<dc:creator>([^<]*)<\/dc:creator>/.exec(core)?.[1];
  const types = await text(zip, '[Content_Types].xml');

  // our own part and the bibliography sources
  let nova: Record<string, any> = {};
  let sources: Source[] = [];
  for (const f of Object.keys(zip.files).filter((p) => /^customXml\/[^/]+\.xml$/.test(p))) {
    const xml = await text(zip, f);
    if (!xml) continue;
    if (xml.includes('urn:suitenova:writer:1')) {
      const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(xml.replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>'));
      try {
        if (m) nova = JSON.parse(m[1]!);
      } catch {
        warnings.add('No se pudo leer la parte de datos propios del documento (macros, combinación de correspondencia).');
      }
    } else if (/<(?:b:)?Sources[\s>]/.test(xml)) sources = readSources(xml);
  }

  const doc: WriterDoc = {
    ...emptyWriterDoc(defaults),
    body,
    parts,
    evenAndOdd,
    trackChanges,
    protection,
    watermark: watermark ?? nova.watermark ?? null,
    comments: commentsRead.data,
    sources: (nova.sources as Source[] | undefined) ?? sources,
    citeStyle: nova.citeStyle ?? 'apa',
    notes: { footnoteFormat: 'decimal', footnoteRestart: 'continuous', endnoteFormat: 'lowerRoman', ...(nova.notes ?? {}), ...noteOpts },
    macros: nova.macros ?? [],
    mailMerge: nova.mailMerge ?? null,
    signature: nova.signature ?? null,
    isTemplate: !!types && /wordprocessingml\.template\.main\+xml/.test(types),
    title: title || undefined,
    author: author || undefined,
  };
  return { doc, warnings: [...warnings] };
}
