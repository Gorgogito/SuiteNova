import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, loadSql, parseJson, toHtml, toJson, toXml, xmlName } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});

describe('JSON, XML and HTML', () => {
  const cols = ['id', 'nombre', 'nota'];
  const rows = [[1, 'Ana & <Luis>', null], [2, 'Eva', 'ok']];
  it('exports an array of objects', () => {
    expect(JSON.parse(toJson(cols, rows))).toEqual([{ id: 1, nombre: 'Ana & <Luis>', nota: null }, { id: 2, nombre: 'Eva', nota: 'ok' }]);
  });
  it('XML escapes the text, leaves empty values out and makes valid names', () => {
    const x = toXml('Mis datos', ['id', 'Fecha de alta', '1x'], [[1, '2025-01-01', 'a<b']]);
    expect(x).toContain('<Tabla nombre="Mis datos">');
    expect(x).toContain('<Fecha_de_alta>2025-01-01</Fecha_de_alta>');
    expect(x).toContain('<_1x>a&lt;b</_1x>');
    expect(toXml('T', cols, rows)).not.toContain('<nota></nota>');
    expect(xmlName('a b/c')).toBe('a_b_c');
  });
  it('HTML is a page with a table and escaped cells', () => {
    const h = toHtml('Clientes', cols, rows, [true, false, false]);
    expect(h).toContain('<th>nombre</th>');
    expect(h).toContain('Ana &amp; &lt;Luis&gt;');
    expect(h).toContain('text-align:right');
  });
});

describe('reading JSON', () => {
  it('an array of objects: columns are the keys in order of appearance', () => {
    const r = parseJson('[{"a":1,"b":"x"},{"b":"y","c":true}]');
    expect(r.columns).toEqual(['a', 'b', 'c']);
    expect(r.rows).toEqual([['1', 'x', ''], ['', 'y', 'true']]);
  });
  it('an array of arrays, an object holding the array, and one object per line', () => {
    expect(parseJson('[["a","b"],[1,2]]')).toEqual({ columns: ['a', 'b'], rows: [['1', '2']] });
    expect(parseJson('{"clientes":[{"n":"Ana"}]}').rows).toEqual([['Ana']]);
    expect(parseJson('{"n":1}\n{"n":2}\n').rows).toEqual([['1'], ['2']]);
  });
  it('refuses what is not a list of records, with a readable message', () => {
    expect(() => parseJson('hola')).toThrow(/JSON válido/);
    expect(() => parseJson('[]')).toThrow(/no contiene registros/);
    expect(() => parseJson('[1,2]')).toThrow(/lista de objetos/);
  });
  it('nested values become text and the result imports as a table', () => {
    const r = parseJson('[{"n":"Ana","tags":["a","b"]}]');
    expect(r.rows[0]![1]).toBe('["a","b"]');
    const db = BaseDb.open(SQL);
    expect(db.importRows('Gente', [r.columns, ...r.rows]).rows).toBe(1);
  });
});

describe('copy a table, dump, and import from another database', () => {
  const setup = () => {
    const db = BaseDb.open(SQL);
    db.execute(`CREATE TABLE A (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, saldo REAL DEFAULT 0);
      INSERT INTO A (nombre, saldo) VALUES ('Ana', 10), ('Luis', 20);
      CREATE INDEX ix_a ON A (nombre);`);
    return db;
  };
  it('copy structure and data; structure only; append by matching field names', () => {
    const db = setup();
    expect(db.copyTable('A', 'B', 'all')).toEqual({ table: 'B', rows: 2 });
    expect(db.columns('B').find((c) => c.name === 'id')?.primaryKey).toBe(true);
    expect(db.copyTable('A', 'C', 'structure')).toEqual({ table: 'C', rows: 0 });
    expect(db.count('C')).toBe(0);
    expect(db.copyTable('A', 'A', 'structure').table).toBe('A_1');
    db.execute('CREATE TABLE D (nombre TEXT, otro TEXT)');
    expect(db.copyTable('A', 'D', 'append').rows).toBe(2);
    expect(db.execute('SELECT nombre FROM D ORDER BY nombre').rows.flat()).toEqual(['Ana', 'Luis']);
    db.execute('CREATE TABLE E (zzz TEXT)');
    expect(() => db.copyTable('A', 'E', 'append')).toThrow(/ningún campo/);
    db.undo();
    expect(db.tableNames()).not.toContain('E_x');
  });
  it('a dump recreates the table in a fresh database, with quotes and blobs', () => {
    const db = setup();
    db.execute("INSERT INTO A (nombre, saldo) VALUES ('O''Neil', NULL)");
    const sql = db.dumpSql(['A']);
    const fresh = BaseDb.open(SQL);
    fresh.execute(sql);
    expect(fresh.execute('SELECT nombre FROM A ORDER BY id').rows.flat()).toEqual(['Ana', 'Luis', "O'Neil"]);
    expect(fresh.indexes('A').some((i) => i.name === 'ix_a')).toBe(true);
    expect(db.dumpSql(['A'], false)).not.toContain('INSERT');
  });
  it('peek lists the tables of a file; import brings them, renaming one that exists', () => {
    const src = setup();
    const bytes = src.export();
    const list = BaseDb.peek(SQL, bytes);
    expect(list).toEqual([{ name: 'A', rows: 2, columns: 3 }]);
    const dst = BaseDb.open(SQL);
    const r1 = dst.importDatabase(bytes, ['A']);
    expect(r1).toMatchObject({ tables: ['A'], rows: 2, renamed: {} });
    expect(dst.indexes('A').some((i) => i.name === 'ix_a')).toBe(true);
    const r2 = dst.importDatabase(bytes, ['A']);
    expect(r2.renamed).toEqual({ A: 'A_1' });
    expect(dst.count('A_1')).toBe(2);
    expect(r2.notes.join(' ')).toMatch(/índices/);
    dst.undo();
    expect(dst.tableNames()).toEqual(['A']);
    expect(dst.importDatabase(bytes, ['A'], { data: false }).rows).toBe(0);
  });
});
