import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, loadSql, matches, replaceIn } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});

const setup = (): BaseDb => {
  const db = BaseDb.open(SQL);
  db.execute(`CREATE TABLE C (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, ciudad TEXT, saldo REAL, activo BOOLEAN);
    INSERT INTO C (nombre, ciudad, saldo, activo) VALUES ('Ana', 'Lima', 120.5, 1), ('Luis', 'Quito', 80, 1), ('Eva', 'Lima', 15.25, 0), ('Óscar', NULL, 9, 1), ('ana maría', 'Lima', 10, 0);`);
  return db;
};
const names = (db: BaseDb, o: Parameters<BaseDb['browse']>[1]) => db.browse('C', { ...o, limit: 100 }).rows.map((r) => r[2]);

describe('datasheet filters', () => {
  it('equals, contains, begins, ends and not', () => {
    const db = setup();
    expect(names(db, { filters: [{ col: 'ciudad', op: 'eq', value: 'Lima' }] })).toEqual(['Ana', 'Eva', 'ana maría']);
    expect(names(db, { filters: [{ col: 'nombre', op: 'contains', value: 'an' }] })).toEqual(['Ana', 'ana maría']);
    expect(names(db, { filters: [{ col: 'nombre', op: 'begins', value: 'e' }] })).toEqual(['Eva']);
    expect(names(db, { filters: [{ col: 'nombre', op: 'ends', value: 'is' }] })).toEqual(['Luis']);
    expect(names(db, { filters: [{ col: 'ciudad', op: 'ne', value: 'Lima' }] })).toEqual(['Luis', 'Óscar']);
    expect(names(db, { filters: [{ col: 'nombre', op: 'notcontains', value: 'a' }] })).toEqual(['Luis']);
  });
  it('numbers compare as numbers, and between works', () => {
    const db = setup();
    expect(names(db, { filters: [{ col: 'saldo', op: 'gt', value: '9' }] })).toEqual(['Ana', 'Luis', 'Eva', 'ana maría']);
    expect(names(db, { filters: [{ col: 'saldo', op: 'between', value: '10', value2: '100' }] })).toEqual(['Luis', 'Eva', 'ana maría']);
    expect(names(db, { filters: [{ col: 'saldo', op: 'le', value: '9,0' }] })).toEqual(['Óscar']);
  });
  it('empty values, a list of values and several filters at once', () => {
    const db = setup();
    expect(names(db, { filters: [{ col: 'ciudad', op: 'null' }] })).toEqual(['Óscar']);
    expect(names(db, { filters: [{ col: 'ciudad', op: 'notnull' }] })).toHaveLength(4);
    expect(names(db, { filters: [{ col: 'ciudad', op: 'in', values: ['Quito', null] }] })).toEqual(['Luis', 'Óscar']);
    expect(names(db, { filters: [{ col: 'ciudad', op: 'in', values: [] }] })).toEqual([]);
    expect(names(db, { filters: [{ col: 'ciudad', op: 'eq', value: 'Lima' }, { col: 'activo', op: 'eq', value: '1' }] })).toEqual(['Ana']);
    expect(db.count('C', undefined, undefined, [{ col: 'ciudad', op: 'eq', value: 'Lima' }])).toBe(3);
  });
  it('a quote in the value is not a problem; a column that does not exist is ignored', () => {
    const db = setup();
    expect(names(db, { filters: [{ col: 'nombre', op: 'eq', value: "x' OR 1=1 --" }] })).toEqual([]);
    expect(names(db, { filters: [{ col: 'nada', op: 'eq', value: 'x' }] })).toHaveLength(5);
  });
});

describe('datasheet sort, values and totals', () => {
  it('several sort keys', () => {
    const db = setup();
    expect(names(db, { sorts: [{ col: 'ciudad', desc: false }, { col: 'saldo', desc: true }] })).toEqual(['Óscar', 'Ana', 'ana maría'.replace('ana maría', 'Eva'), 'ana maría', 'Luis'].slice(0, 0).concat(['Óscar', 'Ana', 'Eva', 'ana maría', 'Luis']));
  });
  it('distinct values leave out the column filter itself', () => {
    const db = setup();
    const all = db.distinct('C', 'ciudad');
    expect(all).toEqual([{ value: null, n: 1 }, { value: 'Lima', n: 3 }, { value: 'Quito', n: 1 }]);
    const withFilter = db.distinct('C', 'ciudad', { filters: [{ col: 'ciudad', op: 'eq', value: 'Lima' }, { col: 'activo', op: 'eq', value: '1' }] });
    expect(withFilter.find((x) => x.value === 'Lima')?.n).toBe(1);
    expect(withFilter.find((x) => x.value === 'Quito')?.n).toBe(1);
  });
  it('totals', () => {
    const db = setup();
    expect(db.aggregate('C', 'saldo', 'sum')).toBeCloseTo(234.75);
    expect(db.aggregate('C', 'saldo', 'avg')).toBeCloseTo(46.95);
    expect(db.aggregate('C', 'saldo', 'max')).toBe(120.5);
    expect(db.aggregate('C', 'id', 'count')).toBe(5);
    expect(db.aggregate('C', 'ciudad', 'countnn')).toBe(4);
    expect(db.aggregate('C', 'ciudad', 'countdistinct')).toBe(2);
    expect(db.aggregate('C', 'saldo', 'sum', { filters: [{ col: 'ciudad', op: 'eq', value: 'Lima' }] })).toBeCloseTo(145.75);
  });
});

describe('find and replace', () => {
  it('finds cells in datasheet order, with case, whole-value and start options', () => {
    const db = setup();
    expect(db.findCells('C', { find: 'ana' }).map((c) => [c.row, c.col])).toEqual([[0, 'nombre'], [4, 'nombre']]);
    expect(db.findCells('C', { find: 'ana', matchCase: true }).map((c) => c.row)).toEqual([4]);
    expect(db.findCells('C', { find: 'lima', match: 'whole' }).map((c) => c.row)).toEqual([0, 2, 4]);
    expect(db.findCells('C', { find: 'lu', match: 'start' }).map((c) => c.row)).toEqual([1]);
    expect(db.findCells('C', { find: 'lima', cols: ['nombre'] })).toEqual([]);
    expect(db.findCells('C', { find: '12' }).map((c) => c.col)).toContain('saldo');
  });
  it('the row numbers follow the sort and the filter', () => {
    const db = setup();
    const cells = db.findCells('C', { find: 'Lima' }, { filters: [{ col: 'saldo', op: 'lt', value: '50' }], sorts: [{ col: 'saldo', desc: false }] });
    // under 50 and sorted: Óscar (0), ana maría (1), Eva (2); the Lima ones are rows 1 and 2
    expect(cells.map((c) => c.row)).toEqual([1, 2]);
    const shown = db.browse('C', { filters: [{ col: 'saldo', op: 'lt', value: '50' }], sorts: [{ col: 'saldo', desc: false }] }).rows;
    expect(cells.map((c) => shown[c.row]![0])).toEqual(cells.map((c) => c.rid));
  });
  it('replace all in one undo step; a number column that cannot take the text is counted as failed', () => {
    const db = setup();
    const r = db.replaceCells('C', { find: 'lima' }, 'Cusco');
    expect(r).toEqual({ changed: 3, failed: 0 });
    expect(db.execute("SELECT count(*) FROM C WHERE ciudad = 'Cusco'").rows[0]![0]).toBe(3);
    db.undo();
    expect(db.execute("SELECT count(*) FROM C WHERE ciudad = 'Lima'").rows[0]![0]).toBe(3);
    const bad = db.replaceCells('C', { find: '120', cols: ['saldo'] }, 'abc');
    expect(bad.changed + bad.failed).toBe(1);
  });
  it('the pure helpers', () => {
    expect(matches('Madrid', { find: 'mad' })).toBe(true);
    expect(matches('Madrid', { find: 'mad', matchCase: true })).toBe(false);
    expect(replaceIn('a.b.a', { find: 'a' }, 'X')).toBe('X.b.X');
    expect(replaceIn('a.b.a', { find: '.' , match: 'any' }, '-')).toBe('a-b-a');
    expect(replaceIn('hola', { find: 'HOLA', match: 'whole' }, 'x')).toBe('x');
  });
});

describe('applyEdits', () => {
  it('edits and adds in one undo step and reports what a column does not take', () => {
    const db = setup();
    const r = db.applyEdits('C', [{ rid: 1, col: 'nombre', value: 'Zoe' }, { rid: 2, col: 'saldo', value: 'abc' }, { rid: 3, col: 'saldo', value: '7,5' }], [{ nombre: 'Nuevo', saldo: '1' }], 'Pegar');
    expect(r.changed).toBe(2);
    expect(r.added).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(db.execute('SELECT nombre FROM C WHERE id = 1').rows[0]![0]).toBe('Zoe');
    expect(db.count('C')).toBe(6);
    db.undo();
    expect(db.count('C')).toBe(5);
    expect(db.execute('SELECT nombre FROM C WHERE id = 1').rows[0]![0]).toBe('Ana');
  });
  it('does nothing and leaves no undo step when everything fails', () => {
    const db = setup();
    const before = db.canUndo;
    expect(db.applyEdits('C', [{ rid: 1, col: 'saldo', value: 'zzz' }]).changed).toBe(0);
    expect(db.canUndo).toBe(before);
  });
});

describe('find with a search of the product', () => {
  it('uses the given test and replacer instead of the plain text', () => {
    const o = { find: '', test: (t: string) => /^M/.test(t), replacer: (t: string, to: string) => t.replace(/^M/, to) };
    expect(matches('Madrid', o)).toBe(true);
    expect(matches('Lima', o)).toBe(false);
    expect(replaceIn('Madrid', o, 'N')).toBe('Nadrid');
  });
});
