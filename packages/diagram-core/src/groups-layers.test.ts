import { describe, expect, it } from 'vitest';
import { boundsOf } from './geometry';
import { blockBounds, expandSelection, groupMembers, groupShapes, rotateBlock, scaleShapes, topGroupId, ungroupShapes } from './groups';
import { parseDiagram, serializeDiagram } from './io';
import { addLayer, assignLayer, isItemLocked, isItemVisible, layerIdOf, layersOf, moveLayer, printablePage, removeLayer, setActiveLayer, updateLayer, visibleShapes } from './layers';
import { newDiagram, type Page } from './model';
import { addConnector, addShape, cloneItems, addItems, deleteItems, newConnector, updatePage } from './ops';
import { pageToSvg } from './svg';

function threeShapes(): { page: Page; ids: string[] } {
  let page = newDiagram().pages[0]!;
  const ids: string[] = [];
  for (const [x, y] of [[100, 100], [300, 100], [500, 300]] as const) {
    const r = addShape(page, 'rect', x, y);
    page = r.page;
    ids.push(r.shape.id);
  }
  return { page, ids };
}

describe('groups', () => {
  it('groups shapes, selects them together and takes them apart', () => {
    const { page, ids } = threeShapes();
    const g = groupShapes(page, [ids[0]!, ids[1]!])!;
    expect(g).not.toBeNull();
    const [a, b, c] = ids.map((id) => g.page.shapes.find((s) => s.id === id)!);
    expect(a!.group).toBe(g.groupId);
    expect(b!.group).toBe(g.groupId);
    expect(c!.group).toBeUndefined();
    expect(expandSelection(g.page, [ids[0]!]).sort()).toEqual([ids[0]!, ids[1]!].sort());
    expect(groupShapes(page, [ids[0]!])).toBeNull();
    const un = ungroupShapes(g.page, [ids[0]!]);
    expect(un.shapes.every((s) => !s.group)).toBe(true);
    expect(un.groups).toEqual([]);
  });

  it('groups nest: grouping a group with a shape, and ungrouping one level at a time', () => {
    const { page, ids } = threeShapes();
    const g1 = groupShapes(page, [ids[0]!, ids[1]!])!;
    const g2 = groupShapes(g1.page, [ids[0]!, ids[2]!])!;
    const s0 = g2.page.shapes.find((s) => s.id === ids[0])!;
    expect(topGroupId(g2.page, s0)).toBe(g2.groupId);
    expect(groupMembers(g2.page, g2.groupId)).toHaveLength(3);
    expect(expandSelection(g2.page, [ids[2]!])).toHaveLength(3);
    const one = ungroupShapes(g2.page, [ids[0]!]);
    // the inner group survives
    expect(one.groups).toEqual([{ id: g1.groupId }]);
    expect(one.shapes.find((s) => s.id === ids[0])!.group).toBe(g1.groupId);
    expect(one.shapes.find((s) => s.id === ids[2])!.group).toBeUndefined();
  });

  it('a group that loses members dissolves; deleting keeps the rest consistent', () => {
    const { page, ids } = threeShapes();
    const g = groupShapes(page, ids)!;
    const del = deleteItems(g.page, [ids[0]!], []);
    expect(del.groups).toHaveLength(1);
    const del2 = deleteItems(del, [ids[1]!], []);
    expect(del2.groups).toEqual([]);
    expect(del2.shapes.every((s) => !s.group)).toBe(true);
  });

  it('copies get groups of their own', () => {
    const { page, ids } = threeShapes();
    const g = groupShapes(page, [ids[0]!, ids[1]!])!;
    const copy = cloneItems(g.page, [ids[0]!, ids[1]!], [], 10, 10);
    expect(copy.groups).toHaveLength(1);
    expect(copy.groups[0]!.id).not.toBe(g.groupId);
    expect(copy.shapes.every((s) => s.group === copy.groups[0]!.id)).toBe(true);
    const merged = addItems(g.page, copy.shapes, [], copy.groups);
    expect(merged.groups).toHaveLength(2);
  });

  it('a block scales and turns as one', () => {
    const { page, ids } = threeShapes();
    const from = blockBounds(page.shapes)!;
    const scaled = scaleShapes(page, ids, from, { x: from.x, y: from.y, w: from.w * 2, h: from.h });
    const to = blockBounds(scaled.shapes)!;
    expect(to.w).toBeCloseTo(from.w * 2, 3);
    expect(to.h).toBeCloseTo(from.h, 3);
    const turned = rotateBlock(page, ids, { x: 300, y: 200 }, 90);
    expect(turned.shapes.every((s) => Math.abs(s.rot - 90) < 1e-6)).toBe(true);
    const b0 = boundsOf(turned.shapes[0]!);
    expect(Number.isFinite(b0.x)).toBe(true);
  });
});

describe('layers', () => {
  it('a page has one implicit layer; adding layers makes them real and new shapes go to the active one', () => {
    let { page, ids } = threeShapes();
    expect(layersOf(page)).toHaveLength(1);
    expect(layerIdOf(page, page.shapes[0]!)).toBe(layersOf(page)[0]!.id);
    const r = addLayer(page, 'Notas');
    page = r.page;
    expect(layersOf(page).map((l) => l.name)).toEqual(['Capa 1', 'Notas']);
    expect(page.activeLayer).toBe(r.layer.id);
    const s = addShape(page, 'rect', 50, 50);
    expect(s.shape.layer).toBe(r.layer.id);
    page = assignLayer(s.page, [ids[0]!], [], r.layer.id);
    expect(page.shapes.find((x) => x.id === ids[0])!.layer).toBe(r.layer.id);
  });

  it('hidden layers are not drawn or exported, locked ones cannot be touched, non-printable ones are exported never', () => {
    let { page, ids } = threeShapes();
    const r = addLayer(page, 'Guías');
    page = assignLayer(r.page, [ids[0]!], [], r.layer.id);
    page = addConnector(page, newConnector({ shape: ids[0]!, port: 'auto' }, { shape: ids[1]!, port: 'auto' }));
    expect(visibleShapes(page)).toHaveLength(3);
    const hidden = updateLayer(page, r.layer.id, { visible: false });
    expect(visibleShapes(hidden)).toHaveLength(2);
    expect(isItemVisible(hidden, hidden.shapes[0]!)).toBe(false);
    expect(pageToSvg(hidden).match(/<path/g)?.length ?? 0).toBeLessThan(pageToSvg(page).match(/<path/g)!.length);
    const locked = updateLayer(page, r.layer.id, { locked: true });
    expect(isItemLocked(locked, locked.shapes[0]!)).toBe(true);
    expect(isItemLocked(locked, locked.shapes[1]!)).toBe(false);
    const np = updateLayer(page, r.layer.id, { printable: false });
    expect(printablePage(np).shapes).toHaveLength(2);
    expect(visibleShapes(np)).toHaveLength(3);
  });

  it('removing a layer moves its items; the last one stays; order and active layer', () => {
    let { page, ids } = threeShapes();
    const a = addLayer(page, 'A');
    const b = addLayer(a.page, 'B');
    page = assignLayer(b.page, [ids[0]!], [], a.layer.id);
    const rm = removeLayer(page, a.layer.id);
    expect(rm.layers).toHaveLength(2);
    expect(layerIdOf(rm, rm.shapes[0]!)).toBe(layersOf(rm)[0]!.id);
    let only = rm;
    only = removeLayer(only, b.layer.id);
    expect(removeLayer(only, only.layers![0]!.id)).toBe(only);
    const mv = moveLayer(b.page, b.layer.id, -1);
    expect(mv.layers!.map((l) => l.name)).toEqual(['Capa 1', 'B', 'A']);
    expect(setActiveLayer(b.page, a.layer.id).activeLayer).toBe(a.layer.id);
  });

  it('layers and groups survive save and load; damaged references are dropped', () => {
    let { page, ids } = threeShapes();
    const g = groupShapes(page, [ids[0]!, ids[1]!])!;
    const l = addLayer(g.page, 'Capa B');
    page = assignLayer(l.page, [ids[2]!], [], l.layer.id);
    let d = newDiagram();
    d = updatePage(d, d.pages[0]!.id, () => page);
    const back = parseDiagram(serializeDiagram(d)).diagram.pages[0]!;
    expect(back.layers).toHaveLength(2);
    expect(back.activeLayer).toBe(l.layer.id);
    expect(back.groups).toEqual([{ id: g.groupId }]);
    expect(back.shapes.filter((s) => s.group === g.groupId)).toHaveLength(2);
    expect(back.shapes.find((s) => s.id === ids[2])!.layer).toBe(l.layer.id);
    const bad = JSON.parse(serializeDiagram(d));
    bad.pages[0].shapes[0].group = 'nope';
    bad.pages[0].shapes[2].layer = 'nope';
    bad.pages[0].groups.push({ id: 'x', parent: 'y' }, { id: 'y', parent: 'x' });
    const fixed = parseDiagram(JSON.stringify(bad)).diagram.pages[0]!;
    expect(fixed.shapes[0]!.group).toBeUndefined();
    expect(fixed.shapes[2]!.layer).toBeUndefined();
    expect(fixed.groups!.some((x) => x.id === 'x' && !x.parent)).toBe(true);
  });
});
