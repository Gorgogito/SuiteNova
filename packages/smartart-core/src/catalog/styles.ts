import { NS } from '../datamodel';

/*
 * Estilos rápidos y conjuntos de colores propios, generados a partir de una tabla de etiquetas de estilo (las que usan los diseños
 * del catálogo). Misma forma que los de Office: \`dgm:styleDef\` y \`dgm:colorsDef\`.
 */

export interface CatalogStyle {
  id: string;
  name: string;
  xml: string;
}

export interface CatalogColors {
  id: string;
  name: string;
  /** Color de acento del tema (1 a 6) que domina, o `colorful` para varios. Sirve para dibujar la muestra de la galería. */
  accent: number | 'colorful';
  xml: string;
}

const ZERO = '<a:scrgbClr r="0" g="0" b="0"/>';
const levels = (prefix: string, from = 1, to = 4) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

/** Etiquetas de estilo: nombre, referencia de línea, de relleno y si el texto lleva la fuente clara. */
const LABELS: [string, number, number, boolean][] = [
  ...levels('node', 0).map((n): [string, number, number, boolean] => [n, 2, 1, true]),
  ...levels('fgAcc', 0).map((n): [string, number, number, boolean] => [n, 2, 1, false]),
  ['fgShp', 2, 1, false],
  ['vennNode1', 2, 1, false],
  ...levels('sibTrans2D').map((n): [string, number, number, boolean] => [n, 0, 1, true]),
  ...levels('parChTrans1D').map((n): [string, number, number, boolean] => [n, 2, 0, false]),
  ['revTx', 0, 0, false],
];

const scene = '<dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d>';

function styleXml(id: string, name: string, cat: string, pri: number, line: (idx: number) => number): string {
  const lbls = LABELS.map(([n, ln, fill, light]) => {
    const font = light ? '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>' : '<a:fontRef idx="minor"/>';
    return `<dgm:styleLbl name="${n}">${scene}<dgm:sp3d/><dgm:txPr/><dgm:style><a:lnRef idx="${line(ln)}">${ZERO}</a:lnRef><a:fillRef idx="${fill}">${ZERO}</a:fillRef><a:effectRef idx="0">${ZERO}</a:effectRef>${font}</dgm:style></dgm:styleLbl>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:styleDef xmlns:dgm="${NS.dgm}" xmlns:a="${NS.a}" uniqueId="${id}"><dgm:title val="${name}"/><dgm:desc val=""/><dgm:catLst><dgm:cat type="${cat}" pri="${pri}"/></dgm:catLst>${scene}${lbls}</dgm:styleDef>`;
}

export const STYLE_CATALOG: CatalogStyle[] = [
  { id: 'urn:suitenova/quickStyle/simple', name: 'Simple', xml: styleXml('urn:suitenova/quickStyle/simple', 'Simple', 'simple', 100, (l) => l) },
  { id: 'urn:suitenova/quickStyle/flat', name: 'Sin contorno', xml: styleXml('urn:suitenova/quickStyle/flat', 'Sin contorno', 'simple', 200, (l) => (l === 2 ? 0 : l)) },
  { id: 'urn:suitenova/quickStyle/bold', name: 'Contorno grueso', xml: styleXml('urn:suitenova/quickStyle/bold', 'Contorno grueso', 'simple', 300, (l) => (l === 2 ? 3 : l)) },
];

const sc = (val: string, mods = '') => (mods ? `<a:schemeClr val="${val}">${mods}</a:schemeClr>` : `<a:schemeClr val="${val}"/>`);
const list = (colors: string[], meth = 'repeat') => (colors.length ? `meth="${meth}">${colors.join('')}` : '>');

function colorsXml(id: string, name: string, cat: string, pri: number, accents: string[]): string {
  // varios colores de acento se reparten entre las formas; con uno solo, todas lo llevan
  const acc = (i: number) => accents[i % accents.length]!;
  const lbl = (n: string, fill: string[], lin: string[], txFill: string[] = []) =>
    `<dgm:styleLbl name="${n}"><dgm:fillClrLst ${list(fill)}</dgm:fillClrLst><dgm:linClrLst ${list(lin)}</dgm:linClrLst><dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst ${list(txFill)}</dgm:txFillClrLst><dgm:txEffectClrLst/></dgm:styleLbl>`;
  const out: string[] = [];
  levels('node', 0).forEach((n) => out.push(lbl(n, accents.map((a) => sc(a)), [sc('lt1')])));
  levels('fgAcc', 0).forEach((n) => out.push(lbl(n, [sc('lt1', '<a:alpha val="90000"/>')], [sc(acc(0))], [sc('dk1')])));
  out.push(lbl('fgShp', [sc(acc(0), '<a:tint val="60000"/>')], [sc('lt1')], [sc('dk1')]));
  out.push(lbl('vennNode1', accents.map((a) => sc(a, '<a:alpha val="50000"/>')), [sc('lt1')]));
  levels('sibTrans2D').forEach((n) => out.push(lbl(n, [sc(acc(0), '<a:tint val="60000"/>')], [sc(acc(0), '<a:tint val="60000"/>')])));
  levels('parChTrans1D').forEach((n, i) => out.push(lbl(n, [sc(acc(0))], [sc(acc(0), `<a:shade val="${i < 2 ? 60000 : 80000}"/>`)], [sc('tx1')])));
  out.push(lbl('revTx', [sc('lt1', '<a:alpha val="0"/>')], [sc('dk1', '<a:alpha val="0"/>')], [sc('tx1')]));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:colorsDef xmlns:dgm="${NS.dgm}" xmlns:a="${NS.a}" uniqueId="${id}"><dgm:title val="${name}"/><dgm:desc val=""/><dgm:catLst><dgm:cat type="${cat}" pri="${pri}"/></dgm:catLst>${out.join('')}</dgm:colorsDef>`;
}

export const COLORS_CATALOG: CatalogColors[] = [
  ...[1, 2, 3, 4, 5, 6].map((k): CatalogColors => ({ id: `urn:suitenova/colors/accent${k}`, name: `Énfasis ${k}`, accent: k, xml: colorsXml(`urn:suitenova/colors/accent${k}`, `Énfasis ${k}`, `accent${k}`, 100 + k, [`accent${k}`]) })),
  { id: 'urn:suitenova/colors/colorful', name: 'Colorido', accent: 'colorful', xml: colorsXml('urn:suitenova/colors/colorful', 'Colorido', 'colorful', 200, ['accent2', 'accent3', 'accent4', 'accent5', 'accent6']) },
];

export const styleById = (id: string): CatalogStyle | undefined => STYLE_CATALOG.find((s) => s.id === id);
export const colorsById = (id: string): CatalogColors | undefined => COLORS_CATALOG.find((c) => c.id === id);
