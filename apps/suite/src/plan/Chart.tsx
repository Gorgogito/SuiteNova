import { t } from '@suitenova/core-ui';
import type { ChartSpec } from '@suitenova/plan-core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useMemo, useRef } from 'react';

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Turn a chart description of plan-core into an ECharts option. Series colours may be overridden per point. */
export interface ChartExtra {
  /** Colour of single points, per series. */
  colors?: (string | undefined)[][];
  markLine?: number;
  /** A line drawn over the bars (a capacity, for example). */
  line?: { name: string; data: number[]; color: string };
}

export function chartOption(spec: ChartSpec, extra?: ChartExtra): echarts.EChartsCoreOption {
  const text = dark() ? '#e0e0e0' : '#333333';
  const grid = dark() ? '#444444' : '#dddddd';
  const base = { animation: false, textStyle: { color: text }, title: { text: t(spec.title), left: 'center', textStyle: { color: text, fontSize: 13 } }, tooltip: { trigger: spec.kind === 'pie' ? 'item' : 'axis' } };
  if (spec.kind === 'pie') {
    return {
      ...base,
      legend: { bottom: 0, textStyle: { color: text } },
      series: [{ type: 'pie', radius: ['32%', '58%'], center: ['50%', '56%'], label: { color: text, formatter: '{b}: {c}' }, data: spec.categories.map((c, i) => ({ name: t(c), value: spec.series[0]?.data[i] ?? 0 })) }],
    };
  }
  const stacked = spec.kind === 'stack';
  return {
    ...base,
    legend: { bottom: 0, textStyle: { color: text } },
    grid: { left: 52, right: 18, top: 38, bottom: 52, containLabel: true },
    xAxis: { type: 'category', data: spec.categories.map((c) => c), axisLabel: { color: text, hideOverlap: true }, axisLine: { lineStyle: { color: grid } } },
    yAxis: { type: 'value', name: spec.unit ?? '', ...(spec.unit === '%' ? { min: 0, max: 100 } : {}), nameTextStyle: { color: text }, axisLabel: { color: text }, splitLine: { lineStyle: { color: grid } } },
    series: [...spec.series.map((s, k) => ({
      name: t(s.name),
      type: spec.kind === 'line' || spec.kind === 'area' ? 'line' : 'bar',
      stack: stacked ? 'a' : undefined,
      areaStyle: spec.kind === 'area' ? { opacity: 0.25 } : undefined,
      smooth: false,
      showSymbol: spec.categories.length < 40,
      connectNulls: false,
      color: s.color,
      itemStyle: s.color ? { color: s.color } : undefined,
      data: s.data.map((v, i) => {
        const c = extra?.colors?.[k]?.[i];
        return c && v !== null ? { value: v, itemStyle: { color: c } } : v;
      }),
      markLine: k === 0 && extra?.markLine !== undefined ? { silent: true, symbol: 'none', lineStyle: { color: '#c0392b', type: 'dashed' }, data: [{ yAxis: extra.markLine }] } : undefined,
    })),
    ...(extra?.line ? [{ name: t(extra.line.name), type: 'line', step: 'end', showSymbol: false, color: extra.line.color, lineStyle: { color: extra.line.color, width: 2 }, data: extra.line.data }] : []),
    ],
  };
}

export function Chart({ spec, height = 280, extra }: { spec: ChartSpec; height?: number; extra?: ChartExtra }) {
  const host = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  const option = useMemo(() => chartOption(spec, extra), [spec, extra]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const c = echarts.init(el, undefined, { renderer: 'canvas' });
    inst.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      inst.current = null;
    };
  }, []);
  useEffect(() => {
    inst.current?.setOption(option, true);
  }, [option]);
  const summary = `${t(spec.title)}: ${spec.series.map((s) => t(s.name)).join(', ')}`;
  return <div ref={host} className="pl-chartbox" style={{ height }} role="img" aria-label={summary} data-chart={spec.id} />;
}
