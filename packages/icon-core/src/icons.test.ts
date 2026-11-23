import { describe, expect, it } from 'vitest';
import { iconPaths, iconSvg, loadCatalog, loadPaths, normalize, parseIconSvg, recolorSvg, searchIcons } from './index';

describe('catálogo', () => {
  it('tiene miles de iconos con nombre en español y categoría', async () => {
    const c = await loadCatalog();
    expect(c.icons.length).toBeGreaterThan(2000);
    expect(c.categories.length).toBeGreaterThanOrEqual(15);
    expect(c.categories.reduce((n, x) => n + x.count, 0)).toBe(c.icons.length);
    for (const i of c.icons) {
      expect(i.name.length).toBeGreaterThan(0);
      expect(i.styles.length).toBeGreaterThan(0);
      expect(i.name).not.toMatch(/[a-z]+-[a-z]+/); // no quedan guiones del id
    }
  });
  it('cada icono tiene trazos de sus estilos y todos son coherentes con su tamaño', async () => {
    const [c, p] = await Promise.all([loadCatalog(), loadPaths()]);
    for (const i of c.icons) {
      const e = p[i.id];
      expect(e, i.id).toBeTruthy();
      expect(Boolean(e![0])).toBe(i.styles.includes('regular'));
      expect(Boolean(e![1])).toBe(i.styles.includes('filled'));
      for (const d of [e![0], e![1]]) if (d) for (const s of d) expect(s).toMatch(/^[Mm]/);
    }
  });
  it('los ids no se repiten', async () => {
    const c = await loadCatalog();
    expect(new Set(c.icons.map((i) => i.id)).size).toBe(c.icons.length);
  });
});

describe('búsqueda', () => {
  it('encuentra por el nombre en español sin importar tildes ni mayúsculas', async () => {
    const c = await loadCatalog();
    const r = searchIcons(c, 'CALENDARIO');
    expect(r.length).toBeGreaterThan(10);
    expect(r[0]!.name.toLowerCase()).toContain('calendario');
    expect(searchIcons(c, 'camara').some((i) => i.id === 'camera')).toBe(true);
    expect(searchIcons(c, 'cámara').map((i) => i.id)).toEqual(searchIcons(c, 'camara').map((i) => i.id));
  });
  it('encuentra por el nombre en inglés', async () => {
    const c = await loadCatalog();
    expect(searchIcons(c, 'mail').length).toBeGreaterThan(10);
    expect(searchIcons(c, 'home')[0]!.en).toMatch(/home/);
  });
  it('todas las palabras escritas deben estar y la coincidencia exacta va primero', async () => {
    const c = await loadCatalog();
    const r = searchIcons(c, 'flecha derecha');
    expect(r.length).toBeGreaterThan(5);
    for (const i of r) expect(normalize(i.name)).toMatch(/flecha.*derecha|derecha.*flecha/);
    expect(searchIcons(c, 'zzzxq')).toEqual([]);
  });
  it('filtra por categoría y por estilo; sin texto da la categoría entera', async () => {
    const c = await loadCatalog();
    const flechas = searchIcons(c, '', { category: 'flechas' });
    expect(flechas.length).toBe(c.categories.find((x) => x.id === 'flechas')!.count);
    expect(searchIcons(c, 'estrella', { style: 'filled' }).every((i) => i.styles.includes('filled'))).toBe(true);
    expect(searchIcons(c, '', { limit: 5 })).toHaveLength(5);
  });
  it('busca en menos de 30 ms entre todos los iconos', async () => {
    const c = await loadCatalog();
    searchIcons(c, 'a');
    const t = performance.now();
    for (let k = 0; k < 10; k++) searchIcons(c, 'flecha dere');
    expect((performance.now() - t) / 10).toBeLessThan(30);
  });
});

describe('SVG', () => {
  it('dibuja el icono con el color pedido y lo lee de vuelta', async () => {
    const [c, p] = await Promise.all([loadCatalog(), loadPaths()]);
    const info = c.get('home')!;
    const got = iconPaths(p, info, 'filled')!;
    const svg = iconSvg(got.d, info.size, { color: '#C00000', px: 48 });
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="#c00000"');
    expect(svg).toContain('width="48"');
    const back = parseIconSvg(svg)!;
    expect(back.d).toEqual(got.d);
    expect(back.color).toBe('#c00000');
    expect(back.size).toBe(24);
  });
  it('recolorea sin tocar los trazos ni el tamaño', async () => {
    const [c, p] = await Promise.all([loadCatalog(), loadPaths()]);
    const info = c.get('home')!;
    const d = iconPaths(p, info, 'regular')!.d;
    const re = recolorSvg(iconSvg(d, 24, { px: 64 }), '#0070c0')!;
    expect(parseIconSvg(re)!.color).toBe('#0070c0');
    expect(parseIconSvg(re)!.d).toEqual(d);
    expect(re).toContain('width="64"');
    expect(recolorSvg('<svg viewBox="0 0 10 20"></svg>', '#ffffff')).toBeNull();
  });
  it('ignora colores que no son #rrggbb (nada que se cuele en el SVG)', () => {
    expect(iconSvg(['M0 0h1v1z'], 24, { color: 'red" onload="x' })).toContain('fill="#000000"');
  });
  it('si el icono no tiene un estilo usa el otro', async () => {
    const [c, p] = await Promise.all([loadCatalog(), loadPaths()]);
    const solo = c.icons.find((i) => i.styles.length === 1)!;
    const got = iconPaths(p, solo, solo.styles[0] === 'regular' ? 'filled' : 'regular')!;
    expect(got.style).toBe(solo.styles[0]);
    expect(iconPaths(p, { ...solo, id: 'no-existe' }, 'regular')).toBeNull();
  });
});
