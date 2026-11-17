import { describe, expect, it } from 'vitest';
import { chartClipHtml, chartFromHtml, gridToTsv, sampleGrid, specFromGrid, standaloneChart, type ChartData } from './index';

describe('gráfico en el portapapeles', () => {
  it('el HTML lleva el gráfico entero y una tabla con los datos, y se vuelve a leer igual', () => {
    const grid = sampleGrid();
    const chart = specFromGrid('column', grid, { title: 'Ventas', legend: true, legendPos: 'r' });
    chart.series[0]!.color = '#c00000';
    chart.series[0]!.points = [{ idx: 1, color: '#00b050' }];
    const html = chartClipHtml({ chart, grid });
    expect(html).toContain('<table');
    expect(html).toContain('<td>Categoría 1</td>');
    expect(html).toContain('<td>4.3</td>');
    const back = chartFromHtml(`<html><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`)!;
    expect(back.chart.title).toBe('Ventas');
    expect(back.chart.legendPos).toBe('r');
    expect(back.chart.series[0]!.points).toEqual([{ idx: 1, color: '#00b050' }]);
    expect(back.grid).toEqual(grid);
  });

  it('un HTML sin gráfico, o roto, no es un gráfico', () => {
    expect(chartFromHtml('<p>hola</p>')).toBeNull();
    expect(chartFromHtml(undefined)).toBeNull();
    expect(chartFromHtml('<table data-nova-chart="%7Bno">')).toBeNull();
  });

  it('la rejilla va como texto con tabuladores', () => {
    expect(gridToTsv([['', 'A'], ['x', 1.5], ['y', null]])).toBe('\tA\nx\t1.5\ny\t');
  });

  it('un gráfico con datos de una hoja se lleva con su propia rejilla y su formato', () => {
    const data: ChartData = {
      categories: ['Ene', 'Feb'],
      series: [
        { name: 'Ventas', values: [10, 14], x: [], labels: ['Ene', 'Feb'], type: 'column', secondary: false, color: '#3b82c4' },
        { name: 'Gastos', values: [4, 6], x: [], labels: ['Ene', 'Feb'], type: 'column', secondary: false, color: '#e8833a' },
      ],
    };
    const def = { type: 'column' as const, legend: true, title: 'Resultados', series: [{ values: 'Hoja1!$B$2:$B$3', nameRef: 'Hoja1!$B$1', color: '#ff0000', transparency: 20 }, { values: 'Hoja1!$C$2:$C$3', nameRef: 'Hoja1!$C$1' }], id: 'c1', x: 5, y: 5, width: 400, height: 300, rawXml: '<x/>' };
    const clip = standaloneChart(def, data);
    expect(clip.grid).toEqual([['', 'Ventas', 'Gastos'], ['Ene', 10, 4], ['Feb', 14, 6]]);
    expect(clip.chart.series[0]!.values).toBe('Sheet1!$B$2:$B$3');
    expect(clip.chart.series[0]).toMatchObject({ color: '#ff0000', transparency: 20 });
    expect(clip.chart.title).toBe('Resultados');
    expect(JSON.stringify(clip.chart)).not.toContain('rawXml');
    expect(chartFromHtml(chartClipHtml(clip))!.chart.series.length).toBe(2);
  });
});
