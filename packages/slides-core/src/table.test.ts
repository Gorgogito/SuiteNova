import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { newTable } from './factory';
import { addElements } from './ops';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';
import { applyTableStyle, deleteCols, deleteRows, distributeCols, expandRange, insertCols, insertRows, isMerged, mergeCells, originOf, scaleTable, setBorders, setColWidth, splitCell, tableStyleFor, tableSize } from './table';
import { docFromText, docText } from './text';
import type { TableEl } from './types';

const grid = (el: TableEl) => el.rows.map((r) => r.cells.map((c) => (c.hMerge && c.vMerge ? 'B' : c.hMerge ? 'H' : c.vMerge ? 'V' : c.rowSpan || c.gridSpan ? `${c.rowSpan ?? 1}x${c.gridSpan ?? 1}` : '.')).join(' '));
const withText = (el: TableEl, r: number, c: number, t: string): TableEl => ({ ...el, rows: el.rows.map((row, i) => (i === r ? { ...row, cells: row.cells.map((cell, j) => (j === c ? { ...cell, text: { body: {}, doc: docFromText(t) } } : cell)) } : row)) });

describe('table editing', () => {
  it('inserts and deletes rows and columns and keeps the size in step', () => {
    const t = newTable(3, 3, 40, 40, 300);
    const a = insertRows(t, 1);
    expect(a.rows.length).toBe(4);
    expect(a.rows.every((r) => r.cells.length === 3)).toBe(true);
    expect(a.xfrm!.h).toBeCloseTo(tableSize(a).h);
    const b = insertCols(a, 3);
    expect(b.cols.length).toBe(4);
    expect(b.rows.every((r) => r.cells.length === 4)).toBe(true);
    const c = deleteRows(b, 0, 1)!;
    expect(c.rows.length).toBe(2);
    expect(deleteCols(c, 0, 3)).toBeNull();
    expect(deleteRows(c, 0, 1)).toBeNull();
  });

  it('merges cells (text joins), and inserting or deleting inside a merge keeps it consistent', () => {
    let t = newTable(3, 3, 0, 0, 300);
    t = withText(withText(t, 0, 0, 'A'), 0, 1, 'B');
    const m = mergeCells(t, { r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(grid(m)).toEqual(['2x2 H .', 'V B .', '. . .']);
    expect(docText(m.rows[0]!.cells[0]!.text!.doc)).toBe('A\nB');
    expect(isMerged(m, 1, 1)).toBe(true);
    expect(originOf(m, 1, 1)).toEqual({ r: 0, c: 0 });
    // a row inserted through the merged cell makes it taller
    const i = insertRows(m, 1);
    expect(grid(i)).toEqual(['3x2 H .', 'V B .', 'V B .', '. . .']);
    // deleting it again restores the merge
    expect(grid(deleteRows(i, 1, 1)!)).toEqual(['2x2 H .', 'V B .', '. . .']);
    // deleting the row that holds the origin keeps the rest of the cell (and its text)
    const d = deleteRows(m, 0, 0)!;
    expect(grid(d)).toEqual(['1x2 H .', '. . .']);
    expect(docText(d.rows[0]!.cells[0]!.text!.doc)).toBe('A\nB');
    // a range that cuts a merged cell grows to include it
    expect(expandRange(m, { r1: 1, c1: 1, r2: 2, c2: 2 })).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
    // splitting a merged cell back into its grid
    expect(grid(splitCell(m, 0, 0, 2, 2))).toEqual(['. . .', '. . .', '. . .']);
  });

  it('splits an unmerged cell by adding lines that the cells beside it span', () => {
    const t = newTable(2, 2, 0, 0, 200);
    const s = splitCell(t, 0, 0, 1, 2);
    expect(s.cols.length).toBe(3);
    expect(grid(s)).toEqual(['. . .', '1x2 H .']);
    expect(tableSize(s).w).toBeCloseTo(200);
    const v = splitCell(t, 0, 0, 2, 1);
    expect(v.rows.length).toBe(3);
    expect(grid(v)).toEqual(['. 2x1', '. V', '. .']);
  });

  it('borders are set on both cells that touch an edge, and can be removed', () => {
    const t = newTable(3, 3, 0, 0, 300);
    const ln = { w: 2, fill: { t: 'solid' as const, c: { rgb: '#ff0000' } } };
    const o = setBorders(t, { r1: 1, c1: 1, r2: 1, c2: 1 }, 'outer', ln);
    expect(o.rows[1]!.cells[1]!.lnT).toBe(ln);
    expect(o.rows[0]!.cells[1]!.lnB).toBe(ln);
    expect(o.rows[1]!.cells[2]!.lnL).toBe(ln);
    expect(o.rows[1]!.cells[0]!.lnR).toBe(ln);
    const inner = setBorders(t, { r1: 0, c1: 0, r2: 2, c2: 2 }, 'inner', ln);
    expect(inner.rows[0]!.cells[0]!.lnT).toBeUndefined();
    expect(inner.rows[0]!.cells[0]!.lnB).toBe(ln);
    expect(inner.rows[1]!.cells[1]!.lnR).toBe(ln);
    const none = setBorders(inner, { r1: 0, c1: 0, r2: 2, c2: 2 }, 'none', null);
    expect(none.rows[1]!.cells[1]!.lnR!.fill).toEqual({ t: 'none' });
  });

  it('sizes: a column border moves between its two columns; distribute and scale', () => {
    const t = newTable(2, 3, 0, 0, 300);
    const a = setColWidth(t, 0, 150);
    expect(a.cols[0]).toBe(150);
    expect(a.cols[1]).toBe(50);
    expect(tableSize(a).w).toBeCloseTo(300);
    expect(distributeCols(a, 0, 2).cols).toEqual([100, 100, 100]);
    const s = scaleTable(t, 600, 148);
    expect(tableSize(s).w).toBeCloseTo(600);
    expect(s.xfrm!.w).toBeCloseTo(600);
  });

  it('a table with merges and a style of its own is written and read back', async () => {
    let t = newTable(3, 3, 40, 40, 300);
    t = mergeCells(t, { r1: 0, c1: 0, r2: 0, c2: 1 });
    const def = tableStyleFor('grid', 3);
    const d0 = newDeck();
    const { deck: d1, id } = applyTableStyle(d0, def);
    t = { ...t, styleId: id, lastRow: true };
    const d2 = addElements(d1, d1.slides[0]!.id, [t]);
    const back = (await readPptx((await writePptx(d2)).data)).deck;
    const bt = back.slides[0]!.shapes.find((e) => e.kind === 'table') as TableEl;
    expect(grid(bt)).toEqual(['1x2 H .', '. . .', '. . .']);
    expect(bt.styleId).toBe(id);
    expect(bt.lastRow).toBe(true);
    const style = back.tableStyles?.find((s) => s.id === id);
    expect(style?.name).toMatch(/Cuadrícula/);
    expect(style?.firstRow?.fill).toEqual(def.firstRow!.fill);
    expect(style?.wholeTbl?.ln?.insideH?.w).toBe(1);
  });
});
