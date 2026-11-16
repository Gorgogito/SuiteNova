import { describe, expect, it } from 'vitest';
import { errorAmounts, fitTrend, fmtCoeff, trendName, trendPath } from './fit';

const pts = (xs: number[], f: (x: number) => number) => xs.map((x) => ({ x, y: f(x) }));
const near = (a: number, b: number, d = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(d);
const X = [1, 2, 3, 4, 5, 6];

describe('líneas de tendencia', () => {
  it('lineal: recupera la recta exacta, R² = 1 y la ecuación', () => {
    const f = fitTrend(pts(X, (x) => 2 * x + 1), { type: 'linear' })!;
    near(f.coeffs[0]!, 1);
    near(f.coeffs[1]!, 2);
    near(f.r2!, 1);
    expect(f.equation).toBe('y = 2x + 1');
    near(f.predict(10), 21);
  });

  it('lineal con ruido: pendiente y R² de mínimos cuadrados', () => {
    const data = [{ x: 1, y: 2.1 }, { x: 2, y: 3.9 }, { x: 3, y: 6.2 }, { x: 4, y: 7.8 }, { x: 5, y: 10.1 }];
    const f = fitTrend(data, { type: 'linear' })!;
    // valores calculados a mano: b = Σ(x-3)(y-6.02) / Σ(x-3)² = 19.9/10 = 1.99 ; a = 6.02 - 1.99·3 = 0.05
    near(f.coeffs[1]!, 1.99);
    near(f.coeffs[0]!, 0.05);
    expect(f.r2!).toBeGreaterThan(0.99);
    expect(f.r2!).toBeLessThan(1);
  });

  it('lineal con corte forzado y signos de la ecuación', () => {
    const f = fitTrend(pts(X, (x) => 3 * x), { type: 'linear', intercept: 0 })!;
    near(f.coeffs[1]!, 3);
    expect(f.equation).toBe('y = 3x');
    expect(fitTrend(pts(X, (x) => -x + 4), { type: 'linear' })!.equation).toBe('y = -x + 4');
    expect(fitTrend(pts(X, (x) => x - 2), { type: 'linear' })!.equation).toBe('y = x - 2');
  });

  it('polinómica: recupera los coeficientes del grado indicado', () => {
    const f = fitTrend(pts(X, (x) => x * x - 3 * x + 2), { type: 'poly', order: 2 })!;
    near(f.coeffs[0]!, 2, 1e-7);
    near(f.coeffs[1]!, -3, 1e-7);
    near(f.coeffs[2]!, 1, 1e-7);
    near(f.r2!, 1, 1e-9);
    expect(f.equation).toBe('y = x² - 3x + 2');
    const g = fitTrend(pts([1, 2, 3, 4, 5, 6, 7, 8], (x) => 0.5 * x ** 3 - x + 1), { type: 'poly', order: 3 })!;
    near(g.coeffs[3]!, 0.5, 1e-6);
    expect(g.equation).toContain('x³');
  });

  it('exponencial, logarítmica y potencial', () => {
    const e = fitTrend(pts(X, (x) => 3 * Math.exp(0.5 * x)), { type: 'exp' })!;
    near(e.coeffs[0]!, 3, 1e-9);
    near(e.coeffs[1]!, 0.5, 1e-9);
    near(e.r2!, 1);
    expect(e.equation).toBe('y = 3e^0.5x');
    const l = fitTrend(pts(X, (x) => 1 + 2 * Math.log(x)), { type: 'log' })!;
    near(l.coeffs[1]!, 2);
    expect(l.equation).toBe('y = 2ln(x) + 1');
    const p = fitTrend(pts(X, (x) => 2 * Math.pow(x, 1.5)), { type: 'power' })!;
    near(p.coeffs[0]!, 2, 1e-9);
    near(p.coeffs[1]!, 1.5, 1e-9);
    expect(p.equation).toBe('y = 2x^1.5');
  });

  it('no se puede ajustar con valores no positivos o con pocos puntos (como Excel)', () => {
    expect(fitTrend(pts([0, 1, 2], (x) => x + 1), { type: 'log' })).toBeNull();
    expect(fitTrend(pts([1, 2, 3], (x) => x - 2), { type: 'exp' })).toBeNull();
    expect(fitTrend(pts([1, 2, 3], (x) => x - 2), { type: 'power' })).toBeNull();
    expect(fitTrend([{ x: 1, y: 1 }], { type: 'linear' })).toBeNull();
    expect(fitTrend(pts([1, 2], (x) => x), { type: 'poly', order: 3 })).toBeNull();
  });

  it('media móvil: promedio de los últimos N puntos', () => {
    const data = pts([1, 2, 3, 4, 5], (x) => x * x);
    const f = fitTrend(data, { type: 'movingAvg', period: 3 })!;
    const path = trendPath(f, data, { type: 'movingAvg', period: 3 });
    expect(path.map((p) => p[0])).toEqual([3, 4, 5]);
    near(path[0]![1], (1 + 4 + 9) / 3);
    near(path[2]![1], (9 + 16 + 25) / 3);
    expect(f.equation).toBe('');
    expect(f.r2).toBeNull();
  });

  it('trayectoria con prolongación hacia delante y atrás', () => {
    const data = pts(X, (x) => 2 * x);
    const tl = { type: 'linear' as const, forward: 2, backward: 1 };
    const path = trendPath(fitTrend(data, tl)!, data, tl);
    expect(path[0]![0]).toBe(0);
    expect(path[path.length - 1]![0]).toBe(8);
    near(path[path.length - 1]![1], 16);
  });

  it('nombres de la leyenda y formato de números', () => {
    expect(trendName({ type: 'linear' }, 'Ventas', true)).toBe('Lineal (Ventas)');
    expect(trendName({ type: 'exp' }, 'Ventas', false)).toBe('Expon. (Ventas)');
    expect(trendName({ type: 'movingAvg', period: 4 }, 'V', true)).toBe('4 per. Media móvil (V)');
    expect(trendName({ type: 'linear', name: 'Mi tendencia' }, 'V', true)).toBe('Mi tendencia');
    expect(fmtCoeff(1234.56789)).toBe('1234.6');
    expect(fmtCoeff(0.000012345)).toBe('1.2345E-05');
    expect(fmtCoeff(-0.5)).toBe('-0.5');
  });
});

describe('barras de error', () => {
  const vals = [10, 20, null, 40];
  it('valor fijo, porcentaje y dirección', () => {
    expect(errorAmounts(vals, { kind: 'fixed', value: 2, direction: 'both' })).toEqual({ plus: [2, 2, null, 2], minus: [2, 2, null, 2] });
    expect(errorAmounts(vals, { kind: 'percent', value: 10, direction: 'plus' })).toEqual({ plus: [1, 2, null, 4], minus: [0, 0, 0, 0] });
  });
  it('desviación estándar y error estándar de la serie', () => {
    const v = [2, 4, 4, 4, 5, 5, 7, 9];
    const sd = Math.sqrt(32 / 7); // suma de cuadrados 32, n − 1 = 7
    const a = errorAmounts(v, { kind: 'stdev', value: 2, direction: 'both' });
    near(a.plus[0]!, 2 * sd);
    const b = errorAmounts(v, { kind: 'stderr', direction: 'both' });
    near(b.minus[3]!, sd / Math.sqrt(8));
  });
  it('personalizado: un valor por punto o uno solo para todos', () => {
    const a = errorAmounts([1, 2, 3], { kind: 'custom', direction: 'both' }, { plus: [0.1, 0.2, 0.3], minus: [1] });
    expect(a.plus).toEqual([0.1, 0.2, 0.3]);
    expect(a.minus).toEqual([1, 1, 1]);
  });
});
