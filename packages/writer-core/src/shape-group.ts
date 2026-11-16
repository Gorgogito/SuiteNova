import { scaleFrames } from '@suitenova/shapes-core';
import type { Node as PMNode } from 'prosemirror-model';

/**
 * A copy of a group resized to `w` x `h` pixels: every child (and, recursively, every child of a nested group) keeps its place and
 * size in proportion. Children that are turned a quarter turn swap the factors (see `scaleFrames`).
 */
export function scaleGroupContent(group: PMNode, w: number, h: number): PMNode {
  const oldW = group.attrs.width as number;
  const oldH = group.attrs.height as number;
  const frames = [] as { id: string; x: number; y: number; width: number; height: number; rotation: number }[];
  group.forEach((c, _off, i) => frames.push({ id: String(i), x: c.attrs.x ?? 0, y: c.attrs.y ?? 0, width: c.attrs.width, height: c.attrs.height, rotation: c.attrs.rotation ?? c.attrs.rotate ?? 0 }));
  const patches = scaleFrames(frames, { x: 0, y: 0, width: oldW, height: oldH }, { x: 0, y: 0, width: w, height: h });
  const kids: PMNode[] = [];
  group.forEach((c, _off, i) => {
    const p = patches[i]!;
    if (c.type.name === 'shape_group') {
      // se escala desde su tamaño de origen, y después se coloca
      const scaled = scaleGroupContent(c, p.width!, p.height!);
      kids.push(scaled.type.create({ ...scaled.attrs, x: p.x, y: p.y }, scaled.content, scaled.marks));
    } else kids.push(c.type.create({ ...c.attrs, x: p.x, y: p.y, width: p.width, height: p.height }, c.content, c.marks));
  });
  return group.type.create({ ...group.attrs, width: w, height: h }, kids, group.marks);
}
