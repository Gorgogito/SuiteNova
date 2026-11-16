import { describe, expect, it } from 'vitest';
import { frameBounds, framesBounds, framesFromGroup, framesToGroup, moveFrames, normDeg, rotateFrames, scaleFrames, type Frame } from './index';

const f = (id: string, x: number, y: number, width: number, height: number, rotation?: number): Frame => ({ id, x, y, width, height, ...(rotation ? { rotation } : {}) });

describe('bloques de marcos', () => {
  it('límites con giro y normalización de grados', () => {
    const b = frameBounds(f('a', 0, 0, 100, 40, 90));
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([40, 100]);
    expect(framesBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(normDeg(-90)).toBe(270);
    expect(normDeg(450)).toBe(90);
  });
  it('mover, escalar y girar', () => {
    const a = f('a', 0, 0, 100, 50);
    const b = f('b', 100, 50, 100, 50);
    expect(moveFrames([a], 5, 5)).toEqual([{ id: 'a', x: 5, y: 5 }]);
    const [pa, pb] = scaleFrames([a, b], { x: 0, y: 0, width: 200, height: 100 }, { x: 0, y: 0, width: 400, height: 200 });
    expect(pa).toEqual({ id: 'a', x: 0, y: 0, width: 200, height: 100 });
    expect(pb).toEqual({ id: 'b', x: 200, y: 100, width: 200, height: 100 });
    const [ra] = rotateFrames([a], { x: 100, y: 50 }, 180);
    expect([ra!.x, ra!.y, ra!.rotation]).toEqual([100, 50, 180]);
  });
  it('agrupar da coordenadas relativas a la esquina del bloque', () => {
    const g = framesToGroup([f('a', 100, 200, 50, 50), f('b', 180, 230, 40, 60)]);
    expect(g.box).toEqual({ x: 100, y: 200, width: 120, height: 90 });
    expect(g.children.map((c) => [c.id, c.x, c.y])).toEqual([['a', 0, 0], ['b', 80, 30]]);
  });
  it('desagrupar sin giro devuelve las coordenadas absolutas', () => {
    const p = framesFromGroup(f('g', 100, 200, 120, 90), [f('a', 0, 0, 50, 50), f('b', 80, 30, 40, 60)]);
    expect(p).toEqual([{ id: 'a', x: 100, y: 200 }, { id: 'b', x: 180, y: 230 }]);
  });
  it('desagrupar un grupo girado reparte el giro: cada hija gira y su centro sigue al del grupo', () => {
    // grupo de 200 x 100 en (0,0) girado 90°: la hija de la izquierda queda arriba
    const g = f('g', 0, 0, 200, 100, 90);
    const [a, b] = framesFromGroup(g, [f('a', 0, 0, 100, 100), f('b', 100, 0, 100, 100)]);
    expect(a!.rotation).toBe(90);
    expect(b!.rotation).toBe(90);
    // centro del grupo (100, 50); centro de a antes = (50,50) → girado 90° queda en (100, 0); el de b (150,50) → (100, 100)
    const centre = (p: { x?: number; y?: number }) => [(p.x ?? 0) + 50, (p.y ?? 0) + 50];
    expect(centre(a!)).toEqual([100, 0]);
    expect(centre(b!)).toEqual([100, 100]);
  });
  it('agrupar y desagrupar es reversible', () => {
    const orig = [f('a', 100, 200, 50, 50), f('b', 180, 230, 40, 60)];
    const g = framesToGroup(orig);
    const back = framesFromGroup({ id: 'g', ...g.box }, g.children);
    expect(back).toEqual(orig.map((o) => ({ id: o.id, x: o.x, y: o.y })));
  });
});
