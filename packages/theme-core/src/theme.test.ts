import { describe, expect, it } from 'vitest';
import {
  COLOR_SCHEMES, EFFECT_SCHEMES, FONT_SCHEMES, SCHEME_SLOTS, readColorSchemeXml, readFontSchemeXml, writeColorSchemeXml, writeFontSchemeXml, emptyCustom, officeTheme, parseCustom, paletteOf, readThemeXml, readThmx, removeCustom, saveColors, saveTheme,
  stringifyCustom, themeCatalog, themeColor, themeGallery, tintColor, withColors, withEffects, withFonts, writeThemeXml, writeThmx,
} from './index';

describe('colours', () => {
  it('tints like the colour gallery of Office', () => {
    expect(tintColor('#ffffff', -0.5)).toBe('#808080');
    expect(tintColor('#000000', 0.5)).toBe('#808080');
    expect(tintColor('#4472c4', 0)).toBe('#4472c4');
    expect(tintColor('#4472c4', 1)).toBe('#ffffff');
    expect(tintColor('#4472c4', -1)).toBe('#000000');
  });
  it('has ten columns of six', () => {
    const g = themeGallery(officeTheme());
    expect(g).toHaveLength(10);
    expect(g.every((c) => c.colors.length === 6)).toBe(true);
    expect(g.map((c) => c.label)).toEqual(['Fondo 1', 'Texto 1', 'Fondo 2', 'Texto 2', 'Énfasis 1', 'Énfasis 2', 'Énfasis 3', 'Énfasis 4', 'Énfasis 5', 'Énfasis 6']);
    expect(g[0]!.colors[0]).toBe('#ffffff');
    expect(g[1]!.colors[0]).toBe('#000000');
  });
  it('reads bg1/tx1 through the colour map and builds a palette', () => {
    const t = officeTheme();
    expect(themeColor(t, 'bg1')).toBe('#ffffff');
    expect(themeColor(t, 'tx2')).toBe('#44546a');
    expect(paletteOf(t).accents).toHaveLength(6);
  });
});

describe('the catalogue', () => {
  it('has complete schemes', () => {
    for (const c of COLOR_SCHEMES) expect(SCHEME_SLOTS.every((s) => /^#[0-9a-f]{6}$/.test(c.colors[s]))).toBe(true);
    expect(FONT_SCHEMES[0]!.fonts.major.latin).toBe('Calibri Light');
    expect(EFFECT_SCHEMES.map((e) => e.id)).toEqual(['office', 'office2007', 'subtle', 'moderate', 'intense']);
    expect(themeCatalog()[0]!.name).toBe('Tema de Office');
  });
});

describe('theme1.xml and .thmx', () => {
  it('goes back as it came', () => {
    const t = withEffects(withFonts(withColors(officeTheme(), COLOR_SCHEMES[3]!.colors, 'Azul'), FONT_SCHEMES[2]!.fonts, 'Arial'), EFFECT_SCHEMES[4]!.fmtXml, 'Intenso');
    const back = readThemeXml(writeThemeXml({ ...t, name: 'Mi «tema» & más' }));
    expect(back.name).toBe('Mi «tema» & más');
    expect(back.colors).toEqual(t.colors);
    expect(back.colorsName).toBe('Azul');
    expect(back.fonts.major.latin).toBe('Arial');
    expect(back.fontsName).toBe('Arial');
    expect(back.effectsName).toBe('Intenso');
    expect(back.fmtXml).toContain('outerShdw');
  });
  it('reads system colours and keeps what follows the theme elements', () => {
    const xml = `<?xml version="1.0"?><a:theme xmlns:a="x" name="T"><a:themeElements><a:clrScheme name="C"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="F"><a:majorFont><a:latin typeface="Cambria"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst/></a:fmtScheme></a:themeElements><a:objectDefaults><a:spDef/></a:objectDefaults><a:extraClrSchemeLst/></a:theme>`;
    const t = readThemeXml(xml);
    expect(t.colors.dk1).toBe('#000000');
    expect(t.colors.lt1).toBe('#ffffff');
    expect(t.colors.accent4).toBe('#8064a2');
    expect(t.fonts.major.latin).toBe('Cambria');
    expect(t.tail).toContain('<a:spDef/>');
    expect(writeThemeXml(t)).toContain('<a:spDef/>');
    expect(writeThemeXml(t)).toContain('<a:sysClr val="windowText" lastClr="000000"/>');
  });
  it('refuses a file that is not a theme', () => {
    expect(() => readThemeXml('<hola/>')).toThrow(/tema/);
  });
  it('makes a .thmx that reads back', async () => {
    const t = withColors(officeTheme(), COLOR_SCHEMES[5]!.colors, 'Verde');
    const back = await readThmx(await writeThmx(t));
    expect(back.colors).toEqual(t.colors);
    await expect(readThmx(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

describe('the themes the person saves', () => {
  it('keeps, replaces by name, removes and survives bad text', () => {
    let c = saveColors(emptyCustom(), { name: 'Mis colores', colors: COLOR_SCHEMES[1]!.colors });
    c = saveColors(c, { name: 'mis colores', colors: COLOR_SCHEMES[2]!.colors });
    expect(c.colors).toHaveLength(1);
    c = saveTheme(c, withColors(officeTheme(), COLOR_SCHEMES[4]!.colors, 'X'));
    const back = parseCustom(stringifyCustom(c));
    expect(back.colors).toHaveLength(1);
    expect(back.themes).toHaveLength(1);
    expect(removeCustom(back, 'themes', back.themes[0]!.name).themes).toHaveLength(0);
    expect(parseCustom('no es json')).toEqual(emptyCustom());
    expect(parseCustom(JSON.stringify({ colors: [{ name: 'a', colors: { dk1: 'rojo' } }] })).colors).toHaveLength(0);
  });
});

describe('schemes as files of their own', () => {
  it('go back as they came', () => {
    const c = readColorSchemeXml(writeColorSchemeXml('Mi paleta', COLOR_SCHEMES[3]!.colors));
    expect(c.name).toBe('Mi paleta');
    expect(c.colors).toEqual(COLOR_SCHEMES[3]!.colors);
    const f = readFontSchemeXml(writeFontSchemeXml('Mis fuentes', FONT_SCHEMES[2]!.fonts));
    expect(f.fonts.major.latin).toBe(FONT_SCHEMES[2]!.fonts.major.latin);
    expect(() => readColorSchemeXml('<x/>')).toThrow();
    expect(() => readFontSchemeXml('<x/>')).toThrow();
  });
});

describe('referencias al tema (colores de Word)', () => {
  it('resuelve «Énfasis 1, más oscuro 25 %» como el Título 1 de Word', async () => {
    const { resolveRef, officeTheme, refToWord } = await import('./index');
    const th = officeTheme();
    expect(resolveRef(th, { slot: 'accent1', tint: -0.25 })).toBe('#2f5496');
    // Word shows 1F3763 for the shade 7F; our HSL arithmetic is off by one unit in some channels
    const dark = resolveRef(th, { slot: 'accent1', tint: -0.5 });
    for (const [i, v] of [0x1f, 0x37, 0x63].entries()) expect(Math.abs(parseInt(dark.slice(1 + i * 2, 3 + i * 2), 16) - v)).toBeLessThanOrEqual(1);
    expect(refToWord({ slot: 'accent1', tint: -0.25 })).toEqual({ themeColor: 'accent1', themeShade: 'BF' });
    expect(refToWord({ slot: 'accent1', tint: 0.8 })).toEqual({ themeColor: 'accent1', themeTint: '33' });
    expect(refToWord({ slot: 'tx1' })).toEqual({ themeColor: 'text1' });
  });
  it('lee los atributos de Word y vuelve a escribirlos igual', async () => {
    const { refFromWord, refToWord } = await import('./index');
    for (const [n, t, s] of [['accent2', undefined, 'BF'], ['accent5', '99', undefined], ['text1', 'A6', undefined], ['background1', undefined, 'F2'], ['hyperlink', undefined, undefined]] as const) {
      const r = refFromWord(n, t, s)!;
      const w = refToWord(r);
      expect(w.themeColor).toBe(n);
      expect(w.themeTint).toBe(t);
      expect(w.themeShade).toBe(s);
    }
    expect(refFromWord('none')).toBeUndefined();
  });
});
