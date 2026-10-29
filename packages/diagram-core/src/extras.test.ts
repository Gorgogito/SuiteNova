import { describe, expect, it } from 'vitest';
import { portsOf } from './geometry';
import { parseDiagram, serializeDiagram } from './io';
import { newDiagram, type Diagram } from './model';
import { addDataField, addShape, dataToCsv, flipShapes, setShapeData, setShapeImage, setShapeLink, updatePage } from './ops';
import { resolveText, shapeRender } from './render';
import { pageToSvg } from './svg';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function withShape(stencil = 'rect') {
  const d = newDiagram();
  const r = addShape(d.pages[0]!, stencil, 200, 150);
  return { d, page: r.page, shape: r.shape };
}

describe('flip, link, data and pictures', () => {
  it('mirrors a shape and its connection points, and not its text', () => {
    const { page, shape } = withShape('rightArrow');
    const before = portsOf(shape);
    const f = flipShapes(page, [shape.id], 'h');
    const s = f.shapes[0]!;
    expect(s.flipH).toBe(true);
    const after = portsOf(s);
    // the east point is now on the west side
    const e = before.find((p) => p.dir.x === 1)!;
    const w = after.find((p) => p.index === e.index)!;
    expect(w.dir.x).toBe(-1);
    expect(w.point.x).toBeCloseTo(s.x + (s.x + s.w - e.point.x), 3);
    const r = shapeRender({ ...s, text: 'Hola' });
    expect(r.flip).toContain('scale(-1 1)');
    expect(r.transform).not.toContain('scale');
    // flipping twice restores it
    const back = flipShapes(f, [shape.id], 'h').shapes[0]!;
    expect(back.flipH).toBe(false);
  });

  it('a block of shapes is reflected as a whole', () => {
    const blank = newDiagram().pages[0]!;
    const a = addShape(blank, 'rect', 100, 100);
    const b = addShape(a.page, 'rect', 400, 100);
    const page = b.page;
    const f = flipShapes(page, [a.shape.id, b.shape.id], 'h');
    const [fa, fb] = [f.shapes.find((s) => s.id === a.shape.id)!, f.shapes.find((s) => s.id === b.shape.id)!];
    // the left one moves to the right of the other
    expect(fa.x).toBeGreaterThan(fb.x);
  });

  it('shape data goes into the text with {{name}}, case-insensitively, and unknown names stay', () => {
    expect(resolveText('Hola {{Nombre}} {{nombre}} {{x}}', [{ name: 'nombre', value: 'Ana' }])).toBe('Hola Ana Ana {{x}}');
    const { page, shape } = withShape();
    const p = setShapeData({ ...page, shapes: page.shapes.map((s) => ({ ...s, text: 'Cliente: {{Nombre}}' })) }, shape.id, [{ name: 'Nombre', value: 'Luz' }]);
    expect(shapeRender(p.shapes[0]!).texts[0]!.lines.map((l) => l.text).join(' ')).toContain('Cliente: Luz');
    const shown = shapeRender({ ...p.shapes[0]!, showData: true });
    expect(shown.caption!.lines[0]!.text).toBe('Nombre: Luz');
  });

  it('a data field can be added to several shapes and the data is written as CSV', () => {
    let { page, shape } = withShape();
    const b = addShape(page, 'ellipse', 400, 200);
    page = b.page;
    page = addDataField(page, [shape.id, b.shape.id], { name: 'Coste', value: '10' });
    page = setShapeData(page, b.shape.id, [...page.shapes[1]!.data!, { name: 'Dueño', value: 'A, B' }]);
    const csv = dataToCsv(page);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('id,texto,forma,Coste,Dueño');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('"A, B"');
  });

  it('keeps picture, link and data through save and load, and refuses unsafe values', () => {
    let { d, page, shape } = withShape('image');
    page = setShapeImage(page, [shape.id], { src: PNG, fit: 'cover' });
    page = setShapeLink(page, [shape.id], { url: 'https://example.org/x', tip: 'Ir' });
    page = setShapeData(page, shape.id, [{ name: 'Clave', value: 'v', type: 'number' }]);
    d = updatePage(d, d.pages[0]!.id, () => page);
    const back = parseDiagram(serializeDiagram(d)).diagram.pages[0]!.shapes[0]!;
    expect(back.image).toEqual({ src: PNG, fit: 'cover' });
    expect(back.link).toEqual({ url: 'https://example.org/x', tip: 'Ir' });
    expect(back.data).toEqual([{ name: 'Clave', value: 'v', type: 'number' }]);

    const evil: Diagram = JSON.parse(serializeDiagram(d));
    const sh = evil.pages[0]!.shapes[0] as unknown as Record<string, unknown>;
    sh.link = { url: 'javascript:alert(1)' };
    sh.image = { src: 'https://example.org/track.png', fit: 'contain' };
    const clean = parseDiagram(JSON.stringify({ format: 'novadiagram', ...evil })).diagram.pages[0]!.shapes[0]!;
    expect(clean.link).toBeUndefined();
    expect(clean.image).toBeUndefined();
  });

  it('the SVG has the picture, the link and the mirroring', () => {
    let { page, shape } = withShape('image');
    page = setShapeImage(page, [shape.id], { src: PNG, fit: 'contain' });
    page = setShapeLink(page, [shape.id], { url: 'https://example.org/' });
    page = flipShapes(page, [shape.id], 'v');
    const svg = pageToSvg(page);
    expect(svg).toContain('<image href="data:image/png');
    expect(svg).toContain('<a href="https://example.org/"');
    expect(svg).toContain('scale(1 -1)');
    expect(svg).toContain('xmlns:xlink');
  });
});
