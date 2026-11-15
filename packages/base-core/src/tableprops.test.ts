import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, applyMask, cleanMeta, formatField, loadSql, ruleToSql, type TableMeta } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});

const NEWF = (n: string) => `NEW."${n}"`;

describe('display formats', () => {
  it('numbers: fixed, standard, percent, currency, decimals', () => {
    expect(formatField(1234.5, 'REAL', { format: 'fixed' }, 'es-ES')).toBe('1234,50');
    expect(formatField(1234.5, 'REAL', { format: 'standard' }, 'en-US')).toBe('1,234.50');
    expect(formatField(0.256, 'REAL', { format: 'percent', decimals: 1 }, 'en-US')).toBe('25.6%');
    expect(formatField(1234.5, 'REAL', { kind: 'currency', currency: 'USD' }, 'en-US')).toBe('$1,234.50');
    expect(formatField(2, 'INTEGER', { decimals: 2 }, 'en-US')).toBe('2.00');
    expect(formatField(12345, 'INTEGER', { format: 'scientific', decimals: 1 }, 'en-US')).toBe('1.2E+04');
    expect(formatField(5, 'INTEGER', {}, 'en-US')).toBeNull();
    expect(formatField(null, 'REAL', { format: 'fixed' })).toBeNull();
  });
  it('dates and yes/no and text', () => {
    expect(formatField('2025-03-07', 'DATE', { format: 'short' }, 'en-GB')).toBe('07/03/2025');
    expect(formatField('2025-03-07 14:05', 'DATETIME', { format: 'time' }, 'en-GB')).toMatch(/14:05/);
    expect(formatField('2025-03-07', 'DATE', { format: 'long' }, 'en-US')).toMatch(/March 7, 2025/);
    expect(formatField('2025-03-07', 'DATE', { format: 'iso' })).toBeNull();
    expect(formatField(1, 'BOOLEAN', { format: 'yesno' })).toBe('Sí');
    expect(formatField(0, 'BOOLEAN', { format: 'truefalse' })).toBe('Falso');
    expect(formatField('abc', 'TEXT', { format: 'upper' })).toBe('ABC');
  });
});

describe('input masks', () => {
  it('a phone mask accepts the symbols or leaves them out', () => {
    expect(applyMask('(000) 000-0000', '5551234567')).toBe('(555) 123-4567');
    expect(applyMask('(000) 000-0000', '(555) 123-4567')).toBe('(555) 123-4567');
    expect(applyMask('(000) 000-0000', '55512')).toBeNull();
    expect(applyMask('(000) 000-0000', '555123456a')).toBeNull();
  });
  it('letters, optional places and case conversion', () => {
    expect(applyMask('>L0L 0L0', 'k1a0b1')).toBe('K1A 0B1');
    expect(applyMask('00-9999', '12')).toBe('12');
    expect(applyMask('00-9999', '12-34')).toBe('12-34');
    expect(applyMask('<LLL', 'ABC')).toBe('abc');
    expect(applyMask('LL', 'a1')).toBeNull();
  });
});

describe('validation rules to SQL', () => {
  it('a rule that starts with an operator is about the value', () => {
    expect(ruleToSql('>=0 And <=100', NEWF('x'), NEWF)).toBe('NEW."x" >= 0 AND NEW."x" <= 100');
    expect(ruleToSql('Between 1 And 5', NEWF('x'), NEWF)).toBe('NEW."x" BETWEEN 1 AND 5');
    expect(ruleToSql('Like "A*"', NEWF('x'), NEWF)).toBe(`NEW."x" LIKE 'A%'`);
    expect(ruleToSql('Is Not Null', NEWF('x'), NEWF)).toBe('NEW."x" IS NOT NULL');
    expect(ruleToSql('<>"x"', NEWF('x'), NEWF)).toBe(`NEW."x" <> 'x'`);
    expect(ruleToSql('Not Like "A*"', NEWF('x'), NEWF)).toBe(`NEW."x" NOT LIKE 'A%'`);
  });
  it('expressions with [fields] and functions', () => {
    expect(ruleToSql('[Fin] >= [Inicio]', null, NEWF)).toBe('NEW."Fin" >= NEW."Inicio"');
    expect(ruleToSql('Len([Nombre]) > 2 Or [Activo] = No', null, NEWF)).toBe('length (NEW."Nombre") > 2 OR NEW."Activo" = 0');
  });
  it('text it cannot read is refused', () => {
    expect(ruleToSql('>= @@', 'v', NEWF)).toBeNull();
  });
});

describe('triggers enforce the rules', () => {
  const setup = (): BaseDb => {
    const db = BaseDb.open(SQL);
    db.execute('CREATE TABLE P (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, edad INTEGER, inicio TEXT, fin TEXT)');
    return db;
  };
  const meta: TableMeta = {
    rule: '[fin] >= [inicio]',
    ruleText: 'La fecha final no puede ser anterior a la inicial.',
    fields: { edad: { rule: '>=0 And <=120', ruleText: 'La edad debe estar entre 0 y 120.' }, nombre: { rule: 'Like "A*" Or Like "B*"' } },
  };
  it('a value that breaks the rule is refused, with the text of the rule, on insert and on update', () => {
    const db = setup();
    db.setMeta('P', meta);
    db.execute("INSERT INTO P (nombre, edad, inicio, fin) VALUES ('Ana', 30, '2025-01-01', '2025-02-01')");
    expect(() => db.execute("INSERT INTO P (nombre, edad) VALUES ('Ana', 200)")).toThrow('La edad debe estar entre 0 y 120.');
    expect(() => db.updateCell('P', 1, 'edad', '-5')).toThrow('La edad debe estar entre 0 y 120.');
    expect(() => db.execute("INSERT INTO P (nombre, edad, inicio, fin) VALUES ('Ana', 1, '2025-05-01', '2025-01-01')")).toThrow('La fecha final no puede ser anterior a la inicial.');
    expect(() => db.execute("INSERT INTO P (nombre) VALUES ('Zoe')")).toThrow(/no cumple la regla/);
    expect(db.count('P')).toBe(1);
  });
  it('empty values pass (as in Access), and rules are dropped when removed', () => {
    const db = setup();
    db.setMeta('P', meta);
    db.execute("INSERT INTO P (nombre) VALUES (NULL)");
    db.setMeta('P', { fields: {} });
    db.execute("INSERT INTO P (nombre, edad) VALUES ('Zoe', 500)");
    expect(db.count('P')).toBe(2);
    expect(db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger'").rows[0]![0]).toBe(0);
  });
  it('a rule that cannot be read changes nothing', () => {
    const db = setup();
    db.setMeta('P', meta);
    expect(() => db.setMeta('P', { fields: { edad: { rule: '>= @@' } } })).toThrow(/no se entiende/);
    expect(() => db.execute("INSERT INTO P (nombre, edad) VALUES ('Ana', 200)")).toThrow('La edad debe estar entre 0 y 120.');
  });
  it('the properties are saved with the table, and one undo step takes them back', () => {
    const db = setup();
    db.setMeta('P', { description: 'Personas', fields: { edad: { caption: 'Edad (años)', format: 'fixed' } } });
    expect(db.getMeta('P').fields.edad?.caption).toBe('Edad (años)');
    db.undo();
    expect(db.getMeta('P').fields.edad).toBeUndefined();
  });
  it('rules survive a table rebuild', () => {
    const db = setup();
    db.setMeta('P', meta);
    const cols = db.columns('P').map((c) => ({ ...c, orig: c.name }));
    db.alterTable('P', [...cols, { ...cols[0]!, name: 'extra', orig: undefined, primaryKey: false, autoIncrement: false }]);
    expect(() => db.execute("INSERT INTO P (nombre, edad) VALUES ('Ana', 200)")).toThrow('La edad debe estar entre 0 y 120.');
  });
  it('after renaming the table the rules still hold, once', () => {
    const db = setup();
    db.setMeta('P', meta);
    db.renameTable('P', 'Q');
    const m = db.getMeta('P');
    db.deleteObject('tableprops', 'P');
    db.setMeta('Q', m, false);
    expect(db.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='Q'").rows[0]![0]).toBe(6);
    expect(() => db.execute("INSERT INTO Q (nombre, edad) VALUES ('Ana', 200)")).toThrow('La edad debe estar entre 0 y 120.');
  });
  it('clean metadata drops empty entries', () => {
    expect(cleanMeta({ fields: { a: { caption: '', format: undefined } } })).toBeNull();
    expect(cleanMeta({ description: ' x ', fields: { a: { caption: 'A' }, b: {} } })).toEqual({ description: 'x', fields: { a: { caption: 'A' } } });
  });
});

describe('indexes', () => {
  it('create, list and drop; unique refuses repeated values', () => {
    const db = BaseDb.open(SQL);
    db.execute("CREATE TABLE T (a TEXT, b TEXT); INSERT INTO T VALUES ('x','1'), ('x','2')");
    db.createIndex('T', 'ix_ab', ['a', 'b'], false);
    expect(db.indexes('T').find((i) => i.name === 'ix_ab')).toMatchObject({ unique: false, columns: ['a', 'b'], auto: false });
    expect(() => db.createIndex('T', 'ux_a', ['a'], true)).toThrow(/repetidos/);
    db.createIndex('T', 'ux_ab', ['a', 'b'], true);
    db.dropIndex('ix_ab');
    expect(db.indexes('T').map((i) => i.name)).toEqual(['ux_ab']);
    expect(() => db.createIndex('T', 'bad', ['zz'], false)).toThrow(/No existe el campo/);
  });
});
