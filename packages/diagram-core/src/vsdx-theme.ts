import { XMLParser } from 'fast-xml-parser';

/*
 * The theme of a Visio drawing (`visio/theme/themeN.xml`). A shape that has not been formatted by hand stores no colours:
 * its cells say «Themed» and Visio works them out from the theme of the page and the «quick style» numbers of the shape.
 * This module does that calculation. The rules were compared with the colours Visio itself computes for several themes
 * and variants.
 */

// ------------------------------------------------------------ colour arithmetic (DrawingML)

type Rgb = [number, number, number]; // 0..1, sRGB

const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const parseHex = (h: string): Rgb => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255) as Rgb;
export const toHex = (c: Rgb): string => `#${c.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('')}`;
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const k = Math.floor(h * 6) % 6;
  const rgb: Rgb = k === 0 ? [c, x, 0] : k === 1 ? [x, c, 0] : k === 2 ? [0, c, x] : k === 3 ? [0, x, c] : k === 4 ? [x, 0, c] : [c, 0, x];
  return rgb.map((v) => v + m) as Rgb;
}

export interface ColorMod {
  name: string;
  val: number; // fraction: 75 % is 0.75
}

/** `tint` and `shade` work on linear light; the luminance and saturation modifiers on HSL. */
export function applyMods(color: string, mods: ColorMod[]): string {
  let c = parseHex(color);
  for (const m of mods) {
    if (m.name === 'tint') c = c.map((v) => gamma(lin(v) * m.val + (1 - m.val))) as Rgb;
    else if (m.name === 'shade') c = c.map((v) => gamma(lin(v) * m.val)) as Rgb;
    else if (m.name === 'lumMod' || m.name === 'lumOff' || m.name === 'satMod' || m.name === 'satOff' || m.name === 'hueMod' || m.name === 'hueOff') {
      let [h, s, l] = toHsl(c);
      if (m.name === 'lumMod') l = clamp(l * m.val);
      else if (m.name === 'lumOff') l = clamp(l + m.val);
      else if (m.name === 'satMod') s = clamp(s * m.val);
      else if (m.name === 'satOff') s = clamp(s + m.val);
      else if (m.name === 'hueMod') h = (h * m.val) % 1;
      else h = (h + m.val + 1) % 1;
      c = fromHsl(h, s, l);
    }
  }
  return toHex(c);
}

/** `part` of `b` over `a`. */
export const mix = (a: string, b: string, part: number): string => {
  const y = parseHex(b);
  return toHex(parseHex(a).map((v, i) => v * (1 - part) + y[i]! * part) as Rgb);
};

/** The colour of a fill with transparency as it looks on white paper. */
export const overWhite = (color: string, trans: number): string => (trans > 0 ? toHex(parseHex(color).map((v) => v * (1 - trans) + trans) as Rgb) : color);

/** The mean of the stops of a gradient: what stands for it where only one colour can be kept. */
export function gradientColor(stops: { color: string; pos: number }[]): string {
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (!s.length) return '#ffffff';
  if (s.length === 1) return s[0]!.color;
  const sum: Rgb = [0, 0, 0];
  // the area under each stretch, with the end colours filling what comes before the first stop and after the last
  const all = [{ color: s[0]!.color, pos: 0 }, ...s, { color: s[s.length - 1]!.color, pos: 1 }];
  for (let i = 1; i < all.length; i++) {
    const w = Math.max(0, all[i]!.pos - all[i - 1]!.pos);
    const a = parseHex(all[i - 1]!.color);
    const b = parseHex(all[i]!.color);
    for (let k = 0; k < 3; k++) sum[k]! += (w * (a[k]! + b[k]!)) / 2;
  }
  return toHex(sum);
}

// ------------------------------------------------------------ reading the part

interface ColorSpec {
  scheme?: string; // phClr, lt1, accent1…
  rgb?: string;
  mods: ColorMod[];
}
interface FillSpec {
  none: boolean;
  color?: ColorSpec;
  gradient?: { color: ColorSpec; pos: number }[];
}
interface LineSpec {
  none: boolean;
  width: number; // inches
  color?: ColorSpec;
}
interface LineEx {
  start: number;
  end: number;
  pattern: number;
}
interface StyleSet {
  fills: FillSpec[];
  lines: LineSpec[];
  fonts: (ColorSpec | undefined)[];
  lineEx: LineEx[];
}

export interface VisioTheme {
  /** The number Visio gives the theme (`ColorSchemeIndex` of the page). */
  id: number;
  colors: Map<string, string>;
  variations: { mono: boolean; colors: string[] }[];
  varStyles: { fill: number; line: number; effect: number; font: number }[][];
  shapes: StyleSet;
  connectors: StyleSet;
  font: string;
}

type Node = any;

// the order of the children matters (colour modifiers, gradient stops), so the parser keeps it
const ordered = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, preserveOrder: true, parseAttributeValue: false });

const tagOf = (n: Node): string => Object.keys(n).find((k) => k !== ':@') ?? '';
const kidsOf = (n: Node): Node[] => (n ? ((n[tagOf(n)] as Node[]) ?? []) : []);
const attr = (n: Node, name: string): string | undefined => n?.[':@']?.[`@_${name}`];
const child = (n: Node, tag: string): Node | undefined => kidsOf(n).find((k) => tagOf(k) === tag);
const children = (n: Node, tag: string): Node[] => kidsOf(n).filter((k) => tagOf(k) === tag);
/** All descendants with a tag, in document order. */
function find(n: Node, tag: string, out: Node[] = []): Node[] {
  for (const k of kidsOf(n)) {
    if (tagOf(k) === tag) out.push(k);
    find(k, tag, out);
  }
  return out;
}

function colorSpec(parent: Node | undefined): ColorSpec | undefined {
  for (const k of kidsOf(parent)) {
    const tag = tagOf(k);
    if (tag !== 'schemeClr' && tag !== 'srgbClr' && tag !== 'sysClr') continue;
    const mods = kidsOf(k).map((m) => ({ name: tagOf(m), val: Number(attr(m, 'val') ?? 0) / 100000 }));
    if (tag === 'schemeClr') return { scheme: attr(k, 'val'), mods };
    const v = tag === 'srgbClr' ? attr(k, 'val') : attr(k, 'lastClr');
    return v ? { rgb: `#${v.toLowerCase()}`, mods } : undefined;
  }
  return undefined;
}

function fillSpec(n: Node): FillSpec {
  const tag = tagOf(n);
  if (tag === 'noFill') return { none: true };
  if (tag === 'gradFill') {
    const stops = find(n, 'gs').flatMap((g) => {
      const color = colorSpec(g);
      return color ? [{ color, pos: Number(attr(g, 'pos') ?? 0) / 100000 }] : [];
    });
    return { none: false, color: { scheme: 'phClr', mods: [] }, gradient: stops };
  }
  if (tag === 'pattFill') return { none: false, color: colorSpec(child(n, 'fgClr')) };
  return { none: false, color: colorSpec(n) };
}

function lineSpec(n: Node): LineSpec {
  const grad = child(n, 'gradFill');
  const color = colorSpec(child(n, 'solidFill')) ?? (grad ? colorSpec(find(grad, 'gs')[0]) : undefined);
  return { none: !!child(n, 'noFill'), width: Number(attr(n, 'w') ?? 9525) / 914400, color };
}

const lineExOf = (list: Node | undefined): LineEx[] =>
  find(list, 'lineEx').map((x) => ({ start: Number(attr(x, 'start') ?? 0), end: Number(attr(x, 'end') ?? 0), pattern: Number(attr(x, 'pattern') ?? 1) }));

function styleSet(scheme: Node | undefined, fonts: Node | undefined, lineEx: Node | undefined): StyleSet {
  return {
    fills: kidsOf(child(scheme, 'fillStyleLst')).map(fillSpec),
    lines: children(child(scheme, 'lnStyleLst'), 'ln').map(lineSpec),
    fonts: children(fonts, 'fontProps').map((f) => colorSpec(child(f, 'color'))),
    lineEx: lineExOf(lineEx),
  };
}

export function parseTheme(xml: string): VisioTheme | null {
  const root: Node | undefined = (ordered.parse(xml) as Node[]).find((n) => tagOf(n) === 'theme');
  const elements = child(root, 'themeElements');
  const scheme = child(elements, 'clrScheme');
  if (!root || !scheme) return null;
  const colors = new Map<string, string>();
  for (const c of kidsOf(scheme)) {
    const spec = colorSpec(c);
    if (spec?.rgb) colors.set(tagOf(c), spec.rgb);
  }
  const bkgnd = colorSpec(find(root, 'bkgnd')[0]);
  if (bkgnd?.rgb) colors.set('bkgnd', bkgnd.rgb);
  const first = (tag: string) => find(root, tag)[0];
  const idNode = find(first('themeScheme'), 'schemeID')[0] ?? find(scheme, 'schemeID')[0];
  const variations = find(root, 'variationClrScheme').map((v) => ({
    mono: attr(v, 'monotone') === '1',
    colors: [1, 2, 3, 4, 5, 6, 7].map((i) => colorSpec(child(v, `varColor${i}`))?.rgb ?? '#000000'),
  }));
  const varStyles = find(root, 'variationStyleScheme').map((v) =>
    children(v, 'varStyle').map((s) => ({ fill: Number(attr(s, 'fillIdx') ?? 1), line: Number(attr(s, 'lineIdx') ?? 1), effect: Number(attr(s, 'effectIdx') ?? 1), font: Number(attr(s, 'fontIdx') ?? 1) })),
  );
  const fontsGroup = first('fontStylesGroup');
  return {
    id: Number(attr(idNode, 'schemeEnum') ?? 0),
    colors,
    variations,
    varStyles,
    shapes: styleSet(child(elements, 'fmtScheme'), child(fontsGroup, 'fontStyles'), first('fmtSchemeLineStyles')),
    connectors: styleSet(first('fmtConnectorScheme'), child(fontsGroup, 'connectorFontStyles'), first('fmtConnectorSchemeLineStyles')),
    font: attr(child(child(child(elements, 'fontScheme'), 'minorFont'), 'latin'), 'typeface') || 'Calibri',
  };
}

// ------------------------------------------------------------ resolving a shape

/** The theme as a page uses it: the colours, fonts and connectors may each come from a different theme. */
export interface PageTheme {
  colors: VisioTheme;
  format: VisioTheme;
  connectors: VisioTheme;
  fonts: VisioTheme;
  variationColor: number;
  variationStyle: number;
}

export interface QuickStyle {
  fillColor: number;
  lineColor: number;
  fontColor: number;
  fillMatrix: number;
  lineMatrix: number;
  fontMatrix: number;
  /** A connector takes the connector styles of the theme. */
  connector: boolean;
}

export interface ThemedLook {
  /** Null when the theme says there is no fill (or no line). */
  fill: string | null;
  fillBack: string;
  gradient: boolean;
  line: string | null;
  lineWidth: number; // inches
  linePattern: number;
  text: string;
  startArrow: number;
  endArrow: number;
  font: string;
}

const NAMED = ['dk1', 'lt1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'bkgnd'];

/** The colour a quick style number stands for: 0–8 are theme colours; 100–106 and 200–206 colours of the variant. */
function quickColor(t: PageTheme, n: number): string {
  const c = t.colors;
  const base = () => c.colors.get('accent1') ?? '#4472c4';
  if (n >= 0 && n < NAMED.length) return c.colors.get(NAMED[n]!) ?? (n === 1 || n === 8 ? '#ffffff' : n === 0 ? '#000000' : base());
  const v = c.variations[t.variationColor] ?? c.variations[0];
  if (!v) return base();
  const k = n >= 200 ? n - 200 : n - 100;
  if (k < 0 || k > 6) return base();
  // in a one-colour variant the 100s all stand for its main colour; the 200s always pick one of the seven
  return v.colors[v.mono && n < 200 ? 0 : k]!;
}

const specColor = (t: PageTheme, spec: ColorSpec | undefined, ph: string): string | null => {
  if (!spec) return null;
  let base = spec.rgb;
  if (!base) base = spec.scheme === 'phClr' ? ph : t.colors.colors.get(spec.scheme ?? '') ?? t.colors.colors.get(spec.scheme === 'tx1' ? 'dk1' : spec.scheme === 'bg1' ? 'lt1' : '') ?? ph;
  return applyMods(base, spec.mods);
};

/** The entry of a style list that a matrix number picks: 1–6 directly, 100–103 through the variant. */
function pick(t: PageTheme, matrix: number, kind: 'fill' | 'line' | 'effect' | 'font'): number {
  if (matrix >= 100) {
    const row = t.format.varStyles[t.variationStyle] ?? t.format.varStyles[0];
    return row?.[(matrix - 100) % Math.max(1, row.length)]?.[kind] ?? 1;
  }
  return matrix;
}

const at = <T>(list: T[], oneBased: number): T | undefined => (oneBased < 1 ? undefined : list[Math.min(oneBased, list.length) - 1]);

export function themedLook(t: PageTheme, q: QuickStyle): ThemedLook {
  const format = q.connector ? t.connectors.connectors : t.format.shapes;
  const fills = format.fills;
  const fillPh = quickColor(t, q.fillColor);
  const fill = at(fills, pick(t, q.fillMatrix, 'fill'));
  const gradient = fill?.gradient?.length ? fill.gradient : null;
  const fillColor = !fill || fill.none ? null : specColor(t, fill.color, fillPh);
  const li = pick(t, q.lineMatrix, 'line');
  const line = at(format.lines, li);
  const linePh = quickColor(t, q.lineColor);
  const fi = pick(t, q.fontMatrix, 'font');
  const fontPh = quickColor(t, q.fontColor);
  // the line ends and patterns of the theme count from 0 (there is one entry more than there are line styles)
  const lineEx = format.lineEx[Math.max(0, Math.min(li, format.lineEx.length - 1))];
  return {
    fill: fillColor,
    fillBack: gradient ? gradientColor(gradient.map((g) => ({ color: specColor(t, g.color, fillPh) ?? fillPh, pos: g.pos }))) : (fillColor ?? '#ffffff'),
    gradient: !!gradient,
    line: !line || line.none ? null : specColor(t, line.color, linePh),
    lineWidth: line?.width ?? 1 / 96,
    linePattern: lineEx?.pattern ?? 1,
    text: specColor(t, at(format.fonts, fi), fontPh) ?? fontPh,
    startArrow: lineEx?.start ?? 0,
    endArrow: lineEx?.end ?? 0,
    font: t.fonts.font,
  };
}
