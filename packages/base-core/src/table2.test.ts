import { beforeAll, describe, expect, it } from 'vitest';
import { AlterLossError, BaseDb, MAX_ATTACHMENTS_PER_FIELD, MAX_ATTACHMENT_BYTES, addAttachment, attachmentBytes, attachmentLabel, calcToSql, formatField, loadSql, newColumn, parseAttachments, serializeAttachments, type ColumnDef } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});
const col = (name: string, type: string, extra: Partial<ColumnDef> = {}): ColumnDef => ({ ...newColumn(name, type), ...extra });

describe('calculated fields', () => {
  it('translates an Access expression to SQL over the fields of the table', () => {
    expect(calcToSql('[Precio] * [Cantidad]', ['Precio', 'Cantidad'])).toBe('"Precio" * "Cantidad"');
    expect(calcToSql('[precio]*1,21', ['Precio'])).toContain('1.21');
    expect(calcToSql('IIf([a] > 0, [a], 0)', ['a'])).toMatch(/"a"/);
    expect(() => calcToSql('[Nada] * 2', ['a'])).toThrow(/\[Nada\] no existe/);
    expect(() => calcToSql('[a] * 2', ['a'], 'a')).toThrow(/a sí mismo/);
    expect(() => calcToSql('@@', ['a'])).toThrow(/No se entiende/);
    expect(calcToSql('Fecha()', [])).toBe("date('now')");
    expect(calcToSql('Ahora()', [])).toBe("datetime('now')");
  });

  it('a table with a calculated field computes it, shows it as a column and refuses to write it', () => {
    const db = BaseDb.open(SQL);
    db.createTable('Lineas', [col('id', 'INTEGER', { primaryKey: true, autoIncrement: true }), col('precio', 'REAL'), col('cantidad', 'INTEGER'), col('total', 'REAL', { generated: { expr: '"precio" * "cantidad"', stored: false } }), col('iva', 'REAL', { generated: { expr: '"total" * 0.21', stored: true } })]);
    const cols = db.columns('Lineas');
    expect(cols.map((c) => c.name)).toEqual(['id', 'precio', 'cantidad', 'total', 'iva']);
    expect(cols[3]!.generated).toEqual({ expr: '"precio" * "cantidad"', stored: false });
    expect(cols[4]!.generated).toEqual({ expr: '"total" * 0.21', stored: true });
    expect(cols[1]!.generated).toBeUndefined();
    db.insertRow('Lineas', { precio: 10, cantidad: 3 });
    expect(db.execute('SELECT total, iva FROM Lineas').rows).toEqual([[30, 6.3]]);
    expect(db.browse('Lineas').rows[0]).toEqual([1, 1, 10, 3, 30, 6.3]);
    expect(() => db.updateCell('Lineas', 1, 'total', '5')).toThrow(/es calculado/);
    expect(() => db.insertRow('Lineas', { precio: 1, cantidad: 1, total: 99 })).toThrow(/es calculado/);
    db.updateCell('Lineas', 1, 'cantidad', '4');
    expect(db.execute('SELECT total FROM Lineas').rows).toEqual([[40]]);
  });

  it('redesigning the table keeps the calculated fields, follows renames, and they can be added or removed', () => {
    const db = BaseDb.open(SQL);
    db.createTable('L', [col('id', 'INTEGER', { primaryKey: true, autoIncrement: true }), col('precio', 'REAL'), col('cantidad', 'INTEGER'), col('total', 'REAL', { generated: { expr: '"precio" * "cantidad"', stored: false } })]);
    db.insertRow('L', { precio: 2, cantidad: 5 });
    const cols = db.columns('L');
    // rename precio, add a stored one, keep total as it was
    const next = cols.map((c) => ({ ...c, orig: c.name, ...(c.name === 'precio' ? { name: 'unitario' } : {}) }));
    next.push({ ...col('doble', 'REAL', { generated: { expr: '"total" * 2', stored: true } }) } as never);
    const report = db.alterTable('L', next);
    expect(report.skipped).toEqual([]);
    expect(db.columns('L').map((c) => c.name)).toEqual(['id', 'unitario', 'cantidad', 'total', 'doble']);
    expect(db.columns('L')[3]!.generated!.expr).toBe('"unitario" * "cantidad"');
    expect(db.execute('SELECT unitario, total, doble FROM L').rows).toEqual([[2, 10, 20]]);
    // remove the calculated fields: the data of the others stays
    db.alterTable('L', db.columns('L').filter((c) => !c.generated).map((c) => ({ ...c, orig: c.name })));
    expect(db.columns('L').map((c) => c.name)).toEqual(['id', 'unitario', 'cantidad']);
    expect(db.execute('SELECT unitario FROM L').rows).toEqual([[2]]);
  });

  it('SQLite refuses an expression that is not the same every time (when the table is made or when a record is written)', () => {
    const db = BaseDb.open(SQL);
    const attempt = () => {
      db.createTable('X', [col('a', 'INTEGER'), col('b', 'TEXT', { generated: { expr: "date('now')", stored: false } })]);
      db.insertRow('X', { a: 1 });
      db.execute('SELECT b FROM X');
    };
    expect(attempt).toThrow(/deterministic/i);
  });

  it('validateCalculated catches an expression that is not deterministic, before anything is saved', () => {
    const db = BaseDb.open(SQL);
    const ok = [col('a', 'INTEGER'), col('b', 'INTEGER', { generated: { expr: '"a" * 2', stored: false } })];
    expect(() => db.validateCalculated(ok)).not.toThrow();
    expect(() => db.validateCalculated([col('a', 'INTEGER'), col('b', 'TEXT', { generated: { expr: "date('now')", stored: false } })])).toThrow(/siempre el mismo resultado/);
    expect(db.tableNames()).toEqual([]);
  });

  it('a generated column written outside Nova Base is read, and no longer reported as a loss', () => {
    const db = BaseDb.open(SQL);
    db.execute('CREATE TABLE E (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * (2 + 1)) STORED, c TEXT AS (upper(\'x\')) VIRTUAL)');
    const cols = db.columns('E');
    expect(cols.find((c) => c.name === 'b')!.generated).toEqual({ expr: 'a * (2 + 1)', stored: true });
    expect(cols.find((c) => c.name === 'c')!.generated).toEqual({ expr: "upper('x')", stored: false });
    db.insertRow('E', { a: 2 });
    expect(db.execute('SELECT b FROM E').rows).toEqual([[6]]);
    db.alterTable('E', cols.map((c) => ({ ...c, orig: c.name })));
    expect(db.columns('E').find((c) => c.name === 'b')!.generated!.stored).toBe(true);
    // another loss is still reported
    db.execute('CREATE TABLE K (a INTEGER CHECK (a > 0), b AS (a))');
    expect(() => db.alterTable('K', db.columns('K').map((c) => ({ ...c, orig: c.name })))).toThrow(AlterLossError);
  });

  it('undo takes a calculated field back, and the file keeps it', () => {
    const db = BaseDb.open(SQL);
    db.createTable('U', [col('a', 'INTEGER'), col('b', 'INTEGER', { generated: { expr: '"a" + 1', stored: false } })]);
    db.clearUndo();
    db.insertRow('U', { a: 1 });
    db.undo();
    expect(db.count('U')).toBe(0);
    db.redo();
    const again = BaseDb.open(SQL, db.export());
    expect(again.columns('U')[1]!.generated!.expr).toBe('"a" + 1');
    expect(again.execute('SELECT b FROM U').rows).toEqual([[2]]);
  });
});

describe('attachments', () => {
  const bytes = (...n: number[]) => new Uint8Array(n);
  it('stores files in a field as a list and reads them back byte for byte', () => {
    let v = addAttachment(null, { name: 'a.txt', mime: 'text/plain', bytes: bytes(104, 105) });
    v = addAttachment(v, { name: 'foto.png', mime: 'image/png', bytes: bytes(0, 255, 128, 7) });
    const list = parseAttachments(v);
    expect(list.map((a) => [a.name, a.mime, a.size])).toEqual([['a.txt', 'text/plain', 2], ['foto.png', 'image/png', 4]]);
    expect(Array.from(attachmentBytes(list[1]!))).toEqual([0, 255, 128, 7]);
    expect(new TextDecoder().decode(attachmentBytes(list[0]!))).toBe('hi');
    expect(attachmentLabel(v)).toBe('📎 2');
    expect(serializeAttachments([])).toBeNull();
    expect(parseAttachments(serializeAttachments(list))).toEqual(list);
  });
  it('a repeated name gets a number, a big file or too many are refused, a damaged value holds nothing', () => {
    let v = addAttachment(null, { name: 'a.txt', bytes: bytes(1) });
    v = addAttachment(v, { name: 'A.TXT', bytes: bytes(2) });
    v = addAttachment(v, { name: 'a.txt', bytes: bytes(3) });
    expect(parseAttachments(v).map((a) => a.name)).toEqual(['a.txt', 'A (2).TXT', 'a (3).txt']);
    expect(() => addAttachment(null, { name: 'big.bin', bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) })).toThrow(/pesa más de 5 MB/);
    let full: string | null = null;
    for (let i = 0; i < MAX_ATTACHMENTS_PER_FIELD; i++) full = addAttachment(full, { name: `f${i}`, bytes: bytes(1) });
    expect(() => addAttachment(full, { name: 'otro', bytes: bytes(1) })).toThrow(/hasta 20/);
    for (const bad of [null, '', 'texto', '[1,2]', '{"a":1}', '[{"name":3}]', '[{"na']) expect(parseAttachments(bad)).toEqual([]);
    expect(attachmentLabel('basura')).toBe('');
  });
  it('the datasheet shows the count, and a big file survives the database', () => {
    const v = addAttachment(null, { name: 'x.bin', bytes: new Uint8Array(200_000).map((_, i) => i % 251) });
    expect(formatField(v, 'TEXT', { kind: 'attachment' })).toBe('📎 1');
    expect(formatField(null, 'TEXT', { kind: 'attachment' })).toBeNull();
    const db = BaseDb.open(SQL);
    db.createTable('A', [col('id', 'INTEGER', { primaryKey: true, autoIncrement: true }), col('adj', 'TEXT')]);
    const id = db.insertRow('A', {});
    db.updateCell('A', id, 'adj', v);
    const again = BaseDb.open(SQL, db.export());
    const got = parseAttachments(again.execute('SELECT adj FROM A').rows[0]![0]);
    expect(got).toHaveLength(1);
    expect(attachmentBytes(got[0]!).length).toBe(200_000);
    expect(attachmentBytes(got[0]!)[1000]).toBe(1000 % 251);
  });
});
