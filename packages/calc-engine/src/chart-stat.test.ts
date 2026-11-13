import { describe, expect, it } from 'vitest';
import { boxStats, histogramBins, scottWidth, waterfallSteps } from './chart-stat';

describe('histograma', () => {
  const data = [1, 2, 2, 3, 3, 3, 4, 4, 5, 9];
  it('clases de ancho fijo cerradas por la derecha, con la primera incluyendo el mínimo', () => {
    const b = histogramBins(data, { binWidth: 2 });
    expect(b.map((x) => x.label)).toEqual(['[1, 3]', '(3, 5]', '(5, 7]', '(7, 9]']);
    expect(b.map((x) => x.count)).toEqual([6, 3, 0, 1]);
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(data.length);
  });
  it('por número de clases', () => {
    const b = histogramBins([0, 10, 20, 30, 40], { binCount: 4 });
    expect(b.map((x) => x.count)).toEqual([2, 1, 1, 1]); // [0,10] (10,20] (20,30] (30,40]
    expect(b[0]!.label).toBe('[0, 10]');
  });
  it('cerradas por la izquierda', () => {
    const b = histogramBins([0, 10, 20, 30, 40], { binCount: 4, closed: 'left' });
    expect(b.map((x) => x.count)).toEqual([1, 1, 1, 2]); // [0,10) [10,20) [20,30) [30,40]
    expect(b[3]!.label).toBe('[30, 40]');
  });
  it('clases de desbordamiento y de subdesbordamiento', () => {
    const b = histogramBins(data, { binWidth: 2, underflow: 2, overflow: 6 });
    expect(b[0]).toMatchObject({ label: '≤ 2', count: 3 });
    expect(b[b.length - 1]).toMatchObject({ label: '> 6', count: 1 });
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(data.length);
  });
  it('ancho automático de Scott', () => {
    const v = [2, 4, 4, 4, 5, 5, 7, 9];
    const mean = 5;
    const sd = Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / 7);
    expect(scottWidth(v)).toBeCloseTo((3.49 * sd) / Math.cbrt(8), 10);
    const b = histogramBins(v);
    expect(b.reduce((a, x) => a + x.count, 0)).toBe(v.length);
  });
  it('sin datos o con un solo valor', () => {
    expect(histogramBins([])).toEqual([]);
    expect(histogramBins([5]).map((x) => x.count)).toEqual([1]);
  });
});

describe('cajas y bigotes', () => {
  it('cuartiles con mediana exclusiva e inclusiva', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // n impar
    const ex = boxStats(v, false)!;
    expect([ex.q1, ex.median, ex.q3]).toEqual([2.5, 5, 7.5]); // mitades {1..4} y {6..9}
    const inc = boxStats(v, true)!;
    expect([inc.q1, inc.median, inc.q3]).toEqual([3, 5, 7]); // mitades {1..5} y {5..9}
    const even = boxStats([1, 2, 3, 4, 5, 6, 7, 8], false)!;
    expect([even.q1, even.median, even.q3]).toEqual([2.5, 4.5, 6.5]);
  });
  it('bigotes dentro de 1,5·RIC y valores atípicos', () => {
    const s = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 40])!;
    // Q1 = 3, Q3 = 8, RIC = 5 → vallas −4,5 y 15,5: el 40 es atípico
    expect(s.q1).toBe(3);
    expect(s.q3).toBe(8);
    expect(s.outliers).toEqual([40]);
    expect(s.highWhisker).toBe(9);
    expect(s.lowWhisker).toBe(1);
    expect(s.max).toBe(40);
    expect(s.mean).toBeCloseTo(8.5);
  });
  it('un solo valor y sin valores', () => {
    expect(boxStats([7])).toMatchObject({ q1: 7, median: 7, q3: 7, outliers: [] });
    expect(boxStats([])).toBeNull();
    expect(boxStats([NaN as number, 3, 5])!.n).toBe(2);
  });
});

describe('cascada', () => {
  it('acumula, y los totales parten de cero y fijan el acumulado', () => {
    const s = waterfallSteps([100, -30, 20, 90, -10, 80], [0, 3, 5]);
    expect(s.map((x) => [x.start, x.end, x.kind])).toEqual([
      [0, 100, 'total'],
      [100, 70, 'decrease'],
      [70, 90, 'increase'],
      [0, 90, 'total'],
      [90, 80, 'decrease'],
      [0, 80, 'total'],
    ]);
  });
  it('cruza el cero y trata los vacíos como cero', () => {
    const s = waterfallSteps([10, -25, null, 5]);
    expect(s.map((x) => [x.start, x.end])).toEqual([[0, 10], [10, -15], [-15, -15], [-15, -10]]);
  });
});
