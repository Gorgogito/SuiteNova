import { describe, expect, it } from 'vitest';
import { autoFitCols, cellsOf, deleteCols, deleteRows, distributeCols, distributeRows, expandRange, gridFromRows, gridSize, insertCols, insertRows, isMerged, makeGrid, mapCells, mergeCells, originOf, scaleGrid, setBorders, setColWidth, setProps, setRowHeight, spanOf, splitCell, validate, type Blank, type Grid } from './index';

const blank: Blank<string> = () => '';
const grid = (r: number, c: number): Grid<string> => gridFromRows(Array.from({ length: r }, (_v, i) => Array.from({ length: c }, (_w, j) => `${i},${j}`)), (t) => t);
const texts = (g: Grid<string>) => g.rows.map((r) => r.cells.map((c) => (c.cover ? '·' : c.content)).join(' '));

describe('building a grid', () => {
  it('makes a grid of empty cells and one from text, both valid', () => {
    const g = makeGrid(3, 4, blank);
    expect(g.rows).toHaveLength(3);
    expect(g.cols).toHaveLength(4);
    expect(validate(g)).toEqual([]);
    const h = gridFromRows([['a', 'b'], ['c']], (t) => t);
    expect(texts(h)).toEqual(['a b', 'c ']);
    expect(gridSize(h)).toEqual({ w: 200, h: 48 });
  });
  it('validate points out what is wrong', () => {
    const g = grid(2, 2);
    g.rows[0]!.cells.pop();
    expect(validate(g).join()).toMatch(/tiene 1 celdas/);
    const m = grid(2, 2);
    m.rows[0]!.cells[0]!.cs = 2;
    expect(validate(m).join()).toMatch(/bajo una combinada/);
  });
});

describe('rows and columns', () => {
  it('inserts a row copying the look of the one above and keeps the others in place', () => {
    let g = grid(2, 2);
    g = setProps(g, { r1: 0, c1: 0, r2: 0, c2: 1 }, { fill: '#ff0000' });
    const h = insertRows(g, 1, 2, blank);
    expect(texts(h)).toEqual(['0,0 0,1', ' ', ' ', '1,0 1,1']);
    expect(h.rows[1]!.cells[0]!.props?.fill).toBe('#ff0000');
    expect(h.rows[3]!.cells[0]!.props).toBeUndefined();
    expect(validate(h)).toEqual([]);
  });
  it('inserts columns at the start, the middle and the end', () => {
    const g = grid(2, 2);
    expect(texts(insertCols(g, 0, 1, blank))).toEqual([' 0,0 0,1', ' 1,0 1,1']);
    expect(texts(insertCols(g, 1, 1, blank))).toEqual(['0,0  0,1', '1,0  1,1']);
    expect(texts(insertCols(g, 2, 1, blank))).toEqual(['0,0 0,1 ', '1,0 1,1 ']);
    expect(insertCols(g, 1, 2, blank).cols).toHaveLength(4);
  });
  it('deletes rows and columns, and nothing when it would delete everything', () => {
    const g = grid(3, 3);
    expect(texts(deleteRows(g, 1, 1, blank)!)).toEqual(['0,0 0,1 0,2', '2,0 2,1 2,2']);
    expect(texts(deleteCols(g, 0, 1, blank)!)).toEqual(['0,2', '1,2', '2,2']);
    expect(deleteRows(g, 0, 2, blank)).toBeNull();
    expect(deleteCols(g, 0, 2, blank)).toBeNull();
  });
});

describe('merge and split', () => {
  it('merges a block into one cell and the cells around keep their text', () => {
    const g = mergeCells(grid(3, 3), { r1: 0, c1: 0, r2: 1, c2: 1 }, blank);
    expect(texts(g)).toEqual(['0,0 · 0,2', '· · 1,2', '2,0 2,1 2,2']);
    expect(g.rows[0]!.cells[0]).toMatchObject({ rs: 2, cs: 2 });
    expect(spanOf(g, 1, 1)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(originOf(g, 1, 1)).toEqual({ r: 0, c: 0 });
    expect(originOf(g, 1, 0)).toEqual({ r: 0, c: 0 });
    expect(isMerged(g, 1, 1)).toBe(true);
    expect(isMerged(g, 2, 2)).toBe(false);
    expect(validate(g)).toEqual([]);
  });
  it('joins the contents when asked', () => {
    const g = mergeCells(grid(1, 3), { r1: 0, c1: 0, r2: 0, c2: 2 }, blank, (all) => all.join(' + '));
    expect(g.rows[0]!.cells[0]!.content).toBe('0,0 + 0,1 + 0,2');
  });
  it('a range that cuts a merged cell grows to hold it', () => {
    const g = mergeCells(grid(3, 3), { r1: 0, c1: 0, r2: 1, c2: 1 }, blank);
    expect(expandRange(g, { r1: 1, c1: 1, r2: 2, c2: 2 })).toEqual({ r1: 0, c1: 0, r2: 2, c2: 2 });
  });
  it('inserting inside a merged cell makes it bigger and deleting part of it makes it smaller', () => {
    const g = mergeCells(grid(3, 3), { r1: 0, c1: 0, r2: 1, c2: 1 }, blank);
    const h = insertRows(g, 1, 1, blank);
    expect(h.rows[0]!.cells[0]).toMatchObject({ rs: 3, cs: 2 });
    expect(validate(h)).toEqual([]);
    const d = deleteRows(g, 1, 1, blank)!;
    expect(d.rows[0]!.cells[0]!.rs).toBeUndefined();
    expect(d.rows[0]!.cells[0]!.cs).toBe(2);
    expect(validate(d)).toEqual([]);
    expect(deleteRows(g, 0, 1, blank)!.rows).toHaveLength(1);
  });
  it('splits a merged cell back and an ordinary cell makes the grid bigger', () => {
    const merged = mergeCells(grid(2, 2), { r1: 0, c1: 0, r2: 1, c2: 1 }, blank);
    const back = splitCell(merged, 0, 0, 2, 2, blank);
    expect(texts(back)).toEqual(['0,0 ', ' ']);
    expect(validate(back)).toEqual([]);
    const g = grid(2, 2);
    const s = splitCell(g, 0, 0, 1, 2, blank);
    expect(s.cols).toHaveLength(3);
    expect(s.rows[1]!.cells[0]).toMatchObject({ cs: 2 });
    expect(validate(s)).toEqual([]);
    expect(splitCell(g, 0, 0, 1, 1, blank)).toBe(g);
  });
  it('merging a single cell changes nothing', () => {
    const g = grid(2, 2);
    expect(mergeCells(g, { r1: 0, c1: 0, r2: 0, c2: 0 }, blank)).toBe(g);
  });
});

describe('properties and borders', () => {
  it('sets properties on a range, once on each merged cell, and takes them off with undefined', () => {
    const g = mergeCells(grid(2, 2), { r1: 0, c1: 0, r2: 1, c2: 0 }, blank);
    const f = setProps(g, { r1: 0, c1: 0, r2: 1, c2: 1 }, { fill: '#00ff00', align: 'center' });
    expect(cellsOf(f, { r1: 0, c1: 0, r2: 1, c2: 1 })).toHaveLength(3);
    expect(f.rows[0]!.cells[0]!.props).toEqual({ fill: '#00ff00', align: 'center' });
    expect(f.rows[1]!.cells[0]!.props).toBeUndefined();
    const u = setProps(f, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fill: undefined, align: undefined });
    expect(u.rows[0]!.cells[0]!.props).toBeUndefined();
    expect(setProps(f, { r1: 0, c1: 1, r2: 0, c2: 1 }, { fill: null }).rows[0]!.cells[1]!.props?.fill).toBeNull();
  });
  it('draws the outer border of a range on both cells that share each edge', () => {
    const line = { style: 'single' as const, width: 2, color: '#000000' };
    const g = setBorders(grid(3, 3), { r1: 1, c1: 1, r2: 1, c2: 1 }, 'outer', line);
    expect(g.rows[1]!.cells[1]!.props?.borders).toEqual({ t: line, b: line, l: line, r: line });
    expect(g.rows[0]!.cells[1]!.props?.borders).toEqual({ b: line });
    expect(g.rows[2]!.cells[1]!.props?.borders).toEqual({ t: line });
    expect(g.rows[1]!.cells[0]!.props?.borders).toEqual({ r: line });
    expect(g.rows[1]!.cells[2]!.props?.borders).toEqual({ l: line });
    expect(g.rows[0]!.cells[0]!.props).toBeUndefined();
  });
  it('inside borders only go between the cells of the range, and "none" removes them', () => {
    const line = { style: 'dashed' as const, width: 1, color: '#ff0000' };
    const g = setBorders(grid(2, 2), { r1: 0, c1: 0, r2: 1, c2: 1 }, 'inner', line);
    expect(g.rows[0]!.cells[0]!.props?.borders).toEqual({ b: line, r: line });
    expect(g.rows[1]!.cells[1]!.props?.borders).toEqual({ t: line, l: line });
    const none = setBorders(g, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'none', null);
    expect(none.rows[0]!.cells[0]!.props?.borders).toEqual({ t: null, b: null, l: null, r: null });
  });
  it('mapCells changes only the cells of the range', () => {
    const g = mapCells(grid(2, 2), { r1: 0, c1: 1, r2: 1, c2: 1 }, (c) => ({ ...c, content: c.content.toUpperCase() + '!' }));
    expect(texts(g)).toEqual(['0,0 0,1!', '1,0 1,1!']);
  });
});

describe('sizes', () => {
  it('resizes a column taking from its neighbour, with a minimum', () => {
    const g = grid(1, 3);
    const w = setColWidth(g, 0, 150);
    expect(w.cols).toEqual([150, 50, 100]);
    expect(setColWidth(g, 0, 1000).cols[1]).toBe(12);
    expect(setColWidth(g, 2, 40).cols).toEqual([100, 100, 40]);
    expect(setRowHeight(g, 0, 5).rows[0]!.h).toBe(12);
  });
  it('distributes rows and columns and scales to a size', () => {
    let g = grid(3, 3);
    g = setColWidth(setColWidth(g, 0, 40, false), 1, 160, false);
    expect(distributeCols(g, 0, 1).cols).toEqual([100, 100, 100]);
    expect(distributeRows(setRowHeight(g, 0, 60), 0, 1).rows.map((r) => r.h)).toEqual([42, 42, 24]);
    const s = scaleGrid(g, 600, 144);
    expect(gridSize(s)).toEqual({ w: 600, h: 144 });
  });
  it('fits the columns to their content within a total width', () => {
    const g = autoFitCols(grid(1, 3), (c) => [10, 30, 60][c]!, 300);
    expect(g.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(300);
    expect(g.cols[2]).toBeGreaterThan(g.cols[0]!);
  });
});

describe('any sequence of edits leaves a valid grid', () => {
  it('300 random operations on a small grid', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    let g = grid(3, 3);
    for (let step = 0; step < 300; step++) {
      const R = g.rows.length;
      const C = g.cols.length;
      const op = rnd(7);
      let next: Grid<string> | null = g;
      if (op === 0 && R < 8) next = insertRows(g, rnd(R + 1), 1 + rnd(2), blank);
      else if (op === 1 && C < 8) next = insertCols(g, rnd(C + 1), 1 + rnd(2), blank);
      else if (op === 2) next = deleteRows(g, rnd(R), rnd(R), blank);
      else if (op === 3) next = deleteCols(g, rnd(C), rnd(C), blank);
      else if (op === 4) next = mergeCells(g, { r1: rnd(R), c1: rnd(C), r2: rnd(R), c2: rnd(C) }, blank);
      else if (op === 5 && R < 8 && C < 8) next = splitCell(g, rnd(R), rnd(C), 1 + rnd(3), 1 + rnd(3), blank);
      else next = setBorders(g, { r1: rnd(R), c1: rnd(C), r2: rnd(R), c2: rnd(C) }, 'outer', { style: 'single', width: 1, color: '#000' });
      if (!next) next = grid(3, 3);
      g = next;
      expect(validate(g), `paso ${step}, operación ${op}`).toEqual([]);
    }
  });
});
