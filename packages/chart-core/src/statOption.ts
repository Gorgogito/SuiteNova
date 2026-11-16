/** Opciones de ECharts para los gráficos de Excel 2016: cascada, embudo, histograma y cajas y bigotes. */
import { formatChartNumber } from './format';
import { boxStats, histogramBins, waterfallSteps } from './stat';
import type { ChartSpec } from './model';
import type { ChartLocale, ChartPalette, ChartSeriesData } from './data';

type Option = Record<string, unknown>;

const fmt = (v: number): string => formatChartNumber(v);
const TEXT = { es: { inc: 'Aumento', dec: 'Disminución', total: 'Total', count: 'Frecuencia', mean: 'Media' }, en: { inc: 'Increase', dec: 'Decrease', total: 'Total', count: 'Count', mean: 'Mean' } };

const axis = (p: ChartPalette) => ({ axisLine: { lineStyle: { color: p.grid } }, axisLabel: { color: p.text }, nameTextStyle: { color: p.text } });
const valueAxis = (p: ChartPalette, extra: Option = {}): Option => ({ type: 'value', ...axis(p), axisLine: { show: false }, splitLine: { lineStyle: { color: p.grid } }, ...extra });

/** Gráfico en cascada: barras flotantes con conectores y rótulos de valor. */
function waterfall(def: ChartSpec, categories: string[], series: ChartSeriesData[], base: Option, p: ChartPalette, loc: ChartLocale): Option {
  const tx = TEXT[loc];
  const s = series[0];
  const steps = waterfallSteps(s?.values ?? [], def.waterfall?.totals ?? []);
  const colors = { increase: '#3b82c4', decrease: '#e8833a', total: '#7a8b99' };
  const connectors = def.waterfall?.connectors !== false;
  const data = steps.map((st, i) => ({ value: [i, st.start, st.end, st.value, st.kind], itemStyle: { color: colors[st.kind] } }));
  return {
    ...base,
    color: [colors.increase, colors.decrease, colors.total],
    legend: def.legend ? { bottom: 4, textStyle: { color: p.text }, data: [tx.inc, tx.dec, tx.total] } : undefined,
    tooltip: { trigger: 'item', confine: true, formatter: (q: { value?: unknown[]; name?: string }) => (Array.isArray(q.value) ? `${categories[q.value[0] as number] ?? ''}<br/><b>${fmt(q.value[3] as number)}</b>` : '') },
    xAxis: { type: 'category', data: categories, name: def.axisX?.title, nameLocation: 'middle', nameGap: 30, ...axis(p) },
    yAxis: valueAxis(p, { name: def.axisY?.title, scale: false, min: def.axisY?.min, max: def.axisY?.max }),
    series: [
      // series vacías: solo dan los colores de la leyenda
      { type: 'bar', name: tx.inc, data: [], itemStyle: { color: colors.increase } },
      { type: 'bar', name: tx.dec, data: [], itemStyle: { color: colors.decrease } },
      { type: 'bar', name: tx.total, data: [], itemStyle: { color: colors.total } },
      {
        type: 'custom',
        silent: false,
        name: s?.name,
        encode: { x: 0, y: [1, 2] },
        data,
        renderItem: (_params: unknown, api: Record<string, (...a: unknown[]) => unknown>) => {
          const v = api.value as (i: number) => number;
          const i = v(0);
          const a = api.coord!([i, v(1)]) as [number, number];
          const b = api.coord!([i, v(2)]) as [number, number];
          const w = ((api.size as (x: number[]) => number[])([1, 0])[0] ?? 40) * 0.62;
          const top = Math.min(a[1], b[1]);
          const height = Math.max(1, Math.abs(b[1] - a[1]));
          const st = steps[i];
          const children: Record<string, unknown>[] = [{ type: 'rect', shape: { x: a[0] - w / 2, y: top, width: w, height }, style: (api.style as () => Record<string, unknown>)() }];
          const next = steps[i + 1];
          if (connectors && next) {
            const nx = api.coord!([i + 1, 0]) as [number, number];
            children.push({ type: 'line', shape: { x1: a[0] + w / 2, y1: b[1], x2: nx[0] - w / 2, y2: b[1] }, style: { stroke: p.grid, lineWidth: 1, lineDash: [3, 3] } });
          }
          const up = st ? st.end >= st.start : true;
          children.push({ type: 'text', style: { text: st ? (st.kind === 'total' ? fmt(st.value) : `${st.value > 0 ? '+' : ''}${fmt(st.value)}`) : '', x: a[0], y: up ? top - 4 : top + height + 12, textAlign: 'center', fill: p.text, font: '11px sans-serif' } });
          return { type: 'group', children };
        },
      },
    ],
  };
}

/** Embudo: barras horizontales centradas, de mayor a menor en el orden de los datos. */
function funnel(def: ChartSpec, categories: string[], series: ChartSeriesData[], base: Option, p: ChartPalette): Option {
  const s = series[0];
  const values = (s?.values ?? []).map((v) => (v === null || v < 0 ? 0 : v));
  const max = Math.max(1, ...values);
  const color = s?.color ?? '#3b82c4';
  return {
    ...base,
    color: [color],
    legend: undefined,
    tooltip: { trigger: 'item', confine: true, formatter: (q: { seriesName?: string; name?: string; value?: number }) => (q.seriesName === 'pad' ? '' : `${q.name ?? ''}<br/><b>${fmt(Number(q.value ?? 0))}</b>`) },
    grid: { left: 16, right: 16, top: def.title ? 44 : 16, bottom: 16, containLabel: true },
    xAxis: { type: 'value', show: false, max },
    yAxis: { type: 'category', data: categories, inverse: true, ...axis(p), axisLine: { show: false }, axisTick: { show: false } },
    series: [
      { type: 'bar', name: 'pad', stack: 'funnel', silent: true, itemStyle: { color: 'transparent' }, data: values.map((v) => (max - v) / 2) },
      { type: 'bar', name: s?.name ?? '', stack: 'funnel', barCategoryGap: '8%', itemStyle: { color }, label: { show: true, position: 'inside', color: '#ffffff', formatter: (q: { value?: number }) => fmt(Number(q.value ?? 0)) }, data: values },
    ],
  };
}

/** Histograma: recuento de valores por clase. */
function histogram(def: ChartSpec, series: ChartSeriesData[], base: Option, p: ChartPalette, loc: ChartLocale): Option {
  const s = series[0];
  const values = (s?.values ?? []).filter((v): v is number => v !== null);
  const bins = histogramBins(values, def.histogram);
  const color = s?.color ?? '#3b82c4';
  return {
    ...base,
    color: [color],
    legend: undefined,
    tooltip: { trigger: 'axis', confine: true },
    xAxis: { type: 'category', data: bins.map((b) => b.label), name: def.axisX?.title, nameLocation: 'middle', nameGap: 34, ...axis(p) },
    yAxis: valueAxis(p, { name: def.axisY?.title ?? TEXT[loc].count, nameLocation: 'middle', nameGap: 36, minInterval: 1 }),
    series: [{ type: 'bar', name: TEXT[loc].count, data: bins.map((b) => b.count), barCategoryGap: '4%', itemStyle: { color }, label: { show: bins.length <= 24, position: 'top', color: p.text } }],
  };
}

/** Cajas y bigotes: una caja por categoría (o por serie si no hay categorías), con media, atípicos y puntos. */
function boxWhisker(def: ChartSpec, series: ChartSeriesData[], base: Option, p: ChartPalette, loc: ChartLocale): Option {
  const o = def.boxwhisker ?? {};
  const inclusive = !!o.inclusive;
  const showMean = o.mean !== false;
  const showOut = o.outliers !== false;
  const showInner = !!o.inner;
  const grouped = series.some((s) => new Set(s.labels).size > 1 && s.labels.length === s.values.length);
  const cats: string[] = [];
  const cells: { cat: number; si: number; values: number[] }[] = [];
  if (grouped) {
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const label = s.labels[i] ?? '';
        if (v === null) return;
        let c = cats.indexOf(label);
        if (c < 0) {
          cats.push(label);
          c = cats.length - 1;
        }
        let cell = cells.find((x) => x.cat === c && x.si === si);
        if (!cell) {
          cell = { cat: c, si, values: [] };
          cells.push(cell);
        }
        cell.values.push(v);
      });
    });
  } else {
    series.forEach((s, si) => {
      cats.push(s.name);
      cells.push({ cat: si, si, values: s.values.filter((v): v is number => v !== null) });
    });
  }
  const out: Option[] = [];
  const nSeries = grouped ? series.length : 1;
  for (let si = 0; si < nSeries; si++) {
    const stats = cats.map((_c, ci) => {
      const cell = cells.find((x) => x.cat === ci && (grouped ? x.si === si : true));
      return cell ? boxStats(cell.values, inclusive) : null;
    });
    const color = grouped ? series[si]!.color : series[0]!.color;
    out.push({
      type: 'boxplot',
      name: grouped ? series[si]!.name : series[0]?.name,
      data: stats.map((s, ci) => (s ? { value: [s.lowWhisker, s.q1, s.median, s.q3, s.highWhisker], itemStyle: { color: `${grouped ? color : (series[ci]?.color ?? color)}55`, borderColor: grouped ? color : (series[ci]?.color ?? color) } } : { value: [] })),
      tooltip: { formatter: (q: { name?: string; value?: number[] }) => (q.value && q.value.length >= 6 ? `${q.name ?? ''}<br/>${[['max', 5], ['Q3', 4], ['med', 3], ['Q1', 2], ['min', 1]].map(([l, k]) => `${l}: <b>${fmt(q.value![k as number]!)}</b>`).join('<br/>')}` : '') },
    });
    const pt = (pick: (s: NonNullable<(typeof stats)[number]>, ci: number) => number[]) => stats.flatMap((s, ci) => (s ? pick(s, ci).map((y) => [ci, y]) : []));
    if (showOut) out.push({ type: 'scatter', name: `${series[si]?.name ?? ''}`, symbolSize: 6, itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.4 }, silent: true, data: pt((s) => s.outliers) });
    if (showMean) out.push({ type: 'scatter', name: TEXT[loc].mean, symbol: 'path://M0,0L10,10M10,0L0,10', symbolSize: 8, itemStyle: { color: 'transparent', borderColor: color, borderWidth: 1.6 }, silent: true, data: pt((s) => [s.mean]) });
    if (showInner) {
      const jit = (i: number) => ((i * 37) % 11) / 11 - 0.5;
      out.push({ type: 'scatter', symbolSize: 4, itemStyle: { color, opacity: 0.5 }, silent: true, data: cells.filter((c) => (grouped ? c.si === si : true)).flatMap((c) => c.values.map((y, i) => [c.cat + jit(i) * 0.3, y])) });
    }
  }
  return {
    ...base,
    legend: undefined,
    tooltip: { trigger: 'item', confine: true },
    xAxis: { type: 'category', data: cats, name: def.axisX?.title, nameLocation: 'middle', nameGap: 30, ...axis(p) },
    yAxis: valueAxis(p, { name: def.axisY?.title, scale: true, min: def.axisY?.min, max: def.axisY?.max }),
    series: out,
  };
}

/** Option for the four statistical chart kinds, or null when the chart is another kind. */
export function statChartOption(def: ChartSpec, categories: string[], series: ChartSeriesData[], base: Option, palette: ChartPalette, locale: ChartLocale): Option | null {
  switch (def.type) {
    case 'waterfall':
      return waterfall(def, categories, series, base, palette, locale);
    case 'funnel':
      return funnel(def, categories, series, base, palette);
    case 'histogram':
      return histogram(def, series, base, palette, locale);
    case 'boxwhisker':
      return boxWhisker(def, series, base, palette, locale);
    default:
      return null;
  }
}
