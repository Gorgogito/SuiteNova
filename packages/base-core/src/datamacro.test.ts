import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, loadSql, dataMacroTriggers, cleanMeta, type TableMeta } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});
const step = { action: 'Comment', args: {} };
const all: TableMeta['dataMacros'] = { beforeChange: { steps: [step] }, beforeDelete: { steps: [step] }, afterInsert: { steps: [step] }, afterUpdate: { steps: [step] }, afterDelete: { steps: [step] } };

function make() {
  const db = BaseDb.open(SQL);
  db.execute('CREATE TABLE T (id INTEGER PRIMARY KEY, nombre TEXT, saldo REAL); CREATE TABLE Log (msg TEXT)');
  db.clearUndo();
  const log: string[] = [];
  db.dataMacroHook = (table, event, rowid, row, old) => void log.push(`${table}|${event}|${rowid}|${JSON.stringify(row)}|${old ? JSON.stringify(old) : '-'}`);
  return { db, log };
}

describe('data macros: triggers', () => {
  it('cleanMeta keeps the events that have steps and drops the empty ones', () => {
    expect(cleanMeta({ fields: {}, dataMacros: { afterInsert: { steps: [] }, afterDelete: { steps: [step] } } })).toEqual({ fields: {}, dataMacros: { afterDelete: { steps: [step] } } });
    expect(cleanMeta({ fields: {}, dataMacros: { afterInsert: { steps: [] } } })).toBeNull();
  });
  it('makes the triggers with the prefix of the validation ones, and refuses a table with too many fields', () => {
    const sql = dataMacroTriggers('T', ['a', 'b'], { fields: {}, dataMacros: all });
    expect(sql).toHaveLength(6);
    expect(sql.every((s) => s.includes('"__nova_val_'))).toBe(true);
    const many = Array.from({ length: 61 }, (_, i) => `c${i}`);
    expect(() => dataMacroTriggers('T', many, { fields: {}, dataMacros: all })).toThrow(/hasta 60 campos/);
    expect(dataMacroTriggers('T', ['a'], { fields: {} })).toEqual([]);
  });
});

describe('data macros: the hook runs for every way of changing a record', () => {
  it('insert, update and delete call the events with the new and the old values', () => {
    const { db, log } = make();
    db.setMeta('T', { fields: {}, dataMacros: all });
    db.execute(`INSERT INTO T (nombre, saldo) VALUES ('Ana', 10)`);
    db.execute(`UPDATE T SET saldo = 12 WHERE id = 1`);
    db.execute(`DELETE FROM T WHERE id = 1`);
    expect(log).toEqual([
      'T|beforeChange:insert|1|{"id":1,"nombre":"Ana","saldo":10}|-',
      'T|afterInsert|1|{"id":1,"nombre":"Ana","saldo":10}|-',
      'T|beforeChange:update|1|{"id":1,"nombre":"Ana","saldo":12}|{"id":1,"nombre":"Ana","saldo":10}',
      'T|afterUpdate|1|{"id":1,"nombre":"Ana","saldo":12}|{"id":1,"nombre":"Ana","saldo":10}',
      'T|beforeDelete|1|{"id":1,"nombre":"Ana","saldo":12}|{"id":1,"nombre":"Ana","saldo":12}',
      'T|afterDelete|1|{"id":1,"nombre":"Ana","saldo":12}|{"id":1,"nombre":"Ana","saldo":12}',
    ]);
  });
  it('the methods of the engine (insertRow, updateCell, deleteRows) fire them too', () => {
    const { db, log } = make();
    db.setMeta('T', { fields: {}, dataMacros: { afterInsert: { steps: [step] }, afterUpdate: { steps: [step] }, afterDelete: { steps: [step] } } });
    const id = db.insertRow('T', { nombre: 'Zoe' });
    db.updateCell('T', id, 'saldo', '5');
    db.deleteRows('T', [id]);
    expect(log.map((l) => l.split('|')[1])).toEqual(['afterInsert', 'afterUpdate', 'afterDelete']);
  });
  it('a hook that throws refuses the statement and nothing is written', () => {
    const { db } = make();
    db.setMeta('T', { fields: {}, dataMacros: { beforeChange: { steps: [step] }, beforeDelete: { steps: [step] } } });
    db.dataMacroHook = (_t, event, _id, row) => {
      if (event.startsWith('beforeChange') && Number(row.saldo) < 0) throw new Error('El saldo no puede ser negativo.');
      if (event === 'beforeDelete') throw new Error('No se borra.');
    };
    db.execute(`INSERT INTO T (nombre, saldo) VALUES ('Ok', 1)`);
    expect(() => db.execute(`INSERT INTO T (nombre, saldo) VALUES ('Mal', -1)`)).toThrow(/saldo no puede ser negativo/);
    expect(() => db.execute('UPDATE T SET saldo = -5')).toThrow(/negativo/);
    expect(() => db.execute('DELETE FROM T')).toThrow(/No se borra/);
    expect(db.execute('SELECT nombre, saldo FROM T').rows).toEqual([['Ok', 1]]);
  });
  it('the hook can change other tables and the row itself, and it survives undo, redo and renaming', () => {
    const { db } = make();
    db.setMeta('T', { fields: {}, dataMacros: { afterInsert: { steps: [step] }, beforeChange: { steps: [step] } } });
    db.dataMacroHook = (table, event, rowid, row) => {
      if (event === 'afterInsert') db.execute(`INSERT INTO Log VALUES ('nuevo ${String(row.nombre)}')`);
      if (event === 'beforeChange:insert' && row.saldo === null) db.execute(`UPDATE T SET saldo = 0 WHERE rowid = ${rowid} AND saldo IS NULL`);
      void table;
    };
    db.dataMacroHook = ((inner) => (t, e, r, row, old) => {
      if (e === 'beforeChange:insert' && row.saldo === null) {
        // fixing the row from inside would fire beforeChange again: the hook of the program stops it
        db.dataMacroHook = null;
        db.execute(`UPDATE T SET saldo = 99 WHERE rowid = ${r}`);
        db.dataMacroHook = inner2;
      }
      inner(t, e, r, row, old);
    })(db.dataMacroHook!);
    const inner2 = db.dataMacroHook;
    db.execute(`INSERT INTO T (nombre) VALUES ('Ana')`);
    expect(db.execute('SELECT saldo FROM T').rows).toEqual([[99]]);
    expect(db.execute('SELECT msg FROM Log').rows).toEqual([['nuevo Ana']]);
    db.execute(`INSERT INTO T (nombre, saldo) VALUES ('Beto', 1)`);
    db.undo();
    db.execute(`INSERT INTO T (nombre, saldo) VALUES ('Cris', 2)`);
    expect(db.execute('SELECT msg FROM Log ORDER BY rowid').rows).toEqual([['nuevo Ana'], ['nuevo Cris']]);
    db.undo();
    db.redo();
    db.renameTable('T', 'Clientes');
    db.setMeta('Clientes', db.getMeta('T') ?? { fields: {} }, false);
    const seen: string[] = [];
    db.dataMacroHook = (table, event) => void seen.push(`${table}:${event}`);
    db.execute(`INSERT INTO Clientes (nombre, saldo) VALUES ('Dani', 3)`);
    expect(seen.length).toBeGreaterThan(0);
  });
  it('macros that call each other without end are stopped', () => {
    const { db } = make();
    db.setMeta('T', { fields: {}, dataMacros: { afterInsert: { steps: [step] } } });
    db.dataMacroHook = (_t, _e, _r, row) => void db.execute(`INSERT INTO T (nombre) VALUES ('${String(row.nombre)}+')`);
    expect(() => db.execute(`INSERT INTO T (nombre) VALUES ('x')`)).toThrow(/más de 8 veces/);
    expect(db.count('T')).toBe(0);
  });
  it('removing the macros removes the triggers', () => {
    const { db, log } = make();
    db.setMeta('T', { fields: {}, dataMacros: all });
    db.setMeta('T', { fields: {} });
    db.execute(`INSERT INTO T (nombre) VALUES ('Ana')`);
    expect(log).toEqual([]);
    expect(db.execute(`SELECT count(*) FROM sqlite_master WHERE type='trigger'`).rows).toEqual([[0]]);
  });
});
