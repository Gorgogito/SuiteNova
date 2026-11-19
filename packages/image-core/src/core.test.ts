import { describe, expect, it } from 'vitest';
import {
  ARTISTIC, ARTISTIC_EFFECTS, ASPECT_RATIOS, COMPRESS_TARGETS, NO_CROP, PICTURE_STYLES, applyArtistic, applyBaked, applyNative, applyPixelEdits, applyStyle, blackAndWhite, brightnessContrast, changesPixels, clampCrop, cropFromRect,
  cropPixels, cropToAspect, duotone, fillCrop, fitSize, frameForCrop, grayScale, normalizeEdits, parseEdits, pixelKey, planCompress, recolor, recolorPresets, removeBackground, resample, saturation, serializeEdits,
  sharpness, splitNative, temperature, transparency, visibleRect, type Pixels, type PixelEdits,
} from './index';

const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { data, w, h };
};
const px = (p: Pixels, x: number, y: number) => [...p.data.slice((y * p.w + x) * 4, (y * p.w + x) * 4 + 4)];
const flat = (c: [number, number, number, number], w = 8, h = 8) => img(w, h, () => c);
const same = (a: Pixels, b: Pixels) => a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);
/** A picture with a gradient and an edge, to see what the filters do. */
const scene = () => img(32, 32, (x, y) => (x < 16 ? [200, 120, 60, 255] : [40, 90, 200, 255]).map((v) => (y < 16 ? v : v * 0.6)) as [number, number, number, number]);

describe('correcciones', () => {
  it('con valores neutros la imagen no cambia', () => {
    const p = scene();
    expect(same(brightnessContrast(p, 0, 0), p)).toBe(true);
    expect(same(saturation(p, 100), p)).toBe(true);
    expect(same(temperature(p, 6500), p)).toBe(true);
    expect(same(sharpness(p, 0), p)).toBe(true);
    expect(same(transparency(p, 0), p)).toBe(true);
  });

  it('brillo y contraste: el brillo suma, el contraste aleja del gris medio', () => {
    expect(px(brightnessContrast(flat([100, 100, 100, 255]), 20, 0), 0, 0)).toEqual([151, 151, 151, 255]);
    const hard = brightnessContrast(flat([200, 100, 128, 255]), 0, 50);
    expect(px(hard, 0, 0)[0]).toBeGreaterThan(200);
    expect(px(hard, 0, 0)[1]).toBeLessThan(100);
    // −100 flattens everything to the middle grey
    expect(px(brightnessContrast(flat([10, 250, 90, 255]), 0, -100), 0, 0).slice(0, 3)).toEqual([128, 128, 128]);
  });

  it('saturación: 0 % es gris y 200 % aleja los colores del gris', () => {
    const g = saturation(flat([200, 100, 50, 255]), 0);
    expect(px(g, 0, 0)[0]).toBe(px(g, 0, 0)[1]);
    expect(px(g, 0, 0)[1]).toBe(px(g, 0, 0)[2]);
    const more = px(saturation(flat([200, 100, 50, 255]), 200), 0, 0);
    expect(more[0]! - more[2]!).toBeGreaterThan(150);
  });

  it('temperatura: más alta es más cálida (más rojo, menos azul), más baja más fría', () => {
    const warm = px(temperature(flat([100, 100, 100, 255]), 9000), 0, 0);
    const cool = px(temperature(flat([100, 100, 100, 255]), 4000), 0, 0);
    expect(warm[0]!).toBeGreaterThan(100);
    expect(warm[2]!).toBeLessThan(100);
    expect(cool[0]!).toBeLessThan(100);
    expect(cool[2]!).toBeGreaterThan(100);
  });

  it('nitidez: positiva aumenta el contraste del borde, negativa lo suaviza', () => {
    const edge = img(20, 20, (x) => (x < 10 ? [80, 80, 80, 255] : [170, 170, 170, 255]));
    const sharp = sharpness(edge, 100);
    const soft = sharpness(edge, -100);
    expect(px(sharp, 9, 10)[0]!).toBeLessThan(80);
    expect(px(sharp, 10, 10)[0]!).toBeGreaterThan(170);
    expect(px(soft, 9, 10)[0]!).toBeGreaterThan(80);
    expect(px(soft, 10, 10)[0]!).toBeLessThan(170);
  });

  it('transparencia: deja pasar ese porcentaje y respeta la que ya tenía', () => {
    expect(px(transparency(flat([10, 20, 30, 255]), 25), 0, 0)[3]).toBe(191);
    expect(px(transparency(flat([10, 20, 30, 128]), 50), 0, 0)[3]).toBe(64);
  });

  it('no cambia la imagen original (trabaja sobre copias)', () => {
    const p = scene();
    const before = new Uint8ClampedArray(p.data);
    brightnessContrast(p, 30, 30);
    saturation(p, 0);
    sharpness(p, 80);
    expect([...p.data]).toEqual([...before]);
  });
});

describe('recolorear', () => {
  it('escala de grises, blanco y negro con umbral, duotono y sepia', () => {
    const g = grayScale(flat([200, 100, 50, 255]));
    expect(px(g, 0, 0)[0]).toBe(px(g, 0, 0)[2]);
    const bw = blackAndWhite(img(2, 1, (x) => (x === 0 ? [60, 60, 60, 255] : [200, 200, 200, 255])), 50);
    expect([px(bw, 0, 0)[0], px(bw, 1, 0)[0]]).toEqual([0, 255]);
    const d = duotone(img(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255])), '#102030', '#f0e0d0');
    expect(px(d, 0, 0).slice(0, 3)).toEqual([16, 32, 48]);
    expect(px(d, 1, 0).slice(0, 3)).toEqual([240, 224, 208]);
    const sepia = px(recolor(flat([128, 128, 128, 255]), { kind: 'sepia' }), 0, 0);
    expect(sepia[0]!).toBeGreaterThan(sepia[2]!);
  });

  it('la galería tiene «sin recolorear» primero, y el descolorido es brillo y contraste', () => {
    const ps = recolorPresets('#ff0000');
    expect(ps[0]).toMatchObject({ id: 'none', recolor: null });
    expect(ps.map((x) => x.id)).toContain('washout');
    // washout is not a colour map: it changes nothing by itself
    expect(same(recolor(scene(), { kind: 'washout' }), scene())).toBe(true);
    const washed = applyPixelEdits(flat([30, 30, 30, 255]), { recolor: { kind: 'washout' } });
    expect(px(washed, 0, 0)[0]!).toBeGreaterThan(150);
  });
});

describe('efectos artísticos', () => {
  it('a la intensidad de siempre (50) dan lo de ARTISTIC, y más intensidad cambia más', () => {
    const p = scene();
    for (const fx of ARTISTIC) expect(same(applyArtistic(p, fx.id, 50), fx.run(p))).toBe(true);
    const diff = (a: Pixels, b: Pixels) => a.data.reduce((s, v, i) => s + Math.abs(v - b.data[i]!), 0);
    const big = img(120, 120, (x, y) => ((x >> 3) % 2 ? [220, 40, 40, 255] : [30, 30, 220, 255]).map((v) => v - (y % 7)) as [number, number, number, number]);
    expect(diff(applyArtistic(big, 'blur', 100), big)).toBeGreaterThan(diff(applyArtistic(big, 'blur', 20), big));
    expect(ARTISTIC_EFFECTS.map((e) => e.id)).toEqual(ARTISTIC.map((e) => e.id));
  });

  it('un efecto que no existe deja la imagen como está', () => {
    const p = scene();
    expect(applyArtistic(p, 'no-existe')).toBe(p);
  });
});

describe('quitar fondo con áreas marcadas', () => {
  // white background, a red square in the middle with a white dot in it, and a grey island in the corner area that is not connected to the border
  const photo = () =>
    img(40, 40, (x, y) => {
      if (x >= 12 && x < 28 && y >= 12 && y < 28) return x === 20 && y === 20 ? [255, 255, 255, 255] : [200, 30, 30, 255];
      return [255, 255, 255, 255];
    });

  it('sin marcas quita lo de fuera y respeta el punto blanco de dentro', () => {
    const r = removeBackground(photo(), 30);
    expect(px(r.pixels, 2, 2)[3]).toBe(0);
    expect(px(r.pixels, 20, 20)[3]).toBe(255);
  });

  it('«conservar» protege una zona del fondo; «quitar» elimina una zona que no toca el borde', () => {
    const marked = removeBackground(photo(), 30, null, { keep: [{ x: 5, y: 5 }] });
    // the whole white background is one region: keeping a point of it keeps all of it
    expect(px(marked.pixels, 2, 2)[3]).toBe(255);
    const gone = removeBackground(photo(), 30, null, { remove: [{ x: 15, y: 15 }] });
    expect(px(gone.pixels, 15, 15)[3]).toBe(0);
    expect(px(gone.pixels, 2, 2)[3]).toBe(0);
  });
});

describe('recorte', () => {
  it('lo que se ve, desde el recorte, y el recorte desde lo que se ve', () => {
    const c = { l: 10000, t: 20000, r: 30000, b: 0 };
    const v = visibleRect(200, 100, c);
    expect(v).toEqual({ x: 20, y: 20, w: 120, h: 80 });
    expect(cropFromRect(200, 100, v)).toEqual(c);
  });

  it('un recorte siempre deja al menos el 1 % y nunca es negativo', () => {
    const c = clampCrop({ l: 70000, t: -5, r: 70000, b: 0 });
    expect(c.t).toBe(0);
    expect(100000 - c.l - c.r).toBeGreaterThanOrEqual(999);
  });

  it('relación de aspecto: el mayor rectángulo de esa proporción, centrado', () => {
    const c = cropToAspect(400, 300, NO_CROP, 1);
    const v = visibleRect(400, 300, c);
    expect(Math.round(v.w)).toBe(300);
    expect(Math.round(v.h)).toBe(300);
    expect(Math.round(v.x)).toBe(50);
    expect(ASPECT_RATIOS.some((a) => a.id === '16:9')).toBe(true);
  });

  it('relleno recorta lo que sobra y ajustar entra entero', () => {
    const v = visibleRect(400, 300, fillCrop(400, 300, 200, 100));
    expect(Math.round(v.w / v.h * 100)).toBe(200);
    const fit = fitSize(400, 300, 200, 100);
    expect(fit.w).toBeCloseTo(133.333, 2);
    expect(fit.h).toBe(100);
  });

  it('al recortar, el marco sigue lo que se ve y la imagen no se mueve', () => {
    const f = frameForCrop(100, 100, NO_CROP, { l: 20000, t: 0, r: 0, b: 50000 });
    expect(f).toMatchObject({ w: 80, h: 50, dx: 20, dy: 0 });
  });

  it('cropPixels toma el trozo pedido', () => {
    const p = img(10, 10, (x, y) => [x, y, 0, 255]);
    const c = cropPixels(p, { x: 2, y: 3, w: 4, h: 2 });
    expect([c.w, c.h]).toEqual([4, 2]);
    expect(px(c, 0, 0).slice(0, 2)).toEqual([2, 3]);
  });
});

describe('comprimir', () => {
  it('reduce al número de píxeles por pulgada pedido y nunca agranda', () => {
    const plan = planCompress({ w: 3000, h: 2000 }, NO_CROP, { w: 5, h: 3.3333 }, 150, false);
    expect(plan.skip).toBe(false);
    expect(plan.size.w).toBe(750);
    expect(planCompress({ w: 300, h: 200 }, NO_CROP, { w: 5, h: 3.33 }, 150, false).skip).toBe(true);
    expect(COMPRESS_TARGETS.map((t) => t.ppi)).toEqual([330, 220, 150, 96]);
  });

  it('borrar lo recortado deja solo lo que se ve y quita el recorte', () => {
    const plan = planCompress({ w: 1000, h: 1000 }, { l: 25000, t: 0, r: 25000, b: 0 }, { w: 10, h: 10 }, 96, true);
    expect(plan.keep).toEqual({ x: 250, y: 0, w: 500, h: 1000 });
    expect(plan.crop).toEqual({ l: 0, t: 0, r: 0, b: 0 });
    expect(plan.skip).toBe(false);
  });

  it('remuestrear: al achicar promedia, al agrandar mezcla, y no cuenta los píxeles transparentes', () => {
    const half = resample(img(4, 4, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])), 2, 2);
    expect(px(half, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(half, 1, 0)).toEqual([255, 255, 255, 255]);
    const mixed = resample(img(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 0])), 1, 1);
    expect(px(mixed, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
    const big = resample(img(2, 1, (x) => (x === 0 ? [0, 0, 0, 255] : [200, 200, 200, 255])), 4, 1);
    expect(px(big, 1, 0)[0]!).toBeGreaterThan(0);
    expect(px(big, 1, 0)[0]!).toBeLessThan(200);
  });
});

describe('las ediciones de una imagen', () => {
  const all: PixelEdits = {
    background: { tolerance: 40, keep: [{ x: 1, y: 1 }] },
    artistic: { id: 'mosaic', level: 40 },
    sharpness: 30,
    saturation: 150,
    temperature: 8000,
    brightness: 10,
    contrast: 20,
    recolor: { kind: 'sepia' },
    transparency: 15,
  };

  it('lo neutro se descarta y nada que hacer es «sin ediciones»', () => {
    expect(normalizeEdits({ pixels: { brightness: 0, saturation: 100, temperature: 6500, sharpness: 0 }, frame: { shape: 'rect' } })).toBeUndefined();
    expect(changesPixels({ contrast: 0 })).toBe(false);
    expect(pixelKey({ saturation: 100 })).toBe('');
    expect(pixelKey({ contrast: 10 })).not.toBe('');
  });

  it('sin ediciones, la misma imagen; con ellas, siempre el mismo resultado', () => {
    const p = scene();
    expect(applyPixelEdits(p, undefined)).toBe(p);
    expect(same(applyPixelEdits(p, all), applyPixelEdits(p, all))).toBe(true);
    expect(same(applyPixelEdits(p, all), p)).toBe(false);
  });

  it('lo que Office hace por sí mismo son los últimos pasos: hecho lo demás, aplicar lo nativo da lo mismo', () => {
    const p = scene();
    const { native, baked } = splitNative(all);
    expect(baked).toEqual({ background: all.background, artistic: all.artistic, sharpness: 30, saturation: 150, temperature: 8000 });
    expect(native).toMatchObject({ lum: { bright: 10, contrast: 20 }, duotone: { dark: '#3a2410' }, transparency: 15 });
    expect(same(applyNative(applyBaked(p, baked), native), applyPixelEdits(p, all))).toBe(true);
  });

  it('el descolorido se suma al brillo y contraste y sale como lum nativo', () => {
    const { native, baked } = splitNative({ brightness: 10, recolor: { kind: 'washout' } });
    expect(native.lum).toEqual({ bright: 80, contrast: -70 });
    expect(baked).toBeUndefined();
    expect(splitNative({ recolor: { kind: 'gray' } }).native).toEqual({ gray: true });
    expect(splitNative({ recolor: { kind: 'bw', threshold: 40 } }).native).toEqual({ biLevel: 40 });
  });

  it('se guardan como texto y se leen igual; lo dañado o fuera de rango se descarta o se corrige', () => {
    const e = { pixels: all, frame: { crop: { l: 1000, t: 2000, r: 3000, b: 4000 }, shape: 'ellipse', border: { color: '#ff0000', width: 2, dash: 'dash' as const }, fx: { shadow: { color: '#000000', blur: 4, dist: 3, angle: 45, alpha: 0.5 }, softEdge: 5 } } };
    expect(parseEdits(serializeEdits(e))).toEqual(normalizeEdits(e));
    expect(parseEdits('no es json')).toBeNull();
    const dirty = parseEdits(JSON.stringify({ v: 1, pixels: { brightness: 500, saturation: 'x', recolor: { kind: 'duotone', dark: 'rojo', light: '#ffffff' } }, frame: { crop: { l: 1, t: 2 }, border: { color: 'azul', width: 3 } } }));
    expect(dirty).toEqual({ pixels: { brightness: 100 } });
  });

  it('los estilos de imagen reemplazan forma, borde y efectos y conservan el recorte', () => {
    const rounded = PICTURE_STYLES.find((s) => s.id === 'rounded-white')!;
    const f = applyStyle({ crop: { l: 5000, t: 0, r: 0, b: 0 }, border: { color: '#000000', width: 9 }, shape: 'ellipse' }, rounded);
    expect(f.crop).toEqual({ l: 5000, t: 0, r: 0, b: 0 });
    expect(f.shape).toBe('roundRect');
    expect(f.border?.width).toBe(6);
    expect(applyStyle({ shape: 'ellipse' }, PICTURE_STYLES[0]!)).toEqual({});
  });
});
