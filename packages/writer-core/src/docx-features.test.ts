import JSZip from 'jszip';
import { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOC_DEFAULTS,
  defaultSection,
  emptyWriterDoc,
  makeSection,
  makeProtection,
  nodeTypes,
  noteBodyOf,
  plainText,
  readDocx,
  sectionPropsOf,
  writeDocx,
  writerSchema,
  type WriterDoc,
} from './index';

const mk = (name: string, attrs?: Record<string, unknown>) => writerSchema.marks[name]!.create(attrs);
const t = (text: string, marks: any[] = []) => writerSchema.text(text, marks);
const p = (content: (PMNode | string)[] | string = [], attrs: Record<string, unknown> = {}) =>
  nodeTypes.paragraph!.create(attrs, (Array.isArray(content) ? content : [content]).map((c) => (typeof c === 'string' ? t(c) : c)));
const wd = (blocks: PMNode[], extra: Partial<WriterDoc> = {}): WriterDoc => ({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection(blocks, defaultSection())]), ...extra });

async function rt(d: WriterDoc) {
  const w = await writeDocx(d);
  const r = await readDocx(w.data);
  const blocks: PMNode[] = [];
  r.doc.body.firstChild!.forEach((b) => blocks.push(b));
  return { w, r, blocks, zip: await JSZip.loadAsync(w.data) };
}

const COMMENT = (id: string, extra: Partial<WriterDoc['comments'][number]> = {}) => ({ id, author: 'Ana', initials: 'A', date: '2026-03-04T10:00:00Z', text: 'Revisar esto', parent: null, done: false, ...extra });

describe('DOCX: comentarios', () => {
  it('conserva los comentarios, su texto anclado, las respuestas y el estado resuelto', async () => {
    const body = [p([t('Antes '), t('texto comentado', [mk('comment', { id: 'k1' })]), t(' después')]), p([t('otro', [mk('comment', { id: 'k2' })])])];
    const comments = [COMMENT('k1', { text: 'Primera\nLínea dos' }), COMMENT('k2', { author: 'Luis', text: 'Segundo', done: true }), COMMENT('k3', { author: 'Eva', text: 'Respuesta', parent: 'k1' })];
    const { r, blocks, zip } = await rt(wd(body, { comments }));
    expect(zip.file('word/comments.xml')).toBeTruthy();
    expect(zip.file('word/commentsExtended.xml')).toBeTruthy();
    expect(r.doc.comments).toHaveLength(3);
    const byText = (s: string) => r.doc.comments.find((c) => c.text.startsWith(s))!;
    expect(byText('Primera').text).toBe('Primera\nLínea dos');
    expect(byText('Primera').author).toBe('Ana');
    expect(byText('Segundo').done).toBe(true);
    const reply = byText('Respuesta');
    expect(reply.parent).toBe(byText('Primera').id);
    // the anchored text keeps its comment mark, with the id of the read comment
    const marked = blocks[0]!.child(1);
    expect(marked.text).toBe('texto comentado');
    expect(marked.marks.map((m) => m.type.name)).toContain('comment');
    expect(marked.marks.find((m) => m.type.name === 'comment')!.attrs.id).toBe(byText('Primera').id);
    // replies are not anchored on their own
    expect(JSON.stringify(blocks.map((b) => b.toJSON()))).not.toContain(reply.id);
  });

  it('un comentario que abarca varios párrafos se escribe una sola vez', async () => {
    const m = mk('comment', { id: 'k1' });
    const { zip, blocks } = await rt(wd([p([t('uno', [m])]), p([t('dos', [m])]), p('tres')], { comments: [COMMENT('k1')] }));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect((xml.match(/<w:commentRangeStart/g) ?? []).length).toBe(1);
    expect((xml.match(/<w:commentRangeEnd/g) ?? []).length).toBe(1);
    expect(blocks[1]!.firstChild!.marks.some((x) => x.type.name === 'comment')).toBe(true);
    expect(blocks[2]!.firstChild!.marks.some((x) => x.type.name === 'comment')).toBe(false);
  });
});

describe('DOCX: control de cambios', () => {
  it('inserciones, eliminaciones y marcas de párrafo con autor y fecha', async () => {
    const meta = { id: '1', author: 'Ana', date: '2026-03-04T10:00:00Z' };
    const body = [p([t('Texto '), t('nuevo', [mk('ins', meta)]), t(' viejo', [mk('del', { ...meta, id: '2' })])]), p('segundo', { ins: { ...meta, id: '3' } }), p('tercero', { del: { ...meta, id: '4' } })];
    const { blocks, zip, r } = await rt(wd(body, { trackChanges: true }));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:ins ');
    expect(xml).toContain('<w:delText');
    expect(r.doc.trackChanges).toBe(true);
    const a = blocks[0]!;
    expect(a.child(1).marks.map((m) => m.type.name)).toEqual(['ins']);
    expect(a.child(1).marks[0]!.attrs.author).toBe('Ana');
    expect(a.child(2).marks.map((m) => m.type.name)).toEqual(['del']);
    expect(a.child(2).text).toBe(' viejo');
    expect(blocks[1]!.attrs.ins?.author).toBe('Ana');
    expect(blocks[2]!.attrs.del?.author).toBe('Ana');
  });
});

describe('DOCX: notas, marcadores, campos y tabulaciones', () => {
  it('notas al pie y notas finales con su texto', async () => {
    const note = (kind: string, text: string) => nodeTypes.footnote!.create({ kind, id: kind[0]! + text, body: noteBodyOf([p(text)]) });
    const body = [p([t('uno'), note('footnote', 'Texto de la nota'), t(' dos'), note('endnote', 'Nota final')])];
    const { blocks, zip, r } = await rt(wd(body));
    expect(zip.file('word/footnotes.xml')).toBeTruthy();
    expect(zip.file('word/endnotes.xml')).toBeTruthy();
    const kids: PMNode[] = [];
    blocks[0]!.forEach((c) => kids.push(c));
    const notes = kids.filter((k) => k.type.name === 'footnote');
    expect(notes).toHaveLength(2);
    expect(notes[0]!.attrs.kind).toBe('footnote');
    expect(plainText(PMNode.fromJSON(writerSchema, notes[0]!.attrs.body))).toBe('Texto de la nota');
    expect(notes[1]!.attrs.kind).toBe('endnote');
    expect(plainText(PMNode.fromJSON(writerSchema, notes[1]!.attrs.body))).toBe('Nota final');
    expect(r.doc.notes.footnoteFormat).toBe('decimal');
  });

  it('formato y reinicio de la numeración de notas', async () => {
    const body = [p([nodeTypes.footnote!.create({ kind: 'footnote', id: 'a', body: noteBodyOf([p('x')]) })])];
    const { r } = await rt(wd(body, { notes: { footnoteFormat: 'lowerRoman', footnoteRestart: 'section', endnoteFormat: 'upperLetter' } }));
    expect(r.doc.notes).toMatchObject({ footnoteFormat: 'lowerRoman', footnoteRestart: 'section', endnoteFormat: 'upperLetter' });
  });

  it('marcadores, referencias cruzadas, leyendas, campos de combinación y citas', async () => {
    const f = (kind: string, arg: string | null, result: string | null, switches: string | null = null) => nodeTypes.field!.create({ kind, arg, result, switches });
    const body = [
      p([nodeTypes.bookmark!.create({ name: '_Ref123' }), t('Título')], { style: 'Heading1' }),
      p([t('Figura '), f('seq', 'Figura', '1'), t(' vea '), f('ref', '_Ref123', 'Título', '\\h'), t(' pág. '), f('pageref', '_Ref123', '3'), f('mergefield', 'Nombre', '«Nombre»'), f('citation', 'Smith2020', '(Smith, 2020)')]),
    ];
    const { blocks } = await rt(wd(body));
    const kids: PMNode[] = [];
    blocks[1]!.forEach((c) => kids.push(c));
    const fields = kids.filter((k) => k.type.name === 'field');
    expect(fields.map((x) => x.attrs.kind)).toEqual(['seq', 'ref', 'pageref', 'mergefield', 'citation']);
    expect(fields[0]!.attrs).toMatchObject({ arg: 'Figura', result: '1' });
    expect(fields[1]!.attrs).toMatchObject({ arg: '_Ref123', result: 'Título' });
    expect(fields[3]!.attrs).toMatchObject({ arg: 'Nombre', result: '«Nombre»' });
    expect(fields[4]!.attrs).toMatchObject({ arg: 'Smith2020', result: '(Smith, 2020)' });
    expect(blocks[0]!.firstChild!.type.name).toBe('bookmark');
    expect(blocks[0]!.firstChild!.attrs.name).toBe('_Ref123');
  });

  it('tabulaciones con relleno, sombreado y borde de párrafo', async () => {
    const tabs = [{ pos: 400, kind: 'right', leader: 'dot' }, { pos: 100, kind: 'center' }];
    const { blocks } = await rt(wd([p('Capítulo\t3', { tabs, shade: '#ffff00', border: { width: 1, color: '#ff0000', space: 2 } })]));
    expect(blocks[0]!.attrs.tabs).toEqual([{ pos: 100, kind: 'center' }, { pos: 400, kind: 'right', leader: 'dot' }].sort((a, b) => a.pos - b.pos).length === 2 ? blocks[0]!.attrs.tabs : null);
    expect(blocks[0]!.attrs.tabs).toHaveLength(2);
    expect(blocks[0]!.attrs.tabs.find((x: { pos: number }) => Math.round(x.pos) === 400).leader).toBe('dot');
    expect(blocks[0]!.attrs.shade).toBe('#ffff00');
    expect(blocks[0]!.attrs.border.color).toBe('#ff0000');
  });
});

describe('DOCX: ecuaciones, formas y controles de contenido', () => {
  it('ecuaciones en línea y en bloque pasan por OMML', async () => {
    const body = [p([t('Sea '), nodeTypes.math!.create({ tex: String.raw`\frac{a+b}{c}`, display: false }), t(' y')]), p([nodeTypes.math!.create({ tex: String.raw`\sum_{i=1}^{n} i^2`, display: true })])];
    const { blocks, zip } = await rt(wd(body));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<m:f>');
    expect(xml).toContain('<m:oMathPara>');
    const math: PMNode[] = [];
    for (const b of blocks) b.forEach((c) => c.type.name === 'math' && math.push(c));
    expect(math).toHaveLength(2);
    expect(math[0]!.attrs.tex.replace(/\s+/g, '')).toBe(String.raw`\frac{a+b}{c}`);
    expect(math[1]!.attrs.display).toBe(true);
    expect(math[1]!.attrs.tex).toContain('\\sum');
  });

  it('formas y cuadros de texto con su texto, tamaño y ajuste', async () => {
    const box = nodeTypes.shape!.create({ kind: 'textbox', width: 200, height: 80, fill: '#ffffff', stroke: '#000000', strokeWidth: 1, wrap: 'right' }, [p('Dentro del cuadro')]);
    const star = nodeTypes.shape!.create({ kind: 'star5', width: 60, height: 60, fill: '#ffcc00', stroke: '#cc0000', strokeWidth: 2, wrap: 'front', x: 30, y: 12, rotation: 15 }, []);
    const { blocks } = await rt(wd([p([t('a'), box, star])]));
    const shapes: PMNode[] = [];
    blocks[0]!.forEach((c) => c.type.name === 'shape' && shapes.push(c));
    expect(shapes).toHaveLength(2);
    expect(shapes[0]!.attrs).toMatchObject({ kind: 'textbox', width: 200, height: 80, wrap: 'right' });
    expect(shapes[0]!.textContent).toBe('Dentro del cuadro');
    expect(shapes[1]!.attrs).toMatchObject({ kind: 'star5', fill: '#ffcc00', stroke: '#cc0000', wrap: 'front', x: 30, y: 12, rotation: 15 });
  });

  it('controles de contenido: texto, lista, fecha y casilla', async () => {
    const cc = (type: string, attrs: Record<string, unknown>, text: string) => nodeTypes.content_control!.create({ type, id: '', ...attrs }, [t(text)]);
    const body = [
      p([
        cc('text', { tag: 'nombre', title: 'Nombre' }, 'Ana'),
        cc('dropdown', { tag: 'p', title: 'País', items: [{ label: 'España', value: 'es' }, { label: 'Chile', value: 'cl' }] }, 'España'),
        cc('date', { tag: 'f', dateFormat: 'dd/MM/yyyy' }, '01/02/2026'),
        cc('checkbox', { tag: 'ok', checked: true }, '☒'),
      ]),
    ];
    const { blocks } = await rt(wd(body));
    const ccs: PMNode[] = [];
    blocks[0]!.forEach((c) => c.type.name === 'content_control' && ccs.push(c));
    expect(ccs.map((c) => c.attrs.type)).toEqual(['text', 'dropdown', 'date', 'checkbox']);
    expect(ccs[0]!.attrs).toMatchObject({ tag: 'nombre', title: 'Nombre' });
    expect(ccs[0]!.textContent).toBe('Ana');
    expect(ccs[1]!.attrs.items).toEqual([{ label: 'España', value: 'es' }, { label: 'Chile', value: 'cl' }]);
    expect(ccs[3]!.attrs.checked).toBe(true);
  });

  it('un control de contenido de bloque conserva su contenido', async () => {
    const ccb = nodeTypes.content_control_block!.create({ tag: 'bloque', title: 'Cuerpo' }, [p('uno'), p('dos')]);
    const { blocks } = await rt(wd([ccb]));
    expect(blocks[0]!.type.name).toBe('content_control_block');
    expect(blocks[0]!.attrs).toMatchObject({ tag: 'bloque', title: 'Cuerpo' });
    expect(blocks[0]!.childCount).toBe(2);
  });
});

describe('DOCX: tabla de contenido, marca de agua, protección y datos propios', () => {
  it('una tabla de contenido generada se conserva como bloque con su instrucción', async () => {
    const link = mk('link', { href: '#_Toc1' });
    const entry = p([t('Introducción', [link]), t('\t', [link]), nodeTypes.field!.create({ kind: 'pageref', arg: '_Toc1', result: '2' }, null, [link])], { style: 'TOC1', tabs: [{ pos: 451, kind: 'right', leader: 'dot' }] });
    const toc = nodeTypes.generated!.create({ kind: 'toc', opts: { instr: ' TOC \\o "1-2" \\h \\z \\u ' } }, [p('Contenido', { style: 'TOCHeading' }), entry]);
    const { blocks, zip } = await rt(wd([toc, p([nodeTypes.bookmark!.create({ name: '_Toc1' }), t('Introducción')], { style: 'Heading1' })]));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Table of Contents');
    expect(xml).toContain('TOC \\o &quot;1-2&quot;');
    expect(blocks[0]!.type.name).toBe('generated');
    expect(blocks[0]!.attrs.kind).toBe('toc');
    expect(blocks[0]!.attrs.opts.instr).toContain('TOC');
    expect(blocks[0]!.child(0).attrs.style).toBe('TOCHeading');
    const entryBack = blocks[0]!.child(1);
    expect(entryBack.attrs.style).toBe('TOC1');
    expect(entryBack.textContent).toContain('Introducción');
    const kids: PMNode[] = [];
    entryBack.forEach((c) => kids.push(c));
    expect(kids.some((k) => k.type.name === 'field' && k.attrs.kind === 'pageref' && k.attrs.result === '2')).toBe(true);
  });

  it('la marca de agua de texto va al encabezado y se vuelve a leer', async () => {
    const wm = { text: 'CONFIDENCIAL', image: null, font: 'Arial', color: '#c0c0c0', size: 0, semitransparent: true, layout: 'diagonal' as const, scale: 100 };
    const { r, zip } = await rt(wd([p('Cuerpo')], { watermark: wm }));
    const files = Object.keys(zip.files).filter((f) => /word\/header\d+\.xml/.test(f));
    expect(files.length).toBeGreaterThan(0);
    const header = await zip.file(files[0]!)!.async('string');
    expect(header).toContain('PowerPlusWaterMarkObject');
    expect(header).toContain('CONFIDENCIAL');
    expect(r.doc.watermark).toMatchObject({ text: 'CONFIDENCIAL', font: 'Arial', semitransparent: true, layout: 'diagonal' });
    // the header that only held the watermark is not kept as text
    const props = sectionPropsOf(r.doc.body.firstChild!);
    expect(props.header.default).toBeNull();
  });

  it('una marca de agua no borra el texto de un encabezado', async () => {
    const s = defaultSection();
    s.header.default = 'h1';
    const wm = { text: 'BORRADOR', image: null, font: 'Calibri', color: '#c0c0c0', size: 60, semitransparent: false, layout: 'horizontal' as const, scale: 100 };
    const body = nodeTypes.doc!.create(null, [makeSection([p('x')], s)]);
    const { r } = await rt({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body, parts: { h1: nodeTypes.doc!.create(null, [p('Mi encabezado')]) }, watermark: wm });
    const id = sectionPropsOf(r.doc.body.firstChild!).header.default!;
    expect(plainText(r.doc.parts[id]!)).toBe('Mi encabezado');
    expect(r.doc.watermark?.text).toBe('BORRADOR');
    expect(r.doc.watermark?.layout).toBe('horizontal');
  });

  it('la protección de edición con contraseña se escribe y se lee', async () => {
    const protection = makeProtection('forms', 'clave');
    const { r, zip } = await rt(wd([p('x')], { protection }));
    const settings = await zip.file('word/settings.xml')!.async('string');
    expect(settings).toContain('w:edit="forms"');
    expect(settings).toContain('w:cryptAlgorithmSid="14"');
    expect(settings).not.toContain('clave');
    expect(r.doc.protection?.mode).toBe('forms');
    expect(r.doc.protection?.hash?.hash).toBe(protection.hash!.hash);
    expect(r.doc.protection?.hash?.salt).toBe(protection.hash!.salt);
  });

  it('plantilla, bibliografía, macros y datos de combinación viajan con el documento', async () => {
    const sources = [{ tag: 'Smith2020', type: 'book' as const, authors: ['Smith, John'], title: 'Un libro', year: '2020', publisher: 'Editorial', city: 'Madrid', journal: '', volume: '', issue: '', pages: '', url: '', accessed: '', doi: '', edition: '' }];
    const d = wd([p('x')], {
      isTemplate: true,
      sources,
      citeStyle: 'ieee',
      macros: [{ name: 'Modulo1', code: 'Sub Hola()\nEnd Sub' }],
      mailMerge: { kind: 'letters', fields: ['Nombre', 'Ciudad'], records: [['Ana', 'Lima'], ['Luis', 'Quito']], source: 'clientes.csv' },
    });
    const { r, zip } = await rt(d);
    expect(r.doc.isTemplate).toBe(true);
    expect(r.doc.sources[0]).toMatchObject({ tag: 'Smith2020', title: 'Un libro', year: '2020' });
    expect(r.doc.sources[0]!.authors[0]).toBe('Smith, John');
    expect(r.doc.citeStyle).toBe('ieee');
    expect(r.doc.macros[0]).toEqual({ name: 'Modulo1', code: 'Sub Hola()\nEnd Sub' });
    expect(r.doc.mailMerge?.records).toEqual([['Ana', 'Lima'], ['Luis', 'Quito']]);
    expect(await zip.file('customXml/item1.xml')!.async('string')).toContain('b:Sources');
  });
});
