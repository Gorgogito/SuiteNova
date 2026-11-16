import { sampleGrid } from '@suitenova/chart-core';
import { describe, expect, it } from 'vitest';
import { buildChart, cellsToGrid, draftOf, gridToCells } from './draft';
import { specFromGrid } from '@suitenova/chart-core';

describe('borrador de gráfico', () => {
  it('la rejilla de texto vuelve a ser la rejilla (números donde hay números)', () => {
    const g = sampleGrid();
    expect(cellsToGrid(gridToCells(g)).slice(1)).toEqual(g.slice(1));
    expect(cellsToGrid([['', 'A'], ['x', '1,5'], ['y', '']])).toEqual([[null, 'A'], ['x', 1.5], ['y', null]]);
  });

  it('un borrador se convierte en gráfico con sus series, y recuerda el formato de las series que ya había', () => {
    const grid = sampleGrid();
    const base = { ...specFromGrid('column', grid), series: specFromGrid('column', grid).series.map((s, i) => ({ ...s, color: i ? '#00ff00' : '#ff0000' })) };
    const d = { ...draftOf(base, grid), preset: 'line', title: 'Ventas' };
    const out = buildChart(d, base);
    expect(typeof out).not.toBe('string');
    const { spec } = out as Exclude<typeof out, string>;
    expect(spec.type).toBe('line');
    expect(spec.title).toBe('Ventas');
    expect(spec.series.map((s) => s.color)).toEqual(['#ff0000', '#00ff00']);
  });

  it('quita las filas y series vacías del final, y avisa cuando los datos no sirven para el tipo', () => {
    const d = draftOf(specFromGrid('column', sampleGrid()), sampleGrid());
    d.cells = [...d.cells, ['', '', '']].map((r) => [...r, '']);
    const ok = buildChart(d) as Exclude<ReturnType<typeof buildChart>, string>;
    expect(ok.grid.length).toBe(5);
    expect(ok.grid[0]!.length).toBe(3);
    const one = { ...d, preset: 'stockHLC' };
    expect(typeof buildChart(one)).toBe('string');
  });
});
