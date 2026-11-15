import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, compileDesign, loadSql, newDesign, type DesignField, type QueryDesign } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});
const f = (table: string, name: string, extra: Partial<DesignField> = {}): DesignField => ({ table, name, show: true, sort: null, criteria: '', ...extra });
const design = (over: Partial<QueryDesign>): QueryDesign => ({ ...newDesign(), ...over });

const setup = (): BaseDb => {
  const db = BaseDb.open(SQL);
  db.execute(`CREATE TABLE Emp (id INTEGER PRIMARY KEY, nombre TEXT, sueldo REAL, dept INTEGER);
    INSERT INTO Emp VALUES (1,'Ana',100,1),(2,'Luis',80,1),(3,'Eva',120,2),(4,'Oscar',60,2),(5,'Zoe',90,1),(6,'Iván',70,3),(7,'Ada',110,3),(8,'Bea',95,3),(9,'Cai',50,3),(10,'Dan',40,3);
    CREATE TABLE Tramo (id INTEGER PRIMARY KEY, etiqueta TEXT, desde REAL, hasta REAL);
    INSERT INTO Tramo VALUES (1,'bajo',0,70),(2,'medio',70,100),(3,'alto',100,1000);`);
  return db;
};

describe('joins with a comparison other than equality', () => {
  it('a join on "<" and one with two conditions (a range)', () => {
    const db = setup();
    const lessThan = design({ tables: ['Emp', 'Tramo'], joins: [{ left: '"Emp"."sueldo"', right: '"Tramo"."hasta"', op: '<' }, { left: '"Emp"."sueldo"', right: '"Tramo"."desde"', op: '>=' }], fields: [f('Emp', 'nombre', { sort: 'asc' }), f('Tramo', 'etiqueta')] });
    const sql = compileDesign(lessThan).sql;
    expect(sql).toContain('"Emp"."sueldo" < "Tramo"."hasta"');
    expect(sql).toContain('"Emp"."sueldo" >= "Tramo"."desde"');
    expect(db.execute(sql).rows.find((r) => r[0] === 'Ana')).toEqual(['Ana', 'alto']); // 100 is not < 100 for "medio": it belongs to "alto"
    expect(db.execute(sql).rows.find((r) => r[0] === 'Luis')).toEqual(['Luis', 'medio']);
    expect(db.execute(sql).rows.find((r) => r[0] === 'Oscar')).toEqual(['Oscar', 'bajo']);
  });
  it('a different comparison works with an outer join too, and an unknown operator falls back to equality', () => {
    const db = setup();
    const left = design({ tables: ['Emp', 'Tramo'], joins: [{ left: '"Emp"."sueldo"', right: '"Tramo"."desde"', op: '>', type: 'left' }], fields: [f('Emp', 'nombre'), f('Tramo', 'etiqueta')] });
    expect(compileDesign(left).sql).toContain('LEFT JOIN "Tramo" ON "Emp"."sueldo" > "Tramo"."desde"');
    expect(db.execute(compileDesign(left).sql).rows.length).toBeGreaterThan(10);
    const bad = design({ tables: ['Emp', 'Tramo'], joins: [{ left: '"Emp"."id"', right: '"Tramo"."id"', op: 'LIKE' as never }], fields: [f('Emp', 'nombre')] });
    expect(compileDesign(bad).sql).toContain('"Emp"."id" = "Tramo"."id"');
  });
});

describe('top N percent', () => {
  it('returns the top percent of the records, rounded up, in the order of the query', () => {
    const db = setup();
    const d = (n: number) => design({ tables: ['Emp'], fields: [f('Emp', 'nombre'), f('Emp', 'sueldo', { sort: 'desc' })], limit: n, limitPercent: true });
    expect(db.execute(compileDesign(d(10)).sql).rows).toEqual([['Eva', 120]]); // 10% of 10
    expect(db.execute(compileDesign(d(25)).sql).rows.map((r) => r[0])).toEqual(['Eva', 'Ada', 'Ana']); // 2.5 → 3
    expect(db.execute(compileDesign(d(100)).sql).rows.length).toBe(10);
    expect(db.execute(compileDesign(d(0.1)).sql).rows.length).toBe(1);
    expect(db.execute(compileDesign({ ...d(50), limitPercent: false }).sql).rows.length).toBe(10 > 50 ? 10 : 50 > 10 ? 10 : 0);
  });
  it('works with a filter and with parameters', () => {
    const db = setup();
    const d = design({ tables: ['Emp'], fields: [f('Emp', 'nombre'), f('Emp', 'sueldo', { sort: 'desc' }), f('Emp', 'dept', { criteria: '[Departamento]', show: false })], limit: 50, limitPercent: true });
    const c = compileDesign(d);
    expect(c.params).toHaveLength(1);
    const rows = db.execute(c.sql, 100, { p1: 3 }).rows; // 5 employees of dept 3 → 50% = 3
    expect(rows.map((r) => r[0])).toEqual(['Ada', 'Bea', 'Iván']);
  });
});

describe('saved queries as the source of a query', () => {
  const saved: Record<string, string> = { Caros: 'SELECT id, nombre, sueldo FROM Emp WHERE sueldo >= 100', ConParam: 'SELECT * FROM Emp WHERE sueldo > :p1' };
  const ctx = { resolveQuery: (n: string) => saved[n] ?? '' };
  it('a saved query is a table of the design, and can be joined with real tables', () => {
    const db = setup();
    const d = design({ tables: ['Caros'], querySources: ['Caros'], fields: [f('Caros', 'nombre', { sort: 'asc' }), f('Caros', 'sueldo')] });
    const c = compileDesign(d, ctx);
    expect(c.sql).toContain('FROM (SELECT id, nombre, sueldo FROM Emp WHERE sueldo >= 100) AS "Caros"');
    expect(db.execute(c.sql).rows).toEqual([['Ada', 110], ['Ana', 100], ['Eva', 120]]);
    const joined = design({ tables: ['Caros', 'Emp'], querySources: ['Caros'], joins: [{ left: '"Caros"."id"', right: '"Emp"."id"' }], fields: [f('Caros', 'nombre', { sort: 'asc' }), f('Emp', 'dept')] });
    expect(db.execute(compileDesign(joined, ctx).sql).rows).toEqual([['Ada', 3], ['Ana', 1], ['Eva', 2]]);
  });
  it('with totals and with criteria on the fields of the query', () => {
    const db = setup();
    const d = design({ tables: ['Caros'], querySources: ['Caros'], fields: [f('Caros', 'sueldo', { total: 'avg', alias: 'media' })] });
    expect(db.execute(compileDesign(d, ctx).sql).rows).toEqual([[110]]);
    const crit = design({ tables: ['Caros'], querySources: ['Caros'], fields: [f('Caros', 'nombre'), f('Caros', 'sueldo', { criteria: '>100' })] });
    expect(db.execute(compileDesign(crit, ctx).sql).rows.map((r) => r[0]).sort()).toEqual(['Ada', 'Eva']);
  });
  it('refuses a query that asks for parameters, a missing resolver, and an update over a query', () => {
    const d = design({ tables: ['ConParam'], querySources: ['ConParam'], fields: [f('ConParam', 'nombre')] });
    expect(() => compileDesign(d, ctx)).toThrow(/pide parámetros/);
    expect(() => compileDesign(design({ tables: ['Caros'], querySources: ['Caros'], fields: [f('Caros', 'nombre')] }))).toThrow(/No se pueden resolver/);
    const upd = design({ kind: 'update', tables: ['Caros'], querySources: ['Caros'], fields: [f('Caros', 'sueldo', { set: '1' })] });
    expect(() => compileDesign(upd, ctx)).toThrow(/cambia una tabla, no una consulta/);
  });
});
