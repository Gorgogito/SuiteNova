import { describe, expect, it } from 'vitest';
import { iconPaths, iconSvg, loadCatalog, loadPaths, normalize, parseIconSvg, recolorSvg, restyleSvg, searchIcons, svgPathToCmds, svgToFreeform, FREEFORM_SCALE } from './index';

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
  it('relleno, transparencia y contorno: se escriben, se leen de vuelta y se cambian sin tocar el resto', async () => {
    const [c, p] = await Promise.all([loadCatalog(), loadPaths()]);
    const d = iconPaths(p, c.get('home')!, 'filled')!.d;
    const svg = iconSvg(d, 24, { fill: '#00b050', opacity: 0.5, stroke: { color: '#002060', width: 1.5 }, px: 40 });
    const a = parseIconSvg(svg)!;
    expect(a.fill).toBe('#00b050');
    expect(a.opacity).toBe(0.5);
    expect(a.stroke).toEqual({ color: '#002060', width: 1.5 });
    expect(a.d).toEqual(d);
    const noFill = restyleSvg(svg, { fill: null })!;
    expect(parseIconSvg(noFill)!.fill).toBeNull();
    expect(parseIconSvg(noFill)!.stroke).toEqual({ color: '#002060', width: 1.5 });
    expect(noFill).toContain('width="40"');
    const noStroke = restyleSvg(svg, { stroke: null })!;
    expect(parseIconSvg(noStroke)!.stroke).toBeNull();
    expect(parseIconSvg(noStroke)!.fill).toBe('#00b050');
    expect(parseIconSvg(noStroke)!.opacity).toBe(0.5);
    // sin tocar nada, igual
    expect(restyleSvg(svg, {})).toBe(svg);
    // un contorno con un color raro o ancho 0 no se escribe
    expect(iconSvg(d, 24, { stroke: { color: 'x" onload="y', width: 2 } })).not.toContain('stroke');
    expect(iconSvg(d, 24, { stroke: { color: '#000000', width: 0 } })).not.toContain('stroke');
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

describe('forma libre (Convertir en forma)', () => {
  it('lee los comandos de un trazo: relativos, H y V, repetición implícita, números pegados', () => {
    expect(svgPathToCmds('M1 2h3v4H0z')).toEqual([['M', 1, 2], ['L', 4, 2], ['L', 4, 6], ['L', 0, 6], ['Z']]);
    expect(svgPathToCmds('m1 1 2 0 0 2z')).toEqual([['M', 1, 1], ['L', 3, 1], ['L', 3, 3], ['Z']]);
    expect(svgPathToCmds('M0 0l1.5.5-.5-2')).toEqual([['M', 0, 0], ['L', 1.5, 0.5], ['L', 1, -1.5]]);
    expect(svgPathToCmds('M0 0q1 1 2 0t2 0')).toEqual([['M', 0, 0], ['Q', 1, 1, 2, 0], ['Q', 3, -1, 4, 0]]);
    expect(svgPathToCmds('M0 0c1 0 2 1 2 2s1 2 2 2')).toEqual([['M', 0, 0], ['C', 1, 0, 2, 1, 2, 2], ['C', 2, 3, 3, 4, 4, 4]]);
    expect(svgPathToCmds('M0 0L')).toBeNull();
    expect(svgPathToCmds('hola')).toBeNull();
  });
  it('un arco entero se hace con curvas que pasan por los mismos puntos (círculo de radio 5)', () => {
    const cmds = svgPathToCmds('M5 0a5 5 0 1 0 0 10a5 5 0 1 0 0-10z')!;
    const cubics = cmds.filter((c) => c[0] === 'C');
    expect(cubics.length).toBe(4);
    expect(cmds.some((c) => c[0] === ('A' as string))).toBe(false);
    // el último punto de cada curva es un cuarto de vuelta del círculo (centro 5,5)
    const ends = cubics.map((c) => [c[5], c[6]] as [number, number]);
    for (const [x, y] of ends) expect(Math.abs(Math.hypot(x - 5, y - 5) - 5)).toBeLessThan(1e-6);
    // y los puntos de control no se salen de la caja
    for (const c of cubics) for (const v of c.slice(1) as number[]) expect(v).toBeGreaterThanOrEqual(-0.01), expect(v).toBeLessThanOrEqual(10.01);
  });
  it('banderas de arco pegadas y arco que no cabe se corrige (SVG compacto de Fluent)', () => {
    const a = svgPathToCmds('M0 0a2 2 0 011 1')!;
    expect(a[1]![0]).toBe('C');
    const big = svgPathToCmds('M0 0a1 1 0 000 10')!; // radio menor que la mitad de la cuerda: se agranda
    const last = big[big.length - 1] as number[];
    expect(last[6]).toBeCloseTo(10, 6);
    expect(svgPathToCmds('M0 0A1 0 0 0 0 0 5')![1]).toEqual(['L', 0, 5]);
  });
  it('todos los iconos del catálogo se pueden pasar a forma, con números enteros dentro del cuadrado', async () => {
    const [c, p] = await Promise.all([loadCatalog(), loadPaths()]);
    let n = 0;
    const bad: string[] = [];
    for (const info of c.icons) {
      for (const style of ['regular', 'filled'] as const) {
        const got = iconPaths(p, info, style);
        if (!got || got.style !== style) continue;
        const f = svgToFreeform(iconSvg(got.d, info.size));
        if (!f || f.paths.length !== got.d.length) { bad.push(`${info.id} ${style}`); continue; }
        for (const path of f.paths) {
          if (path.w !== info.size * FREEFORM_SCALE) bad.push(`${info.id} tamaño`);
          for (const cmd of path.cmds) for (const v of cmd.slice(1) as number[]) if (!Number.isInteger(v) || v < -0.2 * path.w || v > 1.2 * path.w) bad.push(`${info.id} ${style} valor ${v}`);
        }
        n++;
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(n).toBeGreaterThan(4000);
  }, 60000);
  it('lleva el relleno, la transparencia y el contorno del icono', () => {
    const f = svgToFreeform(iconSvg(['M0 0h24v24z'], 24, { fill: '#00b050', opacity: 0.5, stroke: { color: '#002060', width: 2 } }))!;
    expect(f.fill).toBe('#00b050');
    expect(f.opacity).toBe(0.5);
    expect(f.stroke).toEqual({ color: '#002060', width: 2 });
    expect(svgToFreeform(iconSvg(['M0 0h24v24z'], 24, { fill: null }))!.fill).toBeNull();
    expect(svgToFreeform('<svg viewBox="0 0 1 2"></svg>')).toBeNull();
  });
});
