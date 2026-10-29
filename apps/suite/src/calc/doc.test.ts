import { E, parseA1, type Scalar } from '@suitenova/calc-engine';
import { describe, expect, it } from 'vitest';
import { CalcDoc } from './doc';
import { fillSeries } from './series';

function doc(cells: Record<string, string> = {}, locale: 'es' | 'en' = 'en'): { d: CalcDoc; id: number; get: (a: string) => Scalar; text: (a: string) => string; type: (a: string, t: string) => string | null; sel: (a: string, b?: string) => void } {
  const d = new CalcDoc();
  d.locale = locale;
  const id = d.activeSheetId;
  const at = (a: string) => parseA1(a)!;
  const sel = (a: string, b?: string) => {
    const p = at(a);
    const q = b ? at(b) : p;
    d.selectRange({ r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) }, { row: p.row, col: p.col });
  };
  const type = (a: string, t: string) => {
    sel(a);
    d.beginEdit({ text: t });
    return d.commitEdit();
  };
  for (const [a, t] of Object.entries(cells)) type(a, t);
  return { d, id, get: (a) => d.wb.getValue(id, at(a).row, at(a).col), text: (a) => d.editText(id, at(a).row, at(a).col), type, sel };
}

describe('editing', () => {
  it('commits text, numbers and formulas in the display locale', () => {
    const { d, get, text } = doc({ A1: '1,5', B1: '=SUMA(A1;2)', C1: '31/1/2024', D1: 'hola' }, 'es');
    expect(get('A1')).toBe(1.5);
    expect(get('B1')).toBe(3.5);
    expect(get('C1')).toBe(45322);
    expect(get('D1')).toBe('hola');
    expect(text('A1')).toBe('1,5');
    expect(text('B1')).toBe('=SUMA(A1;2)');
    expect(text('C1')).toBe('31/01/2024');
    expect(d.display(d.activeSheetId, 0, 2).text).toBe('31/01/2024');
  });

  it('keeps the editor open on a bad formula', () => {
    const { d, type, get } = doc({ A1: '5' });
    expect(type('A1', '=1+')).toMatch(/incompleta|esperaba|inesperado/i);
    expect(d.edit).not.toBeNull();
    expect(get('A1')).toBe(5);
    d.cancelEdit();
    expect(d.edit).toBeNull();
  });

  it('moves after Enter/Tab', () => {
    const { d, sel } = doc();
    sel('B2');
    d.beginEdit({ text: 'x' });
    d.commitEdit('down');
    expect(d.sel.active).toEqual({ row: 2, col: 1 });
    d.beginEdit({ text: 'y' });
    d.commitEdit('right');
    expect(d.sel.active).toEqual({ row: 2, col: 2 });
  });

  it('returns to the starting column when Enter follows a run of Tabs', () => {
    const { d, sel } = doc();
    sel('B2');
    for (const text of ['a', 'b', 'c']) {
      d.beginEdit({ text, mode: 'enter' });
      d.commitEdit('right');
    }
    expect(d.sel.active).toEqual({ row: 1, col: 4 });
    d.moveEnter(false);
    expect(d.sel.active).toEqual({ row: 2, col: 1 });
    d.moveEnter(false); // the memory is used up: plain down
    expect(d.sel.active).toEqual({ row: 3, col: 1 });
    d.beginEdit({ text: 'x', mode: 'enter' });
    d.commitEdit('right');
    d.moveActive(1, 0); // an arrow key forgets it
    d.moveEnter(false);
    expect(d.sel.active).toEqual({ row: 5, col: 2 });
  });

  it('does not allow editing spilled cells', () => {
    const { d, sel, type } = doc({ A1: '=SEQUENCE(3)' });
    sel('A2');
    d.beginEdit({ text: 'x' });
    expect(d.edit).toBeNull();
    expect(type('A1', '=SEQUENCE(3)')).toBeNull();
  });
});

describe('history', () => {
  it('undoes and redoes with the selection restored', () => {
    const { d, get, type, sel } = doc({ A1: '1' });
    type('A1', '2');
    type('A1', '3');
    sel('C3');
    expect(get('A1')).toBe(3);
    d.undo();
    expect(get('A1')).toBe(2);
    expect(d.sel.active).toEqual({ row: 0, col: 0 });
    d.undo();
    expect(get('A1')).toBe(1);
    d.redo();
    expect(get('A1')).toBe(2);
    expect(d.canRedo).toBe(true);
    type('A1', '9');
    expect(d.canRedo).toBe(false);
  });
  it('undoes structure changes', () => {
    const { d, get, sel } = doc({ A1: '1', A2: '2', B1: '=A2' });
    sel('A1');
    d.insertRows();
    expect(get('B2')).toBe(2);
    d.undo();
    expect(get('B1')).toBe(2);
    expect(d.wb.getInputText(d.activeSheetId, 0, 1)).toBe('=A2');
  });
});

describe('clipboard', () => {
  it('copies formulas relatively and styles with them', () => {
    const { d, get, text, sel } = doc({ A1: '1', B1: '=A1*2' });
    d.wb.formatRange(d.activeSheetId, { r1: 0, c1: 1, r2: 0, c2: 1 }, { bold: true });
    sel('B1');
    const tsv = d.copy();
    expect(tsv).toBe('2');
    sel('B3');
    d.paste(tsv);
    expect(text('B3')).toBe('=A3*2');
    expect(d.wb.getStyle(d.activeSheetId, 2, 1).bold).toBe(true);
    expect(get('B3')).toBe(0);
  });

  it('tiles a small block over a larger selection', () => {
    const { d, get, sel } = doc({ A1: '1', B1: '2' });
    sel('A1', 'B1');
    const tsv = d.copy();
    sel('A3', 'F3');
    d.paste(tsv);
    expect([get('A3'), get('B3'), get('C3'), get('D3'), get('E3'), get('F3')]).toEqual([1, 2, 1, 2, 1, 2]);
  });

  it('cut moves cells and redirects references', () => {
    const { d, get, text, sel } = doc({ A1: '10', B1: '=A1+1', C1: '=B1*2' });
    sel('A1');
    const tsv = d.copy(true);
    sel('A5');
    d.paste(tsv);
    expect(get('A1')).toBe(null);
    expect(get('A5')).toBe(10);
    expect(text('B1')).toBe('=A5+1');
    expect(get('C1')).toBe(22);
    d.undo();
    expect(get('A1')).toBe(10);
    expect(text('B1')).toBe('=A1+1');
  });

  it('pastes values only and transposed', () => {
    const { d, get, sel } = doc({ A1: '1', A2: '2', B1: '=A1+A2' });
    sel('B1');
    let tsv = d.copy();
    sel('D1');
    d.paste(tsv, 'values');
    expect(d.wb.getCell(d.activeSheetId, 0, 3)!.formula).toBeUndefined();
    expect(get('D1')).toBe(3);
    sel('A1', 'A2');
    tsv = d.copy();
    sel('F1');
    d.paste(tsv, 'transpose');
    expect([get('F1'), get('G1')]).toEqual([1, 2]);
  });

  it('pastes external tab-separated text, including quoted fields', () => {
    const { d, get, sel } = doc();
    sel('A1');
    d.paste('a\t1,5\r\n"x\ty"\t"he said ""hi"""\r\n', 'all');
    expect(get('A1')).toBe('a');
    expect(get('B2')).toBe('he said "hi"');
    expect(get('A2')).toBe('x\ty');
    expect(CalcDoc.parseTsv('1\t2\n3')).toEqual([['1', '2'], ['3']]);
  });
});

describe('fill', () => {
  it('fills series and copies', () => {
    expect(fillSeries([1, 2], 3)).toEqual([3, 4, 5]);
    expect(fillSeries([5], 2)).toEqual([5, 5]);
    expect(fillSeries([5], 2, { increment: true })).toEqual([6, 7]);
    expect(fillSeries(['Item 1'], 2)).toEqual(['Item 2', 'Item 3']);
    expect(fillSeries(['lun', 'mar'], 3)).toEqual(['mié', 'jue', 'vie']);
    expect(fillSeries(['Enero'], 2)).toEqual(['Febrero', 'Marzo']);
    expect(fillSeries(['a', 'b'], 3)).toEqual(['a', 'b', 'a']);
    expect(fillSeries([0.1, 0.2], 1)).toEqual([0.3]);
  });

  it('fills down formulas', () => {
    const { d, text, get, sel } = doc({ A1: '1', A2: '2', A3: '3', B1: '=A1*10' });
    sel('B1', 'B3');
    d.fillDown();
    expect(text('B3')).toBe('=A3*10');
    expect(get('B3')).toBe(30);
  });

  it('drags the fill handle in all directions', () => {
    const { d, get, text, sel } = doc({ A1: '1', A2: '2', C1: '=A1' });
    d.fillTo({ r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
    expect([get('A3'), get('A4'), get('A5')]).toEqual([3, 4, 5]);
    d.fillTo({ r1: 0, c1: 2, r2: 0, c2: 2 }, { r1: 0, c1: 2, r2: 0, c2: 4 });
    expect(text('E1')).toBe('=C1');
    sel('A3');
    d.fillTo({ r1: 2, c1: 0, r2: 4, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 });
    expect(get('A2')).toBe(2); // series continues backwards: 3,4,5 -> 2,1
    expect(get('A1')).toBe(1);
  });
});

describe('structure and layout', () => {
  it('inserts and deletes rows and columns by selection size', () => {
    const { d, get, sel } = doc({ A1: '1', A2: '2', A3: '3', A4: '=SUM(A1:A3)' });
    sel('A2', 'A3');
    d.insertRows();
    expect(get('A6')).toBe(6);
    d.deleteRows();
    expect(get('A4')).toBe(6);
    sel('B1');
    d.insertCols();
    expect(d.wb.getValue(d.activeSheetId, 0, 2)).toBe(null);
    expect(get('A1')).toBe(1);
  });

  it('merges cells keeping the top-left value', () => {
    const { d, get, sel } = doc({ A1: 'x', B1: 'y', A2: 'z' });
    sel('A1', 'B2');
    d.merge(true);
    expect(d.sheet.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
    expect(get('A1')).toBe('x');
    expect(get('B1')).toBe(null);
    expect(d.wb.getStyle(d.activeSheetId, 0, 0).hAlign).toBe('center');
    // selecting inside a merge selects the whole merge and skips it when moving
    d.selectCell(1, 1);
    expect(d.activeRange).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
    d.moveActive(0, 1);
    expect(d.sel.active).toEqual({ row: 0, col: 2 });
    d.selectCell(0, 0);
    d.unmerge();
    expect(d.sheet.merges).toEqual([]);
  });

  it('applies and toggles styles on the selection', () => {
    const { d, sel } = doc({ A1: '1' });
    sel('A1', 'B2');
    d.toggleStyle('bold');
    expect(d.wb.getStyle(d.activeSheetId, 1, 1).bold).toBe(true);
    d.toggleStyle('bold');
    expect(d.wb.getStyle(d.activeSheetId, 1, 1).bold).toBeUndefined();
    d.applyStyle({ numFmt: '0.00' });
    expect(d.wb.getStyle(d.activeSheetId, 0, 1).numFmt).toBe('0.00');
    d.setBorders('outer');
    expect(d.wb.getStyle(d.activeSheetId, 0, 0).top?.style).toBe('thin');
    expect(d.wb.getStyle(d.activeSheetId, 1, 1).bottom?.style).toBe('thin');
    expect(d.wb.getStyle(d.activeSheetId, 0, 0).bottom).toBeUndefined();
  });

  it('manages sheets', () => {
    const { d } = doc({ A1: '5' });
    d.addSheet();
    expect(d.wb.sheets).toHaveLength(2);
    expect(d.renameSheet(d.activeSheetId, 'Datos')).toBeNull();
    expect(d.renameSheet(d.activeSheetId, 'a/b')).toMatch(/no es válido/);
    expect(d.renameSheet(d.wb.sheets[0]!.id, 'Datos')).toMatch(/Ya existe/);
    d.activateSheet(d.wb.sheets[0]!.id);
    d.duplicateSheet(d.activeSheetId);
    expect(d.wb.sheets.map((s) => s.name)).toEqual(['Hoja1', 'Hoja1 (2)', 'Datos']);
    expect(d.wb.getValue(d.activeSheetId, 0, 0)).toBe(5);
    d.deleteSheet(d.activeSheetId);
    expect(d.wb.sheets).toHaveLength(2);
  });
});

describe('navigation', () => {
  it('jumps with ctrl+arrow over data blocks', () => {
    const { d, sel } = doc({ A1: '1', A2: '2', A3: '3', A6: '6' });
    sel('A1');
    d.moveActive(1, 0, { jump: true });
    expect(d.sel.active.row).toBe(2);
    d.moveActive(1, 0, { jump: true });
    expect(d.sel.active.row).toBe(5);
    d.moveActive(-1, 0, { jump: true });
    expect(d.sel.active.row).toBe(2);
    d.moveActive(0, 1, { jump: true });
    expect(d.sel.active.col).toBeGreaterThan(0);
  });

  it('extends the selection and skips hidden rows', () => {
    const { d, sel } = doc({ A1: '1' });
    d.wb.editLayout(d.activeSheetId, (s) => s.hiddenRows.add(1));
    sel('A1');
    d.moveActive(1, 0);
    expect(d.sel.active.row).toBe(2);
    sel('B2');
    d.moveActive(1, 1, { extend: true });
    expect(d.activeRange).toEqual({ r1: 1, c1: 1, r2: 2, c2: 2 });
  });

  it('goes to addresses, ranges, sheets and names', () => {
    const { d } = doc({ A1: '1' });
    expect(d.goTo('c5')).toBe(true);
    expect(d.sel.active).toEqual({ row: 4, col: 2 });
    expect(d.goTo('B2:D4')).toBe(true);
    expect(d.activeRange).toEqual({ r1: 1, c1: 1, r2: 3, c2: 3 });
    expect(d.nameBoxText()).toBe('B2:D4');
    expect(d.defineNameForSelection('Zona')).toBeNull();
    d.goTo('A1');
    expect(d.goTo('Zona')).toBe(true);
    expect(d.nameBoxText()).toBe('Zona');
    expect(d.defineNameForSelection('A1')).toMatch(/no es válido/);
    expect(d.goTo('zzzz')).toBe(false);
  });
});

describe('data tools', () => {
  it('sorts rows, keeping formulas relative to their row', () => {
    const { d, get, text } = doc({ A1: 'n', B1: 'v', A2: 'b', B2: '3', C2: '=B2*2', A3: 'a', B3: '1', C3: '=B3*2', A4: 'c', B4: '2', C4: '=B4*2' });
    d.sortRange({ r1: 0, c1: 0, r2: 3, c2: 2 }, 1, true, true);
    expect([get('A2'), get('A3'), get('A4')]).toEqual(['a', 'c', 'b']);
    expect(text('C2')).toBe('=B2*2');
    expect([get('C2'), get('C3'), get('C4')]).toEqual([2, 4, 6]);
    d.sortRange({ r1: 0, c1: 0, r2: 3, c2: 2 }, 0, false, true);
    expect([get('A2'), get('A3'), get('A4')]).toEqual(['c', 'b', 'a']);
  });

  it('removes duplicates', () => {
    const { d, get } = doc({ A1: 'x', A2: 'y', A3: 'X', A4: 'z', A5: 'y' });
    expect(d.removeDuplicates({ r1: 0, c1: 0, r2: 4, c2: 0 }, false)).toBe(2);
    expect([get('A1'), get('A2'), get('A3'), get('A4')]).toEqual(['x', 'y', 'z', null]);
  });

  it('auto-sums the block above or to the left', () => {
    const { d, get, text, sel } = doc({ A1: '1', A2: '2', A3: '3', C1: '4', D1: '5' });
    sel('A4');
    d.autoSum('SUM');
    expect(text('A4')).toBe('=SUM(A1:A3)');
    expect(get('A4')).toBe(6);
    sel('E1');
    d.autoSum('AVERAGE');
    expect(text('E1')).toBe('=AVERAGE(C1:D1)');
    sel('A1', 'A3');
    d.autoSum('MAX');
    expect(text('A4')).toBe('=MAX(A1:A3)');
  });

  it('finds and replaces', () => {
    const { d, get, sel } = doc({ A1: 'apple', A2: 'Banana', A3: 'pineapple', B1: '=A1&"!"' });
    sel('A1');
    expect(d.findNext('APPLE')).toBe(true);
    expect(d.sel.active).toEqual({ row: 0, col: 1 }); // B1 shows "apple!"
    expect(d.findNext('apple', { matchCase: true })).toBe(true);
    expect(d.sel.active).toEqual({ row: 2, col: 0 });
    expect(d.findNext('nothing')).toBe(false);
    expect(d.findNext('apple!', { inFormulas: false })).toBe(true);
    expect(d.replaceAll('apple', 'pear')).toBe(2);
    expect(get('A1')).toBe('pear');
    expect(get('A3')).toBe('pinepear');
    expect(get('B1')).toBe('pear!');
  });

  it('computes selection statistics', () => {
    const { d, sel } = doc({ A1: '1', A2: '2', A3: 'x', A4: '' });
    sel('A1');
    expect(d.selectionStats()).toBeNull();
    sel('A1', 'A4');
    expect(d.selectionStats()).toMatchObject({ count: 3, numeric: 2, sum: 3, avg: 1.5, min: 1, max: 2 });
  });
});

describe('misc', () => {
  it('shows formulas when asked', () => {
    const { d } = doc({ A1: '2', B1: '=A1*2' });
    expect(d.display(d.activeSheetId, 0, 1).text).toBe('4');
    d.showFormulas = true;
    expect(d.display(d.activeSheetId, 0, 1).text).toBe('=A1*2');
  });
  it('reports errors as their code', () => {
    const { d, get } = doc({ A1: '=1/0' });
    expect(get('A1')).toBe(E.DIV0);
    expect(d.display(d.activeSheetId, 0, 0).text).toBe('#DIV/0!');
  });
});
