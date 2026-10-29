import { describe, expect, it } from 'vitest';
import { parseA1 } from './addr';
import { newPivot, type PivotDef } from './objects';
import { PIVOT_LABELS_EN } from './pivot';
import { serialFromYMD } from './dates';
import { E, type Scalar } from './values';
import { Workbook } from './workbook';

const DATA: string[][] = [
  ['Region', 'Producto', 'Mes', 'Ventas'],
  ['Norte', 'A', '1', '10'],
  ['Norte', 'B', '2', '20'],
  ['Sur', 'A', '1', '30'],
  ['Sur', 'B', '2', '40'],
  ['Sur', 'A', '2', '50'],
];

function setup(data: string[][] = DATA) {
  const w = new Workbook();
  w.pivotLabels = PIVOT_LABELS_EN;
  const id = w.sheets[0]!.id;
  w.renameSheet(id, 'Datos');
  w.transact(() => data.forEach((row, r) => row.forEach((v, c) => w.setInput(id, r, c, v))));
  const out = w.addSheet('Dinamica');
  const make = (patch: Partial<PivotDef>, at = 'A1'): PivotDef => {
    const p = parseA1(at)!;
    return { ...newPivot('p1', 'TD1', { sheet: 'Datos', ref: 'A1:D6' }, p.row, p.col), ...patch };
  };
  const grid = (rows: number, cols: number, r0 = 0, c0 = 0): Scalar[][] =>
    Array.from({ length: rows }, (_x, r) => Array.from({ length: cols }, (_y, c) => w.getValue(out.id, r0 + r, c0 + c)));
  return { w, id, out, make, grid };
}

describe('pivot tables', () => {
  it('one row field and one value, compact layout', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(4, 2)).toEqual([
      ['Row Labels', 'Sum of Ventas'],
      ['Norte', 30],
      ['Sur', 120],
      ['Grand Total', 150],
    ]);
    expect(t.w.sheet(t.out.id).pivots[0]!.size).toEqual({ rows: 4, cols: 2 });
  });
  it('a column field adds a caption row and a total column', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], cols: ['Producto'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(5, 4)).toEqual([
      ['Sum of Ventas', 'Column Labels', null, null],
      ['Row Labels', 'A', 'B', 'Grand Total'],
      ['Norte', 10, 20, 30],
      ['Sur', 80, 40, 120],
      ['Grand Total', 90, 60, 150],
    ]);
  });
  it('items with no data in a combination are blank', () => {
    const t = setup([['Region', 'Producto', 'Ventas'], ['Norte', 'A', '5'], ['Sur', 'B', '7']]);
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], cols: ['Producto'], values: [{ field: 'Ventas', agg: 'sum' }], source: { sheet: 'Datos', ref: 'A1:C3' } }), PIVOT_LABELS_EN);
    expect(t.grid(4, 4, 2, 0)).toEqual([['Norte', 5, null, 5], ['Sur', null, 7, 7], ['Grand Total', 5, 7, 12], [null, null, null, null]]);
  });
  it('several values go side by side, each with its own caption', () => {
    const t = setup();
    t.w.addPivot(
      t.out.id,
      t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }, { field: 'Ventas', agg: 'average', name: 'Media' }, { field: 'Ventas', agg: 'count' }] }),
      PIVOT_LABELS_EN,
    );
    expect(t.grid(4, 4)).toEqual([
      ['Row Labels', 'Sum of Ventas', 'Media', 'Count of Ventas'],
      ['Norte', 30, 15, 2],
      ['Sur', 120, 40, 3],
      ['Grand Total', 150, 30, 5],
    ]);
  });
  it('column fields with several values add a row of captions', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], cols: ['Producto'], values: [{ field: 'Ventas', agg: 'sum' }, { field: 'Ventas', agg: 'count' }] }), PIVOT_LABELS_EN);
    expect(t.grid(6, 7)).toEqual([
      [null, 'Column Labels', null, null, null, null, null],
      [null, 'A', null, 'B', null, 'Grand Total', null],
      ['Row Labels', 'Sum of Ventas', 'Count of Ventas', 'Sum of Ventas', 'Count of Ventas', 'Sum of Ventas', 'Count of Ventas'],
      ['Norte', 10, 1, 20, 1, 30, 2],
      ['Sur', 80, 2, 40, 1, 120, 3],
      ['Grand Total', 90, 3, 60, 2, 150, 5],
    ]);
  });
  it('two row fields: subtotals at the top of each group in compact layout', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region', 'Producto'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(8, 2)).toEqual([
      ['Row Labels', 'Sum of Ventas'],
      ['Norte', 30],
      ['A', 10],
      ['B', 20],
      ['Sur', 120],
      ['A', 80],
      ['B', 40],
      ['Grand Total', 150],
    ]);
    const s = t.w.getStyle(t.out.id, 2, 0);
    expect(s.indent).toBe(1);
    expect(t.w.getStyle(t.out.id, 1, 0).bold).toBeFalsy(); // the group name itself is a label; its value is bold
    expect(t.w.getStyle(t.out.id, 1, 1).bold).toBe(true);
  });
  it('tabular layout: a column per field, subtotals below the group, labels not repeated', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ layout: 'tabular', rows: ['Region', 'Producto'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(8, 3)).toEqual([
      ['Region', 'Producto', 'Sum of Ventas'],
      ['Norte', 'A', 10],
      [null, 'B', 20],
      ['Norte Total', null, 30],
      ['Sur', 'A', 80],
      [null, 'B', 40],
      ['Sur Total', null, 120],
      ['Grand Total', null, 150],
    ]);
  });
  it('outline layout puts each group name in its own column with the subtotal on its row', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ layout: 'outline', rows: ['Region', 'Producto'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(4, 3)).toEqual([
      ['Region', 'Producto', 'Sum of Ventas'],
      ['Norte', null, 30],
      [null, 'A', 10],
      [null, 'B', 20],
    ]);
  });
  it('repeat labels, no subtotals, no grand totals', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ layout: 'tabular', repeatLabels: true, subtotals: false, grandRows: false, rows: ['Region', 'Producto'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(6, 3)).toEqual([
      ['Region', 'Producto', 'Sum of Ventas'],
      ['Norte', 'A', 10],
      ['Norte', 'B', 20],
      ['Sur', 'A', 80],
      ['Sur', 'B', 40],
      [null, null, null],
    ]);
  });
  it('percent of the grand total, of the column, of the row', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum', showAs: 'percentOfGrand' }] }), PIVOT_LABELS_EN);
    expect(t.grid(4, 2)[1]).toEqual(['Norte', 30 / 150]);
    expect(t.w.getStyle(t.out.id, 1, 1).numFmt).toBe('0.00%');
    const u = setup();
    u.w.addPivot(u.out.id, u.make({ rows: ['Region'], cols: ['Producto'], values: [{ field: 'Ventas', agg: 'sum', showAs: 'percentOfRow' }] }), PIVOT_LABELS_EN);
    expect(u.grid(1, 4, 3, 0)[0]).toEqual(['Sur', 80 / 120, 40 / 120, 1]);
  });
  it('other aggregations', () => {
    const t = setup();
    t.w.addPivot(
      t.out.id,
      t.make({ values: [{ field: 'Ventas', agg: 'max' }, { field: 'Ventas', agg: 'min' }, { field: 'Ventas', agg: 'product' }, { field: 'Ventas', agg: 'stdev' }, { field: 'Ventas', agg: 'varp' }] }),
      PIVOT_LABELS_EN,
    );
    const v = t.grid(1, 5, 1, 1)[0]!;
    expect(v.slice(0, 3)).toEqual([50, 10, 10 * 20 * 30 * 40 * 50]);
    expect(v[3] as number).toBeCloseTo(Math.sqrt(250), 9);
    expect(v[4] as number).toBeCloseTo(200, 9);
  });
  it('a filter field restricts the data and shows the choice above the table', () => {
    const t = setup();
    const out = t.w.pivotOutput(t.make({ filters: ['Producto'], rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN)!;
    const keyA = out.items('Producto').find((i) => i.label === 'A')!.key;
    t.w.addPivot(t.out.id, t.make({ filters: ['Producto'], rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }], selection: { Producto: [keyA] } }), PIVOT_LABELS_EN);
    expect(t.grid(6, 2)).toEqual([
      ['Producto', 'A'],
      [null, null],
      ['Row Labels', 'Sum of Ventas'],
      ['Norte', 10],
      ['Sur', 80],
      ['Grand Total', 90],
    ]);
    // all items selected shows (All)
    const t2 = setup();
    t2.w.addPivot(t2.out.id, t2.make({ filters: ['Producto'], rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t2.grid(1, 2)[0]).toEqual(['Producto', '(All)']);
  });
  it('hiding an item of a row field removes it from the totals', () => {
    const t = setup();
    const out = t.w.pivotOutput(t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN)!;
    const sur = out.items('Region').find((i) => i.label === 'Sur')!.key;
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }], selection: { Region: [sur] } }), PIVOT_LABELS_EN);
    expect(t.grid(3, 2)).toEqual([['Row Labels', 'Sum of Ventas'], ['Sur', 120], ['Grand Total', 120]]);
  });
  it('sorts items in descending order', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], sort: { Region: 'desc' }, values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(3, 1).map((r) => r[0])).toEqual(['Row Labels', 'Sur', 'Norte']);
  });
  it('numbers sort numerically and blanks go last', () => {
    const t = setup([['K', 'V'], ['10', '1'], ['9', '2'], ['', '3'], ['abc', '4']]);
    t.w.addPivot(t.out.id, t.make({ rows: ['K'], values: [{ field: 'V', agg: 'sum' }], source: { sheet: 'Datos', ref: 'A1:B5' } }), PIVOT_LABELS_EN);
    expect(t.grid(6, 1).map((r) => r[0])).toEqual(['Row Labels', 9, 10, 'abc', '(blank)', 'Grand Total']);
  });
  it('groups numbers in ranges and dates by year and month', () => {
    const t = setup([['Edad', 'Fecha', 'N'], ['5', String(serialFromYMD(2023, 3, 5)), '1'], ['12', String(serialFromYMD(2023, 11, 20)), '1'], ['17', String(serialFromYMD(2024, 3, 1)), '1'], ['25', String(serialFromYMD(2024, 3, 9)), '1']]);
    const src = { sheet: 'Datos', ref: 'A1:C5' };
    t.w.addPivot(t.out.id, t.make({ source: src, rows: ['Edad'], groups: { Edad: { kind: 'number', start: 0, end: 20, step: 10 } }, values: [{ field: 'N', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(5, 2)).toEqual([['Row Labels', 'Sum of N'], ['0-10', 1], ['10-20', 2], ['>20', 1], ['Grand Total', 4]]);
    const u = setup([['Edad', 'Fecha', 'N'], ['5', String(serialFromYMD(2023, 3, 5)), '1'], ['12', String(serialFromYMD(2023, 11, 20)), '1'], ['17', String(serialFromYMD(2024, 3, 1)), '1']]);
    u.w.addPivot(u.out.id, u.make({ source: { sheet: 'Datos', ref: 'A1:C4' }, rows: ['Fecha'], groups: { Fecha: { kind: 'year' } }, values: [{ field: 'N', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(u.grid(4, 2)).toEqual([['Row Labels', 'Sum of N'], [2023, 2], [2024, 1], ['Grand Total', 3]]);
    const m = setup([['Fecha', 'N'], [String(serialFromYMD(2023, 3, 5)), '1'], [String(serialFromYMD(2023, 11, 20)), '1'], [String(serialFromYMD(2024, 3, 1)), '2']]);
    m.w.addPivot(m.out.id, m.make({ source: { sheet: 'Datos', ref: 'A1:B4' }, rows: ['Fecha'], groups: { Fecha: { kind: 'month' } }, values: [{ field: 'N', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(m.grid(4, 2)).toEqual([['Row Labels', 'Sum of N'], ['Mar', 3], ['Nov', 1], ['Grand Total', 4]]);
  });
  it('refreshes after the data changes, and clears what it drew before', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    t.w.setInput(t.id, 1, 3, '100');
    expect(t.grid(2, 2)[1]).toEqual(['Norte', 30]); // not automatic, as in Excel
    t.w.renderPivot(t.out.id, 'p1', PIVOT_LABELS_EN);
    expect(t.grid(2, 2)[1]).toEqual(['Norte', 120]);
    // removing a region leaves no stale row behind
    t.w.setInput(t.id, 1, 0, 'Sur');
    t.w.setInput(t.id, 2, 0, 'Sur');
    t.w.renderPivot(t.out.id, 'p1', PIVOT_LABELS_EN);
    expect(t.grid(4, 2)).toEqual([['Row Labels', 'Sum of Ventas'], ['Sur', 240], ['Grand Total', 240], [null, null]]);
  });
  it('will not run over other data', () => {
    const t = setup();
    t.w.setInput(t.out.id, 2, 0, 'estorbo');
    expect(() => t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN)).toThrow(/ya tienen datos/);
    expect(t.w.sheet(t.out.id).pivots).toHaveLength(0);
    expect(t.w.getValue(t.out.id, 2, 0)).toBe('estorbo');
  });
  it('undo removes the table and its cells, redo brings them back', () => {
    const t = setup();
    const p = t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    t.w.applyPatch(p, true);
    expect(t.w.sheet(t.out.id).pivots).toHaveLength(0);
    expect(t.grid(4, 2).flat().every((v) => v === null)).toBe(true);
    t.w.applyPatch(p);
    expect(t.grid(2, 2)[1]).toEqual(['Norte', 30]);
    expect(t.w.sheet(t.out.id).pivots).toHaveLength(1);
  });
  it('knows which cells are the pivot', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }, 'C3'), PIVOT_LABELS_EN);
    expect(t.w.pivotAt(t.out.id, 3, 3)?.name).toBe('TD1');
    expect(t.w.pivotAt(t.out.id, 0, 0)).toBeUndefined();
    expect(t.w.pivotAt(t.out.id, 6, 3)).toBeUndefined();
  });
  it('uses a table as the source', () => {
    const t = setup();
    t.w.createTable(t.id, { r1: 0, c1: 0, r2: 5, c2: 3 }, { id: 't1' });
    t.w.addPivot(t.out.id, t.make({ source: { table: 'Tabla1' }, rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(t.grid(4, 2)[3]).toEqual(['Grand Total', 150]);
  });
  it('GETPIVOTDATA reads a value by field and items', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], cols: ['Producto'], values: [{ field: 'Ventas', agg: 'sum' }] }, 'A1'), PIVOT_LABELS_EN);
    const f = (text: string) => {
      t.w.setInput(t.out.id, 10, 0, `=${text}`);
      return t.w.getValue(t.out.id, 10, 0);
    };
    expect(f('GETPIVOTDATA("Ventas",$A$1,"Region","Sur","Producto","A")')).toBe(80);
    expect(f('GETPIVOTDATA("Sum of Ventas",$A$1,"Region","Norte")')).toBe(30);
    expect(f('GETPIVOTDATA("Ventas",$A$1)')).toBe(150);
    expect(f('GETPIVOTDATA("Ventas",$A$1,"Region","Oeste")')).toBe(E.REF);
    expect(f('GETPIVOTDATA("Nada",$A$1)')).toBe(E.REF);
    expect(f('GETPIVOTDATA("Ventas",$C$20)')).toBe(E.REF);
  });
  it('a pivot named twice is refused', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    expect(() => t.w.addPivot(t.out.id, { ...t.make({ rows: ['Region'] }, 'F1'), id: 'p2' }, PIVOT_LABELS_EN)).toThrow(/Ya existe/);
  });
  it('removing the pivot clears its cells and its slicers', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    t.w.editObjects(t.out.id, (s) => {
      s.slicers.push({ id: 's1', name: 'seg', caption: 'Region', target: { kind: 'pivot', id: 'p1' }, field: 'Region', selected: null, x: 0, y: 0, width: 100, height: 100, columns: 1 });
    });
    t.w.removePivot(t.out.id, 'p1');
    expect(t.w.sheet(t.out.id).slicers).toHaveLength(0);
    expect(t.grid(4, 2).flat().every((v) => v === null)).toBe(true);
  });
});

describe('slicers', () => {
  it('a pivot slicer filters the pivot and its items follow the field', () => {
    const t = setup();
    t.w.addPivot(t.out.id, t.make({ rows: ['Producto'], values: [{ field: 'Ventas', agg: 'sum' }] }), PIVOT_LABELS_EN);
    t.w.editObjects(t.out.id, (s) => {
      s.slicers.push({ id: 's1', name: 'Segm1', caption: 'Region', target: { kind: 'pivot', id: 'p1' }, field: 'Region', selected: null, x: 0, y: 0, width: 150, height: 150, columns: 1 });
    });
    const sl = () => t.w.sheet(t.out.id).slicers[0]!;
    const items = t.w.slicerItems(sl());
    expect(items.map((i) => i.label)).toEqual(['Norte', 'Sur']);
    expect(items.every((i) => i.selected)).toBe(true);
    t.w.setSlicerSelection(t.out.id, 's1', [items[0]!.key]);
    expect(t.grid(4, 2)).toEqual([['Row Labels', 'Sum of Ventas'], ['A', 10], ['B', 20], ['Grand Total', 30]]);
    expect(t.w.slicerItems(sl()).map((i) => i.selected)).toEqual([true, false]);
    t.w.setSlicerSelection(t.out.id, 's1', null);
    expect(t.grid(4, 2)[3]).toEqual(['Grand Total', 150]);
  });
  it('a table slicer hides the rows of the table that do not match', () => {
    const t = setup();
    t.w.createTable(t.id, { r1: 0, c1: 0, r2: 5, c2: 3 }, { id: 't1' });
    t.w.editObjects(t.id, (s) => {
      s.slicers.push({ id: 's1', name: 'Segm1', caption: 'Region', target: { kind: 'table', id: 't1' }, field: 'Region', selected: null, x: 0, y: 0, width: 150, height: 150, columns: 1 });
    });
    t.w.setSlicerSelection(t.id, 's1', ['Norte']);
    expect([...t.w.sheet(t.id).filterHidden].sort()).toEqual([3, 4, 5]);
    t.w.setInput(t.id, 10, 0, '=SUBTOTAL(109,Tabla1[Ventas])');
    expect(t.w.getValue(t.id, 10, 0)).toBe(30);
    t.w.setSlicerSelection(t.id, 's1', null);
    expect(t.w.sheet(t.id).filterHidden.size).toBe(0);
    expect(t.w.getValue(t.id, 10, 0)).toBe(150);
  });
});
