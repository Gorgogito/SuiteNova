import { BarChart, BoxplotChart, CandlestickChart, CustomChart, LineChart, PieChart, RadarChart, ScatterChart } from 'echarts/charts';
import { GraphicComponent, GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { chart3dSvg } from './chart3d';
import type { ChartData, ChartLocale, ChartPalette } from './data';
import { DEFAULT_3D, type ChartSpec } from './model';
import { chartOption } from './option';

echarts.use([BarChart, BoxplotChart, LineChart, PieChart, ScatterChart, RadarChart, CandlestickChart, CustomChart, GraphicComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent, RadarComponent, CanvasRenderer, SVGRenderer]);

export { echarts };

/** Charts drawn by the 3-D renderer: every 3-D variant and the surface charts. */
export const is3D = (def: ChartSpec): boolean => !!def.threeD || def.type === 'surface';

/** The 3-D picture of a chart as SVG text. */
export function chart3dFor(def: ChartSpec, data: ChartData, palette: ChartPalette, width: number, height: number): string {
  const { categories, series } = data;
  return chart3dSvg({
    type: def.type,
    threeD: def.threeD ?? { ...DEFAULT_3D, rightAngle: false },
    categories,
    series: series.map((s) => ({ name: s.name, values: s.values, color: s.color })),
    title: def.title,
    legend: def.legend,
    stacked: def.stacked,
    percent: def.percent,
    surface: def.surface,
    width: Math.max(120, Math.round(width)),
    height: Math.max(90, Math.round(height)),
    text: palette.text,
    grid: palette.grid,
    bg: palette.bg,
  });
}

/** Any chart as static SVG text (for printing and exporting). */
export function chartSvg(def: ChartSpec, data: ChartData, locale: ChartLocale, palette: ChartPalette, width: number, height: number): string {
  if (is3D(def)) return chart3dFor(def, data, palette, width, height);
  const chart = echarts.init(null as unknown as HTMLElement, undefined, { renderer: 'svg', ssr: true, width: Math.round(width), height: Math.round(height) });
  try {
    chart.setOption(chartOption(def, data, locale, palette), true);
    return (chart as unknown as { renderToSVGString(): string }).renderToSVGString();
  } finally {
    chart.dispose();
  }
}
