import { newConnector, readClip, serializeDiagram, parseDiagram, updatePage } from '@suitenova/diagram-core';
import { compileQuery } from '@suitenova/find-core';
import { describe, expect, it } from 'vitest';
import { copySelection, pasteIncoming, shapesIn } from './clipboard';
import { DiagramCtl } from './ctl';
import { diagramFindHost } from './find-host';

const query = (text: string) => {
  const c = compileQuery(text, {});
  if (!c.ok) throw new Error(c.message);
  return { text, query: c.query, filters: {} };
};
const nothing = { custom: '', html: '', text: '', images: [] as File[] };

describe('copy and paste through the system', () => {
  function two() {
    const ctl = new DiagramCtl();
    const a = ctl.addStencil('process', { x: 200, y: 200 });
    ctl.setText(a.id, 'Pedido <1>');
    const b = ctl.addStencil('decision', { x: 500, y: 200 });
    ctl.setText(b.id, '¿Hay?');
    ctl.setSelection([a.id, b.id]);
    ctl.connectSelected();
    ctl.setSelection([a.id, b.id], ctl.basePage.connectors.map((c) => c.id));
    return { ctl, a, b };
  }

  it('gives other programs the text, and another window the shapes', () => {
    const { ctl } = two();
    const data = copySelection(ctl)!;
    expect(data.text).toBe('Pedido <1>\n¿Hay?');
    expect(data.html).toContain('Pedido &lt;1&gt;<br>¿Hay?');
    expect(shapesIn('', data.html)!.shapes.map((s) => s.text)).toEqual(['Pedido <1>', '¿Hay?']);
    const other = new DiagramCtl();
    expect(pasteIncoming(other, { ...nothing, html: data.html, text: data.text }, undefined, { x: 0, y: 0 }, () => undefined)).toBe(true);
    expect(other.basePage.shapes.map((s) => [s.stencil, s.x])).toEqual(ctl.basePage.shapes.map((s) => [s.stencil, s.x]));
    expect(other.basePage.connectors).toHaveLength(1);
    // pasted again, they move aside
    pasteIncoming(other, { ...nothing, custom: data.payload }, undefined, { x: 0, y: 0 }, () => undefined);
    expect(other.basePage.shapes[2]!.x).toBe(ctl.basePage.shapes[0]!.x + 24);
    expect(copySelection(new DiagramCtl())).toBeNull();
  });

  it('puts them where a menu was opened', () => {
    const { ctl } = two();
    copySelection(ctl);
    ctl.paste({ x: 40, y: 600 });
    const added = ctl.selectedShapes();
    expect([Math.min(...added.map((s) => s.x)), Math.min(...added.map((s) => s.y))]).toEqual([40, 600]);
  });

  it('makes a text box of text, and hands pictures over', () => {
    const ctl = new DiagramCtl();
    pasteIncoming(ctl, { ...nothing, text: 'Dos líneas\r\n\tde otro programa\n' }, undefined, { x: 400, y: 300 }, () => undefined);
    const s = ctl.basePage.shapes[0]!;
    expect([s.stencil, s.text, s.x + s.w / 2, s.y + s.h / 2]).toEqual(['text', 'Dos líneas\n    de otro programa', 400, 300]);
    const got: File[] = [];
    const image = new File([new Uint8Array(1)], 'a.png', { type: 'image/png' });
    expect(pasteIncoming(ctl, { ...nothing, images: [image] }, { x: 1, y: 2 }, { x: 0, y: 0 }, (f) => got.push(...f))).toBe(true);
    expect(got).toEqual([image]);
    // a piece of a document brings both: it goes in as text
    pasteIncoming(ctl, { ...nothing, text: 'celda', images: [image] }, undefined, { x: 0, y: 0 }, (f) => got.push(...f));
    expect(got).toHaveLength(1);
    expect(pasteIncoming(ctl, { ...nothing, text: '  ' }, undefined, { x: 0, y: 0 }, () => undefined)).toBe(false);
    expect(readClip('x')).toBeNull();
  });
});

describe('the aids to draw', () => {
  it('connects to the next shape in one step of undo', () => {
    const ctl = new DiagramCtl();
    const a = ctl.addStencil('terminator', { x: 200, y: 200 });
    ctl.autoConnectFrom(a.id, 's', null);
    expect(ctl.basePage.shapes.map((s) => s.stencil)).toEqual(['terminator', 'process']);
    expect(ctl.selShapes).toEqual([ctl.basePage.shapes[1]!.id]);
    ctl.autoConnectFrom(a.id, 's', null);
    expect(ctl.message).toMatch(/ya están conectadas/);
    ctl.undo();
    expect([ctl.basePage.shapes.length, ctl.basePage.connectors.length]).toEqual([1, 0]);
  });

  it('copies the format once, or until it is stopped when asked twice in a row', () => {
    const ctl = new DiagramCtl();
    const [a, b, c] = [100, 300, 500].map((x) => ctl.addStencil('process', { x, y: 100 }));
    ctl.setSelection([a!.id]);
    ctl.setStyle({ fill: '#ff0000' });
    ctl.togglePainter(1000);
    ctl.paint([b!.id], []);
    expect([ctl.painter, ctl.basePage.shapes[1]!.style.fill]).toEqual([null, '#ff0000']);
    ctl.setSelection([a!.id]);
    ctl.togglePainter(2000);
    ctl.togglePainter(2300);
    ctl.paint([b!.id], []);
    ctl.paint([c!.id], []);
    expect(ctl.painter?.sticky).toBe(true);
    expect(ctl.basePage.shapes[2]!.style.fill).toBe('#ff0000');
    ctl.togglePainter(9000);
    expect(ctl.painter).toBeNull();
  });

  it('keeps guides with the diagram and sets sizes by the centre', () => {
    const ctl = new DiagramCtl();
    const a = ctl.addStencil('process', { x: 200, y: 200 });
    const g = ctl.addGuideAt('x', 300);
    ctl.moveGuideTo(g, 320);
    expect(parseDiagram(serializeDiagram(ctl.diagram)).diagram.pages[0]!.guides).toEqual([{ id: g, axis: 'x', pos: 320 }]);
    ctl.setBox([a.id], { w: 200 });
    ctl.setBox([a.id], { cx: 500, rot: -90 });
    expect(ctl.basePage.shapes[0]).toMatchObject({ x: 400, w: 200, rot: 270 });
    ctl.setLocked(true);
    ctl.setBox([a.id], { w: 10 });
    expect(ctl.basePage.shapes[0]!.w).toBe(200);
    ctl.removeGuideById(g);
    expect(ctl.basePage.guides).toBeUndefined();
  });
});

describe('search and replace', () => {
  function sample() {
    const ctl = new DiagramCtl();
    const a = ctl.addStencil('process', { x: 100, y: 100 });
    ctl.setText(a.id, 'Pedido y pedido');
    const pool = ctl.addStencil('pool', { x: 500, y: 600 });
    ctl.renameLaneTo(pool.id, ctl.basePage.shapes.find((s) => s.id === pool.id)!.container!.lanes![0]!.id, 'Pedidos');
    const first = ctl.pageId;
    ctl.newPage();
    const b = ctl.addStencil('rect', { x: 100, y: 100 });
    ctl.setText(b.id, 'otro pedido');
    ctl.edit((p) => ({ ...p, connectors: [newConnector({ shape: b.id, port: 'auto' }, { x: 400, y: 400 }, { text: 'pedido' })] }));
    ctl.goToPage(first);
    return { ctl, a, pool };
  }

  it('finds every match of every page and goes to each', () => {
    const { ctl } = sample();
    const host = diagramFindHost(ctl);
    expect(host.find(query('pedido'))).toEqual({ count: 5, current: 0 });
    expect(ctl.selShapes).toHaveLength(1);
    expect(host.step(-1)).toEqual({ count: 5, current: 4 });
    expect(ctl.pageId).toBe(ctl.diagram.pages[1]!.id);
    expect(ctl.selConnectors).toHaveLength(1);
    expect(host.list!(query('otro'))).toHaveLength(1);
  });

  it('replaces one at a time, and all at once as one step of undo', () => {
    const { ctl, a, pool } = sample();
    const host = diagramFindHost(ctl);
    host.find(query('pedido'));
    const text = () => ctl.diagram.pages[0]!.shapes.find((s) => s.id === a.id)!.text;
    // the pool was added behind: its lane comes first
    host.replaceCurrent(query('pedido'), 'orden');
    expect(ctl.diagram.pages[0]!.shapes.find((s) => s.id === pool.id)!.container!.lanes![0]!.title).toBe('ordens');
    // what is written may hold what is looked for: the search goes on after it
    host.replaceCurrent(query('pedido'), 'pedido-2');
    expect(text()).toBe('pedido-2 y pedido');
    host.replaceCurrent(query('pedido'), 'orden');
    expect(text()).toBe('pedido-2 y orden');
    const before = ctl.diagram;
    expect(host.replaceAll(query('pedido'), 'envío')).toBe(3);
    expect(ctl.diagram.pages[1]!.connectors[0]!.text).toBe('envío');
    ctl.undo();
    expect(ctl.diagram).toBe(before);
  });

  it('does not write over locked shapes or layers', () => {
    const { ctl, a } = sample();
    ctl.setSelection([a.id]);
    ctl.setLocked(true);
    ctl.commit(updatePage(ctl.diagram, ctl.diagram.pages[1]!.id, (p) => ({ ...p, layers: [{ id: 'l', name: 'L', visible: true, locked: true, printable: true }] })));
    expect(diagramFindHost(ctl).replaceAll(query('pedido'), 'x')).toBe(1);
  });
});
