import { Schema, type DOMOutputSpec, type MarkSpec, type Node as PMNode, type NodeSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

export type Align = 'left' | 'center' | 'right' | 'justify';
export type ListFormat = 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';

export interface ParagraphStyleDef {
  id: string;
  name: string;
  /** 1-6 for headings (outline level). */
  heading?: number;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
  align?: Align;
  indentLeft?: number;
  /** Style applied to the paragraph that follows (Enter at the end). */
  next?: string;
  /** The name Word uses for the style ("toc 1", "footnote text"…), when it differs from the id. */
  wordName?: string;
  /** Not offered in the style gallery (used by generated content). */
  hidden?: boolean;
  /** Style it is based on. */
  basedOn?: string;
  /** Tab stops of the style. */
  tabs?: { pos: number; kind: 'left' | 'center' | 'right' | 'decimal' | 'bar'; leader?: string }[];
  underline?: boolean;
}

export const BODY_FONT = 'Calibri';
export const HEADING_FONT = 'Calibri Light';

/** Built-in paragraph styles. Imported DOCX styles are flattened into direct formatting; only these ids are kept. */
export const PARAGRAPH_STYLES: ParagraphStyleDef[] = [
  { id: 'Normal', name: 'Normal' },
  { id: 'Title', name: 'Título', fontFamily: HEADING_FONT, fontSize: 28, spaceAfter: 6, lineHeight: 1 },
  { id: 'Subtitle', name: 'Subtítulo', fontSize: 14, color: '#595959', spaceAfter: 8 },
  { id: 'Heading1', name: 'Título 1', heading: 1, fontFamily: HEADING_FONT, fontSize: 16, color: '#2f5496', spaceBefore: 12, spaceAfter: 0, next: 'Normal' },
  { id: 'Heading2', name: 'Título 2', heading: 2, fontFamily: HEADING_FONT, fontSize: 13, color: '#2f5496', spaceBefore: 2, spaceAfter: 0, next: 'Normal' },
  { id: 'Heading3', name: 'Título 3', heading: 3, fontFamily: HEADING_FONT, fontSize: 12, color: '#1f3763', spaceBefore: 2, spaceAfter: 0, next: 'Normal' },
  { id: 'Heading4', name: 'Título 4', heading: 4, fontFamily: HEADING_FONT, fontSize: 11, italic: true, color: '#2f5496', spaceBefore: 2, spaceAfter: 0, next: 'Normal' },
  { id: 'Heading5', name: 'Título 5', heading: 5, fontFamily: HEADING_FONT, fontSize: 11, color: '#2f5496', spaceBefore: 2, spaceAfter: 0, next: 'Normal' },
  { id: 'Heading6', name: 'Título 6', heading: 6, fontFamily: HEADING_FONT, fontSize: 11, color: '#1f3763', spaceBefore: 2, spaceAfter: 0, next: 'Normal' },
  { id: 'Quote', name: 'Cita', italic: true, color: '#404040', align: 'center', indentLeft: 43, spaceBefore: 10, spaceAfter: 8 },
  { id: 'Caption', name: 'Leyenda', fontSize: 9, italic: true, color: '#44546a', spaceAfter: 10 },
  { id: 'TOCHeading', name: 'Título de TDC', wordName: 'TOC Heading', hidden: true, fontFamily: HEADING_FONT, fontSize: 16, color: '#2f5496', spaceBefore: 12, spaceAfter: 0 },
  { id: 'TOC1', name: 'TDC 1', wordName: 'toc 1', hidden: true, spaceAfter: 5, tabs: [{ pos: 451, kind: 'right', leader: 'dot' }] },
  { id: 'TOC2', name: 'TDC 2', wordName: 'toc 2', hidden: true, spaceAfter: 5, indentLeft: 11, tabs: [{ pos: 451, kind: 'right', leader: 'dot' }] },
  { id: 'TOC3', name: 'TDC 3', wordName: 'toc 3', hidden: true, spaceAfter: 5, indentLeft: 22, tabs: [{ pos: 451, kind: 'right', leader: 'dot' }] },
  { id: 'TOC4', name: 'TDC 4', wordName: 'toc 4', hidden: true, spaceAfter: 5, indentLeft: 33, tabs: [{ pos: 451, kind: 'right', leader: 'dot' }] },
  { id: 'TOC5', name: 'TDC 5', wordName: 'toc 5', hidden: true, spaceAfter: 5, indentLeft: 44, tabs: [{ pos: 451, kind: 'right', leader: 'dot' }] },
  { id: 'TOC6', name: 'TDC 6', wordName: 'toc 6', hidden: true, spaceAfter: 5, indentLeft: 55, tabs: [{ pos: 451, kind: 'right', leader: 'dot' }] },
  { id: 'TableofFigures', name: 'Tabla de ilustraciones', wordName: 'table of figures', hidden: true, spaceAfter: 0, tabs: [{ pos: 451, kind: 'right', leader: 'dot' }] },
  { id: 'Bibliography', name: 'Bibliografía', wordName: 'Bibliography', hidden: true, spaceAfter: 8 },
  { id: 'FootnoteText', name: 'Texto de nota al pie', wordName: 'footnote text', hidden: true, fontSize: 10, spaceAfter: 0, lineHeight: 1 },
  { id: 'EndnoteText', name: 'Texto de nota final', wordName: 'endnote text', hidden: true, fontSize: 10, spaceAfter: 0, lineHeight: 1 },
  { id: 'Header', name: 'Encabezado', wordName: 'header', hidden: true, spaceAfter: 0, lineHeight: 1 },
  { id: 'Footer', name: 'Pie de página', wordName: 'footer', hidden: true, spaceAfter: 0, lineHeight: 1 },
  { id: 'IndexHeading', name: 'Encabezado de índice', wordName: 'index heading', hidden: true, bold: true, spaceBefore: 8, spaceAfter: 4 },
  { id: 'Index1', name: 'Índice 1', wordName: 'index 1', hidden: true, spaceAfter: 0, lineHeight: 1 },
  { id: 'CommentText', name: 'Texto de comentario', wordName: 'annotation text', hidden: true, fontSize: 10, spaceAfter: 0 },
];

export const STYLE_BY_ID = new Map(PARAGRAPH_STYLES.map((s) => [s.id, s]));

/** Effective space after for a paragraph without explicit spacing (Word 2013+ defaults). */
export const DEFAULT_SPACE_AFTER = 8;
export const DEFAULT_LINE_HEIGHT = 1.08;
export const DEFAULT_FONT_SIZE = 11;

const ptCss = (n: number) => `${n}pt`;

/** CSS class for a paragraph style id (ids from imported files may contain odd characters). */
export const styleClass = (id: string | null | undefined): string => `nw-style-${(id ?? 'Normal').replace(/[^A-Za-z0-9_-]/g, '_')}`;

function paragraphDOM(node: PMNode): DOMOutputSpec {
  const a = node.attrs;
  const css: string[] = [];
  if (a.align) css.push(`text-align:${a.align}`);
  if (a.indentLeft) css.push(`margin-left:${ptCss(a.indentLeft)}`);
  if (a.indentRight) css.push(`margin-right:${ptCss(a.indentRight)}`);
  if (a.indentFirst) css.push(`text-indent:${ptCss(a.indentFirst)}`);
  if (a.spaceBefore !== null) css.push(`margin-top:${ptCss(a.spaceBefore)}`);
  if (a.spaceAfter !== null) css.push(`margin-bottom:${ptCss(a.spaceAfter)}`);
  if (a.lineHeight) css.push(`line-height:${a.lineHeight}`);
  if (a.shade) css.push(`background-color:${a.shade}`);
  if (a.border) css.push(`border:${a.border.width ?? 0.5}pt solid ${a.border.color ?? '#000'};padding:${a.border.space ?? 1}pt`);
  const attrs: Record<string, string> = { class: `nw-p ${styleClass(a.style)}${a.ins ? ' nw-pins' : ''}${a.del ? ' nw-pdel' : ''}` };
  if (css.length) attrs.style = css.join(';');
  if (a.tag) attrs['data-tag'] = a.tag;
  if (a.tabs?.length) attrs['data-tabs'] = JSON.stringify(a.tabs);
  return ['p', attrs, 0];
}

const FIELD_PLACEHOLDER: Record<string, string> = { page: '‹nº›', pages: '‹total›', date: '‹fecha›', time: '‹hora›', section: '‹sección›', sectionpages: '‹pág. sección›', numpages: '‹total›', title: '‹título›', author: '‹autor›', filename: '‹archivo›' };

function safeJson(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const px = (pt: number): number => Math.round(((pt * 96) / 72) * 100) / 100;

/** The DOM of a section: width and margins from its page setup, columns from its column definition. */
function sectionDOM(node: PMNode): DOMOutputSpec {
  const a = node.attrs;
  const attrs: Record<string, string> = { class: 'nw-section', 'data-sid': a.id, 'data-start': a.start };
  const p = a.page as { width: number; marginLeft: number; marginRight: number; marginTop: number; marginBottom: number; height: number } | null;
  const c = a.cols as { count: number; space: number; sep: boolean } | null;
  if (p) {
    const w = px(p.width - p.marginLeft - p.marginRight);
    const css = [`width:${w}px`, `margin-left:calc((var(--nw-sheet-w, ${px(p.width)}px) - ${px(p.width)}px) / 2 + ${px(p.marginLeft)}px)`, `--nw-colh:${px(p.height - p.marginTop - p.marginBottom)}px`, `--nw-rowgap:calc(${px(p.marginTop + p.marginBottom)}px + var(--nw-gap, 20px))`];
    if (c && c.count > 1) {
      css.push(`column-count:${c.count}`, `column-gap:${px(c.space)}px`);
      if (c.sep) css.push('column-rule:1px solid #000');
      attrs['data-cols'] = String(c.count);
    }
    attrs.style = css.join(';');
  }
  return ['section', attrs, 0];
}

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    group: 'block',
    content: 'inline*',
    attrs: {
      align: { default: null },
      indentLeft: { default: 0 },
      indentRight: { default: 0 },
      indentFirst: { default: 0 },
      spaceBefore: { default: null },
      spaceAfter: { default: null },
      lineHeight: { default: null },
      style: { default: null },
      keepNext: { default: false },
      pageBreakBefore: { default: false },
      /** Note tag (Nova Notes): to-do box, done, important or question. */
      tag: { default: null },
      /** Custom tab stops: { pos (pt from the left margin), kind, leader }. */
      tabs: { default: null },
      /** Tracked change on the paragraph mark: inserted or deleted (merged with the next paragraph when accepted). */
      ins: { default: null },
      del: { default: null },
      /** Paragraph shading (#rrggbb) and a box border. */
      shade: { default: null },
      border: { default: null },
    },
    parseDOM: [
      { tag: 'p', getAttrs: (dom) => paraFromDom(dom as HTMLElement, null) },
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}`, getAttrs: (dom: HTMLElement | string) => paraFromDom(dom as HTMLElement, `Heading${n}`) })),
    ],
    toDOM: paragraphDOM,
  },
  bullet_list: { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', { class: 'nw-ul' }, 0] },
  ordered_list: {
    group: 'block',
    content: 'list_item+',
    attrs: { format: { default: 'decimal' }, start: { default: 1 } },
    parseDOM: [{ tag: 'ol', getAttrs: (dom) => ({ start: Number((dom as HTMLElement).getAttribute('start') ?? 1) }) }],
    toDOM: (node) => ['ol', { class: `nw-ol nw-fmt-${node.attrs.format}`, start: String(node.attrs.start), style: `list-style-type:${LIST_CSS[node.attrs.format as ListFormat]}` }, 0],
  },
  list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', { class: 'nw-li' }, 0] },
  page_break: {
    group: 'block',
    atom: true,
    selectable: true,
    parseDOM: [{ tag: 'div.nw-pagebreak' }],
    toDOM: () => ['div', { class: 'nw-pagebreak', contenteditable: 'false' }, ['span', 'Salto de página']],
  },
  hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  image: {
    inline: true,
    group: 'inline',
    draggable: true,
    attrs: { src: {}, alt: { default: '' }, width: { default: null }, height: { default: null } },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          return { src: el.getAttribute('src'), alt: el.getAttribute('alt') ?? '', width: Number(el.getAttribute('width')) || null, height: Number(el.getAttribute('height')) || null };
        },
      },
    ],
    toDOM: (node) => {
      const a = node.attrs;
      const attrs: Record<string, string> = { src: a.src, alt: a.alt, class: 'nw-image' };
      if (a.width) attrs.width = String(Math.round(a.width));
      if (a.height) attrs.height = String(Math.round(a.height));
      return ['img', attrs];
    },
  },
  /**
   * A field. Page number, page count, date and so on are shown as their value in headers/footers and as a placeholder in
   * the body; fields with a `result` (cross references, captions, merge fields, citations) show the stored result.
   */
  field: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { kind: { default: 'page' }, arg: { default: null }, switches: { default: null }, result: { default: null } },
    parseDOM: [
      {
        tag: 'span.nw-field',
        getAttrs: (dom) => {
          const d = (dom as HTMLElement).dataset;
          return { kind: d.kind ?? 'page', arg: d.arg ?? null, switches: d.switches ?? null, result: d.result ?? null };
        },
      },
    ],
    toDOM: (node) => {
      const a = node.attrs;
      const attrs: Record<string, string> = { class: `nw-field nw-field-${a.kind}`, 'data-kind': a.kind };
      if (a.arg) attrs['data-arg'] = a.arg;
      if (a.switches) attrs['data-switches'] = a.switches;
      if (a.result !== null) attrs['data-result'] = a.result;
      const shown = a.result ?? FIELD_PLACEHOLDER[a.kind as string] ?? `‹${a.kind}›`;
      return ['span', attrs, shown];
    },
  },
  /** An invisible anchor (a Word bookmark): cross references and tables of contents point at it. */
  bookmark: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: false,
    attrs: { name: {} },
    parseDOM: [{ tag: 'span.nw-bookmark', getAttrs: (dom) => ({ name: (dom as HTMLElement).dataset.name ?? '' }) }],
    toDOM: (node) => ['span', { class: 'nw-bookmark', 'data-name': node.attrs.name }],
  },
  /** A footnote or endnote reference. The note text travels with it as a document JSON (one or more paragraphs). */
  footnote: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { kind: { default: 'footnote' }, id: { default: '' }, body: { default: null }, custom: { default: null } },
    parseDOM: [{ tag: 'span.nw-fnref', getAttrs: (dom) => ({ kind: (dom as HTMLElement).dataset.kind ?? 'footnote', id: (dom as HTMLElement).dataset.id ?? '', body: safeJson((dom as HTMLElement).dataset.body) }) }],
    toDOM: (node) => ['span', { class: 'nw-fnref', 'data-kind': node.attrs.kind, 'data-id': node.attrs.id, 'data-body': JSON.stringify(node.attrs.body ?? null), contenteditable: 'false' }],
  },
  /** An equation, kept as its source (a LaTeX-like linear form) and drawn as MathML. */
  math: {
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { tex: { default: '' }, display: { default: false } },
    parseDOM: [{ tag: 'span.nw-math', getAttrs: (dom) => ({ tex: (dom as HTMLElement).dataset.tex ?? '', display: (dom as HTMLElement).dataset.display === '1' }) }],
    toDOM: (node) => ['span', { class: 'nw-math', 'data-tex': node.attrs.tex, 'data-display': node.attrs.display ? '1' : '0' }, node.attrs.tex],
  },
  /** A shape or text box. Anchored in a paragraph; `wrap` decides how the text flows around it. */
  shape: {
    inline: true,
    group: 'inline',
    content: 'paragraph*',
    isolating: true,
    draggable: false,
    attrs: {
      kind: { default: 'rect' },
      width: { default: 120 },
      height: { default: 80 },
      fill: { default: '#ffffff' },
      stroke: { default: '#000000' },
      strokeWidth: { default: 1 },
      rotation: { default: 0 },
      /** inline | left | right | front | behind | topBottom */
      wrap: { default: 'inline' },
      /** Offset (px) from the paragraph's top-left for front/behind shapes. */
      x: { default: 0 },
      y: { default: 0 },
      alt: { default: '' },
      id: { default: '' },
    },
    parseDOM: [{ tag: 'span.nw-shape', getAttrs: (dom) => ({ kind: (dom as HTMLElement).dataset.kind ?? 'rect' }) }],
    toDOM: (node) => {
      const a = node.attrs;
      const css = [`width:${a.width}px`, `height:${a.height}px`];
      if (a.wrap === 'left') css.push('float:left', 'margin:0 10px 6px 0');
      else if (a.wrap === 'right') css.push('float:right', 'margin:0 0 6px 10px');
      else if (a.wrap === 'front' || a.wrap === 'behind') css.push('position:absolute', `left:${a.x}px`, `top:${a.y}px`, `z-index:${a.wrap === 'behind' ? 0 : 3}`);
      else if (a.wrap === 'topBottom') css.push('display:block', 'margin:6px auto');
      if (a.rotation) css.push(`transform:rotate(${a.rotation}deg)`);
      return ['span', { class: `nw-shape nw-shape-${a.kind}`, 'data-kind': a.kind, 'data-wrap': a.wrap, style: css.join(';') }, 0];
    },
  },
  /** A content control (Word's structured document tag) inside a paragraph: text, drop-down, date, check box. */
  content_control: {
    inline: true,
    group: 'inline',
    content: 'inline*',
    isolating: true,
    attrs: { id: { default: '' }, type: { default: 'text' }, tag: { default: '' }, title: { default: '' }, placeholder: { default: '' }, showing: { default: false }, checked: { default: false }, items: { default: null }, dateFormat: { default: 'dd/MM/yyyy' }, lock: { default: null } },
    parseDOM: [{ tag: 'span.nw-cc', getAttrs: (dom) => ({ type: (dom as HTMLElement).dataset.type ?? 'text', tag: (dom as HTMLElement).dataset.tag ?? '', title: (dom as HTMLElement).title }) }],
    toDOM: (node) => ['span', { class: `nw-cc nw-cc-${node.attrs.type}${node.attrs.showing ? ' nw-cc-empty' : ''}`, 'data-type': node.attrs.type, 'data-tag': node.attrs.tag, title: node.attrs.title }, 0],
  },
  /** A content control around whole blocks (rich text). */
  content_control_block: {
    group: 'block',
    content: 'block+',
    isolating: true,
    attrs: { id: { default: '' }, tag: { default: '' }, title: { default: '' }, lock: { default: null } },
    parseDOM: [{ tag: 'div.nw-ccb' }],
    toDOM: (node) => ['div', { class: 'nw-ccb', 'data-tag': node.attrs.tag, title: node.attrs.title }, 0],
  },
  /**
   * A generated block: table of contents, table of figures, bibliography or index. The generated paragraphs are its
   * content; "update" rebuilds them from the document.
   */
  generated: {
    group: 'block',
    content: 'block+',
    isolating: true,
    defining: true,
    attrs: { kind: { default: 'toc' }, opts: { default: null }, title: { default: null } },
    parseDOM: [{ tag: 'div.nw-gen' }],
    toDOM: (node) => ['div', { class: `nw-gen nw-gen-${node.attrs.kind}`, 'data-kind': node.attrs.kind }, 0],
  },
  /** A section: the unit that carries page size, margins, columns and the header/footer choice. */
  section: {
    group: 'block',
    content: 'block+',
    attrs: {
      id: { default: '' },
      start: { default: 'nextPage' },
      page: { default: null },
      cols: { default: null },
      titlePg: { default: false },
      header: { default: null },
      footer: { default: null },
      pgNumStart: { default: null },
      pgNumFmt: { default: 'decimal' },
    },
    parseDOM: [{ tag: 'section.nw-section' }],
    toDOM: sectionDOM,
  },
  text: { group: 'inline' },
};

function paraFromDom(dom: HTMLElement, style: string | null) {
  const s = dom.style;
  const pt = (v: string) => (v.endsWith('pt') ? parseFloat(v) : v.endsWith('px') ? (parseFloat(v) * 72) / 96 : 0);
  return {
    style,
    tag: dom.getAttribute('data-tag'),
    align: (['left', 'center', 'right', 'justify'].includes(s.textAlign) ? s.textAlign : null) as Align | null,
    indentLeft: s.marginLeft ? pt(s.marginLeft) : 0,
    spaceBefore: null,
    spaceAfter: null,
  };
}

const LIST_CSS: Record<ListFormat, string> = { decimal: 'decimal', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman' };

/** Links from imported files must never become `javascript:` or other active URLs in the page. */
export const isSafeHref = (h: string): boolean => /^(https?:|mailto:|tel:|#)/i.test(h.trim());
const safeHref = (h: string): string => (isSafeHref(h) ? h : '#');

const marks: Record<string, MarkSpec> = {
  /** A comment anchor; several comments can cover the same text. */
  comment: {
    attrs: { id: {} },
    inclusive: false,
    excludes: '',
    parseDOM: [{ tag: 'span.nw-comment', getAttrs: (dom) => ({ id: (dom as HTMLElement).dataset.id ?? '' }) }],
    toDOM: (m) => ['span', { class: 'nw-comment', 'data-id': m.attrs.id }, 0],
  },
  /** A tracked insertion. */
  ins: {
    attrs: { id: { default: '' }, author: { default: '' }, date: { default: '' } },
    inclusive: true,
    parseDOM: [{ tag: 'ins.nw-ins', getAttrs: (dom) => ({ id: (dom as HTMLElement).dataset.id ?? '', author: (dom as HTMLElement).dataset.author ?? '', date: (dom as HTMLElement).dataset.date ?? '' }) }],
    toDOM: (m) => ['ins', { class: 'nw-ins', 'data-id': m.attrs.id, 'data-author': m.attrs.author, 'data-date': m.attrs.date }, 0],
  },
  /** A tracked deletion (the text is kept, struck out, until the change is accepted). */
  del: {
    attrs: { id: { default: '' }, author: { default: '' }, date: { default: '' } },
    inclusive: false,
    parseDOM: [{ tag: 'del.nw-del', getAttrs: (dom) => ({ id: (dom as HTMLElement).dataset.id ?? '', author: (dom as HTMLElement).dataset.author ?? '', date: (dom as HTMLElement).dataset.date ?? '' }) }],
    toDOM: (m) => ['del', { class: 'nw-del', 'data-id': m.attrs.id, 'data-author': m.attrs.author, 'data-date': m.attrs.date }, 0],
  },
  /** Proofing language of a run. */
  lang: {
    attrs: { value: {} },
    parseDOM: [{ tag: 'span[lang]', getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute('lang') ?? '' }) }],
    toDOM: (m) => ['span', { lang: m.attrs.value }, 0],
  },
  /** Small capitals and all capitals. */
  caps: {
    attrs: { value: { default: 'all' } },
    parseDOM: [{ style: 'text-transform=uppercase', getAttrs: () => ({ value: 'all' }) }, { style: 'font-variant=small-caps', getAttrs: () => ({ value: 'small' }) }],
    toDOM: (m) => ['span', { style: m.attrs.value === 'small' ? 'font-variant:small-caps' : 'text-transform:uppercase' }, 0],
  },
  strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=700' }, { style: 'font-weight=bold' }], toDOM: () => ['strong', 0] },
  em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
  underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
  strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
  superscript: { excludes: 'subscript', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
  subscript: { excludes: 'superscript', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
  color: {
    attrs: { value: {} },
    parseDOM: [{ style: 'color', getAttrs: (v) => ({ value: v as string }) }],
    toDOM: (m) => ['span', { style: `color:${m.attrs.value}` }, 0],
  },
  highlight: {
    attrs: { value: {} },
    parseDOM: [{ style: 'background-color', getAttrs: (v) => ({ value: v as string }) }],
    toDOM: (m) => ['span', { style: `background-color:${m.attrs.value}` }, 0],
  },
  fontFamily: {
    attrs: { value: {} },
    parseDOM: [{ style: 'font-family', getAttrs: (v) => ({ value: String(v).split(',')[0]!.replace(/["']/g, '').trim() }) }],
    toDOM: (m) => ['span', { style: `font-family:'${m.attrs.value}', Carlito, 'Segoe UI', sans-serif` }, 0],
  },
  fontSize: {
    attrs: { value: {} },
    parseDOM: [{ style: 'font-size', getAttrs: (v) => (String(v).endsWith('pt') ? { value: parseFloat(String(v)) } : String(v).endsWith('px') ? { value: Math.round(((parseFloat(String(v)) * 72) / 96) * 2) / 2 } : false) }],
    toDOM: (m) => ['span', { style: `font-size:${m.attrs.value}pt` }, 0],
  },
  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), title: (dom as HTMLElement).getAttribute('title') }) }],
    toDOM: (m) => ['a', { href: safeHref(m.attrs.href), title: m.attrs.title, class: 'nw-link' }, 0],
  },
};

const tNodes = tableNodes({
  tableGroup: 'block',
  cellContent: 'block+',
  cellAttributes: {
    background: {
      default: null,
      getFromDOM: (dom) => (dom as HTMLElement).style.backgroundColor || null,
      setDOMAttr: (value, attrs) => {
        if (value) attrs.style = `${attrs.style ?? ''};background-color:${value}`;
      },
    },
    vAlign: {
      default: null,
      getFromDOM: (dom) => (dom as HTMLElement).style.verticalAlign || null,
      setDOMAttr: (value, attrs) => {
        if (value) attrs.style = `${attrs.style ?? ''};vertical-align:${value}`;
      },
    },
  },
});
// tables carry a flag for visible borders ("Table Grid" in Word)
(tNodes.table as NodeSpec).attrs = { borders: { default: true } };
(tNodes.table as NodeSpec).toDOM = (node) => ['table', { class: `nw-table${node.attrs.borders ? ' nw-borders' : ''}` }, ['tbody', 0]];

export const writerSchema = new Schema({ nodes: { ...nodes, ...tNodes }, marks });

export const nodeTypes = writerSchema.nodes;
export const markTypes = writerSchema.marks;

export function emptyDoc(): PMNode {
  return writerSchema.node('doc', null, [writerSchema.node('paragraph')]);
}

export function docFromText(text: string): PMNode {
  const paras = text.replace(/\r\n?/g, '\n').split('\n').map((line) => writerSchema.node('paragraph', null, line ? [writerSchema.text(line)] : []));
  return writerSchema.node('doc', null, paras.length ? paras : [writerSchema.node('paragraph')]);
}

/** Plain text of a document, paragraphs separated by newlines. */
export function plainText(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, '\n', (n) => (n.type.name === 'field' ? '#' : n.type.name === 'image' ? '' : ''));
}

export function wordCount(doc: PMNode | string): number {
  const text = typeof doc === 'string' ? doc : plainText(doc);
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
}
