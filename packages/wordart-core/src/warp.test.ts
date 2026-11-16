import { describe, expect, it } from 'vitest';
import { Curve, flattenPath, hasWarp, layoutText, dragWarpAdjust, warpAdjustHandles, warpDefaults, warpGeometry, warpNames, warpText, type Contour, type FontLike } from './index';

/** Una fuente falsa: cada letra es un rectángulo de 500 x 700 en una celda de 700 (unidades de 1000 por em). */
const box: FontLike = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  glyph: (ch) => (ch === ' ' ? { advance: 400, path: [] } : { advance: 700, path: [['M', 50, 0], ['L', 550, 0], ['L', 550, -700], ['L', 50, -700], ['Z']] }),
  kern: () => 0,
};

const bounds = (cs: Contour[]) => {
  const xs = cs.flat().map((p) => p.x);
  const ys = cs.flat().map((p) => p.y);
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
};

describe('curvas', () => {
  it('se recorren por fracción de longitud y dan su tangente', () => {
    const c = new Curve([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(c.length).toBe(20);
    expect(c.at(0.25)).toEqual({ x: 5, y: 0 });
    expect(c.at(0.75)).toEqual({ x: 10, y: 5 });
    expect(c.at(2)).toEqual({ x: 10, y: 10 });
    expect(c.tangent(0.1).x).toBeCloseTo(1, 3);
    expect(c.reversed().at(0)).toEqual({ x: 10, y: 10 });
  });
  it('aplana curvas en polígonos cerrados', () => {
    const out = flattenPath([['M', 0, 0], ['Q', 10, 0, 10, 10], ['L', 0, 10], ['Z']]);
    expect(out).toHaveLength(1);
    expect(out[0]!.length).toBeGreaterThan(5);
    expect(flattenPath([['M', 0, 0], ['C', 0, 5, 10, 5, 10, 0], ['Z']])[0]!.length).toBeGreaterThan(4);
  });
});

describe('diseño del texto', () => {
  it('compone líneas, avances y alineación con el tamaño pedido', () => {
    const b = layoutText('ab\nabcd', box, { size: 100 });
    expect(b.width).toBeCloseTo(280, 3);
    expect(b.height).toBeCloseTo(200, 3);
    expect(b.lines).toHaveLength(2);
    expect(b.lines[0]!.baseline).toBeCloseTo(80, 3);
    expect(b.lines[1]!.baseline).toBeCloseTo(180, 3);
    expect(b.contours).toHaveLength(6);
    const c = layoutText('ab\nabcd', box, { size: 100, align: 'center' });
    expect(c.lines[0]!.x).toBeCloseTo(70, 3);
    const r = layoutText('ab\nabcd', box, { size: 100, align: 'right' });
    expect(r.lines[0]!.x).toBeCloseTo(140, 3);
  });
  it('el espacio entre letras y los espacios suman anchura', () => {
    expect(layoutText('a a', box, { size: 100 }).width).toBeCloseTo(180, 3);
    expect(layoutText('ab', box, { size: 100, letterSpacing: 10 }).width).toBeCloseTo(150, 3);
  });
});

describe('transformaciones de texto (ECMA-376)', () => {
  it('las 40 se evalúan sin NaN y dan curvas', () => {
    expect(warpNames()).toHaveLength(40);
    for (const n of warpNames()) {
      const g = warpGeometry(n, 400, 200)!;
      expect(g, n).not.toBeNull();
      expect(g.curves.length, n).toBeGreaterThanOrEqual(1);
      for (const c of g.curves) {
        expect(c.pts.length, n).toBeGreaterThan(1);
        for (const p of c.pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y), n).toBe(true);
      }
    }
    expect(hasWarp('textWave1')).toBe(true);
    expect(hasWarp('inventada')).toBe(false);
    expect(warpGeometry('inventada', 10, 10)).toBeNull();
  });
  it('conoce los ajustes por omisión', () => {
    expect(warpDefaults('textArchUp').adj).toBe(10800000);
    expect(warpDefaults('textWave1')).toEqual({ adj1: 12500, adj2: 0 });
  });
  it('clasifica trayectoria y envolvente', () => {
    expect(warpGeometry('textArchUp', 400, 200)!.mode).toBe('path');
    expect(warpGeometry('textCircle', 400, 200)!.mode).toBe('path');
    expect(warpGeometry('textWave1', 400, 200)!.mode).toBe('envelope');
    expect(warpGeometry('textPlain', 400, 200)!.mode).toBe('envelope');
  });
  it('textPlain estira el texto a toda la forma', () => {
    const b = layoutText('abc', box, { size: 100 });
    const out = warpText(b, 'textPlain', 600, 300)!;
    const r = bounds(out);
    // el contenido de la caja (con sus márgenes) llena 600 x 300
    expect(r.x1).toBeGreaterThanOrEqual(-1e-6);
    expect(r.x2).toBeLessThanOrEqual(600 + 1e-6);
    expect(r.y1).toBeGreaterThanOrEqual(-1e-6);
    expect(r.y2).toBeLessThanOrEqual(300 + 1e-6);
    expect(r.x2 - r.x1).toBeGreaterThan(450);
  });
  it('arco hacia arriba: las letras siguen el arco y el centro queda arriba', () => {
    const b = layoutText('HOLA MUNDO', box, { size: 60 });
    const out = warpText(b, 'textArchUp', 400, 400)!;
    const r = bounds(out);
    // el arco sube en el centro y baja en los extremos
    const left = out[0]!;
    const mid = out[Math.floor(out.length / 2)]!;
    const cy = (c: Contour) => c.reduce((s, p) => s + p.y, 0) / c.length;
    expect(cy(mid)).toBeLessThan(cy(left));
    expect(Number.isFinite(r.x1 + r.x2 + r.y1 + r.y2)).toBe(true);
  });
  it('círculo: el texto da toda la vuelta alrededor del centro', () => {
    const b = layoutText('CIRCULO DE TEXTO', box, { size: 40 });
    const out = warpText(b, 'textCircle', 400, 400)!;
    const pts = out.flat();
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    expect(Math.abs(cx - 200)).toBeLessThan(40);
    expect(Math.abs(cy - 200)).toBeLessThan(40);
    const r = bounds(out);
    expect(r.x2 - r.x1).toBeGreaterThan(300);
    expect(r.y2 - r.y1).toBeGreaterThan(300);
  });
  it('onda: el borde superior del texto sube y baja', () => {
    const b = layoutText('ONDA ONDA ONDA', box, { size: 50 });
    const out = warpText(b, 'textWave1', 600, 200)!;
    const tops = out.map((c) => Math.min(...c.map((p) => p.y)));
    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(10);
  });
  it('todas deforman un texto sin producir valores no finitos', () => {
    const b = layoutText('Ejemplo 123', box, { size: 48 });
    for (const n of warpNames()) {
      const out = warpText(b, n, 500, 250)!;
      expect(out, n).not.toBeNull();
      expect(out.length, n).toBeGreaterThan(0);
      for (const c of out) for (const p of c) expect(Number.isFinite(p.x) && Number.isFinite(p.y), n).toBe(true);
    }
  });
  it('los ajustes cambian el resultado', () => {
    const b = layoutText('ONDA', box, { size: 50 });
    const a = bounds(warpText(b, 'textWave1', 600, 200)!);
    const c = bounds(warpText(b, 'textWave1', 600, 200, { adj1: 40000 })!);
    expect(c.y1).not.toBeCloseTo(a.y1, 1);
  });

  it('las asas de ajuste: todas las transformaciones tienen y arrastrar un asa hasta donde ya está no la mueve', () => {
    const W = 300;
    const H = 120;
    let withHandles = 0;
    for (const n of warpNames()) {
      const hs = warpAdjustHandles(n, W, H);
      if (hs.length) withHandles++;
      hs.forEach((h, i) => {
        const adj = dragWarpAdjust(n, W, H, {}, i, h.x, h.y) ?? {};
        const again = warpAdjustHandles(n, W, H, { ...warpDefaults(n), ...adj })[i]!;
        expect(Math.hypot(again.x - h.x, again.y - h.y), n + ' asa ' + i).toBeLessThan(2.5);
      });
    }
    expect(withHandles).toBe(40);
  });

  it('arrastrar el asa de una onda cambia su ajuste y mueve el asa hasta donde se soltó', () => {
    const [h0] = warpAdjustHandles('textWave1', 300, 120);
    const target = { x: h0!.x, y: h0!.y - 8 };
    const adj = dragWarpAdjust('textWave1', 300, 120, {}, 0, target.x, target.y);
    expect(adj).toBeDefined();
    const [h1] = warpAdjustHandles('textWave1', 300, 120, adj!);
    expect(h1!.y).toBeLessThan(h0!.y);
    expect(Math.abs(h1!.y - target.y)).toBeLessThan(2.5);
  });

  it('un arco: el asa polar gira y el ajuste vuelve a ser el de por omisión al devolverla', () => {
    const [h0] = warpAdjustHandles('textArchUp', 300, 120);
    const moved = dragWarpAdjust('textArchUp', 300, 120, {}, 0, 270, 100);
    expect(moved?.adj).toBeDefined();
    expect(dragWarpAdjust('textArchUp', 300, 120, moved!, 0, h0!.x, h0!.y)).toBeUndefined();
  });
});
