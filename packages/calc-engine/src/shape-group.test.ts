import { describe, expect, it } from 'vitest';
import type { SheetShape } from './objects';
import { applyPatches, groupShapes, moveShapes, rotateShapes, scaleShapes, shapeBounds, shapesBounds, ungroupShapes, withGroupMates } from './shape-group';

const sh = (id: string, x: number, y: number, width: number, height: number, extra: Partial<SheetShape> = {}): SheetShape => ({ id, kind: 'rect', x, y, width, height, ...extra });

describe('formas agrupadas', () => {
  it('los límites tienen en cuenta el giro', () => {
    expect(shapeBounds(sh('a', 0, 0, 100, 40))).toEqual({ x: 0, y: 0, width: 100, height: 40 });
    const b = shapeBounds(sh('a', 0, 0, 100, 40, { rotation: 90 }));
    expect(b.width).toBeCloseTo(40);
    expect(b.height).toBeCloseTo(100);
    expect(b.x + b.width / 2).toBeCloseTo(50);
    expect(shapesBounds([sh('a', 0, 0, 10, 10), sh('b', 20, 30, 10, 10)])).toEqual({ x: 0, y: 0, width: 30, height: 40 });
    expect(shapesBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
  it('agrupar, completar con los compañeros del grupo y desagrupar', () => {
    const all = [sh('a', 0, 0, 10, 10), sh('b', 20, 0, 10, 10), sh('c', 40, 0, 10, 10), sh('d', 60, 0, 10, 10)];
    expect(groupShapes(all, ['a'])).toBeNull();
    const g = groupShapes(all, ['a', 'b'])!;
    expect(all.filter((s) => s.group === g).map((s) => s.id)).toEqual(['a', 'b']);
    expect(withGroupMates(all, ['a'])).toEqual(['a', 'b']);
    expect(withGroupMates(all, ['c'])).toEqual(['c']);
    // agrupar un grupo con otra forma funde los grupos en uno
    const g2 = groupShapes(all, ['b', 'c'])!;
    expect(g2).not.toBe(g);
    expect(all.filter((s) => s.group === g2).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(all[3]!.group).toBeUndefined();
    expect(ungroupShapes(all, ['a'])).toEqual(['a', 'b', 'c']);
    expect(all.every((s) => s.group === undefined)).toBe(true);
  });
  it('mover, escalar y girar el bloque', () => {
    const a = sh('a', 0, 0, 100, 50);
    const b = sh('b', 100, 50, 100, 50);
    expect(moveShapes([a, b], 10, -5)).toEqual([{ id: 'a', x: 10, y: -5 }, { id: 'b', x: 110, y: 45 }]);
    // el bloque mide 200 x 100: al doblarlo, todo se duplica
    const p = scaleShapes([a, b], { x: 0, y: 0, width: 200, height: 100 }, { x: 0, y: 0, width: 400, height: 200 });
    expect(p[0]).toEqual({ id: 'a', x: 0, y: 0, width: 200, height: 100 });
    expect(p[1]).toEqual({ id: 'b', x: 200, y: 100, width: 200, height: 100 });
    // girado 180°: los centros se reflejan respecto del centro del bloque y cada forma gira 180
    const r = rotateShapes([a, b], { x: 100, y: 50 }, 180);
    expect(r[0]!.x).toBe(100);
    expect(r[0]!.y).toBe(50);
    expect(r[0]!.rotation).toBe(180);
    expect(r[1]!.x).toBe(0);
    expect(r[1]!.y).toBe(0);
  });
  it('una forma girada 90° intercambia los factores de escala', () => {
    const a = sh('a', 0, 0, 100, 20, { rotation: 90 });
    const [p] = scaleShapes([a], { x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 200, height: 100 });
    // el ancho visible (en pantalla) de una forma a 90° es su alto: se ensancha el alto local
    expect(p!.width).toBe(100);
    expect(p!.height).toBe(40);
  });
  it('aplicar los cambios guarda el giro 0 como ausente', () => {
    const list = [sh('a', 0, 0, 10, 10, { rotation: 30 })];
    applyPatches(list, [{ id: 'a', x: 5, rotation: 0 }]);
    expect(list[0]).toEqual({ id: 'a', kind: 'rect', x: 5, y: 0, width: 10, height: 10 });
  });
});
