import { describe, expect, it } from 'vitest';
import { parseA1, normRect } from './addr';
import { colAtPx, colOffsetPx, readRangeValues, rowAtPx, rowOffsetPx, suggestChart } from './charts';
import { Workbook } from './workbook';

function book(cells: Record<string, string>) {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  w.transact(() => {
    for (const [a, t] of Object.entries(cells)) {
      const p = parseA1(a)!;
      w.setInput(id, p.row, p.col, t);
    }
  });
  return { w, id };
}
const rect = (a: string, b: string) => {
  const p = parseA1(a)!;
  const q = parseA1(b)!;
  return normRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col });
};

describe('suggestChart', () => {
  const data = { A1: 'Mes', B1: 'Ventas', C1: 'Gastos', A2: 'Ene', B2: '10', C2: '4', A3: 'Feb', B3: '12', C3: '5', A4: 'Mar', B4: '9', C4: '6' };

  it('uses the first text column as categories and the first row as series names', () => {
    const { w, id } = book(data);
    const c = suggestChart(w, id, rect('A1', 'C4'), 'column')!;
    expect(c.series).toHaveLength(2);
    expect(c.series[0]).toMatchObject({ values: 'Hoja1!$B$2:$B$4', nameRef: 'Hoja1!$B$1', categories: 'Hoja1!$A$2:$A$4' });
    expect(c.series[1]!.values).toBe('Hoja1!$C$2:$C$4');
    expect(c.legend).toBe(true);
  });

  it('plots plain numeric columns without categories', () => {
    const { w, id } = book({ A1: '1', A2: '2', A3: '3', B1: '4', B2: '5', B3: '6' });
    const c = suggestChart(w, id, rect('A1', 'B3'), 'line')!;
    expect(c.series).toHaveLength(2);
    expect(c.series[0]!.categories).toBeUndefined();
    expect(c.series[0]!.nameRef).toBeUndefined();
  });

  it('keeps a single series for pie charts and shows the legend', () => {
    const { w, id } = book(data);
    const c = suggestChart(w, id, rect('A1', 'C4'), 'pie')!;
    expect(c.series).toHaveLength(1);
    expect(c.legend).toBe(true);
  });

  it('returns null when there is nothing numeric', () => {
    const { w, id } = book({ A1: 'a', A2: 'b' });
    expect(suggestChart(w, id, rect('A1', 'A2'), 'column')).toBeNull();
  });
});

describe('chart storage', () => {
  const def = { id: 'c1', type: 'column' as const, legend: true, x: 10, y: 20, width: 400, height: 250, series: [{ values: 'Hoja1!$B$2:$B$4', categories: 'Hoja1!$A$2:$A$4', nameRef: 'Hoja1!$B$1' }] };

  it('reads referenced values', () => {
    const { w, id } = book({ A2: 'x', A3: 'y', B2: '1', B3: '2' });
    expect(readRangeValues(w, 'Hoja1!$B$2:$B$3', id)).toEqual([1, 2]);
    expect(readRangeValues(w, 'Hoja1!$A$2:$A$3', id)).toEqual(['x', 'y']);
    expect(readRangeValues(w, 'Nope!$A$1', id)).toEqual([]);
  });

  it('undoes chart edits', () => {
    const { w, id } = book({});
    const patch = w.editCharts(id, (cs) => cs.push(structuredClone(def)));
    expect(w.sheet(id).charts).toHaveLength(1);
    w.applyPatch(patch, true);
    expect(w.sheet(id).charts).toHaveLength(0);
    w.applyPatch(patch, false);
    expect(w.sheet(id).charts[0]!.id).toBe('c1');
  });

  it('keeps references valid on insert/delete and sheet rename', () => {
    const { w, id } = book({ A1: 'h', B1: 'v' });
    w.editCharts(id, (cs) => cs.push(structuredClone(def)));
    w.shiftStructure(id, 'row', 0, 2);
    expect(w.sheet(id).charts[0]!.series[0]).toMatchObject({ values: 'Hoja1!$B$4:$B$6', nameRef: 'Hoja1!$B$3', categories: 'Hoja1!$A$4:$A$6' });
    w.shiftStructure(id, 'col', 0, 1);
    expect(w.sheet(id).charts[0]!.series[0]!.values).toBe('Hoja1!$C$4:$C$6');
    w.renameSheet(id, 'Mis datos');
    expect(w.sheet(id).charts[0]!.series[0]!.values).toBe("'Mis datos'!$C$4:$C$6");
  });
});

describe('pixel geometry', () => {
  it('maps between pixels and cells with custom sizes', () => {
    const { w, id } = book({});
    const s = w.sheet(id);
    expect(colOffsetPx(s, 3)).toBe(192);
    expect(rowOffsetPx(s, 5)).toBe(100);
    w.editLayout(id, (sh) => {
      sh.colWidths.set(1, 164);
      sh.hiddenRows.add(0);
    });
    expect(colOffsetPx(s, 3)).toBe(292);
    expect(rowOffsetPx(s, 5)).toBe(80);
    expect(colAtPx(s, 100)).toEqual({ col: 1, offset: 36 });
    expect(rowAtPx(s, 85)).toEqual({ row: 5 + 0, offset: 5 });
  });
});
