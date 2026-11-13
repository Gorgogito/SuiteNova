import { errorAmounts, fitTrend, formatValue, isErr, resolveRangeText, trendName, trendPath, type ChartAxis, type ChartDef, type ErrorBars, type FormulaLocale, type Scalar, type SeriesType, type Trendline, type Workbook } from '@suitenova/calc-engine';

import { statChartOption } from './chartStatOption';

export const CHART_COLORS = ['#3b82c4', '#e8833a', '#7a8b99', '#e0b030', '#4aa3a2', '#6aa84f', '#a463a0', '#d65a5a'];

/** Values and display labels of a referenced range, in row-major order. */
function readRange(wb: Workbook, text: string | undefined, fallbackSheet: number, locale: FormulaLocale): { values: Scalar[]; labels: string[] } {
  const r = resolveRangeText(wb, text, fallbackSheet);
  if (!r) return { values: [], labels: [] };
  const sheet = wb.sheet(r.sheetId);
  const values: Scalar[] = [];
  const labels: string[] = [];
  const r2 = Math.min(r.rect.r2, Math.max(sheet.maxRow, r.rect.r1));
  const c2 = Math.min(r.rect.c2, Math.max(sheet.maxCol, r.rect.c1));
  for (let row = r.rect.r1; row <= r2; row++) {
    for (let col = r.rect.c1; col <= c2; col++) {
      const cell = sheet.cells.get(row * 16384 + col);
      const v = cell?.value ?? null;
      values.push(v);
      labels.push(formatValue(v, wb.styles.get(cell?.style ?? 0).numFmt, locale).text);
    }
  }
  return { values, labels };
}

const num = (v: Scalar): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Valores de error personalizados: una lista («1;2;3»), un número o un rango. */
function readCustom(wb: Workbook, text: string | undefined, sheetId: number, locale: FormulaLocale): (number | null)[] {
  if (!text) return [];
  const t = text.trim().replace(/^=/, '').replace(/^\{|\}$/g, '');
  if (!t.includes('!') && /^[\d\s.,;+\-eE]+$/.test(t) && !/^[A-Za-z]+\d/.test(t)) return t.split(/[;,]/).map((x) => num(Number(x.trim()))).filter((x, i, a) => !(x === null && i === a.length - 1));
  return readRange(wb, t, sheetId, locale).values.map((v) => (isErr(v) ? null : num(v)));
}

export interface ChartPalette {
  text: string;
  grid: string;
  bg: string;
}

export interface ChartSeriesData {
  name: string;
  /** Plotted numbers (null for blanks and text). */
  values: (number | null)[];
  /** X values for scatter charts. */
  x: (number | null)[];
  /** Category labels read for this series. */
  labels: string[];
  type: SeriesType;
  secondary: boolean;
  color: string;
  /** Cantidades de error por punto, ya calculadas (si la serie tiene barras de error). */
  errY?: { plus: (number | null)[]; minus: (number | null)[] };
  errX?: { plus: (number | null)[]; minus: (number | null)[] };
}

/** The numbers and labels behind a chart, read from the workbook. */
export function chartData(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale): { categories: string[]; series: ChartSeriesData[] } {
  const series = def.series.map((s, i) => {
    const vals = readRange(wb, s.values, sheetId, locale);
    const cats = readRange(wb, s.categories, sheetId, locale);
    const nameCell = s.nameRef ? readRange(wb, s.nameRef, sheetId, locale).labels[0] : undefined;
    const type: SeriesType = s.type ?? (def.type === 'bar' || def.type === 'column' ? 'column' : def.type === 'area' ? 'area' : def.type === 'scatter' ? 'scatter' : 'line');
    const values = vals.values.map((v) => (isErr(v) ? null : num(v)));
    const x = cats.values.map(num);
    const amounts = (eb: ErrorBars | undefined, of: (number | null)[]) =>
      eb ? errorAmounts(of, eb, eb.kind === 'custom' ? { plus: readCustom(wb, eb.plus, sheetId, locale), minus: readCustom(wb, eb.minus ?? eb.plus, sheetId, locale) } : undefined) : undefined;
    return {
      name: s.name ?? (nameCell || `${locale === 'es' ? 'Serie' : 'Series'} ${i + 1}`),
      values,
      x,
      labels: cats.labels,
      type,
      secondary: !!s.secondary,
      color: s.color ?? CHART_COLORS[i % CHART_COLORS.length]!,
      errY: amounts(s.errY, values),
      errX: def.type === 'scatter' ? amounts(s.errX, x) : undefined,
    };
  });
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const categories = series.find((s) => s.labels.length)?.labels ?? Array.from({ length: n }, (_x, i) => String(i + 1));
  return { categories, series };
}

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
    axisLabel: { color: palette.text, formatter: a?.format ? (v: number) => formatValue(v, a.format, 'en').text : o.percent ? '{value}%' : undefined },
    splitLine: { show: grid, lineStyle: { color: palette.grid } },
  };
}

const SUPERSCRIPT_R2 = 'R\u00b2';

interface TrendDraw {
  series: Record<string, unknown>[];
  /** Textos de ecuación y R² para mostrar sobre el gráfico. */
  labels: { text: string; color: string }[];
  names: string[];
}

/** Series de línea de las tendencias y los textos de su ecuación. `xOf` da la x de cada punto (índice + 1 en categorías). */
function trendDraw(def: ChartDef, series: ChartSeriesData[], locale: FormulaLocale, o: { category: boolean; categoryCount: number }): TrendDraw {
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
function errorSeries(def: ChartDef, series: ChartSeriesData[], palette: ChartPalette, o: { horizontal: boolean; scatter: boolean }): Record<string, unknown>[] {
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
export function chartOption(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale, palette: ChartPalette): Record<string, unknown> {
  const { categories, series } = chartData(def, wb, sheetId, locale);
  const n = Math.max(0, ...series.map((s) => s.values.length));

  const base: Record<string, unknown> = {
    animation: false,
    color: series.map((s) => s.color),
    backgroundColor: palette.bg,
    textStyle: { color: palette.text, fontFamily: 'Calibri, Carlito, "Segoe UI", sans-serif' },
    title: def.title ? { text: def.title, left: 'center', top: 6, textStyle: { color: palette.text, fontSize: 15, fontWeight: 600 } } : undefined,
    legend: def.legend ? { bottom: 4, textStyle: { color: palette.text }, type: 'scroll' } : undefined,
    tooltip: { trigger: def.type === 'pie' || def.type === 'doughnut' || def.type === 'scatter' || def.type === 'radar' ? 'item' : 'axis', confine: true },
    grid: { left: 52, right: def.series.some((s) => s.secondary) ? 56 : 20, top: def.title ? 44 : 20, bottom: def.legend ? 44 : 28 + (def.axisX?.title ? 18 : 0), containLabel: true },
  };

  const statistical = statChartOption(def, categories, series, base, palette, locale);
  if (statistical) return statistical;

  if (def.type === 'pie' || def.type === 'doughnut') {
    const s = series[0];
    const data = (s?.values ?? []).map((v, i) => ({ name: categories[i] ?? String(i + 1), value: v ?? 0 })).filter((d) => d.value > 0);
    return {
      ...base,
      color: undefined,
      grid: undefined,
      legend: { bottom: 4, textStyle: { color: palette.text }, type: 'scroll' },
      series: [{ type: 'pie', name: s?.name, radius: def.type === 'doughnut' ? ['38%', '68%'] : ['0%', '68%'], center: ['50%', def.title ? '54%' : '48%'], data, label: { color: palette.text, formatter: '{b}: {d}%' }, itemStyle: { borderColor: palette.bg, borderWidth: 1 } }],
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
        center: ['50%', def.title ? '54%' : '50%'],
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
          data: series.map((s) => ({ name: s.name, value: s.values.map((v) => v ?? 0), itemStyle: { color: s.color }, lineStyle: { color: s.color, width: 2 }, ...(def.radar?.filled ? { areaStyle: { color: s.color, opacity: 0.3 } } : {}) })),
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
      legend: def.legend ? { bottom: 4, textStyle: { color: palette.text }, data: [volume ? series[0]!.name : '', def.title ?? ''].filter(Boolean) } : undefined,
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
      legend: def.legend ? { bottom: 4, textStyle: { color: palette.text }, type: 'scroll', data: [...series.map((s) => s.name), ...trends.names] } : undefined,
      tooltip: { trigger: 'item', confine: true },
      graphic: trendGraphic(trends.labels, palette, def.title ? 40 : 14),
      xAxis: { ...valueAxis(def.axisX, palette, { scale: true, grid: false }), position: undefined, nameGap: 28 },
      yAxis: hasSecondary ? [valueAxis(def.axisY, palette, { scale: true }), valueAxis(def.axisY2, palette, { opposite: true, scale: true, grid: false })] : valueAxis(def.axisY, palette, { scale: true }),
      series: [
        ...series.map((s) => ({
          type: 'scatter',
          name: s.name,
          symbolSize: 8,
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
  const catAxis = { type: 'category', data: categories, name: def.axisX?.title, nameLocation: 'middle', nameGap: 30, inverse: horizontal !== !!def.axisX?.reverse, ...axisBase(palette), splitLine: { show: !!def.axisX?.gridlines, lineStyle: { color: palette.grid } } };
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
          legend: def.legend ? { bottom: 4, textStyle: { color: palette.text }, type: 'scroll', data: [...series.map((s) => s.name), ...trends.names] } : undefined,
          tooltip: axisTooltip(),
          graphic: trendGraphic(trends.labels, palette, def.title ? 40 : 14),
        }
      : {}),
    series: [...series.map((s) => {
      const data = percent && s.type !== 'line' ? s.values.map((v, i) => (v === null ? null : Math.round((v / totals[i]!) * 10000) / 100)) : s.values;
      const common = { name: s.name, data, yAxisIndex: s.secondary && !horizontal ? 1 : 0, itemStyle: { color: s.color } };
      switch (s.type) {
        case 'column':
          return { ...common, type: 'bar', barMaxWidth: 48, ...(def.stacked ? { stack: s.secondary ? 'secondary' : 'total' } : {}) };
        case 'area':
          return { ...common, type: 'line', smooth: !!def.smooth, symbol: 'none', areaStyle: { opacity: 0.35, color: s.color }, lineStyle: { color: s.color }, ...(def.stacked ? { stack: s.secondary ? 'secondary' : 'total' } : {}) };
        case 'scatter':
          return { ...common, type: 'scatter', symbolSize: 8 };
        default:
          return { ...common, type: 'line', smooth: !!def.smooth, symbolSize: 6, showSymbol: n < 40, lineStyle: { color: s.color }, ...(def.stacked && def.type === 'line' ? { stack: s.secondary ? 'secondary' : 'total' } : {}) };
      }
    }), ...trends.series, ...bars],
  };
  return out;
}
