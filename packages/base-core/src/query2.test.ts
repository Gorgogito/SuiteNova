import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, compileDesign, duplicatesSql, loadSql, newDesign, unmatchedSql, type DesignField, type QueryDesign } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});
const f = (table: string, name: string, extra: Partial<DesignField> = {}): DesignField => ({ table, name, show: true, sort: null, criteria: '', ...extra });
const run = (db: BaseDb, d: QueryDesign) => db.execute(compileDesign(d).sql).rows;

const setup = (): BaseDb => {
  const db = BaseDb.open(SQL);
  db.execute(`CREATE TABLE Dept (id INTEGER PRIMARY KEY, nombre TEXT);
    INSERT INTO Dept VALUES (1,'Ventas'),(2,'IT'),(3,'Vacío');
    CREATE TABLE Emp (id INTEGER PRIMARY KEY, nombre TEXT, dept INTEGER, jefe INTEGER, sueldo REAL);
    INSERT INTO Emp VALUES (1,'Ana',1,NULL,100),(2,'Luis',1,1,80),(3,'Eva',2,1,120),(4,'Oscar',NULL,3,60),(5,'Zoe',1,2,90);`);
  return db;
};
const design = (over: Partial<QueryDesign>): QueryDesign => ({ ...newDesign(), ...over });

describe('outer joins', () => {
  const base = (type?: 'inner' | 'left' | 'right') =>
    design({ tables: ['Emp', 'Dept'], joins: [{ left: '"Emp"."dept"', right: '"Dept"."id"', ...(type ? { type } : {}) }], fields: [f('Emp', 'nombre', { sort: 'asc' }), f('Dept', 'nombre', { alias: 'depto' })] });
  it('inner is as before (a WHERE), left keeps all of the left table, right all of the right one', () => {
    const db = setup();
    expect(compileDesign(base()).sql).toContain('WHERE "Emp"."dept" = "Dept"."id"');
    expect(run(db, base()).map((r) => r[0])).toEqual(['Ana', 'Eva', 'Luis', 'Zoe']);
    expect(run(db, base('left')).map((r) => r[0])).toEqual(['Ana', 'Eva', 'Luis', 'Oscar', 'Zoe']);
    const right = run(db, design({ ...base('right'), fields: [f('Emp', 'nombre'), f('Dept', 'nombre', { alias: 'depto', sort: 'asc' })] }));
    expect(right.map((r) => r[1])).toEqual(['IT', 'Vacío', 'Ventas', 'Ventas', 'Ventas']);
    expect(compileDesign(base('left')).sql).toContain('LEFT JOIN "Dept" ON "Emp"."dept" = "Dept"."id"');
  });
  it('the side that keeps its records may be written either way round', () => {
    const db = setup();
    const swapped = design({ tables: ['Emp', 'Dept'], joins: [{ left: '"Dept"."id"', right: '"Emp"."dept"', type: 'right' }], fields: [f('Emp', 'nombre', { sort: 'asc' })] });
    expect(run(db, swapped).map((r) => r[0])).toEqual(['Ana', 'Eva', 'Luis', 'Oscar', 'Zoe']);
  });
  it('criteria still work with an outer join (departments without employees)', () => {
    const db = setup();
    const d = design({ tables: ['Dept', 'Emp'], joins: [{ left: '"Dept"."id"', right: '"Emp"."dept"', type: 'left' }], fields: [f('Dept', 'nombre'), f('Emp', 'id', { criteria: 'Is Null', show: false })] });
    expect(run(db, d)).toEqual([['Vacío']]);
  });
});

describe('a table twice (alias)', () => {
  it('employees with their boss', () => {
    const db = setup();
    const d = design({
      tables: ['Emp', 'Jefe'],
      tableAlias: { Jefe: 'Emp' },
      joins: [{ left: '"Emp"."jefe"', right: '"Jefe"."id"', type: 'left' }],
      fields: [f('Emp', 'nombre', { sort: 'asc' }), f('Jefe', 'nombre', { alias: 'jefe' })],
    });
    expect(compileDesign(d).sql).toContain('"Emp" AS "Jefe"');
    expect(run(db, d)).toEqual([['Ana', null], ['Eva', 'Ana'], ['Luis', 'Ana'], ['Oscar', 'Eva'], ['Zoe', 'Luis']]);
  });
});

describe('first and last in totals; subqueries in criteria', () => {
  it('the first and last value of each group, by entry order', () => {
    const db = setup();
    const d = design({ tables: ['Emp'], fields: [f('Emp', 'dept', { total: 'group', sort: 'asc' }), f('Emp', 'nombre', { total: 'first' }), f('Emp', 'nombre', { total: 'last', alias: 'ultimo' })] });
    expect(run(db, d)).toEqual([[null, 'Oscar', 'Oscar'], [1, 'Ana', 'Zoe'], [2, 'Eva', 'Eva']]);
    expect(compileDesign(d).sql).toContain("MIN(printf('%020d', rowid)");
  });
  it('In (Select …) and a comparison with a scalar subquery', () => {
    const db = setup();
    const inSub = design({ tables: ['Emp'], fields: [f('Emp', 'nombre', { sort: 'asc' }), f('Emp', 'dept', { criteria: 'In (Select id From Dept Where nombre = \'Ventas\')', show: false })] });
    expect(run(db, inSub)).toEqual([['Ana'], ['Luis'], ['Zoe']]);
    const above = design({ tables: ['Emp'], fields: [f('Emp', 'nombre', { sort: 'asc' }), f('Emp', 'sueldo', { criteria: '>(Select Avg(sueldo) From Emp)', show: false })] });
    expect(run(db, above)).toEqual([['Ana'], ['Eva']]);
  });
});

describe('query wizards', () => {
  it('find duplicates lists every record that shares the value, not the empty ones', () => {
    const db = setup();
    db.execute("INSERT INTO Emp VALUES (6,'Ana',2,NULL,70),(7,'Luis',NULL,NULL,50),(8,NULL,NULL,NULL,1),(9,NULL,NULL,NULL,2)");
    const rows = db.execute(duplicatesSql('Emp', ['nombre'], ['id', 'nombre'])).rows;
    expect(rows).toEqual([[1, 'Ana'], [6, 'Ana'], [2, 'Luis'], [7, 'Luis']]);
    expect(db.execute(duplicatesSql('Emp', ['nombre', 'dept'])).rows).toEqual([]);
    expect(() => duplicatesSql('Emp', [])).toThrow(/al menos un campo/);
  });
  it('find unmatched lists the records of one table with no partner in the other', () => {
    const db = setup();
    expect(db.execute(unmatchedSql('Dept', 'id', 'Emp', 'dept', ['nombre'])).rows).toEqual([['Vacío']]);
    expect(db.execute(unmatchedSql('Emp', 'dept', 'Dept', 'id', ['nombre'])).rows).toEqual([['Oscar']]);
    expect(() => unmatchedSql('', 'id', 'Emp', 'dept')).toThrow(/Elige/);
  });
});
