import { describe, expect, it } from 'vitest';
import { newDeck } from './defaults';
import { addSlide } from './ops';
import JSZip from 'jszip';
import { readTemplateFile, applyTemplate, COLOR_SCHEMES, currentThemeId, FONT_SCHEMES, isDark, setDarkVariant, setThemeColors, setThemeFonts } from './themes';
import { readPptx } from './pptx/read';
import { writePptx } from './pptx/write';

describe('themes', () => {
  it('changes colours, fonts and the light/dark variant', () => {
    let d = newDeck();
    const id = currentThemeId(d)!;
    d = setThemeColors(d, id, COLOR_SCHEMES[3]!.colors);
    d = setThemeFonts(d, id, FONT_SCHEMES[2]!.fonts);
    expect(d.themes.find((t) => t.id === id)!.colors.accent1).toBe('#0f6fc6');
    expect(d.themes.find((t) => t.id === id)!.fonts.minor.latin).toBe('Arial');
    expect(isDark(d)).toBe(false);
    expect(isDark(setDarkVariant(d, true))).toBe(true);
    expect(isDark(setDarkVariant(setDarkVariant(d, true), false))).toBe(false);
  });

  it('applies a template: slides move to the layout with the same name, and the result survives saving', async () => {
    let d = newDeck();
    d = addSlide(d, d.layouts[1]!.id, 0).deck;
    let tpl = newDeck();
    tpl = setThemeColors(tpl, currentThemeId(tpl)!, COLOR_SCHEMES[5]!.colors);
    const { data } = await writePptx(tpl);
    const loaded = (await readPptx(data)).deck;
    const out = applyTemplate(d, loaded, 'template');
    expect(out.layouts.map((l) => l.id)).toEqual(loaded.layouts.map((l) => l.id));
    for (const s of out.slides) expect(out.layouts.some((l) => l.id === s.layoutId)).toBe(true);
    expect(out.slides[1]!.layoutId && out.layouts.find((l) => l.id === out.slides[1]!.layoutId)!.name).toBe(d.layouts[1]!.name);
    expect(out.themes[0]!.colors.accent1).toBe('#549e39');
    const back = (await readPptx((await writePptx(out)).data)).deck;
    expect(back.slides.length).toBe(2);
    const themeOnly = applyTemplate(d, loaded, 'theme');
    expect(themeOnly.layouts).toEqual(d.layouts);
    expect(themeOnly.themes[0]!.colors.accent1).toBe('#549e39');
  });

  it('reads a .thmx (a theme without slides)', async () => {
    const d = setThemeColors(newDeck(), currentThemeId(newDeck())!, COLOR_SCHEMES[7]!.colors);
    const src = await JSZip.loadAsync((await writePptx(d)).data);
    const thmx = new JSZip();
    thmx.file('theme/theme/theme1.xml', await src.file('ppt/theme/theme1.xml')!.async('string'));
    const r = await readTemplateFile(await thmx.generateAsync({ type: 'uint8array' }));
    expect(r.themeOnly).toBe(true);
    expect(r.deck.themes[0]!.colors.accent1).toBe('#92278f');
  });
});
