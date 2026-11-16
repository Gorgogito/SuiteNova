import JSZip from 'jszip';
import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { scaleGroupContent, DEFAULT_DOC_DEFAULTS, defaultSection, emptyWriterDoc, makeSection, nodeTypes, writeDocx, writeOdt, writeRtf, writerSchema, type WriterDoc } from './index';

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

describe('scaleGroupContent', () => {
  const sh = (x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}) => nodeTypes.shape!.create({ ...base, kind: 'rect', width: w, height: h, x, y, ...extra }, []);
  it('escala las hijas con el grupo, incluidas las de un grupo anidado', () => {
    const inner = nodeTypes.shape_group!.create({ width: 100, height: 50, wrap: 'front', x: 100, y: 50 }, [sh(0, 0, 50, 50), sh(50, 0, 50, 50)]);
    const g = nodeTypes.shape_group!.create({ width: 200, height: 100, wrap: 'front', x: 5, y: 7, rotation: 20 }, [sh(0, 0, 100, 50), inner]);
    const big = scaleGroupContent(g, 400, 300);
    expect(big.attrs).toMatchObject({ width: 400, height: 300, x: 5, y: 7, rotation: 20 });
    expect(big.child(0).attrs).toMatchObject({ x: 0, y: 0, width: 200, height: 150 });
    const ni = big.child(1);
    expect(ni.attrs).toMatchObject({ x: 200, y: 150, width: 200, height: 150 });
    expect(ni.child(0).attrs).toMatchObject({ x: 0, y: 0, width: 100, height: 150 });
    expect(ni.child(1).attrs).toMatchObject({ x: 100, y: 0, width: 100, height: 150 });
    // el original no cambia
    expect(g.child(0).attrs.width).toBe(100);
  });
  it('conserva el texto de un cuadro de texto al escalar', () => {
    const g = nodeTypes.shape_group!.create({ width: 100, height: 40 }, [box('Hola', 0, 0)]);
    expect(scaleGroupContent(g, 200, 80).textContent).toBe('Hola');
  });
});
