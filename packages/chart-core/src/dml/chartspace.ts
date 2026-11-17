import { DEFAULT_3D, STOCK_SERIES, type Chart3D, type ChartAxis, type AreaFormat, type ChartFonts, type ChartSeries, type ChartSpec, type DashStyle, type TextFormat, type DataLabels, type LabelPos, type LegendPos, type MarkerFormat, type MarkerSymbol, type PointFormat, type StrokeFormat, type ChartType, type SeriesType, type StockKind } from '../model';
import { formatChartNumber } from '../format';
import type { ChartCell, ChartSource } from '../source';
import { errBarsXml, parseErrBars, parseTrendlines, trendlinesXml } from './fitio';
import { asArray, attr, escapeXml, textOf, type XNode } from './xml';

/** Colores del tema de Office por omisión (lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink), para los gráficos sin tema. */
export const DEFAULT_CHART_THEME: string[] = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];

export const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
export const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** Líneas de la cuadrícula en gris claro, como las de Excel (sin esto Excel las dibuja negras y gruesas). */
const GRIDLINES = '<c:majorGridlines><c:spPr><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill><a:round/></a:ln></c:spPr></c:majorGridlines>';


const MINOR_GRIDLINES = '<c:minorGridlines><c:spPr><a:ln w="9525" cap="flat"><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill><a:round/></a:ln></c:spPr></c:minorGridlines>';

/** The label positions Excel accepts for each kind of chart (a wrong one makes Excel refuse the file). */
function labelPositions(kind: GroupKind, def: ChartSpec): LabelPos[] {
  if (def.threeD) return kind === 'pie' ? ['bestFit', 'ctr', 'inEnd', 'outEnd'] : [];
  switch (kind) {
    case 'bar':
      return def.stacked ? ['ctr', 'inEnd', 'inBase'] : ['ctr', 'inEnd', 'inBase', 'outEnd'];
    case 'line':
    case 'scatter':
      return ['t', 'b', 'l', 'r', 'ctr'];
    case 'pie':
      return ['bestFit', 'ctr', 'inEnd', 'outEnd'];
    default:
      return [];
  }
}

/** `c:dLbls` of a series: what its data labels say and where they go. */
function labelsXml(s: ChartSeries, kind: GroupKind, def: ChartSpec): string {
  const l = s.labels;
  if (!l || !(l.value || l.category || l.series || l.percent)) return '';
  const pos = l.pos && labelPositions(kind, def).includes(l.pos) ? `<c:dLblPos val="${l.pos}"/>` : '';
  const flag = (n: string, v: boolean | undefined) => `<c:${n} val="${v ? 1 : 0}"/>`;
  return (
    '<c:dLbls>' +
    (l.format ? `<c:numFmt formatCode="${escapeXml(l.format)}" sourceLinked="0"/>` : '') +
    '<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>' +
    txPrXml(mergeFont(activeFonts?.chart, activeFonts?.labels)) +
    pos +
    flag('showLegendKey', false) +
    flag('showVal', l.value) +
    flag('showCatName', l.category) +
    flag('showSerName', l.series) +
    flag('showPercent', l.percent && (kind === 'pie' || kind === 'doughnut')) +
    flag('showBubbleSize', false) +
    (l.separator !== undefined && l.separator !== ', ' ? `<c:separator>${escapeXml(l.separator)}</c:separator>` : '') +
    (kind === 'pie' || kind === 'doughnut' ? '<c:showLeaderLines val="1"/>' : '') +
    '</c:dLbls>'
  );
}

/** `c:dTable` (Excel's "Data table"), only where Excel allows it: column, line and area charts. */
function dataTableXml(def: ChartSpec, kinds: Set<GroupKind>): string {
  if (!def.dataTable || def.type === 'bar') return '';
  if (![...kinds].every((k) => k === 'bar' || k === 'line' || k === 'area')) return '';
  return `<c:dTable><c:showHorzBorder val="1"/><c:showVertBorder val="1"/><c:showOutline val="1"/><c:showKeys val="${def.dataTable.keys ? 1 : 0}"/></c:dTable>`;
}

function readLabels(s: XNode): DataLabels | undefined {
  const d = s?.dLbls;
  if (!d || d.delete !== undefined) return undefined;
  const on = (k: string) => ['1', 'true'].includes(attr(d[k], 'val') ?? '');
  const out: DataLabels = {};
  if (on('showVal')) out.value = true;
  if (on('showCatName')) out.category = true;
  if (on('showSerName')) out.series = true;
  if (on('showPercent')) out.percent = true;
  if (!out.value && !out.category && !out.series && !out.percent) return undefined;
  const pos = attr(d.dLblPos, 'val');
  if (pos && ['ctr', 'inEnd', 'inBase', 'outEnd', 't', 'b', 'l', 'r', 'bestFit'].includes(pos)) out.pos = pos as LabelPos;
  if (d.separator !== undefined) out.separator = textOf(d.separator);
  const nf = asArray(d.numFmt)[0];
  if (nf && attr(nf, 'sourceLinked') !== '1' && attr(nf, 'formatCode') && attr(nf, 'formatCode') !== 'General') out.format = attr(nf, 'formatCode');
  return out;
}


// ---- formato de serie y de punto (relleno, borde, línea, marcadores)
const DASH_OUT: Record<string, string> = { solid: 'solid', dash: 'dash', dot: 'sysDot', dashDot: 'dashDot', longDash: 'lgDash' };
const DASH_IN: Record<string, DashStyle> = { solid: 'solid', dash: 'dash', sysDash: 'dash', dot: 'dot', sysDot: 'dot', dashDot: 'dashDot', sysDashDot: 'dashDot', lgDash: 'longDash', lgDashDot: 'dashDot', sysDashDotDot: 'dashDot', lgDashDotDot: 'dashDot' };

const hex6 = (c: string) => c.replace('#', '').toUpperCase();
const colorXml = (c: string, transparency?: number) => `<a:srgbClr val="${hex6(c)}">${transparency ? `<a:alpha val="${Math.round((100 - transparency) * 1000)}"/>` : ''}</a:srgbClr>`;

/** El relleno de una serie o un punto: liso (con transparencia), sin relleno, o nada (el estilo del gráfico). */
function fillXml(color: string | undefined, o: { noFill?: boolean; transparency?: number } = {}): string {
  if (o.noFill) return '<a:noFill/>';
  return color ? `<a:solidFill>${colorXml(color, o.transparency)}</a:solidFill>` : '';
}

/** `a:ln` de una línea o un borde. `fallback` es el color cuando el formato no trae uno propio. */
function lnXml(st: StrokeFormat | undefined, fallback: string | undefined, def: { width?: number; round?: boolean } = {}): string {
  if (st?.none) return '<a:ln><a:noFill/></a:ln>';
  const width = st?.width !== undefined ? Math.round(st.width * 12700) : def.width;
  const color = st?.color ?? fallback;
  const inner = (color ? `<a:solidFill>${colorXml(color)}</a:solidFill>` : '') + (st?.dash ? `<a:prstDash val="${DASH_OUT[st.dash]}"/>` : '') + (def.round ? '<a:round/>' : '');
  if (!inner && width === undefined) return '';
  return `<a:ln${width !== undefined ? ` w="${width}"` : ''}${def.round ? ' cap="rnd"' : ''}>${inner}</a:ln>`;
}

const SYMBOL_OUT = ['circle', 'square', 'diamond', 'triangle', 'x', 'star', 'dot', 'dash', 'plus', 'none'];

function markerXml(m: MarkerFormat | undefined, color: string | undefined, fallbackSymbol: string): string {
  const symbol = m?.symbol && SYMBOL_OUT.includes(m.symbol) ? m.symbol : fallbackSymbol;
  if (symbol === 'none') return '<c:marker><c:symbol val="none"/></c:marker>';
  const c = m?.color ?? color;
  const size = m?.size !== undefined ? Math.max(2, Math.min(72, Math.round(m.size))) : undefined;
  return `<c:marker><c:symbol val="${symbol}"/>${size !== undefined ? `<c:size val="${size}"/>` : ''}${c ? `<c:spPr>${fillXml(c)}<a:ln w="9525">${`<a:solidFill>${colorXml(c)}</a:solidFill>`}</a:ln></c:spPr>` : ''}</c:marker>`;
}

/** `c:dPt` de los puntos con formato propio (columnas y sectores). */
function pointsXml(s: ChartSeries, kind: GroupKind): string {
  if (!(kind === 'bar' || kind === 'pie' || kind === 'doughnut')) return '';
  return (s.points ?? [])
    .filter((p) => p.color || p.explosion)
    .map((p) => {
      const sp = p.color ? `<c:spPr>${fillXml(p.color, { transparency: s.transparency })}${lnXml(s.line, undefined)}</c:spPr>` : '';
      return kind === 'bar'
        ? `<c:dPt><c:idx val="${p.idx}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/>${sp}</c:dPt>`
        : `<c:dPt><c:idx val="${p.idx}"/><c:bubble3D val="0"/>${p.explosion ? `<c:explosion val="${Math.round(p.explosion)}"/>` : ''}${sp}</c:dPt>`;
    })
    .join('');
}

const explosionXml = (s: ChartSeries): string => (s.explosion ? `<c:explosion val="${Math.round(s.explosion)}"/>` : '');

// ---- lectura
function readColorNode(sf: XNode, theme: string[]): { color: string; transparency?: number } | undefined {
  if (!sf) return undefined;
  const node = sf.srgbClr ?? sf.schemeClr;
  let color: string | undefined;
  if (sf.srgbClr) {
    const v = attr(sf.srgbClr, 'val');
    color = v ? `#${v.slice(-6).toLowerCase()}` : undefined;
  } else if (sf.schemeClr) {
    const i = SCHEME_INDEX[attr(sf.schemeClr, 'val') ?? ''];
    const h = i === undefined ? undefined : theme[i];
    color = h ? `#${h.toLowerCase()}` : undefined;
  }
  if (!color) return undefined;
  if (node) color = adjustColor(color, node);
  const a = Number(attr(node?.alpha, 'val'));
  return Number.isFinite(a) && node?.alpha !== undefined && a < 100000 ? { color, transparency: Math.round(100 - a / 1000) } : { color };
}

function readStroke(ln: XNode, theme: string[]): StrokeFormat | undefined {
  if (!ln) return undefined;
  if (ln.noFill !== undefined) return { none: true };
  const out: StrokeFormat = {};
  const c = readColorNode(ln.solidFill, theme);
  if (c) out.color = c.color;
  const w = Number(attr(ln, 'w'));
  if (Number.isFinite(w) && w > 0) out.width = Math.round((w / 12700) * 100) / 100;
  const dash = DASH_IN[attr(ln.prstDash, 'val') ?? ''];
  if (dash && dash !== 'solid') out.dash = dash;
  return Object.keys(out).length ? out : undefined;
}

function readMarker(m: XNode, theme: string[]): MarkerFormat | undefined {
  if (!m) return undefined;
  const out: MarkerFormat = {};
  const sym = attr(m.symbol, 'val');
  if (sym && SYMBOL_OUT.includes(sym)) out.symbol = sym as MarkerSymbol;
  const size = Number(attr(m.size, 'val'));
  if (Number.isFinite(size) && m.size !== undefined) out.size = size;
  const c = readColorNode(m.spPr?.solidFill, theme);
  if (c) out.color = c.color;
  return Object.keys(out).length ? out : undefined;
}

function readPoints(s: XNode, theme: string[]): PointFormat[] {
  const out: PointFormat[] = [];
  for (const p of asArray(s.dPt)) {
    const idx = Number(attr(p.idx, 'val'));
    if (!Number.isInteger(idx)) continue;
    const pt: PointFormat = { idx };
    const c = readColorNode(p.spPr?.solidFill, theme);
    if (c) pt.color = c.color;
    const ex = Number(attr(p.explosion, 'val'));
    if (p.explosion !== undefined && Number.isFinite(ex) && ex > 0) pt.explosion = ex;
    if (pt.color || pt.explosion) out.push(pt);
  }
  return out;
}


// ---- área del gráfico, área de trazado y fuentes
/** Las fuentes del gráfico que se está escribiendo (las funciones de ejes y etiquetas las leen). */
let activeFonts: ChartFonts | undefined;

function defRPr(f: TextFormat | undefined, extra = ''): string {
  const attrs = (f?.size !== undefined ? ` sz="${Math.round(f.size * 100)}"` : '') + (f?.bold !== undefined ? ` b="${f.bold ? 1 : 0}"` : '') + (f?.italic !== undefined ? ` i="${f.italic ? 1 : 0}"` : '') + extra;
  const inner = (f?.color ? `<a:solidFill>${colorXml(f.color)}</a:solidFill>` : '') + (f?.family ? `<a:latin typeface="${escapeXml(f.family)}"/>` : '');
  return `<a:defRPr${attrs}>${inner}</a:defRPr>`;
}

/** `c:txPr` con la fuente; vacío si no hay nada que decir. */
function txPrXml(f: TextFormat | undefined): string {
  if (!f || !(f.size !== undefined || f.bold !== undefined || f.italic !== undefined || f.color || f.family)) return '';
  return `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${defRPr(f)}</a:pPr><a:endParaRPr lang="es-ES"/></a:p></c:txPr>`;
}

const mergeFont = (base: TextFormat | undefined, f: TextFormat | undefined): TextFormat | undefined => (base || f ? { ...base, ...f } : undefined);

function areaSpPr(a: AreaFormat | undefined): string {
  if (!a) return '';
  const fill = fillXml(a.fill, { noFill: a.noFill, transparency: a.transparency });
  const ln = lnXml(a.line, undefined);
  return fill || ln ? `<c:spPr>${fill}${ln}</c:spPr>` : '';
}

/** El título, con su fuente si la trae. */
function titleXml(text: string, f: TextFormat | undefined): string {
  const m = { bold: true, ...f };
  const rpr = (tag: string) => {
    const attrs = (m.size !== undefined ? ` sz="${Math.round(m.size * 100)}"` : '') + ` b="${m.bold ? 1 : 0}"` + (m.italic ? ' i="1"' : '');
    const inner = (m.color ? `<a:solidFill>${colorXml(m.color)}</a:solidFill>` : '') + (m.family ? `<a:latin typeface="${escapeXml(m.family)}"/>` : '');
    return `<a:${tag}${tag === 'rPr' ? ' lang="es-ES"' : ''}${attrs}>${inner}</a:${tag}>`;
  };
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${rpr('defRPr')}</a:pPr><a:r>${rpr('rPr')}<a:t>${escapeXml(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function readFont(node: XNode, theme: string[]): TextFormat | undefined {
  const d = node?.p?.pPr?.defRPr ?? asArray(node?.p)[0]?.pPr?.defRPr ?? node?.defRPr;
  if (!d) return undefined;
  const out: TextFormat = {};
  const sz = Number(attr(d, 'sz'));
  if (Number.isFinite(sz) && attr(d, 'sz') !== undefined) out.size = Math.round(sz) / 100;
  if (attr(d, 'b') !== undefined) out.bold = ['1', 'true'].includes(attr(d, 'b')!);
  if (attr(d, 'i') !== undefined) out.italic = ['1', 'true'].includes(attr(d, 'i')!);
  const face = attr(d.latin, 'typeface');
  if (face && !face.startsWith('+')) out.family = face;
  const c = readColorNode(d.solidFill, theme);
  if (c) out.color = c.color;
  return Object.keys(out).length ? out : undefined;
}

/** La fuente de un título (de su primera ejecución, o de la del párrafo). */
function readTitleFont(title: XNode, theme: string[]): TextFormat | undefined {
  const p = asArray(title?.tx?.rich?.p)[0];
  if (!p) return undefined;
  const run = asArray(p.r)[0];
  const merged = { ...(readFont({ defRPr: p.pPr?.defRPr }, theme) ?? {}), ...(readFont({ defRPr: run?.rPr }, theme) ?? {}) };
  return Object.keys(merged).length ? merged : undefined;
}

function readArea(sp: XNode, theme: string[]): AreaFormat | undefined {
  if (!sp) return undefined;
  const out: AreaFormat = {};
  if (sp.noFill !== undefined) out.noFill = true;
  const c = readColorNode(sp.solidFill, theme);
  if (c) {
    out.fill = c.color;
    if (c.transparency) out.transparency = c.transparency;
  }
  const line = readStroke(sp.ln, theme);
  if (line) out.line = line;
  return Object.keys(out).length ? out : undefined;
}

/** `lumMod`, `lumOff`, `tint` y `shade` de un color del tema (lo que Excel usa para sus grises y sus tonos claros). */
function adjustColor(hex: string, node: XNode): string {
  const n = (k: string) => {
    const v = Number(attr(node?.[k], 'val'));
    return node?.[k] !== undefined && Number.isFinite(v) ? v / 100000 : undefined;
  };
  const lumMod = n('lumMod');
  const lumOff = n('lumOff');
  const tint = n('tint');
  const shade = n('shade');
  if (lumMod === undefined && lumOff === undefined && tint === undefined && shade === undefined) return hex;
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  if (lumMod !== undefined || lumOff !== undefined) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    let l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    l = Math.max(0, Math.min(1, l * (lumMod ?? 1) + (lumOff ?? 0)));
    const hue = (p: number, q: number, t: number) => {
      const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      return tt < 1 / 6 ? p + (q - p) * 6 * tt : tt < 1 / 2 ? q : tt < 2 / 3 ? p + (q - p) * (2 / 3 - tt) * 6 : p;
    };
    if (s === 0) r = g = b = l;
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue(p, q, h + 1 / 3);
      g = hue(p, q, h);
      b = hue(p, q, h - 1 / 3);
    }
  }
  if (tint !== undefined) [r, g, b] = [r * tint + (1 - tint), g * tint + (1 - tint), b * tint + (1 - tint)];
  if (shade !== undefined) [r, g, b] = [r * shade, g * shade, b * shade];
  const x = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${x(r)}${x(g)}${x(b)}`;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ------------------------------------------------------------------------------------------------ writing
const cellText = (v: ChartCell): string => (typeof v === 'number' ? formatChartNumber(v) : v === null ? '' : String(v));

function strCache(values: ChartCell[]): string {
  const pts = values.map((v, i) => `<c:pt idx="${i}"><c:v>${escapeXml(cellText(v))}</c:v></c:pt>`).join('');
  return `<c:strCache><c:ptCount val="${values.length}"/>${pts}</c:strCache>`;
}

function numCache(values: ChartCell[]): string {
  const pts = values.map((v, i) => (typeof v === 'number' ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('');
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

type GroupKind = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter' | 'radar' | 'stock' | 'surface';

interface Group {
  kind: GroupKind;
  horizontal?: boolean;
  series: { s: ChartSeries; index: number }[];
  secondary: boolean;
}

function serXml(item: { s: ChartSeries; index: number }, g: Group, def: ChartSpec, src: ChartSource): string {
  const { s, index } = item;
  const tx = s.nameRef
    ? `<c:tx><c:strRef><c:f>${escapeXml(s.nameRef)}</c:f>${strCache(src.range(s.nameRef).values.slice(0, 1))}</c:strRef></c:tx>`
    : s.name
      ? `<c:tx><c:v>${escapeXml(s.name)}</c:v></c:tx>`
      : '';
  const vals = src.range(s.values).values;
  const catVals = s.categories ? src.range(s.categories).values : [];
  const numericCats = catVals.length > 0 && catVals.every((v) => typeof v === 'number');
  const cat = s.categories
    ? `<c:cat>${numericCats ? `<c:numRef><c:f>${escapeXml(s.categories)}</c:f>${numCache(catVals)}</c:numRef>` : `<c:strRef><c:f>${escapeXml(s.categories)}</c:f>${strCache(catVals)}</c:strRef>`}</c:cat>`
    : '';
  const val = `<c:val><c:numRef><c:f>${escapeXml(s.values)}</c:f>${numCache(vals)}</c:numRef></c:val>`;
  const head = `<c:idx val="${index}"/><c:order val="${index}"/>${tx}`;
  const color = s.color;
  // tendencias y barras de error (no con apiladas ni 3D, donde Excel no las admite)
  const analysis = (kind: 'scatter' | 'line' | 'other') => (def.stacked || def.threeD ? '' : trendlinesXml(s) + errBarsXml(s, kind, src));
  switch (g.kind) {
    case 'scatter': {
      const x = s.categories ? `<c:xVal><c:numRef><c:f>${escapeXml(s.categories)}</c:f>${numCache(catVals)}</c:numRef></c:xVal>` : '';
      const sp = `<c:spPr>${s.line && !s.line.none ? lnXml(s.line, color, { width: 19050 }) : '<a:ln w="19050"><a:noFill/></a:ln>'}</c:spPr>`;
      const marker = color || s.marker ? markerXml({ size: 7, ...s.marker }, color, 'circle') : '';
      return `<c:ser>${head}${sp}${marker}${labelsXml(s, 'scatter', def)}${analysis('scatter')}${x}<c:yVal><c:numRef><c:f>${escapeXml(s.values)}</c:f>${numCache(vals)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
    }
    case 'bar': {
      const sp = color || s.line || s.noFill ? `<c:spPr>${fillXml(color, s)}${lnXml(s.line, undefined)}</c:spPr>` : '';
      return `<c:ser>${head}${sp}<c:invertIfNegative val="0"/>${pointsXml(s, 'bar')}${labelsXml(s, 'bar', def)}${analysis('other')}${cat}${val}</c:ser>`;
    }
    case 'line': {
      const sp = `<c:spPr>${lnXml(s.line, color, { width: 28575, round: true })}</c:spPr>`;
      return `<c:ser>${head}${sp}${markerXml(s.marker, color, def.type === 'line' || s.type === 'line' ? 'circle' : 'none')}${labelsXml(s, 'line', def)}${analysis('line')}${cat}${val}<c:smooth val="${def.smooth ? 1 : 0}"/></c:ser>`;
    }
    case 'area': {
      const sp = color || s.line || s.noFill ? `<c:spPr>${fillXml(color, s)}${lnXml(s.line, undefined)}</c:spPr>` : '';
      return `<c:ser>${head}${sp}${labelsXml(s, 'area', def)}${analysis('other')}${cat}${val}</c:ser>`;
    }
    case 'radar': {
      const filled = !!def.radar?.filled;
      const sp = filled ? (color ? `<c:spPr>${fillXml(color, s)}${lnXml(s.line, undefined)}</c:spPr>` : '') : `<c:spPr>${lnXml(s.line, color, { width: 28575 })}</c:spPr>`;
      const marker = filled ? '' : markerXml(s.marker, color, def.radar?.markers ? 'circle' : 'none');
      return `<c:ser>${head}${sp}${marker}${labelsXml(s, 'radar', def)}${cat}${val}</c:ser>`;
    }
    case 'stock': {
      return `<c:ser>${head}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
    }
    case 'surface':
      return `<c:ser>${head}${cat}${val}</c:ser>`;
    default: {
      const sp = color || s.line || s.noFill ? `<c:spPr>${fillXml(color, s)}${lnXml(s.line, undefined)}</c:spPr>` : '';
      return `<c:ser>${head}${sp}${explosionXml(s)}${pointsXml(s, g.kind)}${labelsXml(s, g.kind, def)}${cat}${val}</c:ser>`;
    }
  }
}

function axisTitle(a: ChartAxis | undefined, rotate = false): string {
  if (!a?.title) return '';
  const f = mergeFont(activeFonts?.chart, activeFonts?.axisTitle);
  const attrs = (f?.size !== undefined ? ` sz="${Math.round(f.size * 100)}"` : '') + (f?.bold !== undefined ? ` b="${f.bold ? 1 : 0}"` : '') + (f?.italic ? ' i="1"' : '');
  const inner = (f?.color ? `<a:solidFill>${colorXml(f.color)}</a:solidFill>` : '') + (f?.family ? `<a:latin typeface="${escapeXml(f.family)}"/>` : '');
  return `<c:title><c:tx><c:rich><a:bodyPr${rotate ? ' rot="-5400000" vert="horz"' : ''}/><a:lstStyle/><a:p><a:pPr><a:defRPr${attrs}>${inner}</a:defRPr></a:pPr><a:r><a:rPr lang="es-ES"${attrs}>${inner}</a:rPr><a:t>${escapeXml(a.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function scaling(a: ChartAxis | undefined, reverse: boolean): string {
  const orient = !!a?.reverse !== reverse ? 'maxMin' : 'minMax';
  return `<c:scaling>${a?.log ? '<c:logBase val="10"/>' : ''}<c:orientation val="${orient}"/>${a?.max !== undefined ? `<c:max val="${a.max}"/>` : ''}${a?.min !== undefined ? `<c:min val="${a.min}"/>` : ''}</c:scaling>`;
}

const numFmtXml = (a: ChartAxis | undefined) => `<c:numFmt formatCode="${escapeXml(a?.format ?? 'General')}" sourceLinked="${a?.format ? 0 : 1}"/>`;

function catAxXml(id: number, cross: number, o: { pos: 'b' | 'l' | 'r' | 't'; deleted?: boolean; axis?: ChartAxis; reverse?: boolean; grid?: boolean; rotate?: boolean }): string {
  return (
    `<c:catAx><c:axId val="${id}"/>${scaling(o.axis, !!o.reverse)}<c:delete val="${o.deleted || o.axis?.hidden ? 1 : 0}"/><c:axPos val="${o.pos}"/>${o.axis?.gridlines || o.grid ? GRIDLINES : ''}${o.axis?.minorGridlines ? MINOR_GRIDLINES : ''}` +
    `${axisTitle(o.axis, o.rotate)}${numFmtXml(o.axis)}<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${txPrXml(mergeFont(activeFonts?.chart, activeFonts?.axis))}` +
    `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
  );
}

function valAxXml(id: number, cross: number, o: { pos: 'b' | 'l' | 'r' | 't'; deleted?: boolean; axis?: ChartAxis; crosses?: 'autoZero' | 'max'; between?: 'between' | 'midCat'; grid?: boolean; reverse?: boolean; rotate?: boolean }): string {
  const grid = o.axis?.gridlines ?? o.grid ?? false;
  return (
    `<c:valAx><c:axId val="${id}"/>${scaling(o.axis, !!o.reverse)}<c:delete val="${o.deleted || o.axis?.hidden ? 1 : 0}"/><c:axPos val="${o.pos}"/>${grid ? GRIDLINES : ''}${o.axis?.minorGridlines ? MINOR_GRIDLINES : ''}` +
    `${axisTitle(o.axis, o.rotate)}${numFmtXml(o.axis)}<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${txPrXml(mergeFont(activeFonts?.chart, activeFonts?.axis))}` +
    `<c:crossAx val="${cross}"/><c:crosses val="${o.crosses ?? 'autoZero'}"/><c:crossBetween val="${o.between ?? 'between'}"/></c:valAx>`
  );
}

const serAxXml = (id: number, cross: number) =>
  `<c:serAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/></c:serAx>`;

/** How the series of a chart are split into the chart groups of a plot area. */
function groupsOf(def: ChartSpec): Group[] {
  const all = def.series.map((s, index) => ({ s, index }));
  const typeOf = (s: ChartSeries): GroupKind => {
    const t: ChartType | SeriesType = s.type ?? def.type;
    switch (t) {
      case 'column':
      case 'bar':
        return 'bar';
      case 'line':
        return 'line';
      case 'area':
        return 'area';
      case 'scatter':
        return 'scatter';
      default:
        return t as GroupKind;
    }
  };
  if (def.type === 'stock') {
    const kind = def.stock?.kind ?? 'hlc';
    const volume = kind === 'vhlc' || kind === 'vohlc';
    const groups: Group[] = [];
    if (volume) groups.push({ kind: 'bar', series: all.slice(0, 1), secondary: false });
    groups.push({ kind: 'stock', series: volume ? all.slice(1) : all, secondary: volume });
    return groups;
  }
  const out: Group[] = [];
  const order: GroupKind[] = ['area', 'bar', 'line', 'scatter', 'pie', 'doughnut', 'radar', 'surface'];
  for (const secondary of [false, true]) {
    for (const kind of order) {
      const series = all.filter((x) => typeOf(x.s) === kind && !!x.s.secondary === secondary);
      if (series.length) out.push({ kind, horizontal: def.type === 'bar', series, secondary });
    }
  }
  return out;
}

const BASE_AX: [number, number, number] = [111, 222, 555];
const SEC_AX: [number, number] = [333, 444];

function groupXml(g: Group, def: ChartSpec, src: ChartSource): string {
  const sers = g.series.map((x) => serXml(x, g, def, src)).join('');
  const [a, b, c] = g.secondary ? [SEC_AX[0], SEC_AX[1], 0] : BASE_AX;
  const threeD = !!def.threeD && def.type !== 'surface';
  const seriesDepth = threeD && !!def.threeD?.seriesDepth && !def.stacked;
  const ids = threeD && seriesDepth ? `<c:axId val="${a}"/><c:axId val="${b}"/><c:axId val="${c}"/>` : threeD ? `<c:axId val="${a}"/><c:axId val="${b}"/><c:axId val="0"/>` : `<c:axId val="${a}"/><c:axId val="${b}"/>`;
  const grouping = def.stacked ? (def.percent ? 'percentStacked' : 'stacked') : 'standard';
  switch (g.kind) {
    case 'bar': {
      const dir = g.horizontal ? 'bar' : 'col';
      const grp = def.stacked ? (def.percent ? 'percentStacked' : 'stacked') : seriesDepth ? 'standard' : 'clustered';
      const vary = def.varyColors ? 1 : 0;
      const gap = Math.max(0, Math.min(500, Math.round(def.gapWidth ?? 150)));
      const overlap = def.overlap !== undefined ? Math.max(-100, Math.min(100, Math.round(def.overlap))) : def.stacked ? 100 : undefined;
      if (threeD) return `<c:bar3DChart><c:barDir val="${dir}"/><c:grouping val="${grp}"/><c:varyColors val="${vary}"/>${sers}<c:gapWidth val="${gap}"/><c:shape val="box"/>${ids}</c:bar3DChart>`;
      return `<c:barChart><c:barDir val="${dir}"/><c:grouping val="${grp}"/><c:varyColors val="${vary}"/>${sers}<c:gapWidth val="${gap}"/>${overlap !== undefined ? `<c:overlap val="${overlap}"/>` : ''}${ids}</c:barChart>`;
    }
    case 'line':
      if (threeD) return `<c:line3DChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}${ids}</c:line3DChart>`;
      return `<c:lineChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${ids}</c:lineChart>`;
    case 'area':
      if (threeD) return `<c:area3DChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}${ids}</c:area3DChart>`;
      return `<c:areaChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${sers}${ids}</c:areaChart>`;
    case 'pie':
      return threeD ? `<c:pie3DChart><c:varyColors val="1"/>${sers}</c:pie3DChart>` : `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="${Math.round(def.firstSliceAng ?? 0) % 360}"/></c:pieChart>`;
    case 'doughnut':
      return `<c:doughnutChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="${Math.round(def.firstSliceAng ?? 0) % 360}"/><c:holeSize val="${Math.max(10, Math.min(90, Math.round(def.holeSize ?? 50)))}"/></c:doughnutChart>`;
    case 'scatter':
      return `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers}<c:axId val="${a}"/><c:axId val="${b}"/></c:scatterChart>`;
    case 'radar':
      return `<c:radarChart><c:radarStyle val="${def.radar?.filled ? 'filled' : def.radar?.markers ? 'marker' : 'standard'}"/><c:varyColors val="0"/>${sers}<c:axId val="${a}"/><c:axId val="${b}"/></c:radarChart>`;
    case 'stock': {
      const ohlc = def.stock?.kind === 'ohlc' || def.stock?.kind === 'vohlc';
      return `<c:stockChart>${sers}<c:hiLowLines/>${ohlc ? '<c:upDownBars><c:gapWidth val="150"/><c:upBars/><c:downBars/></c:upDownBars>' : ''}<c:axId val="${a}"/><c:axId val="${b}"/></c:stockChart>`;
    }
    case 'surface': {
      const contour = !!def.surface?.contour;
      const wire = def.surface?.wireframe ? 1 : 0;
      const tag = contour ? 'surfaceChart' : 'surface3DChart';
      return `<c:${tag}><c:wireframe val="${wire}"/>${sers}<c:axId val="${a}"/><c:axId val="${b}"/><c:axId val="${c}"/></c:${tag}>`;
    }
  }
}

/** `workbookRid`: la relación del libro incrustado (Word y PowerPoint), para que Office deje editar los datos. */
export function chartXml(def: ChartSpec, src: ChartSource, workbookRid?: string): string {
  activeFonts = def.fonts;
  const groups = groupsOf(def);
  const plotGroups = groups.map((g) => groupXml(g, def, src)).join('');
  const hasSecondary = groups.some((g) => g.secondary);
  const horizontal = def.type === 'bar';
  const kinds = new Set(groups.map((g) => g.kind));
  const noAxes = [...kinds].every((k) => k === 'pie' || k === 'doughnut');
  const scatterOnly = [...kinds].every((k) => k === 'scatter');
  const surface = def.type === 'surface';
  const threeD = !!def.threeD || surface;

  let axes = '';
  if (!noAxes) {
    if (scatterOnly) {
      axes += valAxXml(111, 222, { pos: 'b', axis: def.axisX, between: 'midCat', grid: false });
      axes += valAxXml(222, 111, { pos: 'l', axis: def.axisY, between: 'midCat', grid: true, rotate: true });
      if (hasSecondary) {
        axes += valAxXml(333, 444, { pos: 'b', deleted: true, between: 'midCat' });
        axes += valAxXml(444, 333, { pos: 'r', axis: def.axisY2, crosses: 'max', between: 'midCat', rotate: true });
      }
    } else {
      const radar = kinds.has('radar');
      axes += catAxXml(111, 222, { pos: horizontal ? 'l' : 'b', axis: def.axisX, reverse: horizontal });
      axes += valAxXml(222, 111, { pos: horizontal ? 'b' : 'l', axis: def.axisY, grid: def.axisY?.gridlines ?? true, crosses: horizontal ? 'max' : 'autoZero', between: radar ? 'between' : 'between', rotate: !horizontal });
      if (hasSecondary) {
        axes += catAxXml(333, 444, { pos: horizontal ? 'l' : 'b', deleted: true });
        axes += valAxXml(444, 333, { pos: horizontal ? 't' : 'r', axis: def.axisY2, crosses: 'max', rotate: !horizontal });
      }
      if (surface || (def.threeD?.seriesDepth && !def.stacked)) axes += serAxXml(555, 222);
    }
  }

  const title = def.title ? `${titleXml(def.title, mergeFont(def.fonts?.chart, def.fonts?.title))}<c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const v = def.threeD ?? (surface ? { ...DEFAULT_3D, rightAngle: false } : undefined);
  const contour = surface && def.surface?.contour;
  const view3D = threeD && v
    ? `<c:view3D><c:rotX val="${contour ? 90 : Math.round(v.rotX)}"/><c:rotY val="${contour ? 0 : Math.round(v.rotY)}"/><c:depthPercent val="${Math.round(v.depth)}"/><c:rAngAx val="${v.rightAngle && !contour ? 1 : 0}"/>${v.rightAngle ? '' : `<c:perspective val="${Math.round(v.perspective * 2)}"/>`}</c:view3D>`
    : '';
  const legend = def.legend ? `<c:legend><c:legendPos val="${def.legendPos ?? 'b'}"/><c:overlay val="0"/>${txPrXml(mergeFont(def.fonts?.chart, def.fonts?.legend))}</c:legend>` : '';
  return (
    HEAD +
    `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:roundedCorners val="0"/>` +
    `<c:chart>${title}${view3D}<c:plotArea><c:layout/>${plotGroups}${axes}${dataTableXml(def, kinds)}${areaSpPr(def.plotArea)}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    areaSpPr(def.chartArea) +
    txPrXml(def.fonts?.chart) +
    (workbookRid ? `<c:externalData r:id="${workbookRid}"><c:autoUpdate val="0"/></c:externalData>` : '') +
    '</c:chartSpace>'
  );
}

// ------------------------------------------------------------------------------------------------ reading
function fText(n: XNode): string | undefined {
  const f = n?.numRef?.f ?? n?.strRef?.f ?? n?.multiLvlStrRef?.f;
  if (f === undefined) return undefined;
  return typeof f === 'string' ? f : (f['#text'] as string | undefined);
}

function richText(title: XNode): string | undefined {
  const paras = asArray(title?.tx?.rich?.p);
  const text = paras
    .flatMap((p: XNode) => asArray(p.r))
    .map((r: XNode) => textOf(r.t))
    .join('');
  return text || undefined;
}

const GROUP_TAGS: Record<string, { kind: GroupKind; threeD?: boolean }> = {
  barChart: { kind: 'bar' },
  bar3DChart: { kind: 'bar', threeD: true },
  lineChart: { kind: 'line' },
  line3DChart: { kind: 'line', threeD: true },
  areaChart: { kind: 'area' },
  area3DChart: { kind: 'area', threeD: true },
  pieChart: { kind: 'pie' },
  pie3DChart: { kind: 'pie', threeD: true },
  doughnutChart: { kind: 'doughnut' },
  scatterChart: { kind: 'scatter' },
  radarChart: { kind: 'radar' },
  stockChart: { kind: 'stock' },
  surfaceChart: { kind: 'surface' },
  surface3DChart: { kind: 'surface', threeD: true },
};

const SCHEME_INDEX: Record<string, number> = { lt1: 0, bg1: 0, dk1: 1, tx1: 1, lt2: 2, bg2: 2, dk2: 3, tx2: 3, accent1: 4, accent2: 5, accent3: 6, accent4: 7, accent5: 8, accent6: 9, hlink: 10, folHlink: 11 };

function fillColor(spPr: XNode, theme: string[]): string | undefined {
  const sf = spPr?.solidFill ?? spPr?.ln?.solidFill;
  if (!sf) return undefined;
  if (sf.srgbClr) {
    const v = attr(sf.srgbClr, 'val');
    return v ? `#${v.slice(-6).toLowerCase()}` : undefined;
  }
  if (sf.schemeClr) {
    const i = SCHEME_INDEX[attr(sf.schemeClr, 'val') ?? ''];
    const hex = i === undefined ? undefined : theme[i];
    return hex ? `#${hex.toLowerCase()}` : undefined;
  }
  return undefined;
}

function readAxis(ax: XNode): ChartAxis | undefined {
  if (!ax) return undefined;
  const out: ChartAxis = {};
  const t = richText(ax.title);
  if (t) out.title = t;
  const sc = ax.scaling;
  const min = attr(sc?.min, 'val');
  const max = attr(sc?.max, 'val');
  if (min !== undefined && !Number.isNaN(Number(min))) out.min = Number(min);
  if (max !== undefined && !Number.isNaN(Number(max))) out.max = Number(max);
  if (sc?.logBase !== undefined) out.log = true;
  const nf = asArray(ax.numFmt)[0];
  const fmt = attr(nf, 'formatCode');
  if (fmt && attr(nf, 'sourceLinked') !== '1' && fmt !== 'General') out.format = fmt;
  if (ax.majorGridlines !== undefined) out.gridlines = true;
  if (ax.minorGridlines !== undefined) out.minorGridlines = true;
  if (['1', 'true'].includes(attr(ax.delete, 'val') ?? '')) out.hidden = true;
  if (attr(sc?.orientation, 'val') === 'maxMin') out.reverse = true;
  return Object.keys(out).length ? out : undefined;
}

/** Interpret a chart part. Returns null (with a reason) when it cannot be represented. */
export function parseChart(doc: XNode, theme: string[] = DEFAULT_CHART_THEME): { def: ChartSpec } | { skip: string } {
  const chart = doc?.chartSpace?.chart;
  const plot = chart?.plotArea;
  if (!plot) return { skip: 'estructura de gráfico desconocida' };

  // axes by id
  const axes = new Map<string, { tag: string; node: XNode }>();
  for (const tag of ['catAx', 'valAx', 'dateAx', 'serAx']) for (const n of asArray(plot[tag])) axes.set(attr(n.axId, 'val') ?? '', { tag, node: n });

  interface Parsed {
    kind: GroupKind;
    node: XNode;
    threeD: boolean;
    ids: string[];
  }
  const groups: Parsed[] = [];
  for (const [tag, info] of Object.entries(GROUP_TAGS)) {
    for (const node of asArray(plot[tag])) {
      const kind = tag === 'surfaceChart' ? 'surface' : info.kind;
      groups.push({ kind, node, threeD: !!info.threeD, ids: asArray(node.axId).map((a: XNode) => attr(a, 'val') ?? '') });
    }
  }
  if (!groups.length) return { skip: 'tipo de gráfico no compatible' };
  // keep the order of the file (Excel draws areas first, then columns, lines, points)
  const keys = Object.keys(plot);
  groups.sort((a, b) => {
    const ta = Object.keys(GROUP_TAGS).find((t) => plot[t] !== undefined && asArray(plot[t]).includes(a.node))!;
    const tb = Object.keys(GROUP_TAGS).find((t) => plot[t] !== undefined && asArray(plot[t]).includes(b.node))!;
    return keys.indexOf(ta) - keys.indexOf(tb);
  });

  const primaryIds = new Set(groups.find((g) => g.kind !== 'pie' && g.kind !== 'doughnut')?.ids.slice(0, 2) ?? []);
  const isSecondary = (g: Parsed) => g.ids.length >= 2 && !primaryIds.has(g.ids[0]!) && primaryIds.size > 0 && g.kind !== 'pie' && g.kind !== 'doughnut';

  const series: ChartSeries[] = [];
  let anyHorizontal = false;
  const kindsSeen = new Set<string>();
  const groupType = (g: Parsed): SeriesType | undefined => {
    if (g.kind === 'bar') return 'column';
    if (g.kind === 'line') return 'line';
    if (g.kind === 'area') return 'area';
    if (g.kind === 'scatter') return 'scatter';
    return undefined;
  };
  for (const g of groups) {
    kindsSeen.add(g.kind);
    if (g.kind === 'bar' && attr(g.node.barDir, 'val') === 'bar') anyHorizontal = true;
    for (const s of asArray(g.node.ser)) {
      const values = fText(g.kind === 'scatter' ? s.yVal : s.val);
      if (!values) continue;
      const ser: ChartSeries = { values: values.replace(/^=/, '') };
      const nameRef = s.tx?.strRef?.f;
      if (nameRef) ser.nameRef = typeof nameRef === 'string' ? nameRef : nameRef['#text'];
      else if (typeof s.tx?.v === 'string') ser.name = s.tx.v;
      const cats = fText(g.kind === 'scatter' ? s.xVal : s.cat);
      if (cats) ser.categories = cats.replace(/^=/, '');
      const lineKind = g.kind === 'line' || g.kind === 'scatter' || (g.kind === 'radar' && !!s.spPr?.ln && s.spPr.solidFill === undefined);
      const color = lineKind ? (readColorNode(s.spPr?.ln?.solidFill, theme)?.color ?? readColorNode(s.marker?.spPr?.solidFill, theme)?.color) : fillColor({ solidFill: s.spPr?.solidFill }, theme);
      if (color && g.kind !== 'stock') ser.color = color;
      if (g.kind !== 'stock' && g.kind !== 'surface') {
        const stroke = readStroke(s.spPr?.ln, theme);
        if (lineKind) {
          // en líneas, el color de la línea es el de la serie; el resto (grosor, guiones, sin línea) es formato aparte
          if (stroke && (stroke.width !== undefined || stroke.dash || (stroke.none && g.kind !== 'scatter'))) ser.line = { ...(stroke.width !== undefined ? { width: stroke.width } : {}), ...(stroke.dash ? { dash: stroke.dash } : {}), ...(stroke.none ? { none: true } : {}) };
          else if (stroke?.width !== undefined && g.kind === 'scatter') ser.line = { width: stroke.width };
          const mk = readMarker(s.marker, theme);
          if (mk) ser.marker = mk;
        } else if (stroke) ser.line = stroke;
        const fillNode = s.spPr?.solidFill;
        const fc = readColorNode(fillNode, theme);
        if (fc?.transparency && !lineKind) ser.transparency = fc.transparency;
        if (s.spPr?.noFill !== undefined && !lineKind) ser.noFill = true;
        const pts = readPoints(s, theme);
        if (pts.length) ser.points = pts;
        const ex = Number(attr(s.explosion, 'val'));
        if (s.explosion !== undefined && Number.isFinite(ex) && ex > 0) ser.explosion = ex;
      }
      const lbl = g.kind === 'stock' || g.kind === 'surface' ? undefined : readLabels(s);
      if (lbl) ser.labels = lbl;
      if (isSecondary(g)) ser.secondary = true;
      const t = groupType(g);
      if (t) ser.type = t;
      if (g.kind === 'bar' || g.kind === 'line' || g.kind === 'area' || g.kind === 'scatter') {
        const tls = parseTrendlines(s);
        if (tls.length) ser.trendlines = tls;
        const eb = parseErrBars(s, g.kind === 'scatter');
        if (eb.errY) ser.errY = eb.errY;
        if (eb.errX) ser.errX = eb.errX;
      }
      series.push(ser);
    }
  }
  if (!series.length) return { skip: 'los datos del gráfico no son referencias a cálculo (celdas)' };

  const first = groups[0]!;
  let type: ChartType;
  switch (first.kind) {
    case 'bar':
      type = anyHorizontal ? 'bar' : 'column';
      break;
    case 'stock':
      type = 'stock';
      break;
    default:
      type = first.kind;
  }
  // a volume + stock chart is one chart for the user
  const hasBar = groups.some((g) => g.kind === 'bar');
  const hasStock = groups.some((g) => g.kind === 'stock');
  if (hasStock) type = 'stock';
  if (type !== 'stock' && kindsSeen.size > 1 && (kindsSeen.has('pie') || kindsSeen.has('doughnut') || kindsSeen.has('radar') || kindsSeen.has('surface'))) {
    return { skip: 'combinación de tipos de gráfico no compatible' };
  }
  if (anyHorizontal && kindsSeen.size > 1) return { skip: 'las barras horizontales no se pueden combinar con otros tipos' };

  const def: Omit<ChartSpec, 'id' | 'x' | 'y' | 'width' | 'height'> = { type, legend: chart.legend !== undefined, series };
  const t = richText(chart.title);
  if (t) def.title = t;
  const fonts: ChartFonts = {};
  const fChart = readFont(doc.chartSpace?.txPr, theme);
  if (fChart) fonts.chart = fChart;
  const fTitle = readTitleFont(chart.title, theme);
  if (fTitle && t) fonts.title = fTitle;
  const fLegend = readFont(chart.legend?.txPr, theme);
  if (fLegend) fonts.legend = fLegend;
  const catAxNode = axes.get(groups[0]!.ids[0] ?? '')?.node;
  const valAxNode = axes.get(groups[0]!.ids[1] ?? '')?.node;
  const fAxis = readFont(valAxNode?.txPr, theme) ?? readFont(catAxNode?.txPr, theme);
  if (fAxis) fonts.axis = fAxis;
  const fAxisTitle = readTitleFont(valAxNode?.title, theme) ?? readTitleFont(catAxNode?.title, theme);
  if (fAxisTitle) fonts.axisTitle = fAxisTitle;
  const withLabels = groups.flatMap((g) => asArray(g.node.ser)).find((s: XNode) => s.dLbls?.txPr);
  const fLabels = readFont(withLabels?.dLbls?.txPr, theme);
  if (fLabels) fonts.labels = fLabels;
  if (Object.keys(fonts).length) def.fonts = fonts;
  const ca = readArea(doc.chartSpace?.spPr, theme);
  if (ca) def.chartArea = ca;
  const pa = readArea(plot.spPr, theme);
  if (pa) def.plotArea = pa;
  const lp = attr(chart.legend?.legendPos, 'val');
  if (def.legend && lp && lp !== 'b' && ['t', 'l', 'r', 'tr'].includes(lp)) def.legendPos = lp as LegendPos;
  if (plot.dTable !== undefined) def.dataTable = ['1', 'true'].includes(attr(plot.dTable.showKeys, 'val') ?? '') ? { keys: true } : {};
  const grouping = attr(first.node.grouping, 'val');
  if (grouping === 'stacked' || grouping === 'percentStacked') {
    def.stacked = true;
    if (grouping === 'percentStacked') def.percent = true;
  }
  const bars = groups.find((g) => g.kind === 'bar');
  if (bars) {
    const gw = Number(attr(bars.node.gapWidth, 'val'));
    if (bars.node.gapWidth !== undefined && Number.isFinite(gw) && gw !== 150) def.gapWidth = gw;
    const ov = Number(attr(bars.node.overlap, 'val'));
    if (bars.node.overlap !== undefined && Number.isFinite(ov) && !(def.stacked && ov === 100) && ov !== 0) def.overlap = ov;
    if (['1', 'true'].includes(attr(bars.node.varyColors, 'val') ?? '')) def.varyColors = true;
  }
  const round = groups.find((g) => g.kind === 'pie' || g.kind === 'doughnut');
  if (round) {
    const ang = Number(attr(round.node.firstSliceAng, 'val'));
    if (round.node.firstSliceAng !== undefined && Number.isFinite(ang) && ang !== 0) def.firstSliceAng = ang;
    const hole = Number(attr(round.node.holeSize, 'val'));
    if (round.node.holeSize !== undefined && Number.isFinite(hole) && hole !== 50) def.holeSize = hole;
  }
  if (type === 'line' && groups.some((g) => g.kind === 'line' && asArray(g.node.ser).some((s: XNode) => attr(s.smooth, 'val') === '1'))) def.smooth = true;
  // single-type charts do not need a type on each series
  if (kindsSeen.size === 1 && !hasStock) for (const s of series) delete s.type;
  else if (type === 'column' || type === 'line' || type === 'area' || type === 'scatter') {
    for (const s of series) if (s.type === type && !series.some((o) => o.type !== type)) delete s.type;
  }
  if (type === 'stock') {
    const n = series.length;
    const kind: StockKind | null = hasBar ? (n === 4 ? 'vhlc' : n === 5 ? 'vohlc' : null) : n === 3 ? 'hlc' : n === 4 ? 'ohlc' : null;
    if (!kind) return { skip: 'gráfico de cotizaciones con un número de series no compatible' };
    def.stock = { kind };
    for (const s of series) {
      delete s.type;
      delete s.secondary;
    }
    def.legend = chart.legend !== undefined;
    void STOCK_SERIES;
  }
  if (type === 'radar') {
    const style = attr(first.node.radarStyle, 'val');
    def.radar = { filled: style === 'filled' || undefined, markers: style === 'marker' || undefined };
  }
  if (type === 'surface') {
    const wire = attr(first.node.wireframe, 'val');
    def.surface = { wireframe: wire === '1' || wire === 'true' || undefined, contour: first.node === asArray(plot.surfaceChart)[0] || undefined };
  }
  const view = chart.view3D;
  if (view && (first.threeD || type === 'surface')) {
    const n = (k: string, d: number) => {
      const v = attr(view[k], 'val');
      return v === undefined || Number.isNaN(Number(v)) ? d : Number(v);
    };
    const d3: Chart3D = {
      rotX: n('rotX', DEFAULT_3D.rotX),
      rotY: n('rotY', DEFAULT_3D.rotY),
      perspective: Math.round(n('perspective', 60) / 2),
      depth: n('depthPercent', 100),
      rightAngle: attr(view.rAngAx, 'val') === '1' || attr(view.rAngAx, 'val') === 'true',
    };
    if (first.threeD && first.kind !== 'pie' && grouping === 'standard') d3.seriesDepth = true;
    def.threeD = d3;
  } else if (first.threeD) def.threeD = { ...DEFAULT_3D };

  // axes: X from the category (or first value) axis of the first group, Y from the value axis, Y2 from the secondary group's
  const firstIds = first.ids;
  const xAx = axes.get(firstIds[0] ?? '');
  const yAx = axes.get(firstIds[1] ?? '');
  const ax = readAxis(first.kind === 'scatter' ? xAx?.node : xAx?.node);
  if (ax) def.axisX = ax;
  const ay = readAxis(yAx?.node);
  if (ay) def.axisY = ay;
  const sec = groups.find((g) => isSecondary(g));
  if (sec) {
    const y2 = readAxis(axes.get(sec.ids[1] ?? '')?.node);
    if (y2) def.axisY2 = y2;
  }
  return { def };
}

