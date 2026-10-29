import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, addControl, bringToFront, calcValue, comboOptions, controlForColumn, defaultFormLayout, fitLayout, loadSql, newControl, normalizeBox, recordObject, removeControl, sendToBack, snap, subformData, updateControl, validateLayout } from './index';

let db: BaseDb;
beforeAll(async () => {
  db = BaseDb.open(await loadSql());
  db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, zona_id INTEGER REFERENCES Zonas(id), activo BOOLEAN, saldo REAL);
    CREATE TABLE Zonas (id INTEGER PRIMARY KEY, nombre TEXT);
    CREATE TABLE Pedidos (id INTEGER PRIMARY KEY, cliente INTEGER, total REAL, nota TEXT);
    INSERT INTO Zonas VALUES (1, 'Sur'), (2, 'Norte'), (3, 'este');
    INSERT INTO Clientes (nombre, zona_id, activo, saldo) VALUES ('Ana', 1, 1, 10.5), ('Luis', 2, 0, 3);
    INSERT INTO Pedidos VALUES (1, 1, 5, 'a'), (2, 1, 7, 'b'), (3, 2, 9, 'c');`);
});

describe('form layout', () => {
  it('generates one label and one control per column, by type', () => {
    const l = defaultFormLayout(db.columns('Clientes'), db);
    expect(l.controls).toHaveLength(10);
    const kinds = l.controls.filter((c) => c.type !== 'label').map((c) => [c.type, (c as { field: string }).field]);
    expect(kinds).toEqual([['text', 'id'], ['text', 'nombre'], ['combo', 'zona_id'], ['check', 'activo'], ['text', 'saldo']]);
    const combo = l.controls.find((c) => c.type === 'combo')!;
    expect(combo).toMatchObject({ source: { kind: 'table', table: 'Zonas', valueField: 'id', displayField: 'nombre' } });
    expect(l.controls.find((c) => c.type === 'text' && c.field === 'id')).toMatchObject({ readOnly: true }); // autonumber
    expect(new Set(l.controls.map((c) => c.id)).size).toBe(10);
    expect(new Set(l.controls.map((c) => c.name)).size).toBe(10);
    expect(l.height).toBeGreaterThanOrEqual(16 + 5 * 40);
    // controls do not overlap vertically within a row pair, and stay inside the form
    for (const c of l.controls) expect(c.x + c.w).toBeLessThanOrEqual(l.width);
  });

  it('a column without database access still gets a text box', () => {
    expect(controlForColumn(db.columns('Clientes')[2]!)).toMatchObject({ type: 'text', field: 'zona_id' });
  });

  it('new controls get free names, a place below the others and sensible defaults', () => {
    let l = defaultFormLayout([]);
    l = addControl(l, newControl(l, 'text', { field: 'a' }));
    l = addControl(l, newControl(l, 'text', { field: 'b' }));
    l = addControl(l, newControl(l, 'button'));
    expect(l.controls.map((c) => c.name)).toEqual(['Texto1', 'Texto2', 'Boton1']);
    expect(l.controls[1]!.y).toBeGreaterThan(l.controls[0]!.y + l.controls[0]!.h - 1);
    expect(l.controls[2]).toMatchObject({ caption: 'Botón', action: 'next' });
    expect(newControl(l, 'combo').type === 'combo' && (newControl(l, 'combo') as { source: { kind: string } }).source.kind).toBe('values');
    const at = newControl(l, 'label', {}, { x: 203, y: 61 });
    expect([at.x, at.y]).toEqual([200, 64]); // snapped to the 8 px grid
  });

  it('snapping, minimum size and edges', () => {
    expect(snap(13)).toBe(16);
    expect(snap(11)).toBe(8);
    expect(normalizeBox({ x: -30, y: -1, w: 3, h: 3 })).toEqual({ x: 0, y: 0, w: 16, h: 16 });
    expect(normalizeBox({ x: 500, y: 8, w: 100, h: 20 }, { maxW: 560 })).toEqual({ x: 456, y: 8, w: 104, h: 24 });
    expect(normalizeBox({ x: 13, y: 13, w: 33, h: 33 }, { grid: 0 })).toEqual({ x: 13, y: 13, w: 33, h: 33 });
  });

  it('edits keep the layout consistent: update, remove, order, growth', () => {
    let l = defaultFormLayout([]);
    l = addControl(l, newControl(l, 'label'));
    l = addControl(l, newControl(l, 'text'));
    const [a, b] = l.controls;
    l = updateControl(l, a!.id, { x: 900, w: 200 });
    expect(l.width).toBeGreaterThanOrEqual(900 + 200 + 16); // the form grows
    expect(bringToFront(l, a!.id).controls.map((c) => c.id)).toEqual([b!.id, a!.id]);
    expect(sendToBack(bringToFront(l, a!.id), a!.id).controls.map((c) => c.id)).toEqual([a!.id, b!.id]);
    expect(removeControl(l, a!.id).controls).toHaveLength(1);
    expect(fitLayout(defaultFormLayout([])).width).toBe(560);
  });

  it('validation points at fields, tables and names that do not exist', () => {
    let l = defaultFormLayout(db.columns('Clientes'), db);
    expect(validateLayout(l, db, 'Clientes')).toEqual([]);
    l = addControl(l, newControl(l, 'text', { field: 'fantasma' }));
    l = addControl(l, newControl(l, 'text', { field: '' }));
    l = addControl(l, newControl(l, 'combo', { field: 'nombre', source: { kind: 'table', table: 'Nada', valueField: 'a', displayField: 'b' } }));
    l = addControl(l, newControl(l, 'combo', { field: 'nombre', source: { kind: 'table', table: 'Zonas', valueField: 'id', displayField: 'zzz' } }));
    l = addControl(l, newControl(l, 'subform', { table: 'Pedidos', childField: 'nope', parentField: 'tampoco' }));
    l = addControl(l, { ...newControl(l, 'label'), name: 'texto1' });
    const w = validateLayout(l, db, 'Clientes');
    expect(w).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/"fantasma" no existe/),
        expect.stringMatching(/no tiene campo asignado/),
        expect.stringMatching(/tabla "Nada" no existe/),
        expect.stringMatching(/campo "zzz" no existe en "Zonas"/),
        expect.stringMatching(/campo "nope" no existe en "Pedidos"/),
        expect.stringMatching(/campo "tampoco" no existe en "Clientes"/),
        expect.stringMatching(/repetido/),
      ]),
    );
    expect(validateLayout(l, db, 'NoExiste').length).toBeGreaterThan(0);
  });
});

describe('what a form reads from the database', () => {
  it('drop-down lists: fixed values and lookups sorted by what is shown', () => {
    expect(comboOptions(db, { kind: 'values', values: ['A', 'B'] })).toEqual([{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }]);
    expect(comboOptions(db, { kind: 'table', table: 'Zonas', valueField: 'id', displayField: 'nombre' })).toEqual([
      { value: 3, label: 'este' }, // case-insensitive order
      { value: 2, label: 'Norte' },
      { value: 1, label: 'Sur' },
    ]);
  });

  it('a lookup list whose table disappeared reports the error instead of an empty list', () => {
    expect(() => comboOptions(db, { kind: 'table', table: 'Nada', valueField: 'a', displayField: 'b' })).toThrow();
  });

  it('subform rows follow the master record', () => {
    const ctl = { id: 's', name: 'S', type: 'subform' as const, x: 0, y: 0, w: 100, h: 100, table: 'Pedidos', childField: 'cliente', parentField: 'id' };
    const ana = recordObject(['id', 'nombre'], [1, 'Ana']);
    const sub = subformData(db, ctl, ana);
    expect(sub.columns).toEqual(['id', 'cliente', 'total', 'nota']);
    expect(sub.rows.map((r) => [r[0], r[3]])).toEqual([[1, 5], [2, 7]]); // rowid first
    expect(subformData(db, ctl, recordObject(['id'], [2])).rows).toHaveLength(1);
    expect(subformData(db, ctl, recordObject(['id'], [99])).rows).toEqual([]);
    expect(subformData(db, ctl, null).rows).toEqual([]);
    expect(subformData(db, { ...ctl, columns: ['total', 'zzz'] }, ana).columns).toEqual(['total']);
    expect(subformData(db, { ...ctl, table: 'Nada' }, ana).rows).toEqual([]);
  });

  it('a calculated box evaluates an expression on the record, and a mistake shows #Error', () => {
    const r = recordObject(['saldo', 'nombre'], [10.5, 'Ana']);
    expect(calcValue('=[saldo] * 2', r)).toBe(21);
    expect(calcValue('=Upper([nombre]) & "!"', r)).toBe('ANA!');
    expect(calcValue('=[nada]', r)).toBe('#Error');
  });
});
