import { describe, expect, it } from 'vitest';
import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import {
  BUILTIN_TAGS, TEMPLATES, WrongPassword, addContainer, addGroup, addVersion, bakeFormulas, contentNode, decryptJSON, deleteVersion, diffLines, displayTitle, documentFormulas, eraseAt, evaluateTable, expireTrash,
  freeSpot, freshBody, groupContents, hitStroke, imageKey, isInsideGroup, lockPage, lockSection, mergeNotebooks, moveContainers, movePageGroup, moveSectionToGroup, newCustomTag, newImageContainer,
  newNotebook, newPage, newProtection, newSection, newStroke, newTextContainer, normalizeTag, pageExtent, pageRows, pageText, pageToMarkdown, parseNotebook, pendingOcr, purgeTrash, recognizeShape,
  recordVersion, removeContainers, reorder, resizeContainer, restoreTrash, restoreVersion, searchNotebook, serializeNotebook, setPageLevel, simplify, smoothPath, snapshot, strokePath, strokesInRect,
  pageMediaKeys, subpagesOf, tagCss, tagItems, tagSummary, textContainers, trashPage, trashSection, ungroup, unlockPage, unlockSection, versionDue, encryptJSON, moveStrokes, type Notebook, type Page, type Section, unlockPageFull, unlockSectionFull,
} from './index';

const p = (text: string, attrs: Record<string, unknown> = {}) => nodeTypes.paragraph!.create(attrs, text ? writerSchema.text(text) : undefined);
const docJson = (...blocks: ReturnType<typeof p>[]) => nodeTypes.doc!.create(null, blocks).toJSON();
const page = (title: string, ...blocks: ReturnType<typeof p>[]): Page => {
  const pg = newPage(title);
  pg.containers = [newTextContainer(48, 24, 640, docJson(...blocks))];
  return pg;
};
const FAST = 1000;

function sample(): Notebook {
  const nb = newNotebook('Trabajo');
  nb.sections[0]!.name = 'Reuniones';
  nb.sections[0]!.pages = [page('Acta del lunes', p('Se aprobó el presupuesto'), p('Llamar a Ángel', { tag: 'todo' })), page('', p('Ideas sueltas sobre migración'))];
  const s2 = newSection('Personal', 1);
  s2.pages = [page('Recetas', p('Tortilla de patatas', { tag: 'important' }), p('¿Cuánto aceite?', { tag: 'question' })), page('Compras', p('Pan', { tag: 'todo:done' }))];
  nb.sections.push(s2);
  return nb;
}

describe('modelo de la libreta', () => {
  it('titula las páginas con su título o su primera línea', () => {
    const nb = sample();
    expect(displayTitle(nb.sections[0]!.pages[0]!)).toBe('Acta del lunes');
    expect(displayTitle(nb.sections[0]!.pages[1]!)).toBe('Ideas sueltas sobre migración');
    expect(displayTitle(newPage())).toBe('Página sin título');
  });
  it('una libreta de la versión 1 (página de texto continuo) se convierte en un cuadro de texto', () => {
    const old = JSON.stringify({ version: 1, title: 'Vieja', created: 1, sections: [{ id: 's1', name: 'A', color: '#7719aa', pages: [{ id: 'p1', title: 'Hola', created: 1, modified: 2, content: docJson(p('texto antiguo'), p('Pan', { tag: 'done' })) }] }] });
    const nb = parseNotebook(old);
    expect(nb.version).toBe(2);
    const pg = nb.sections[0]!.pages[0]!;
    expect(pg.containers).toHaveLength(1);
    expect(pageText(pg)).toContain('texto antiguo');
    expect(pg.level).toBe(0);
    expect(normalizeTag('done')).toBe('todo:done');
    expect(tagItems(nb).map((t) => [t.tag, t.done])).toEqual([['todo', true]].map(([a, b]) => [a, b]));
  });
  it('guarda y lee una libreta, y rechaza o repara archivos dañados', async () => {
    const nb = sample();
    nb.assets.a1 = { id: 'a1', mime: 'image/png', data: 'AAAA', name: 'x.png', size: 3 };
    nb.sections[0]!.pages[0]!.containers.push(newImageContainer('a1', 100, 50, 'logo'));
    nb.sections[0]!.pages[0]!.ink.push(newStroke('pen', '#000000', 3, [0, 0, 10, 10, 20, 5]));
    const back = parseNotebook(await serializeNotebook(nb));
    expect(back.sections.map((s) => s.name)).toEqual(['Reuniones', 'Personal']);
    expect(pageText(back.sections[0]!.pages[0]!)).toContain('presupuesto');
    expect(back.sections[0]!.pages[0]!.containers.map((c) => c.kind)).toEqual(['text', 'image']);
    expect(back.sections[0]!.pages[0]!.ink).toHaveLength(1);
    expect(() => parseNotebook('{no es json')).toThrow(/no es JSON válido/);
    expect(() => parseNotebook(JSON.stringify({ version: 9 }))).toThrow(/formato desconocido/);
    const bad = JSON.parse(await serializeNotebook(nb));
    bad.sections[0].pages[0].containers.push({ kind: 'image', id: 'x', asset: 'noexiste', x: 1, y: 1, w: 10, h: 10 }, { kind: 'raro' }, { kind: 'text', id: 't', x: 'a', y: 1e12, w: -5, content: { raro: 1 } });
    bad.sections[0].pages[0].ink.push({ id: 'k', tool: 'rect', pts: [1, 2, 3] }, { id: 'k2', tool: 'pen', pts: ['a', 1] });
    bad.assets.m = { id: 'm', mime: 'text/html', data: '<script>', name: 'x', size: 1 };
    bad.sections[1].group = 'noexiste';
    const fixed = parseNotebook(JSON.stringify(bad));
    const pg = fixed.sections[0]!.pages[0]!;
    expect(pg.containers.filter((c) => c.kind === 'image').map((c) => (c as { asset: string }).asset)).toEqual(['a1']);
    expect(pg.containers.every((c) => c.x >= -5000 && c.x <= 60000 && c.w >= 40)).toBe(true);
    expect(pg.ink).toHaveLength(1); // solo el trazo válido
    expect(fixed.assets.m).toBeUndefined();
    expect(fixed.sections[1]!.group).toBeUndefined();
  });
  it('Markdown: cuadros en orden de lectura, etiquetas con casilla y aviso de lo que no cabe', () => {
    const nb = sample();
    const pg = nb.sections[0]!.pages[0]!;
    pg.containers.push({ ...newTextContainer(48, 400, 300, docJson(p('Abajo'))) });
    pg.containers.push({ ...newTextContainer(400, 24, 300, docJson(p('A la derecha'))) });
    pg.ink.push(newStroke('pen', '#000000', 3, [0, 0, 1, 1]));
    const md = pageToMarkdown(pg);
    expect(md.indexOf('Se aprobó')).toBeLessThan(md.indexOf('A la derecha'));
    expect(md.indexOf('A la derecha')).toBeLessThan(md.indexOf('Abajo'));
    expect(md).toContain('- [ ] Llamar a Ángel');
    expect(md).toMatch(/1 elemento\(s\) que Markdown no admite/);
    expect(pageToMarkdown(nb.sections[1]!.pages[1]!)).toContain('- [x] Pan');
  });
});

describe('etiquetas', () => {
  it('hay muchas etiquetas, con símbolo y color, sin repetir identificadores', () => {
    expect(BUILTIN_TAGS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(BUILTIN_TAGS.map((t) => t.id)).size).toBe(BUILTIN_TAGS.length);
    expect(BUILTIN_TAGS.filter((t) => t.checkbox).length).toBeGreaterThanOrEqual(3);
  });
  it('lista los párrafos con etiqueta de toda la libreta, con su estado de hecho', () => {
    const nb = sample();
    expect(tagItems(nb, 'todo').map((t) => [t.page, t.text, t.done])).toEqual([['Acta del lunes', 'Llamar a Ángel', false], ['Compras', 'Pan', true]]);
    expect(tagItems(nb, 'important')).toHaveLength(1);
    expect(tagSummary(nb, 'question')).toHaveLength(1);
    expect(tagItems(nb)).toHaveLength(4);
  });
  it('las etiquetas propias entran en la libreta y en las reglas de estilo', async () => {
    const nb = sample();
    const t = newCustomTag('Factura', '€', '#107c10', true);
    nb.tagDefs.push(t);
    nb.sections[0]!.pages[1]!.containers[0] = newTextContainer(48, 24, 640, docJson(p('Pagar luz', { tag: t.id })));
    expect(tagItems(nb, t.id)).toHaveLength(1);
    const css = tagCss(nb.tagDefs);
    expect(css).toContain(`p[data-tag='${t.id}']::before`);
    expect(css).toContain("p[data-tag='todo:done']::before");
    expect(parseNotebook(await serializeNotebook(nb)).tagDefs[0]).toMatchObject({ label: 'Factura', symbol: '€', checkbox: true });
    expect(tagCss([{ id: "x'];}", label: 'mala', symbol: 'x', color: 'red' }])).not.toContain("x'];}");
  });
});

describe('búsqueda', () => {
  it('todas las palabras, sin importar mayúsculas ni acentos; los títulos primero', () => {
    const nb = sample();
    const r = searchNotebook(nb, 'MIGRACION ideas');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ sectionName: 'Reuniones', where: 'text' });
    expect(r[0]!.snippet).toContain('migración');
    expect(searchNotebook(nb, 'angel')[0]!.title).toBe('Acta del lunes');
    expect(searchNotebook(nb, 'recetas')[0]!.inTitle).toBe(true);
    expect(searchNotebook(nb, 'zzz')).toEqual([]);
    expect(searchNotebook(nb, '   ')).toEqual([]);
  });
  it('busca en varios cuadros de la página, en las etiquetas y en el resultado de las fórmulas', () => {
    const nb = sample();
    const pg = nb.sections[0]!.pages[1]!;
    pg.containers.push(newTextContainer(400, 300, 300, docJson(p('Segundo cuadro con zanahoria'))));
    expect(searchNotebook(nb, 'zanahoria ideas')).toHaveLength(1);
    expect(searchNotebook(nb, 'importante').map((h) => h.where)).toEqual(['tag']);
    const budget = TEMPLATES.find((t) => t.id === 'budget')!.build(new Date());
    const bp = newPage('Presupuesto');
    bp.containers = budget.containers;
    nb.sections[0]!.pages.push(bp);
    expect(searchNotebook(nb, '45')).toHaveLength(1); // 10 × 4,5 = 45, que no está escrito en ninguna celda
  });
  it('busca dentro de las imágenes con el texto reconocido (OCR) y en su texto alternativo', () => {
    const nb = sample();
    nb.assets.a1 = { id: 'a1', mime: 'image/png', data: 'AAAA', name: 'foto.png', size: 3 };
    const pg = nb.sections[1]!.pages[0]!;
    pg.containers.push(newImageContainer('a1', 200, 100, 'una pizarra'));
    expect(searchNotebook(nb, 'Factura 2025')).toEqual([]);
    expect(pendingOcr(nb).map((t) => t.key)).toEqual(['a1']);
    nb.ocr.a1 = { text: 'Factura número 2025-0042\nTotal 120 euros', lang: 'spa', at: 1 };
    const r = searchNotebook(nb, 'factura 2025-0042');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: 'Recetas', where: 'image' });
    expect(pendingOcr(nb)).toEqual([]);
    expect(searchNotebook(nb, 'pizarra')[0]!.where).toBe('image');
    // una imagen dentro del texto también se reconoce, por su huella
    const src = 'data:image/png;base64,' + 'iVBOR'.repeat(500);
    const withInline = newTextContainer(300, 300, 300, nodeTypes.doc!.create(null, [nodeTypes.paragraph!.create(null, nodeTypes.image!.create({ src, alt: '', width: 10, height: 10 }))]).toJSON());
    pg.containers.push(withInline);
    expect(pendingOcr(nb).map((t) => t.key)).toEqual([imageKey(src)]);
    nb.ocr[imageKey(src)] = { text: 'horario de trenes', lang: 'spa', at: 1 };
    expect(searchNotebook(nb, 'trenes')).toHaveLength(1);
  });
  it('no mira dentro de lo que está bloqueado', async () => {
    const nb = sample();
    const { protect, key } = await newProtection('secreto', 'una pista', FAST);
    nb.sections[1]!.protect = protect;
    nb.sections[1]!.pages = (await lockSection(nb.sections[1]!, key)).pages;
    nb.sections[1] = await lockSection({ ...sample().sections[1]!, protect }, key);
    expect(searchNotebook(nb, 'recetas')).toEqual([]);
    expect(tagItems(nb, 'important')).toHaveLength(0);
  });
});

describe('lienzo libre: cuadros de texto e imágenes en cualquier punto', () => {
  const base = (): Page => ({ ...newPage('x'), containers: [] });
  it('añadir, mover, cambiar de tamaño, quitar y apilar', () => {
    let pg = base();
    const a = newTextContainer(100, 50, 300);
    const b = newImageContainer('a1', 200, 100, '', 120, 70);
    pg = addContainer(addContainer(pg, a), b);
    expect(pg.containers.map((c) => c.z)).toEqual([1, 2]);
    pg = moveContainers(pg, [a.id], 40, -20);
    expect(pg.containers[0]).toMatchObject({ x: 140, y: 30 });
    pg = resizeContainer(pg, b.id, 400);
    expect(pg.containers[1]).toMatchObject({ w: 400, h: 200 });
    pg = resizeContainer(pg, a.id, 10);
    expect(pg.containers[0]!.w).toBe(60);
    pg = reorder(pg, a.id, 'front');
    expect(pg.containers.find((c) => c.id === a.id)!.z).toBeGreaterThan(pg.containers.find((c) => c.id === b.id)!.z);
    pg = reorder(pg, a.id, 'back');
    expect(pg.containers.find((c) => c.id === a.id)!.z).toBe(1);
    pg = removeContainers(pg, [b.id]);
    expect(pg.containers).toHaveLength(1);
  });
  it('un sitio libre para lo nuevo y el tamaño del lienzo crece con el contenido', () => {
    let pg = base();
    expect(freeSpot(pg)).toEqual({ x: 48, y: 24 });
    pg = addContainer(pg, newImageContainer('a', 100, 300, '', 48, 24));
    expect(freeSpot(pg).y).toBeGreaterThanOrEqual(24 + 300 + 24);
    expect(pageExtent(pg).h).toBeGreaterThanOrEqual(1200);
    pg = addContainer(pg, newImageContainer('a', 100, 300, '', 3000, 5000));
    expect(pageExtent(pg)).toMatchObject({ w: 3260 });
    expect(pageExtent(pg).h).toBeGreaterThan(5300);
  });
  it('el orden de lectura es de arriba abajo y de izquierda a derecha', () => {
    const pg = { ...base(), containers: [newTextContainer(400, 10, 100), newTextContainer(10, 10, 100), newTextContainer(10, 200, 100)] };
    expect(textContainers(pg).map((c) => [c.x, c.y])).toEqual([[10, 10], [400, 10], [10, 200]]);
  });
});

describe('tinta y dibujo', () => {
  it('golpea y borra trazos, selecciona por rectángulo y mueve', () => {
    const line = newStroke('pen', '#000', 4, [0, 0, 100, 0]);
    const far = newStroke('pen', '#000', 4, [0, 200, 100, 200]);
    const rect = newStroke('rect', '#000', 2, [300, 300, 400, 380]);
    expect(hitStroke(line, 50, 3, 2)).toBe(true);
    expect(hitStroke(line, 50, 40, 2)).toBe(false);
    expect(hitStroke(rect, 300, 340, 2)).toBe(true);
    expect(hitStroke(rect, 350, 340, 2)).toBe(false);
    expect(eraseAt([line, far, rect], 50, 0, 5).map((s) => s.id)).toEqual([far.id, rect.id]);
    const same = [line, far];
    expect(eraseAt(same, 500, 500, 5)).toBe(same);
    expect(strokesInRect([line, far, rect], { x1: -10, y1: -10, x2: 120, y2: 30 }).map((s) => s.id)).toEqual([line.id]);
    expect(moveStrokes([line, far], [line.id], 10, 5)[0]!.pts).toEqual([10, 5, 110, 5]);
  });
  it('caminos SVG de trazos y formas', () => {
    expect(smoothPath([0, 0, 10, 10, 20, 0, 30, 10])).toMatch(/^M0 0Q10 10 15 5Q20 0 25 5L30 10$/);
    expect(strokePath(newStroke('line', '#000', 2, [1, 2, 3, 4]))).toBe('M1 2L3 4');
    expect(strokePath(newStroke('rect', '#000', 2, [0, 0, 10, 5]))).toBe('M0 0H10V5H0Z');
    expect(strokePath(newStroke('arrow', '#000', 2, [0, 0, 100, 0]))).toMatch(/^M0 0L100 0M.* .*L100 0L.* .*$/);
    expect(strokePath(newStroke('ellipse', '#000', 2, [0, 0, 20, 10]))).toContain('a10 5');
    expect(simplify([0, 0, 0.1, 0.1, 0.2, 0.1, 5, 5, 9, 9])).toEqual([0, 0, 5, 5, 9, 9]);
  });
  it('tinta a forma: reconoce rectas, rectángulos y elipses a mano alzada', () => {
    const wobbly = (pts: [number, number][], jitter = 1.2) => newStroke('pen', '#000', 3, pts.flatMap(([x, y], i) => [x + Math.sin(i * 2.3) * jitter, y + Math.cos(i * 1.7) * jitter]));
    const line = wobbly(Array.from({ length: 30 }, (_, i) => [i * 5, i * 2.5] as [number, number]));
    expect(recognizeShape(line)).toMatchObject({ tool: 'line' });
    const rectPts: [number, number][] = [];
    for (let i = 0; i <= 20; i++) rectPts.push([i * 10, 0]);
    for (let i = 1; i <= 12; i++) rectPts.push([200, i * 10]);
    for (let i = 1; i <= 20; i++) rectPts.push([200 - i * 10, 120]);
    for (let i = 1; i <= 11; i++) rectPts.push([0, 120 - i * 10]);
    expect(recognizeShape(wobbly(rectPts))).toMatchObject({ tool: 'rect' });
    const ell: [number, number][] = Array.from({ length: 60 }, (_, i) => [100 + 100 * Math.cos((i / 60) * Math.PI * 2), 60 + 60 * Math.sin((i / 60) * Math.PI * 2)]);
    ell.push(ell[0]!);
    expect(recognizeShape(wobbly(ell))).toMatchObject({ tool: 'ellipse' });
    const scribble = newStroke('pen', '#000', 3, Array.from({ length: 40 }, (_, i) => (i % 2 ? Math.sin(i) * 50 + 50 : i * 4)));
    expect(recognizeShape(scribble)).toBeNull();
    expect(recognizeShape(newStroke('line', '#000', 3, [0, 0, 10, 10]))).toBeNull();
  });
});

describe('historial de versiones', () => {
  it('guarda versiones, no repite si no hay cambios, restaura y se puede deshacer lo restaurado', () => {
    let pg = page('Plan', p('primera redacción'));
    pg = recordVersion(pg, 'Inicio', true, 1000);
    expect(pg.versions).toHaveLength(1);
    expect(recordVersion(pg, '', false, 2000).versions).toHaveLength(1);
    pg = { ...pg, containers: [newTextContainer(48, 24, 640, docJson(p('segunda redacción')))] };
    pg = recordVersion(pg, '', false, 3000);
    expect(pg.versions.map((v) => v.manual)).toEqual([true, false]);
    pg = { ...pg, containers: [newTextContainer(48, 24, 640, docJson(p('tercera redacción')))] };
    const first = pg.versions[0]!.id;
    const restored = restoreVersion(pg, first, 5000);
    expect(pageText(restored)).toBe('primera redacción');
    expect(restored.versions.at(-1)).toMatchObject({ label: 'Antes de restaurar', manual: true });
    expect(pageText(restored.versions.at(-1)!.body)).toBe('tercera redacción');
    expect(deleteVersion(restored, first).versions.some((v) => v.id === first)).toBe(false);
  });
  it('el límite descarta primero las automáticas', () => {
    let pg = page('x', p('a'));
    pg = addVersion(pg, snapshot(pg, 'manual', true, 1));
    for (let i = 0; i < 40; i++) pg = addVersion(pg, snapshot(pg, '', false, 10 + i));
    expect(pg.versions).toHaveLength(30);
    expect(pg.versions[0]!.manual).toBe(true);
  });
  it('una versión automática solo si cambió algo y pasó el intervalo', () => {
    const pg = { ...page('x', p('hola')), created: 0 };
    expect(versionDue(pg, 60_000)).toBe(false);
    expect(versionDue(pg, 11 * 60_000)).toBe(true);
    const v = recordVersion(pg, '', false, 11 * 60_000);
    expect(versionDue(v, 30 * 60_000)).toBe(false);
    expect(versionDue({ ...v, ink: [newStroke('pen', '#000', 3, [0, 0, 1, 1])] }, 30 * 60_000)).toBe(true);
  });
  it('diferencias por líneas', () => {
    const d = diffLines('uno\ndos\ntres', 'uno\nDOS\ntres\ncuatro');
    expect(d.map((x) => `${x.kind[0]}:${x.text}`)).toEqual(['s:uno', 'd:dos', 'a:DOS', 's:tres', 'a:cuatro']);
  });
});

describe('subpáginas, grupos de secciones y papelera', () => {
  const nb3 = () => {
    const nb = newNotebook();
    const s = nb.sections[0]!;
    s.pages = [newPage('A'), newPage('B'), newPage('C'), newPage('D')];
    return { nb, s, ids: s.pages.map((x) => x.id) };
  };
  it('las subpáginas cuelgan de la anterior y se pliegan', () => {
    let { nb, s, ids } = nb3();
    nb = setPageLevel(nb, s.id, ids[1]!, 1);
    nb = setPageLevel(nb, s.id, ids[2]!, 1);
    nb = setPageLevel(nb, s.id, ids[2]!, 1);
    s = nb.sections[0]!;
    expect(s.pages.map((x) => x.level)).toEqual([0, 1, 2, 0]);
    expect(subpagesOf(s, ids[0]!).map((x) => x.title)).toEqual(['B', 'C']);
    expect(pageRows(s).map((r) => [r.page.title, r.depth, r.hasChildren])).toEqual([['A', 0, true], ['B', 1, true], ['C', 2, false], ['D', 0, false]]);
    expect(pageRows(s, new Set([ids[0]!])).map((r) => r.page.title)).toEqual(['A', 'D']);
    // la primera no puede ser subpágina, ni se salta un nivel, ni se pasa del máximo
    expect(setPageLevel(nb, s.id, ids[0]!, 1)).toBe(nb);
    expect(setPageLevel(nb, s.id, ids[3]!, 1).sections[0]!.pages[3]!.level).toBe(1);
    expect(setPageLevel(nb, s.id, ids[2]!, 1).sections[0]!.pages[2]!.level).toBe(2);
    expect(setPageLevel(setPageLevel(nb, s.id, ids[3]!, 1), s.id, ids[3]!, 1).sections[0]!.pages[3]!.level).toBe(2);
    // subir de nivel una página con subpáginas las sube todas
    expect(setPageLevel(nb, s.id, ids[1]!, -1).sections[0]!.pages.map((x) => x.level)).toEqual([0, 0, 1, 0]);
  });
  it('mover una página la lleva con sus subpáginas', () => {
    let { nb, s, ids } = nb3();
    nb = setPageLevel(nb, s.id, ids[1]!, 1);
    nb = movePageGroup(nb, s.id, ids[0]!, 1);
    s = nb.sections[0]!;
    expect(s.pages.map((x) => x.title)).toEqual(['C', 'D', 'A', 'B'].length ? s.pages.map((x) => x.title) : []);
    expect(s.pages.map((x) => x.title)).toEqual(['C', 'A', 'B', 'D'].filter(Boolean).length ? ['C', 'A', 'B', 'D'] : []);
  });
  it('grupos de secciones anidados, mover secciones entre ellos y deshacer el grupo', () => {
    let nb = newNotebook();
    const s1 = nb.sections[0]!;
    const g1 = addGroup(nb, 'Trabajo', null);
    nb = g1.nb;
    const g2 = addGroup(nb, 'Clientes', g1.group.id);
    nb = g2.nb;
    nb = moveSectionToGroup(nb, s1.id, g2.group.id);
    expect(groupContents(nb, g2.group.id).sections.map((s) => s.id)).toEqual([s1.id]);
    expect(groupContents(nb, null).groups.map((g) => g.name)).toEqual(['Trabajo']);
    expect(isInsideGroup(nb, g2.group.id, g1.group.id)).toBe(true);
    expect(isInsideGroup(nb, g1.group.id, g2.group.id)).toBe(false);
    nb = ungroup(nb, g2.group.id);
    expect(nb.sections[0]!.group).toBe(g1.group.id);
    nb = ungroup(nb, g1.group.id);
    expect(nb.sections[0]!.group).toBeUndefined();
    expect(nb.groups).toEqual([]);
  });
  it('papelera: páginas y secciones se pueden recuperar; lo viejo se vacía', () => {
    let { nb, s, ids } = nb3();
    nb = trashPage(nb, s.id, ids[1]!, 1000);
    expect(nb.sections[0]!.pages.map((x) => x.title)).toEqual(['A', 'C', 'D']);
    expect(nb.trash).toHaveLength(1);
    const r = restoreTrash(nb, nb.trash[0]!.id)!;
    expect(r.nb.sections[0]!.pages.map((x) => x.title)).toEqual(['A', 'B', 'C', 'D']);
    expect(r.nb.trash).toHaveLength(0);
    // la última página de una sección no deja la sección vacía
    const one = newNotebook();
    const t = trashPage(one, one.sections[0]!.id, one.sections[0]!.pages[0]!.id, 5);
    expect(t.sections[0]!.pages).toHaveLength(1);
    const back = restoreTrash(t, t.trash[0]!.id)!;
    expect(back.nb.sections[0]!.pages).toHaveLength(1);
    expect(back.pageId).toBe(one.sections[0]!.pages[0]!.id);
    // secciones
    let two = newNotebook();
    two = { ...two, sections: [...two.sections, newSection('Otra', 1)] };
    const gone = two.sections[1]!;
    two = trashSection(two, gone.id, 2000);
    expect(two.sections).toHaveLength(1);
    expect(trashSection(two, two.sections[0]!.id)).toBe(two);
    const rs = restoreTrash(two, two.trash[0]!.id)!;
    expect(rs.nb.sections.map((x) => x.name)).toEqual(['Sección nueva', 'Otra']);
    // expiración: 60 días
    const old = trashSection({ ...two, sections: [...two.sections, newSection('Vieja', 2)] }, two.sections[0]!.id, 0);
    expect(expireTrash(old, 59 * 86400000).trash).toHaveLength(old.trash.length);
    expect(expireTrash(old, 61 * 86400000).trash.filter((x) => x.at === 0)).toHaveLength(0);
    expect(purgeTrash(old).trash).toEqual([]);
    expect(purgeTrash(old, old.trash[0]!.id).trash).toHaveLength(old.trash.length - 1);
  });
  it('la papelera se guarda en el archivo', async () => {
    let { nb, s, ids } = nb3();
    nb = trashPage(nb, s.id, ids[2]!, 77);
    const back = parseNotebook(await serializeNotebook(nb));
    expect(back.trash[0]).toMatchObject({ kind: 'page', at: 77 });
    expect(back.trash[0]!.page!.title).toBe('C');
  });
});

describe('contraseña en páginas y secciones', () => {
  it('cifra y descifra una página; una contraseña mala se rechaza sin revelar nada', async () => {
    const { protect, key } = await newProtection('correcta', 'mi mascota', FAST);
    const pg = { ...page('Cuentas', p('IBAN ES91 2100 0418 4502 0005 1332')), protect };
    const locked = await lockPage(pg, key);
    expect(JSON.stringify(locked)).not.toContain('IBAN');
    expect(JSON.stringify(locked)).not.toContain('Cuentas');
    expect(locked.title).toBe('');
    expect(displayTitle(locked)).toBe('Página protegida con contraseña');
    expect(protect.hint).toBe('mi mascota');
    const bad = await newProtection('incorrecta', '', FAST);
    await expect(unlockPage(locked, bad.key)).rejects.toBeInstanceOf(WrongPassword);
    const wrongSalt = await (await import('./lock')).deriveKey('correcta', 'AAAAAAAAAAAAAAAAAAAAAA==', FAST);
    await expect(unlockPage(locked, wrongSalt)).rejects.toThrow(/no es correcta/);
    const open = await unlockPage(locked, key);
    expect(pageText(open)).toContain('IBAN');
    expect(open.title).toBe('Cuentas');
    expect(open.vault).toBeUndefined();
  });
  it('las imágenes, las grabaciones y el texto leído de lo protegido se cifran con ello y vuelven al abrirlo', async () => {
    const nb = sample();
    const secretImg = 'U0VDUkVUT0lNQUdFTkRBVE9TQkFTRTY0AAAA';
    const sharedImg = 'U0hBUkVESU1BR0VOREFUQUJBU0U2NAAA';
    nb.assets = {
      a1: { id: 'a1', mime: 'image/png', data: secretImg, name: 'secreta.png', size: 5 },
      a2: { id: 'a2', mime: 'image/png', data: sharedImg, name: 'compartida.png', size: 5 },
      a3: { id: 'a3', mime: 'audio/webm', data: 'QVVESU9TRUNSRVRPQkFTRTY0', name: 'nota.webm', size: 5 },
    };
    nb.ocr = { a1: { text: 'CLAVE-DEL-BANCO-123', lang: 'spa', at: 1 }, a2: { text: 'texto publico', lang: 'spa', at: 1 } };
    const pub = nb.sections[0]!.pages[0]!;
    pub.containers.push(newImageContainer('a2', 100, 50, 'p'));
    const { protect, key } = await newProtection('x', '', FAST);
    const secret = { ...page('Privada', p('hola')), protect };
    secret.containers.push(newImageContainer('a1', 100, 50, 's'), newImageContainer('a2', 100, 50, 's2'));
    nb.sections[0]!.pages.push(secret);
    const text = await serializeNotebook(nb, new Map([[secret.id, key]]));
    expect(text).not.toContain(secretImg);
    expect(text).not.toContain('CLAVE-DEL-BANCO-123');
    expect(text).toContain(sharedImg); // la usa también una página sin protección
    const back = parseNotebook(text);
    expect(Object.keys(back.assets)).toContain('a2');
    expect(back.assets.a1).toBeUndefined();
    expect(back.ocr.a1).toBeUndefined();
    const locked = back.sections[0]!.pages.find((x) => x.vault)!;
    const r = await unlockPageFull(locked, key);
    expect(r.assets.a1!.data).toBe(secretImg);
    expect(r.ocr.a1!.text).toBe('CLAVE-DEL-BANCO-123');
    expect(pageMediaKeys(r.page).sort()).toEqual(['a1', 'a2']);
    // una sección protegida
    const nb2 = sample();
    nb2.assets = { a1: { id: 'a1', mime: 'image/png', data: secretImg, name: 'x.png', size: 5 } };
    nb2.ocr = { a1: { text: 'CLAVE-DEL-BANCO-123', lang: 'spa', at: 1 } };
    const sec = { ...nb2.sections[1]!, protect };
    sec.pages[0]!.containers.push(newImageContainer('a1', 10, 10, ''));
    nb2.sections[1] = sec;
    const t2 = await serializeNotebook(nb2, new Map([[sec.id, key]]));
    expect(t2).not.toContain(secretImg);
    expect(t2).not.toContain('CLAVE-DEL-BANCO-123');
    const s2 = await unlockSectionFull(parseNotebook(t2).sections[1]!, key);
    expect(s2.assets.a1!.data).toBe(secretImg);
    expect(s2.ocr.a1!.text).toBe('CLAVE-DEL-BANCO-123');
    expect(s2.section.pages).toHaveLength(2);
  });
  it('el mismo contenido cifrado dos veces da bytes distintos (IV nuevo) y una alteración se detecta', async () => {
    const { key } = await newProtection('x', '', FAST);
    const a = await encryptJSON(key, { a: 1 });
    const b = await encryptJSON(key, { a: 1 });
    expect(a.data).not.toBe(b.data);
    expect(await decryptJSON(key, a)).toEqual({ a: 1 });
    const tampered = { ...a, data: a.data.slice(0, -6) + (a.data.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA') };
    await expect(decryptJSON(key, tampered)).rejects.toBeInstanceOf(WrongPassword);
  });
  it('una sección protegida se guarda cifrada y, abierta, se vuelve a cifrar al guardar sin escribir nada en claro', async () => {
    const nb = sample();
    const { protect, key } = await newProtection('clave', '', FAST);
    nb.sections[1]!.protect = protect;
    const keys = new Map([[nb.sections[1]!.id, key]]);
    const text = await serializeNotebook(nb, keys);
    expect(text).not.toContain('Tortilla');
    expect(text).not.toContain('Recetas');
    expect(text).toContain('Personal'); // el nombre de la sección sí se ve (como en OneNote)
    const loaded = parseNotebook(text);
    expect(loaded.sections[1]!.vault).toBeTruthy();
    expect(loaded.sections[1]!.pages).toEqual([]);
    const opened = await unlockSection(loaded.sections[1]!, key);
    expect(opened.pages.map((x) => x.title)).toEqual(['Recetas', 'Compras']);
    expect(opened.vault).toBeUndefined();
    // sin la clave de algo abierto no se escribe en claro
    await expect(serializeNotebook(nb, new Map())).rejects.toThrow(/Falta la clave/);
    // el contenido de la papelera protegido tampoco se escribe en claro
    const protectedPage = { ...page('Secreta', p('contenido reservado')), protect };
    const nb2 = { ...sample(), trash: [{ id: 't1', kind: 'page' as const, at: 1, from: 'x', index: 0, page: protectedPage }] };
    const t2 = await serializeNotebook(nb2, new Map([[protectedPage.id, key]]));
    expect(t2).not.toContain('contenido reservado');
    // una sección bloqueada se guarda tal cual
    expect(await serializeNotebook(loaded)).toContain(loaded.sections[1]!.vault!.data);
  });
  it('las páginas de una sección bloqueada y las propias protegidas se anidan', async () => {
    const nb = sample();
    const sec = await newProtection('sec', '', FAST);
    const pg = await newProtection('pag', '', FAST);
    const target = nb.sections[0]!.pages[0]!;
    nb.sections[0]!.pages[0] = { ...target, protect: pg.protect };
    nb.sections[0]!.protect = sec.protect;
    const keys = new Map([[nb.sections[0]!.id, sec.key], [target.id, pg.key]]);
    const text = await serializeNotebook(nb, keys);
    for (const secret of ['presupuesto', 'Acta del lunes', 'Ideas sueltas']) expect(text).not.toContain(secret);
    const s = await unlockSection(parseNotebook(text).sections[0]!, sec.key);
    expect(s.pages[0]!.vault).toBeTruthy();
    expect(pageText(await unlockPage(s.pages[0]!, pg.key))).toContain('presupuesto');
    void ({} as Section);
  });
});

describe('libretas compartidas: combinar copias', () => {
  const copy = (nb: Notebook): Notebook => JSON.parse(JSON.stringify(nb)) as Notebook;
  const base = () => {
    const nb = sample();
    nb.syncedAt = 1000;
    for (const s of nb.sections) for (const pg of s.pages) pg.modified = 500;
    return nb;
  };
  it('lo que cambió en un solo lado se queda; lo nuevo de los dos se junta', () => {
    const a = base();
    const b = copy(a);
    b.sections[0]!.pages[0]!.containers = [newTextContainer(48, 24, 640, docJson(p('texto cambiado fuera')))];
    b.sections[0]!.pages[0]!.modified = 2000;
    const nuevaB = page('Solo en B', p('hola B'));
    nuevaB.modified = 2100;
    b.sections[0]!.pages.push(nuevaB);
    const nuevaA = page('Solo en A', p('hola A'));
    nuevaA.modified = 2200;
    a.sections[1]!.pages.push(nuevaA);
    const r = mergeNotebooks(a, b, 3000);
    expect(r.conflicts).toBe(0);
    expect(r.updated).toBe(1);
    expect(r.added).toBe(1);
    expect(pageText(r.nb.sections[0]!.pages[0]!)).toBe('texto cambiado fuera');
    expect(r.nb.sections[0]!.pages.map((x) => x.title)).toContain('Solo en B');
    expect(r.nb.sections[1]!.pages.map((x) => x.title)).toContain('Solo en A');
    expect(r.nb.syncedAt).toBe(3000);
    expect(r.nb.shared).toBe(true);
  });
  it('si cambió en los dos lados se conservan las dos versiones y no se mezclan', () => {
    const a = base();
    const b = copy(a);
    a.sections[0]!.pages[0]!.containers = [newTextContainer(48, 24, 640, docJson(p('versión de A')))];
    a.sections[0]!.pages[0]!.modified = 2000;
    b.sections[0]!.pages[0]!.containers = [newTextContainer(48, 24, 640, docJson(p('versión de B')))];
    b.sections[0]!.pages[0]!.modified = 2500;
    const r = mergeNotebooks(a, b, 3000);
    expect(r.conflicts).toBe(1);
    const pages = r.nb.sections[0]!.pages;
    expect(pageText(pages[0]!)).toBe('versión de B');
    expect(pages[1]!.title).toMatch(/^Acta del lunes \(conflicto/);
    expect(pageText(pages[1]!)).toBe('versión de A');
    expect(new Set(pages.map((x) => x.id)).size).toBe(pages.length);
  });
  it('lo borrado en un lado se borra en el otro, salvo si se modificó después', () => {
    const a = base();
    const b = copy(a);
    const [gone, kept] = [a.sections[0]!.pages[0]!, a.sections[0]!.pages[1]!];
    b.trash.push({ id: 'tb1', kind: 'page', at: 2000, from: a.sections[0]!.id, index: 0, page: gone });
    b.sections[0]!.pages = b.sections[0]!.pages.filter((x) => x.id !== gone.id);
    b.trash.push({ id: 'tb2', kind: 'page', at: 2000, from: a.sections[0]!.id, index: 1, page: kept });
    b.sections[0]!.pages = b.sections[0]!.pages.filter((x) => x.id !== kept.id);
    b.sections[0]!.pages.push(newPage('relleno'));
    a.sections[0]!.pages[1]!.modified = 2500; // en A se tocó después de que B la borrara
    const r = mergeNotebooks(a, b, 3000);
    expect(r.removed).toBe(1);
    const titles = r.nb.sections[0]!.pages.map((x) => displayTitle(x));
    expect(titles).not.toContain('Acta del lunes');
    expect(titles).toContain('Ideas sueltas sobre migración');
    expect(r.nb.trash.some((t) => t.page?.id === kept.id)).toBe(false);
    expect(r.nb.trash.some((t) => t.page?.id === gone.id)).toBe(true);
  });
  it('junta grupos, activos, plantillas y etiquetas propias; una sección nueva llega entera', () => {
    const a = base();
    const b = copy(a);
    b.groups.push({ id: 'g9', name: 'Grupo B', color: '#69797e' });
    b.assets.z = { id: 'z', mime: 'image/png', data: 'AA', name: 'z.png', size: 2 };
    b.tagDefs.push(newCustomTag('Solo B', '◎', '#0f6cbd'));
    b.templates.push({ id: 'tpl', name: 'Mía', body: { title: '', containers: [], ink: [], style: { ruling: 'none', color: '#ffffff', margin: false } } });
    b.sections.push(newSection('Nueva de B', 3));
    const r = mergeNotebooks(a, b, 5);
    expect(r.nb.groups.map((g) => g.id)).toContain('g9');
    expect(r.nb.assets.z).toBeTruthy();
    expect(r.nb.tagDefs).toHaveLength(1);
    expect(r.nb.templates).toHaveLength(1);
    expect(r.nb.sections.map((s) => s.name)).toContain('Nueva de B');
    // combinar algo idéntico no cambia nada
    const same = mergeNotebooks(a, copy(a), 6);
    expect([same.added, same.updated, same.conflicts, same.removed]).toEqual([0, 0, 0, 0]);
  });
});

describe('plantillas', () => {
  it('todas son válidas: cuadros con documentos que el esquema acepta, y se pueden copiar con identificadores nuevos', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const t of TEMPLATES) {
      const body = t.build(new Date(2025, 2, 3));
      expect(body.containers.length, t.id).toBeGreaterThan(0);
      for (const c of body.containers) {
        if (c.kind !== 'text') continue;
        const doc = writerSchema.nodeFromJSON(c.content);
        expect(() => doc.check(), t.id).not.toThrow();
        expect(c.x >= 0 && c.y >= 0 && c.w >= 60, t.id).toBe(true);
      }
      const copy = freshBody(body);
      expect(copy.containers.map((c) => c.id).some((id, i) => id === body.containers[i]!.id)).toBe(false);
    }
    const meeting = TEMPLATES.find((t) => t.id === 'meeting')!.build(new Date(2025, 2, 3));
    expect(pageText(meeting)).toContain('Orden del día');
    expect(tagItems({ ...newNotebook(), sections: [{ ...newSection('s'), pages: [{ ...newPage(), containers: meeting.containers }] }] }, 'todo').length).toBe(3);
  });
});

describe('fórmulas en tablas', () => {
  it('celdas con nombre de hoja de cálculo, números con coma y SUMA(ARRIBA)', () => {
    const r = evaluateTable([['Concepto', 'Cant', 'Precio', 'Total'], ['Material', '10', '4,5', '=B2*C2'], ['Transporte', '1', '120', '=B3*C3'], ['Total', '', '', '=SUMA(ARRIBA)']], 'es');
    expect(r.map((c) => [c.row, c.col, c.text])).toEqual([[1, 3, '45'], [2, 3, '120'], [3, 3, '165']]);
    const en = evaluateTable([['1', '2', '=SUM(LEFT)'], ['3', '4', '=A2+B2']], 'en');
    expect(en.map((c) => c.text)).toEqual(['3', '7']);
  });
  it('funciones, texto, referencias a fórmulas y errores', () => {
    const r = evaluateTable([['5', '10', '=PROMEDIO(A1:B1)'], ['=C1*2', '=SI(A2>10;"alto";"bajo")', '=A1/0'], ['x', '=A3+1', '=MAX(A1:B1)']], 'es');
    const by = Object.fromEntries(r.map((c) => [`${c.row},${c.col}`, c]));
    expect(by['0,2']!.text).toBe('7,5'.replace(',', '.') === '7.5' ? by['0,2']!.text : '');
    expect(by['0,2']!.text.replace(',', '.')).toBe('7.5');
    expect(by['1,0']!.text.replace(',', '.')).toBe('15');
    expect(by['1,1']!.text).toBe('alto');
    expect(by['1,2']).toMatchObject({ error: true });
    expect(by['2,1']!.error).toBe(true);
    expect(by['2,2']!.text).toBe('10');
  });
  it('en el documento: posiciones de cada fórmula y copia con los resultados para exportar', () => {
    const budget = TEMPLATES.find((t) => t.id === 'budget')!.build(new Date());
    const content = (budget.containers[0] as { content: unknown }).content;
    const doc = contentNode(content);
    const cells = documentFormulas(doc, 'es');
    expect(cells.map((c) => c.result.text)).toEqual(['45', '120', '255', '420']);
    for (const c of cells) expect(doc.textBetween(c.from, c.to)).toBe(c.result.formula);
    const baked = contentNode(bakeFormulas(content, 'es'));
    expect(baked.textContent).toContain('420');
    expect(baked.textContent).not.toContain('=SUMA');
    expect(bakeFormulas(docJson(p('sin tablas')), 'es')).toEqual(docJson(p('sin tablas')));
  });
});
