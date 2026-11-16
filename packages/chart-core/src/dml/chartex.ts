/**
 * Gráficos de Excel 2016 («chartex», espacio de nombres `cx`): cascada, embudo, histograma y cajas y bigotes.
 * Se escriben según el esquema de Office, pero no se han abierto en Excel; los que crea Excel se leen con lo que Nova Calc entiende.
 */
import type { ChartSeries, ChartSpec, ChartType } from '../model';
import type { ChartCell, ChartSource } from '../source';
import { asArray, attr, escapeXml, textOf, type XNode } from './xml';

export const NS_CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
export const REL_CHARTEX = 'http://schemas.microsoft.com/office/2014/relationships/chartEx';
export const CT_CHARTEX = 'application/vnd.ms-office.chartex+xml';

export const EX_TYPES: ChartType[] = ['waterfall', 'funnel', 'histogram', 'boxwhisker'];
export const isExType = (t: ChartType): boolean => EX_TYPES.includes(t);

const LAYOUT: Record<string, string> = { waterfall: 'waterfall', funnel: 'funnel', histogram: 'clusteredColumn', boxwhisker: 'boxWhisker' };

const guid = (i: number): string => `{${(0xc0de0000 + i).toString(16).toUpperCase().padStart(8, '0')}-0000-4000-8000-${(i + 1).toString(16).toUpperCase().padStart(12, '0')}}`;

function strLevel(values: unknown[]): string {
  const pts = values.map((v, i) => `<cx:pt idx="${i}">${escapeXml(v === null || v === undefined ? '' : String(v))}</cx:pt>`).join('');
  return `<cx:lvl ptCount="${values.length}">${pts}</cx:lvl>`;
}
function numLevel(values: unknown[]): string {
  const pts = values.map((v, i) => (typeof v === 'number' ? `<cx:pt idx="${i}">${v}</cx:pt>` : '')).join('');
  return `<cx:lvl ptCount="${values.length}" formatCode="General">${pts}</cx:lvl>`;
}

export function chartExXml(def: ChartSpec, src: ChartSource, workbookRid?: string): string {
  const layoutId = LAYOUT[def.type] ?? 'waterfall';
  const dataBlocks: string[] = [];
  const seriesXml: string[] = [];
  def.series.forEach((s, i) => {
    const vals = src.range(s.values).values;
    const cats = s.categories ? src.range(s.categories).values : [];
    const name = s.nameRef ? String(src.range(s.nameRef).values[0] ?? '') : (s.name ?? '');
    dataBlocks.push(
      `<cx:data id="${i}">` +
        (s.categories ? `<cx:strDim type="cat"><cx:f>${escapeXml(s.categories)}</cx:f>${strLevel(cats)}</cx:strDim>` : '') +
        `<cx:numDim type="val"><cx:f>${escapeXml(s.values)}</cx:f>${numLevel(vals)}</cx:numDim></cx:data>`,
    );
    let layoutPr = '';
    if (def.type === 'waterfall') {
      const totals = def.waterfall?.totals ?? [];
      layoutPr = totals.length ? `<cx:layoutPr><cx:subtotals>${totals.map((t) => `<cx:idx val="${t}"/>`).join('')}</cx:subtotals></cx:layoutPr>` : '';
    } else if (def.type === 'histogram') {
      const h = def.histogram ?? {};
      const attrs = `intervalClosed="${h.closed === 'left' ? 'l' : 'r'}"${h.underflow !== undefined ? ` underflow="${h.underflow}"` : ''}${h.overflow !== undefined ? ` overflow="${h.overflow}"` : ''}`;
      const size = h.binWidth !== undefined ? `<cx:binSize val="${h.binWidth}"/>` : h.binCount !== undefined ? `<cx:binCount val="${h.binCount}"/>` : '';
      layoutPr = `<cx:layoutPr><cx:binning ${attrs}>${size}</cx:binning></cx:layoutPr>`;
    } else if (def.type === 'boxwhisker') {
      const b = def.boxwhisker ?? {};
      layoutPr =
        `<cx:layoutPr><cx:visibility meanLine="0" meanMarker="${b.mean === false ? 0 : 1}" nonoutliers="${b.inner ? 1 : 0}" outliers="${b.outliers === false ? 0 : 1}"/>` +
        `<cx:statistics quartileMethod="${b.inclusive ? 'inclusive' : 'exclusive'}"/></cx:layoutPr>`;
    }
    const tx = s.nameRef ? `<cx:tx><cx:txData><cx:f>${escapeXml(s.nameRef)}</cx:f><cx:v>${escapeXml(name)}</cx:v></cx:txData></cx:tx>` : name ? `<cx:tx><cx:txData><cx:v>${escapeXml(name)}</cx:v></cx:txData></cx:tx>` : '';
    seriesXml.push(`<cx:series layoutId="${layoutId}" uniqueId="${guid(i)}">${tx}<cx:dataId val="${i}"/>${layoutPr}</cx:series>`);
  });
  const title = def.title ? `<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>${escapeXml(def.title)}</cx:v></cx:txData></cx:tx></cx:title>` : '';
  const legend = def.legend ? '<cx:legend pos="t" align="ctr" overlay="0"/>' : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<cx:chartSpace xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:cx="${NS_CX}">` +
    `<cx:chartData>${workbookRid ? `<cx:externalData r:id="${workbookRid}" cx:autoUpdate="0"/>` : ''}${dataBlocks.join('')}</cx:chartData>` +
    `<cx:chart>${title}<cx:plotArea><cx:plotAreaRegion>${seriesXml.join('')}</cx:plotAreaRegion>` +
    '<cx:axis id="0"><cx:catScaling gapWidth="0.5"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>' +
    `</cx:plotArea>${legend}</cx:chart></cx:chartSpace>`
  );
}

// ------------------------------------------------------------------------------------------------ reading
const TYPE_BY_LAYOUT: Record<string, ChartType> = { waterfall: 'waterfall', funnel: 'funnel', clusteredColumn: 'histogram', boxWhisker: 'boxwhisker' };

/** El texto de una fórmula `cx:f` (puede traer atributos). */
const fText = (n: XNode): string | undefined => {
  const t = textOf(n).trim();
  return t ? t.replace(/^=/, '') : undefined;
};

/** Los puntos de un `cx:lvl` (los valores guardados dentro del propio gráfico). */
function lvlCells(dim: XNode | undefined, numeric: boolean): ChartCell[] {
  const lvl = asArray(dim?.lvl)[0];
  const pts = asArray(lvl?.pt);
  const out: ChartCell[] = Array.from({ length: Number(attr(lvl, 'ptCount') ?? pts.length) }, () => null);
  for (const pt of pts) {
    const i = Number(attr(pt, 'idx'));
    if (!Number.isInteger(i) || i < 0) continue;
    const t = textOf(pt);
    const n = Number(t);
    out[i] = numeric ? (t === '' || !Number.isFinite(n) ? null : n) : t;
  }
  return out;
}

const colLetter = (c: number): string => String.fromCharCode(65 + c);

/**
 * Interpreta un gráfico de Office 2016. PowerPoint y Word guardan a veces los datos solo dentro del gráfico, sin fórmulas: entonces
 * se les da referencias propias (categorías en la columna A, una serie por columna) y los valores salen en `literals`.
 */
export function parseChartEx(doc: XNode): { def: ChartSpec; literals?: Map<string, ChartCell[]> } | { skip: string } {
  const space = doc?.chartSpace;
  const chart = space?.chart;
  const region = chart?.plotArea?.plotAreaRegion;
  if (!region) return { skip: 'estructura de gráfico de Excel 2016 desconocida' };
  const dataById = new Map<string, XNode>();
  for (const d of asArray(space.chartData?.data)) dataById.set(attr(d, 'id') ?? '0', d);

  const series: ChartSeries[] = [];
  const literals = new Map<string, ChartCell[]>();
  let type: ChartType | undefined;
  let extra: Partial<ChartSpec> = {};
  for (const s of asArray(region.series)) {
    const layout = attr(s, 'layoutId') ?? '';
    const t = TYPE_BY_LAYOUT[layout];
    if (!t) return { skip: `tipo de gráfico de Excel 2016 no compatible (${layout || 'desconocido'})` };
    type ??= t;
    const data = dataById.get(attr(s.dataId, 'val') ?? '0');
    const num = asArray(data?.numDim).find((d: XNode) => attr(d, 'type') === 'val');
    let values = fText(num?.f);
    const cat = asArray(data?.strDim).find((d: XNode) => attr(d, 'type') === 'cat') ?? asArray(data?.numDim).find((d: XNode) => attr(d, 'type') === 'cat');
    let cats = fText(cat?.f);
    let nameRef = fText(s.tx?.txData?.f);
    if (!values) {
      // sin fórmulas: los datos son los del propio gráfico
      if (!num?.lvl) return { skip: 'los datos del gráfico no son referencias a celdas' };
      const vals = lvlCells(num, true);
      const col = colLetter(series.length + 1);
      values = `Sheet1!$${col}$2:$${col}$${vals.length + 1}`;
      literals.set(values, vals);
      if (cat?.lvl) {
        const labels = lvlCells(cat, false);
        cats = `Sheet1!$A$2:$A$${labels.length + 1}`;
        literals.set(cats, labels);
      }
      nameRef = `Sheet1!$${col}$1`;
      literals.set(nameRef, [s.tx?.txData?.v !== undefined ? textOf(s.tx.txData.v) : `Serie ${series.length + 1}`]);
    }
    const ser: ChartSeries = { values };
    if (cats) ser.categories = cats;
    if (nameRef) ser.nameRef = nameRef;
    else if (s.tx?.txData?.v !== undefined) ser.name = textOf(s.tx.txData.v);
    series.push(ser);

    const lp = s.layoutPr;
    if (t === 'waterfall') {
      const totals = asArray(lp?.subtotals?.idx).map((i: XNode) => Number(attr(i, 'val'))).filter((n: number) => Number.isFinite(n));
      extra = { waterfall: { ...(totals.length ? { totals } : {}), connectors: true } };
    } else if (t === 'histogram') {
      const b = lp?.binning;
      const h: NonNullable<ChartSpec['histogram']> = {};
      if (b) {
        const size = Number(attr(b.binSize, 'val'));
        const count = Number(attr(b.binCount, 'val'));
        if (b.binSize !== undefined && size > 0) h.binWidth = size;
        else if (b.binCount !== undefined && count >= 1) h.binCount = Math.trunc(count);
        if (attr(b, 'intervalClosed') === 'l') h.closed = 'left';
        const under = attr(b, 'underflow');
        const over = attr(b, 'overflow');
        if (under !== undefined && Number.isFinite(Number(under))) h.underflow = Number(under);
        if (over !== undefined && Number.isFinite(Number(over))) h.overflow = Number(over);
      }
      extra = { histogram: h };
    } else if (t === 'boxwhisker') {
      const v = lp?.visibility;
      extra = {
        boxwhisker: {
          ...(attr(lp?.statistics, 'quartileMethod') === 'inclusive' ? { inclusive: true } : {}),
          ...(attr(v, 'meanMarker') === '0' ? { mean: false } : {}),
          ...(attr(v, 'outliers') === '0' ? { outliers: false } : {}),
          ...(attr(v, 'nonoutliers') === '1' ? { inner: true } : {}),
        },
      };
    }
  }
  if (!series.length || !type) return { skip: 'gráfico de Excel 2016 sin series' };
  const def: Omit<ChartSpec, 'id' | 'x' | 'y' | 'width' | 'height'> = { type, legend: chart.legend !== undefined, series, ...extra };
  const title = chart.title?.tx?.txData?.v;
  if (title !== undefined) def.title = textOf(title);
  return literals.size ? { def, literals } : { def };
}

// ------------------------------------------------------------------------------------------------ estilo y colores
/*
 * Excel no abre un gráfico de Office 2016 si no lleva sus partes de estilo y de colores (comprobado con Excel real: sin ellas el libro
 * ni se abre). Basta con las mínimas: todas las entradas del estilo con referencias neutras y los seis acentos del tema.
 */
export const REL_CHARTEX_STYLE = 'http://schemas.microsoft.com/office/2011/relationships/chartStyle';
export const REL_CHARTEX_COLORS = 'http://schemas.microsoft.com/office/2011/relationships/chartColorStyle';
export const CT_CHARTEX_STYLE = 'application/vnd.ms-office.chartstyle+xml';
export const CT_CHARTEX_COLORS = 'application/vnd.ms-office.chartcolorstyle+xml';

const CS = 'http://schemas.microsoft.com/office/drawing/2012/chartStyle';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const STYLE_ENTRIES = ['axisTitle', 'categoryAxis', 'chartArea', 'dataLabel', 'dataLabelCallout', 'dataPoint', 'dataPoint3D', 'dataPointLine', 'dataPointMarker', 'dataPointMarkerLayout', 'dataPointWireframe', 'dataTable', 'downBar', 'dropLine', 'errorBar', 'floor', 'gridlineMajor', 'gridlineMinor', 'hiLoLine', 'leaderLine', 'legend', 'plotArea', 'plotArea3D', 'seriesAxis', 'seriesLine', 'title', 'trendline', 'trendlineLabel', 'upBar', 'valueAxis', 'wall'];

/** La parte `chartStyle` mínima de un gráfico de Office 2016. */
export function chartExStyleXml(): string {
  const body = STYLE_ENTRIES.map((n) => {
    if (n === 'dataPointMarkerLayout') return '<cs:dataPointMarkerLayout symbol="circle" size="5"/>';
    // los puntos de datos se rellenan con el color de la serie (sin esto, las columnas de una cascada salen sin relleno)
    if (n === 'dataPoint' || n === 'dataPoint3D') return `<cs:${n}><cs:lnRef idx="0"/><cs:fillRef idx="0"><cs:styleClr val="auto"/></cs:fillRef><cs:effectRef idx="0"/><cs:fontRef idx="minor"><a:schemeClr val="tx1"/></cs:fontRef><cs:spPr><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></cs:spPr></cs:${n}>`;
    const f = n === 'chartArea' || n === 'plotArea' || n === 'plotArea3D' ? ' format="ignore"' : '';
    return `<cs:${n}${f}><cs:lnRef idx="0"/><cs:fillRef idx="0"/><cs:effectRef idx="0"/><cs:fontRef idx="minor"/></cs:${n}>`;
  }).join('');
  return `${HEAD}<cs:chartStyle xmlns:cs="${CS}" xmlns:a="${A}" id="395">${body}</cs:chartStyle>`;
}

/** La parte `colorStyle` mínima: los seis acentos del tema en ciclo. */
export function chartExColorsXml(): string {
  const acc = [1, 2, 3, 4, 5, 6].map((i) => `<a:schemeClr val="accent${i}"/>`).join('');
  return `${HEAD}<cs:colorStyle xmlns:cs="${CS}" xmlns:a="${A}" meth="cycle" id="10">${acc}</cs:colorStyle>`;
}
