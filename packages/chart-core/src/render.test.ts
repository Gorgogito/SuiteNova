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

describe('elementos del gráfico', () => {
  type Opt = { legend?: Record<string, unknown>; grid: Record<string, number | boolean>; series: Record<string, unknown>[]; yAxis: Record<string, unknown>; xAxis: Record<string, unknown> };
  const opt = (s: ChartSpec) => chartOption(s, data, 'es', palette) as unknown as Opt;

  it('la leyenda va donde se pide y deja sitio al trazado', () => {
    expect(opt(spec()).legend).toMatchObject({ bottom: 4 });
    expect(opt(spec({ legendPos: 't' })).legend).toMatchObject({ top: 30 });
    expect(opt(spec({ legendPos: 'r' })).legend).toMatchObject({ right: 6, orient: 'vertical' });
    expect(opt(spec({ legendPos: 'r' })).grid.right).toBeGreaterThan(opt(spec()).grid.right as number);
    expect(opt(spec({ legendPos: 'l' })).grid.left).toBeGreaterThan(opt(spec()).grid.left as number);
    expect(opt(spec({ legend: false })).legend).toBeUndefined();
  });

  it('las etiquetas de datos salen por serie, con su posición y su texto', () => {
    const o = opt(spec({ series: [{ values: 'A', labels: { value: true, pos: 'inEnd' } }, { values: 'B', labels: { value: true, category: true, separator: ' - ' } }] }));
    expect(o.series[0]!.label).toMatchObject({ show: true, position: 'insideTop', formatter: '{c}' });
    expect(o.series[1]!.label).toMatchObject({ show: true, position: 'top', formatter: '{b} - {c}' });
    expect(opt(spec()).series[0]!.label).toEqual({ show: false });
    const pie = chartOption(spec({ type: 'pie', series: [{ values: 'A', labels: { percent: true, category: true, pos: 'outEnd' } }] }), data, 'es', palette) as unknown as Opt;
    expect(pie.series[0]!.label).toMatchObject({ show: true, position: 'outside', formatter: '{b}, {d}%' });
  });

  it('las cuadrículas menores y los ejes ocultos', () => {
    const o = opt(spec({ axisY: { minorGridlines: true } }));
    expect(o.yAxis.minorSplitLine).toMatchObject({ show: true });
    expect(opt(spec({ axisY: { hidden: true } })).yAxis.show).toBe(false);
  });

  it('la tabla de datos dibuja los nombres y los valores bajo el trazado', () => {
    const svg = chartSvg(spec({ dataTable: { keys: true } }), data, 'es', palette, 600, 360);
    expect(svg).toContain('Ventas');
    expect(svg).toContain('Gastos');
    expect(svg).toContain('>20<');
    expect(opt(spec({ dataTable: {} })).series.some((x) => x.type === 'custom')).toBe(true);
    expect(opt(spec({ type: 'bar', dataTable: {} })).series.some((x) => x.type === 'custom')).toBe(false);
  });
});
