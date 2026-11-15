import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, addControl, buildFormLayout, conditionToSql, defaultFormLayout, formFilterSql, formSorts, keyMatches, loadSql, moveInTabOrder, nestedData, newControl, newRecordDefaults, normalizeKey, subformData, tabOrder, updateControl, validateFormSettings, validateLayout } from './index';

let db: BaseDb;
beforeAll(async () => {
  db = BaseDb.open(await loadSql());
  db.execute(`CREATE TABLE Pedidos (id INTEGER PRIMARY KEY, cliente INTEGER, anio INTEGER, total REAL, estado TEXT, fecha TEXT);
    CREATE TABLE Lineas (id INTEGER PRIMARY KEY, cliente INTEGER, anio INTEGER, producto TEXT);
    CREATE TABLE Notas (id INTEGER PRIMARY KEY, linea INTEGER, texto TEXT);
    INSERT INTO Pedidos VALUES (1, 1, 2024, 10, 'Abierto', '2024-01-01'), (2, 1, 2025, 20, 'Cerrado', '2025-01-01'), (3, 2, 2024, 30, 'Abierto', '2024-02-01');
    INSERT INTO Lineas VALUES (1, 1, 2024, 'A'), (2, 1, 2025, 'B'), (3, 2, 2024, 'C');
    INSERT INTO Notas VALUES (1, 1, 'n1'), (2, 1, 'n2');`);
});
const cols = () => db.columns('Pedidos');

describe('form filter, order and defaults', () => {
  it('turns an Access condition into SQL and refuses nonsense', () => {
    expect(conditionToSql('[total] > 15 Y [estado] = "Abierto"')).toContain('"total" > 15');
    expect(() => conditionToSql('@@@')).toThrow(/No se entiende/);
  });
  it('the filter of the form and the user filter both apply', () => {
    const l = { ...defaultFormLayout(cols(), db), filter: '[anio]=2024' };
    const sql = formFilterSql(l, '[total]>15')!;
    const n = db.count('Pedidos', undefined, sql);
    expect(n).toBe(1);
    expect(formFilterSql(defaultFormLayout(cols(), db))).toBeUndefined();
    expect(formFilterSql(l, undefined, '"id" > 1')).toContain('"id" > 1');
  });
  it('order: the key of the user goes first', () => {
    const l = { ...defaultFormLayout(cols(), db), orderBy: [{ field: 'total', desc: true }, { field: 'anio' }] };
    expect(formSorts(l)).toEqual([{ col: 'total', desc: true }, { col: 'anio', desc: false }]);
    expect(formSorts(l, { col: 'anio', desc: true })).toEqual([{ col: 'anio', desc: true }, { col: 'total', desc: true }]);
    const rows = db.browse('Pedidos', { sorts: formSorts(l), limit: 10 }).rows.map((r) => r[0]);
    expect(rows).toEqual([3, 2, 1]);
  });
  it('default values: literals, expressions, and what fails is left out', () => {
    let l = defaultFormLayout(cols(), db);
    const est = newControl(l, 'text', { field: 'estado', defaultValue: 'Nuevo' });
    const fec = newControl(l, 'text', { field: 'fecha', defaultValue: '=Date()' });
    const bad = newControl(l, 'text', { field: 'total', defaultValue: '=Nada([x])' });
    for (const c of [est, fec, bad]) l = addControl(l, c);
    const d = newRecordDefaults(l, cols(), new Date(2025, 2, 4));
    expect(d.estado).toBe('Nuevo');
    expect(String(d.fecha)).toMatch(/2025/);
    expect('total' in d).toBe(false);
    const id = db.insertRow('Pedidos', d);
    expect(db.execute(`SELECT estado FROM Pedidos WHERE rowid=${id}`).rows[0]![0]).toBe('Nuevo');
  });
});

describe('form shortcuts, timer and settings checks', () => {
  it('normalises and matches shortcuts', () => {
    expect(normalizeKey('Ctrl+Shift+N')).toBe('ctrl+shift+n');
    expect(normalizeKey('shift+ctrl+n')).toBe('ctrl+shift+n');
    expect(normalizeKey('F5')).toBe('f5');
    expect(normalizeKey('Ctrl+')).toBeNull();
    expect(normalizeKey('Ctrl+Ctrl+A')).toBeNull();
    expect(normalizeKey('Hola')).toBeNull();
    expect(keyMatches('F5', { key: 'F5', ctrlKey: false, shiftKey: false, altKey: false })).toBe(true);
    expect(keyMatches('Ctrl+S', { key: 's', ctrlKey: true, shiftKey: false, altKey: false })).toBe(true);
    expect(keyMatches('Ctrl+S', { key: 's', ctrlKey: false, shiftKey: false, altKey: false })).toBe(false);
  });
  it('flags a bad filter, a missing order field, repeated keys and a timer without interval', () => {
    const l = {
      ...defaultFormLayout(cols(), db),
      filter: '@@',
      orderBy: [{ field: 'nada' }],
      keys: [{ key: 'F5', handler: { kind: 'macro' as const, name: 'M' } }, { key: 'f5', handler: { kind: 'macro' as const, name: 'M' } }, { key: 'zz', handler: { kind: 'macro' as const, name: '' } }],
      events: { onTimer: { kind: 'macro' as const, name: 'M' } },
    };
    const w = validateFormSettings(l, db, 'Pedidos').join('\n');
    expect(w).toContain('Filtro del formulario');
    expect(w).toContain('"nada"');
    expect(w).toContain('repetida');
    expect(w).toContain('atajo válido');
    expect(w).toContain('intervalo');
    expect(validateFormSettings({ ...l, filter: undefined, orderBy: [], keys: [], timerInterval: 500 }, db, 'Pedidos')).toEqual([]);
  });
  it('a default value that does not parse is reported on the control', () => {
    let l = defaultFormLayout(cols(), db);
    l = addControl(l, newControl(l, 'text', { field: 'total', defaultValue: '=1 +' }));
    expect(validateLayout(l, db, 'Pedidos').join('\n')).toContain('valor predeterminado');
  });
});

describe('subforms linked by several fields and nested', () => {
  it('extra links narrow the rows', () => {
    const l = defaultFormLayout(cols(), db);
    const sub = newControl(l, 'subform', { table: 'Lineas', childField: 'cliente', parentField: 'cliente', extraLinks: [{ child: 'anio', parent: 'anio' }] }) as Extract<ReturnType<typeof newControl>, { type: 'subform' }>;
    const one = subformData(db, sub, { id: 1, cliente: 1, anio: 2024 });
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0]![3]).toBe(2024);
    expect(subformData(db, { ...sub, extraLinks: [] }, { id: 1, cliente: 1, anio: 2024 }).rows).toHaveLength(2);
    expect(subformData(db, sub, { id: 1, cliente: 1, anio: null }).rows).toHaveLength(0);
  });
  it('the second level lists the rows linked to a row of the subform', () => {
    const l = defaultFormLayout(cols(), db);
    const sub = newControl(l, 'subform', { table: 'Lineas', childField: 'cliente', parentField: 'cliente', nested: { table: 'Notas', childField: 'linea', parentField: 'id' } }) as Extract<ReturnType<typeof newControl>, { type: 'subform' }>;
    expect(nestedData(db, sub, { id: 1, producto: 'A' }).rows.map((r) => r[3])).toEqual(['n1', 'n2']);
    expect(nestedData(db, sub, { id: 2 }).rows).toHaveLength(0);
    expect(nestedData(db, { ...sub, nested: undefined }, { id: 1 }).rows).toHaveLength(0);
  });
  it('validation checks the extra links and the second level', () => {
    let l = defaultFormLayout(cols(), db);
    l = addControl(l, newControl(l, 'subform', { table: 'Lineas', childField: 'cliente', parentField: 'cliente', extraLinks: [{ child: 'zzz', parent: 'anio' }], nested: { table: 'Notas', childField: 'linea', parentField: 'nada' } }));
    const w = validateLayout(l, db, 'Pedidos').join('\n');
    expect(w).toContain('"zzz"');
    expect(w).toContain('"nada"');
    const ok = updateControl(l, l.controls.find((c) => c.type === 'subform')!.id, { extraLinks: [], nested: { table: 'Notas', childField: 'linea', parentField: 'id' } });
    expect(validateLayout(ok, db, 'Pedidos')).toEqual([]);
  });
});

describe('wizard and tab order', () => {
  const names = ['id', 'cliente', 'total', 'estado'];
  it('builds the four styles with only the chosen fields', () => {
    const col = buildFormLayout(cols(), names, 'columnar', db, 'Pedidos');
    expect(col.controls.filter((c) => c.type !== 'label')).toHaveLength(4);
    expect(col.view).toBeUndefined();
    expect(col.caption).toBe('Pedidos');
    expect(buildFormLayout(cols(), ['total'], 'datasheet', db).view).toBe('datasheet');
    expect(buildFormLayout(cols(), ['total'], 'split', db).view).toBe('split');
    const tab = buildFormLayout(cols(), names, 'tabular', db);
    expect(tab.view).toBe('continuous');
    expect(tab.controls).toHaveLength(8);
    for (const c of tab.controls) expect(c.x + c.w).toBeLessThanOrEqual(tab.width);
    expect(buildFormLayout(cols(), ['nada', 'total'], 'columnar', db).controls.filter((c) => c.type !== 'label')).toHaveLength(1);
  });
  it('moves a control in the Tab order and skips non-stops', () => {
    let l = buildFormLayout(cols(), ['id', 'total', 'estado'], 'columnar', db);
    const texts = l.controls.filter((c) => c.type === 'text');
    expect(tabOrder(l).map((c) => c.id)).toEqual(texts.map((c) => c.id));
    const at = l.controls.findIndex((c) => c.id === texts[0]!.id);
    l = moveInTabOrder(l, texts[0]!.id, 1);
    expect(l.controls.findIndex((c) => c.id === texts[0]!.id)).toBe(at + 1);
    expect(moveInTabOrder(l, l.controls[0]!.id, -1)).toBe(l);
    l = updateControl(l, texts[2]!.id, { tabStop: false });
    expect(tabOrder(l).some((c) => c.id === texts[2]!.id)).toBe(false);
  });
});
