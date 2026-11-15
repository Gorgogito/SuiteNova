import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, decryptDb, encryptDb, isEncrypted, loadSql } from './index';

let SQL: Awaited<ReturnType<typeof loadSql>>;
beforeAll(async () => {
  SQL = await loadSql();
});

describe('compact and repair', () => {
  it('shrinks the file after deleting data, reports the check, and keeps data and undo', () => {
    const db = BaseDb.open(SQL);
    db.execute('CREATE TABLE T (id INTEGER PRIMARY KEY, txt TEXT)');
    const filler = 'x'.repeat(2000);
    db.execute(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 400) INSERT INTO T SELECT i, '${filler}' || i FROM n`);
    db.execute('DELETE FROM T WHERE id > 20');
    const r = db.compact();
    expect(r.sizeAfter).toBeLessThan(r.sizeBefore);
    expect(r.integrity).toEqual(['ok']);
    expect(r.repaired).toBe(false);
    expect(r.foreignKeyProblems).toBe(0);
    expect(db.count('T')).toBe(20);
    // the history of undo is still there (the delete can be taken back)
    db.undo();
    expect(db.count('T')).toBe(400);
  });
  it('counts records that break a relationship, and the database goes on working after it (functions of data macros included)', () => {
    const db = BaseDb.open(SQL);
    db.execute('CREATE TABLE P (id INTEGER PRIMARY KEY); CREATE TABLE C (id INTEGER PRIMARY KEY, p INTEGER REFERENCES P(id))');
    db.execute('PRAGMA foreign_keys = OFF; INSERT INTO C VALUES (1, 99); PRAGMA foreign_keys = ON');
    const r = db.compact();
    expect(r.foreignKeyProblems).toBe(1);
    const seen: string[] = [];
    db.setMeta('C', { fields: {}, dataMacros: { afterInsert: { steps: [{ action: 'Comment', args: {} }] } } });
    db.dataMacroHook = (_t, e) => void seen.push(e);
    db.compact();
    db.execute('INSERT INTO P VALUES (1); INSERT INTO C VALUES (2, 1)');
    expect(seen).toEqual(['afterInsert']);
  });
});

describe('password protection', () => {
  it('encrypts a database file so that only the password opens it again', async () => {
    const db = BaseDb.open(SQL);
    db.execute(`CREATE TABLE Secreto (id INTEGER PRIMARY KEY, dato TEXT); INSERT INTO Secreto VALUES (1, 'contenido reservado ñ €')`);
    const plain = db.export();
    const enc = await encryptDb(plain, 'clave segura');
    expect(isEncrypted(enc)).toBe(true);
    expect(isEncrypted(plain)).toBe(false);
    // the text of the data is not in the file
    expect(new TextDecoder('latin1').decode(enc)).not.toContain('contenido reservado');
    expect(new TextDecoder('latin1').decode(enc)).not.toContain('SQLite format');
    const back = await decryptDb(enc, 'clave segura');
    expect(Array.from(back)).toEqual(Array.from(plain));
    expect(BaseDb.open(SQL, back).execute('SELECT dato FROM Secreto').rows).toEqual([['contenido reservado ñ €']]);
  });
  it('a wrong password, a damaged file and an empty password are refused with a clear message', async () => {
    const enc = await encryptDb(new Uint8Array([1, 2, 3, 4, 5]), 'abc');
    await expect(decryptDb(enc, 'abd')).rejects.toThrow(/contraseña no es correcta/);
    const bad = new Uint8Array(enc);
    bad.set([bad[bad.length - 1]! ^ 1], bad.length - 1);
    await expect(decryptDb(bad, 'abc')).rejects.toThrow(/contraseña no es correcta|dañado/);
    await expect(encryptDb(new Uint8Array([1]), '')).rejects.toThrow(/no puede estar vacía/);
    await expect(decryptDb(new Uint8Array([1, 2, 3]), 'abc')).rejects.toThrow(/no está cifrado/);
    expect(isEncrypted(new Uint8Array(10))).toBe(false);
  });
  it('every encryption is different (new salt and IV), and the same password opens each one; unicode passwords work', async () => {
    const data = new Uint8Array(1000).map((_, i) => i % 256);
    const a = await encryptDb(data, 'Contraseña ñandú 🔑');
    const b = await encryptDb(data, 'Contraseña ñandú 🔑');
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(Array.from(await decryptDb(a, 'Contraseña ñandú 🔑'))).toEqual(Array.from(data));
    expect(Array.from(await decryptDb(b, 'Contraseña ñandú 🔑'))).toEqual(Array.from(data));
  });
});
