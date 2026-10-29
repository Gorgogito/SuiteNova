import { newValidation, parseA1, type Rect, type Scalar } from '@suitenova/calc-engine';
import { describe, expect, it } from 'vitest';
import { CalcDoc } from './doc';
import { ENTRY_PENDING } from './doc-objects';

const rect = (a: string): Rect => {
  const [x, y] = a.split(':') as [string, string?];
  const p = parseA1(x)!;
  const q = parseA1(y ?? x)!;
  return { r1: p.row, c1: p.col, r2: q.row, c2: q.col };
};

function setup(cells: Record<string, string> = {}) {
  const d = new CalcDoc();
  d.locale = 'en';
  for (const [a, t] of Object.entries(cells)) {
    const p = parseA1(a)!;
    d.wb.setInput(d.activeSheetId, p.row, p.col, t);
  }
  const type = (a: string, text: string, move: Parameters<CalcDoc['commitEdit']>[0] = 'none') => {
    const p = parseA1(a)!;
    d.selectCell(p.row, p.col);
    d.beginEdit({ text, mode: 'enter' });
    return d.commitEdit(move);
  };
  const get = (a: string): Scalar => {
    const p = parseA1(a)!;
    return d.wb.getValue(d.activeSheetId, p.row, p.col);
  };
  const sel = (a: string) => {
    const r = rect(a);
    d.selectRange(r);
  };
  return { d, type, get, sel };
}

describe('data validation while typing', () => {
  const rule = (d: CalcDoc, patch: object, area = 'A1:A5') => d.x.setValidation({ ...newValidation('x', []), ...patch } as never, [rect(area)]);

  it('accepts a good entry and refuses a bad one with a stop alert', () => {
    const { d, type, get } = setup();
    rule(d, { type: 'whole', op: 'between', formula1: '1', formula2: '10', errorTitle: 'Ojo', errorMessage: 'Entre 1 y 10' });
    expect(type('A1', '5')).toBeNull();
    expect(get('A1')).toBe(5);
    expect(type('A2', '50')).toBe(ENTRY_PENDING);
    expect(d.x.alert).toMatchObject({ style: 'stop', title: 'Ojo', message: 'Entre 1 y 10' });
    expect(get('A2')).toBeNull();
    expect(d.edit).not.toBeNull(); // the editor stays open
    d.x.resolveAlert('retry');
    expect(d.x.alert).toBeNull();
    d.setEditText('7');
    expect(d.commitEdit()).toBeNull();
    expect(get('A2')).toBe(7);
  });
  it('a warning can be accepted, an information alert too, and cancelling drops the edit', () => {
    const { d, type, get } = setup();
    rule(d, { type: 'whole', op: 'between', formula1: '1', formula2: '10', errorStyle: 'warning' });
    expect(type('A1', '99', 'down')).toBe(ENTRY_PENDING);
    expect(d.x.resolveAlert('accept')).toBeNull();
    expect(get('A1')).toBe(99);
    expect(d.sel.active.row).toBe(1); // the move that was asked for happens
    rule(d, { type: 'whole', op: 'between', formula1: '1', formula2: '10', errorStyle: 'information' }, 'B1');
    expect(type('B1', '50')).toBe(ENTRY_PENDING);
    d.x.resolveAlert('cancel');
    expect(d.edit).toBeNull();
    expect(get('B1')).toBeNull();
  });
  it('a rule without an error message does not block', () => {
    const { d, type, get } = setup();
    rule(d, { type: 'whole', op: 'between', formula1: '1', formula2: '10', showError: false });
    expect(type('A1', '500')).toBeNull();
    expect(get('A1')).toBe(500);
  });
  it('formulas and pasted values are not checked, deleting is allowed', () => {
    const { d, type, get, sel } = setup({ A1: '5' });
    rule(d, { type: 'whole', op: 'between', formula1: '1', formula2: '10' });
    expect(type('A2', '=500')).toBeNull();
    expect(get('A2')).toBe(500);
    sel('A1');
    d.clearContents();
    expect(get('A1')).toBeNull();
  });
  it('list rule: picking an item writes it', () => {
    const { d, get } = setup();
    rule(d, { type: 'list', formula1: '"Sí,No"' });
    d.selectCell(0, 0);
    expect(d.x.chooseListValue('Sí')).toBeNull();
    expect(get('A1')).toBe('Sí');
  });
  it('is one undo step, and clearing a rule is too', () => {
    const { d } = setup();
    rule(d, { type: 'decimal', op: 'greaterThan', formula1: '0', formula2: undefined });
    expect(d.sheet.validations).toHaveLength(1);
    d.undo();
    expect(d.sheet.validations).toHaveLength(0);
    d.redo();
    d.sel.ranges = [rect('A1:A5')];
    d.x.clearValidation([rect('A2')]);
    expect(d.sheet.validations[0]!.ranges).toHaveLength(2); // the rule now covers A1 and A3:A5
    d.undo();
    expect(d.sheet.validations[0]!.ranges).toHaveLength(1);
  });
  it('replaces the rule of the cells it is applied to', () => {
    const { d } = setup();
    rule(d, { type: 'whole', op: 'between', formula1: '1', formula2: '10' }, 'A1:A5');
    rule(d, { type: 'decimal', op: 'greaterThan', formula1: '0', formula2: undefined }, 'A2:A3');
    const types = d.sheet.validations.map((v) => `${v.type}:${v.ranges.length}`).sort();
    expect(types).toEqual(['decimal:1', 'whole:2']);
  });
  it('circles the invalid values already in the sheet', () => {
    const { d } = setup({ A1: '5', A2: '50' });
    rule(d, { type: 'whole', op: 'between', formula1: '1', formula2: '10' });
    expect(d.x.invalid()).toEqual([{ row: 1, col: 0 }]);
  });
});

describe('links and notes', () => {
  it('inserts, follows and removes a hyperlink, with the link style', () => {
    const { d, get, sel } = setup();
    sel('A1');
    d.x.setHyperlink({ url: 'https://example.org', text: 'Sitio', tooltip: 'abrir' });
    expect(get('A1')).toBe('Sitio');
    expect(d.sheet.hyperlinks).toHaveLength(1);
    expect(d.wb.getStyle(d.activeSheetId, 0, 0)).toMatchObject({ color: '#0563c1', underline: true });
    const opened: string[] = [];
    expect(d.x.followHyperlink(d.sheet.hyperlinks[0]!, (u) => opened.push(u))).toBeNull();
    expect(opened).toEqual(['https://example.org']);
    expect(d.x.followHyperlink({ rect: rect('A1'), url: 'file:///C:/Windows/notepad.exe' }, (u) => opened.push(u))).toMatch(/seguridad/);
    expect(opened).toHaveLength(1);
    d.x.removeHyperlink();
    expect(d.sheet.hyperlinks).toHaveLength(0);
    expect(d.wb.getStyle(d.activeSheetId, 0, 0).underline).toBeFalsy();
    d.undo();
    expect(d.sheet.hyperlinks).toHaveLength(1);
  });
  it('an internal link goes to the place', () => {
    const { d } = setup();
    d.addSheet();
    d.activateSheet(d.wb.sheets[0]!.id);
    const err = d.x.followHyperlink({ rect: rect('A1'), location: `${d.wb.sheets[1]!.name}!C4` }, () => undefined);
    expect(err).toBeNull();
    expect(d.activeSheetId).toBe(d.wb.sheets[1]!.id);
    expect(d.sel.active).toEqual({ row: 3, col: 2 });
  });
  it('notes: save, edit, delete, visit in order, show all', () => {
    const { d } = setup();
    d.x.saveComment(2, 1, 'segunda', 'Ana');
    d.x.saveComment(0, 0, 'primera', 'Ana');
    expect(d.sheet.comments).toHaveLength(2);
    d.selectCell(0, 0);
    expect(d.x.commentAtActive()?.text).toBe('primera');
    expect(d.x.goToComment(1)).toBe(true);
    expect(d.sel.active).toEqual({ row: 2, col: 1 });
    d.x.goToComment(1);
    expect(d.sel.active).toEqual({ row: 0, col: 0 }); // wraps
    d.x.setAllCommentsVisible(true);
    expect(d.sheet.comments.every((c) => c.visible)).toBe(true);
    d.x.saveComment(0, 0, '  ', 'Ana'); // empty text removes it
    expect(d.sheet.comments).toHaveLength(1);
    d.undo();
    expect(d.sheet.comments).toHaveLength(2);
  });
});

describe('tables', () => {
  const data = { A1: 'K', B1: 'V', A2: 'x', B2: '1', A3: 'y', B3: '2' };
  it('creates one from the data around the cursor and undoes it', () => {
    const { d, sel } = setup(data);
    sel('A1');
    expect(d.x.createTable(true)).toBeNull();
    expect(d.sheet.tables[0]!.ref).toEqual(rect('A1:B3'));
    d.undo();
    expect(d.sheet.tables).toHaveLength(0);
  });
  it('typing under the table makes it grow, and calculated columns fill the new row', () => {
    const { d, type, get } = setup(data);
    d.x.createTable(true, rect('A1:B3'));
    type('C1', 'Doble');
    expect(d.sheet.tables[0]!.ref.c2).toBe(2); // typed beside the header: the table grew to include it
    type('C2', '=B2*2'); // a formula in an empty column fills the column
    expect(get('C3')).toBe(4);
    expect(d.sheet.tables[0]!.columns[2]!.calc).toBe('B2*2');
    type('A4', 'z');
    expect(d.sheet.tables[0]!.ref.r2).toBe(3);
    type('B4', '10');
    expect(get('C4')).toBe(20);
    d.undo();
    d.undo();
    expect(d.sheet.tables[0]!.ref.r2).toBe(2);
  });
  it('renaming a header in the sheet renames the column in the formulas', () => {
    const { d, type, get } = setup(data);
    d.x.createTable(true, rect('A1:B3'));
    type('E1', '=SUM(Tabla1[V])');
    expect(get('E1')).toBe(3);
    type('B1', 'Valor');
    expect(d.wb.getInputText(d.activeSheetId, 0, 4)).toBe('=SUM(Tabla1[Valor])');
    expect(get('E1')).toBe(3);
    d.undo();
    expect(d.wb.getInputText(d.activeSheetId, 0, 4)).toBe('=SUM(Tabla1[V])');
  });
  it('rename and bad names', () => {
    const { d } = setup(data);
    d.x.createTable(true, rect('A1:B3'));
    const id = d.sheet.tables[0]!.id;
    expect(d.x.renameTable(id, 'Mi tabla')).toMatch(/no es válido/);
    expect(d.x.renameTable(id, 'Ventas')).toBeNull();
    expect(d.sheet.tables[0]!.name).toBe('Ventas');
    expect(d.x.renameTable(id, 'A1')).toMatch(/no es válido/);
  });
  it('the totals row, the style and converting back to a range', () => {
    const { d, get } = setup(data);
    d.x.createTable(true, rect('A1:B3'));
    const id = d.sheet.tables[0]!.id;
    d.x.setTableTotals(id, true);
    d.x.setTableColumnTotal(id, 1, 'sum');
    expect(get('B4')).toBe(3);
    d.x.editTable(id, 'Estilo', (t) => void (t.style = 'TableStyleLight9'));
    expect(d.sheet.tables[0]!.style).toBe('TableStyleLight9');
    d.x.convertTableToRange(id);
    expect(d.sheet.tables).toHaveLength(0);
    expect(get('B4')).toBe(3);
  });
  it('a table keeps its own filter apart from the sheet filter', () => {
    const { d } = setup({ A1: 'K', A2: 'x', A3: 'y', A4: 'x', B1: 'V', B2: '1', B3: '2', B4: '3' });
    d.x.createTable(true, rect('A1:B4'));
    d.filterTable = d.sheet.tables[0]!.id;
    d.setColumnFilter(0, { values: ['x'] });
    expect([...d.sheet.filterHidden]).toEqual([2]);
    expect(d.autoFilter?.columns[0]).toEqual({ values: ['x'] });
    d.undo();
    expect(d.sheet.filterHidden.size).toBe(0);
  });
});

describe('sparklines', () => {
  it('one per row of the data, replacing what is there', () => {
    const { d } = setup({ A1: '1', B1: '3', A2: '4', B2: '2' });
    expect(d.x.insertSparklines('column', rect('A1:B2'), rect('D1:D2'))).toBeNull();
    expect(d.sheet.sparklines[0]!.items.map((i) => i.source)).toEqual(['Hoja1!$A$1:$B$1', 'Hoja1!$A$2:$B$2']);
    expect(d.x.insertSparklines('line', rect('A1:B2'), rect('D1:D3'))).toMatch(/no coincide/);
    d.x.insertSparklines('line', rect('A1:B1'), rect('D1'));
    expect(d.sheet.sparklines).toHaveLength(2);
    expect(d.sheet.sparklines[0]!.items).toHaveLength(1); // D1 now belongs to the new group
    d.undo();
    expect(d.sheet.sparklines[0]!.items).toHaveLength(2);
  });
  it('one per column of the data when the location is a row', () => {
    const { d } = setup({ A1: '1', B1: '3', C1: '5', A2: '4', B2: '2', C2: '6' });
    d.x.insertSparklines('line', rect('A1:C2'), rect('A5:C5'));
    expect(d.sheet.sparklines[0]!.items.map((i) => i.source)).toEqual(['Hoja1!$A$1:$A$2', 'Hoja1!$B$1:$B$2', 'Hoja1!$C$1:$C$2']);
  });
});

describe('names, printing and pictures', () => {
  it('names local to the sheet or the workbook', () => {
    const { d } = setup();
    expect(d.x.defineName('Tasa', '0.21', false)).toBeNull();
    expect(d.x.defineName('Tasa', '0.5', true)).toBeNull();
    expect(d.x.defineName('1A', '1', false)).toMatch(/no es válido/);
    expect(d.wb.definedName('Tasa', d.activeSheetId)).toBeDefined();
    expect(d.wb.namesFor(d.activeSheetId).filter((n) => n.name === 'Tasa')).toHaveLength(1);
    d.x.removeName('Tasa', 'sheet');
    expect(d.wb.namesFor(d.activeSheetId)[0]!.text).toBe('0.21');
  });
  it('print area, titles, page and breaks are undoable steps', () => {
    const { d, sel } = setup();
    sel('B2:D6');
    d.x.setPrintArea();
    expect(d.sheet.print.areas).toEqual([rect('B2:D6')]);
    sel('F1:G2');
    d.x.setPrintArea(true);
    expect(d.sheet.print.areas).toHaveLength(2);
    d.x.setPrintTitles({ r1: 0, r2: 0 }, undefined);
    d.x.setPage({ orientation: 'landscape', fitWidth: 1 });
    d.selectCell(10, 3);
    d.x.togglePageBreaks();
    expect(d.sheet.print.rowBreaks).toEqual([9]);
    expect(d.sheet.print.colBreaks).toEqual([2]);
    d.x.togglePageBreaks();
    expect(d.sheet.print.rowBreaks).toEqual([]);
    d.undo();
    d.undo();
    d.undo();
    expect(d.sheet.print.page.orientation).toBe('portrait');
    d.x.clearPrintArea();
    expect(d.sheet.print.areas).toEqual([]);
  });
  it('a picture is placed at the cursor, scaled, moved and deleted', () => {
    const { d } = setup();
    d.selectCell(2, 1);
    const id = d.x.insertImage('image/png', new Uint8Array([1, 2, 3]), 1200, 600, 'logo');
    const im = d.sheet.images[0]!;
    expect(im.width).toBe(480);
    expect(im.height).toBe(240);
    expect(im.x).toBe(64);
    expect(im.y).toBe(40);
    expect(d.x.selectedImage).toBe(id);
    d.x.updateImage(id, { x: 100, y: 120 });
    expect(d.sheet.images[0]).toMatchObject({ x: 100, y: 120 });
    d.x.deleteImage(id);
    expect(d.sheet.images).toHaveLength(0);
    d.undo();
    expect(d.sheet.images).toHaveLength(1);
  });
});

describe('pivot tables and slicers from the document', () => {
  const sales = { A1: 'Region', B1: 'Ventas', A2: 'Norte', B2: '10', A3: 'Sur', B3: '20', A4: 'Norte', B4: '5' };
  it('creates a pivot in a new place, edits fields through update, protects its cells and undoes', () => {
    const { d, type, get, sel } = setup(sales);
    d.addSheet();
    const target = d.activeSheetId;
    const res = d.x.createPivot({ sheet: d.wb.sheets[0]!.name, ref: 'A1:B4' }, target, 2, 0);
    expect(res.error).toBeUndefined();
    expect(d.x.pivotPane).toBe(res.id);
    expect(d.sheet.pivots[0]!.size).toEqual({ rows: 18, cols: 3 }); // the empty report
    expect(d.x.updatePivot(res.id!, 'Campos', (p) => {
      p.rows = ['Region'];
      p.values = [{ field: 'Ventas', agg: 'sum' }];
    })).toBeNull();
    expect(d.wb.getValue(target, 3, 0)).toBe('Norte');
    expect(d.wb.getValue(target, 3, 1)).toBe(15);
    // the cells of the pivot cannot be edited one by one
    sel('A4');
    d.clearContents();
    expect(d.wb.getValue(target, 3, 0)).toBe('Norte');
    expect(d.notice).toMatch(/tabla dinámica/);
    type('B4', '99');
    expect(d.wb.getValue(target, 3, 1)).toBe(15);
    // refreshing picks up changes in the source
    d.wb.setInput(d.wb.sheets[0]!.id, 1, 1, '100');
    expect(d.x.refreshPivot(res.id!)).toBeNull();
    expect(d.wb.getValue(target, 3, 1)).toBe(105);
    d.undo();
    expect(d.wb.getValue(target, 3, 1)).toBe(15);
    void get;
  });
  it('a pivot that would run over data is refused and leaves nothing behind', () => {
    const { d } = setup(sales);
    const id = d.activeSheetId;
    const res = d.x.createPivot({ sheet: d.sheet.name, ref: 'A1:B4' }, id, 0, 0);
    expect(res.error).toMatch(/ya tienen datos/);
    expect(d.sheet.pivots).toHaveLength(0);
  });
  it('a slicer filters its pivot and is removed with it', () => {
    const { d } = setup(sales);
    d.addSheet();
    const target = d.activeSheetId;
    const res = d.x.createPivot({ sheet: d.wb.sheets[0]!.name, ref: 'A1:B4' }, target, 0, 0);
    d.x.updatePivot(res.id!, 'Campos', (p) => {
      p.rows = ['Region'];
      p.values = [{ field: 'Ventas', agg: 'sum' }];
    });
    const sl = d.x.insertSlicer({ kind: 'pivot', id: res.id! }, 'Region');
    const items = d.wb.slicerItems(d.sheet.slicers[0]!);
    d.x.setSlicer(sl, [items.find((i) => i.label === 'Sur')!.key]);
    expect(d.wb.getValue(target, 1, 0)).toBe('Sur');
    expect(d.wb.getValue(target, 2, 0)).toBe('Total general');
    d.x.deletePivot(res.id!);
    expect(d.sheet.slicers).toHaveLength(0);
  });
});

describe('charts of every kind from the document', () => {
  const sales = { A1: 'Mes', B1: 'V', C1: 'M', D1: 'P', A2: 'Ene', B2: '10', C2: '0.1', D2: '5', A3: 'Feb', B3: '20', C3: '0.3', D3: '6', A4: 'Mar', B4: '15', C4: '0.2', D4: '7' };
  it('inserts every preset it can and says why it cannot for the others', () => {
    const { d, sel } = setup(sales);
    sel('A1:D4');
    for (const kind of ['column', 'columnStacked', 'column3d', 'bar3d', 'line3d', 'pie3d', 'doughnut', 'radarFilled', 'surface3d', 'surfaceContour', 'combo', 'comboLine']) {
      expect(d.insertChart(kind), kind).toBeNull();
    }
    expect(d.sheet.charts).toHaveLength(12);
    const combo = d.sheet.charts.find((c) => c.series.some((s) => s.secondary))!;
    expect(combo.series.map((s) => s.type)).toEqual(['column', 'line', 'line']);
    expect(d.sheet.charts.find((c) => c.type === 'surface')!.threeD).toBeTruthy();
    // a stock chart needs 3 to 5 series in a known order: 3 numeric columns is High-Low-Close
    expect(d.insertChart('stockHLC')).toBeNull();
    expect(d.insertChart('stockOHLC')).toMatch(/necesita 4 series/);
    sel('A1:B4');
    expect(d.insertChart('combo')).toMatch(/al menos dos series/);
    expect(d.insertChart('stockVOHLC')).toMatch(/5 series/);
  });
  it('converts the selected chart and keeps its data', () => {
    const { d, sel } = setup(sales);
    sel('A1:D4');
    d.insertChart('column');
    const id = d.selectedChart!;
    expect(d.convertChart('radar')).toBeNull();
    expect(d.chartById(id)).toMatchObject({ type: 'radar', radar: {} });
    expect(d.chartById(id)!.series).toHaveLength(3);
    expect(d.convertChart('pie')).toBeNull();
    expect(d.chartById(id)!.series).toHaveLength(1);
    d.undo();
    expect(d.chartById(id)!.type).toBe('radar');
  });
});
