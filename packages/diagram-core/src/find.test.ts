import { describe, expect, it } from 'vitest';
import { addShape, findInDiagram, newDiagram, parseDiagram, serializeDiagram, setShapeImage } from './index';

describe('find in a diagram', () => {
  it('finds the text of shapes, connectors and the text read from pictures, with the page of each', () => {
    let d = newDiagram();
    let p = d.pages[0]!;
    p = addShape(p, 'rect', 100, 100, { text: 'Total del mes' }).page;
    p = addShape(p, 'rect', 300, 100, {}).page;
    const pic = p.shapes[1]!;
    p = setShapeImage(p, [pic.id], { src: 'data:image/png;base64,AAAA', fit: 'contain', ocr: { text: 'Factura 4821\nTotal a pagar', lang: 'spa', at: 1 } });
    d = { ...d, pages: [p] };
    expect(findInDiagram(d, 'zzz')).toEqual([]);
    const hits = findInDiagram(d, 'TOTAL');
    expect(hits.map((h) => h.where)).toEqual(['shape', 'picture']);
    expect(hits[1]).toMatchObject({ id: pic.id, context: 'Total a pagar', pageName: p.name });
    expect(findInDiagram(d, 'total', { matchCase: true })).toHaveLength(0);
    expect(findInDiagram(d, 'tota', { wholeWord: true })).toHaveLength(0);
  });

  it('the text read from a picture is saved with the diagram and comes back', () => {
    let d = newDiagram();
    let p = addShape(d.pages[0]!, 'rect', 100, 100, {}).page;
    const ocr = { text: 'Hola', lang: 'spa', at: 3, size: [10, 10], lines: [[1, 1, 8, 4, [['Hola', 1, 1, 5, 4, 90]]]] };
    p = setShapeImage(p, [p.shapes[0]!.id], { src: 'data:image/png;base64,AAAA', fit: 'contain', ocr });
    d = { ...d, pages: [p] };
    const back = parseDiagram(serializeDiagram(d)).diagram;
    expect(back.pages[0]!.shapes[0]!.image!.ocr).toEqual(ocr);
  });
});
