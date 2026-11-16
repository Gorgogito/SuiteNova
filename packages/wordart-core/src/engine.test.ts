import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LocalFontSource, WORDART_STYLES, contoursToPath, fontFromBytes, layoutText, warpNames, warpText, wordArtStyle, wordArtSvg, boundsOf, warpName, type Contour, type FontLike } from './index';

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

import { emuToPx, parseCssColor, placeText, prstTxWarpXml, w14Fx } from './index';

describe('colocar texto sin deformar', () => {
  it('centra en vertical y alinea en horizontal', () => {
    const b = layoutText('ab', box, { size: 100 });
    const c = boundsOf(placeText(b, 400, 300, 'center'));
    const l = boundsOf(placeText(b, 400, 300, 'left'));
    const r = boundsOf(placeText(b, 400, 300, 'right'));
    expect(l.x).toBeLessThan(c.x);
    expect(c.x).toBeLessThan(r.x);
    expect(r.x + r.width).toBeLessThanOrEqual(400);
    expect(c.y + c.height / 2).toBeGreaterThan(100);
    expect(c.y + c.height / 2).toBeLessThan(200);
  });
});

describe('marcado de Word (w14)', () => {
  it('lee colores css con opacidad', () => {
    expect(parseCssColor('#4472c4')).toEqual({ hex: '4472C4', alpha: 1 });
    expect(parseCssColor('#f0a')).toEqual({ hex: 'FF00AA', alpha: 1 });
    expect(parseCssColor('rgba(255, 0, 0, 0.5)')).toEqual({ hex: 'FF0000', alpha: 0.5 });
    expect(parseCssColor('rgb(0 128 255)').hex).toBe('0080FF');
  });
  it('escribe relleno, contorno, sombra, resplandor y reflejo en el orden del esquema', () => {
    const x = w14Fx({
      fill: { type: 'gradient', angle: 90, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#4472c4' }] },
      outline: { color: '#203864', width: 1 },
      shadow: { color: '#000000', alpha: 0.4, blur: 4, dx: 3, dy: 3 },
      glow: { color: '#4472c4', alpha: 0.6, radius: 9 },
      reflection: { alpha: 0.5, size: 0.35, gap: 0 },
    });
    const order = ['<w14:glow', '<w14:shadow', '<w14:reflection', '<w14:textOutline', '<w14:textFill'].map((t) => x.indexOf(t));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(x).toContain('w14:w="9525"');
    expect(x).toContain('<w14:lin w14:ang="5400000"');
    expect(x).toContain('w14:dir="2700000"');
    expect(x).toContain('<w14:alpha w14:val="40000"/>');
    expect(w14Fx({ fill: { type: 'solid', color: '#ff0000' } })).toBe('<w14:textFill><w14:solidFill><w14:srgbClr w14:val="FF0000"/></w14:solidFill></w14:textFill>');
    expect(w14Fx({ fill: { type: 'none' } })).toContain('<w14:noFill/>');
  });
  it('la transformación se escribe como prstTxWarp con sus ajustes', () => {
    expect(prstTxWarpXml('textWave1')).toBe('<a:prstTxWarp prst="textWave1"><a:avLst/></a:prstTxWarp>');
    expect(prstTxWarpXml('textWave1', { adj1: 30000 })).toContain('<a:gd name="adj1" fmla="val 30000"/>');
    expect(emuToPx(9525)).toBe(1);
  });
  it('LocalFontSource usa el proveedor dado (la app de escritorio) y elige negrita y cursiva', async () => {
    const bytes = fs.existsSync('C:/Windows/Fonts/calibri.ttf') ? fs.readFileSync('C:/Windows/Fonts/calibri.ttf') : null;
    const asked: string[] = [];
    const src = new LocalFontSource(async () => [
      { family: 'Calibri', style: 'Regular', fullName: 'Calibri', blob: async () => { asked.push('Regular'); return new Blob([bytes ?? new Uint8Array(4)]); } },
      { family: 'Calibri', style: 'Bold', fullName: 'Calibri Bold', blob: async () => { asked.push('Bold'); return new Blob([bytes ?? new Uint8Array(4)]); } },
    ]);
    expect(await src.load('Inexistente', false, false)).toBeNull();
    const f = await src.load('calibri', true, false);
    expect(asked).toEqual(['Bold']);
    if (bytes) expect(f?.glyph('A').path.length).toBeGreaterThan(3);
    else expect(f).toBeNull();
    expect(await new LocalFontSource(async () => { throw new Error('x'); }).load('Calibri', false, false)).toBeNull();
  });
});
