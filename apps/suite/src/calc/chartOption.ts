import { formatValue, isErr, resolveRangeText, type ChartAxis, type ChartDef, type FormulaLocale, type Scalar, type SeriesType, type Workbook } from '@suitenova/calc-engine';

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
}

/** The numbers and labels behind a chart, read from the workbook. */
export function chartData(def: ChartDef, wb: Workbook, sheetId: number, locale: FormulaLocale): { categories: string[]; series: ChartSeriesData[] } {
  const series = def.series.map((s, i) => {
    const vals = readRange(wb, s.values, sheetId, locale);
    const cats = readRange(wb, s.categories, sheetId, locale);
    const nameCell = s.nameRef ? readRange(wb, s.nameRef, sheetId, locale).labels[0] : undefined;
    const type: SeriesType = s.type ?? (def.type === 'bar' || def.type === 'column' ? 'column' : def.type === 'area' ? 'area' : def.type === 'scatter' ? 'scatter' : 'line');
    return {
      name: s.name ?? (nameCell || `${locale === 'es' ? 'Serie' : 'Series'} ${i + 1}`),
      values: vals.values.map((v) => (isErr(v) ? null : num(v))),
      x: cats.values.map(num),
      labels: cats.labels,
      type,
      secondary: !!s.secondary,
      color: s.color ?? CHART_COLORS[i % CHART_COLORS.length]!,
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
    return {
      ...base,
      xAxis: { ...valueAxis(def.axisX, palette, { scale: true, grid: false }), position: undefined, nameGap: 28 },
      yAxis: hasSecondary ? [valueAxis(def.axisY, palette, { scale: true }), valueAxis(def.axisY2, palette, { opposite: true, scale: true, grid: false })] : valueAxis(def.axisY, palette, { scale: true }),
      series: series.map((s) => ({
        type: 'scatter',
        name: s.name,
        symbolSize: 8,
        yAxisIndex: s.secondary ? 1 : 0,
        data: s.values.map((y, i) => [s.x[i] ?? i + 1, y]).filter((p) => p[0] !== null && p[1] !== null),
      })),
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
  const out: Record<string, unknown> = {
    ...base,
    xAxis: horizontal ? primary : catAxis,
    yAxis: horizontal ? catAxis : yAxis,
    series: series.map((s) => {
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
    }),
  };
  return out;
}
