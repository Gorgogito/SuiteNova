import { COLOR_SCHEMES, FONT_SCHEMES, officeTheme, withColors, withFonts, type DocTheme } from '@suitenova/theme-core';
import JSZip from 'jszip';
import { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DOC_DEFAULTS, defaultPage, defaultSection, defaultStyles, emptyWriterDoc, makeSection, nodeTypes, readDocx, styleCss, writeDocx, writerSchema, type WriterDoc } from './index';

const mk = (name: string, attrs?: Record<string, unknown>) => writerSchema.marks[name]!.create(attrs);
const p = (text: string, attrs: Record<string, unknown> = {}, marks: ReturnType<typeof mk>[] = []) => nodeTypes.paragraph!.create(attrs, writerSchema.text(text, marks));
const wd = (theme: DocTheme | undefined, ...blocks: PMNode[]): WriterDoc => ({
  ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }),
  body: nodeTypes.doc!.create(null, [makeSection(blocks, defaultSection(defaultPage()))]),
  ...(theme ? { theme } : {}),
});
const firstBlocks = (d: WriterDoc): PMNode[] => {
  const out: PMNode[] = [];
  d.body.firstChild!.forEach((b) => out.push(b));
  return out;
};
const green = () => withColors(officeTheme(), COLOR_SCHEMES.find((s) => s.id === 'green')!.colors, 'Verde');
const part = async (data: Uint8Array, name: string) => (await JSZip.loadAsync(data)).file(name)?.async('string');

describe('Writer: el tema del documento', () => {
  it('guarda word/theme/theme1.xml y lo vuelve a leer entero', async () => {
    const th: DocTheme = { ...green(), tail: '<a:objectDefaults><a:spDef/></a:objectDefaults><a:extraClrSchemeLst/>' };
    const w = await writeDocx(wd(th, p('hola')));
    const xml = (await part(w.data, 'word/theme/theme1.xml'))!;
    expect(xml).toContain('<a:accent1>');
    expect(xml).toContain('<a:objectDefaults>');
    expect(await part(w.data, '[Content_Types].xml')).toContain('/word/theme/theme1.xml');
    expect(await part(w.data, 'word/_rels/document.xml.rels')).toContain('theme/theme1.xml');
    const back = (await readDocx(w.data)).doc.theme!;
    expect(back.colors.accent1.toLowerCase()).toBe(th.colors.accent1.toLowerCase());
    expect(back.tail).toContain('objectDefaults');
  });

  it('un documento sin tema se guarda con el de Office', async () => {
    const w = await writeDocx(wd(undefined, p('hola')));
    const back = (await readDocx(w.data)).doc.theme!;
    expect(back.colors.accent1.toLowerCase()).toBe(officeTheme().colors.accent1.toLowerCase());
  });

  it('un color del tema se escribe con themeColor y themeShade y se lee como referencia', async () => {
    const ref = { slot: 'accent1', tint: -0.25 };
    const w = await writeDocx(wd(green(), p('t', {}, [mk('color', { value: '#000000', ref })])));
    const xml = (await part(w.data, 'word/document.xml'))!;
    expect(xml).toMatch(/<w:color w:val="[0-9A-F]{6}" w:themeColor="accent1" w:themeShade="BF"\/>/);
    const r = await readDocx(w.data);
    const m = firstBlocks(r.doc)[0]!.firstChild!.marks.find((x) => x.type.name === 'color')!;
    expect(m.attrs.ref).toEqual({ slot: 'accent1', tint: expect.closeTo(-0.251, 2) });
    // the value is the one of the theme of the file, not the one that was in the mark
    expect(m.attrs.value).not.toBe('#000000');
  });

  it('un color fijo se queda fijo aunque cambie el tema', async () => {
    const w = await writeDocx(wd(green(), p('t', {}, [mk('color', { value: '#ff0000' })])));
    expect(await part(w.data, 'word/document.xml')).not.toContain('themeColor');
    const m = firstBlocks((await readDocx(w.data)).doc)[0]!.firstChild!.marks.find((x) => x.type.name === 'color')!;
    expect(m.attrs.value).toBe('#ff0000');
    expect(m.attrs.ref).toBeNull();
  });

  it('el color de un tema distinto da otro valor en el archivo, con la misma referencia', async () => {
    const ref = { slot: 'accent2' };
    const a = await writeDocx(wd(officeTheme(), p('t', {}, [mk('color', { value: '#000000', ref })])));
    const b = await writeDocx(wd(green(), p('t', {}, [mk('color', { value: '#000000', ref })])));
    const val = async (d: { data: Uint8Array }) => /<w:color w:val="([0-9A-F]{6})"/.exec((await part(d.data, 'word/document.xml'))!)![1];
    expect(await val(a)).not.toBe(await val(b));
    expect(await val(b)).toBe(green().colors.accent2.slice(1).toUpperCase());
  });

  it('la fuente del tema se escribe con asciiTheme y se lee como del tema', async () => {
    const th = withFonts(officeTheme(), FONT_SCHEMES.find((s) => s.id === 'georgia')!.fonts, 'Georgia');
    const w = await writeDocx(wd(th, p('t', {}, [mk('fontFamily', { value: 'Calibri Light', theme: 'major' })])));
    const xml = (await part(w.data, 'word/document.xml'))!;
    expect(xml).toContain('w:asciiTheme="majorHAnsi"');
    expect(xml).toContain('w:ascii="Georgia"');
    const m = firstBlocks((await readDocx(w.data)).doc)[0]!.firstChild!.marks.find((x) => x.type.name === 'fontFamily');
    // the body font of the theme is Georgia too, so «major» is a mark only when it differs from the body
    expect(m === undefined || m.attrs.theme === 'major').toBe(true);
  });

  it('los estilos de título y la fuente del cuerpo siguen al tema', async () => {
    const th = withFonts(green(), FONT_SCHEMES.find((s) => s.id === 'garamond-trebuchetms')?.fonts ?? FONT_SCHEMES[1]!.fonts, 'X');
    const css = styleCss(defaultStyles(), DEFAULT_DOC_DEFAULTS, th);
    expect(css).toContain(`font-family:'${th.fonts.minor.latin}'`);
    expect(css).toMatch(new RegExp(`\\.nw-doc \\.[\\w-]*Heading1\\{[^}]*font-family:'${th.fonts.major.latin}'`));
    expect(css).toContain(`color:${'#'}`);
    // without a theme the styles keep what they have
    expect(styleCss(defaultStyles(), DEFAULT_DOC_DEFAULTS)).toContain("font-family:'Calibri Light'");
  });

  it('el color de los títulos cambia con el tema; el tema de Office da el azul de Word', () => {
    const heading = (th: DocTheme) => /Heading1\{[^}]*color:(#[0-9a-f]{6})/.exec(styleCss(defaultStyles(), DEFAULT_DOC_DEFAULTS, th))![1];
    expect(heading(officeTheme())).toBe('#2f5496');
    expect(heading(green())).not.toBe('#2f5496');
  });

  it('el sombreado de un párrafo del tema también se guarda como referencia', async () => {
    const w = await writeDocx(wd(green(), p('t', { shade: '#000000', shadeRef: { slot: 'accent3', tint: 0.8 } })));
    const xml = (await part(w.data, 'word/document.xml'))!;
    expect(xml).toMatch(/<w:shd [^>]*w:themeFill="accent3" w:themeFillTint="33"/);
    const a = firstBlocks((await readDocx(w.data)).doc)[0]!.attrs;
    expect(a.shadeRef.slot).toBe('accent3');
  });
});

describe('Writer: cambiar el tema del documento', () => {
  it('cambia lo que apunta al tema, no lo fijo, y se deshace entero con un solo paso', async () => {
    const { EditorState } = await import('prosemirror-state');
    const { applyThemeTo } = await import('./retheme');
    const ref = { slot: 'accent1' };
    const doc = wd(
      officeTheme(),
      p('tema', { shade: '#4472c4', shadeRef: { slot: 'accent1' } }, [mk('color', { value: '#4472c4', ref }), mk('fontFamily', { value: 'Calibri Light', theme: 'major' })]),
      p('fijo', {}, [mk('color', { value: '#ff0000' })]),
    ).body;
    const state = EditorState.create({ doc });
    const next = green();
    const tr = applyThemeTo(state.tr, next);
    const after = state.apply(tr).doc;
    const first = after.firstChild!.child(0).child(0);
    expect(first.marks.find((m) => m.type.name === 'color')!.attrs.value).toBe(next.colors.accent1);
    expect(first.marks.find((m) => m.type.name === 'fontFamily')!.attrs.value).toBe(next.fonts.major.latin);
    expect(after.firstChild!.child(0).attrs.shade).toBe(next.colors.accent1);
    expect(after.firstChild!.child(1).child(0).marks.find((m) => m.type.name === 'color')!.attrs.value).toBe('#ff0000');
    expect(after.attrs.theme.colors.accent1).toBe(next.colors.accent1);
    expect(after.eq(doc)).toBe(false);
  });

  it('rethemeNode da el mismo resultado para las partes fuera del historial', async () => {
    const { rethemeNode } = await import('./retheme');
    const n = nodeTypes.doc!.create(null, [p('x', {}, [mk('color', { value: '#4472c4', ref: { slot: 'accent2' } })])]);
    const out = rethemeNode(n, green());
    expect(out.firstChild!.firstChild!.marks[0]!.attrs.value).toBe(green().colors.accent2);
  });
});

describe('Writer: la firma digital y el tema', () => {
  it('el contenido firmado es el mismo en memoria y después de guardar y volver a leer', async () => {
    const { digestOf } = await import('./crypto/sign');
    const { resolveRef } = await import('@suitenova/theme-core');
    const th = green();
    const ref = { slot: 'accent1', tint: -0.25 } as const;
    const shadeRef = { slot: 'accent3', tint: 0.8 } as const;
    const doc = wd(th, p('t', { shade: resolveRef(th, shadeRef), shadeRef }, [mk('color', { value: resolveRef(th, ref), ref }), mk('fontFamily', { value: th.fonts.major.latin, theme: 'major' })]));
    // the app keeps the theme in the document node
    const inApp: WriterDoc = { ...doc, body: doc.body.type.create({ theme: th }, doc.body.content) };
    const back = (await readDocx((await writeDocx(inApp)).data)).doc;
    const backInApp: WriterDoc = { ...back, body: back.body.type.create({ theme: back.theme }, back.body.content) };
    expect(await digestOf(backInApp)).toBe(await digestOf(inApp));
  });
});
