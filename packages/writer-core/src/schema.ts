import { Schema, type DOMOutputSpec, type MarkSpec, type Node as PMNode, type NodeSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';
import { drawingSvg, partsShapes, type SmartArtParts } from '@suitenova/smartart-core';
import { CHART_COLORS, CLIP_ATTR, chartData, chartSvg, decodeChartClip, encodeChartClip, gridSource, type ChartGrid, type ChartSpec } from '@suitenova/chart-core';

const svgCache = new WeakMap<object, { w: number; h: number; uri: string }>();

/** El dibujo de un SmartArt de Writer como imagen SVG (data URI); se guarda por objeto de partes, que cambia al editar. */
export function smartArtImage(node: { attrs: Record<string, unknown> }): string {
  const parts = node.attrs.parts as SmartArtParts | null;
  const w = Number(node.attrs.width) || 400;
  const h = Number(node.attrs.height) || 260;
  if (!parts) return '';
  const key = parts as object;
  const hit = svgCache.get(key);
  if (hit && hit.w === w && hit.h === h) return hit.uri;
  const svg = drawingSvg(partsShapes(parts), w * 0.75, h * 0.75, { width: w, height: h });
  const uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  svgCache.set(key, { w, h, uri });
  return uri;
}

const chartCache = new WeakMap<object, { w: number; h: number; uri: string }>();

/** Un gráfico de Writer como imagen SVG (data URI) dibujada con el motor compartido; se guarda por objeto de rejilla, que cambia al editar. */
export function chartImage(node: { attrs: Record<string, unknown> }): string {
  const spec = node.attrs.chart as ChartSpec | null;
  const grid = node.attrs.grid as ChartGrid | null;
  const w = Number(node.attrs.width) || 480;
  const h = Number(node.attrs.height) || 288;
  if (!spec || !grid) return '';
  const hit = chartCache.get(grid);
  if (hit && hit.w === w && hit.h === h && (hit as { spec?: unknown }).spec === spec) return hit.uri;
  let uri = '';
  try {
    const colored: ChartSpec = { ...spec, series: spec.series.map((s, i) => ({ ...s, color: s.color ?? CHART_COLORS[i % CHART_COLORS.length] })) };
    const svg = chartSvg(colored, chartData(colored, gridSource(grid), 'es'), 'es', { text: '#333333', grid: '#dddddd', bg: 'transparent' }, w, h);
    uri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  } catch {
    uri = '';
  }
  chartCache.set(grid, Object.assign({ w, h, uri }, { spec }));
  return uri;
}

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
  { id: 'CoverTitle', name: 'Título de portada', wordName: 'Cover Title', hidden: true, fontSize: 36, bold: true, spaceAfter: 12 },
  { id: 'CoverSubtitle', name: 'Subtítulo de portada', wordName: 'Cover Subtitle', hidden: true, fontSize: 16, color: '#595959', spaceAfter: 12 },
  { id: 'CoverMeta', name: 'Datos de portada', wordName: 'Cover Meta', hidden: true, fontSize: 12, color: '#595959', spaceAfter: 2 },
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
  if (a.lineHeight) css.push(`line-height:${a.lineRule === 'exact' || a.lineRule === 'atLeast' ? `${a.lineHeight}pt` : a.lineHeight}`);
  if (a.shade) css.push(`background-color:${a.shade}`);
  if (a.border && a.border.sides === 'bottom') css.push(`border-bottom:${a.border.width ?? 0.5}pt ${({ double: 'double', triple: 'double', dotted: 'dotted', wave: 'dashed' } as Record<string, string>)[a.border.style as string] ?? 'solid'} ${a.border.color ?? '#000'};padding-bottom:${a.border.space ?? 1}pt`);
  else if (a.border) css.push(`border:${a.border.width ?? 0.5}pt solid ${a.border.color ?? '#000'};padding:${a.border.space ?? 1}pt`);
  const attrs: Record<string, string> = { class: `nw-p ${styleClass(a.style)}${a.ins ? ' nw-pins' : ''}${a.del ? ' nw-pdel' : ''}` };
  if (css.length) attrs.style = css.join(';');
  if (a.tag) attrs['data-tag'] = a.tag;
  if (a.tabs?.length) attrs['data-tabs'] = JSON.stringify(a.tabs);
  if (a.keepLines) attrs['data-keep-lines'] = '1';
  if (a.columnBreakBefore) attrs['data-col-break'] = '1';
  if (a.noLineNumbers) attrs['data-no-ln'] = '1';
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


export interface ImageCrop { l: number; t: number; r: number; b: number }

const PX_PER_PT = 4 / 3;
/** The CSS `filter` that draws the shadow and the glow of a picture (empty when it has none). */
export function pictureFxCss(fx: Record<string, any> | null | undefined): string {
  if (!fx) return '';
  const rgba = (hex: string, alpha: number) => {
    const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha))})`;
  };
  const out: string[] = [];
  const s = fx.shadow;
  if (s) {
    const a = ((s.angle ?? 45) * Math.PI) / 180;
    out.push(`drop-shadow(${(Math.cos(a) * s.dist * PX_PER_PT).toFixed(1)}px ${(Math.sin(a) * s.dist * PX_PER_PT).toFixed(1)}px ${(s.blur * PX_PER_PT).toFixed(1)}px ${rgba(s.color, s.alpha)})`);
  }
  if (fx.glow) out.push(`drop-shadow(0 0 ${(fx.glow.radius * PX_PER_PT).toFixed(1)}px ${rgba(fx.glow.color, fx.glow.alpha)})`);
  return out.join(' ');
}

/** DOM of an image: a plain `img`, or a clipping box around it when it is cropped. */
export function imageDOM(a: Record<string, any>): DOMOutputSpec {
  const crop = a.crop as ImageCrop | null;
  const w: number | null = a.width ? Math.round(a.width) : null;
  const h: number | null = a.height ? Math.round(a.height) : null;
  const outer: string[] = [];
  const tf = [a.rotate ? `rotate(${a.rotate}deg)` : '', a.flipH ? 'scaleX(-1)' : '', a.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  if (tf) outer.push(`transform:${tf}`);
  const bd = a.border as { color: string; width: number } | null;
  if (bd) outer.push(`outline:${bd.width}pt solid ${bd.color}`);
  if (a.wrap === 'left') outer.push('float:left', 'margin:0 12px 6px 0');
  else if (a.wrap === 'right') outer.push('float:right', 'margin:0 0 6px 12px');
  else if (a.wrap === 'top') outer.push('display:block', 'margin:6px auto');
  else if (a.wrap === 'front' || a.wrap === 'behind') outer.push('position:absolute', `left:${a.x ?? 0}px`, `top:${a.y ?? 0}px`, `z-index:${a.wrap === 'behind' ? 0 : 3}`, 'max-width:none');
  const data: Record<string, string> = {};
  if (crop) data['data-crop'] = JSON.stringify(crop);
  if (a.rotate) data['data-rotate'] = String(a.rotate);
  if (a.flipH) data['data-fliph'] = '1';
  if (a.flipV) data['data-flipv'] = '1';
  if (bd) data['data-border'] = JSON.stringify(bd);
  if (a.wrap) data['data-wrap'] = a.wrap;
  if (a.orig) data['data-orig'] = a.orig;
  if (a.edits) data['data-edits'] = JSON.stringify(a.edits);
  if (a.ocr) data['data-ocr'] = JSON.stringify(a.ocr);
  if (a.png) data['data-png'] = a.png;
  const fxCss = pictureFxCss(a.fx);
  if (a.fx) data['data-fx'] = JSON.stringify(a.fx);
  if (fxCss) outer.push(`filter:${fxCss}`);
  if (a.wrap === 'front' || a.wrap === 'behind') {
    data['data-x'] = String(a.x ?? 0);
    data['data-y'] = String(a.y ?? 0);
  }
  const attrs: Record<string, string> = { src: a.src, alt: a.alt, class: 'nw-image', ...data };
  if (!crop) {
    if (w) attrs.width = String(w);
    if (h) attrs.height = String(h);
    if (outer.length) attrs.style = outer.join(';');
    return ['img', attrs];
  }
  const kx = Math.max(0.05, 1 - crop.l - crop.r);
  const ky = Math.max(0.05, 1 - crop.t - crop.b);
  const bw = w ?? 200;
  const bh = h ?? 150;
  const fw = bw / kx;
  const fh = bh / ky;
  attrs['data-w'] = String(bw);
  attrs['data-h'] = String(bh);
  attrs.style = `position:absolute;max-width:none;width:${fw.toFixed(1)}px;height:${fh.toFixed(1)}px;left:${(-crop.l * fw).toFixed(1)}px;top:${(-crop.t * fh).toFixed(1)}px`;
  const box = ['display:inline-block', 'position:relative', 'overflow:hidden', `width:${bw}px`, `height:${bh}px`, ...outer];
  return ['span', { class: 'nw-imgbox', style: box.join(';') }, ['img', attrs]];
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
      /** How `lineHeight` is read: a multiple of the font size (null), or points: exactly / at least. */
      lineRule: { default: null },
      style: { default: null },
      keepNext: { default: false },
      /** Do not split the paragraph between two pages. */
      keepLines: { default: false },
      /** Outline level 0-8 (Word's outlineLvl); null = body text. */
      outlineLevel: { default: null },
      pageBreakBefore: { default: false },
      /** Start the paragraph in the next column of a column section. */
      columnBreakBefore: { default: false },
      /** Leave this paragraph out of the line numbers of its section. */
      noLineNumbers: { default: false },
      /** Note tag (Nova Notes): to-do box, done, important or question. */
      tag: { default: null },
      /** Custom tab stops: { pos (pt from the left margin), kind, leader }. */
      tabs: { default: null },
      /** Tracked change on the paragraph mark: inserted or deleted (merged with the next paragraph when accepted). */
      ins: { default: null },
      del: { default: null },
      /** Paragraph shading (#rrggbb) and a border: a box, or only the line below (`sides: 'bottom'`, with a Word line `style`: single, double, dotted, wave, triple). */
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
    attrs: {
      src: {},
      alt: { default: '' },
      /** Displayed size in px (after cropping). */
      width: { default: null },
      height: { default: null },
      /** Cropped part on each side, as a fraction (0–0.95) of the full picture. */
      crop: { default: null },
      /** Rotation in degrees (0–359) and mirroring. */
      rotate: { default: 0 },
      flipH: { default: false },
      flipV: { default: false },
      /** Outline: colour `#rrggbb` and width in pt. */
      border: { default: null },
      /**
       * Text wrapping: in the line (null), floating left or right with text around it, alone on its lines (`top`), or free in front of
       * (`front`) or behind (`behind`) the text at `x`/`y` px from the paragraph's corner (from the group's corner inside a group).
       */
      wrap: { default: null },
      x: { default: 0 },
      y: { default: 0 },
      /**
       * The original picture (data URI) and the edits made to its pixels (`PixelEdits` of image-core, as plain data): `src` is the original
       * with those edits made. Without edits both are null and `src` is the picture itself.
       */
      orig: { default: null },
      edits: { default: null },
      /**
       * The text read from the picture (OCR) with where each word is, as the shared OCR keeps it (`StoredOcr` of ocr-core; opaque here). It is
       * derived data: it is read again when the picture changes, and it goes in a part of the .docx of its own that Word ignores.
       */
      ocr: { default: null },
      /** When `src` is an SVG (an icon from the gallery): the PNG of the same picture, which goes in the file as the fallback of the SVG. */
      png: { default: null },
      /**
       * Effects around the picture, in points and degrees: `shadow` {color, blur, dist, angle, alpha} and `glow` {color, radius, alpha}
       * (the `PictureFx` of image-core). In the .docx they are the picture's own `a:effectLst`, which Word applies itself.
       */
      fx: { default: null },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const json = (k: string) => {
            try {
              return el.dataset[k] ? JSON.parse(el.dataset[k]!) : null;
            } catch {
              return null;
            }
          };
          return {
            src: el.getAttribute('src'),
            alt: el.getAttribute('alt') ?? '',
            width: Number(el.dataset.w ?? el.getAttribute('width')) || null,
            height: Number(el.dataset.h ?? el.getAttribute('height')) || null,
            crop: json('crop'),
            rotate: Number(el.dataset.rotate) || 0,
            flipH: el.dataset.fliph === '1',
            flipV: el.dataset.flipv === '1',
            border: json('border'),
            wrap: el.dataset.wrap || null,
            x: Number(el.dataset.x) || 0,
            y: Number(el.dataset.y) || 0,
            orig: el.dataset.orig || null,
            edits: json('edits'),
            ocr: json('ocr'),
            png: el.dataset.png || null,
            fx: json('fx'),
          };
        },
      },
    ],
    toDOM: (node) => imageDOM(node.attrs),
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
    // `omml` es el OMML original (con sus fuentes y propiedades) y `ommlTex` el código con el que se leyó: si el código no cambió, se guarda el original
    attrs: { tex: { default: '' }, display: { default: false }, omml: { default: null }, ommlTex: { default: null } },
    parseDOM: [
      {
        tag: 'span.nw-math',
        getAttrs: (dom) => {
          const d = (dom as HTMLElement).dataset;
          return { tex: d.tex ?? '', display: d.display === '1', omml: d.omml ? decodeURIComponent(d.omml) : null, ommlTex: d.ommlTex ?? null };
        },
      },
    ],
    toDOM: (node) => ['span', { class: 'nw-math', 'data-tex': node.attrs.tex, 'data-display': node.attrs.display ? '1' : '0', ...(node.attrs.omml ? { 'data-omml': encodeURIComponent(node.attrs.omml), 'data-omml-tex': node.attrs.ommlTex ?? '' } : {}) }, node.attrs.tex],
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
      /** Valores de ajuste (los tiradores amarillos) como en `a:avLst`; null = los de la forma por omisión. */
      adj: { default: null },
      /** WordArt: estilo del texto (`fx`, modelo de `wordart-core`) y transformación (`warp`: `prst` y ajustes); null = texto normal. */
      wordart: { default: null },
      /**
       * Freeform: the paths of a custom geometry (`a:custGeom`; `CustPath[]` of shapes-core, in the space of each path) instead of the preset
       * of `kind`. It is what «Convertir en forma» makes of an icon. `fillNone` leaves the inside empty (only the outline shows).
       */
      cust: { default: null },
      fillNone: { default: false },
      /** inline | left | right | front | behind | topBottom */
      wrap: { default: 'inline' },
      /** Offset (px) from the paragraph's top-left for front/behind shapes. */
      x: { default: 0 },
      y: { default: 0 },
      alt: { default: '' },
      id: { default: '' },
    },
    parseDOM: [{ tag: 'span.nw-shape', getAttrs: (dom) => ((dom as HTMLElement).classList.contains('nw-shape-group') ? false : { kind: (dom as HTMLElement).dataset.kind ?? 'rect' }) }],
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
  /**
   * A group of shapes (Word's `wpg:wgp`): one object whose children are shapes, pictures (or groups) placed in its own coordinates. A child's
   * `x`/`y` are pixels from the top-left corner of the group; its `wrap` is ignored. The group's size always matches its children
   * (resizing it rewrites theirs); it turns with CSS and its children follow.
   */
  shape_group: {
    inline: true,
    group: 'inline',
    content: '(shape | shape_group | image)+',
    isolating: true,
    draggable: false,
    attrs: {
      width: { default: 120 },
      height: { default: 80 },
      rotation: { default: 0 },
      /** inline | left | right | front | behind | topBottom (like a shape) */
      wrap: { default: 'front' },
      x: { default: 0 },
      y: { default: 0 },
      alt: { default: '' },
      id: { default: '' },
    },
    parseDOM: [{ tag: 'span.nw-shape-group', priority: 60 }],
    toDOM: (node) => {
      const a = node.attrs;
      const css = [`width:${a.width}px`, `height:${a.height}px`];
      if (a.wrap === 'left') css.push('float:left', 'margin:0 10px 6px 0');
      else if (a.wrap === 'right') css.push('float:right', 'margin:0 0 6px 10px');
      else if (a.wrap === 'front' || a.wrap === 'behind') css.push('position:absolute', `left:${a.x}px`, `top:${a.y}px`, `z-index:${a.wrap === 'behind' ? 0 : 3}`);
      else if (a.wrap === 'topBottom') css.push('display:block', 'margin:6px auto');
      if (a.rotation) css.push(`transform:rotate(${a.rotation}deg)`);
      return ['span', { class: 'nw-shape nw-shape-group', 'data-wrap': a.wrap, style: css.join(';') }, 0];
    },
  },
  /**
   * A SmartArt (Word's `dgm:relIds` diagram): an atom that keeps the five parts of the package (`parts`: data, layout, style, colours and
   * the cached drawing, each as XML text) and shows the drawing as an SVG picture. It is edited as a whole (text, layout, style, colours).
   */
  smartart: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    draggable: false,
    attrs: {
      width: { default: 400 },
      height: { default: 260 },
      /** inline | left | right | front | behind | topBottom */
      wrap: { default: 'inline' },
      x: { default: 0 },
      y: { default: 0 },
      alt: { default: '' },
      id: { default: '' },
      parts: { default: null },
    },
    parseDOM: [{ tag: 'span.nw-smartart', priority: 70 }],
    toDOM: (node) => {
      const a = node.attrs;
      const css = [`width:${a.width}px`, `height:${a.height}px`];
      if (a.wrap === 'left') css.push('float:left', 'margin:0 10px 6px 0');
      else if (a.wrap === 'right') css.push('float:right', 'margin:0 0 6px 10px');
      else if (a.wrap === 'front' || a.wrap === 'behind') css.push('position:absolute', `left:${a.x}px`, `top:${a.y}px`, `z-index:${a.wrap === 'behind' ? 0 : 3}`);
      else if (a.wrap === 'topBottom') css.push('display:block', 'margin:6px auto');
      return ['span', { class: 'nw-smartart', 'data-wrap': a.wrap, title: a.alt || 'SmartArt', style: css.join(';') }, ['img', { src: smartArtImage(node), alt: a.alt || 'SmartArt', draggable: 'false', style: 'width:100%;height:100%;display:block' }]];
    },
  },
  /**
   * A chart (Word's `c:chart` / `cx:chart`): an atom with the chart (`chart`, from the shared engine) and the data grid it points into
   * (`grid`). It is drawn as an SVG picture and edited as a whole in a dialog; the file keeps the values and an embedded workbook.
   */
  chart: {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    draggable: false,
    attrs: {
      width: { default: 480 },
      height: { default: 288 },
      /** inline | left | right | front | behind | topBottom */
      wrap: { default: 'inline' },
      x: { default: 0 },
      y: { default: 0 },
      alt: { default: '' },
      id: { default: '' },
      chart: { default: null },
      grid: { default: null },
      /** The parts of the chart as another program saved them (path → bytes), written back with the changes merged in. */
      raw: { default: null },
    },
    // el gráfico que llevan el portapapeles de Writer, Slides y Calc (`data-nova-chart`), también si viene dentro de una tabla
    parseDOM: [
      {
        tag: `[${CLIP_ATTR}]`,
        priority: 90,
        getAttrs: (dom) => {
          const el = dom as HTMLElement;
          const clip = decodeChartClip(el.getAttribute(CLIP_ATTR) ?? '');
          if (!clip) return false;
          const px = (v: string) => (/^(\d+(?:\.\d+)?)px$/.test(v) ? Number(v.replace('px', '')) : undefined);
          return { chart: clip.chart, grid: clip.grid, width: px(el.style?.width ?? '') ?? 480, height: px(el.style?.height ?? '') ?? 288, wrap: el.dataset?.wrap ?? 'inline' };
        },
      },
      { tag: 'span.nw-chart', priority: 70 },
    ],
    toDOM: (node) => {
      const a = node.attrs;
      const css = [`width:${a.width}px`, `height:${a.height}px`];
      if (a.wrap === 'left') css.push('float:left', 'margin:0 10px 6px 0');
      else if (a.wrap === 'right') css.push('float:right', 'margin:0 0 6px 10px');
      else if (a.wrap === 'front' || a.wrap === 'behind') css.push('position:absolute', `left:${a.x}px`, `top:${a.y}px`, `z-index:${a.wrap === 'behind' ? 0 : 3}`);
      else if (a.wrap === 'topBottom') css.push('display:block', 'margin:6px auto');
      const clip = a.chart && a.grid ? { [CLIP_ATTR]: encodeChartClip({ chart: a.chart as ChartSpec, grid: a.grid as ChartGrid }) } : {};
      return ['span', { class: 'nw-chart', ...clip, 'data-wrap': a.wrap, title: a.alt || 'Gráfico', style: css.join(';') }, ['img', { src: chartImage(node), alt: a.alt || 'Gráfico', draggable: 'false', style: 'width:100%;height:100%;display:block' }]];
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
      borders: { default: null },
      lineNumbers: { default: null },
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
  /**
   * A tracked change of formatting (Word's `w:rPrChange`): the text keeps the formatting it has now, and `before` is the formatting it had (a list of
   * `{ type, attrs }` marks as JSON) so the change can be rejected. Accepting it only removes this mark.
   */
  fmt: {
    attrs: { id: { default: '' }, author: { default: '' }, date: { default: '' }, before: { default: '[]' } },
    inclusive: false,
    parseDOM: [{ tag: 'span.nw-fmt', getAttrs: (dom) => ({ id: (dom as HTMLElement).dataset.id ?? '', author: (dom as HTMLElement).dataset.author ?? '', date: (dom as HTMLElement).dataset.date ?? '', before: (dom as HTMLElement).dataset.before ?? '[]' }) }],
    toDOM: (m) => ['span', { class: 'nw-fmt', 'data-id': m.attrs.id, 'data-author': m.attrs.author, 'data-date': m.attrs.date, 'data-before': m.attrs.before }, 0],
  },
  /** Proofing language of a run. */
  lang: {
    attrs: { value: {} },
    parseDOM: [{ tag: 'span[lang]', getAttrs: (dom) => ({ value: (dom as HTMLElement).getAttribute('lang') ?? '' }) }],
    toDOM: (m) => ['span', { lang: m.attrs.value }, 0],
  },
  /** «No revisar la ortografía ni la gramática» (`w:noProof`). */
  noproof: {
    parseDOM: [{ tag: 'span[data-noproof]' }],
    toDOM: () => ['span', { 'data-noproof': '1' }, 0],
  },
  /** Small capitals and all capitals. */
  caps: {
    attrs: { value: { default: 'all' } },
    parseDOM: [{ style: 'text-transform=uppercase', getAttrs: () => ({ value: 'all' }) }, { style: 'font-variant=small-caps', getAttrs: () => ({ value: 'small' }) }],
    toDOM: (m) => ['span', { style: m.attrs.value === 'small' ? 'font-variant:small-caps' : 'text-transform:uppercase' }, 0],
  },
  strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=700' }, { style: 'font-weight=bold' }], toDOM: () => ['strong', 0] },
  em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
  underline: {
    attrs: { style: { default: 'single' }, color: { default: null } },
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: (m) => ['u', { ...(m.attrs.style !== 'single' ? { class: `nw-u-${m.attrs.style}` } : {}), ...(m.attrs.color ? { style: `text-decoration-color:${m.attrs.color}` } : {}) }, 0],
  },
  /** Double strikethrough. */
  dstrike: { excludes: 'strike', parseDOM: [{ tag: 'span.nw-dstrike' }], toDOM: () => ['span', { class: 'nw-dstrike' }, 0] },
  /** Character spacing in points (positive expands, negative condenses). */
  spacing: {
    attrs: { value: {} },
    parseDOM: [{ style: 'letter-spacing', getAttrs: (v) => ({ value: parseFloat(v as string) || 0 }) }],
    toDOM: (m) => ['span', { style: `letter-spacing:${m.attrs.value}pt` }, 0],
  },
  strike: { excludes: 'dstrike', parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }], toDOM: () => ['s', 0] },
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
    /** Borders set on the cell itself: `{ t, r, b, l }`, each a `{ style, width, color }` or null (no border); they win over the style of the table. */
    borders: {
      default: null,
      getFromDOM: (dom) => {
        try {
          return JSON.parse((dom as HTMLElement).getAttribute('data-borders') ?? 'null');
        } catch {
          return null;
        }
      },
      setDOMAttr: (value, attrs) => {
        if (value) attrs['data-borders'] = JSON.stringify(value);
      },
    },
  },
});
// tables carry a flag for visible borders ("Table Grid" in Word)
(tNodes.table as NodeSpec).attrs = {
  borders: { default: true },
  /** Alineación de la tabla en la página (null = a la izquierda). */
  align: { default: null },
  /** Color y grosor (pt) del borde de las celdas. */
  borderColor: { default: null },
  borderWidth: { default: null },
  /** Margen interior de las celdas en pt: { x, y }. */
  padding: { default: null },
  /** La primera fila es de encabezado (Word la repite en cada página). */
  headerRow: { default: false },
  /** The table style (`family-accent` of `@suitenova/table-core`, e.g. `medium-1`) and its options; null: no style (the borders flag decides). */
  tstyle: { default: null },
  topts: { default: null },
  /** Alternative text of the table: a title and a description (read by screen readers; Word's `w:tblCaption` and `w:tblDescription`). */
  caption: { default: null },
  descr: { default: null },
};

/** Propiedades CSS de una tabla (alineación, borde y márgenes de celda) como pares [nombre, valor]. */
export function tableCssVars(attrs: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  if (attrs.align === 'center') out.push(['margin-left', 'auto'], ['margin-right', 'auto']);
  else if (attrs.align === 'right') out.push(['margin-left', 'auto'], ['margin-right', '0']);
  if (attrs.borderColor) out.push(['--nw-bc', String(attrs.borderColor)]);
  if (attrs.borderWidth) out.push(['--nw-bw', `${attrs.borderWidth}pt`]);
  const pad = attrs.padding as { x?: number; y?: number } | null;
  if (pad) {
    if (pad.x !== undefined) out.push(['--nw-px', `${pad.x}pt`]);
    if (pad.y !== undefined) out.push(['--nw-py', `${pad.y}pt`]);
  }
  return out;
}
(tNodes.table as NodeSpec).toDOM = (node) => {
  const css = tableCssVars(node.attrs).map(([k, v]) => `${k}:${v}`).join(';');
  return ['table', { class: `nw-table${node.attrs.borders && !node.attrs.tstyle ? ' nw-borders' : ''}`, ...(node.attrs.tstyle ? { 'data-tstyle': String(node.attrs.tstyle) } : {}), ...(css ? { style: css } : {}), ...(node.attrs.caption ? { 'aria-label': String(node.attrs.caption) } : {}), ...(node.attrs.descr ? { 'aria-description': String(node.attrs.descr), title: String(node.attrs.descr) } : {}) }, ['tbody', 0]];
};

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

/** The marks that are formatting of text (what a tracked change of formatting records), as opposed to links, comments and tracked changes. */
export const FORMAT_MARKS: readonly string[] = ['strong', 'em', 'underline', 'strike', 'dstrike', 'spacing', 'superscript', 'subscript', 'color', 'highlight', 'fontFamily', 'fontSize', 'caps'];
