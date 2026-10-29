import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { Node as PMNode } from 'prosemirror-model';
import { DEFAULT_DOC_DEFAULTS, defaultPage, defaultSection, docFromText, emptyWriterDoc, ensureSections, makeSection, nodeTypes, plainText, readDocx, sectionPropsOf, wordCount, writeDocx, writerSchema, type WriterDoc } from './index';

const p = (text: string, attrs: Record<string, unknown> = {}, marks: any[] = []) => nodeTypes.paragraph!.create(attrs, text ? writerSchema.text(text, marks) : undefined);
const mk = (name: string, attrs?: Record<string, unknown>) => writerSchema.marks[name]!.create(attrs);
const doc = (...blocks: PMNode[]) => nodeTypes.doc!.create(null, blocks);
const wd = (body: PMNode, extra: Partial<WriterDoc> & { header?: PMNode | null; footer?: PMNode | null; page?: ReturnType<typeof defaultPage> } = {}): WriterDoc => {
  const { header, footer, page, ...rest } = extra;
  const props = defaultSection(page ?? defaultPage());
  const parts: Record<string, PMNode> = {};
  if (header) {
    parts.h1 = header;
    props.header.default = 'h1';
  }
  if (footer) {
    parts.f1 = footer;
    props.footer.default = 'f1';
  }
  const blocks: PMNode[] = [];
  body.forEach((b) => blocks.push(b));
  return { ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection(blocks, props)]), parts, ...rest };
};
/** The blocks of the first section, as a plain document. */
const flat = (d: WriterDoc): PMNode => {
  const blocks: PMNode[] = [];
  d.body.firstChild!.forEach((b) => blocks.push(b));
  return nodeTypes.doc!.create(null, blocks);
};
const partOf = (d: WriterDoc, kind: 'header' | 'footer'): PMNode | null => {
  const id = sectionPropsOf(d.body.firstChild!)[kind].default;
  return id ? (d.parts[id] ?? null) : null;
};
const pageOf = (d: WriterDoc) => sectionPropsOf(d.body.firstChild!).page;
void ensureSections;

async function roundTrip(d: WriterDoc) {
  const w = await writeDocx(d);
  const r = await readDocx(w.data);
  return { w, r };
}

describe('DOCX ida y vuelta', () => {
  it('conserva texto, formato de carácter y de párrafo', async () => {
    const body = doc(
      p('Título principal', { style: 'Heading1' }),
      p('Texto con negrita', { align: 'justify', spaceAfter: 12, lineHeight: 1.5, indentLeft: 36, indentFirst: 18 }, [mk('strong'), mk('color', { value: '#ff0000' }), mk('fontSize', { value: 14 }), mk('fontFamily', { value: 'Arial' })]),
      p('subrayado y tachado', {}, [mk('underline'), mk('strike'), mk('highlight', { value: '#ffff00' }), mk('superscript')]),
    );
    const { r } = await roundTrip(wd(body));
    const b = flat(r.doc);
    expect(plainText(b)).toBe('Título principal\nTexto con negrita\nsubrayado y tachado');
    expect(b.child(0).attrs.style).toBe('Heading1');
    const t = b.child(1);
    expect(t.attrs).toMatchObject({ align: 'justify', spaceAfter: 12, lineHeight: 1.5, indentLeft: 36, indentFirst: 18 });
    const marks = t.firstChild!.marks.map((m) => m.type.name).sort();
    expect(marks).toEqual(['color', 'fontFamily', 'fontSize', 'strong']);
    expect(t.firstChild!.marks.find((m) => m.type.name === 'color')!.attrs.value).toBe('#ff0000');
    expect(t.firstChild!.marks.find((m) => m.type.name === 'fontSize')!.attrs.value).toBe(14);
    expect(b.child(2).firstChild!.marks.map((m) => m.type.name).sort()).toEqual(['highlight', 'strike', 'superscript', 'underline']);
    expect(r.warnings).toEqual([]);
  });

  it('conserva listas anidadas, con viñetas y numeradas', async () => {
    const li = (...c: PMNode[]) => nodeTypes.list_item!.create(null, c);
    const body = doc(
      nodeTypes.ordered_list!.create({ format: 'decimal', start: 3 }, [
        li(p('uno'), nodeTypes.bullet_list!.create(null, [li(p('a')), li(p('b'))])),
        li(p('dos')),
      ]),
      p('intermedio'),
      nodeTypes.ordered_list!.create({ format: 'lowerRoman', start: 1 }, [li(p('i'))]),
    );
    const { r } = await roundTrip(wd(body));
    const b = flat(r.doc);
    expect(b.childCount).toBe(3);
    const ol = b.child(0);
    expect(ol.type.name).toBe('ordered_list');
    expect(ol.attrs).toMatchObject({ format: 'decimal', start: 3 });
    expect(ol.childCount).toBe(2);
    expect(ol.child(0).child(1).type.name).toBe('bullet_list');
    expect(ol.child(0).child(1).childCount).toBe(2);
    expect(b.child(2).attrs.format).toBe('lowerRoman');
  });

  it('conserva tablas con celdas combinadas, anchos y sombreado', async () => {
    const cell = (text: string, attrs: Record<string, unknown> = {}) => nodeTypes.table_cell!.create(attrs, [p(text)]);
    const tbl = nodeTypes.table!.create({ borders: true }, [
      nodeTypes.table_row!.create(null, [cell('A', { colspan: 2, colwidth: [100, 200], background: '#dddddd' }), cell('B', { colwidth: [150] })]),
      nodeTypes.table_row!.create(null, [cell('C', { rowspan: 2, colwidth: [100] }), cell('D', { colwidth: [200] }), cell('E', { colwidth: [150] })]),
      nodeTypes.table_row!.create(null, [cell('F', { colwidth: [200] }), cell('G', { colwidth: [150] })]),
    ]);
    const { r } = await roundTrip(wd(doc(tbl)));
    const t = flat(r.doc).child(0);
    expect(t.type.name).toBe('table');
    expect(t.attrs.borders).toBe(true);
    expect(t.childCount).toBe(3);
    expect(t.child(0).child(0).attrs).toMatchObject({ colspan: 2, background: '#dddddd', colwidth: [100, 200] });
    expect(t.child(1).child(0).attrs.rowspan).toBe(2);
    expect(t.child(2).childCount).toBe(2);
    expect(plainText(t)).toContain('F');
  });

  it('conserva imágenes, enlaces, saltos de página, campos y encabezado/pie', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const body = doc(
      nodeTypes.paragraph!.create(null, [writerSchema.text('ver '), writerSchema.text('Nova', [mk('link', { href: 'https://example.org/x?a=1&b=2' })]), nodeTypes.image!.create({ src: png, alt: 'punto', width: 40, height: 20 })]),
      nodeTypes.page_break!.create(),
      p('segunda página'),
    );
    const footer = doc(nodeTypes.paragraph!.create({ align: 'center' }, [writerSchema.text('Página '), nodeTypes.field!.create({ kind: 'page' }), writerSchema.text(' de '), nodeTypes.field!.create({ kind: 'pages' })]));
    const header = doc(p('Cabecera'));
    const { r } = await roundTrip(wd(body, { header, footer, title: 'Mi título' }));
    const b = flat(r.doc);
    expect(b.childCount).toBe(3);
    expect(b.child(1).type.name).toBe('page_break');
    const link = b.child(0).child(1);
    expect(link.marks[0]!.attrs.href).toBe('https://example.org/x?a=1&b=2');
    const img = b.child(0).child(2);
    expect(img.type.name).toBe('image');
    expect(img.attrs).toMatchObject({ alt: 'punto', width: 40, height: 20 });
    expect(img.attrs.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(plainText(partOf(r.doc, 'header')!)).toBe('Cabecera');
    const f = partOf(r.doc, 'footer')!.child(0);
    expect(f.child(1).attrs.kind).toBe('page');
    expect(f.child(3).attrs.kind).toBe('pages');
    expect(f.attrs.align).toBe('center');
    expect(r.doc.title).toBe('Mi título');
  });

  it('conserva la configuración de página', async () => {
    const page = { ...defaultPage(), width: 792, height: 612, marginLeft: 36, marginTop: 54 };
    const { r } = await roundTrip(wd(doc(p('x')), { page }));
    expect(pageOf(r.doc)).toMatchObject({ width: 792, height: 612, marginLeft: 36, marginTop: 54 });
  });

  it('el paquete escrito es un ZIP con las partes esperadas', async () => {
    const w = await writeDocx(wd(doc(p('hola'))));
    const zip = await JSZip.loadAsync(w.data);
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml']) expect(zip.file(f), f).toBeTruthy();
    expect(await zip.file('word/document.xml')!.async('string')).toContain('<w:t xml:space="preserve">hola</w:t>');
  });

  it('escapa caracteres especiales y tabulaciones', async () => {
    const { r } = await roundTrip(wd(doc(p('a & b < c > "d"\tfin'))));
    expect(plainText(flat(r.doc))).toBe('a & b < c > "d"\tfin');
  });
});

describe('lectura de un DOCX al estilo de Word', () => {
  async function build(documentXml: string, extra: Record<string, string> = {}, styles = '') {
    const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const zip = new JSZip();
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${ns}><w:body>${documentXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="708" w:footer="708"/></w:sectPr></w:body></w:document>`);
    zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles ${ns}>${styles}</w:styles>`);
    for (const [k, v] of Object.entries(extra)) zip.file(k, v);
    return readDocx(await zip.generateAsync({ type: 'uint8array' }));
  }
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  it('aplana estilos propios y reconoce los integrados por nombre (estilos con id traducido)', async () => {
    const styles = `
      <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Destacado"><w:name w:val="Destacado"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240"/></w:pPr><w:rPr><w:i/><w:color w:val="FF0000"/></w:rPr></w:style>`;
    const r = await build(`<w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>Cap</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Destacado"/></w:pPr><w:r><w:t>Hola</w:t></w:r></w:p>`, {}, styles);
    const b = flat(r.doc);
    expect(b.child(0).attrs.style).toBe('Heading1');
    expect(b.child(1).attrs).toMatchObject({ style: null, align: 'center', spaceBefore: 12 });
    expect(b.child(1).firstChild!.marks.map((m) => m.type.name).sort()).toEqual(['color', 'em']);
    expect(r.doc.defaults).toMatchObject({ fontFamily: 'Arial', fontSize: 11, spaceAfter: 8 });
    expect(r.doc.defaults.lineHeight).toBeCloseTo(1.08, 2);
    expect(pageOf(r.doc).width).toBeCloseTo(595.3, 1);
    expect(pageOf(r.doc).marginLeft).toBeCloseTo(85.05, 1);
  });

  it('resuelve la fuente del tema', async () => {
    const theme = '<a:theme xmlns:a="x"><a:fontScheme><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme></a:theme>';
    const styles = '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>';
    const r = await build('<w:p><w:r><w:t>x</w:t></w:r></w:p>', { 'word/theme/theme1.xml': theme }, styles);
    expect(r.doc.defaults.fontFamily).toBe('Verdana');
    expect(r.doc.defaults.fontSize).toBe(10);
  });

  it('lee campos complejos (PAGE, HYPERLINK), saltos y cambios controlados', async () => {
    const body = `
      <w:p><w:r><w:t xml:space="preserve">Página </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
      <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://nova.example/" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>enlace</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> fuera</w:t></w:r></w:p>
      <w:p><w:r><w:t>antes</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>después</w:t></w:r></w:p>
      <w:p><w:del w:id="7" w:author="Ana" w:date="2026-01-02T10:00:00Z"><w:r><w:delText>borrado</w:delText></w:r></w:del><w:ins w:id="8" w:author="Ana" w:date="2026-01-02T10:00:00Z"><w:r><w:t>insertado</w:t></w:r></w:ins></w:p>`;
    const r = await build(body);
    const b = flat(r.doc);
    expect(b.child(0).child(1).type.name).toBe('field');
    expect(plainText(b.child(0))).toBe('Página #');
    const link = b.child(1).child(0);
    expect(link.text).toBe('enlace');
    expect(link.marks[0]!.attrs.href).toBe('https://nova.example/');
    expect(b.child(1).child(1).marks.length).toBe(0);
    expect(b.child(2).textContent).toBe('antes');
    expect(b.child(3).type.name).toBe('page_break');
    expect(b.child(4).textContent).toBe('después');
    expect(b.child(5).textContent).toBe('borradoinsertado');
    expect(b.child(5).child(0).marks.map((m) => m.type.name)).toEqual(['del']);
    expect(b.child(5).child(1).marks.map((m) => m.type.name)).toEqual(['ins']);
    expect(b.child(5).child(1).marks[0]!.attrs.author).toBe('Ana');
  });

  it('lee numeración de Word con niveles y continuación', async () => {
    const numbering = `<w:numbering ${ns}>
      <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>
      <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
    const item = (n: number, l: number, t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${l}"/><w:numId w:val="${n}"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    const body = item(1, 0, 'a') + item(1, 1, 'a1') + item(1, 1, 'a2') + item(1, 0, 'b') + '<w:p><w:r><w:t>corte</w:t></w:r></w:p>' + item(1, 0, 'c') + item(2, 0, 'punto');
    const r = await build(body, { 'word/numbering.xml': numbering });
    const b = flat(r.doc);
    expect(b.child(0).type.name).toBe('ordered_list');
    expect(b.child(0).childCount).toBe(2);
    expect(b.child(0).child(0).child(1).attrs.format).toBe('lowerLetter');
    expect(b.child(0).child(0).child(1).childCount).toBe(2);
    expect(b.child(1).textContent).toBe('corte');
    expect(b.child(2).attrs.start).toBe(3); // Word continues the numbering after the interruption
    expect(b.child(3).type.name).toBe('bullet_list');
  });

  it('rechaza archivos que no son documentos de Word', async () => {
    const zip = new JSZip();
    zip.file('hola.txt', 'x');
    await expect(readDocx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/word\/document\.xml/);
  });
});

describe('utilidades', () => {
  it('cuenta palabras y extrae texto', () => {
    const d = docFromText('Hola mundo\n\nterce ra-línea');
    expect(wordCount(d)).toBe(4);
    expect(plainText(d)).toBe('Hola mundo\n\nterce ra-línea');
  });
});

describe('DOCX: secciones, columnas y encabezados por sección', () => {
  it('conserva varias secciones con tamaño, columnas, tipo de salto, numeración y encabezados propios', async () => {
    const s1 = defaultSection();
    s1.header.default = 'h1';
    s1.titlePg = true;
    s1.header.first = 'h0';
    const s2 = { ...defaultSection({ ...defaultPage(), width: 841.9, height: 595.3 }), start: 'continuous' as const, cols: { count: 2, space: 28.35, sep: true, widths: null }, pgNumStart: 1, pgNumFmt: 'lowerRoman' as const };
    s2.footer.default = 'f2';
    const body = nodeTypes.doc!.create(null, [makeSection([p('uno')], s1), makeSection([p('dos'), p('tres')], s2)]);
    const parts = { h1: doc(p('Cabecera general')), h0: doc(p('Solo primera')), f2: doc(p('Pie de la dos')) };
    const { r } = await roundTrip({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body, parts, evenAndOdd: true });
    const secs = r.doc.body;
    expect(secs.childCount).toBe(2);
    const a = sectionPropsOf(secs.child(0));
    const b = sectionPropsOf(secs.child(1));
    expect(a.titlePg).toBe(true);
    expect(plainText(r.doc.parts[a.header.default!]!)).toBe('Cabecera general');
    expect(plainText(r.doc.parts[a.header.first!]!)).toBe('Solo primera');
    expect(b.start).toBe('continuous');
    expect(b.page.width).toBeCloseTo(841.9, 0);
    expect(b.cols).toMatchObject({ count: 2, sep: true });
    expect(b.cols.space).toBeCloseTo(28.35, 1);
    expect(b.pgNumStart).toBe(1);
    expect(b.pgNumFmt).toBe('lowerRoman');
    expect(b.header.default).toBeNull(); // linked to the previous section
    expect(plainText(r.doc.parts[b.footer.default!]!)).toBe('Pie de la dos');
    expect(r.doc.evenAndOdd).toBe(true);
    expect(secs.child(1).textContent).toBe('dostres');
  });

  it('columnas desiguales', async () => {
    const s = { ...defaultSection(), cols: { count: 2, space: 20, sep: false, widths: [100, 300] as number[] | null } };
    const { r } = await roundTrip({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection([p('x')], s)]) });
    const c = sectionPropsOf(r.doc.body.child(0)).cols;
    expect(c.count).toBe(2);
    expect(c.widths!.map(Math.round)).toEqual([100, 300]);
  });
});
