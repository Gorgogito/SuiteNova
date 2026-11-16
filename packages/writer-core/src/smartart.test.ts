import JSZip from 'jszip';
import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { newParts, partsChange, partsIds, partsReflow, partsSetText, partsShapes, partsText } from '@suitenova/smartart-core';
import { DEFAULT_DOC_DEFAULTS, defaultSection, emptyWriterDoc, makeSection, nodeTypes, readDocx, writeDocx, writerSchema, type WriterDoc } from './index';

const t = (text: string) => writerSchema.text(text);
const layout = (n: string) => `urn:suitenova/layout/${n}`;
const art = (text: string, name = 'process', extra: Record<string, unknown> = {}): PMNode =>
  nodeTypes.smartart!.create({ width: 480, height: 280, parts: newParts({ layout: layout(name), text, width: 360, height: 210 }), ...extra });
const doc = (...kids: PMNode[]): WriterDoc => ({
  ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }),
  body: nodeTypes.doc!.create(null, [makeSection([nodeTypes.paragraph!.create(null, [t('Antes '), ...kids, t(' después')])], defaultSection())]),
});
const smarts = (d: PMNode): PMNode[] => {
  const out: PMNode[] = [];
  d.descendants((n) => void (n.type.name === 'smartart' && out.push(n)));
  return out;
};
const roundTrip = async (d: WriterDoc) => readDocx(((await writeDocx(d)) as { data: Uint8Array }).data);

describe('SmartArt en Writer', () => {
  it('es un átomo en línea con el dibujo como imagen', () => {
    const n = art('Uno\nDos\nTres');
    expect(n.isAtom).toBe(true);
    const dom = writerSchema.nodes.smartart!.spec.toDOM!(n) as unknown as [string, Record<string, string>, [string, Record<string, string>]];
    expect(dom[1].class).toBe('nw-smartart');
    const src = dom[2][1].src ?? '';
    expect(src.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(src)).toContain('<path');
  });

  it('se guarda con las cinco partes y enlaza el dibujo desde los datos', async () => {
    const out = (await writeDocx(doc(art('Uno\nDos\nTres')))) as { data: Uint8Array };
    const zip = await JSZip.loadAsync(out.data);
    for (const f of ['data1', 'layout1', 'quickStyle1', 'colors1', 'drawing1']) expect(zip.file(`word/diagrams/${f}.xml`), f).toBeTruthy();
    const types = await zip.file('[Content_Types].xml')!.async('string');
    expect(types).toContain('/word/diagrams/drawing1.xml');
    expect(types).toContain('diagramData+xml');
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    expect(rels).toContain('diagramDrawing');
    const body = await zip.file('word/document.xml')!.async('string');
    expect(body).toMatch(/<dgm:relIds[^>]* r:dm="rId\d+"[^>]* r:cs="rId\d+"/);
    expect(body).not.toContain('AlternateContent');
    const data = await zip.file('word/diagrams/data1.xml')!.async('string');
    const drawingRid = /diagramDrawing" Target="diagrams\/drawing1.xml"/.test(rels) ? /Id="(rId\d+)" Type="[^"]*diagramDrawing"/.exec(rels)![1] : '';
    expect(data).toContain(`relId="${drawingRid}"`);
  });

  it('vuelve a leerse con sus datos, su diseño y su dibujo', async () => {
    const back = await roundTrip(doc(art('Uno\nDos\nTres', 'cycle', { alt: 'Ciclo', wrap: 'topBottom' })));
    const [n] = smarts(back.doc.body ?? (back as unknown as { body: PMNode }).body);
    expect(n).toBeTruthy();
    const parts = n!.attrs.parts;
    expect(partsText(parts)).toBe('Uno\nDos\nTres');
    expect(partsIds(parts)!.layout).toBe(layout('cycle'));
    expect(partsShapes(parts).length).toBeGreaterThan(3);
    expect(n!.attrs).toMatchObject({ width: 480, height: 280, alt: 'Ciclo', wrap: 'topBottom' });
  });

  it('dos SmartArt en el mismo documento no se mezclan', async () => {
    const back = await roundTrip(doc(art('A\nB'), art('X\nY\nZ', 'blocklist')));
    const found = smarts(back.doc.body ?? (back as unknown as { body: PMNode }).body);
    expect(found.map((n) => partsText(n.attrs.parts))).toEqual(['A\nB', 'X\nY\nZ']);
    expect(partsIds(found[1]!.attrs.parts)!.layout).toBe(layout('blocklist'));
  });

  it('un SmartArt editado (texto, diseño, tamaño) sigue guardándose y leyéndose', async () => {
    const n = art('Uno\nDos');
    let p = partsSetText(n.attrs.parts, 'Uno\nDos\nTres\nCuatro', { width: 360, height: 210 })!;
    p = partsChange(p, { layout: layout('hierarchy'), colors: 'urn:suitenova/colors/accent2' }, { width: 360, height: 210 })!;
    p = partsReflow(p, { width: 300, height: 150 })!;
    const back = await roundTrip(doc(nodeTypes.smartart!.create({ width: 400, height: 200, parts: p })));
    const [m] = smarts(back.doc.body ?? (back as unknown as { body: PMNode }).body);
    expect(partsText(m!.attrs.parts)).toBe('Uno\nDos\nTres\nCuatro');
    expect(partsIds(m!.attrs.parts)).toMatchObject({ layout: layout('hierarchy'), colors: 'urn:suitenova/colors/accent2' });
  });
});
