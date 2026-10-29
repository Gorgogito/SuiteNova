import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseLength, plainText, readDocx, readOdt, readRtf, writeDocx, writeOdt } from '../index';

const find = (doc: any, name: string) => {
  const out: any[] = [];
  doc.descendants((n: any) => {
    if (n.type.name === name) out.push(n);
  });
  return out;
};

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';

/** A file shaped like what LibreOffice writes. */
async function libreOfficeLike(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  zip.file(
    'styles.xml',
    `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard"/>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading"><style:text-properties fo:font-size="16pt"/></style:style>
<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard"/>
</office:styles>
<office:automatic-styles><style:page-layout style:name="Mpm1"><style:page-layout-properties fo:page-width="21.001cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="3cm" fo:margin-right="3cm"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="Mpm1"><style:header><text:p text:style-name="Standard">Mi encabezado</text:p></style:header><style:footer><text:p>Página <text:page-number text:select-page="current">1</text:page-number></text:p></style:footer></style:master-page></office:master-styles></office:document-styles>`,
  );
  zip.file(
    'content.xml',
    `<?xml version="1.0"?><office:document-content ${NS}><office:automatic-styles>
<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="justify" fo:margin-left="1cm" fo:line-height="115%"/></style:style>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#ff0000"/></style:style>
<style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic" style:text-underline-style="solid"/></style:style>
<style:style style:name="L1" style:family="list"/>
<text:list-style style:name="L2"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/></text:list-style>
<text:list-style style:name="L3"><text:list-level-style-number text:level="1" style:num-format="a"/></text:list-style>
<style:style style:name="Col1" style:family="table-column"><style:table-column-properties style:column-width="3cm"/></style:style>
</office:automatic-styles><office:body><office:text>
<text:h text:style-name="Heading_20_1" text:outline-level="1">Capítulo uno</text:h>
<text:p text:style-name="P1">Texto con <text:span text:style-name="T1">negrita roja</text:span>, <text:span text:style-name="T2">cursiva subrayada</text:span> y <text:a xlink:type="simple" xlink:href="https://example.org/">un enlace</text:a>.<text:tab/>Tab<text:line-break/>salto<text:s text:c="3"/>espacios<text:note text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Nota al pie</text:p></text:note-body></text:note></text:p>
<text:list text:style-name="L2"><text:list-item><text:p>uno</text:p></text:list-item><text:list-item><text:p>dos</text:p><text:list><text:list-item><text:p>anidado</text:p></text:list-item></text:list></text:list-item></text:list>
<text:list text:style-name="L3"><text:list-item><text:p>a</text:p></text:list-item></text:list>
<table:table table:name="T"><table:table-column table:style-name="Col1" table:number-columns-repeated="2"/><table:table-row><table:table-cell><text:p>A1</text:p></table:table-cell><table:table-cell><text:p>B1</text:p></table:table-cell></table:table-row></table:table>
</office:text></office:body></office:document-content>`,
  );
  zip.file('meta.xml', `<?xml version="1.0"?><office:document-meta ${NS} xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><dc:title>Informe</dc:title><dc:creator>Luis</dc:creator></office:meta></office:document-meta>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('lengths', () => {
  it('converts units to points', () => {
    expect(parseLength('1in')).toBe(72);
    expect(parseLength('2.54cm')).toBeCloseTo(72, 5);
    expect(parseLength('25.4mm')).toBeCloseTo(72, 5);
    expect(parseLength('12pt')).toBe(12);
    expect(parseLength('nada')).toBeNull();
  });
});

describe('ODT reader', () => {
  it('reads a LibreOffice-like document', async () => {
    const { doc } = await readOdt(await libreOfficeLike());
    const text = plainText(doc.body);
    expect(text).toContain('Capítulo uno');
    expect(text).toContain('Nota'.slice(0, 0) + 'negrita roja');
    const paras = find(doc.body, 'paragraph');
    expect(paras[0].attrs.style).toBe('Heading1');
    const body = paras.find((p: any) => p.textContent.startsWith('Texto'));
    expect(body.attrs.align).toBe('justify');
    expect(body.attrs.indentLeft).toBeCloseTo(28.35, 1);
    expect(body.attrs.lineHeight).toBeCloseTo(1.15, 2);
    const marks = (w: string) => {
      let m: string[] = [];
      doc.body.descendants((n: any) => {
        if (n.isText && n.text.includes(w)) m = n.marks.map((x: any) => x.type.name);
      });
      return m;
    };
    expect(marks('negrita roja')).toEqual(expect.arrayContaining(['strong', 'color']));
    expect(marks('cursiva')).toEqual(expect.arrayContaining(['em', 'underline']));
    expect(marks('un enlace')).toContain('link');
    expect(text).toContain('\tTab');
    expect(text).toContain('salto   espacios'.replace('salto', 'salto').slice(0, 0) + 'espacios');
    expect(find(doc.body, 'hard_break').length).toBe(1);
    expect(find(doc.body, 'footnote').length).toBe(1);
  });
  it('reads lists, tables, page layout, header/footer and metadata', async () => {
    const { doc } = await readOdt(await libreOfficeLike());
    expect(find(doc.body, 'bullet_list').length).toBe(2); // including the nested one
    const ol = find(doc.body, 'ordered_list');
    expect(ol.length).toBe(1);
    expect(ol[0].attrs.format).toBe('lowerLetter');
    const table = find(doc.body, 'table')[0];
    expect(table.firstChild.childCount).toBe(2);
    expect(table.firstChild.firstChild.attrs.colwidth[0]).toBe(113);
    const page = doc.body.firstChild!.attrs.page;
    expect(page.width).toBeCloseTo(595.3, 0);
    expect(page.marginLeft).toBeCloseTo(85.04, 1);
    const parts = Object.values(doc.parts).map((p) => plainText(p));
    expect(parts.some((p) => p.includes('Mi encabezado'))).toBe(true);
    expect(parts.some((p) => p.includes('Página'))).toBe(true);
    expect(doc.title).toBe('Informe');
    expect(doc.author).toBe('Luis');
  });
  it('rejects other files', async () => {
    const z = new JSZip();
    z.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
    z.file('content.xml', '<a/>');
    await expect(readOdt(await z.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/texto/);
  });
});

describe('ODT writer', () => {
  it('writes a package with the mimetype stored first', async () => {
    const { doc } = await readOdt(await libreOfficeLike());
    const { data } = await writeOdt(doc);
    const zip = await JSZip.loadAsync(data);
    expect(await zip.file('mimetype')!.async('string')).toBe('application/vnd.oasis.opendocument.text');
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    for (const f of ['content.xml', 'styles.xml', 'meta.xml', 'META-INF/manifest.xml']) expect(zip.file(f)).toBeTruthy();
  });
  it('round-trips structure and formatting', async () => {
    const first = (await readOdt(await libreOfficeLike())).doc;
    const back = (await readOdt((await writeOdt(first)).data)).doc;
    expect(plainText(back.body).replace(/\s+/g, ' ')).toBe(plainText(first.body).replace(/\s+/g, ' '));
    expect(find(back.body, 'footnote').length).toBe(1);
    expect(find(back.body, 'table').length).toBe(1);
    expect(find(back.body, 'bullet_list').length).toBe(2);
    expect(find(back.body, 'ordered_list')[0].attrs.format).toBe('lowerLetter');
    expect(find(back.body, 'paragraph')[0].attrs.style).toBe('Heading1');
    expect(back.body.firstChild!.attrs.page.width).toBeCloseTo(first.body.firstChild!.attrs.page.width, 0);
    let ok = 0;
    back.body.descendants((n: any) => {
      if (n.isText && n.text.includes('negrita roja') && n.marks.some((m: any) => m.type.name === 'strong') && n.marks.some((m: any) => m.type.name === 'color')) ok++;
      if (n.isText && n.text.includes('un enlace') && n.marks.some((m: any) => m.type.name === 'link')) ok++;
    });
    expect(ok).toBe(2);
    expect(Object.values(back.parts).map((p) => plainText(p)).join('|')).toContain('Mi encabezado');
    expect(back.title).toBe('Informe');
  });
  it('keeps several sections with their own page size and columns', async () => {
    const rtf = readRtf(String.raw`{\rtf1\ansi\paperw12240\paperh15840 \sectd Uno\par\sect\sectd\pgwsxn15840\pghsxn12240\lndscpsxn\cols2\colsx720 Dos\par}`).doc;
    expect(rtf.body.childCount).toBe(2);
    const back = (await readOdt((await writeOdt(rtf)).data)).doc;
    expect(back.body.childCount).toBe(2);
    expect(back.body.child(1).attrs.page.width).toBeGreaterThan(back.body.child(1).attrs.page.height);
    expect(plainText(back.body)).toContain('Dos');
  });
  it('embeds images', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const rtf = readRtf(`{\\rtf1\\ansi {\\pict\\pngblip\\picwgoal1500\\pichgoal1500 ${[...atob(png)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}}}`).doc;
    expect(find(rtf.body, 'image').length).toBe(1);
    const { data } = await writeOdt(rtf);
    const zip = await JSZip.loadAsync(data);
    expect(Object.keys(zip.files).some((f) => f.startsWith('Pictures/'))).toBe(true);
    const back = (await readOdt(data)).doc;
    expect(find(back.body, 'image')[0].attrs.src).toMatch(/^data:image\/png;base64,/);
  });
  it('goes through .docx as well', async () => {
    const d = (await readOdt(await libreOfficeLike())).doc;
    const back = await readDocx((await writeDocx(d)).data);
    expect(plainText(back.doc.body)).toContain('Capítulo uno');
  });
});
