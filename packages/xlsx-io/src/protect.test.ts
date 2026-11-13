import { Workbook, checkPassword, legacyHash, makePasswordHash, parseA1 } from '@suitenova/calc-engine';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readXlsx, writeXlsx } from './index';

async function roundTrip(w: Workbook): Promise<Workbook> {
  const { workbook } = await readXlsx(await writeXlsx(w));
  return workbook;
}

describe('contraseñas de protección', () => {
  it('el hash antiguo de 16 bits coincide con los valores conocidos de Excel', () => {
    expect(legacyHash('password')).toBe('83AF');
    expect(legacyHash('test')).toBe('CBEB');
  });
  it('el hash moderno acepta la buena y rechaza la mala', () => {
    const h = makePasswordHash('secreto', 50)!;
    expect(checkPassword({ hash: h }, 'secreto')).toBe(true);
    expect(checkPassword({ hash: h }, 'Secreto')).toBe(false);
    expect(checkPassword({ legacy: '83AF' }, 'password')).toBe(true);
    expect(checkPassword({ legacy: '83AF' }, 'otra')).toBe(false);
    expect(checkPassword({}, 'lo que sea')).toBe(true);
  });
});

describe('XLSX con protección', () => {
  it('guarda y recupera la hoja protegida, con acciones permitidas y contraseña', async () => {
    const w = new Workbook();
    w.sheets[0]!.protection = { allow: { selectLocked: true, selectUnlocked: true, formatCells: true, sort: true }, hash: makePasswordHash('abc', 10) };
    const r = await roundTrip(w);
    const p = r.sheets[0]!.protection!;
    expect(p).toBeTruthy();
    expect(p.allow.formatCells).toBe(true);
    expect(p.allow.sort).toBe(true);
    expect(p.allow.insertRows).toBeFalsy();
    expect(p.allow.objects).toBeFalsy();
    expect(checkPassword(p, 'abc')).toBe(true);
    expect(checkPassword(p, 'abd')).toBe(false);
  });

  it('usa los nombres y valores del esquema de Office', async () => {
    const w = new Workbook();
    w.sheets[0]!.protection = { allow: { selectLocked: true, selectUnlocked: true, formatCells: true } };
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    const tag = /<sheetProtection[^>]*>/.exec(xml)![0];
    expect(tag).toContain('sheet="1"');
    expect(tag).toContain('objects="1"');
    expect(tag).toContain('formatCells="0"');
    expect(tag).not.toContain('selectLockedCells');
    expect(xml.indexOf('<sheetProtection')).toBeGreaterThan(xml.indexOf('</sheetData>'));
  });

  it('lee una hoja protegida escrita al estilo de Excel con el hash antiguo', async () => {
    const w = new Workbook();
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const path = 'xl/worksheets/sheet1.xml';
    let xml = await zip.file(path)!.async('string');
    xml = xml.replace('</sheetData>', '</sheetData><sheetProtection password="83AF" sheet="1" objects="1" scenarios="1" insertRows="0" selectLockedCells="1"/>');
    zip.file(path, xml);
    const { workbook } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    const p = workbook.sheets[0]!.protection!;
    expect(p.legacy).toBe('83AF');
    expect(checkPassword(p, 'password')).toBe(true);
    expect(p.allow.insertRows).toBe(true);
    expect(p.allow.selectLocked).toBeFalsy();
    expect(p.allow.selectUnlocked).toBe(true);
    expect(p.allow.formatCells).toBeFalsy();
  });

  it('guarda y recupera la protección de la estructura del libro', async () => {
    const w = new Workbook();
    w.protection = { structure: true, hash: makePasswordHash('libro', 10) };
    const r = await roundTrip(w);
    expect(r.protection?.structure).toBe(true);
    expect(checkPassword(r.protection!, 'libro')).toBe(true);
    expect(checkPassword(r.protection!, 'x')).toBe(false);
    expect((await roundTrip(new Workbook())).protection).toBeUndefined();
  });

  it('conserva celdas desbloqueadas y fórmulas ocultas', async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.setInput(id, 0, 0, '5');
    w.setInput(id, 1, 0, '=A1*2');
    const a = parseA1('A1')!;
    const b = parseA1('A2')!;
    w.formatRange(id, { r1: a.row, c1: a.col, r2: a.row, c2: a.col }, { locked: false });
    w.formatRange(id, { r1: b.row, c1: b.col, r2: b.row, c2: b.col }, { hidden: true });
    const r = await roundTrip(w);
    expect(r.getStyle(r.sheets[0]!.id, a.row, a.col).locked).toBe(false);
    expect(r.getStyle(r.sheets[0]!.id, a.row, a.col).hidden).toBeUndefined();
    expect(r.getStyle(r.sheets[0]!.id, b.row, b.col).hidden).toBe(true);
    expect(r.getStyle(r.sheets[0]!.id, b.row, b.col).locked).toBeUndefined();
  });

  it('conserva sin tocar un hash de otro algoritmo y no lo da por bueno', async () => {
    const w = new Workbook();
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const path = 'xl/worksheets/sheet1.xml';
    const xml = (await zip.file(path)!.async('string')).replace('</sheetData>', '</sheetData><sheetProtection sheet="1" algorithmName="SHA-1" hashValue="AAAA" saltValue="BBBB" spinCount="100000"/>');
    zip.file(path, xml);
    const { workbook } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    const p = workbook.sheets[0]!.protection!;
    expect(p.hash?.algorithm).toBe('SHA-1');
    expect(checkPassword(p, 'cualquiera')).toBe(false);
    const back = await roundTrip(workbook);
    expect(back.sheets[0]!.protection!.hash).toEqual(p.hash);
  });
});
