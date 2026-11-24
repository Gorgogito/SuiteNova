import { Workbook, parseA1, resolveThemeRef } from '@suitenova/calc-engine';
import { COLOR_SCHEMES, FONT_SCHEMES, officeTheme, withColors, withFonts } from '@suitenova/theme-core';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readXlsx, writeXlsx } from './index';

const green = () => withColors(officeTheme(), COLOR_SCHEMES.find((s) => s.id === 'green')!.colors, 'Verde');
const cell = (w: Workbook, a: string) => {
  const p = parseA1(a)!;
  return w.styles.get(w.getCell(w.sheets[0]!.id, p.row, p.col)!.style);
};
const put = (w: Workbook, a: string, text: string, style: Record<string, unknown>) => {
  const p = parseA1(a)!;
  const id = w.sheets[0]!.id;
  w.setInput(id, p.row, p.col, text);
  w.formatRange(id, { r1: p.row, c1: p.col, r2: p.row, c2: p.col }, style);
};
async function roundTrip(w: Workbook): Promise<{ wb: Workbook; zip: JSZip }> {
  const bytes = await writeXlsx(w);
  return { wb: (await readXlsx(bytes)).workbook, zip: await JSZip.loadAsync(bytes) };
}

describe('Calc: el tema del libro', () => {
  it('guarda xl/theme/theme1.xml con su relación y lo vuelve a leer', async () => {
    const w = new Workbook();
    w.setTheme(withFonts(green(), FONT_SCHEMES.find((s) => s.id === 'georgia')!.fonts, 'Georgia'));
    put(w, 'A1', 'x', {});
    const { wb, zip } = await roundTrip(w);
    expect(zip.file('xl/theme/theme1.xml')).toBeTruthy();
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('/xl/theme/theme1.xml');
    expect(await zip.file('xl/_rels/workbook.xml.rels')!.async('string')).toContain('theme/theme1.xml');
    expect(wb.theme.colors.accent1.toLowerCase()).toBe(green().colors.accent1.toLowerCase());
    expect(wb.theme.fonts.major.latin).toBe('Georgia');
  });

  it('un libro sin tema se guarda con el de Office', async () => {
    const { wb } = await roundTrip(new Workbook());
    expect(wb.theme.colors.accent1.toLowerCase()).toBe(officeTheme().colors.accent1.toLowerCase());
  });

  it('el color de tema de una celda se escribe como theme="n" tint="x" y se lee como referencia', async () => {
    const w = new Workbook();
    const ref = { slot: 'accent1', tint: -0.249977111117893 } as const;
    put(w, 'A1', 'x', { bgRef: ref, bg: resolveThemeRef(w.theme, ref), colorRef: { slot: 'lt1' }, color: '#ffffff' });
    const { wb, zip } = await roundTrip(w);
    const styles = await zip.file('xl/styles.xml')!.async('string');
    expect(styles).toMatch(/<fgColor theme="4" tint="-0.249977111117893"\/>/);
    expect(styles).toMatch(/<color theme="0"\/>/);
    const st = cell(wb, 'A1');
    expect(st.bgRef).toEqual({ slot: 'accent1', tint: expect.closeTo(-0.25, 3) });
    expect(st.colorRef).toEqual({ slot: 'lt1' });
    expect(st.bg).toBe(resolveThemeRef(w.theme, ref));
  });

  it('un color fijo se queda fijo', async () => {
    const w = new Workbook();
    put(w, 'A1', 'x', { bg: '#ff0000', color: '#00ff00' });
    const { wb, zip } = await roundTrip(w);
    expect(await zip.file('xl/styles.xml')!.async('string')).toContain('<fgColor rgb="FFFF0000"/>');
    const st = cell(wb, 'A1');
    expect(st.bgRef).toBeUndefined();
    expect(st.colorRef).toBeUndefined();
  });

  it('el color automático del texto (tema 1) no pasa a ser un color de la celda', async () => {
    const w = new Workbook();
    put(w, 'A1', 'x', { bold: true });
    const { wb } = await roundTrip(w);
    const st = cell(wb, 'A1');
    expect(st.color).toBeUndefined();
    expect(st.colorRef).toBeUndefined();
  });

  it('el borde con color de tema se guarda y se lee como referencia', async () => {
    const w = new Workbook();
    const ref = { slot: 'accent2' } as const;
    put(w, 'A1', 'x', { bottom: { style: 'thin', color: resolveThemeRef(w.theme, ref), ref } });
    const { wb } = await roundTrip(w);
    expect(cell(wb, 'A1').bottom).toMatchObject({ style: 'thin', ref: { slot: 'accent2' } });
  });
});

describe('Calc: cambiar el tema', () => {
  it('repinta lo que apunta al tema, no lo fijo, y se deshace con el parche', () => {
    const w = new Workbook();
    const ref = { slot: 'accent1' } as const;
    put(w, 'A1', 'tema', { bgRef: ref, bg: resolveThemeRef(w.theme, ref) });
    put(w, 'A2', 'fijo', { bg: '#ff0000' });
    const before = officeTheme().colors.accent1;
    const next = green();
    const patch = w.setTheme(next);
    expect(cell(w, 'A1').bg).toBe(next.colors.accent1);
    expect(cell(w, 'A2').bg).toBe('#ff0000');
    expect(w.theme).toBe(next);
    w.applyPatch(patch, true);
    expect(cell(w, 'A1').bg).toBe(before);
    expect(w.theme.colors.accent1).toBe(before);
    w.applyPatch(patch, false);
    expect(cell(w, 'A1').bg).toBe(next.colors.accent1);
  });

  it('las celdas conservan su estilo (los números no cambian) y los iguales siguen siendo uno', () => {
    const w = new Workbook();
    const ref = { slot: 'accent3', tint: 0.8 } as const;
    put(w, 'A1', '1', { bgRef: ref, bg: resolveThemeRef(w.theme, ref) });
    put(w, 'A2', '2', { bgRef: ref, bg: resolveThemeRef(w.theme, ref) });
    const id = w.getCell(w.sheets[0]!.id, 0, 0)!.style;
    w.setTheme(green());
    expect(w.getCell(w.sheets[0]!.id, 0, 0)!.style).toBe(id);
    expect(w.getCell(w.sheets[0]!.id, 1, 0)!.style).toBe(id);
    expect(w.styles.intern({ ...w.styles.get(id) })).toBe(id);
  });
});

describe('Calc: las fuentes del tema', () => {
  const geo = () => withFonts(officeTheme(), { major: { latin: 'Georgia' }, minor: { latin: 'Verdana' }, name: 'Prueba' } as never, 'Prueba');

  it('la fuente del libro es la de cuerpo del tema: cambia con el tema y se deshace', () => {
    const w = new Workbook();
    expect(w.defaultFont.name).toBe('Calibri');
    const patch = w.setTheme(geo());
    expect(w.defaultFont.name).toBe('Verdana');
    w.applyPatch(patch, true);
    expect(w.defaultFont.name).toBe(officeTheme().fonts.minor.latin);
  });

  it('una fuente de títulos (scheme major) sigue al tema', async () => {
    const w = new Workbook();
    put(w, 'A1', 'x', { fontName: 'Calibri Light', fontTheme: 'major' });
    const { wb, zip } = await roundTrip(w);
    const styles = await zip.file('xl/styles.xml')!.async('string');
    expect(styles).toContain('<scheme val="major"/>');
    expect(styles).toContain('<scheme val="minor"/>');
    expect(cell(wb, 'A1').fontTheme).toBe('major');
    wb.setTheme(geo());
    expect(cell(wb, 'A1').fontName).toBe('Georgia');
    expect(wb.defaultFont.name).toBe('Verdana');
  });

  it('una fuente fija no sigue al tema', async () => {
    const w = new Workbook();
    put(w, 'A1', 'x', { fontName: 'Courier New' });
    const { wb } = await roundTrip(w);
    wb.setTheme(geo());
    expect(cell(wb, 'A1').fontName).toBe('Courier New');
    expect(cell(wb, 'A1').fontTheme).toBeUndefined();
  });
});
