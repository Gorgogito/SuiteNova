import { describe, expect, it } from 'vitest';
import { parseA1 } from './addr';
import { printFormula } from './formula';
import { newValidation, validateEntry, invalidCells, listChoices, safeUrl, hyperlinkAt, commentAt, type DataValidation } from './objects';
import { parseFormula } from './parser';
import { CalcError, E, type Scalar } from './values';
import { Workbook } from './workbook';

function book(cells: Record<string, string> = {}) {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  const set = (a: string, t: string, sheet = id) => {
    const p = parseA1(a)!;
    return w.setInput(sheet, p.row, p.col, t);
  };
  w.transact(() => {
    for (const [a, t] of Object.entries(cells)) set(a, t);
  });
  const get = (a: string, sheet = id): Scalar => {
    const p = parseA1(a)!;
    return w.getValue(sheet, p.row, p.col);
  };
  const text = (a: string, sheet = id) => {
    const p = parseA1(a)!;
    return w.getInputText(sheet, p.row, p.col);
  };
  return { w, id, get, set, text };
}
const err = (code: string) => CalcError.parse(code)!;
const rect = (a: string) => {
  const [x, y] = a.split(':') as [string, string?];
  const p = parseA1(x)!;
  const q = parseA1(y ?? x)!;
  return { r1: p.row, c1: p.col, r2: q.row, c2: q.col };
};

const SALES = { A1: 'Region', B1: 'Ventas', C1: 'Costo', A2: 'Norte', B2: '10', C2: '4', A3: 'Sur', B3: '20', C3: '5', A4: 'Este', B4: '30', C4: '6' };

describe('structured references', () => {
  const withTable = () => {
    const b = book(SALES);
    b.w.createTable(b.id, rect('A1:C4'), { id: 't1' });
    return b;
  };
  it('creates a table, names it and takes the column names from the header', () => {
    const b = withTable();
    const t = b.w.sheet(b.id).tables[0]!;
    expect(t.name).toBe('Tabla1');
    expect(t.columns.map((c) => c.name)).toEqual(['Region', 'Ventas', 'Costo']);
  });
  it('makes unique header names and fills blanks', () => {
    const b = book({ A1: 'x', B1: 'x', A2: '1', B2: '2', C1: '', C2: '3' });
    b.w.createTable(b.id, rect('A1:C2'), { id: 't1' });
    expect(b.w.sheet(b.id).tables[0]!.columns.map((c) => c.name)).toEqual(['x', 'x1', 'Columna']);
    expect(b.get('B1')).toBe('x1');
  });
  it('adds a header row when the block has none', () => {
    const b = book({ A1: '1', B1: '2', A2: '3', B2: '4' });
    b.w.createTable(b.id, rect('A1:B2'), { id: 't1', header: false });
    expect(b.get('A1')).toBe('Columna');
    expect(b.get('A2')).toBe(1);
    expect(b.w.sheet(b.id).tables[0]!.ref).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
  });
  it('refuses overlapping tables', () => {
    const b = withTable();
    expect(() => b.w.createTable(b.id, rect('B2:C3'), { id: 't2' })).toThrow();
  });
  it('column, headers, whole table, totals and several columns', () => {
    const b = withTable();
    b.set('E1', '=SUM(Tabla1[Ventas])');
    b.set('E2', '=Tabla1[[#Headers],[Costo]]');
    b.set('E3', '=SUM(Tabla1[[Ventas]:[Costo]])');
    b.set('E4', '=ROWS(Tabla1)');
    b.set('E5', '=SUM(Tabla1)');
    b.set('E6', '=COUNTA(Tabla1[#All])');
    b.set('E7', '=SUM(Tabla1[])');
    expect([b.get('E1'), b.get('E2'), b.get('E3'), b.get('E4'), b.get('E5'), b.get('E6'), b.get('E7')]).toEqual([60, 'Costo', 75, 3, 75, 12, 75]);
  });
  it('this-row references and calculated columns', () => {
    const b = withTable();
    b.set('D1', 'Margen');
    expect(b.w.sheet(b.id).tables[0]!.ref.c2).toBe(2); // typing beside does not grow it by itself
    b.w.resizeTable(b.id, 't1', rect('A1:D4'));
    expect(b.w.sheet(b.id).tables[0]!.columns[3]!.name).toBe('Margen');
    b.w.setCalculatedColumn(b.id, 't1', 3, 'Tabla1[[#This Row],[Ventas]]-Tabla1[[#This Row],[Costo]]');
    expect([b.get('D2'), b.get('D3'), b.get('D4')]).toEqual([6, 15, 24]);
    expect(b.text('D2')).toBe('=Tabla1[@Ventas]-Tabla1[@Costo]');
    // the same formula typed with the short form
    b.set('E2', '=[@Ventas]*2');
    expect(b.get('E2')).toBe(err('#REF!')); // E is outside the table
  });
  it('new rows get the calculated column', () => {
    const b = withTable();
    b.set('D1', 'Margen');
    b.w.resizeTable(b.id, 't1', rect('A1:D4'));
    b.w.setCalculatedColumn(b.id, 't1', 3, '[@Ventas]*10');
    b.set('A5', 'Oeste');
    b.set('B5', '7');
    b.w.resizeTable(b.id, 't1', rect('A1:D5'));
    expect(b.get('D5')).toBe(70);
    b.set('F1', '=SUM(Tabla1[Margen])');
    expect(b.get('F1')).toBe(100 + 200 + 300 + 70);
  });
  it('follows a rename of a column header and of the table', () => {
    const b = withTable();
    b.set('E1', '=SUM(Tabla1[Ventas])');
    b.set('B1', 'Ingresos');
    expect(b.text('E1')).toBe('=SUM(Tabla1[Ingresos])');
    expect(b.get('E1')).toBe(60);
    b.w.renameTable(b.id, 't1', 'Datos');
    expect(b.text('E1')).toBe('=SUM(Datos[Ingresos])');
    expect(b.get('E1')).toBe(60);
  });
  it('forbids a duplicate header and an empty one', () => {
    const b = withTable();
    b.set('C1', 'Ventas');
    expect(b.get('C1')).toBe('Ventas1');
    b.set('A1', '');
    expect(b.get('A1')).toBe('Region');
  });
  it('totals row uses SUBTOTAL so filtered rows are ignored', () => {
    const b = withTable();
    b.w.setTableTotals(b.id, 't1', true);
    b.w.setTableColumnTotal(b.id, 't1', 1, 'sum');
    b.w.setTableColumnTotal(b.id, 't1', 2, 'average');
    expect(b.text('B5')).toBe('=SUBTOTAL(109,Tabla1[Ventas])');
    expect(b.get('B5')).toBe(60);
    expect(b.get('C5')).toBe(5);
    expect(b.get('A5')).toBe('Total');
    b.set('F1', '=SUM(Tabla1[Ventas])');
    expect(b.get('F1')).toBe(60); // the totals row is not part of the data
    b.w.setTableTotals(b.id, 't1', false);
    expect(b.get('B5')).toBe(null);
  });
  it('filters rows with the table filter, apart from the sheet filter', () => {
    const b = withTable();
    b.w.editObjects(b.id, (s) => {
      s.tables[0]!.filter = { range: { r1: 0, c1: 0, r2: 3, c2: 2 }, columns: { 0: { values: ['Norte', 'Este'] } } };
    });
    b.w.reapplyFilter(b.id);
    expect([...b.w.sheet(b.id).filterHidden]).toEqual([2]);
    b.set('F1', '=SUBTOTAL(109,Tabla1[Ventas])');
    expect(b.get('F1')).toBe(40);
  });
  it('moves with inserted rows and grows when inserted inside', () => {
    const b = withTable();
    b.set('F1', '=SUM(Tabla1[Ventas])');
    b.w.shiftStructure(b.id, 'row', 2, 1);
    expect(b.w.sheet(b.id).tables[0]!.ref).toEqual({ r1: 0, c1: 0, r2: 4, c2: 2 });
    b.w.shiftStructure(b.id, 'row', 0, 2);
    expect(b.w.sheet(b.id).tables[0]!.ref).toEqual({ r1: 2, c1: 0, r2: 6, c2: 2 });
    expect(b.get('F3')).toBe(60);
  });
  it('removes a deleted column from the table and its references become #REF!', () => {
    const b = withTable();
    b.set('F1', '=SUM(Tabla1[Costo])');
    b.set('G1', '=SUM(Tabla1[Ventas])');
    b.w.shiftStructure(b.id, 'col', 2, -1);
    expect(b.w.sheet(b.id).tables[0]!.columns.map((c) => c.name)).toEqual(['Region', 'Ventas']);
    expect(b.get('E1')).toBe(err('#REF!'));
    expect(b.get('F1')).toBe(60);
  });
  it('inserting a column inside adds one to the table', () => {
    const b = withTable();
    b.w.shiftStructure(b.id, 'col', 1, 1);
    expect(b.w.sheet(b.id).tables[0]!.columns.map((c) => c.name)).toEqual(['Region', 'Columna', 'Ventas', 'Costo']);
  });
  it('turning a table into a range rewrites the formulas as plain references', () => {
    const b = withTable();
    b.set('E1', '=SUM(Tabla1[Ventas])');
    b.w.removeTable(b.id, 't1');
    expect(b.text('E1')).toBe('=SUM($B$2:$B$4)');
    expect(b.get('E1')).toBe(60);
    expect(b.w.sheet(b.id).tables).toHaveLength(0);
  });
  it('undo and redo restore the table and the references', () => {
    const b = book(SALES);
    const patch = b.w.createTable(b.id, rect('A1:C4'), { id: 't1' });
    b.set('E1', '=SUM(Tabla1[Ventas])');
    expect(b.get('E1')).toBe(60);
    b.w.applyPatch(patch, true);
    expect(b.w.sheet(b.id).tables).toHaveLength(0);
    b.w.applyPatch(patch);
    expect(b.w.sheet(b.id).tables).toHaveLength(1);
    expect(b.get('E1')).toBe(60);
  });
  it('undo of a header rename brings the column and the formulas back', () => {
    const b = withTable();
    b.set('E1', '=SUM(Tabla1[Ventas])');
    const p = b.set('B1', 'Ingresos');
    expect(b.text('E1')).toBe('=SUM(Tabla1[Ingresos])');
    b.w.applyPatch(p, true);
    expect(b.w.sheet(b.id).tables[0]!.columns[1]!.name).toBe('Ventas');
    expect(b.text('E1')).toBe('=SUM(Tabla1[Ventas])');
    expect(b.get('B1')).toBe('Ventas');
  });
  it('parses and prints every form', () => {
    for (const f of ['SUM(Tabla1[Ventas])', 'Tabla1[[#Headers],[Ventas]]', 'Tabla1[#All]', 'Tabla1[[#Totals],[Ventas]]', 'Tabla1[[Ventas]:[Costo]]', 'Tabla1[@Ventas]', 'Tabla1[@[Costo total]]', 'Tabla1[[Ventas netas]]', 'Tabla1[]']) {
      const printed = printFormula(parseFormula(f));
      expect(printFormula(parseFormula(printed))).toBe(printed);
    }
    expect(printFormula(parseFormula('Tabla1[[#This Row],[Ventas]]'))).toBe('Tabla1[@Ventas]');
    expect(printFormula(parseFormula('Tabla1[[#This Row],[Ventas]]'), { fileTables: true })).toBe('Tabla1[[#This Row],[Ventas]]');
    expect(printFormula(parseFormula('[@Ventas]'))).toBe('[@Ventas]');
    expect(printFormula(parseFormula("Tabla1[Costo '['#']]"))).toBe("Tabla1[[Costo '['#']]]");
  });
  it('a table name that does not exist is #NAME?', () => {
    expect(book({ A1: '=SUM(Nada)' }).get('A1')).toBe(err('#NAME?'));
    expect(book({ A1: '=SUM(Nada[x])' }).get('A1')).toBe(err('#REF!'));
  });
});

describe('names local to a sheet', () => {
  it('shadows a workbook name inside its sheet only', () => {
    const b = book({ A1: '1', B1: '=Tasa' });
    const s2 = b.w.addSheet('Otra');
    b.w.defineName('Tasa', '10');
    b.w.defineName('Tasa', '99', s2.id);
    b.set('A1', '=Tasa', s2.id);
    b.set('A2', '=Tasa*2', s2.id);
    expect(b.get('B1')).toBe(10);
    expect(b.get('A1', s2.id)).toBe(99);
    expect(b.get('A2', s2.id)).toBe(198);
    b.w.removeName('Tasa', s2.id);
    expect(b.get('A1', s2.id)).toBe(10);
  });
  it('a name that exists in one sheet is #NAME? in another', () => {
    const b = book();
    const s2 = b.w.addSheet('Otra');
    b.w.defineName('Solo', '5', b.id);
    b.set('A1', '=Solo');
    b.set('A1', '=Solo', s2.id);
    expect(b.get('A1')).toBe(5);
    expect(b.get('A1', s2.id)).toBe(err('#NAME?'));
    expect(b.w.namesFor(b.id).map((n) => n.name)).toEqual(['Solo']);
    expect(b.w.namesFor(s2.id)).toHaveLength(0);
  });
  it('follows edits of the cells it points at', () => {
    const b = book({ A1: '3', A2: '4' });
    b.w.defineName('Rango', 'Hoja1!$A$1:$A$2', b.id);
    b.set('C1', '=SUM(Rango)');
    expect(b.get('C1')).toBe(7);
    b.set('A2', '10');
    expect(b.get('C1')).toBe(13);
    b.w.shiftStructure(b.id, 'row', 0, 1);
    expect(b.get('C2')).toBe(13);
    expect(b.w.sheet(b.id).names.get('rango')!.text).toBe('Hoja1!$A$2:$A$3');
  });
});

describe('data validation', () => {
  const rule = (b: ReturnType<typeof book>, patch: Partial<DataValidation>, area = 'A1:A10') => {
    const v = { ...newValidation('v1', [rect(area)]), ...patch };
    b.w.editObjects(b.id, (s) => {
      s.validations.push(v);
    });
    return v;
  };
  const ok = (b: ReturnType<typeof book>, a: string, v: Scalar) => {
    const p = parseA1(a)!;
    return validateEntry(b.w, b.id, p.row, p.col, v).ok;
  };
  it('whole numbers between limits', () => {
    const b = book();
    rule(b, { type: 'whole', op: 'between', formula1: '1', formula2: '10' });
    expect([ok(b, 'A1', 5), ok(b, 'A1', 11), ok(b, 'A1', 5.5), ok(b, 'A1', 'x'), ok(b, 'A1', null), ok(b, 'B1', 99)]).toEqual([true, false, false, false, true, true]);
  });
  it('does not ignore blanks when asked', () => {
    const b = book();
    rule(b, { type: 'whole', allowBlank: false });
    expect(ok(b, 'A1', null)).toBe(false);
  });
  it('decimal, comparisons with another cell', () => {
    const b = book({ C1: '0.5' });
    rule(b, { type: 'decimal', op: 'greaterThan', formula1: '$C$1', formula2: undefined });
    expect([ok(b, 'A1', 0.6), ok(b, 'A1', 0.5), ok(b, 'A1', 'a')]).toEqual([true, false, false]);
  });
  it('relative references in the rule are relative to the cell being checked', () => {
    const b = book({ B1: '5', B2: '50' });
    rule(b, { type: 'decimal', op: 'lessThanOrEqual', formula1: 'B1', formula2: undefined }, 'A1:A2');
    expect([ok(b, 'A1', 4), ok(b, 'A1', 6), ok(b, 'A2', 40), ok(b, 'A2', 60)]).toEqual([true, false, true, false]);
  });
  it('dates and times', () => {
    const b = book();
    rule(b, { type: 'date', op: 'greaterThanOrEqual', formula1: 'DATE(2024,1,1)', formula2: undefined }, 'A1:A2');
    rule(b, { type: 'time', op: 'between', formula1: '0.375', formula2: '0.7083' }, 'B1:B2');
    expect([ok(b, 'A1', 45400), ok(b, 'A1', 40000), ok(b, 'B1', 0.5), ok(b, 'B1', 0.9), ok(b, 'B1', 45000.5)]).toEqual([true, false, true, false, true]);
  });
  it('text length', () => {
    const b = book();
    rule(b, { type: 'textLength', op: 'lessThanOrEqual', formula1: '3', formula2: undefined });
    expect([ok(b, 'A1', 'abc'), ok(b, 'A1', 'abcd'), ok(b, 'A1', 123), ok(b, 'A1', 1234)]).toEqual([true, false, true, false]);
  });
  it('lists: literal values are case sensitive, ranges are not', () => {
    const b = book({ D1: 'rojo', D2: 'verde' });
    rule(b, { type: 'list', formula1: '"Sí,No,Tal vez"' }, 'A1:A2');
    rule(b, { type: 'list', formula1: '$D$1:$D$2' }, 'B1:B2');
    expect([ok(b, 'A1', 'Sí'), ok(b, 'A1', 'sí'), ok(b, 'A1', 'Quizá'), ok(b, 'B1', 'ROJO'), ok(b, 'B1', 'azul')]).toEqual([true, false, false, true, false]);
    const sheet = b.w.sheet(b.id);
    expect(listChoices(b.w, sheet, sheet.validations[0]!, 0, 0)!.items).toEqual(['Sí', 'No', 'Tal vez']);
    expect(listChoices(b.w, sheet, sheet.validations[1]!, 0, 1)!.items).toEqual(['rojo', 'verde']);
    // a list from a column that grows picks up the new item
    b.set('D3', 'azul');
    expect(ok(b, 'B1', 'azul')).toBe(false);
  });
  it('a list can come from a table column or a name', () => {
    const b = book({ A1: 'Pais', A2: 'Chile', A3: 'Perú' });
    b.w.createTable(b.id, rect('A1:A3'), { id: 't1' });
    b.w.defineName('Paises', 'INDIRECT("Tabla1[Pais]")');
    rule(b, { type: 'list', formula1: 'INDIRECT("Tabla1[Pais]")' }, 'C1:C2');
    expect(ok(b, 'C1', 'Perú')).toBe(true);
    expect(ok(b, 'C1', 'Mali')).toBe(false);
  });
  it('custom formulas see the value being entered', () => {
    const b = book({ A1: 'x', A2: 'y' });
    rule(b, { type: 'custom', formula1: 'COUNTIF($A$1:$A$10,A1)=1' }, 'A1:A10');
    expect([ok(b, 'A3', 'z'), ok(b, 'A3', 'x'), ok(b, 'A2', 'y')]).toEqual([true, false, true]);
    expect(b.w.getValue(b.id, 2, 0)).toBe(null); // the cell was not left changed
  });
  it('finds the invalid cells already in the sheet', () => {
    const b = book({ A1: '5', A2: '50', A3: 'a', A5: '7' });
    rule(b, { type: 'whole', op: 'between', formula1: '1', formula2: '10' });
    expect(invalidCells(b.w, b.id)).toEqual([{ row: 1, col: 0 }, { row: 2, col: 0 }]);
  });
  it('moves with the cells and rewrites its formulas', () => {
    const b = book({ C1: '1' });
    rule(b, { type: 'decimal', op: 'greaterThan', formula1: '$C$1', formula2: undefined }, 'A1:A3');
    b.w.shiftStructure(b.id, 'row', 0, 2);
    const v = b.w.sheet(b.id).validations[0]!;
    expect(v.ranges[0]).toEqual({ r1: 2, c1: 0, r2: 4, c2: 0 });
    expect(v.formula1).toBe('$C$3');
    b.w.shiftStructure(b.id, 'row', 4, -1);
    expect(b.w.sheet(b.id).validations[0]!.ranges[0]).toEqual({ r1: 2, c1: 0, r2: 3, c2: 0 });
    b.w.shiftStructure(b.id, 'row', 2, -2);
    expect(b.w.sheet(b.id).validations).toHaveLength(0);
  });
  it('undo removes the rule', () => {
    const b = book();
    const p = b.w.editObjects(b.id, (s) => {
      s.validations.push(newValidation('v', [rect('A1')]));
    });
    expect(b.w.sheet(b.id).validations).toHaveLength(1);
    b.w.applyPatch(p, true);
    expect(b.w.sheet(b.id).validations).toHaveLength(0);
  });
});

describe('links, comments and other objects', () => {
  it('safe addresses only', () => {
    expect(safeUrl('https://x.org/a')).toBe('https://x.org/a');
    expect(safeUrl('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeUrl('a@b.co')).toBe('mailto:a@b.co');
    expect(safeUrl('www.x.org')).toBe('https://www.x.org');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('file:///C:/Windows/System32/calc.exe')).toBeNull();
    expect(safeUrl('C:\\Windows\\notepad.exe')).toBeNull();
  });
  it('links, comments and sparkline cells follow inserted rows', () => {
    const b = book();
    b.w.editObjects(b.id, (s) => {
      s.hyperlinks.push({ rect: rect('B3'), url: 'https://x.org' });
      s.comments.push({ row: 2, col: 1, author: 'Ana', text: 'hola' });
      s.sparklines.push({ id: 'g', type: 'line', color: '#000', negativeColor: '#f00', markerColor: '#f00', highColor: '#f00', lowColor: '#f00', firstColor: '#f00', lastColor: '#f00', showMarkers: false, showHigh: false, showLow: false, showFirst: false, showLast: false, showNegative: false, lineWeight: 1, emptyAs: 'gap', showHidden: false, rightToLeft: false, minType: 'auto', maxType: 'auto', showAxis: false, items: [{ row: 2, col: 5, source: 'Hoja1!A3:E3' }] });
      s.print.areas.push(rect('A1:C5'));
      s.print.rowBreaks.push(4);
    });
    b.w.shiftStructure(b.id, 'row', 0, 1);
    const s = b.w.sheet(b.id);
    expect(hyperlinkAt(s, 3, 1)?.url).toBe('https://x.org');
    expect(hyperlinkAt(s, 2, 1)).toBeUndefined();
    expect(commentAt(s, 3, 1)?.text).toBe('hola');
    expect(s.sparklines[0]!.items[0]).toEqual({ row: 3, col: 5, source: 'Hoja1!A4:E4' });
    expect(s.print.areas[0]).toEqual({ r1: 1, c1: 0, r2: 5, c2: 2 });
    expect(s.print.rowBreaks).toEqual([5]);
    b.w.shiftStructure(b.id, 'row', 3, -1);
    expect(b.w.sheet(b.id).comments).toHaveLength(0);
    expect(b.w.sheet(b.id).hyperlinks).toHaveLength(0);
  });
  it('a renamed sheet is renamed inside the objects', () => {
    const b = book();
    b.w.editObjects(b.id, (s) => {
      s.validations.push({ ...newValidation('v', [rect('A1')]), type: 'list', formula1: 'Hoja1!$D$1:$D$3' });
    });
    b.w.renameSheet(b.id, 'Datos');
    expect(b.w.sheet(b.id).validations[0]!.formula1).toBe('Datos!$D$1:$D$3');
  });
  it('stores a picture once', () => {
    const w = new Workbook();
    const k1 = w.addMedia('image/png', new Uint8Array([1, 2, 3]));
    const k2 = w.addMedia('image/png', new Uint8Array([1, 2, 3]));
    const k3 = w.addMedia('image/png', new Uint8Array([1, 2, 4]));
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
    expect(w.media.size).toBe(2);
  });
  it('the error constant is still usable', () => {
    expect(E.REF.code).toBe('#REF!');
  });
});
