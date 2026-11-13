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
