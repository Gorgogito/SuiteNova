/** The format schemes (fills, lines and effects of the theme) as `a:fmtScheme` XML. */

const clr = (mods = '') => `<a:schemeClr val="phClr">${mods}</a:schemeClr>`;
const solid = (mods = '') => `<a:solidFill>${clr(mods)}</a:solidFill>`;
const stop = (pos: number, mods: string) => `<a:gs pos="${pos}">${clr(mods)}</a:gs>`;
const grad = (stops: string[]) => `<a:gradFill rotWithShape="1"><a:gsLst>${stops.join('')}</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`;
const line = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid()}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
const shadow = (blur: number, dist: number, alpha: number) => `<a:effectLst><a:outerShdw blurRad="${blur}" dist="${dist}" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="${alpha}"/></a:srgbClr></a:outerShdw></a:effectLst>`;

type Shadow = [number, number, number] | null;

interface Kind {
  /** Line widths in EMU. */
  lines: [number, number, number];
  /** Flat fills (a solid colour) or the gradients of Office. */
  gradients: boolean;
  /** The three effect styles: none, or a shadow (blur, distance, opacity). */
  shadows: [Shadow, Shadow, Shadow];
}

const FLAT = [solid(), solid('<a:tint val="90000"/>'), solid('<a:shade val="90000"/>')];

const GRADIENTS = [
  solid(),
  grad([stop(0, '<a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/>'), stop(50000, '<a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/>'), stop(100000, '<a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/>')]),
  grad([stop(0, '<a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/>'), stop(50000, '<a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/>'), stop(100000, '<a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/>')]),
];

function build(name: string, k: Kind): string {
  const fills = k.gradients ? GRADIENTS : FLAT;
  const effects = k.shadows.map((s) => `<a:effectStyle>${s ? shadow(...s) : '<a:effectLst/>'}</a:effectStyle>`).join('');
  return (
    `<a:fmtScheme name="${name}">` +
    `<a:fillStyleLst>${fills.join('')}</a:fillStyleLst>` +
    `<a:lnStyleLst>${k.lines.map(line).join('')}</a:lnStyleLst>` +
    `<a:effectStyleLst>${effects}</a:effectStyleLst>` +
    `<a:bgFillStyleLst>${solid()}${solid('<a:tint val="95000"/><a:satMod val="170000"/>')}${solid('<a:shade val="95000"/><a:satMod val="170000"/>')}</a:bgFillStyleLst>` +
    `</a:fmtScheme>`
  );
}

export interface EffectScheme {
  id: string;
  name: string;
  fmtXml: string;
}

/** The effect schemes (Nova's own reading of the names that Office gives to its five). */
export const EFFECT_SCHEMES: EffectScheme[] = [
  { id: 'office', name: 'Office', fmtXml: build('Office', { lines: [6350, 12700, 19050], gradients: true, shadows: [null, null, [57150, 19050, 63000]] }) },
  { id: 'office2007', name: 'Office 2007-2010', fmtXml: build('Office 2007-2010', { lines: [9525, 25400, 38100], gradients: true, shadows: [[40000, 20000, 38000], [40000, 23000, 35000], [40000, 23000, 35000]] }) },
  { id: 'subtle', name: 'Sutil', fmtXml: build('Sutil', { lines: [6350, 12700, 19050], gradients: false, shadows: [null, null, null] }) },
  { id: 'moderate', name: 'Moderado', fmtXml: build('Moderado', { lines: [9525, 19050, 28575], gradients: false, shadows: [null, [38100, 12700, 35000], [50800, 19050, 45000]] }) },
  { id: 'intense', name: 'Intenso', fmtXml: build('Intenso', { lines: [12700, 25400, 38100], gradients: true, shadows: [[50800, 25400, 40000], [63500, 38100, 50000], [76200, 50800, 60000]] }) },
];

export const DEFAULT_FMT_XML = EFFECT_SCHEMES[0]!.fmtXml;
