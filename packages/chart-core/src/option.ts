import { CHART_COLORS } from './data';
import type { ChartAxis, ChartSeries, ChartSpec, DataLabels, MarkerFormat, TextFormat } from './model';
import type { ErrorBars, Trendline } from './fit';
import { fitTrend, trendName, trendPath } from './fit';
import { formatChartNumber } from './format';
import { statChartOption } from './statOption';
import type { ChartData, ChartLocale, ChartPalette, ChartSeriesData } from './data';

const axisBase = (palette: ChartPalette) => ({ axisLine: { lineStyle: { color: palette.grid } }, axisLabel: { color: palette.text }, nameTextStyle: { color: palette.text } });

function valueAxis(a: ChartAxis | undefined, palette: ChartPalette, o: { opposite?: boolean; grid?: boolean; percent?: boolean; scale?: boolean; inverse?: boolean } = {}): Record<string, unknown> {
  const grid = a?.gridlines ?? o.grid ?? true;
  return {
    type: a?.log ? 'log' : 'value',
    name: a?.title,
    nameLocation: 'middle',
    nameGap: 36,
    position: o.opposite ? 'right' : undefined,
    min: a?.min ?? (o.percent ? 0 : undefined),
    max: a?.max ?? (o.percent ? 100 : undefined),
    scale: o.scale,
    inverse: a?.reverse || o.inverse || undefined,
    ...axisBase(palette),
    axisLine: { show: false },
    axisLabel: { color: palette.text, formatter: a?.format ? (v: number) => formatChartNumber(v, a.format) : o.percent ? '{value}%' : undefined },
    splitLine: { show: grid, lineStyle: { color: palette.grid } },
    minorTick: { show: !!a?.minorGridlines },
    minorSplitLine: { show: !!a?.minorGridlines, lineStyle: { color: palette.grid, opacity: 0.5 } },
    ...(a?.hidden ? { show: false } : {}),
  };
}

/** The legend of a chart where Excel's "Legend" element puts it (`data` restricts the entries). */
function legendOf(def: ChartSpec, palette: ChartPalette, data?: string[]): Record<string, unknown> | undefined {
  if (!def.legend) return undefined;
  const text = { textStyle: { color: palette.text }, type: 'scroll', ...(data ? { data } : {}) };
  switch (def.legendPos) {
    case 't':
      return { ...text, top: def.title ? 30 : 6, left: 'center' };
    case 'l':
      return { ...text, left: 6, top: 'middle', orient: 'vertical' };
    case 'r':
      return { ...text, right: 6, top: 'middle', orient: 'vertical' };
    case 'tr':
      return { ...text, right: 6, top: def.title ? 30 : 6, orient: 'vertical' };
    default:
      return { ...text, bottom: 4, left: 'center' };
  }
}

const LEGEND_W = 110;
const ROW_H = 22;
const hasTable = (def: ChartSpec): boolean => !!def.dataTable && def.type !== 'bar' && (def.type === 'column' || def.type === 'line' || def.type === 'area');

/** The room the plot leaves around it for the title, the legend, the axis titles and the data table. */
function gridOf(def: ChartSpec, secondary: boolean, rows: number, tableLeft: number): Record<string, unknown> {
  const horizontal = def.type === 'bar';
  const side = def.legendPos;
  const leftTitle = horizontal ? def.axisX?.title : def.axisY?.title;
  const bottomTitle = horizontal ? def.axisY?.title : def.axisX?.title;
  const table = hasTable(def);
  return {
    left: table ? tableLeft : 52 + (leftTitle ? 18 : 0) + (def.legend && side === 'l' ? LEGEND_W : 0),
    right: (secondary ? 56 : 20) + (def.legend && (side === 'r' || side === 'tr') ? LEGEND_W : 0),
    top: (def.title ? 44 : 20) + (def.legend && side === 't' ? 26 : 0),
    bottom: table ? ROW_H * (rows + 1) + 14 + (def.legend && (!side || side === 'b') ? 28 : 0) : 28 + (def.legend && (!side || side === 'b') ? 28 : 0) + (bottomTitle ? 18 : 0),
    containLabel: !table,
  };
}

/** Where the circle of a pie, doughnut or radar goes, leaving room for the legend and the title. */
function roundCenter(def: ChartSpec): [string, string] {
  const side = def.legendPos;
  const x = !def.legend ? 50 : side === 'l' ? 58 : side === 'r' || side === 'tr' ? 42 : 50;
  const y = (def.title ? 54 : 50) + (def.legend && side === 't' ? 4 : 0) + (def.legend && (!side || side === 'b') ? -3 : 0);
  return [`${x}%`, `${y}%`];
}

type LabelKind = 'bar' | 'line' | 'area' | 'pie' | 'scatter';

/** The data labels of a series (Excel's "Data labels") as an ECharts label; hidden when the series has none. */
function labelOf(l: DataLabels | undefined, kind: LabelKind, o: { horizontal?: boolean; stacked?: boolean } = {}): Record<string, unknown> {
  if (!l || !(l.value || l.category || l.series || l.percent)) return { show: false };
  const pos = l.pos;
  let position: string | undefined;
  if (kind === 'bar') {
    const h = !!o.horizontal;
    const p = pos ?? (o.stacked ? 'ctr' : 'outEnd');
    position = p === 'outEnd' && !o.stacked ? (h ? 'right' : 'top') : p === 'inEnd' ? (h ? 'insideRight' : 'insideTop') : p === 'inBase' ? (h ? 'insideLeft' : 'insideBottom') : 'inside';
  } else if (kind === 'line' || kind === 'scatter') {
    position = pos === 'b' ? 'bottom' : pos === 'l' ? 'left' : pos === 'r' || (!pos && kind === 'scatter') ? 'right' : pos === 'ctr' ? 'inside' : 'top';
  } else if (kind === 'pie') {
    position = pos === 'ctr' || pos === 'inEnd' ? 'inside' : 'outside';
  }
  const sep = l.separator ?? ', ';
  const parts: string[] = [];
  if (l.series) parts.push('{a}');
  if (l.category) parts.push('{b}');
  if (l.value) parts.push('{c}');
  if (l.percent && kind === 'pie') parts.push('{d}%');
  const out: Record<string, unknown> = { show: true, ...(position ? { position } : {}) };
  if (l.format && l.value) {
    const fmt = l.format;
    out.__fmt = fmt;
    out.formatter = (p: { value?: unknown; name?: string; seriesName?: string; percent?: number }) => {
      const raw = Array.isArray(p.value) ? p.value[1] : p.value;
      const out2: string[] = [];
      if (l.series) out2.push(p.seriesName ?? '');
      if (l.category) out2.push(p.name ?? '');
      out2.push(typeof raw === 'number' ? formatChartNumber(raw, fmt) : String(raw ?? ''));
      if (l.percent && kind === 'pie') out2.push(`${p.percent ?? 0}%`);
      return out2.join(sep);
    };
  } else out.formatter = parts.join(sep);
  return out;
}

/** Excel's "Data table": the categories and the values of every series in a table under the plot. */
function dataTableSeries(def: ChartSpec, categories: string[], series: ChartSeriesData[], palette: ChartPalette): Record<string, unknown> {
  const keys = !!def.dataTable?.keys;
  return {
    type: 'custom',
    silent: true,
    z: 1,
    data: categories.map((_c, i) => [i, 0]),
    encode: { x: 0, y: 1 },
    tooltip: { show: false },
    renderItem: (params: { coordSys: { x: number; y: number; width: number; height: number } }, api: Record<string, (...a: unknown[]) => unknown>) => {
      const i = api.value!(0) as number;
      const cs = params.coordSys;
      const x = (api.coord!([i, 0]) as number[])[0]!;
      const band = (api.size!([1, 0]) as number[])[0]!;
      const top = cs.y + cs.height + 4;
      const bottom = top + ROW_H * (series.length + 1);
      const style = { stroke: palette.grid, lineWidth: 1 };
      const text = (t: string, tx: number, ty: number, align: string) => ({ type: 'text', style: { text: t, x: tx, y: ty, fill: palette.text, textAlign: align, textVerticalAlign: 'middle', fontSize: 12 } });
      const children: Record<string, unknown>[] = [
        text(categories[i] ?? '', x, top + ROW_H / 2, 'center'),
        ...series.map((s, k) => text(s.values[i] === null || s.values[i] === undefined ? '' : formatChartNumber(s.values[i] as number), x, top + ROW_H * (k + 1) + ROW_H / 2, 'center')),
        { type: 'line', shape: { x1: x - band / 2, y1: top, x2: x - band / 2, y2: bottom }, style },
      ];
      if (i === categories.length - 1) children.push({ type: 'line', shape: { x1: x + band / 2, y1: top, x2: x + band / 2, y2: bottom }, style });
      if (i === 0) {
        for (let r = 0; r <= series.length + 1; r++) children.push({ type: 'line', shape: { x1: cs.x, y1: top + ROW_H * r, x2: cs.x + cs.width, y2: top + ROW_H * r }, style });
        series.forEach((s, k) => {
          const y = top + ROW_H * (k + 1) + ROW_H / 2;
          children.push(text(s.name, cs.x - 8 - (keys ? 14 : 0), y, 'right'));
          if (keys) children.push({ type: 'rect', shape: { x: cs.x - 18, y: y - 4, width: 8, height: 8 }, style: { fill: s.color } });
        });
      }
      return { type: 'group', children };
    },
  };
}



const DASHES: Record<string, string | number[]> = { solid: 'solid', dash: 'dashed', dot: 'dotted', dashDot: [8, 3, 2, 3], longDash: [12, 4] };
/** Points to pixels (96 dpi). */
const px = (pt: number): number => Math.round(((pt * 4) / 3) * 10) / 10;

/** "#rrggbb" with transparency in percent as an rgba() colour. */
function withAlpha(hex: string, transparency?: number): string {
  if (!transparency || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, 1 - transparency / 100))})`;
}

const SYMBOLS: Record<string, string> = {
  circle: 'circle',
  square: 'rect',
  diamond: 'diamond',
  triangle: 'triangle',
  dot: 'circle',
  dash: 'path://M0,40 L100,40 L100,60 L0,60 Z',
  x: 'path://M10,0 L50,40 L90,0 L100,10 L60,50 L100,90 L90,100 L50,60 L10,100 L0,90 L40,50 L0,10 Z',
  plus: 'path://M40,0 L60,0 L60,40 L100,40 L100,60 L60,60 L60,100 L40,100 L40,60 L0,60 L0,40 L40,40 Z',
  star: 'path://M50,0 L61,35 L98,35 L68,57 L79,91 L50,70 L21,91 L32,57 L2,35 L39,35 Z',
};

/** The marker of a series as ECharts symbol options. */
function markerOf(m: MarkerFormat | undefined, color: string, fallback: { symbol: string; size: number }): Record<string, unknown> {
  const symbol = m?.symbol ? (m.symbol === 'none' ? 'none' : SYMBOLS[m.symbol]) : fallback.symbol;
  const size = m?.size ?? undefined;
  return {
    symbol,
    symbolSize: size !== undefined ? px(size) * (m?.symbol === 'dot' ? 0.5 : 1) : fallback.size,
    ...(m?.color ? { itemStyle: { color: m.color, borderColor: m.color } } : { itemStyle: { color } }),
    ...(m?.symbol ? { showSymbol: m.symbol !== 'none' } : {}),
  };
}

/** The line of a line, scatter or radar series. */
function lineOf(s: ChartSeries | undefined, color: string): Record<string, unknown> {
  const l = s?.line;
  if (l?.none) return { color, width: 0, opacity: 0 };
  return { color: l?.color ?? color, ...(l?.width !== undefined ? { width: px(l.width) } : {}), ...(l?.dash ? { type: DASHES[l.dash] } : {}) };
}

/** The fill and border of a column, area or slice. */
function fillOf(s: ChartSeries | undefined, color: string): Record<string, unknown> {
  const l = s?.line;
  const out: Record<string, unknown> = { color: s?.noFill ? 'rgba(0,0,0,0)' : withAlpha(color, s?.transparency) };
  if (l && !l.none && (l.color || l.width !== undefined || l.dash)) {
    out.borderColor = l.color ?? '#000000';
    out.borderWidth = l.width !== undefined ? px(l.width) : 1;
    if (l.dash) out.borderType = DASHES[l.dash];
  }
  return out;
}

/** Point formats (colour per column or slice) over the values of a series. */
function pointData(values: (number | null)[], s: ChartSeries | undefined, base: { vary?: boolean; palette: string[]; border?: Record<string, unknown> }): unknown[] {
  const byIdx = new Map((s?.points ?? []).map((p) => [p.idx, p]));
  return values.map((v, i) => {
    const p = byIdx.get(i);
    const color = p?.color ?? (base.vary ? base.palette[i % base.palette.length] : undefined);
    return color || p?.explosion ? { value: v, ...(color ? { itemStyle: { ...(base.border ?? {}), color: withAlpha(color, s?.transparency) } } : {}) } : v;
  });
}


// ---- área del gráfico, área de trazado y fuentes

const FONT_FALLBACK = 'Calibri, Carlito, "Segoe UI", sans-serif';

/** The colours the chart is drawn with once the chart area and the base font have had their say. */
export function effectivePalette(def: ChartSpec, palette: ChartPalette): ChartPalette {
  const a = def.chartArea;
  const bg = a?.noFill ? 'rgba(0,0,0,0)' : a?.fill ? withAlpha(a.fill, a.transparency) : palette.bg;
  return { text: def.fonts?.chart?.color ?? palette.text, grid: palette.grid, bg };
}

/** CSS for the box that holds a live chart: the border of the chart area (the fill is drawn by the chart itself). */
export function chartAreaCss(def: ChartSpec): Record<string, string> {
  const l = def.chartArea?.line;
  if (!l) return {};
  if (l.none) return { border: 'none' };
  const style = l.dash === 'dash' || l.dash === 'longDash' ? 'dashed' : l.dash === 'dot' ? 'dotted' : l.dash === 'dashDot' ? 'dashed' : 'solid';
  return { border: `${l.width !== undefined ? px(l.width) : 1}px ${style} ${l.color ?? '#808080'}` };
}

const textOf = (f: TextFormat | undefined, base: TextFormat | undefined, color: string): Record<string, unknown> => {
  const m: TextFormat = { ...base, ...f };
  return {
    color: m.color ?? color,
    fontFamily: m.family ? `"${m.family}", ${FONT_FALLBACK}` : FONT_FALLBACK,
    ...(m.size !== undefined ? { fontSize: px(m.size) } : {}),
    ...(m.bold !== undefined ? { fontWeight: m.bold ? 700 : 400 } : {}),
    ...(m.italic !== undefined ? { fontStyle: m.italic ? 'italic' : 'normal' } : {}),
  };
};

/** Applies the format of the areas and the fonts to an option built for `def` (the option's own looks stay where nothing is set). */
function finish(def: ChartSpec, option: Record<string, unknown>, palette: ChartPalette): Record<string, unknown> {
  const out = { ...option };
  const f = def.fonts;
  if (f?.chart) out.textStyle = { ...(out.textStyle as object), ...textOf(f.chart, undefined, palette.text) };
  const withText = (key: 'title' | 'legend', fmt: TextFormat | undefined) => {
    const cur = out[key] as Record<string, unknown> | undefined;
    if (!cur || (!fmt && !f?.chart)) return;
    const ts = (cur.textStyle ?? {}) as Record<string, unknown>;
    out[key] = { ...cur, textStyle: { ...ts, ...textOf(fmt, f?.chart, palette.text), ...(key === 'title' && fmt?.size === undefined ? { fontSize: ts.fontSize } : {}), ...(key === 'title' && fmt?.bold === undefined ? { fontWeight: ts.fontWeight } : {}) } };
  };
  withText('title', f?.title);
  withText('legend', f?.legend);
  if (f?.axis || f?.axisTitle || f?.chart) {
    for (const k of ['xAxis', 'yAxis']) {
      const ax = out[k];
      if (!ax) continue;
      const fix = (a: Record<string, unknown>) => ({
        ...a,
        axisLabel: { ...((a.axisLabel as object) ?? {}), ...textOf(f?.axis, f?.chart, palette.text) },
        nameTextStyle: { ...((a.nameTextStyle as object) ?? {}), ...textOf(f?.axisTitle, f?.chart, palette.text) },
      });
      out[k] = Array.isArray(ax) ? ax.map(fix) : fix(ax as Record<string, unknown>);
    }
  }
  if (f?.labels || f?.chart) {
    const ser = out.series as Record<string, unknown>[] | undefined;
    if (ser)
      out.series = ser.map((s) => {
        const l = s.label as Record<string, unknown> | undefined;
        return l && l.show ? { ...s, label: { ...l, ...textOf(f?.labels, f?.chart, palette.text) } } : s;
      });
  }
  const pa = def.plotArea;
  if (pa && out.grid && !Array.isArray(out.grid)) {
    const l = pa.line;
    out.grid = {
      ...(out.grid as object),
      show: true,
      backgroundColor: pa.noFill ? 'rgba(0,0,0,0)' : pa.fill ? withAlpha(pa.fill, pa.transparency) : 'rgba(0,0,0,0)',
      borderColor: l && !l.none ? (l.color ?? '#808080') : 'rgba(0,0,0,0)',
      borderWidth: l && !l.none ? (l.width !== undefined ? px(l.width) : 1) : 0,
    };
  }
  return out;
}

const SUPERSCRIPT_R2 = 'R\u00b2';

interface TrendDraw {
  series: Record<string, unknown>[];
  /** Textos de ecuación y R² para mostrar sobre el gráfico. */
  labels: { text: string; color: string }[];
  names: string[];
}

/** Series de línea de las tendencias y los textos de su ecuación. `xOf` da la x de cada punto (índice + 1 en categorías). */
function trendDraw(def: ChartSpec, series: ChartSeriesData[], locale: ChartLocale, o: { category: boolean; categoryCount: number }): TrendDraw {
  const out: TrendDraw = { series: [], labels: [], names: [] };
  if (def.stacked || def.threeD) return out;
  def.series.forEach((ds, si) => {
    const s = series[si];
    if (!s || !ds.trendlines?.length || (o.category && s.type === 'scatter')) return;
    ds.trendlines.forEach((tl: Trendline, ti) => {
      const points = s.values.map((y, i) => ({ x: o.category ? i + 1 : (s.x[i] ?? i + 1), y: y as number })).filter((p) => p.y !== null);
      const fit = fitTrend(points, tl);
      if (!fit) return;
      const name = trendName(tl, s.name, locale === 'es');
      const color = tl.color ?? s.color;
      const path = trendPath(fit, points, tl);
      let data: unknown[];
      if (o.category) {
        // una posición por categoría (más las de la prolongación hacia delante)
        const byX = new Map(path.map(([x, y]) => [Math.round(x * 1e6) / 1e6, y]));
        data = Array.from({ length: o.categoryCount }, (_c, i) => (tl.type === 'movingAvg' ? (byX.get(i + 1) ?? null) : fit.predict(i + 1) as number | null)).map((v, i) => (tl.type !== 'movingAvg' && i + 1 < (points[0]?.x ?? 1) - Math.max(0, tl.backward ?? 0) ? null : v));
      } else data = path;
      out.names.push(name);
      out.series.push({ type: 'line', name, data, yAxisIndex: s.secondary ? 1 : 0, showSymbol: false, symbol: 'none', smooth: false, silent: true, lineStyle: { color, width: 2, type: 'dashed' }, itemStyle: { color }, z: 6 });
      const lines: string[] = [];
      if (tl.dispEq && fit.equation) lines.push(fit.equation);
      if (tl.dispR2 && fit.r2 !== null) lines.push(`${SUPERSCRIPT_R2} = ${fit.r2.toFixed(4)}`);
      if (lines.length) out.labels.push({ text: lines.join('\n'), color });
      void ti;
    });
  });
  return out;
}

/** Texto sobre el gráfico con las ecuaciones de las tendencias. */
function trendGraphic(labels: TrendDraw['labels'], palette: ChartPalette, top: number): Record<string, unknown>[] {
  return labels.map((l, i) => ({ type: 'text', right: 28, top: top + i * 34, silent: true, z: 20, style: { text: l.text, fill: l.color, font: '12px Calibri, Carlito, "Segoe UI", sans-serif', backgroundColor: palette.bg, padding: [2, 4] } }));
}

/** Series «personalizadas» que dibujan las barras de error de las series que las tienen. */
function errorSeries(def: ChartSpec, series: ChartSeriesData[], palette: ChartPalette, o: { horizontal: boolean; scatter: boolean }): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const cols = series.filter((s) => s.type === 'column');
  series.forEach((s, si) => {
    const ds = def.series[si]!;
    const lineColor = palette.text;
    const bars: { amounts: NonNullable<ChartSeriesData['errY']>; dir: 'x' | 'y'; eb: ErrorBars }[] = [];
    if (s.errY && ds.errY) bars.push({ amounts: s.errY, dir: 'y', eb: ds.errY });
    if (s.errX && ds.errX) bars.push({ amounts: s.errX, dir: 'x', eb: ds.errX });
    for (const b of bars) {
      // en columnas agrupadas la barra de error sigue a su columna dentro de la categoría
      const peers = cols.filter((c) => c.secondary === s.secondary);
      const k = def.stacked || s.type !== 'column' ? 1 : Math.max(1, peers.length);
      const slot = def.stacked || s.type !== 'column' ? 0 : peers.indexOf(s) - (k - 1) / 2;
      const rows = s.values.map((y, i) => {
        const centre = o.scatter ? (s.x[i] ?? i + 1) : i;
        const at = b.dir === 'x' ? (s.x[i] ?? i + 1) : (y as number | null);
        const plus = b.amounts.plus[i];
        const minus = b.amounts.minus[i];
        if (at === null || at === undefined || plus === null || plus === undefined || minus === null || minus === undefined) return null;
        const pos = b.dir === 'y' ? (y as number) : (y as number);
        // apiladas: la barra va en lo alto de la pila
        const stackTop = def.stacked ? series.slice(0, si + 1).reduce((a, q) => a + (q.values[i] ?? 0), 0) : pos;
        const val = b.dir === 'x' ? pos : stackTop;
        return b.dir === 'y' ? [centre, val, val - minus, val + plus] : [at, val, (at as number) - minus, (at as number) + plus];
      }).filter((r) => r !== null);
      out.push({
        type: 'custom',
        id: `eb:${si}:${b.dir}`,
        silent: true,
        z: 5,
        yAxisIndex: s.secondary && !o.horizontal ? 1 : 0,
        encode: b.dir === 'y' ? (o.horizontal ? { y: 0, x: [2, 3] } : { x: 0, y: [2, 3] }) : { x: [2, 3], y: 1 },
        data: rows,
        renderItem: (params: unknown, api: Record<string, (...a: unknown[]) => unknown>) => {
          const coord = (x: number, y: number) => api.coord!(o.horizontal && b.dir === 'y' ? [y, x] : [x, y]) as [number, number];
          const c = (api.value as (i: number) => number);
          const cap = b.eb.noCap ? 0 : 5;
          const style = { stroke: lineColor, lineWidth: 1.4, fill: 'none' };
          let offset = 0;
          if (b.dir === 'y' && slot !== 0) {
            const band = ((o.horizontal ? (api.size as (v: number[]) => number[])([0, 1])[1] : (api.size as (v: number[]) => number[])([1, 0])[0]) as number) ?? 0;
            const w = Math.min(48, (band * 0.8) / (k + 0.3 * (k - 1)));
            offset = slot * w * 1.3;
          }
          if (b.dir === 'y') {
            const hi = coord(c(0), c(3));
            const lo = coord(c(0), c(2));
            const lineAt = o.horizontal ? { x1: hi[0], y1: hi[1] + offset, x2: lo[0], y2: lo[1] + offset } : { x1: hi[0] + offset, y1: hi[1], x2: lo[0] + offset, y2: lo[1] };
            const children: Record<string, unknown>[] = [{ type: 'line', shape: lineAt, style }];
            if (cap) {
              children.push({ type: 'line', shape: o.horizontal ? { x1: hi[0], y1: hi[1] + offset - cap, x2: hi[0], y2: hi[1] + offset + cap } : { x1: hi[0] + offset - cap, y1: hi[1], x2: hi[0] + offset + cap, y2: hi[1] }, style });
              children.push({ type: 'line', shape: o.horizontal ? { x1: lo[0], y1: lo[1] + offset - cap, x2: lo[0], y2: lo[1] + offset + cap } : { x1: lo[0] + offset - cap, y1: lo[1], x2: lo[0] + offset + cap, y2: lo[1] }, style });
            }
            return { type: 'group', children };
          }
          const left = coord(c(2), c(1));
          const right = coord(c(3), c(1));
          const children: Record<string, unknown>[] = [{ type: 'line', shape: { x1: left[0], y1: left[1], x2: right[0], y2: right[1] }, style }];
          if (cap) {
            children.push({ type: 'line', shape: { x1: left[0], y1: left[1] - cap, x2: left[0], y2: left[1] + cap }, style });
            children.push({ type: 'line', shape: { x1: right[0], y1: right[1] - cap, x2: right[0], y2: right[1] + cap }, style });
          }
          void params;
          return { type: 'group', children };
        },
      });
    }
  });
  return out;
}

/** Tooltip de ejes que no cuenta las series auxiliares de las barras de error. */
const axisTooltip = (extra: Record<string, unknown> = {}) => ({
  trigger: 'axis',
  confine: true,
  ...extra,
  formatter: (ps: { seriesId?: string; marker?: string; seriesName?: string; value?: unknown; axisValueLabel?: string }[]) => {
    const rows = ps.filter((p) => !String(p.seriesId ?? '').startsWith('eb:'));
    if (!rows.length) return '';
    const v = (x: unknown) => (Array.isArray(x) ? x[1] : x);
    return `${rows[0]!.axisValueLabel ?? ''}<br/>${rows.map((p) => `${p.marker ?? ''} ${p.seriesName ?? ''}: <b>${v(p.value) ?? ''}</b>`).join('<br/>')}`;
  },
});

/** Build an ECharts option from a chart definition and the current workbook contents. */
export function chartOption(def: ChartSpec, data: ChartData, locale: ChartLocale, palette: ChartPalette): Record<string, unknown> {
  const pal = effectivePalette(def, palette);
  return finish(def, buildOption(def, data, locale, pal), pal);
}

function buildOption(def: ChartSpec, data: ChartData, locale: ChartLocale, palette: ChartPalette): Record<string, unknown> {
  const { categories, series } = data;
  const n = Math.max(0, ...series.map((s) => s.values.length));

  const base: Record<string, unknown> = {
    animation: false,
    color: series.map((s) => s.color),
    backgroundColor: palette.bg,
    textStyle: { color: palette.text, fontFamily: 'Calibri, Carlito, "Segoe UI", sans-serif' },
    title: def.title ? { text: def.title, left: 'center', top: 6, textStyle: { color: palette.text, fontSize: 15, fontWeight: 600 } } : undefined,
    legend: legendOf(def, palette),
    tooltip: { trigger: def.type === 'pie' || def.type === 'doughnut' || def.type === 'scatter' || def.type === 'radar' ? 'item' : 'axis', confine: true },
    grid: gridOf(def, def.series.some((s) => s.secondary), series.length, 20 + Math.min(150, 14 + 7 * Math.max(4, ...series.map((s) => s.name.length)))),
  };

  const statistical = statChartOption(def, categories, series, base, palette, locale);
  if (statistical) return statistical;

  if (def.type === 'pie' || def.type === 'doughnut') {
    const s = series[0];
    const ps = def.series[0];
    const pts = new Map((ps?.points ?? []).map((p) => [p.idx, p]));
    const explode = (i: number): number => pts.get(i)?.explosion ?? ps?.explosion ?? 0;
    const data = (s?.values ?? [])
      .map((v, i) => ({ name: categories[i] ?? String(i + 1), value: v ?? 0, ...(pts.get(i)?.color ? { itemStyle: { color: pts.get(i)!.color } } : {}), ...(explode(i) ? { selected: true } : {}), i }))
      .filter((d) => d.value > 0)
      .map(({ i, ...d }) => ({ ...d, ...(explode(i) ? { selected: true } : {}) }));
    const maxExplode = Math.max(0, ...(s?.values ?? []).map((_v, i) => explode(i)));
    return {
      ...base,
      color: undefined,
      grid: undefined,
      legend: legendOf(def, palette, data.map((d) => d.name)),
      series: [{ type: 'pie', name: s?.name, radius: def.type === 'doughnut' ? [`${Math.round(((def.holeSize ?? 50) / 100) * 68)}%`, '68%'] : ['0%', '68%'], center: roundCenter(def), startAngle: 90 - (def.firstSliceAng ?? 0), data, selectedMode: 'multiple', selectedOffset: Math.round(maxExplode * 0.6), label: { color: palette.text, ...labelOf(def.series[0]?.labels, 'pie') }, itemStyle: { borderColor: palette.bg, borderWidth: 1, ...(({ color: _c, ...border }) => border)(fillOf(ps, '#000000')) } }],
    };
  }

  if (def.type === 'radar') {
    const maxOf = (i: number) => Math.max(0, ...series.map((s) => s.values[i] ?? 0));
    const top = Math.max(1, ...categories.map((_c, i) => maxOf(i)));
    return {
      ...base,
      grid: undefined,
      radar: {
        indicator: categories.slice(0, Math.max(n, 3)).map((name) => ({ name, max: def.axisY?.max ?? top * 1.1, min: def.axisY?.min ?? 0 })),
        center: roundCenter(def),
        radius: '62%',
        axisName: { color: palette.text },
        splitLine: { lineStyle: { color: palette.grid } },
        splitArea: { show: false },
        axisLine: { lineStyle: { color: palette.grid } },
      },
      series: [
        {
          type: 'radar',
          symbol: def.radar?.markers || def.radar?.filled ? 'circle' : 'none',
          symbolSize: 5,
          data: series.map((s, si) => ({ name: s.name, value: s.values.map((v) => v ?? 0), ...markerOf(def.series[si]?.marker, s.color, { symbol: def.radar?.markers || def.radar?.filled ? 'circle' : 'none', size: 5 }), lineStyle: { width: 2, ...lineOf(def.series[si], s.color) }, ...(def.radar?.filled ? { areaStyle: { color: withAlpha(s.color, def.series[si]?.transparency ?? 70), opacity: 1 } } : {}) })),
        },
      ],
    };
  }

  if (def.type === 'stock') {
    const kind = def.stock?.kind ?? 'hlc';
    const volume = kind === 'vhlc' || kind === 'vohlc';
    const px = volume ? series.slice(1) : series;
    const col = (name: string) => px[{ open: 0, high: kind === 'ohlc' || kind === 'vohlc' ? 1 : 0, low: kind === 'ohlc' || kind === 'vohlc' ? 2 : 1, close: kind === 'ohlc' || kind === 'vohlc' ? 3 : 2 }[name as 'open']]?.values ?? [];
    const hasOpen = kind === 'ohlc' || kind === 'vohlc';
    const open = hasOpen ? col('open') : col('close');
    const high = col('high');
    const low = col('low');
    const close = col('close');
    const data = categories.map((_c, i) => [open[i] ?? close[i] ?? 0, close[i] ?? 0, low[i] ?? 0, high[i] ?? 0]);
    const out: Record<string, unknown> = {
      ...base,
      color: undefined,
      legend: legendOf(def, palette, [volume ? series[0]!.name : '', def.title ?? ''].filter(Boolean)),
      tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'cross' } },
      xAxis: { type: 'category', data: categories, boundaryGap: true, ...axisBase(palette) },
      yAxis: volume ? [valueAxis(def.axisY, palette, { scale: true, grid: false }), { ...valueAxis(def.axisY2, palette, { opposite: true, scale: true }), splitLine: { show: true, lineStyle: { color: palette.grid } } }] : valueAxis(def.axisY, palette, { scale: true }),
      series: [
        ...(volume ? [{ type: 'bar', name: series[0]!.name, yAxisIndex: 0, data: series[0]!.values, itemStyle: { color: series[0]!.color, opacity: 0.55 } }] : []),
        { type: 'candlestick', name: def.title ?? 'Precio', yAxisIndex: volume ? 1 : 0, data, itemStyle: { color: '#2f9e44', color0: '#d64545', borderColor: '#2f9e44', borderColor0: '#d64545' } },
      ],
    };
    return out;
  }

  if (def.type === 'scatter' && series.every((s) => s.type === 'scatter')) {
    const hasSecondary = series.some((s) => s.secondary);
    const trends = trendDraw(def, series, locale, { category: false, categoryCount: 0 });
    const bars = errorSeries(def, series, palette, { horizontal: false, scatter: true });
    return {
      ...base,
      legend: legendOf(def, palette, [...series.map((s) => s.name), ...trends.names]),
      tooltip: { trigger: 'item', confine: true },
      graphic: trendGraphic(trends.labels, palette, def.title ? 40 : 14),
      xAxis: { ...valueAxis(def.axisX, palette, { scale: true, grid: false }), position: undefined, nameGap: 28 },
      yAxis: hasSecondary ? [valueAxis(def.axisY, palette, { scale: true }), valueAxis(def.axisY2, palette, { opposite: true, scale: true, grid: false })] : valueAxis(def.axisY, palette, { scale: true }),
      series: [
        ...series.map((s, si) => ({
          type: 'scatter',
          name: s.name,
          label: labelOf(def.series[si]?.labels, 'scatter'),
          ...markerOf(def.series[si]?.marker, s.color, { symbol: 'circle', size: 8 }),
          yAxisIndex: s.secondary ? 1 : 0,
          data: s.values.map((y, i) => [s.x[i] ?? i + 1, y]).filter((p) => p[0] !== null && p[1] !== null),
        })),
        ...trends.series,
        ...bars,
      ],
    };
  }

  // category charts: column, bar, line, area and combinations of them
  const horizontal = def.type === 'bar';
  const percent = !!def.stacked && !!def.percent;
  const totals = percent ? categories.map((_c, i) => series.filter((s) => s.type !== 'line' || def.stacked).reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0) || 1) : [];
  const hasSecondary = series.some((s) => s.secondary);
  const table = hasTable(def);
  // ancho del hueco y superposición de Excel como separación entre categorías y entre barras de ECharts
  const nBars = Math.max(1, series.filter((s) => s.type === 'column').length);
  const overlap = def.overlap ?? (def.stacked ? 100 : 0);
  const effective = def.stacked ? 1 : 1 + (nBars - 1) * (1 - overlap / 100);
  const barSpacing = def.gapWidth !== undefined || def.overlap !== undefined ? { barCategoryGap: `${Math.round(((def.gapWidth ?? 150) / 100 / (effective + (def.gapWidth ?? 150) / 100)) * 1000) / 10}%`, barGap: `${-overlap}%` } : {};
  const catAxis = { type: 'category', data: categories, name: def.axisX?.title, nameLocation: 'middle', nameGap: 30, inverse: horizontal !== !!def.axisX?.reverse, ...axisBase(palette), ...(table ? { axisLabel: { show: false } } : {}), ...(def.axisX?.hidden ? { show: false } : {}), splitLine: { show: !!def.axisX?.gridlines, lineStyle: { color: palette.grid } } };
  const primary = valueAxis(def.axisY, palette, { percent, grid: def.axisY?.gridlines ?? true });
  const yAxis = hasSecondary ? [primary, valueAxis(def.axisY2, palette, { opposite: true, grid: false })] : primary;
  const maxForward = Math.max(0, ...def.series.flatMap((s) => (s.trendlines ?? []).map((tl) => Math.round(tl.forward ?? 0))));
  const cats = maxForward ? [...categories, ...Array.from({ length: maxForward }, () => '')] : categories;
  const trends = trendDraw(def, series, locale, { category: true, categoryCount: cats.length });
  const bars = errorSeries(def, series, palette, { horizontal, scatter: false });
  const catAxisFull = { ...catAxis, data: cats };
  const out: Record<string, unknown> = {
    ...base,
    xAxis: horizontal ? primary : catAxisFull,
    yAxis: horizontal ? catAxisFull : yAxis,
    ...(trends.names.length || bars.length
      ? {
          legend: legendOf(def, palette, [...series.map((s) => s.name), ...trends.names]),
          tooltip: axisTooltip(),
          graphic: trendGraphic(trends.labels, palette, def.title ? 40 : 14),
        }
      : {}),
    series: [...series.map((s, si) => {
      const label = labelOf(def.series[si]?.labels, s.type === 'column' ? 'bar' : s.type === 'area' ? 'area' : s.type === 'scatter' ? 'scatter' : 'line', { horizontal, stacked: !!def.stacked });
      const data = percent && s.type !== 'line' ? s.values.map((v, i) => (v === null ? null : Math.round((v / totals[i]!) * 10000) / 100)) : s.values;
      const fmt = def.series[si];
      const pdata = s.type === 'column' ? pointData(data, fmt, { vary: !!def.varyColors && series.length === 1, palette: CHART_COLORS, border: (({ color: _c, ...b }) => b)(fillOf(fmt, s.color)) }) : data;
      const common = { name: s.name, data: pdata, yAxisIndex: s.secondary && !horizontal ? 1 : 0, itemStyle: s.type === 'column' || s.type === 'area' ? fillOf(fmt, s.color) : { color: s.color }, label };
      switch (s.type) {
        case 'column':
          return { ...common, type: 'bar', ...(def.gapWidth === undefined ? { barMaxWidth: 48 } : {}), ...barSpacing, ...(def.stacked ? { stack: s.secondary ? 'secondary' : 'total' } : {}) };
        case 'area':
          return { ...common, type: 'line', smooth: !!def.smooth, symbol: 'none', areaStyle: { opacity: 1, color: fmt?.noFill ? 'rgba(0,0,0,0)' : withAlpha(s.color, fmt?.transparency ?? 65) }, lineStyle: fmt?.line && !fmt.line.none ? lineOf(fmt, s.color) : { color: s.color }, ...(def.stacked ? { stack: s.secondary ? 'secondary' : 'total' } : {}) };
        case 'scatter':
          return { ...common, type: 'scatter', ...markerOf(fmt?.marker, s.color, { symbol: 'circle', size: 8 }) };
        default:
          return { ...common, type: 'line', smooth: !!def.smooth, symbolSize: 6, showSymbol: n < 40, ...markerOf(fmt?.marker, s.color, { symbol: 'circle', size: 6 }), lineStyle: lineOf(fmt, s.color), ...(def.stacked && def.type === 'line' ? { stack: s.secondary ? 'secondary' : 'total' } : {}) };
      }
    }), ...trends.series, ...bars, ...(table ? [dataTableSeries(def, categories, series, palette)] : [])],
  };
  return out;
}
