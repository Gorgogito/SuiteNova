import JSZip from 'jszip';
import { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DOC_DEFAULTS, defaultSection, emptyWriterDoc, makeSection, nodeTypes, readDocx, readOdt, writeDocx, writeOdt, writerSchema, type WriterDoc } from './index';

const p = (content: PMNode[]) => nodeTypes.paragraph!.create(null, content);
const wd = (blocks: PMNode[]): WriterDoc => ({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection(blocks, defaultSection())]) });
const maths = (d: PMNode) => {
  const out: PMNode[] = [];
  d.descendants((n) => void (n.type.name === 'math' && out.push(n)));
  return out;
};

// una ecuación como la guarda Word: con fuente, tamaño y negrita propios
const WORD_OMML = '<m:oMath><m:f><m:fPr><m:ctrlPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/></w:rPr></m:ctrlPr></m:fPr><m:num><m:r><m:rPr><m:sty m:val="b"/></m:rPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="44"/></w:rPr><m:t>a</m:t></m:r></m:num><m:den><m:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';

async function docxWith(omml: string): Promise<Uint8Array> {
  const out = await writeDocx(wd([p([nodeTypes.math!.create({ tex: 'x' })])]));
  const zip = await JSZip.loadAsync(out.data);
  const xml = await zip.file('word/document.xml')!.async('string');
  zip.file('word/document.xml', xml.replace(/<m:oMath>[\s\S]*?<\/m:oMath>/, omml));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('ecuaciones en .docx: fidelidad', () => {
  it('lo que Word guarda (fuente, tamaño, negrita) se conserva si la ecuación no se toca', async () => {
    const read = await readDocx(await docxWith(WORD_OMML));
    const [m] = maths(read.doc.body);
    expect(m!.attrs.tex.replace(/\s+/g, '')).toBe(String.raw`\frac{\mathbf{a}}{b}`);
    expect(m!.attrs.omml).toContain('w:sz w:val="44"');
    const again = await JSZip.loadAsync((await writeDocx(read.doc)).data);
    const xml = await again.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:sz w:val="44"/>');
    expect(xml).toContain('<m:sty m:val="b"/>');
    expect(xml).toContain('w:ascii="Arial"');
  });

  it('si se cambia el código se genera de nuevo (y no arrastra el formato anterior)', async () => {
    const read = await readDocx(await docxWith(WORD_OMML));
    const [m] = maths(read.doc.body);
    const edited = nodeTypes.math!.create({ ...m!.attrs, tex: String.raw`\frac{a}{c}` });
    const doc = { ...read.doc, body: nodeTypes.doc!.create(null, [makeSection([p([edited])], defaultSection())]) };
    const xml = await (await JSZip.loadAsync((await writeDocx(doc)).data)).file('word/document.xml')!.async('string');
    expect(xml).not.toContain('w:sz w:val="44"');
    expect(xml).toContain('<m:t xml:space="preserve">c</m:t>');
  });

  it('el atributo sobrevive a copiar y pegar dentro de Writer (toDOM y parseDOM)', () => {
    const n = nodeTypes.math!.create({ tex: 'x', omml: WORD_OMML, ommlTex: 'x' });
    const dom = writerSchema.nodes.math!.spec.toDOM!(n) as unknown as [string, Record<string, string>, string];
    expect(dom[1]['data-omml']).toBeTruthy();
    const el = { dataset: { tex: 'x', display: '0', omml: dom[1]['data-omml'], ommlTex: 'x' } } as unknown as HTMLElement;
    const rule = writerSchema.nodes.math!.spec.parseDOM![0]! as unknown as { getAttrs: (d: HTMLElement) => Record<string, unknown> };
    expect(rule.getAttrs(el).omml).toBe(WORD_OMML);
  });
});

describe('ecuaciones en .odt', () => {
  it('se guardan como objeto de fórmula (MathML con el código TeX) y se vuelven a leer', async () => {
    const out = await writeOdt(wd([p([writerSchema.text('Sea '), nodeTypes.math!.create({ tex: String.raw`\frac{a+b}{c}=\sqrt{x^2}` })])]));
    const zip = await JSZip.loadAsync(out.data);
    expect(zip.file('Object 1/content.xml')).toBeTruthy();
    const ml = await zip.file('Object 1/content.xml')!.async('string');
    expect(ml).toContain('<mfrac>');
    expect(ml).toContain('application/x-tex');
    expect(await zip.file('META-INF/manifest.xml')!.async('string')).toContain('application/vnd.oasis.opendocument.formula');
    expect(await zip.file('content.xml')!.async('string')).toContain('<draw:object xlink:href="./Object 1"');
    const back = maths((await readOdt(out.data)).doc.body);
    expect(back).toHaveLength(1);
    expect(back[0]!.attrs.tex.replace(/\s+/g, '')).toBe(String.raw`\frac{a+b}{c}=\sqrt{x^2}`);
  });

  it('una fórmula de otro programa (MathML sin anotación) se importa como ecuación', async () => {
    const out = await writeOdt(wd([p([nodeTypes.math!.create({ tex: 'x' })])]));
    const zip = await JSZip.loadAsync(out.data);
    zip.file('Object 1/content.xml', '<?xml version="1.0"?><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>y</mi><mo>=</mo><msup><mi>x</mi><mn>2</mn></msup></mrow></semantics></math>');
    const back = maths((await readOdt(await zip.generateAsync({ type: 'uint8array' }))).doc.body);
    expect(back[0]!.attrs.tex.replace(/\s+/g, '')).toBe('y=x^2');
  });
});
