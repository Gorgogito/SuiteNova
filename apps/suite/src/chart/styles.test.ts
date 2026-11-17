import { describe, expect, it } from 'vitest';
import { sampleGrid, specFromGrid, type ChartSpec } from '@suitenova/chart-core';
import { CHART_STYLES, COLOR_PALETTES, applyPalette, applyStyle, paletteColors, paletteOf } from './styles';

const col = (): ChartSpec => specFromGrid('column', sampleGrid(), { title: 'Ventas', legend: true });

describe('colores y estilos del gráfico', () => {
  it('un juego colorido da un color por serie y las monocromáticas, tonos del mismo color', () => {
    expect(paletteColors('colorful1', 3)).toEqual(['#4472c4', '#ed7d31', '#a5a5a5']);
    const mono = paletteColors('mono1', 4);
    expect(new Set(mono).size).toBe(4);
    expect(mono[0]!.localeCompare(mono[3]!)).not.toBe(0);
    expect(COLOR_PALETTES.length).toBe(10);
  });

  it('aplicar un juego pone el color de cada serie y se reconoce después', () => {
    const c = applyPalette(col(), 'colorful2', 4);
    expect(c.series.map((s) => s.color)).toEqual(['#ed7d31', '#ffc000']);
    expect(paletteOf(c, 4)).toBe('colorful2');
    expect(paletteOf(col(), 4)).toBeNull();
  });

  it('en un circular el juego se aplica a los sectores', () => {
    const pie = specFromGrid('pie', sampleGrid(), { legend: true });
    const c = applyPalette(pie, 'colorful1', 4);
    expect(c.series[0]!.points!.map((p) => p.color)).toEqual(['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000']);
    expect(paletteOf(c, 4)).toBe('colorful1');
  });

  it('los estilos rápidos cambian el aspecto sin tocar los datos, y el 1 lo deja como al principio', () => {
    const base = { ...col(), chartArea: { fill: '#000000' }, fonts: { chart: { size: 20 } } };
    const dark = applyStyle(col(), 'style5');
    expect(dark.chartArea?.fill).toBe('#262626');
    expect(dark.fonts?.chart?.color).toBe('#f2f2f2');
    expect(dark.series.length).toBe(2);
    expect(dark.title).toBe('Ventas');
    const back = applyStyle(base, 'style1');
    expect(back.chartArea).toBeUndefined();
    expect(back.fonts).toBeUndefined();
    expect(applyStyle(col(), 'style2').series.every((s) => s.labels?.value)).toBe(true);
    expect(applyStyle(col(), 'style4').gapWidth).toBe(50);
    expect(CHART_STYLES.length).toBe(8);
  });
});
