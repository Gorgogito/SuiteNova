import { XMLParser } from 'fast-xml-parser';
import { formatChartNumber } from './format';
import { GRID_SHEET, parseRef, refOf, type ChartGrid } from './grid';
import type { ChartSpec, ChartType, DataLabels, LegendPos, MarkerSymbol, PointFormat } from './model';
import type { ChartCell } from './source';

/*
 * Gráficos de OpenDocument (`.odp`, `.odt`): cada gráfico es un «objeto» del documento, un mini-documento `Object N/content.xml` con
 * `office:chart`, su tabla local de datos y los estilos de cada serie. Se guardan los tipos que OpenDocument tiene (columnas, barras,
 * líneas, áreas, circular, anillo, dispersión y radar) con su título, leyenda, títulos de ejes, cuadrícula, etiquetas, colores, bordes,
 * marcadores, huecos y color de los puntos; el resto (cascada, 3D, cotizaciones…) se guarda como imagen.
 */

export const ODF_CHART_MIME = 'application/vnd.oasis.opendocument.chart';

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"';
const TABLE = 'local-table';
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cm = (px: number): string => `${Math.round((px / 96) * 2.54 * 1000) / 1000}cm`;
const pt = (n: number): string => `${n}pt`;
const colName = (c: number): string => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const CLASS: Partial<Record<ChartType, string>> = { column: 'chart:bar', bar: 'chart:bar', line: 'chart:line', area: 'chart:area', pie: 'chart:circle', doughnut: 'chart:ring', scatter: 'chart:scatter', radar: 'chart:radar' };
const SYMBOL_OUT: Record<MarkerSymbol, string> = { circle: 'circle', square: 'square', diamond: 'diamond', triangle: 'arrow-up', x: 'x', star: 'star', plus: 'plus', dash: 'horizontal-bar', dot: 'circle', none: '' };
const SYMBOL_IN: Record<string, MarkerSymbol> = { circle: 'circle', square: 'square', diamond: 'diamond', 'arrow-up': 'triangle', x: 'x', star: 'star', plus: 'plus', 'horizontal-bar': 'dash' };
const LEGEND_OUT: Record<LegendPos, string> = { b: 'bottom', t: 'top', l: 'start', r: 'end', tr: 'end' };
const LEGEND_IN: Record<string, LegendPos> = { bottom: 'b', top: 't', start: 'l', end: 'r' };

/** ¿Se puede guardar este gráfico como gráfico de OpenDocument? (si no, se guarda como imagen) */
export const odfSupports = (spec: ChartSpec): boolean => !!CLASS[spec.type] && !spec.threeD && !spec.series.some((s) => s.type || s.secondary || s.trendlines?.length || s.errX || s.errY);

// ------------------------------------------------------------------------------------------------ escritura

class Styles {
  private out: string[] = [];
  add(family: 'chart', body: string): string {
    const name = `ch${this.out.length + 1}`;
    this.out.push(`<style:style style:name="${name}" style:family="${family}">${body}</style:style>`);
    return name;
  }
  get xml(): string {
    return this.out.join('');
  }
}

const fill = (color: string | undefined, o: { noFill?: boolean; transparency?: number } = {}): string => (o.noFill ? ' draw:fill="none"' : color ? ` draw:fill="solid" draw:fill-color="${color}"${o.transparency ? ` draw:opacity="${100 - o.transparency}%"` : ''}` : '');
function stroke(l: { color?: string; width?: number; none?: boolean } | undefined, fallback?: string): string {
  if (!l) return '';
  if (l.none) return ' draw:stroke="none"';
  return ` draw:stroke="solid"${l.width !== undefined ? ` svg:stroke-width="${pt(l.width)}"` : ''}${(l.color ?? fallback) ? ` svg:stroke-color="${l.color ?? fallback}"` : ''}`;
}
function text(f: { family?: string; size?: number; bold?: boolean; italic?: boolean; color?: string } | undefined): string {
  if (!f) return '';
  const a = (f.family ? ` fo:font-family="${esc(f.family)}"` : '') + (f.size !== undefined ? ` fo:font-size="${pt(f.size)}"` : '') + (f.bold !== undefined ? ` fo:font-weight="${f.bold ? 'bold' : 'normal'}"` : '') + (f.italic !== undefined ? ` fo:font-style="${f.italic ? 'italic' : 'normal'}"` : '') + (f.color ? ` fo:color="${f.color}"` : '');
  return a ? `<style:text-properties${a}/>` : '';
}

const cellXml = (v: ChartCell | undefined): string => {
  if (v === null || v === undefined || v === '') return '<table:table-cell/>';
  if (typeof v === 'number') return `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${formatChartNumber(v)}</text:p></table:table-cell>`;
  return `<table:table-cell office:value-type="string"><text:p>${esc(String(v))}</text:p></table:table-cell>`;
};

function labelStyle(l: DataLabels | undefined): string {
  if (!l || !(l.value || l.category || l.series || l.percent)) return '';
  const num = l.value && l.percent ? 'value-and-percentage' : l.percent ? 'percentage' : l.value ? 'value' : 'none';
  return ` chart:data-label-number="${num}"${l.category ? ' chart:data-label-text="true"' : ''}${l.series ? ' chart:data-label-series="true"' : ''}`;
}

/**
 * El `content.xml` del objeto de gráfico de OpenDocument, o null si el gráfico no se puede guardar así (`odfSupports`).
 * `size` es el tamaño del marco en píxeles.
 */
export function odfChartXml(spec: ChartSpec, grid: ChartGrid, size: { w: number; h: number }): string | null {
  if (!odfSupports(spec)) return null;
  const cls = CLASS[spec.type]!;
  const rows = grid.length;
  const cols = Math.max(2, ...grid.map((r) => r.length));
  const styles = new Styles();
  const horizontal = spec.type === 'bar';
  const round = spec.type === 'pie' || spec.type === 'doughnut';
  const scatter = spec.type === 'scatter';

  // el gráfico (área del gráfico), el área de trazado y la pared
  const ca = spec.chartArea;
  const chartStyle = styles.add('chart', `<style:graphic-properties${ca?.line ? stroke(ca.line) : ' draw:stroke="none"'}${fill(ca?.fill ?? '#ffffff', { noFill: ca?.noFill, transparency: ca?.transparency })}/>${text(spec.fonts?.chart)}`);
  const plotProps =
    `<style:chart-properties chart:stacked="${spec.stacked && !spec.percent ? 'true' : 'false'}" chart:percentage="${spec.stacked && spec.percent ? 'true' : 'false'}" chart:vertical="${horizontal ? 'true' : 'false'}" chart:three-dimensional="false"` +
    `${spec.gapWidth !== undefined ? ` chart:gap-width="${Math.round(spec.gapWidth)}"` : ''}${spec.overlap !== undefined ? ` chart:overlap="${Math.round(spec.overlap)}"` : ''}` +
    `${spec.smooth ? ' chart:interpolation="cubic-spline"' : ''}${spec.firstSliceAng ? ` chart:angle-offset="${Math.round(spec.firstSliceAng)}"` : ''}${spec.varyColors ? ' chart:vary-colors="true"' : ''}/>`;
  const plotStyle = styles.add('chart', plotProps);
  const wallStyle = styles.add('chart', `<style:graphic-properties${stroke(spec.plotArea?.line)}${fill(spec.plotArea?.fill, { noFill: spec.plotArea?.noFill, transparency: spec.plotArea?.transparency })}/>`);

  const title = spec.title ? `<chart:title chart:style-name="${styles.add('chart', `${text({ bold: true, size: 13, ...spec.fonts?.title })}`)}"><text:p>${esc(spec.title)}</text:p></chart:title>` : '';
  const legend = spec.legend ? `<chart:legend chart:legend-position="${LEGEND_OUT[spec.legendPos ?? 'b']}" style:legend-expansion="high" chart:style-name="${styles.add('chart', text(spec.fonts?.legend))}"/>` : '';

  const axis = (dim: 'x' | 'y', ax: ChartSpec['axisX']): string => {
    if (round) return '';
    const st = styles.add('chart', `<style:chart-properties chart:display-label="${ax?.hidden ? 'false' : 'true'}"${ax?.log ? ' chart:logarithmic="true"' : ''}${ax?.reverse ? ' chart:reverse-direction="true"' : ''}/>${text(spec.fonts?.axis)}`);
    const t = ax?.title ? `<chart:title><text:p>${esc(ax.title)}</text:p></chart:title>` : '';
    const grids = `${ax?.gridlines ?? (dim === 'y' ? true : false) ? '<chart:grid chart:class="major"/>' : ''}${ax?.minorGridlines ? '<chart:grid chart:class="minor"/>' : ''}`;
    return `<chart:axis chart:dimension="${dim}" chart:name="primary-${dim}" chart:style-name="${st}"${ax?.hidden ? ' chart:visible="false"' : ''}>${t}${grids}</chart:axis>`;
  };

  const addr = (c1: number, r1: number, c2: number, r2: number): string => `${TABLE}.$${colName(c1)}$${r1 + 1}:.$${colName(c2)}$${r2 + 1}`;
  const series: string[] = [];
  const ser = spec.series;
  const refs = ser.map((s) => parseRef(s.values)?.rect);
  ser.forEach((s, i) => {
    const r = refs[i];
    if (!r) return;
    const nameRect = s.nameRef ? parseRef(s.nameRef)?.rect : undefined;
    let gp = '';
    const color = s.color;
    if (spec.type === 'line' || scatter || (spec.type === 'radar' && !spec.radar?.filled)) gp = `<style:graphic-properties${stroke({ width: 2, ...s.line, color: s.color ?? s.line?.color })}/>`;
    else gp = `<style:graphic-properties${stroke(s.line)}${fill(color, { noFill: s.noFill, transparency: s.transparency })}/>`;
    const marker = s.marker?.symbol
      ? s.marker.symbol === 'none'
        ? ' chart:symbol-type="none"'
        : ` chart:symbol-type="named-symbol" chart:symbol-name="${SYMBOL_OUT[s.marker.symbol]}"${s.marker.size ? ` chart:symbol-width="${pt(s.marker.size)}" chart:symbol-height="${pt(s.marker.size)}"` : ''}`
      : '';
    const sstyle = styles.add('chart', `<style:chart-properties${labelStyle(s.labels)}${marker}/>${gp}${text(spec.fonts?.labels)}`);
    const dom = scatter && s.categories ? `<chart:domain table:cell-range-address="${(() => { const d = parseRef(s.categories)!.rect; return addr(d.c1, d.r1, d.c2, d.r2); })()}"/>` : '';
    // el formato de cada punto: una entrada por posición hasta el último con formato
    const pts = s.points ?? [];
    const last = pts.reduce((m, p) => Math.max(m, p.idx), -1);
    const dp: string[] = [];
    const byIdx = new Map<number, PointFormat>(pts.map((p) => [p.idx, p]));
    let gap = 0;
    for (let k = 0; k <= last; k++) {
      const p = byIdx.get(k);
      if (!p || (!p.color && !p.explosion)) {
        gap++;
        continue;
      }
      if (gap) dp.push(`<chart:data-point chart:repeated="${gap}"/>`);
      gap = 0;
      dp.push(`<chart:data-point chart:style-name="${styles.add('chart', `<style:graphic-properties${fill(p.color)}${s.line ? stroke(s.line) : ''}/>${p.explosion ? `<style:chart-properties chart:pie-offset="${Math.round(p.explosion)}"/>` : ''}`)}"/>`);
    }
    series.push(
      `<chart:series chart:style-name="${sstyle}" chart:values-cell-range-address="${addr(r.c1, r.r1, r.c2, r.r2)}"${nameRect ? ` chart:label-cell-address="${TABLE}.$${colName(nameRect.c1)}$${nameRect.r1 + 1}"` : ''} chart:class="${cls}">${dom}${dp.join('')}</chart:series>`,
    );
  });

  const head = `<table:table-header-rows><table:table-row>${Array.from({ length: cols }, (_x, c) => cellXml(grid[0]?.[c])).join('')}</table:table-row></table:table-header-rows>`;
  const body = grid
    .slice(1)
    .map((row) => `<table:table-row>${Array.from({ length: cols }, (_x, c) => cellXml(row[c])).join('')}</table:table-row>`)
    .join('');
  const table = `<table:table table:name="${TABLE}"><table:table-header-columns><table:table-column/></table:table-header-columns><table:table-columns><table:table-column table:number-columns-repeated="${cols - 1}"/></table:table-columns>${head}<table:table-rows>${body}</table:table-rows></table:table>`;

  // los ejes registran sus estilos: se calculan antes de volcar la lista de estilos
  const axes = axis('x', spec.axisX) + axis('y', spec.axisY);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NS} office:version="1.2"><office:automatic-styles>${styles.xml}</office:automatic-styles>` +
    `<office:body><office:chart><chart:chart svg:width="${cm(size.w)}" svg:height="${cm(size.h)}" chart:class="${cls}" chart:style-name="${chartStyle}">${title}${legend}` +
    `<chart:plot-area chart:style-name="${plotStyle}" table:cell-range-address="${addr(0, 0, cols - 1, Math.max(0, rows - 1))}" chart:data-source-has-labels="both">${axes}${series.join('')}<chart:wall chart:style-name="${wallStyle}"/></chart:plot-area>` +
    `${table}</chart:chart></office:chart></office:body></office:document-content>`
  );
}

// ------------------------------------------------------------------------------------------------ lectura

type XNode = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', parseTagValue: false, parseAttributeValue: false, trimValues: true, removeNSPrefix: true, isArray: (n) => ['series', 'axis', 'grid', 'data-point', 'table-row', 'table-cell', 'style', 'table-column'].includes(n) });
const arr = <T = XNode>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const txt = (n: XNode): string => (n === undefined || n === null ? '' : typeof n === 'string' ? n : Array.isArray(n) ? n.map(txt).join('') : typeof n === 'object' ? (n['#text'] !== undefined ? String(n['#text']) : Object.values(n).filter((v) => typeof v === 'object').map(txt).join('')) : String(n));
const num = (v: string | undefined): number | undefined => (v === undefined || v === '' || !Number.isFinite(parseFloat(v)) ? undefined : parseFloat(v));
const lenPt = (v: string | undefined): number | undefined => {
  const m = v ? /^(-?[\d.]+)(pt|cm|mm|in|px)?$/.exec(v) : null;
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'cm' ? (n / 2.54) * 72 : m[2] === 'mm' ? (n / 25.4) * 72 : m[2] === 'in' ? n * 72 : m[2] === 'px' ? n * 0.75 : n;
};

/** «local-table.$B$2:.$B$5» (o «local-table.B2:local-table.B5») como referencia de la rejilla («Sheet1!$B$2:$B$5»). */
function gridRef(a: string | undefined): string | undefined {
  if (!a) return undefined;
  const m = /\$?([A-Z]+)\$?(\d+)(?::[^$A-Z]*\$?([A-Z]+)\$?(\d+))?/.exec(a.replace(/^[^.]*\./, ''));
  if (!m) return undefined;
  const col = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const r1 = Number(m[2]) - 1;
  const c1 = col(m[1]!);
  return refOf({ r1, c1, r2: m[4] ? Number(m[4]) - 1 : r1, c2: m[3] ? col(m[3]) : c1 }, GRID_SHEET);
}

/** El gráfico que describe el `content.xml` de un objeto de gráfico de OpenDocument, con su rejilla; o el motivo de no poder leerlo. */
export function parseOdfChart(xml: string): { spec: ChartSpec; grid: ChartGrid } | { skip: string } {
  const doc = parser.parse(xml);
  const root = doc?.['document-content'] ?? doc?.document;
  const chart = root?.body?.chart?.chart;
  if (!chart) return { skip: 'estructura de gráfico de OpenDocument desconocida' };
  const cls = String(chart['@_class'] ?? '').replace('chart:', '');
  const styleOf = new Map<string, XNode>();
  for (const s of arr(root['automatic-styles']?.style)) styleOf.set(s['@_name'], s);
  const props = (name: string | undefined) => {
    const s = name ? styleOf.get(name) : undefined;
    return { chart: (s?.['chart-properties'] ?? {}) as XNode, gfx: (s?.['graphic-properties'] ?? {}) as XNode, text: (s?.['text-properties'] ?? {}) as XNode };
  };
  const plot = chart['plot-area'];
  const pp = props(plot?.['@_style-name']);
  const horizontal = pp.chart['@_vertical'] === 'true';
  let type: ChartType | undefined;
  switch (cls) {
    case 'bar':
      type = horizontal ? 'bar' : 'column';
      break;
    case 'line':
    case 'area':
    case 'scatter':
    case 'radar':
      type = cls;
      break;
    case 'circle':
      type = 'pie';
      break;
    case 'ring':
      type = 'doughnut';
      break;
    case 'filled-radar':
      type = 'radar';
      break;
  }
  if (!type) return { skip: `tipo de gráfico de OpenDocument no compatible (${cls || 'desconocido'})` };

  // la tabla local: la primera fila es la cabecera y la primera columna, las categorías
  const table = chart.table;
  const grid: ChartGrid = [];
  const readRow = (row: XNode) => {
    const cells: ChartCell[] = [];
    for (const c of arr(row['table-cell'])) {
      const n = Number(c['@_number-columns-repeated'] ?? 1);
      const v = c['@_value-type'] === 'float' || c['@_value-type'] === 'percentage' ? num(c['@_value']) ?? null : c['@_value-type'] === 'string' ? txt(c.p) : null;
      for (let k = 0; k < Math.min(n, 200); k++) cells.push(v);
    }
    grid.push(cells);
  };
  const headRows = table?.['table-header-rows'];
  for (const r of arr(headRows?.['table-row'])) readRow(r);
  for (const r of arr(table?.['table-rows']?.['table-row'])) readRow(r);
  if (!grid.length) for (const r of arr(table?.['table-row'])) readRow(r);

  const rect = (a: string | undefined) => (a ? parseRef(gridRef(a) ?? '')?.rect : undefined);
  const series: ChartSpec['series'] = [];
  for (const s of arr(chart['plot-area']?.series)) {
    const values = gridRef(s['@_values-cell-range-address']);
    if (!values) continue;
    const sp = props(s['@_style-name']);
    const ser: ChartSpec['series'][number] = { values };
    const nameRef = gridRef(s['@_label-cell-address']);
    if (nameRef) ser.nameRef = nameRef;
    const dom = arr(s.domain)[0]?.['@_cell-range-address'];
    const dr = rect(dom);
    if (type === 'scatter' && dr) ser.categories = refOf(dr, GRID_SHEET);
    else if (grid.length > 1 && !(type === 'scatter')) {
      const vr = rect(s['@_values-cell-range-address']);
      if (vr) ser.categories = refOf({ r1: vr.r1, c1: 0, r2: vr.r2, c2: 0 }, GRID_SHEET);
    }
    const fillColor = sp.gfx['@_fill-color'] as string | undefined;
    const strokeColor = sp.gfx['@_stroke-color'] as string | undefined;
    const lined = type === 'line' || type === 'scatter' || (cls === 'radar');
    if (lined ? strokeColor : fillColor) ser.color = (lined ? strokeColor : fillColor)!.toLowerCase();
    if (!lined) {
      const op = num(String(sp.gfx['@_opacity'] ?? '').replace('%', ''));
      if (op !== undefined && op < 100) ser.transparency = 100 - op;
      if (sp.gfx['@_fill'] === 'none') ser.noFill = true;
      if (sp.gfx['@_stroke'] === 'solid') ser.line = { ...(strokeColor ? { color: strokeColor.toLowerCase() } : {}), ...(lenPt(sp.gfx['@_stroke-width']) !== undefined ? { width: Math.round(lenPt(sp.gfx['@_stroke-width'])! * 100) / 100 } : {}) };
    } else if (lenPt(sp.gfx['@_stroke-width']) !== undefined) ser.line = { width: Math.round(lenPt(sp.gfx['@_stroke-width'])! * 100) / 100 };
    const num_ = sp.chart['@_data-label-number'];
    if (num_ && num_ !== 'none') {
      ser.labels = { ...(num_ === 'value' || num_ === 'value-and-percentage' ? { value: true } : {}), ...(num_ === 'percentage' || num_ === 'value-and-percentage' ? { percent: true } : {}), ...(sp.chart['@_data-label-text'] === 'true' ? { category: true } : {}), ...(sp.chart['@_data-label-series'] === 'true' ? { series: true } : {}) };
    }
    if (sp.chart['@_symbol-type'] === 'none') ser.marker = { symbol: 'none' };
    else if (sp.chart['@_symbol-type'] === 'named-symbol') {
      const sym = SYMBOL_IN[sp.chart['@_symbol-name'] as string];
      const size = lenPt(sp.chart['@_symbol-width']);
      if (sym || size) ser.marker = { ...(sym ? { symbol: sym } : {}), ...(size ? { size: Math.round(size) } : {}) };
    }
    let at = 0;
    const points: PointFormat[] = [];
    for (const d of arr(s['data-point'])) {
      const rep = Number(d['@_repeated'] ?? 1);
      const pg = props(d['@_style-name']);
      const c = pg.gfx['@_fill-color'] as string | undefined;
      const ex = num(pg.chart['@_pie-offset'] as string | undefined);
      if (c || ex) points.push({ idx: at, ...(c ? { color: c.toLowerCase() } : {}), ...(ex ? { explosion: ex } : {}) });
      at += rep;
    }
    if (points.length) ser.points = points;
    series.push(ser);
  }
  if (!series.length) return { skip: 'el gráfico no tiene series' };

  const spec: ChartSpec = { type, legend: !!chart.legend, series };
  const title = txt(chart.title?.p);
  if (title) spec.title = title;
  const lp = LEGEND_IN[String(chart.legend?.['@_legend-position'] ?? '')];
  if (spec.legend && lp && lp !== 'b') spec.legendPos = lp;
  if (pp.chart['@_percentage'] === 'true') Object.assign(spec, { stacked: true, percent: true });
  else if (pp.chart['@_stacked'] === 'true') spec.stacked = true;
  if (pp.chart['@_interpolation'] === 'cubic-spline') spec.smooth = true;
  const gw = num(pp.chart['@_gap-width']);
  if (gw !== undefined && gw !== 150) spec.gapWidth = gw;
  const ov = num(pp.chart['@_overlap']);
  if (ov !== undefined && ov !== 0 && !(spec.stacked && ov === 100)) spec.overlap = ov;
  const ang = num(pp.chart['@_angle-offset']);
  if (ang) spec.firstSliceAng = ang;
  if (pp.chart['@_vary-colors'] === 'true') spec.varyColors = true;
  if (cls === 'filled-radar') spec.radar = { filled: true };
  for (const a of arr(chart['plot-area']?.axis)) {
    const key = a['@_dimension'] === 'x' ? 'axisX' : a['@_dimension'] === 'y' ? 'axisY' : null;
    if (!key) continue;
    const ap = props(a['@_style-name']);
    const out: NonNullable<ChartSpec['axisX']> = {};
    const t = txt(a.title?.p);
    if (t) out.title = t;
    const grids = arr(a.grid).map((g: XNode) => g['@_class']);
    if (grids.includes('major')) out.gridlines = true;
    else if (key === 'axisY') out.gridlines = false;
    if (grids.includes('minor')) out.minorGridlines = true;
    if (a['@_visible'] === 'false' || ap.chart['@_display-label'] === 'false') out.hidden = true;
    if (ap.chart['@_logarithmic'] === 'true') out.log = true;
    if (ap.chart['@_reverse-direction'] === 'true') out.reverse = true;
    if (Object.keys(out).length && !(key === 'axisY' && Object.keys(out).length === 1 && out.gridlines === true)) spec[key] = out;
  }
  const cs = props(chart['@_style-name']);
  const area: NonNullable<ChartSpec['chartArea']> = {};
  if (cs.gfx['@_fill'] === 'none') area.noFill = true;
  else if (cs.gfx['@_fill-color'] && cs.gfx['@_fill-color'].toLowerCase() !== '#ffffff') area.fill = String(cs.gfx['@_fill-color']).toLowerCase();
  if (cs.gfx['@_stroke'] === 'solid') area.line = { ...(cs.gfx['@_stroke-color'] ? { color: String(cs.gfx['@_stroke-color']).toLowerCase() } : {}), ...(lenPt(cs.gfx['@_stroke-width']) !== undefined ? { width: lenPt(cs.gfx['@_stroke-width']) } : {}) };
  if (Object.keys(area).length) spec.chartArea = area;
  const wall = props(plot?.wall?.['@_style-name']);
  const wa: NonNullable<ChartSpec['plotArea']> = {};
  if (wall.gfx['@_fill'] === 'none') wa.noFill = true;
  else if (wall.gfx['@_fill-color']) wa.fill = String(wall.gfx['@_fill-color']).toLowerCase();
  if (wall.gfx['@_stroke'] === 'solid') wa.line = { ...(wall.gfx['@_stroke-color'] ? { color: String(wall.gfx['@_stroke-color']).toLowerCase() } : {}) };
  if (Object.keys(wa).length) spec.plotArea = wa;
  const font = (t: XNode) => {
    const f: NonNullable<NonNullable<ChartSpec['fonts']>['chart']> = {};
    const sz = lenPt(t?.['@_font-size']);
    if (sz) f.size = Math.round(sz * 10) / 10;
    if (t?.['@_font-weight']) f.bold = t['@_font-weight'] === 'bold';
    if (t?.['@_font-style']) f.italic = t['@_font-style'] === 'italic';
    if (t?.['@_color']) f.color = String(t['@_color']).toLowerCase();
    if (t?.['@_font-family']) f.family = String(t['@_font-family']).replace(/'/g, '');
    return Object.keys(f).length ? f : undefined;
  };
  const fonts: NonNullable<ChartSpec['fonts']> = {};
  const fc = font(cs.text);
  if (fc) fonts.chart = fc;
  const ft = font(props(chart.title?.['@_style-name']).text);
  if (ft && spec.title) fonts.title = ft;
  const fl = font(props(chart.legend?.['@_style-name']).text);
  if (fl && spec.legend) fonts.legend = fl;
  if (Object.keys(fonts).length) spec.fonts = fonts;
  return { spec, grid };
}
