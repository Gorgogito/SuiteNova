import { describe, expect, it } from 'vitest';
import { normRect, parseA1 } from './addr';
import { CFEvaluator, ICON_COUNTS, newRuleId, type CFRule } from './cf';
import { serialFromYMD } from './dates';
import type { ColumnFilter } from './filter';
import { inPeriod, periodRange } from './reldate';
import { Workbook } from './workbook';

const rect = (a: string, b: string) => {
  const p = parseA1(a)!;
  const q = parseA1(b)!;
  return normRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col });
};

/** Libro con el reloj fijo en miércoles 15 de mayo de 2024. */
function book(cells: Record<string, string>) {
  const w = new Workbook();
  w.setClock(() => new Date(2024, 4, 15, 10, 30), () => 0.5);
  const id = w.sheets[0]!.id;
  w.transact(() => {
    for (const [a, t] of Object.entries(cells)) {
      const p = parseA1(a)!;
      w.setInput(id, p.row, p.col, t);
    }
  });
  return { w, id, sheet: w.sheet(id) };
}
const D = (y: number, m: number, d: number) => serialFromYMD(y, m, d);
const TODAY = D(2024, 5, 15); // miércoles

describe('periodos de fecha relativos', () => {
  it('rangos de día, semana (domingo a sábado), mes, trimestre y año', () => {
    expect(periodRange('today', TODAY)).toEqual([TODAY, TODAY]);
    expect(periodRange('last7Days', TODAY)).toEqual([TODAY - 6, TODAY]);
    expect(periodRange('thisWeek', TODAY)).toEqual([D(2024, 5, 12), D(2024, 5, 18)]);
    expect(periodRange('lastWeek', TODAY)).toEqual([D(2024, 5, 5), D(2024, 5, 11)]);
    expect(periodRange('nextWeek', TODAY)).toEqual([D(2024, 5, 19), D(2024, 5, 25)]);
    expect(periodRange('thisMonth', TODAY)).toEqual([D(2024, 5, 1), D(2024, 5, 31)]);
    expect(periodRange('lastMonth', TODAY)).toEqual([D(2024, 4, 1), D(2024, 4, 30)]);
    expect(periodRange('nextMonth', TODAY)).toEqual([D(2024, 6, 1), D(2024, 6, 30)]);
    expect(periodRange('thisQuarter', TODAY)).toEqual([D(2024, 4, 1), D(2024, 6, 30)]);
    expect(periodRange('lastQuarter', TODAY)).toEqual([D(2024, 1, 1), D(2024, 3, 31)]);
    expect(periodRange('nextQuarter', TODAY)).toEqual([D(2024, 7, 1), D(2024, 9, 30)]);
    expect(periodRange('lastYear', TODAY)).toEqual([D(2023, 1, 1), D(2023, 12, 31)]);
    expect(periodRange('yearToDate', TODAY)).toEqual([D(2024, 1, 1), TODAY]);
  });
  it('cruza el cambio de año y de mes', () => {
    const jan = D(2025, 1, 2);
    expect(periodRange('lastMonth', jan)).toEqual([D(2024, 12, 1), D(2024, 12, 31)]);
    expect(periodRange('lastQuarter', jan)).toEqual([D(2024, 10, 1), D(2024, 12, 31)]);
    expect(periodRange('nextQuarter', D(2024, 11, 20))).toEqual([D(2025, 1, 1), D(2025, 3, 31)]);
    expect(inPeriod(D(2024, 5, 15) + 0.75, 'today', TODAY)).toBe(true);
    expect(inPeriod(D(2024, 5, 16), 'today', TODAY)).toBe(false);
  });
});

describe('formato condicional ampliado', () => {
  const rule = (extra: object): CFRule => ({ id: newRuleId(), ranges: [rect('A1', 'A6')], priority: 1, ...extra }) as CFRule;
  const withRule = (cells: Record<string, string>, r: CFRule) => {
    const b = book(cells);
    b.sheet.condFormats.push(r);
    return { ...b, cf: new CFEvaluator(b.w, b.id) };
  };

  it('fechas: marca solo las del periodo', () => {
    const cells = { A1: String(D(2024, 5, 14)), A2: String(TODAY), A3: String(D(2024, 5, 16)), A4: String(D(2024, 5, 8)), A5: 'texto' };
    const fmt = { color: '#ff0000' };
    const hits = (period: string) => {
      const { cf } = withRule(cells, rule({ type: 'timePeriod', period, format: fmt }));
      return [0, 1, 2, 3, 4].map((r) => !!cf.forCell(r, 0)?.format);
    };
    expect(hits('today')).toEqual([false, true, false, false, false]);
    expect(hits('yesterday')).toEqual([true, false, false, false, false]);
    expect(hits('thisWeek')).toEqual([true, true, true, false, false]);
    expect(hits('lastWeek')).toEqual([false, false, false, true, false]);
    expect(hits('thisMonth')).toEqual([true, true, true, true, false]);
  });

  it('por encima o por debajo del promedio en desviaciones estándar', () => {
    const cells = { A1: '2', A2: '4', A3: '4', A4: '4', A5: '5', A6: '30' };
    const hits = (above: boolean, k: number) => {
      const { cf } = withRule(cells, rule({ type: 'average', above, stdDev: k, format: { bold: true } }));
      return [0, 1, 2, 3, 4, 5].map((r) => !!cf.forCell(r, 0)?.format);
    };
    // media 8.17, desviación muestral ≈ 10.4: solo el 30 supera media + 1 desviación; nada queda bajo media − 1 desviación
    expect(hits(true, 1)).toEqual([false, false, false, false, false, true]);
    expect(hits(false, 1)).toEqual([false, false, false, false, false, false]);
    expect(hits(true, 3)).toEqual([false, false, false, false, false, false]);
  });

  it('barras de datos con negativos: eje, escala común y color propio', () => {
    const { cf } = withRule({ A1: '-10', A2: '-5', A3: '0', A4: '10', A5: '20' }, rule({ type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' }, negativeColor: '#ff0000' }));
    const bar = (r: number) => cf.forCell(r, 0)!.bar!;
    // rango −10…20 = 30: el eje queda a 1/3 del ancho
    expect(bar(0).from).toBeCloseTo(1 / 3);
    expect(bar(0)).toMatchObject({ negative: true, color: '#ff0000', axisLine: true });
    expect(bar(0).fraction).toBeCloseTo(10 / 30);
    expect(bar(1).fraction).toBeCloseTo(5 / 30);
    expect(bar(3)).toMatchObject({ negative: false, color: '#638ec6' });
    expect(bar(3).fraction).toBeCloseTo(10 / 30);
    expect(bar(4).fraction).toBeCloseTo(20 / 30);
    expect(bar(2).fraction).toBe(0);
  });

  it('barras de datos: eje al centro, sin eje y relleno sólido', () => {
    const cells = { A1: '-20', A2: '10' };
    const mid = withRule(cells, rule({ type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' }, axis: 'middle', solid: true })).cf;
    expect(mid.forCell(0, 0)!.bar).toMatchObject({ from: 0.5, negative: true, solid: true });
    expect(mid.forCell(0, 0)!.bar!.fraction).toBeCloseTo(0.5);
    expect(mid.forCell(1, 0)!.bar!.fraction).toBeCloseTo(0.25);
    const none = withRule(cells, rule({ type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' }, axis: 'none' })).cf;
    expect(none.forCell(0, 0)!.bar).toMatchObject({ fraction: 0 });
    expect(none.forCell(1, 0)!.bar!.fraction).toBeCloseTo(1);
    // sin negativos nada cambia respecto a antes
    const pos = withRule({ A1: '5', A2: '10' }, rule({ type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' } })).cf;
    expect(pos.forCell(1, 0)!.bar).toEqual({ fraction: 1, color: '#638ec6' });
  });

  it('todos los conjuntos de iconos tienen su número de iconos', () => {
    expect(Object.keys(ICON_COUNTS)).toHaveLength(20);
    expect(Object.values(ICON_COUNTS).every((n) => n >= 3 && n <= 5)).toBe(true);
  });
});

describe('autofiltro ampliado', () => {
  const data = { A1: 'Cifra', A2: '10', A3: '40', A4: '25', A5: '5', A6: '30', A7: 'x', A8: '40' };
  const run = (f: ColumnFilter, cells: Record<string, string> = data) => {
    const { w, id, sheet } = book(cells);
    w.editLayout(id, (s) => {
      s.autoFilter = { range: rect('A1', 'A8'), columns: { 0: f } };
    });
    w.reapplyFilter(id);
    return [...sheet.filterHidden].sort((a, b) => a - b);
  };

  it('diez mejores: los n mayores (con empates), el n % y los menores', () => {
    expect(run({ top: { n: 2 } })).toEqual([1, 3, 4, 5, 6]); // 40 y 40 (los dos mayores); empata el puesto
    expect(run({ top: { n: 3 } })).toEqual([1, 3, 4, 6]); // 40, 40, 30
    expect(run({ top: { n: 2, bottom: true } })).toEqual([2, 3, 5, 6, 7]); // los dos menores: 5 y 10
    expect(run({ top: { n: 50, percent: true } })).toEqual([1, 3, 4, 6]); // 6 números → 3
  });

  it('dinámicos: por encima y por debajo del promedio', () => {
    // números: 10, 40, 25, 5, 30, 40 → media 25
    expect(run({ dynamic: 'aboveAverage' })).toEqual([1, 3, 4, 6]);
    expect(run({ dynamic: 'belowAverage' })).toEqual([2, 3, 5, 6, 7]);
  });

  it('dinámicos de fecha: este mes, trimestre y mes de cualquier año', () => {
    const cells = { A1: 'Fecha', A2: String(D(2024, 5, 2)), A3: String(D(2024, 4, 30)), A4: String(D(2023, 5, 20)), A5: String(D(2024, 8, 1)), A6: 'x', A7: '', A8: '' };
    expect(run({ dynamic: 'thisMonth' }, cells)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(run({ dynamic: 'thisQuarter' }, cells)).toEqual([3, 4, 5, 6, 7]);
    expect(run({ dynamic: { month: 5 } }, cells)).toEqual([2, 4, 5, 6, 7]);
    expect(run({ dynamic: { quarter: 3 } }, cells)).toEqual([1, 2, 3, 5, 6, 7]);
    expect(run({ dynamic: 'lastYear' }, cells)).toEqual([1, 2, 4, 5, 6, 7]);
  });

  it('por color de relleno y de fuente, también «sin color»', () => {
    const { w, id, sheet } = book({ A1: 'v', A2: '1', A3: '2', A4: '3', A5: '4', A6: '5', A7: '6', A8: '7' });
    const fill = (row: number, bg: string) => w.formatRange(id, { r1: row, c1: 0, r2: row, c2: 0 }, { bg });
    const font = (row: number, color: string) => w.formatRange(id, { r1: row, c1: 0, r2: row, c2: 0 }, { color });
    fill(1, '#ffff00');
    fill(2, '#ff0000');
    fill(3, '#FFFF00');
    font(4, '#00aa00');
    const filter = (f: ColumnFilter) => {
      w.editLayout(id, (s) => {
        s.autoFilter = { range: rect('A1', 'A8'), columns: { 0: f } };
      });
      w.reapplyFilter(id);
      return [...sheet.filterHidden].sort((a, b) => a - b);
    };
    expect(filter({ color: { kind: 'cell', color: '#ffff00' } })).toEqual([2, 4, 5, 6, 7]);
    expect(filter({ color: { kind: 'cell', color: null } })).toEqual([1, 2, 3]);
    expect(filter({ color: { kind: 'font', color: '#00aa00' } })).toEqual([1, 2, 3, 5, 6, 7]);
  });

  it('agrupaciones de fecha (año, mes, día)', () => {
    const cells = { A1: 'Fecha', A2: String(D(2024, 5, 2)), A3: String(D(2024, 5, 9)), A4: String(D(2023, 5, 2)), A5: String(D(2024, 6, 2)), A6: 'x', A7: '', A8: '' };
    expect(run({ dates: [{ year: 2024, month: 5 }] }, cells)).toEqual([3, 4, 5, 6, 7]);
    expect(run({ dates: [{ year: 2024, month: 5, day: 2 }, { year: 2023 }] }, cells)).toEqual([2, 4, 5, 6, 7]);
  });
});
