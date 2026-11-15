import { describe, expect, it } from 'vitest';
import { SHAPE_CATEGORIES, hasPreset, isLineKind, presetOf, resolveKind, shapeLabel, shapeSvg, shapeTextRect } from './index';

describe('galería común de formas', () => {
  it('todas las formas de la galería existen como geometría', () => {
    for (const c of SHAPE_CATEGORIES) for (const s of c.shapes) expect(hasPreset(s), s).toBe(true);
  });
  it('los nombres antiguos de Writer y Calc se resuelven', () => {
    expect(resolveKind('callout')).toBe('wedgeRectCallout');
    expect(resolveKind('rightTriangle')).toBe('rtTriangle');
    expect(resolveKind('textBox')).toBe('textbox');
    expect(presetOf('textbox')).toBe('rect');
    expect(presetOf('inventada')).toBe('rect');
    expect(shapeLabel('callout')).toBe('Llamada rectangular');
    expect(shapeLabel('flowChartSort')).toBe('flowChartSort');
  });
  it('detecta líneas', () => {
    expect(isLineKind('line')).toBe(true);
    expect(isLineKind('bentConnector3')).toBe(true);
    expect(isLineKind('rect')).toBe(false);
  });
  it('dibuja cualquier forma sin NaN y respeta relleno, contorno y volteo', () => {
    for (const c of SHAPE_CATEGORIES) for (const s of c.shapes) expect(shapeSvg(s, 120, 80, { fill: '#4472c4', stroke: '#2f528f' }), s).not.toMatch(/NaN|Infinity/);
    const r = shapeSvg('rect', 100, 50, { fill: '#ff0000', stroke: '#000000', strokeWidth: 2 });
    expect(r).toContain('fill="#ff0000"');
    expect(r).toContain('stroke-width="2"');
    expect(shapeSvg('rect', 100, 50, { fill: null, stroke: null })).toContain('fill="none"');
    const l = shapeSvg('line', 100, 50, { fill: '#ff0000', stroke: '#000', flip: true });
    expect(l).toContain('scale(-1 1)');
    expect(l).not.toContain('#ff0000');
  });
  it('da el rectángulo de texto', () => {
    expect(shapeTextRect('rect', 100, 50)).toEqual({ l: 0, t: 0, r: 100, b: 50 });
    const e = shapeTextRect('ellipse', 100, 100);
    expect(e.l).toBeGreaterThan(10);
  });
});

describe('puntos de ajuste', () => {
  it('las formas con tiradores los colocan dentro de la forma y se pueden arrastrar', async () => {
    const { adjustHandles, dragAdjust, avLstXml, parseGuide, cleanAdjust } = await import('./adjust');
    const h = adjustHandles('roundRect', 200, 100);
    expect(h.length).toBe(1);
    expect(h[0]!.x).toBeGreaterThan(0);
    expect(h[0]!.x).toBeLessThan(100);
    const adj = dragAdjust('roundRect', 200, 100, {}, 0, 40, 0);
    expect(adj?.adj).toBeGreaterThan(16667);
    // el tirador queda donde se soltó
    expect(adjustHandles('roundRect', 200, 100, adj ?? {})[0]!.x).toBeCloseTo(40, 0);
    // una forma sin tiradores no tiene ninguno
    expect(adjustHandles('rect', 100, 100)).toEqual([]);
    expect(adjustHandles('line', 100, 100)).toEqual([]);
    // volver al valor por omisión lo borra
    expect(cleanAdjust('roundRect', { adj: 16667 })).toBeUndefined();
    expect(avLstXml(undefined)).toBe('<a:avLst/>');
    expect(avLstXml({ adj: 30000 })).toBe('<a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst>');
    expect(parseGuide('adj', 'val 30000')).toEqual(['adj', 30000]);
    expect(parseGuide('adj', '*/ w 1 2')).toBeNull();
  });
  it('el dibujo cambia con el ajuste', () => {
    expect(shapeSvg('roundRect', 100, 100, { fill: '#fff', adj: { adj: 40000 } })).not.toBe(shapeSvg('roundRect', 100, 100, { fill: '#fff' }));
  });
});
