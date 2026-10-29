import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, criteriaToSql, designToSql, inferType, loadSql, newColumn, parseCsv, renderReport, toCsv, newReport, type ColumnDef } from './index';

let db: BaseDb;
beforeAll(async () => {
  const SQL = await loadSql();
  db = BaseDb.open(SQL);
});

const col = (name: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({ ...newColumn(name, type), ...extra });

describe('CSV', () => {
  it('parses quotes, embedded newlines, delimiters and BOM', () => {
    expect(parseCsv('﻿a,b\n"x, y","he said ""hi"""\n"line\nbreak",3\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['line\nbreak', '3']]);
    expect(parseCsv('a;b\r\n1;2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('writes CSV that reads back', () => {
    const rows = [['a,b', 'q"q', null, 3]];
    expect(parseCsv(toCsv(['c1', 'c2', 'c3', 'c4'], rows))).toEqual([['c1', 'c2', 'c3', 'c4'], ['a,b', 'q"q', '', '3']]);
  });
});

describe('type inference', () => {
  it('guesses integer, real, date, datetime, boolean and text', () => {
    expect(inferType(['1', '22', '-3', ''])).toBe('INTEGER');
    expect(inferType(['1', '2.5'])).toBe('REAL');
    expect(inferType(['007', '12'])).toBe('TEXT'); // leading zeros are identifiers
    expect(inferType(['2024-01-31'])).toBe('DATE');
    expect(inferType(['2024-01-31 10:00', '2024-02-01T09:30:15'])).toBe('DATETIME');
    expect(inferType(['true', 'FALSO'])).toBe('BOOLEAN');
    expect(inferType(['a', '1'])).toBe('TEXT');
    expect(inferType([])).toBe('TEXT');
  });
});

describe('tables and data', () => {
  it('creates a table and reads its definition back', () => {
    db.createTable('Clientes', [col('Id', 'INTEGER', { primaryKey: true, autoIncrement: true }), col('Nombre', 'TEXT', { notNull: true }), col('Alta', 'DATE'), col('Activo', 'BOOLEAN', { defaultValue: '1' }), col('Email', 'TEXT', { unique: true })]);
    expect(db.tableNames()).toContain('Clientes');
    const cols = db.columns('Clientes');
    expect(cols.map((c) => c.name)).toEqual(['Id', 'Nombre', 'Alta', 'Activo', 'Email']);
    expect(cols[0]).toMatchObject({ primaryKey: true, autoIncrement: true, type: 'INTEGER' });
    expect(cols[1]).toMatchObject({ notNull: true });
    expect(cols[3]!.defaultValue).toBe('1');
    expect(cols[4]!.unique).toBe(true);
  });

  it('inserts, edits with type checking, searches, sorts and deletes', () => {
    const a = db.insertRow('Clientes', { Nombre: 'Ana', Alta: '2024-03-01' });
    const b = db.insertRow('Clientes', { Nombre: 'Luis', Alta: '2024-01-15' });
    db.insertRow('Clientes', {}); // required text gets a placeholder instead of failing
    expect(db.count('Clientes')).toBe(3);
    db.updateCell('Clientes', a, 'Nombre', 'Ana María');
    expect(() => db.updateCell('Clientes', a, 'Alta', 'ayer')).toThrow(/fecha/);
    expect(() => db.updateCell('Clientes', a, 'Id', 'x')).toThrow(/entero/);
    db.updateCell('Clientes', a, 'Activo', 'sí');
    const r = db.browse('Clientes', { orderBy: 'Alta', search: 'a' });
    expect(r.columns[0]).toBe('__rid');
    expect(r.rows.map((x) => x[2])).toEqual(['Ana María']);
    expect(db.browse('Clientes', { orderBy: 'Alta', desc: true }).rows.map((x) => x[2]).slice(0, 2)).toEqual(['Ana María', 'Luis']);
    expect(db.count('Clientes', 'zzz')).toBe(0);
    expect(db.count('Clientes', '%')).toBe(0); // wildcards typed by the user are literal
    db.deleteRows('Clientes', [b]);
    expect(db.count('Clientes')).toBe(2);
    expect(db.browse('Clientes', { limit: 1 }).rows).toHaveLength(1);
  });

  it('alters a table keeping the data across renames and type changes', () => {
    db.createTable('Prod', [col('id', 'INTEGER', { primaryKey: true }), col('precio', 'TEXT'), col('nombre', 'TEXT')]);
    db.execute(`INSERT INTO Prod (precio, nombre) VALUES ('10', 'a'), ('2.5', 'b')`);
    db.execute('CREATE INDEX idx_nombre ON Prod (nombre)');
    db.alterTable('Prod', [{ ...col('id', 'INTEGER', { primaryKey: true }), orig: 'id' }, { ...col('importe', 'REAL'), orig: 'precio' }, { ...col('titulo', 'TEXT'), orig: 'nombre' }, col('stock', 'INTEGER', { defaultValue: '0' })]);
    const r = db.execute('SELECT importe, titulo, stock FROM Prod ORDER BY id');
    expect(r.rows).toEqual([[10, 'a', 0], [2.5, 'b', 0]]);
    expect(db.columns('Prod').find((c) => c.name === 'importe')!.type).toBe('REAL');
    expect(db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='Prod'`).rows.flat()).toContain('idx_nombre'); // index follows the renamed column
  });

  it('rolls back a failed redefinition and leaves the table intact', () => {
    db.createTable('T1', [col('a', 'TEXT')]);
    db.execute(`INSERT INTO T1 VALUES ('x'), (NULL)`);
    expect(() => db.alterTable('T1', [{ ...col('a', 'TEXT', { notNull: true }), orig: 'a' }])).toThrow();
    expect(db.count('T1')).toBe(2);
    expect(db.columns('T1')[0]!.notNull).toBe(false);
  });

  it('enforces foreign keys and reports them', () => {
    db.createTable('Pedidos', [col('id', 'INTEGER', { primaryKey: true }), col('cliente', 'INTEGER', { references: { table: 'Clientes', column: 'Id' } })]);
    expect(db.columns('Pedidos')[1]!.references).toMatchObject({ table: 'Clientes', column: 'Id' });
    expect(() => db.insertRow('Pedidos', { cliente: 999 })).toThrow(/FOREIGN KEY/i);
  });

  it('rejects duplicate and reserved names', () => {
    expect(() => db.createTable('clientes', [col('a', 'TEXT')])).toThrow(/Ya existe/);
    expect(() => db.createTable('__nova_x', [col('a', 'TEXT')])).toThrow(/reservado/);
    expect(() => db.createTable('Dup', [col('a', 'TEXT'), col('A', 'TEXT')])).toThrow(/repetido/);
  });

  it('hides internal tables and drops/renames tables', () => {
    db.saveObject('query', 'q1', { sql: 'select 1' });
    expect(db.tableNames().some((n) => n.startsWith('__nova_'))).toBe(false);
    db.createTable('Temp', [col('a', 'TEXT')]);
    db.renameTable('Temp', 'Temp2');
    expect(db.tableNames()).toContain('Temp2');
    db.dropTable('Temp2');
    expect(db.tableNames()).not.toContain('Temp2');
  });
});

describe('SQL, saved objects and persistence', () => {
  it('runs multi-statement scripts and returns the last result set', () => {
    const r = db.execute(`CREATE TABLE S (n INTEGER); INSERT INTO S VALUES (1),(2),(3); SELECT sum(n) AS total, count(*) AS c FROM S`);
    expect(r.columns).toEqual(['total', 'c']);
    expect(r.rows).toEqual([[6, 3]]);
    expect(db.execute('DELETE FROM S WHERE n > 1').changes).toBe(2);
    expect(() => db.execute('SELEKT 1')).toThrow();
  });

  it('truncates very large results', () => {
    const r = db.execute('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 500) SELECT x FROM c', 100);
    expect(r.rows).toHaveLength(100);
    expect(r.truncated).toBe(true);
  });

  it('stores, renames and deletes queries, forms and reports', () => {
    db.saveObject('query', 'Activos', { sql: 'SELECT 1' });
    db.saveObject('form', 'FormCli', { table: 'Clientes' });
    expect(db.objects('query')).toContain('Activos');
    expect(db.getObject('form', 'FormCli')).toEqual({ table: 'Clientes' });
    db.renameObject('query', 'Activos', 'Vigentes');
    expect(db.objects('query')).toEqual(expect.arrayContaining(['Vigentes']));
    db.deleteObject('query', 'Vigentes');
    expect(db.getObject('query', 'Vigentes')).toBeNull();
  });

  it('exports a SQLite file that reopens with everything in it', async () => {
    const bytes = db.export();
    expect(new TextDecoder().decode(bytes.subarray(0, 15))).toBe('SQLite format 3');
    const again = BaseDb.open(await loadSql(), bytes);
    expect(again.tableNames()).toContain('Clientes');
    expect(again.count('Clientes')).toBe(2);
    expect(again.getObject('form', 'FormCli')).toEqual({ table: 'Clientes' });
    // foreign keys are still enforced after an export
    expect(() => db.insertRow('Pedidos', { cliente: 999 })).toThrow(/FOREIGN KEY/i);
  });

  it('refuses files that are not SQLite databases', async () => {
    expect(() => BaseDb.open(db.SQL, new TextEncoder().encode('esto no es una base de datos, ni de lejos ni de cerca'))).toThrow(/SQLite/);
  });

  it('imports CSV rows with inferred types, clean names and no name clashes', () => {
    const rows = parseCsv('Nombre;Edad;Fecha;;Nombre\nAna;30;2024-01-01;x;y\nLuis;;2024-02-02;;\n');
    const r = db.importRows('Datos', rows);
    expect(r).toEqual({ table: 'Datos', rows: 2 });
    const cols = db.columns('Datos');
    expect(cols.map((c) => [c.name, c.type])).toEqual([['Nombre', 'TEXT'], ['Edad', 'INTEGER'], ['Fecha', 'DATE'], ['Campo4', 'TEXT'], ['Nombre_2', 'TEXT']]);
    expect(db.execute('SELECT Edad FROM Datos ORDER BY Nombre').rows).toEqual([[30], [null]]);
    expect(db.importRows('Datos', rows).table).toBe('Datos_2');
  });
});

describe('query designer', () => {
  it('turns grid criteria into SQL', () => {
    expect(criteriaToSql('"a"', '>5')).toBe('"a" > 5');
    expect(criteriaToSql('"a"', '"Ana"')).toBe(`"a" = 'Ana'`);
    expect(criteriaToSql('"a"', 'Ana')).toBe(`"a" = 'Ana'`);
    expect(criteriaToSql('"a"', 'Like "A*"')).toBe(`"a" LIKE 'A%'`);
    expect(criteriaToSql('"a"', 'A?c*')).toBe(`"a" LIKE 'A_c%'`);
    expect(criteriaToSql('"a"', 'Between 1 And 5')).toBe('"a" BETWEEN 1 AND 5');
    expect(criteriaToSql('"a"', 'In ("x","y")')).toBe(`"a" IN ('x', 'y')`);
    expect(criteriaToSql('"a"', 'Is Not Null')).toBe('"a" IS NOT NULL');
    expect(criteriaToSql('"a"', `<> "O'Brien"`)).toBe(`"a" <> 'O''Brien'`);
    expect(criteriaToSql('"a"', '  ')).toBeNull();
  });

  it('builds a runnable query with sorting, OR and several tables', () => {
    const sql = designToSql({ tables: ['Clientes'], fields: [{ table: 'Clientes', name: 'Nombre', show: true, sort: 'asc', criteria: 'A*', or: 'L*' }, { table: 'Clientes', name: 'Id', show: false, sort: null, criteria: '>0' }] });
    expect(sql).toContain('(');
    const r = db.execute(sql);
    expect(r.columns).toEqual(['Nombre']);
    expect(r.rows.length).toBeGreaterThan(0);
    const join = designToSql({ tables: ['Pedidos', 'Clientes'], joins: [{ left: '"Pedidos"."cliente"', right: '"Clientes"."Id"' }], fields: [{ table: 'Clientes', name: 'Nombre', show: true, sort: null, criteria: '' }] });
    expect(join).toContain('FROM "Pedidos", "Clientes"');
    expect(() => db.execute(join)).not.toThrow();
  });

  it('survives SQL injection attempts in criteria (values are always quoted)', () => {
    const sql = designToSql({ tables: ['Clientes'], fields: [{ table: 'Clientes', name: 'Nombre', show: true, sort: null, criteria: `x'; DROP TABLE Clientes; --` }] });
    db.execute(sql);
    expect(db.tableNames()).toContain('Clientes');
  });
});

describe('reports', () => {
  it('renders grouped rows with subtotals, totals and escaped text', () => {
    const def = { ...newReport({ kind: 'table', name: 'Ventas' }, ['Zona', 'Producto', 'Importe']), groupBy: 'Zona', sums: ['Importe'] };
    const html = renderReport(def, { columns: ['Zona', 'Producto', 'Importe'], rows: [['Sur', '<b>x</b>', 10], ['Norte', 'y', 5], ['Sur', 'z', 2.5]] }, { date: '1/1/2025' });
    expect(html).toContain('Zona: Norte');
    expect(html).toContain('Zona: Sur');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('Subtotal (2)');
    expect(html).toContain('12,5'); // Sur: 10 + 2.5
    expect(html).toContain('Total (3)');
    expect(html).toContain('17,5');
    expect(html.indexOf('Norte')).toBeLessThan(html.indexOf('Sur'));
  });
});
