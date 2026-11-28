import { describe, expect, it } from 'vitest';
import {
  AUTO_GAP, addConnector, addGuide, addShape, applyLook, autoConnect, changeStencil, cloneItems, lookOf, moveGuide, neighbourOn, newConnector, newDiagram, newPage, nextStencil,
  parseDiagram, quickShapes, readClip, removeGuide, serializeDiagram, snapBox, writeClip, STENCILS, type Page, type Shape,
} from './index';

function page(...list: [string, number, number, Partial<Shape>?][]) {
  let p: Page = { ...newPage(), grid: 0 };
  const shapes = list.map(([stencil, x, y, over]) => {
    const r = addShape(p, stencil, x, y, over);
    p = r.page;
    return r.shape;
  });
  return { p, shapes };
}

describe('connecting to the next shape', () => {
  it('adds one on the side asked for, lined up and joined at the facing points', () => {
    const { p, shapes } = page(['process', 200, 200]);
    const a = shapes[0]!;
    const r = autoConnect(p, a.id, 'e', null)!;
    const b = r.page.shapes.find((s) => s.id === r.shapeId)!;
    expect(r.added).toBe(true);
    expect([b.stencil, b.x, b.y + b.h / 2]).toEqual(['process', a.x + a.w + AUTO_GAP, a.y + a.h / 2]);
    expect(r.page.connectors[0]).toMatchObject({ from: { shape: a.id, port: 1 }, to: { shape: b.id, port: 3 }, endArrow: 'arrow' });
    const down = autoConnect(p, a.id, 's', 'decision', { routing: 'straight' })!;
    const d = down.page.shapes.find((s) => s.id === down.shapeId)!;
    expect([d.stencil, d.y, down.page.connectors[0]!.routing]).toEqual(['decision', a.y + a.h + AUTO_GAP, 'straight']);
  });

  it('connects the shape that is already there, and does nothing if they are joined', () => {
    const { p, shapes } = page(['process', 200, 200], ['decision', 400, 205]);
    const [a, b] = shapes as [Shape, Shape];
    expect(neighbourOn(p, a, 'e')!.id).toBe(b.id);
    expect(neighbourOn(p, a, 'w')).toBeNull();
    const r = autoConnect(p, a.id, 'e', null)!;
    expect([r.added, r.shapeId, r.page.shapes.length]).toEqual([false, b.id, 2]);
    expect(autoConnect(r.page, a.id, 'e', null)).toBeNull();
    // a chosen shape is added past the one in the way
    const more = autoConnect(r.page, a.id, 'e', 'document')!;
    const n = more.page.shapes.find((s) => s.id === more.shapeId)!;
    expect(more.added).toBe(true);
    expect(n.x).toBeGreaterThan(b.x + b.w);
  });

  it('chooses what follows and offers shapes of the same family', () => {
    expect([nextStencil('terminator'), nextStencil('decision'), nextStencil('netPc'), nextStencil('text'), nextStencil('image')]).toEqual(['process', 'process', 'netPc', 'rect', 'process']);
    for (const s of STENCILS) {
      const q = quickShapes(s.id);
      expect(q).toHaveLength(4);
      expect(q.every((x) => STENCILS.some((k) => k.id === x)), s.id).toBe(true);
    }
  });

  it('keeps the layer of the source', () => {
    const { p, shapes } = page(['process', 200, 200, { layer: 'l2' }]);
    const r = autoConnect({ ...p, layers: [{ id: 'l1', name: 'A', visible: true, locked: false, printable: true }, { id: 'l2', name: 'B', visible: true, locked: false, printable: true }], activeLayer: 'l1' }, shapes[0]!.id, 'e', null)!;
    expect(r.page.shapes.find((s) => s.id === r.shapeId)!.layer).toBe('l2');
    expect(r.page.connectors[0]!.layer).toBe('l2');
  });
});

describe('guides while moving', () => {
  const other = { x: 100, y: 100, w: 100, h: 60 };

  it('lines up edges and middles within reach, and draws where', () => {
    const r = snapBox({ x: 103, y: 300, w: 100, h: 60 }, [other], [], 6);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBeNull();
    expect(r.lines.filter((l) => l.kind === 'align').map((l) => l.x1).sort((a, b) => a - b)).toEqual([100, 150, 200]);
    expect(r.lines[0]).toMatchObject({ y1: 100, y2: 360 });
    expect(snapBox({ x: 130, y: 300, w: 100, h: 60 }, [other], [], 6)).toMatchObject({ dx: null, dy: null, lines: [] });
  });

  it('repeats the gap between two neighbours, and centres between them', () => {
    const row = [{ x: 0, y: 0, w: 50, h: 40 }, { x: 80, y: 0, w: 50, h: 40 }];
    const after = snapBox({ x: 163, y: 5, w: 40, h: 40 }, row, [], 6);
    expect(after.dx).toBe(-3);
    expect(after.lines.filter((l) => l.kind === 'space').map((l) => [l.x1, l.x2])).toEqual([[50, 80], [130, 160]]);
    const wide = [{ x: 0, y: 0, w: 50, h: 40 }, { x: 250, y: 0, w: 50, h: 40 }];
    expect(snapBox({ x: 123, y: 0, w: 50, h: 40 }, wide, [], 6).dx).toBe(2);
  });

  it('lines up with the guides of the page', () => {
    const r = snapBox({ x: 297, y: 503, w: 100, h: 60 }, [], [{ id: 'a', axis: 'x', pos: 300 }, { id: 'b', axis: 'y', pos: 500 }], 6);
    expect([r.dx, r.dy]).toEqual([3, -3]);
    expect(r.lines).toHaveLength(2);
  });
});

describe('guides of the page', () => {
  it('are added, moved and removed, saved with the diagram and checked when read', () => {
    let p = newPage();
    const a = addGuide(p, 'x', 120.456);
    p = addGuide(a.page, 'y', 40).page;
    p = moveGuide(p, a.guide.id, 200);
    expect(p.guides!.map((g) => [g.axis, g.pos])).toEqual([['x', 200], ['y', 40]]);
    const d = { ...newDiagram(), pages: [p] };
    expect(parseDiagram(serializeDiagram(d)).diagram.pages[0]!.guides).toEqual(p.guides);
    const bad = JSON.parse(serializeDiagram(d));
    bad.pages[0].guides = [{ axis: 'z', pos: 1 }, { axis: 'x', pos: 'no' }, { axis: 'y', pos: 1e12 }];
    expect(parseDiagram(JSON.stringify(bad)).diagram.pages[0]!.guides).toMatchObject([{ axis: 'y', pos: 60000 }]);
    p = removeGuide(removeGuide(p, a.guide.id), p.guides![1]!.id);
    expect('guides' in p).toBe(false);
  });
});

describe('changing a shape for another', () => {
  it('keeps place, size, text, format and connections', () => {
    const { p, shapes } = page(['process', 200, 200, { text: 'Revisar', data: [{ name: 'a', value: '1' }] }], ['process', 500, 200]);
    const [a, b] = shapes as [Shape, Shape];
    const joined = addConnector(p, newConnector({ shape: a.id, port: 1 }, { shape: b.id, port: 3 }));
    const q = changeStencil(joined, [a.id], 'decision');
    expect(q.shapes[0]).toMatchObject({ stencil: 'decision', x: a.x, y: a.y, w: a.w, h: a.h, text: 'Revisar', data: a.data, style: a.style });
    expect(q.connectors[0]!.from).toEqual({ shape: a.id, port: 1 });
    // a point the new shape does not have is left to choose by itself
    const odd = changeStencil(addConnector(p, newConnector({ shape: a.id, port: 7 }, { x: 0, y: 0 })), [a.id], 'ellipse');
    expect(odd.connectors[0]!.from).toEqual({ shape: a.id, port: 'auto' });
  });

  it('leaves containers, pictures and locked shapes, and makes a text box visible', () => {
    const { p, shapes } = page(['container', 200, 200], ['rect', 500, 200, { locked: true }], ['text', 800, 200, { text: 'x' }]);
    const [c, locked, text] = shapes as [Shape, Shape, Shape];
    const q = changeStencil(p, shapes.map((s) => s.id), 'rect');
    expect(q.shapes.find((s) => s.id === c.id)!.stencil).toBe('container');
    expect(q.shapes.find((s) => s.id === locked.id)).toBe(locked);
    expect(q.shapes.find((s) => s.id === text.id)!.style.fill).not.toBe('none');
    expect(changeStencil(p, [text.id], 'pool')).toBe(p);
  });
});

describe('copying the format', () => {
  const { p, shapes } = page(['process', 200, 200], ['rect', 500, 200]);
  const [a, b] = shapes as [Shape, Shape];
  const styled: Page = addConnector(
    { ...p, shapes: p.shapes.map((s) => (s.id === a.id ? { ...s, style: { ...s.style, fill: '#ff0000', stroke: '#00ff00', strokeWidth: 4, dash: 'dot' as const }, font: { ...s.font, size: 22, bold: true, align: 'left' as const } } : s)) },
    newConnector({ shape: a.id, port: 'auto' }, { shape: b.id, port: 'auto' }, { stroke: '#123456' }),
  );
  const line = styled.connectors[0]!.id;

  it('gives a shape the whole look of another, and a line its line and letters', () => {
    const q = applyLook(styled, [b.id], [line], lookOf(styled, a.id)!);
    expect(q.shapes[1]).toMatchObject({ style: { fill: '#ff0000', stroke: '#00ff00', strokeWidth: 4, dash: 'dot' }, font: { size: 22, bold: true, align: 'left' } });
    expect(q.connectors[0]).toMatchObject({ stroke: '#00ff00', strokeWidth: 4, dash: 'dot', font: { size: 22, align: 'center' } });
  });

  it('takes only the line and letters from a connector', () => {
    const q = applyLook(styled, [a.id], [], lookOf(styled, line)!);
    expect(q.shapes[0]).toMatchObject({ style: { fill: '#ff0000', stroke: '#123456', strokeWidth: 1.5 }, font: { size: 12, align: 'left' } });
    expect(lookOf(styled, 'nada')).toBeNull();
  });
});

describe('the clipboard', () => {
  it('carries shapes, connectors and groups, checked on the way back', () => {
    const { p, shapes } = page(['process', 200, 200, { text: 'A', layer: 'x' }], ['rect', 500, 200]);
    const joined = addConnector(p, newConnector({ shape: shapes[0]!.id, port: 'auto' }, { shape: shapes[1]!.id, port: 'auto' }));
    const copy = cloneItems(joined, shapes.map((s) => s.id), [joined.connectors[0]!.id]);
    const back = readClip(writeClip(copy))!;
    expect(back.shapes.map((s) => [s.text, s.x, s.layer])).toEqual(copy.shapes.map((s) => [s.text, s.x, undefined]));
    expect(back.connectors[0]!.from).toEqual(copy.connectors[0]!.from);
    for (const bad of ['', 'hola', '{"format":"otro"}', '{"format":"nova-diagram-clip","shapes":[],"connectors":[]}', '{"format":"nova-diagram-clip","shapes":1}']) expect(readClip(bad), bad).toBeNull();
    // what a file could not hold does not get in through the clipboard either
    const evil = readClip(JSON.stringify({ format: 'nova-diagram-clip', shapes: [{ stencil: 'no-existe', w: 1e12, link: { url: 'javascript:alert(1)' }, style: { fill: 'url(x)' } }], connectors: [] }))!;
    expect(evil.shapes[0]).toMatchObject({ stencil: 'rect', w: 20000, style: { fill: '#ffffff' } });
    expect(evil.shapes[0]!.link).toBeUndefined();
  });
});
