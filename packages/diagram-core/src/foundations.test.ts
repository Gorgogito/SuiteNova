import { describe, expect, it } from 'vitest';
import { addConnector, addPage, addShape, connectorRender, newConnector, newDiagram, newPage, printDocument, shapeRender, updatePage, wrapLines } from './index';

const lines = (stencil: string, text: string, w: number, h: number) => shapeRender(addShape(newPage(), stencil, 200, 200, { w, h, text }).shape).texts.flatMap((r) => r.lines.map((l) => l.text));

describe('long words', () => {
  const f = { size: 13, bold: false };
  it('keeps a word whole on its own line while there is room for it', () => {
    expect(wrapLines('Hay existencias hoy', 60, f, true, 110)).toEqual(['Hay', 'existencias', 'hoy']);
    expect(wrapLines('Supercalifragilisticoespialidoso', 60, f, true, 100).length).toBeGreaterThan(1);
  });
  it('does not split a word in a decision when the shape has room', () => {
    expect(lines('decision', 'Hay existencias suficientes', 120, 80)).toContain('existencias');
  });
  it('still splits a word wider than the shape', () => {
    const l = lines('process', 'Electroencefalografistas', 70, 60);
    expect(l.length).toBeGreaterThan(1);
    expect(l.join('')).toBe('Electroencefalografistas');
  });
  it('lays out a connector label on the same lines its box was measured with', () => {
    const c = newConnector({ x: 0, y: 0 }, { x: 400, y: 0 }, { text: 'Internacionalizacióninterdepartamentalgeneralizada de los pedidos' });
    const p = addConnector(newPage(), c);
    const label = connectorRender(c, p).label!;
    expect(label.run.lines[0]!.text).toBe('Internacionalizacióninterdepartamentalgeneralizada');
    expect(label.box.h).toBeCloseTo(label.run.lines.length * c.font.size * 1.25 + 4);
  });
});

describe('new pages', () => {
  it('take the page setup of the page they come after', () => {
    let d = newDiagram();
    const first = d.pages[0]!.id;
    d = updatePage(d, first, (p) => ({ ...p, width: 794, height: 1123, grid: 12, spread: 0 }));
    const r = addPage(d, first);
    expect(r.page).toMatchObject({ width: 794, height: 1123, grid: 12, spread: 0, background: '#ffffff', shapes: [], connectors: [] });
    // without a reference, the last page
    expect(addPage(r.diagram).page).toMatchObject({ width: 794, height: 1123 });
  });
});

describe('printing', () => {
  it('gives every page its own sheet size', () => {
    let d = newDiagram('A & B');
    const a = addPage(d, d.pages[0]!.id);
    d = updatePage(a.diagram, a.page.id, (p) => ({ ...p, width: 794, height: 1123 }));
    d = addPage(d, a.page.id).diagram; // portrait again
    const html = printDocument(d);
    expect(html).toContain('@page s0{size:1123px 794px;margin:0}');
    expect(html).toContain('@page s1{size:794px 1123px;margin:0}');
    expect(html).not.toContain('@page s2');
    expect([...html.matchAll(/<section style="page:(s\d)/g)].map((m) => m[1])).toEqual(['s0', 's1', 's1']);
    expect(html).toContain('<title>A &amp; B</title>');
  });
  it('enlarges the sheet for what sticks out of the page, but not for hidden layers', () => {
    const d = newDiagram();
    const p0 = d.pages[0]!;
    const out = addShape(p0, 'process', 1300, 200).page;
    expect(printDocument({ ...d, pages: [out] })).not.toContain('size:1123px 794px');
    const hidden = { ...out, layers: [{ id: 'l0', name: 'Uno', visible: true, locked: false, printable: true }, { id: 'l1', name: 'Dos', visible: false, locked: false, printable: true }], shapes: out.shapes.map((s) => ({ ...s, layer: 'l1' })) };
    expect(printDocument({ ...d, pages: [hidden] })).toContain('@page s0{size:1123px 794px;margin:0}');
  });
});
