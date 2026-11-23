import { DEFAULT_OPTIONS, styleById, type Border, type BorderStyle, type StyleOptions, type StylePart, type TableStyle } from '@suitenova/table-core';
import { attrOf, esc, type XNode } from './xml';
import { hex } from './shared';

/*
 * Table styles in a .docx. Our styles are written as real Word table styles (`w:style w:type="table"`, with the conditional parts of the header row,
 * the bands…), so Word draws them live, shows them in its table style gallery and honours the style options (`w:tblLook`). Read back, a style
 * whose id is one of ours is recognised; any other style of Word is left to the direct formatting the reader already understands.
 */

const FAMILY_ID: Record<string, string> = { plain: 'Plain', basic: 'Basic', light: 'Light', grid: 'Grid', medium: 'Medium', dark: 'Dark', list: 'List' };

/** `NovaMedium1`: the id of our style in the styles part (and in `w:tblStyle`). */
export const novaStyleId = (s: Pick<TableStyle, 'family' | 'accent'>): string => `Nova${FAMILY_ID[s.family]}${s.accent || ''}`;

/** The style of a `w:tblStyle` id when it is one of ours. */
export function styleOfNovaId(id: string | undefined): TableStyle | undefined {
  const m = /^Nova(Plain|Basic|Light|Grid|Medium|Dark|List)([1-6])?$/.exec(id ?? '');
  if (!m) return undefined;
  return styleById(m[2] ? `${m[1]!.toLowerCase()}-${m[2]}` : m[1]!.toLowerCase());
}

const BORDER_VAL: Record<BorderStyle, string> = { single: 'single', dashed: 'dashed', dotted: 'dotted', double: 'double', none: 'nil' };

/** One border line, e.g. `<w:top .../>`; a border of width 0 or `none` is `nil`. */
export function borderXml(tag: string, b: Border | null | undefined): string {
  if (!b || b.style === 'none' || b.width <= 0) return `<w:${tag} w:val="nil"/>`;
  const sz = Math.max(2, Math.min(96, Math.round(b.width * 8)));
  return `<w:${tag} w:val="${BORDER_VAL[b.style]}" w:sz="${sz}" w:space="0" w:color="${hex(b.color)}"/>`;
}

/** A border element read back (`w:val`, `w:sz`, `w:color`); null for `nil`/`none`. */
export function borderOfXml(n: XNode): Border | null {
  const val = attrOf(n, 'val') ?? 'nil';
  if (val === 'nil' || val === 'none') return null;
  const style: BorderStyle = val === 'dashed' || val === 'dashSmallGap' ? 'dashed' : val === 'dotted' || val === 'dotDash' ? 'dotted' : val === 'double' ? 'double' : 'single';
  const sz = Number(attrOf(n, 'sz') ?? 4);
  const col = attrOf(n, 'color');
  return { style, width: Math.max(0.25, sz / 8), color: col && /^[0-9a-f]{6}$/i.test(col) ? `#${col.toLowerCase()}` : '#000000' };
}

const rPr = (p: StylePart): string => (p.bold || p.color ? `<w:rPr>${p.bold ? '<w:b/><w:bCs/>' : ''}${p.color ? `<w:color w:val="${hex(p.color)}"/>` : ''}</w:rPr>` : '');
const shd = (p: StylePart): string => (p.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(p.fill)}"/>` : '');

function cellBorders(p: StylePart): string {
  const b = p.borders;
  if (!b || !(b.t || b.l || b.b || b.r)) return '';
  return `<w:tcBorders>${b.t ? borderXml('top', b.t) : ''}${b.l ? borderXml('left', b.l) : ''}${b.b ? borderXml('bottom', b.b) : ''}${b.r ? borderXml('right', b.r) : ''}</w:tcBorders>`;
}

const CONDITIONAL: [keyof TableStyle, string][] = [
  ['firstRow', 'firstRow'],
  ['lastRow', 'lastRow'],
  ['firstCol', 'firstCol'],
  ['lastCol', 'lastCol'],
  ['band1V', 'band1Vert'],
  ['band2V', 'band2Vert'],
  ['band1H', 'band1Horz'],
  ['band2H', 'band2Horz'],
  ['ne', 'neCell'],
  ['nw', 'nwCell'],
  ['se', 'seCell'],
  ['sw', 'swCell'],
];

/** The definition of one of our styles as a Word table style. */
export function tableStyleXml(s: TableStyle): string {
  const w = s.whole ?? {};
  const wb = w.borders;
  const tblBorders = wb ? `<w:tblBorders>${(['t', 'l', 'b', 'r'] as const).map((k, i) => borderXml(['top', 'left', 'bottom', 'right'][i]!, wb[k])).join('')}${borderXml('insideH', wb.insideH)}${borderXml('insideV', wb.insideV)}</w:tblBorders>` : '';
  let out = `<w:style w:type="table" w:customStyle="1" w:styleId="${novaStyleId(s)}"><w:name w:val="${esc(`Nova ${s.name}`)}"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="99"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${rPr(w)}`;
  out += `<w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblStyleColBandSize w:val="1"/>${tblBorders}</w:tblPr>`;
  if (w.fill) out += `<w:tcPr>${shd(w)}</w:tcPr>`;
  for (const [key, type] of CONDITIONAL) {
    const p = s[key] as StylePart | undefined;
    if (!p) continue;
    const tcPr = `${cellBorders(p)}${shd(p)}`;
    out += `<w:tblStylePr w:type="${type}">${rPr(p)}${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}</w:tblStylePr>`;
  }
  return out + '</w:style>';
}

/** `w:tblLook` for the options (the bit mask and the attributes Word writes). */
export function tblLookXml(o: StyleOptions): string {
  const bits = (o.firstRow ? 0x20 : 0) | (o.lastRow ? 0x40 : 0) | (o.firstCol ? 0x80 : 0) | (o.lastCol ? 0x100 : 0) | (o.bandRows ? 0 : 0x200) | (o.bandCols ? 0 : 0x400);
  const f = (b: boolean) => (b ? 1 : 0);
  return `<w:tblLook w:val="${bits.toString(16).toUpperCase().padStart(4, '0')}" w:firstRow="${f(o.firstRow)}" w:lastRow="${f(o.lastRow)}" w:firstColumn="${f(o.firstCol)}" w:lastColumn="${f(o.lastCol)}" w:noHBand="${f(!o.bandRows)}" w:noVBand="${f(!o.bandCols)}"/>`;
}

/** The style options of a `w:tblLook` (the attributes when there are, else the bit mask). */
export function optionsOfTblLook(n: XNode | undefined): StyleOptions {
  if (!n) return { ...DEFAULT_OPTIONS };
  const flag = (name: string): boolean | undefined => {
    const v = attrOf(n, name);
    return v === undefined ? undefined : v === '1' || v === 'true' || v === 'on';
  };
  const val = parseInt(attrOf(n, 'val') ?? '04A0', 16) || 0;
  const bit = (b: number) => (val & b) !== 0;
  return {
    firstRow: flag('firstRow') ?? bit(0x20),
    lastRow: flag('lastRow') ?? bit(0x40),
    firstCol: flag('firstColumn') ?? bit(0x80),
    lastCol: flag('lastColumn') ?? bit(0x100),
    bandRows: !(flag('noHBand') ?? bit(0x200)),
    bandCols: !(flag('noVBand') ?? bit(0x400)),
  };
}

