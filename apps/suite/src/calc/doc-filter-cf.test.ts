import { CFEvaluator, parseA1 } from '@suitenova/calc-engine';
import { describe, expect, it } from 'vitest';
import { CalcDoc, subtractRect } from './doc';

function doc(cells: Record<string, string>) {
  const d = new CalcDoc();
  d.locale = 'en';
  const id = d.activeSheetId;
  const sel = (a: string, b?: string) => {
    const p = parseA1(a)!;
    const q = b ? parseA1(b)! : p;
    d.selectRange({ r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) }, { row: p.row, col: p.col });
  };
  for (const [a, t] of Object.entries(cells)) {
    sel(a);
    d.beginEdit({ text: t });
    d.commitEdit();
  }
  return { d, id, sel };
}

const data = { A1: 'Región', B1: 'Ventas', A2: 'Norte', B2: '10', A3: 'Sur', B3: '25', A4: 'Norte', B4: '40', A5: 'Este', B5: '5' };

describe('autofilter in the document', () => {
  it('toggles on the data block and off again, with undo', () => {
    const { d, sel } = doc(data);
    sel('A3');
    expect(d.toggleAutoFilter()).toBeNull();
    expect(d.autoFilter!.range).toEqual({ r1: 0, c1: 0, r2: 4, c2: 1 });
    d.undo();
    expect(d.autoFilter).toBeUndefined();
    d.redo();
    d.toggleAutoFilter();
    expect(d.autoFilter).toBeUndefined();
  });

  it('refuses a block without data rows', () => {
    const { d, sel } = doc({ A1: 'x' });
    sel('A1');
    expect(d.toggleAutoFilter()).toMatch(/Selecciona un rango/);
  });

  it('filters by values, hides the rows, and clears', () => {
    const { d, sel } = doc(data);
    sel('A1', 'B5');
    d.toggleAutoFilter();
    d.setColumnFilter(0, { values: ['Norte'] });
    expect([...d.sheet.filterHidden].sort()).toEqual([2, 4]);
    expect(d.hasColumnFilters).toBe(true);
    // cursor movement skips hidden rows
    sel('A2');
    d.moveActive(1, 0);
    expect(d.sel.active.row).toBe(3);
    d.undo();
    expect(d.sheet.filterHidden.size).toBe(0);
    d.redo();
    d.clearColumnFilters();
    expect(d.sheet.filterHidden.size).toBe(0);
    expect(d.filterValues(0).map((v) => [v.key, v.count])).toEqual([['Este', 1], ['Norte', 2], ['Sur', 1]]);
  });

  it('keeps the filter when data changes until it is reapplied', () => {
    const { d, sel } = doc(data);
    sel('A1', 'B5');
    d.toggleAutoFilter();
    d.setColumnFilter(1, { conditions: { list: [{ op: 'gt', value: '20' }], and: true } });
    expect([...d.sheet.filterHidden].sort()).toEqual([1, 4]);
    sel('B2');
    d.beginEdit({ text: '99' });
    d.commitEdit();
    expect([...d.sheet.filterHidden].sort()).toEqual([1, 4]); // stale on purpose, like Excel
    d.reapplyFilter();
    expect([...d.sheet.filterHidden].sort()).toEqual([4]);
  });

  it('sorts the filtered list and reapplies the filter', () => {
    const { d, sel } = doc(data);
    sel('A1', 'B5');
    d.toggleAutoFilter();
    d.setColumnFilter(0, { values: ['Norte', 'Sur'] });
    d.sortByFilterColumn(1, false);
    expect(d.wb.getValue(d.activeSheetId, 1, 1)).toBe(40);
    expect(d.wb.getValue(d.activeSheetId, 4, 1)).toBe(5);
    expect([...d.sheet.filterHidden]).toEqual([4]);
  });
});

describe('conditional formatting in the document', () => {
  const rule = (over: object = {}) => ({ ranges: [{ r1: 1, c1: 1, r2: 4, c2: 1 }], type: 'cellIs' as const, operator: 'greaterThan' as const, formula1: '20', format: { bold: true }, ...over });

  it('adds rules with the highest priority and supports undo', () => {
    const { d, id } = doc(data);
    const a = d.addCF(rule());
    const b = d.addCF(rule({ formula1: '30' }));
    expect(d.condFormats.find((r) => r.id === b)!.priority).toBe(1);
    expect(d.condFormats.find((r) => r.id === a)!.priority).toBe(2);
    d.undo();
    expect(d.condFormats).toHaveLength(1);
    expect(d.condFormats[0]!.priority).toBe(1);
    const ev = new CFEvaluator(d.wb, id);
    expect(ev.forCell(2, 1)?.format?.bold).toBe(true);
    expect(ev.forCell(1, 1)).toBeNull();
  });

  it('reorders, edits and deletes', () => {
    const { d } = doc(data);
    const a = d.addCF(rule({ format: { bg: '#111111' } }));
    const b = d.addCF(rule({ format: { bg: '#222222' } }));
    d.moveCF(b, 1);
    expect([...d.condFormats].sort((x, y) => x.priority - y.priority).map((r) => r.id)).toEqual([a, b]);
    d.moveCF(b, 1); // already last: no change
    expect(d.condFormats.find((r) => r.id === b)!.priority).toBe(2);
    d.updateCF(a, { type: 'text', mode: 'contains', text: 'x', ranges: [{ r1: 0, c1: 0, r2: 4, c2: 0 }], format: { italic: true } } as never, true);
    expect(d.condFormats.find((r) => r.id === a)).toMatchObject({ type: 'text', priority: 1 });
    d.deleteCF(b);
    expect(d.condFormats.map((r) => r.id)).toEqual([a]);
  });

  it('clears the part of a rule inside the selection, or everything', () => {
    const { d, sel } = doc(data);
    d.addCF(rule({ ranges: [{ r1: 1, c1: 1, r2: 4, c2: 1 }] }));
    sel('B3', 'B4');
    d.clearCF('selection');
    expect(d.condFormats[0]!.ranges).toEqual([{ r1: 1, c1: 1, r2: 1, c2: 1 }, { r1: 4, c1: 1, r2: 4, c2: 1 }]);
    d.clearCF('sheet');
    expect(d.condFormats).toHaveLength(0);
    d.undo();
    expect(d.condFormats).toHaveLength(1);
  });

  it('subtracts rectangles', () => {
    const r = { r1: 0, c1: 0, r2: 9, c2: 9 };
    expect(subtractRect(r, { r1: 20, c1: 0, r2: 21, c2: 0 })).toEqual([r]);
    expect(subtractRect(r, { r1: 0, c1: 0, r2: 9, c2: 9 })).toEqual([]);
    const pieces = subtractRect(r, { r1: 3, c1: 3, r2: 5, c2: 5 });
    const area = pieces.reduce((a, p) => a + (p.r2 - p.r1 + 1) * (p.c2 - p.c1 + 1), 0);
    expect(area).toBe(100 - 9);
  });
});
