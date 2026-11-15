import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, addControl, condLook, defaultFormLayout, loadSql, newControl, updateControl, validateLayout } from './index';

let db: BaseDb;
beforeAll(async () => {
  db = BaseDb.open(await loadSql());
  db.execute('CREATE TABLE T (id INTEGER PRIMARY KEY, a TEXT)');
});

describe('forms, second round', () => {
  it('the new controls are created with sensible defaults', () => {
    const l = defaultFormLayout(db.columns('T'), db);
    for (const type of ['option', 'list', 'image', 'line', 'rect', 'hyperlink', 'tabs'] as const) {
      const c = newControl(l, type);
      expect(c.type).toBe(type);
      expect(c.w).toBeGreaterThan(0);
    }
  });

  it('conditional formats apply when their expression holds, in order', () => {
    const c = { cond: [{ expr: '[Saldo] < 0', color: '#c00', bold: true }, { expr: '[Estado] = "Cerrado"', hide: true }, { expr: 'sin sentido ((', bg: 'red' }] };
    expect(condLook(c, { Saldo: -5, Estado: 'Abierto' })).toEqual({ color: '#c00', bold: true });
    expect(condLook(c, { Saldo: 5, Estado: 'Cerrado' })).toEqual({ hide: true });
    expect(condLook(c, null)).toEqual({});
  });

  it('validation catches a bad condition, an orphan tab and a picture without source', () => {
    let l = defaultFormLayout(db.columns('T'), db);
    const t = newControl(l, 'text', { field: 'a' });
    l = addControl(l, t);
    l = updateControl(l, t.id, { tab: { id: 'nope', page: 0 }, cond: [{ expr: '((', bg: 'red' }] });
    l = addControl(l, newControl(l, 'image'));
    const all = validateLayout(l, db, 'T').join('\n');
    expect(all).toMatch(/pestaña/);
    expect(all).toMatch(/condición/);
    expect(all).toMatch(/no tiene imagen/);
  });
});
