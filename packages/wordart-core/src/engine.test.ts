import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WORDART_STYLES, contoursToPath, fontFromBytes, layoutText, warpNames, warpText, wordArtStyle, wordArtSvg, boundsOf, warpName, type Contour, type FontLike } from './index';

const box: FontLike = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  glyph: (ch) => (ch === ' ' ? { advance: 400, path: [] } : { advance: 700, path: [['M', 50, 0], ['L', 550, 0], ['L', 550, -700], ['L', 50, -700], ['Z']] }),
  kern: () => 0,
};

/** Área con signo (shoelace): cambia de signo si el dibujo sale reflejado. */
const area = (c: Contour) => c.reduce((s, p, i) => s + (p.x * c[(i + 1) % c.length]!.y - c[(i + 1) % c.length]!.x * p.y), 0) / 2;

describe('orientación', () => {
  it('ninguna transformación refleja el texto', () => {
    const b = layoutText('HOLA', box, { size: 60 });
    const sign = Math.sign(area(b.contours[0]!));
    for (const n of warpNames()) {
      const out = warpText(b, n, 500, 250)!;
      // se mira una letra del medio, donde la deformación es suave
      const a = area(out[1]!);
      if (Math.abs(a) < 1e-6) continue;
      expect(Math.sign(a), n).toBe(sign);
    }
  });
  it('arco hacia arriba, círculo y botón dejan el texto dentro de la forma', () => {
    const b = layoutText('ARCO DE TEXTO', box, { size: 50 });
    for (const n of ['textArchUp', 'textCircle', 'textButton']) {
      const r = boundsOf(warpText(b, n, 500, 300)!);
      expect(r.y, n).toBeGreaterThanOrEqual(-5);
      expect(r.y + r.height, n).toBeLessThanOrEqual(305);
      expect(r.x, n).toBeGreaterThanOrEqual(-5);
      expect(r.x + r.width, n).toBeLessThanOrEqual(505);
    }
  });
});

describe('dibujo SVG', () => {
  const b = layoutText('Hi', box, { size: 60 });
  const cs = warpText(b, 'textWave1', 300, 120)!;
  it('el trazado cierra cada contorno', () => {
    const d = contoursToPath(cs);
    expect(d.startsWith('M')).toBe(true);
    expect((d.match(/Z/g) ?? []).length).toBe(cs.length);
    expect(contoursToPath([])).toBe('');
  });
  it('relleno sólido, degradado, contorno, sombra, resplandor y reflejo', () => {
    const solid = wordArtSvg(cs, wordArtStyle('accent1').fx, 'a');
    expect(solid).toContain('fill="#4472c4"');
    expect(solid).not.toContain('<defs>');
    const grad = wordArtSvg(cs, wordArtStyle('gr3').fx, 'b');
    expect(grad).toContain('<linearGradient id="b-g"');
    expect(grad).toContain('fill="url(#b-g)"');
    const out = wordArtSvg(cs, wordArtStyle('out1').fx, 'c');
    expect(out).toContain('fill="none"');
    expect(out).toContain('stroke="#4472c4"');
    const sh = wordArtSvg(cs, wordArtStyle('sh1').fx, 'd');
    expect(sh).toContain('feGaussianBlur');
    expect(sh).toContain('translate(2.1 2.1)');
    expect(wordArtSvg(cs, wordArtStyle('gl1').fx, 'e')).toContain('d-glow'.replace('d', 'e'));
    const rf = wordArtSvg(cs, wordArtStyle('rf1').fx, 'f');
    expect(rf).toContain('<mask id="f-rm"');
    expect(rf).toContain('scale(1 -1)');
    expect(wordArtSvg([], wordArtStyle('tx1').fx, 'g')).toBe('');
  });
  it('los identificadores de dos dibujos no chocan', () => {
    expect(wordArtSvg(cs, wordArtStyle('gr3').fx, 'x1')).not.toContain('"x2-g"');
  });
});

describe('catálogo', () => {
  it('hay 22 estilos con identificadores únicos y las 40 transformaciones tienen nombre en español', () => {
    expect(WORDART_STYLES).toHaveLength(22);
    expect(new Set(WORDART_STYLES.map((s) => s.id)).size).toBe(22);
    expect(wordArtStyle('no-existe').id).toBe('tx1');
    for (const n of warpNames()) expect(warpName(n), n).not.toBe(n);
  });
});

// Con una fuente real del equipo, si la hay (en otros equipos la prueba se salta).
const CALIBRI = 'C:/Windows/Fonts/calibrib.ttf';
describe.skipIf(!fs.existsSync(CALIBRI))('fuente real (Calibri Negrita)', () => {
  it('se lee con opentype.js, se compone y se deforma', () => {
    const font = fontFromBytes(fs.readFileSync(CALIBRI));
    expect(font.unitsPerEm).toBeGreaterThan(0);
    expect(font.ascender).toBeGreaterThan(0);
    expect(font.glyph('W').advance).toBeGreaterThan(font.glyph('i').advance);
    expect(font.glyph('W').path.length).toBeGreaterThan(4);
    const b = layoutText('WordArt', font, { size: 80 });
    expect(b.width).toBeGreaterThan(200);
    expect(b.contours.length).toBeGreaterThanOrEqual(7);
    for (const n of ['textPlain', 'textArchUp', 'textWave1', 'textCircle']) {
      const out = warpText(b, n, 400, 160)!;
      expect(out.length, n).toBeGreaterThan(0);
      for (const c of out) for (const p of c) expect(Number.isFinite(p.x) && Number.isFinite(p.y), n).toBe(true);
    }
  });
});
