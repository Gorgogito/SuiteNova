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

describe('formato de serie y de punto en el dibujo', () => {
  type Ser = Record<string, unknown>;
  const sers = (s: ChartSpec) => (chartOption(s, data, 'es', palette) as unknown as { series: Ser[] }).series;

  it('relleno con transparencia, borde y color por punto en columnas', () => {
    const o = sers(spec({ series: [{ values: 'A', color: '#ff0000', transparency: 50, line: { color: '#00ff00', width: 3, dash: 'dash' }, points: [{ idx: 1, color: '#0000ff' }] }, { values: 'B', noFill: true }] }));
    expect(o[0]!.itemStyle).toMatchObject({ color: 'rgba(59,130,196,0.5)', borderColor: '#00ff00', borderWidth: 4, borderType: 'dashed' });
    expect((o[0]!.data as unknown[])[1]).toMatchObject({ value: 20, itemStyle: { color: 'rgba(0,0,255,0.5)', borderColor: '#00ff00' } });
    expect(o[1]!.itemStyle).toMatchObject({ color: 'rgba(0,0,0,0)' });
  });

  it('ancho del hueco y superposición de Excel como separaciones de ECharts', () => {
    const o = sers(spec({ gapWidth: 100, overlap: 100 }));
    expect(o[0]).toMatchObject({ barGap: '-100%', barCategoryGap: '50%' });
    expect(o[0]!.barMaxWidth).toBeUndefined();
    expect(sers(spec())[0]!.barMaxWidth).toBe(48);
  });

  it('líneas: grosor, guiones y marcadores; circular: sectores sacados y agujero', () => {
    const lineData: ChartData = { ...data, series: data.series.map((s) => ({ ...s, type: 'line' as const })) };
    const o = (chartOption(spec({ type: 'line', series: [{ values: 'A', line: { width: 3, dash: 'dot' }, marker: { symbol: 'diamond', size: 9 } }, { values: 'B', marker: { symbol: 'none' } }] }), lineData, 'es', palette) as unknown as { series: Ser[] }).series;
    expect(o[0]).toMatchObject({ lineStyle: { width: 4, type: 'dotted' }, symbol: 'diamond', symbolSize: 12 });
    expect(o[1]).toMatchObject({ symbol: 'none', showSymbol: false });
    const ring = chartOption(spec({ type: 'doughnut', holeSize: 70, firstSliceAng: 90, series: [{ values: 'A', explosion: 20 }] }), data, 'es', palette) as unknown as { series: { radius: string[]; startAngle: number; data: { selected?: boolean }[] }[] };
    expect(ring.series[0]!.radius[0]).toBe('48%');
    expect(ring.series[0]!.startAngle).toBe(0);
    expect(ring.series[0]!.data.every((d) => d.selected)).toBe(true);
  });
});

describe('áreas y fuentes en el dibujo', () => {
  type Opt = { backgroundColor: string; textStyle?: Record<string, unknown>; title?: { textStyle: Record<string, unknown> }; legend?: { textStyle: Record<string, unknown> }; grid: Record<string, unknown>; yAxis: { axisLabel: Record<string, unknown>; nameTextStyle: Record<string, unknown> }; series: { label?: Record<string, unknown> }[] };
  const opt = (s: ChartSpec) => chartOption(s, data, 'es', palette) as unknown as Opt;

  it('el relleno del área del gráfico y el del área de trazado', () => {
    const o = opt(spec({ chartArea: { fill: '#f2f2f2' }, plotArea: { fill: '#ffffff', line: { color: '#ff0000', width: 1.5 } } }));
    expect(o.backgroundColor).toBe('#f2f2f2');
    expect(o.grid).toMatchObject({ show: true, backgroundColor: '#ffffff', borderColor: '#ff0000', borderWidth: 2 });
    expect(opt(spec()).backgroundColor).toBe('#ffffff');
    expect(opt(spec({ chartArea: { noFill: true } })).backgroundColor).toBe('rgba(0,0,0,0)');
  });

  it('las fuentes: la del gráfico es la base y cada parte la cambia', () => {
    const o = opt(spec({ fonts: { chart: { family: 'Arial', size: 9, color: '#404040' }, title: { size: 20, bold: true }, legend: { italic: true }, axis: { size: 7 }, labels: { color: '#0000ff' } }, series: [{ values: 'A', labels: { value: true } }, { values: 'B' }] }));
    expect(o.title!.textStyle).toMatchObject({ fontSize: 26.7, fontWeight: 700 });
    expect(o.legend!.textStyle).toMatchObject({ fontStyle: 'italic', color: '#404040' });
    expect(String(o.legend!.textStyle.fontFamily)).toContain('Arial');
    expect(o.yAxis.axisLabel).toMatchObject({ fontSize: 9.3 });
    expect(o.series[0]!.label).toMatchObject({ color: '#0000ff' });
  });

  it('el borde del área del gráfico se dibuja sobre la imagen', () => {
    const svg = chartSvg(spec({ chartArea: { line: { color: '#123456', width: 2 } } }), data, 'es', palette, 400, 240);
    expect(svg).toContain('stroke="#123456"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});
