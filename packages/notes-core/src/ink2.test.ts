import { describe, expect, it } from 'vitest';
import { boundsOf, duplicateStrokes, erasePoint, groupIntoLines, newStroke, pointInPolygon, projectOnRuler, replayAt, restyleStrokes, scaleStrokes, snapToRuler, strokesInLasso, strokesToSvg } from './index';

const pen = (pts: number[]) => newStroke('pen', '#000000', 3, pts);
const line = (a: number, b: number, c: number, d: number) => newStroke('line', '#000000', 3, [a, b, c, d]);

describe('lazo', () => {
  const tri = [0, 0, 100, 0, 50, 100];
  it('punto dentro del polígono', () => {
    expect(pointInPolygon(50, 30, tri)).toBe(true);
    expect(pointInPolygon(5, 90, tri)).toBe(false);
  });
  it('selecciona lo que está dentro y deja lo de fuera', () => {
    const inside = pen([40, 20, 50, 30, 60, 20]);
    const outside = pen([200, 200, 210, 210]);
    const half = pen([10, 10, 300, 10, 300, 20, 310, 20]);
    expect(strokesInLasso([inside, outside, half], tri).map((s) => s.id)).toEqual([inside.id]);
    expect(strokesInLasso([inside], [0, 0, 1, 1])).toEqual([]);
  });
});

describe('borrador de puntos', () => {
  const long = () => pen(Array.from({ length: 21 }, (_, i) => [i * 10, 50]).flat());
  it('parte un trazo en dos', () => {
    const s = long();
    const r = erasePoint([s], 100, 50, 6);
    expect(r).toHaveLength(2);
    expect(r[0]!.id).toBe(s.id);
    expect(r[1]!.id).not.toBe(s.id);
    expect(Math.max(...r[0]!.pts.filter((_, i) => i % 2 === 0))).toBeLessThan(100);
    expect(Math.min(...r[1]!.pts.filter((_, i) => i % 2 === 0))).toBeGreaterThan(100);
  });
  it('quita el trazo si solo queda un punto suelto del extremo y deja formas enteras fuera de alcance', () => {
    const s = pen([0, 0, 4, 0]);
    expect(erasePoint([s], 0, 0, 8)).toEqual([]);
    const l = line(0, 0, 100, 0);
    expect(erasePoint([l], 50, 40, 6)).toEqual([l]);
    expect(erasePoint([l], 50, 2, 6)).toEqual([]);
  });
  it('si no toca nada devuelve la misma lista', () => {
    const ink = [long()];
    expect(erasePoint(ink, 500, 500, 6)).toBe(ink);
  });
  it('un corte en el extremo no deja un trozo vacío', () => {
    const r = erasePoint([long()], 0, 50, 6);
    expect(r).toHaveLength(1);
    expect(r[0]!.pts[0]).toBeGreaterThan(0);
  });
});

describe('editar trazos', () => {
  it('cambia color y grosor solo de los elegidos', () => {
    const a = pen([0, 0, 5, 5]);
    const b = pen([9, 9, 10, 10]);
    const r = restyleStrokes([a, b], [a.id], { color: '#c50f1f', width: 6 });
    expect(r[0]).toMatchObject({ color: '#c50f1f', width: 6 });
    expect(r[1]).toBe(b);
  });
  it('escala respecto de un punto y limita el factor', () => {
    const a = pen([10, 10, 20, 20]);
    expect(scaleStrokes([a], [a.id], 2, 2, 10, 10)[0]!.pts).toEqual([10, 10, 30, 30]);
    expect(scaleStrokes([a], [a.id], 0, 0, 10, 10)[0]!.pts[2]).toBeCloseTo(10.5, 1);
  });
  it('mide y duplica', () => {
    const a = pen([10, 10, 20, 30]);
    expect(boundsOf([a], [a.id])).toMatchObject({ x1: 8.5, y1: 8.5, x2: 21.5, y2: 31.5 });
    expect(boundsOf([a], [])).toBeNull();
    const d = duplicateStrokes([a], [a.id], 5, 7);
    expect(d[0]!.pts).toEqual([15, 17, 25, 37]);
    expect(d[0]!.id).not.toBe(a.id);
  });
});

describe('regla', () => {
  const r = { x: 100, y: 100, angle: 0, len: 400 };
  it('proyecta puntos', () => {
    expect(projectOnRuler(r, 250, 110)).toEqual({ along: 150, dist: 10 });
  });
  it('un trazo pegado a la regla queda recto sobre ella', () => {
    expect(snapToRuler(r, [120, 90, 200, 108, 320, 95])).toEqual([120, 100, 320, 100]);
  });
  it('lejos de la regla no se toca; se recorta a su longitud', () => {
    expect(snapToRuler(r, [120, 300, 320, 300])).toBeNull();
    expect(snapToRuler(r, [120, 100, 900, 100])).toEqual([120, 100, 500, 100]);
  });
  it('la regla inclinada 90° da una vertical', () => {
    expect(snapToRuler({ x: 50, y: 50, angle: 90, len: 300 }, [52, 60, 48, 200])).toEqual([50, 60, 50, 200]);
  });
});

describe('reproducción', () => {
  it('muestra los trazos en orden y el último a medias', () => {
    const a = pen([0, 0, 1, 1, 2, 2, 3, 3]);
    const b = pen([5, 5, 6, 6, 7, 7, 8, 8]);
    expect(replayAt([a, b], 0)).toEqual([]);
    expect(replayAt([a, b], 1)).toEqual([a, b]);
    const half = replayAt([a, b], 0.75);
    expect(half).toHaveLength(2);
    expect(half[0]).toBe(a);
    expect(half[1]!.pts.length).toBeLessThan(b.pts.length);
  });
});

describe('tinta a texto (preparación)', () => {
  it('agrupa trazos en líneas de arriba abajo y de izquierda a derecha', () => {
    const a = pen([100, 10, 110, 30]);
    const b = pen([10, 12, 20, 32]);
    const c = pen([10, 80, 20, 100]);
    const lines = groupIntoLines([a, c, b]);
    expect(lines.map((l) => l.map((s) => s.id))).toEqual([[b.id, a.id], [c.id]]);
  });
  it('genera un SVG con fondo blanco', () => {
    const r = strokesToSvg([pen([10, 10, 50, 40])], 10, 2)!;
    expect(r.svg).toContain('<svg');
    expect(r.width).toBe(126);
    expect(strokesToSvg([])).toBeNull();
  });
});
