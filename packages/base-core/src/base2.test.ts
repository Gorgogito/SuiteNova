import { beforeAll, describe, expect, it } from 'vitest';
import { AlterLossError, BaseDb, compileDesign, designToSql, loadSql, newColumn, newDesign, sqlParams, type ColumnDef, type DesignField, type QueryDesign } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});
const col = (name: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({ ...newColumn(name, type), ...extra });
const fresh = () => BaseDb.open(SQL);
const field = (table: string, name: string, extra: Partial<DesignField> = {}): DesignField => ({ table, name, show: true, sort: null, criteria: '', ...extra });
const values = (db: BaseDb, sql: string) => db.execute(sql).rows;

describe('redesigning a table keeps what depends on it', () => {
  function setup(): BaseDb {
    const db = fresh();
    db.execute(`CREATE TABLE P (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, precio REAL, activo INTEGER);
      INSERT INTO P (nombre, precio, activo) VALUES ('Ab', 10, 1), ('cd', 20, 0), ('Ef', 30, 1);
      CREATE INDEX ix_lower ON P (lower(nombre));
      CREATE INDEX ix_activos ON P (precio) WHERE activo = 1;
      CREATE UNIQUE INDEX ux_nombre ON P (nombre);
      CREATE VIEW V_caros AS SELECT nombre, precio FROM P WHERE precio > 15;
      CREATE TABLE Log (msg TEXT);
      CREATE TRIGGER t_ins AFTER INSERT ON P BEGIN INSERT INTO Log VALUES ('nuevo ' || NEW.nombre); END;`);
    return db;
  }
  const names = (db: BaseDb, type: string) => db.execute(`SELECT name FROM sqlite_master WHERE type='${type}' ORDER BY name`).rows.flat();
  const asDefs = (db: BaseDb) => db.columns('P').map((c) => ({ ...c, orig: c.name }));

  it('keeps expression and partial indexes, views and triggers when a column is added', () => {
    const db = setup();
    const r = db.alterTable('P', [...asDefs(db), col('stock', 'INTEGER', { defaultValue: '0' })]);
    expect(r.skipped).toEqual([]);
    expect(r.kept).toEqual({ indexes: 3, views: 1, triggers: 1 });
    expect(names(db, 'index')).toEqual(expect.arrayContaining(['ix_lower', 'ix_activos', 'ux_nombre']));
    const sql = String(db.execute(`SELECT sql FROM sqlite_master WHERE name='ix_activos'`).rows[0]![0]);
    expect(sql).toMatch(/WHERE activo = 1/);
    expect(String(db.execute(`SELECT sql FROM sqlite_master WHERE name='ix_lower'`).rows[0]![0])).toMatch(/lower\(nombre\)/);
    expect(values(db, 'SELECT nombre FROM V_caros ORDER BY nombre')).toEqual([['Ef'], ['cd']]);
    db.execute(`INSERT INTO P (nombre, precio, activo) VALUES ('Zz', 1, 1)`);
    expect(values(db, 'SELECT msg FROM Log')).toEqual([['nuevo Zz']]); // the trigger still fires
    expect(() => db.execute(`INSERT INTO P (nombre) VALUES ('Zz')`)).toThrow(/UNIQUE/i);
    expect(values(db, 'SELECT count(*) FROM P')).toEqual([[4]]);
  });

  it('a renamed column is renamed inside views, triggers and indexes too', () => {
    const db = setup();
    db.alterTable('P', asDefs(db).map((c) => (c.name === 'nombre' ? { ...c, name: 'titulo' } : c)));
    expect(values(db, 'SELECT titulo FROM V_caros ORDER BY titulo')).toEqual([['Ef'], ['cd']]);
    db.execute(`INSERT INTO P (titulo, precio) VALUES ('Nuevo', 5)`);
    expect(values(db, 'SELECT msg FROM Log')).toEqual([['nuevo Nuevo']]);
    expect(String(db.execute(`SELECT sql FROM sqlite_master WHERE name='ix_lower'`).rows[0]![0])).toMatch(/lower\(["']?titulo/);
    expect(db.columns('P').map((c) => c.name)).toContain('titulo');
  });

  it('reports (and drops) the views, triggers and indexes that lose their column', () => {
    const db = setup();
    const r = db.alterTable('P', asDefs(db).filter((c) => c.name !== 'nombre'));
    const skipped = r.skipped.map((s) => `${s.kind}:${s.name}`).sort();
    expect(skipped).toEqual(['index:ix_lower', 'index:ux_nombre', 'trigger:t_ins', 'view:V_caros']);
    expect(r.kept.indexes).toBe(1); // the partial index on precio survives
    expect(names(db, 'view')).toEqual([]);
    expect(names(db, 'trigger')).toEqual([]);
    expect(values(db, 'SELECT count(*) FROM P')).toEqual([[3]]);
    expect(() => db.execute(`INSERT INTO P (precio) VALUES (1)`)).not.toThrow();
  });

  it('a view that quotes a removed column is dropped, not left returning the column name as text', () => {
    const db = setup();
    // after a rename SQLite writes the view with "double quotes"; a missing quoted name would silently become a string literal
    db.alterTable('P', asDefs(db).map((c) => (c.name === 'nombre' ? { ...c, name: 'titulo' } : c)));
    expect(String(values(db, `SELECT sql FROM sqlite_master WHERE name='V_caros'`)[0]![0])).toMatch(/"titulo"/);
    const r = db.alterTable('P', db.columns('P').filter((c) => c.name !== 'titulo').map((c) => ({ ...c, orig: c.name })));
    expect(r.skipped.map((s) => `${s.kind}:${s.name}`)).toEqual(expect.arrayContaining(['view:V_caros', 'trigger:t_ins', 'index:ix_lower', 'index:ux_nombre']));
    expect(r.skipped.find((s) => s.name === 'V_caros')!.reason).toMatch(/titulo/);
    expect(names(db, 'view')).toEqual([]);
  });

  it('swapping the names of two columns keeps each column\'s data', () => {
    const db = fresh();
    db.execute(`CREATE TABLE S (a TEXT, b TEXT); INSERT INTO S VALUES ('1','2')`);
    db.alterTable('S', [{ ...col('b', 'TEXT'), orig: 'a' }, { ...col('a', 'TEXT'), orig: 'b' }]);
    expect(values(db, 'SELECT a, b FROM S')).toEqual([['2', '1']]);
  });

  it('keeps the autoincrement counter so ids of deleted rows are not reused', () => {
    const db = setup();
    db.execute('DELETE FROM P WHERE id = 3');
    db.alterTable('P', asDefs(db));
    db.execute(`INSERT INTO P (nombre) VALUES ('nuevo')`);
    expect(values(db, `SELECT max(id) FROM P`)).toEqual([[4]]);
  });

  it('warns before rebuilding a table that has constraints it cannot carry over', () => {
    const db = fresh();
    db.execute(`CREATE TABLE C (n INTEGER CHECK (n > 0), t TEXT COLLATE NOCASE)`);
    expect(() => db.alterTable('C', db.columns('C').map((c) => ({ ...c, orig: c.name })))).toThrow(AlterLossError);
    try {
      db.alterTable('C', db.columns('C').map((c) => ({ ...c, orig: c.name })));
    } catch (e) {
      expect((e as AlterLossError).losses).toEqual(['restricciones CHECK', 'intercalaciones (COLLATE)']);
    }
    db.alterTable('C', db.columns('C').map((c) => ({ ...c, orig: c.name })), { acceptLoss: true });
    expect(db.columns('C')).toHaveLength(2);
  });

  it('a failed rebuild leaves tables, views and triggers exactly as they were', () => {
    const db = setup();
    db.clearUndo();
    const before = names(db, 'view').concat(names(db, 'trigger'), names(db, 'index'));
    // a required column without a default cannot be filled for the existing rows
    expect(() => db.alterTable('P', [...asDefs(db), col('x', 'TEXT', { notNull: true })])).toThrow(/NOT NULL/);
    expect(db.columns('P').map((c) => c.name)).toEqual(['id', 'nombre', 'precio', 'activo']);
    expect(names(db, 'view').concat(names(db, 'trigger'), names(db, 'index'))).toEqual(before);
    expect(names(db, 'table')).not.toContain('__nova_tmp_P');
    expect(db.count('P')).toBe(3);
    expect(db.canUndo).toBe(false); // nothing happened, so there is nothing to undo
    db.execute(`INSERT INTO P (nombre) VALUES ('q')`);
    expect(values(db, 'SELECT msg FROM Log')).toEqual([['nuevo q']]);
    expect(() => db.alterTable('P', asDefs(db).map((c) => ({ ...c, name: 'id' })))).toThrow(/repetido/);
  });
});

describe('relationships', () => {
  function setup(): BaseDb {
    const db = fresh();
    db.createTable('Clientes', [col('id', 'INTEGER', { primaryKey: true, autoIncrement: true }), col('nombre', 'TEXT')]);
    db.createTable('Pedidos', [col('id', 'INTEGER', { primaryKey: true }), col('cliente', 'INTEGER'), col('total', 'REAL')]);
    db.execute(`INSERT INTO Clientes (nombre) VALUES ('Ana'), ('Luis'); INSERT INTO Pedidos VALUES (1, 1, 10), (2, 1, 20), (3, 2, 5)`);
    return db;
  }
  const rel = (extra: object = {}) => ({ child: 'Pedidos', childCols: ['cliente'], parent: 'Clientes', parentCols: ['id'], onDelete: 'NO ACTION' as const, onUpdate: 'NO ACTION' as const, ...extra });

  it('lists the relationships with their actions', () => {
    const db = setup();
    expect(db.relations()).toEqual([]);
    db.setRelation(rel({ onDelete: 'CASCADE', onUpdate: 'SET NULL' }));
    expect(db.relations()).toEqual([rel({ onDelete: 'CASCADE', onUpdate: 'SET NULL' })]);
    expect(db.columns('Pedidos')[1]!.references).toMatchObject({ table: 'Clientes', column: 'id', onDelete: 'CASCADE' });
    expect(db.count('Pedidos')).toBe(3); // data kept
  });

  it('cascade delete removes the child rows', () => {
    const db = setup();
    db.setRelation(rel({ onDelete: 'CASCADE' }));
    db.execute('DELETE FROM Clientes WHERE id = 1');
    expect(values(db, 'SELECT id FROM Pedidos')).toEqual([[3]]);
  });

  it('SET NULL clears the key and RESTRICT blocks the delete', () => {
    const db = setup();
    db.setRelation(rel({ onDelete: 'SET NULL' }));
    db.execute('DELETE FROM Clientes WHERE id = 2');
    expect(values(db, 'SELECT cliente FROM Pedidos WHERE id = 3')).toEqual([[null]]);
    db.setRelation(rel({ onDelete: 'RESTRICT' }));
    expect(() => db.execute('DELETE FROM Clientes WHERE id = 1')).toThrow(/FOREIGN KEY/i);
  });

  it('cascade update follows a changed parent key', () => {
    const db = setup();
    db.setRelation(rel({ onUpdate: 'CASCADE' }));
    db.execute('UPDATE Clientes SET id = 10 WHERE id = 1');
    expect(values(db, 'SELECT cliente FROM Pedidos ORDER BY id')).toEqual([[10], [10], [2]]);
  });

  it('refuses a relationship that existing data would break, and parents that are not unique', () => {
    const db = setup();
    db.execute('INSERT INTO Pedidos VALUES (9, 99, 1)');
    expect(() => db.setRelation(rel())).toThrow(/correspondencia/);
    expect(db.relations()).toEqual([]);
    expect(db.count('Pedidos')).toBe(4);
    expect(() => db.setRelation(rel({ parentCols: ['nombre'] }))).toThrow(/clave principal/);
    expect(() => db.setRelation(rel({ parentCols: ['zzz'] }))).toThrow(/No existe/);
  });

  it('removes a relationship and keeps the rest', () => {
    const db = setup();
    db.createTable('Notas', [col('id', 'INTEGER', { primaryKey: true }), col('cli', 'INTEGER'), col('ped', 'INTEGER')]);
    db.setRelation(rel());
    db.setRelation({ child: 'Notas', childCols: ['cli'], parent: 'Clientes', parentCols: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' });
    db.setRelation({ child: 'Notas', childCols: ['ped'], parent: 'Pedidos', parentCols: ['id'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION' });
    expect(db.relations()).toHaveLength(3);
    db.removeRelation('Notas', ['cli']);
    expect(db.relations().map((r) => `${r.child}.${r.childCols}`).sort()).toEqual(['Notas.ped', 'Pedidos.cliente']);
  });

  it('keeps composite relationships across a redesign and can remove them', () => {
    const db = fresh();
    db.execute(`CREATE TABLE Padre (a INTEGER, b INTEGER, PRIMARY KEY (a, b));
      CREATE TABLE Hijo (id INTEGER PRIMARY KEY, x INTEGER, y INTEGER, FOREIGN KEY (x, y) REFERENCES Padre (a, b) ON DELETE CASCADE);
      INSERT INTO Padre VALUES (1, 2); INSERT INTO Hijo VALUES (1, 1, 2)`);
    expect(db.relations()).toEqual([{ child: 'Hijo', childCols: ['x', 'y'], parent: 'Padre', parentCols: ['a', 'b'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' }]);
    db.alterTable('Hijo', [...db.columns('Hijo').map((c) => ({ ...c, orig: c.name })), col('nota', 'TEXT')]);
    expect(db.relations()).toHaveLength(1);
    db.execute('DELETE FROM Padre');
    expect(db.count('Hijo')).toBe(0); // the cascade still works
    db.removeRelation('Hijo', ['x', 'y']);
    expect(db.relations()).toEqual([]);
  });
});

describe('undo and redo of data', () => {
  function setup(): BaseDb {
    const db = fresh();
    db.createTable('T', [col('id', 'INTEGER', { primaryKey: true }), col('v', 'TEXT')]);
    db.execute(`INSERT INTO T VALUES (1, 'a'), (2, 'b'), (3, 'c')`);
    db.clearUndo();
    return db;
  }

  it('undoes and redoes a cell edit, an insert and a delete', () => {
    const db = setup();
    db.updateCell('T', 1, 'v', 'X');
    const id = db.insertRow('T', { v: 'nuevo' });
    db.deleteRows('T', [2, 3]);
    expect(db.undoLabel).toMatch(/Eliminar 2 registros/);
    expect(values(db, 'SELECT v FROM T ORDER BY id')).toEqual([['X'], ['nuevo']]);
    expect(db.undo()).toMatch(/Eliminar 2/);
    expect(values(db, 'SELECT v FROM T ORDER BY id')).toEqual([['X'], ['b'], ['c'], ['nuevo']]);
    db.undo();
    expect(db.count('T')).toBe(3);
    expect(id).toBe(4);
    db.undo();
    expect(values(db, 'SELECT v FROM T WHERE id = 1')).toEqual([['a']]);
    expect(db.canUndo).toBe(false);
    expect(db.undo()).toBeNull();
    db.redo();
    expect(values(db, 'SELECT v FROM T WHERE id = 1')).toEqual([['X']]);
    expect(db.canRedo).toBe(true);
    db.redo();
    db.redo();
    expect(values(db, 'SELECT v FROM T ORDER BY id')).toEqual([['X'], ['nuevo']]);
    expect(db.canRedo).toBe(false);
  });

  it('a new change clears the redo history', () => {
    const db = setup();
    db.updateCell('T', 1, 'v', 'X');
    db.undo();
    expect(db.canRedo).toBe(true);
    db.updateCell('T', 2, 'v', 'Y');
    expect(db.canRedo).toBe(false);
  });

  it('undoes action queries, schema changes and redesigns', () => {
    const db = setup();
    db.execute(`UPDATE T SET v = 'zz'`);
    expect(values(db, 'SELECT DISTINCT v FROM T')).toEqual([['zz']]);
    db.undo();
    expect(values(db, 'SELECT v FROM T ORDER BY id')).toEqual([['a'], ['b'], ['c']]);
    db.dropTable('T');
    expect(db.tableNames()).toEqual([]);
    db.undo();
    expect(db.count('T')).toBe(3);
    db.alterTable('T', [...db.columns('T').map((c) => ({ ...c, orig: c.name })), col('n', 'INTEGER')]);
    expect(db.columns('T')).toHaveLength(3);
    db.undo();
    expect(db.columns('T')).toHaveLength(2);
    db.createTable('U', [col('a', 'TEXT')]);
    db.undo();
    expect(db.tableNames()).toEqual(['T']);
  });

  it('a failed change or a plain SELECT does not take an undo step', () => {
    const db = setup();
    expect(() => db.updateCell('T', 1, 'id', 'no es número')).toThrow();
    expect(() => db.insertRow('T', { id: 1 })).toThrow();
    expect(() => db.execute('UPDATE nope SET a = 1')).toThrow();
    db.execute('SELECT * FROM T');
    db.execute(`SELECT 'update me' AS t`);
    expect(db.canUndo).toBe(false);
  });

  it('saved queries, forms and reports survive an undo of the data', () => {
    const db = setup();
    db.updateCell('T', 1, 'v', 'X');
    db.saveObject('query', 'Q', { sql: 'select 1' });
    db.undo();
    expect(values(db, 'SELECT v FROM T WHERE id = 1')).toEqual([['a']]);
    expect(db.getObject('query', 'Q')).toEqual({ sql: 'select 1' });
    db.redo();
    expect(db.getObject('query', 'Q')).toEqual({ sql: 'select 1' });
  });

  it('keeps foreign keys enforced after undo, and the file exports normally', () => {
    const db = setup();
    db.createTable('H', [col('t', 'INTEGER', { references: { table: 'T', column: 'id' } })]);
    db.updateCell('T', 1, 'v', 'X');
    db.undo();
    expect(() => db.execute('INSERT INTO H VALUES (99)')).toThrow(/FOREIGN KEY/i);
    expect(BaseDb.open(SQL, db.export()).count('T')).toBe(3);
  });
});

describe('query designer: grid, totals, parameters', () => {
  function setup(): BaseDb {
    const db = fresh();
    db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY, nombre TEXT, zona TEXT);
      CREATE TABLE Ventas (id INTEGER PRIMARY KEY, cliente INTEGER, anio INTEGER, importe REAL);
      INSERT INTO Clientes VALUES (1,'Ana','Norte'), (2,'Luis','Sur'), (3,'Eva','Norte'), (4,'Ivo','Sur');
      INSERT INTO Ventas VALUES (1,1,2023,100), (2,1,2024,50), (3,2,2023,30), (4,2,2024,70), (5,3,2024,10), (6,3,2024,15);`);
    return db;
  }
  const run = (db: BaseDb, d: QueryDesign, v: Record<string, unknown> = {}) => db.runDesign(d, {}, v);

  it('rows of criteria are ANDed across fields and ORed between rows', () => {
    const db = setup();
    const d: QueryDesign = { tables: ['Ventas'], fields: [field('Ventas', 'anio', { criteria: '2023', or: '2024' }), field('Ventas', 'importe', { criteria: '>60', or: '<20' })] };
    // (anio=2023 AND importe>60) OR (anio=2024 AND importe<20)
    expect(run(db, d).rows).toEqual([[2023, 100], [2024, 10], [2024, 15]]);
    const three: QueryDesign = { ...d, fields: [{ ...d.fields[0]!, more: ['2022'] }, d.fields[1]!] };
    expect(designToSql(three)).toContain('OR');
    expect(() => run(db, three)).not.toThrow();
  });

  it('inner join by equality, distinct, sort and limit', () => {
    const db = setup();
    const d: QueryDesign = {
      tables: ['Clientes', 'Ventas'],
      joins: [{ left: '"Clientes"."id"', right: '"Ventas"."cliente"' }],
      fields: [field('Clientes', 'zona', { sort: 'desc' })],
      distinct: true,
      limit: 5,
    };
    expect(run(db, d).rows).toEqual([['Sur'], ['Norte']]);
    expect(designToSql({ ...d, distinct: false, limit: 2 })).toMatch(/LIMIT 2$/);
  });

  it('totals: group, sum, count, average, min, max and a criteria on the total', () => {
    const db = setup();
    const d: QueryDesign = {
      tables: ['Clientes', 'Ventas'],
      joins: [{ left: '"Clientes"."id"', right: '"Ventas"."cliente"' }],
      fields: [
        field('Clientes', 'nombre', { total: 'group', sort: 'asc' }),
        field('Ventas', 'importe', { total: 'sum', criteria: '>=40', sort: 'desc' }),
        field('Ventas', 'id', { total: 'count' }),
        field('Ventas', 'importe', { total: 'max', alias: 'Mayor' }),
        field('Ventas', 'anio', { total: 'where', show: false, criteria: '>=2023' }),
      ],
    };
    const r = run(db, d);
    expect(r.columns).toEqual(['nombre', 'Suma de importe', 'Cuenta de id', 'Mayor']);
    expect(r.rows).toEqual([['Ana', 150, 2, 100], ['Luis', 100, 2, 70]]); // Eva sums 25 and is filtered by HAVING
    expect(compileDesign(d).sql).toMatch(/GROUP BY "Clientes"\."nombre"/);
    expect(compileDesign(d).sql).toMatch(/HAVING SUM\("Ventas"\."importe"\) >= 40/);
  });

  it('calculated fields', () => {
    const db = setup();
    const d: QueryDesign = { tables: ['Ventas'], fields: [field('Ventas', 'importe', { show: false, criteria: '>20' }), field('', 'IVA', { expr: 'importe * 1.21 + 0' }), field('', 'Texto', { expr: `'v' || id` })] };
    expect(run(db, d).rows[0]).toEqual([100 * 1.21, 'v1']);
  });

  it('parameters in criteria are bound, never pasted into the SQL', () => {
    const db = setup();
    const d: QueryDesign = { tables: ['Ventas'], fields: [field('Ventas', 'importe', { criteria: '>[Importe mínimo]' }), field('Ventas', 'anio', { criteria: '[Año]' })] };
    const c = compileDesign(d);
    expect(c.params).toEqual([{ key: 'p1', label: 'Importe mínimo' }, { key: 'p2', label: 'Año' }]);
    expect(c.sql).toContain(':p1');
    expect(run(db, d, { p1: '40', p2: '2024' }).rows).toEqual([[50, 2024], [70, 2024]]);
    const hostile = run(db, d, { p1: `0; DROP TABLE Ventas; --`, p2: '2024' });
    expect(hostile.rows).toEqual([]); // nothing is greater than that text… and nothing was executed
    expect(db.tableNames()).toContain('Ventas');
  });

  it('a parameter in a LIKE criteria accepts Access wildcards', () => {
    const db = setup();
    const d: QueryDesign = { tables: ['Clientes'], fields: [field('Clientes', 'nombre', { criteria: 'Like [Patrón]' })] };
    expect(run(db, d, { p1: 'A*' }).rows).toEqual([['Ana']]);
  });

  it('raw SQL parameters are found outside literals and bound per statement', () => {
    expect(sqlParams(`SELECT ':no', "@no", 'it''s :no' -- :nope\n, :año, @b, $c, :año /* :x */`).map((p) => p.key)).toEqual(['año', 'b', 'c']);
    const db = setup();
    const r = db.execute(`SELECT nombre FROM Clientes WHERE zona = :z ORDER BY id; `, 100, { z: 'Sur' });
    expect(r.rows).toEqual([['Luis'], ['Ivo']]);
    expect(db.execute(`INSERT INTO Clientes (id, nombre) VALUES (:i, :n); SELECT nombre FROM Clientes WHERE id = :i`, 100, { i: 9, n: 'Zoe' }).rows).toEqual([['Zoe']]);
  });
});

describe('query designer: crosstab, union, action queries', () => {
  function setup(): BaseDb {
    const db = fresh();
    db.execute(`CREATE TABLE Ventas (id INTEGER PRIMARY KEY, zona TEXT, anio INTEGER, importe REAL);
      INSERT INTO Ventas VALUES (1,'Norte',2023,100), (2,'Norte',2024,50), (3,'Sur',2023,30), (4,'Sur',2023,20), (5,'Este',2024,7), (6,'Este',NULL,1);
      CREATE TABLE A (x INTEGER, y TEXT); CREATE TABLE B (x INTEGER, y TEXT);
      INSERT INTO A VALUES (1,'a'), (2,'b'); INSERT INTO B VALUES (2,'b'), (3,'c');`);
    return db;
  }

  it('crosstab: row headings, column headings from the data, a value and a total', () => {
    const db = setup();
    const d: QueryDesign = { kind: 'crosstab', tables: ['Ventas'], crosstabFn: 'sum', fields: [field('Ventas', 'zona', { role: 'row' }), field('Ventas', 'anio', { role: 'column' }), field('Ventas', 'importe', { role: 'value' })] };
    const r = db.runDesign(d);
    expect(r.columns).toEqual(['zona', '(vacío)', '2023', '2024', 'Total']);
    expect(r.rows).toEqual([['Este', 1, null, 7, 8], ['Norte', null, 100, 50, 150], ['Sur', null, 50, null, 50]]);
    const counts = db.runDesign({ ...d, crosstabFn: 'count' });
    expect(counts.rows.find((x) => x[0] === 'Sur')).toEqual(['Sur', 0, 2, 0, 2]);
    expect(db.runDesign({ ...d, fields: [d.fields[0]!, { ...d.fields[1]!, criteria: '>=2024' }, d.fields[2]!] }).columns).toEqual(['zona', '2024', 'Total']);
    expect(() => db.runDesign({ ...d, fields: [d.fields[0]!] })).toThrow(/referencias cruzadas/);
    expect(db.designSql(d).sql).toContain('CASE WHEN');
  });

  it('crosstab values that look like SQL are quoted', () => {
    const db = fresh();
    db.execute(`CREATE TABLE V (r TEXT, c TEXT, n INTEGER); INSERT INTO V VALUES ('a', 'x"; DROP TABLE V; --', 1), ('a', 'o''k', 2)`);
    const r = db.runDesign({ kind: 'crosstab', tables: ['V'], fields: [field('V', 'r', { role: 'row' }), field('V', 'c', { role: 'column' }), field('V', 'n', { role: 'value' })] });
    expect(r.rows).toEqual([['a', 2, 1, 3]]);
    expect(db.tableNames()).toContain('V');
  });

  it('union and union all of tables and saved queries', () => {
    const db = setup();
    const ctx = { resolveQuery: (n: string) => (n === 'QB' ? 'SELECT * FROM B WHERE x > 2' : '') };
    const d: QueryDesign = { kind: 'union', tables: [], fields: [], union: { all: false, sources: [{ kind: 'table', name: 'A' }, { kind: 'table', name: 'B' }] } };
    expect(db.runDesign(d, ctx).rows).toHaveLength(3);
    expect(db.runDesign({ ...d, union: { ...d.union!, all: true } }, ctx).rows).toHaveLength(4);
    expect(db.runDesign({ ...d, union: { all: false, sources: [{ kind: 'table', name: 'A' }, { kind: 'query', name: 'QB' }] } }, ctx).rows).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
    expect(() => db.runDesign({ ...d, union: { all: false, sources: [{ kind: 'table', name: 'A' }] } })).toThrow(/dos orígenes/);
  });

  it('delete, update, append and make-table queries', () => {
    const db = setup();
    const del: QueryDesign = { kind: 'delete', tables: ['Ventas'], fields: [field('Ventas', 'importe', { criteria: '<10' })] };
    expect(compileDesign(del).sql).toMatch(/^DELETE FROM "Ventas"\nWHERE rowid IN \(SELECT "Ventas"\.rowid/);
    expect(db.runDesign(del).changes).toBe(2);
    expect(db.count('Ventas')).toBe(4);
    const upd: QueryDesign = { kind: 'update', tables: ['Ventas'], fields: [field('Ventas', 'zona', { criteria: 'Sur', set: 'Austral' }), field('Ventas', 'importe', { set: '=importe * 2' })] };
    expect(db.runDesign(upd).changes).toBe(2);
    expect(values(db, `SELECT importe FROM Ventas WHERE zona = 'Austral' ORDER BY id`)).toEqual([[60], [40]]);
    const mk: QueryDesign = { kind: 'maketable', tables: ['Ventas'], target: 'Resumen', fields: [field('Ventas', 'zona'), field('Ventas', 'importe', { criteria: '>50' })] };
    db.runDesign(mk);
    expect(values(db, 'SELECT zona, importe FROM Resumen ORDER BY importe')).toEqual([['Austral', 60], ['Norte', 100]]);
    const app: QueryDesign = { kind: 'append', tables: ['Ventas'], target: 'Resumen', fields: [field('Ventas', 'zona'), field('Ventas', 'importe', { criteria: '<=50' })] };
    db.runDesign(app);
    expect(db.count('Resumen')).toBe(4);
    expect(() => db.runDesign({ ...app, target: '' })).toThrow(/destino/);
    expect(() => db.runDesign({ ...upd, fields: [field('Ventas', 'zona')] })).toThrow(/Actualizar a/);
  });

  it('action queries over joined tables only touch the first table, and a parameter can drive them', () => {
    const db = fresh();
    db.execute(`CREATE TABLE Cli (id INTEGER PRIMARY KEY, activo INTEGER); CREATE TABLE Ped (id INTEGER PRIMARY KEY, cli INTEGER);
      INSERT INTO Cli VALUES (1, 1), (2, 0); INSERT INTO Ped VALUES (1, 1), (2, 2), (3, 2)`);
    const d: QueryDesign = { kind: 'delete', tables: ['Ped', 'Cli'], joins: [{ left: '"Ped"."cli"', right: '"Cli"."id"' }], fields: [field('Cli', 'activo', { criteria: '[Valor]' })] };
    expect(db.runDesign(d, {}, { p1: 0 }).changes).toBe(2);
    expect(values(db, 'SELECT id FROM Ped')).toEqual([[1]]);
    expect(db.count('Cli')).toBe(2);
  });

  it('an action query can be undone', () => {
    const db = setup();
    db.clearUndo();
    db.runDesign({ kind: 'delete', tables: ['Ventas'], fields: [field('Ventas', 'importe', { criteria: '>0' })] });
    expect(db.count('Ventas')).toBe(0);
    db.undo();
    expect(db.count('Ventas')).toBe(6);
  });
});

describe('designs that predate the new options still compile', () => {
  it('the old shape (no kind, no totals, one OR per field) gives the same result', () => {
    const d = newDesign();
    d.tables = ['T'];
    d.fields = [field('T', 'a', { criteria: '1', or: '2', sort: 'asc' })];
    expect(designToSql(d)).toBe(`SELECT "a"\nFROM "T"\nWHERE ("a" = 1 OR "a" = 2)\nORDER BY "a" ASC`);
  });
});
