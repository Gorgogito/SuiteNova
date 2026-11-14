import JSZip from 'jszip';
import { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DOC_DEFAULTS, defaultPage, defaultSection, emptyWriterDoc, makeSection, nodeTypes, readDocx, writeDocx, writerSchema, type WriterDoc } from './index';

const mk = (name: string, attrs?: Record<string, unknown>) => writerSchema.marks[name]!.create(attrs);
const p = (text: string, attrs: Record<string, unknown> = {}, marks: ReturnType<typeof mk>[] = []) => nodeTypes.paragraph!.create(attrs, text ? writerSchema.text(text, marks) : undefined);
const wd = (...blocks: PMNode[]): WriterDoc => ({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection(blocks, defaultSection(defaultPage()))]) });
const firstBlocks = (d: WriterDoc): PMNode[] => {
  const out: PMNode[] = [];
  d.body.firstChild!.forEach((b) => out.push(b));
  return out;
};
async function roundTrip(d: WriterDoc) {
  const w = await writeDocx(d);
  return { w, r: await readDocx(w.data), xml: await JSZip.loadAsync(w.data).then((z) => z.file('word/document.xml')!.async('string')) };
}

describe('DOCX: formato de carácter y de párrafo ampliado', () => {
  it('estilos de subrayado con color, doble tachado y espaciado entre caracteres', async () => {
    const styles = ['single', 'double', 'thick', 'dotted', 'dash', 'dotDash', 'wavy'];
    const body = styles.map((s, i) => p(`u${i}`, {}, [mk('underline', { style: s, color: i === 1 ? '#ff0000' : null })]));
    body.push(p('doble', {}, [mk('dstrike'), mk('spacing', { value: 1.5 })]));
    body.push(p('estrecho', {}, [mk('spacing', { value: -0.75 })]));
    const { r, xml } = await roundTrip(wd(...body));
    const blocks = firstBlocks(r.doc);
    styles.forEach((s, i) => {
      const u = blocks[i]!.firstChild!.marks.find((m) => m.type.name === 'underline')!;
      expect(u.attrs.style, s).toBe(s);
      expect(u.attrs.color).toBe(i === 1 ? '#ff0000' : null);
    });
    const dm = blocks[styles.length]!.firstChild!.marks.map((m) => m.type.name).sort();
    expect(dm).toEqual(['dstrike', 'spacing']);
    expect(blocks[styles.length]!.firstChild!.marks.find((m) => m.type.name === 'spacing')!.attrs.value).toBe(1.5);
    expect(blocks[styles.length + 1]!.firstChild!.marks.find((m) => m.type.name === 'spacing')!.attrs.value).toBe(-0.75);
    expect(xml).toContain('<w:u w:val="wave"/>');
    expect(xml).toContain('<w:u w:val="double" w:color="FF0000"/>');
    expect(xml).toContain('<w:dstrike/>');
    expect(xml).toContain('<w:spacing w:val="30"/>');
    expect(xml).toContain('<w:spacing w:val="-15"/>');
    // el orden del esquema: color, spacing, sz ... u
    const rpr = /<w:rPr>(?:(?!<\/w:rPr>).)*<w:dstrike\/>(?:(?!<\/w:rPr>).)*<\/w:rPr>/s.exec(xml)![0];
    expect(rpr.indexOf('<w:dstrike/>')).toBeLessThan(rpr.indexOf('<w:spacing'));
  });

  it('interlineado exacto y como mínimo (en puntos), no dividir el párrafo y nivel de esquema', async () => {
    const body = [
      p('exacto', { lineHeight: 18, lineRule: 'exact' }),
      p('minimo', { lineHeight: 14.5, lineRule: 'atLeast' }),
      p('múltiple', { lineHeight: 1.5 }),
      p('junto', { keepLines: true, keepNext: true, outlineLevel: 2 }),
    ];
    const { r, xml } = await roundTrip(wd(...body));
    const b = firstBlocks(r.doc);
    expect(b[0]!.attrs).toMatchObject({ lineHeight: 18, lineRule: 'exact' });
    expect(b[1]!.attrs).toMatchObject({ lineHeight: 14.5, lineRule: 'atLeast' });
    expect(b[2]!.attrs.lineHeight).toBe(1.5);
    expect(b[2]!.attrs.lineRule).toBeNull();
    expect(b[3]!.attrs).toMatchObject({ keepLines: true, keepNext: true, outlineLevel: 2 });
    expect(xml).toContain('w:line="360" w:lineRule="exact"');
    expect(xml).toContain('w:lineRule="atLeast"');
    expect(xml).toContain('<w:outlineLvl w:val="2"/>');
    // en pPr: keepNext, keepLines, … y outlineLvl al final (después de jc)
    const ppr = /<w:pPr>(?:(?!<\/w:pPr>).)*<w:keepLines\/>(?:(?!<\/w:pPr>).)*<\/w:pPr>/s.exec(xml)![0];
    expect(ppr.indexOf('<w:keepNext/>')).toBeLessThan(ppr.indexOf('<w:keepLines/>'));
  });

  it('un título con nivel de esquema propio de Word no lo duplica como atributo', async () => {
    const { r } = await roundTrip(wd(p('T', { style: 'Heading1' })));
    expect(firstBlocks(r.doc)[0]!.attrs.outlineLevel).toBeNull();
  });
});

describe('DOCX: propiedades de tabla', () => {
  const cell = (text: string, bg?: string) => nodeTypes.table_cell!.create({ colwidth: [120], ...(bg ? { background: bg } : {}) }, p(text));
  const table = (attrs: Record<string, unknown>) => nodeTypes.table!.create(attrs, [nodeTypes.table_row!.create(null, [cell('a', '#336699'), cell('b')]), nodeTypes.table_row!.create(null, [cell('c'), cell('d')])]);

  it('alineación, color y grosor del borde, márgenes de celda y fila de encabezado', async () => {
    const { r, xml } = await roundTrip(wd(table({ borders: true, align: 'center', borderColor: '#cc3300', borderWidth: 2, padding: { x: 8, y: 3 }, headerRow: true })));
    const tbl = firstBlocks(r.doc)[0]!;
    expect(tbl.type.name).toBe('table');
    expect(tbl.attrs).toMatchObject({ borders: true, align: 'center', borderColor: '#cc3300', borderWidth: 2, headerRow: true, padding: { x: 8, y: 3 } });
    expect(tbl.firstChild!.firstChild!.attrs.background).toBe('#336699');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('w:sz="16" w:space="0" w:color="CC3300"');
    expect(xml).toContain('<w:tblHeader/>');
    expect(xml).toContain('<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="160" w:type="dxa"/>');
    // orden del esquema: tblW, jc, tblBorders, tblLayout, tblCellMar
    const pr = /<w:tblPr>.*?<\/w:tblPr>/s.exec(xml)![0];
    const order = ['<w:tblW', '<w:jc', '<w:tblBorders', '<w:tblLayout', '<w:tblCellMar', '<w:tblLook'].map((k) => pr.indexOf(k));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('una tabla sin propiedades especiales no las inventa', async () => {
    const { r, xml } = await roundTrip(wd(table({ borders: true })));
    const tbl = firstBlocks(r.doc)[0]!;
    expect(tbl.attrs).toMatchObject({ align: null, borderColor: null, borderWidth: null, padding: null, headerRow: false });
    expect(xml).not.toContain('<w:tblHeader/>');
    expect(xml).not.toContain('<w:tblCellMar>');
    expect(xml).not.toContain('<w:jc w:val="center"/><w:tblBorders');
  });
});

describe('DOCX: configuración de página ampliada', () => {
  const sec = (over: Record<string, unknown>, ...blocks: PMNode[]) => makeSection(blocks, { ...defaultSection(defaultPage()), ...over });
  const wdSec = (s: PMNode, extra: Partial<WriterDoc> = {}): WriterDoc => ({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [s]), ...extra });

  it('borde de página y números de línea por sección', async () => {
    const borders = { style: 'double', color: '#336699', width: 2.25, offset: 20, from: 'text' };
    const lineNumbers = { countBy: 5, start: 3, restart: 'continuous', distance: 12 };
    const { r, xml } = await roundTrip(wdSec(sec({ borders, lineNumbers }, p('hola'))));
    const props = r.doc.body.firstChild!.attrs;
    expect(props.borders).toEqual(borders);
    expect(props.lineNumbers).toEqual(lineNumbers);
    expect(xml).toContain('<w:pgBorders w:offsetFrom="text"><w:top w:val="double" w:sz="18" w:space="20" w:color="336699"/>');
    expect(xml).toContain('<w:lnNumType w:countBy="5" w:start="2" w:distance="240" w:restart="continuous"/>');
    // orden del esquema: pgMar, pgBorders, lnNumType, pgNumType, cols
    const s = /<w:sectPr>.*?<\/w:sectPr>/s.exec(xml)![0];
    expect(s.indexOf('<w:pgMar')).toBeLessThan(s.indexOf('<w:pgBorders'));
    expect(s.indexOf('<w:pgBorders')).toBeLessThan(s.indexOf('<w:lnNumType'));
  });

  it('sin borde ni números no se escribe nada', async () => {
    const { r, xml } = await roundTrip(wdSec(sec({}, p('hola'))));
    expect(r.doc.body.firstChild!.attrs.borders).toBeNull();
    expect(r.doc.body.firstChild!.attrs.lineNumbers).toBeNull();
    expect(xml).not.toContain('pgBorders');
    expect(xml).not.toContain('lnNumType');
  });

  it('color de página y división automática de palabras', async () => {
    const { r, w } = await roundTrip(wdSec(sec({}, p('hola')), { pageColor: '#fff2cc', autoHyphenate: true }));
    expect(r.doc.pageColor).toBe('#fff2cc');
    expect(r.doc.autoHyphenate).toBe(true);
    const z = await JSZip.loadAsync(w.data);
    expect(await z.file('word/document.xml')!.async('string')).toContain('<w:background w:color="FFF2CC"/>');
    const settings = await z.file('word/settings.xml')!.async('string');
    expect(settings).toContain('<w:displayBackgroundShape/>');
    expect(settings).toContain('<w:autoHyphenation/>');
    const plain = await roundTrip(wdSec(sec({}, p('hola'))));
    expect(plain.r.doc.pageColor).toBeNull();
    expect(plain.r.doc.autoHyphenate).toBe(false);
  });

  it('guion opcional, salto de columna y párrafo sin número de línea', async () => {
    const { r, xml } = await roundTrip(wd(p('ca­sa'), p('segunda', { columnBreakBefore: true, noLineNumbers: true })));
    const b = firstBlocks(r.doc);
    expect(b[0]!.textContent).toBe('ca­sa');
    expect(b[1]!.attrs).toMatchObject({ columnBreakBefore: true, noLineNumbers: true });
    expect(b[1]!.textContent).toBe('segunda');
    expect(xml).toContain('<w:softHyphen/>');
    expect(xml).toContain('<w:br w:type="column"/>');
    expect(xml).toContain('<w:suppressLineNumbers/>');
    expect(b).toHaveLength(2); // el salto de columna no crea un párrafo ni un salto de línea
  });

  it('los párrafos de portada conservan su estilo', async () => {
    const { r } = await roundTrip(wd(p('Título', { style: 'CoverTitle' }), p('Sub', { style: 'CoverSubtitle' }), p('Autor', { style: 'CoverMeta' })));
    expect(firstBlocks(r.doc).map((b) => b.attrs.style)).toEqual(['CoverTitle', 'CoverSubtitle', 'CoverMeta']);
  });
});

describe('propiedades del documento', () => {
  it('asunto, palabras clave, descripción y categoría viajan en docProps/core.xml', async () => {
    const d = { ...wd(p('hola')), title: 'Informe <1>', author: 'Ana', subject: 'Ventas & más', keywords: 'a, b', description: 'Notas "internas"', category: 'Finanzas' };
    const { data } = await writeDocx(d);
    const back = (await readDocx(data)).doc;
    expect(back).toMatchObject({ title: 'Informe <1>', author: 'Ana', subject: 'Ventas & más', keywords: 'a, b', description: 'Notas "internas"', category: 'Finanzas' });
  });
  it('sin propiedades, se leen como vacías', async () => {
    const { data } = await writeDocx(wd(p('hola')));
    const back = (await readDocx(data)).doc;
    expect(back.subject).toBeUndefined();
    expect(back.keywords).toBeUndefined();
  });
});
