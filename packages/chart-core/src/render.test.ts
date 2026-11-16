import { describe, expect, it } from 'vitest';
import { chartOption, chartSvg, formatChartNumber, is3D, setChartNumberFormatter, type ChartData, type ChartPalette, type ChartSpec } from './index';

const palette: ChartPalette = { text: '#222222', grid: '#dddddd', bg: '#ffffff' };
const data: ChartData = {
  categories: ['T1', 'T2', 'T3'],
  series: [
    { name: 'Ventas', values: [10, 20, 15], x: [], labels: ['T1', 'T2', 'T3'], type: 'column', secondary: false, color: '#3b82c4' },
    { name: 'Gastos', values: [5, 8, 7], x: [], labels: ['T1', 'T2', 'T3'], type: 'column', secondary: false, color: '#e8833a' },
  ],
};
const spec = (over: Partial<ChartSpec> = {}): ChartSpec => ({ type: 'column', legend: true, title: 'Resultados', series: [{ values: 'A' }, { values: 'B' }], ...over });

describe('chart-core sin libro de cálculo', () => {
  it('construye la opción de echarts desde datos literales', () => {
    const o = chartOption(spec(), data, 'es', palette) as { series: { type: string; name: string; data: unknown[] }[]; xAxis: { data: string[] } };
    expect(o.series).toHaveLength(2);
    expect(o.series[0]).toMatchObject({ type: 'bar', name: 'Ventas' });
    expect(o.xAxis.data).toEqual(['T1', 'T2', 'T3']);
  });

  it('dibuja un SVG estático de cualquier tipo, también 3D y circular', () => {
    for (const s of [spec(), spec({ type: 'pie' }), spec({ type: 'line', smooth: true }), spec({ threeD: { rotX: 15, rotY: 20, perspective: 30, depth: 100, rightAngle: true } })]) {
      const svg = chartSvg(s, data, 'es', palette, 480, 300);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.length).toBeGreaterThan(500);
    }
    expect(is3D(spec({ type: 'surface' }))).toBe(true);
    expect(is3D(spec())).toBe(false);
  });

  it('el formato de números lo pone cada producto', () => {
    expect(formatChartNumber(1.23456789012345)).toBe('1.2345678901');
    setChartNumberFormatter((v, f) => `${f ?? 'g'}:${v}`);
    expect(formatChartNumber(3, '0.00')).toBe('0.00:3');
    setChartNumberFormatter();
    expect(formatChartNumber(3)).toBe('3');
  });
});
