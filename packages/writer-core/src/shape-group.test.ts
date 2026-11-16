import JSZip from 'jszip';
import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DOC_DEFAULTS, defaultSection, emptyWriterDoc, makeSection, nodeTypes, writeDocx, writeOdt, writeRtf, writerSchema, type WriterDoc } from './index';

const t = (text: string) => writerSchema.text(text);
const p = (text: string) => nodeTypes.paragraph!.create(null, [t(text)]);
const base = { fill: '#ffffff', stroke: '#000000', strokeWidth: 1, wrap: 'front' };
const box = (text: string, x: number, y: number) => nodeTypes.shape!.create({ ...base, kind: 'textbox', width: 100, height: 40, x, y }, [p(text)]);
const doc = (group: PMNode): WriterDoc => ({
  ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }),
  body: nodeTypes.doc!.create(null, [makeSection([nodeTypes.paragraph!.create(null, [t('Antes '), group, t(' después')])], defaultSection())]),
});

describe('nodo shape_group', () => {
  it('exige al menos una forma y solo admite formas o grupos dentro', () => {
    const g = nodeTypes.shape_group!;
    expect(() => g.createChecked({ width: 10, height: 10 }, [])).toThrow();
    expect(() => g.createChecked({ width: 10, height: 10 }, [p('texto')])).toThrow();
    expect(() => g.createChecked({ width: 10, height: 10 }, [box('a', 0, 0)])).not.toThrow();
    const nested = g.createChecked({ width: 10, height: 10 }, [g.createChecked({ width: 5, height: 5 }, [box('a', 0, 0)]), box('b', 0, 0)]);
    expect(nested.childCount).toBe(2);
  });

  it('un grupo cabe en un párrafo y no se confunde con una forma al volver del DOM', () => {
    const group = nodeTypes.shape_group!.create({ width: 100, height: 40 }, [box('a', 0, 0)]);
    const dom = writerSchema.nodes.shape_group!.spec.toDOM!(group) as unknown as [string, Record<string, string>, number];
    expect(dom[1].class).toContain('nw-shape-group');
    expect(dom[1].style).toContain('position:absolute');
    expect(dom[1].style).toContain('left:0px');
    const shapeDom = writerSchema.nodes.shape!.spec.toDOM!(box('a', 0, 0)) as unknown as [string, Record<string, string>, number];
    expect(shapeDom[1].class).not.toContain('nw-shape-group');
  });

  it('el texto de las formas de un grupo también sale en .odt y .rtf', async () => {
    const group = nodeTypes.shape_group!.create({ width: 220, height: 100 }, [box('Primero', 0, 0), box('Segundo', 110, 50)]);
    const odt = await writeOdt(doc(group));
    const content = await JSZip.loadAsync(odt.data).then((z) => z.file('content.xml')!.async('string'));
    expect(content).toContain('Primero');
    expect(content).toContain('Segundo');
    const rtf = new TextDecoder().decode(writeRtf(doc(group)).data);
    expect(rtf).toContain('Primero');
    expect(rtf).toContain('Segundo');
  });

  it('el .docx no avisa de elementos no exportables al escribir un grupo', async () => {
    const group = nodeTypes.shape_group!.create({ width: 100, height: 40 }, [box('a', 0, 0)]);
    const w = await writeDocx(doc(group));
    expect(w.warnings.join(' ')).not.toMatch(/no exportable/);
  });
});
