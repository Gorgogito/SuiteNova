// End-to-end checks for Nova Diagram in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-diagram.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=diagram';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-diagram-'));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  if (d.type() === 'confirm' && /^(¿Eliminar|Hay cambios sin guardar)/.test(d.message())) return void d.accept();
  dialogs.push(d.message());
  d.dismiss();
});

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};

const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(120);
const st = () =>
  ev(() => {
    const { ctl } = window.__novaDiagram;
    const p = ctl.basePage;
    return { shapes: p.shapes.length, connectors: p.connectors.length, pages: ctl.diagram.pages.length, sel: ctl.selShapes.length, selC: ctl.selConnectors.length, dirty: ctl.dirty, zoom: ctl.zoom };
  });
const shapes = () => ev(() => window.__novaDiagram.ctl.basePage.shapes.map((s) => ({ id: s.id, stencil: s.stencil, x: s.x, y: s.y, w: s.w, h: s.h, rot: s.rot, text: s.text, fill: s.style.fill, bold: s.font.bold, size: s.font.size, locked: s.locked })));
const conns = () => ev(() => window.__novaDiagram.ctl.basePage.connectors.map((c) => ({ id: c.id, from: c.from, to: c.to, routing: c.routing, endArrow: c.endArrow, startArrow: c.startArrow, text: c.text })));
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const press = (n) => page.getByRole('button', { name: n, exact: true }).click();
const body = (id) => page.locator(`[data-shape-id="${id}"] path`).first();
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const drag = async (a, b, steps = 8, mods = []) => {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await settle();
};
const addAt = (stencil, x, y) => ev(([s, x, y]) => window.__novaDiagram.ctl.addStencil(s, { x, y }).id, [stencil, x, y]);
const stencilBtn = (id) => page.locator(`[data-stencil="${id}"]`);
const reset = async () => {
  await ev(() => window.__novaDiagram.ctl.reset());
  await settle();
};
const dialog = () => page.getByRole('dialog');
const svgBox = () => page.locator('svg.dg-svg').boundingBox();
const d = (id) => page.locator(`[data-connector-id="${id}"] path`).first().getAttribute('d');

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.dg-app');
await page.screenshot(); // first capture after load can be blank

await check('ribbon tabs, stencil panel with five categories and search', async () => {
  for (const t of ['Inicio', 'Insertar', 'Diseño', 'Vista', 'Ayuda']) assert.ok(await page.getByRole('tab', { name: t, exact: true }).count(), t);
  for (const c of ['Formas básicas', 'Diagrama de flujo', 'UML', 'Redes', 'BPMN']) assert.ok(await page.getByRole('button', { name: c }).count(), c);
  assert.ok((await page.locator('.dg-item').count()) >= 20);
  await page.getByRole('searchbox', { name: 'Buscar formas' }).fill('rombo');
  assert.equal(await page.locator('.dg-item').count(), 1);
  await page.getByRole('searchbox', { name: 'Buscar formas' }).fill('cortafuegos');
  assert.equal(await page.locator('.dg-item').count(), 1); // search opens the closed category
  await page.getByRole('searchbox', { name: 'Buscar formas' }).fill('zzz');
  assert.ok(await page.getByText('Ninguna forma coincide.').count());
  await page.getByRole('searchbox', { name: 'Buscar formas' }).fill('');
});

await check('clicking a stencil adds a shape; dragging one drops it where released', async () => {
  await stencilBtn('process').click();
  assert.equal((await st()).shapes, 1);
  assert.equal((await st()).sel, 1);
  const sb = await svgBox();
  await stencilBtn('ellipse').dragTo(page.locator('.dg-canvas'), { targetPosition: { x: 700, y: 400 } });
  await settle();
  const s = await shapes();
  assert.equal(s.length, 2);
  assert.equal(s[1].stencil, 'ellipse');
  const b = center(await body(s[1].id).boundingBox());
  assert.ok(Math.abs(b.x - (sb.x + 700)) < 40 && Math.abs(b.y - (sb.y + 400)) < 40, `dropped at ${b.x},${b.y}`);
  assert.equal(s[1].x % 8, 0);
});

await check('move a shape with the mouse: snaps to the grid, undo restores it', async () => {
  await reset();
  const id = await addAt('process', 300, 200);
  const before = (await shapes())[0];
  const c = center(await body(id).boundingBox());
  await drag(c, { x: c.x + 101, y: c.y + 43 });
  const after = (await shapes())[0];
  assert.equal(after.x % 8, 0);
  assert.equal(after.y % 8, 0);
  assert.ok(Math.abs(after.x - before.x - 101) <= 8 && Math.abs(after.y - before.y - 43) <= 8);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await shapes())[0].x, before.x);
  // Alt ignores the grid
  const c2 = center(await body(id).boundingBox());
  await drag(c2, { x: c2.x + 13, y: c2.y + 7 }, 8, ['Alt']);
  const free = (await shapes())[0];
  assert.ok(Math.abs(free.x - before.x - 13) < 0.01, `x ${free.x - before.x}`);
});

await check('resize from a handle and rotate from the rotation handle', async () => {
  await reset();
  const id = await addAt('process', 300, 200);
  const s0 = (await shapes())[0];
  const se = await page.locator('[data-handle="se"]').boundingBox();
  const p = center(se);
  await drag(p, { x: p.x + 40, y: p.y + 24 });
  const s1 = (await shapes())[0];
  assert.equal(s1.x, s0.x);
  assert.equal(s1.y, s0.y);
  assert.ok(s1.w > s0.w + 30 && s1.h > s0.h + 16, `${s1.w}x${s1.h}`);
  const rot = center(await page.locator(`[data-rotate="${id}"]`).boundingBox());
  const sc = center(await body(id).boundingBox());
  // turn the shape to the right of its centre (90°), snapping with Shift
  await drag(rot, { x: sc.x + 120, y: sc.y }, 8, ['Shift']);
  const s2 = (await shapes())[0];
  assert.equal(s2.rot, 90);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await shapes())[0].rot, 0);
  await shot('resized');
});

await check('edit text: double click, type, Ctrl+Enter; Esc cancels; text shows in the drawing', async () => {
  await reset();
  const id = await addAt('decision', 300, 200);
  const c = center(await body(id).boundingBox());
  await page.mouse.dblclick(c.x, c.y);
  const ta = page.getByRole('textbox', { name: 'Texto de la forma' });
  await ta.fill('¿Aprobado?');
  await ta.press('Control+Enter');
  await settle();
  assert.equal((await shapes())[0].text, '¿Aprobado?');
  assert.match(await page.locator(`[data-shape-id="${id}"]`).textContent(), /¿Aprobado\?/);
  await page.keyboard.press('F2');
  await ta.fill('cambio descartado');
  await ta.press('Escape');
  await settle();
  assert.equal((await shapes())[0].text, '¿Aprobado?');
  // Enter on the canvas edits; clicking elsewhere commits
  await page.locator('.dg-scroller').focus();
  await page.keyboard.press('Enter');
  await ta.fill('Listo');
  await page.mouse.click(1000, 700);
  await settle();
  assert.equal((await shapes())[0].text, 'Listo');
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await shapes())[0].text, '¿Aprobado?');
});

await check('UML class text is split in compartments by ---', async () => {
  await reset();
  const id = await addAt('umlClass', 300, 200);
  await ev(([id]) => window.__novaDiagram.ctl.setText(id, 'Pedido\n---\n- total: Decimal\n---\n+ pagar()'), [id]);
  await settle();
  const texts = await page.locator(`[data-shape-id="${id}"] text`).count();
  assert.equal(texts, 3);
  assert.ok(await page.locator(`[data-shape-id="${id}"] text`).first().evaluate((t) => t.getAttribute('font-weight') === '700'));
});

await check('connect from a connection point; the connector follows the shape when it moves', async () => {
  await reset();
  const a = await addAt('process', 250, 200);
  const b = await addAt('process', 650, 360);
  const ca = center(await body(a).boundingBox());
  await page.mouse.move(ca.x, ca.y);
  const port = page.locator(`[data-port-shape="${a}"][data-port-index="1"]`);
  await port.waitFor();
  const pb = center(await port.boundingBox());
  const cb = center(await body(b).boundingBox());
  await drag(pb, cb);
  const list = await conns();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].from, { shape: a, port: 1 });
  assert.equal(list[0].to.shape, b);
  assert.equal(list[0].endArrow, 'arrow');
  const before = await d(list[0].id);
  const nb = center(await body(b).boundingBox());
  await drag(nb, { x: nb.x + 96, y: nb.y + 80 });
  assert.notEqual(await d(list[0].id), before);
  assert.equal((await conns()).length, 1);
  await shot('connected');
});

await check('connector tool: drag between shapes, to empty space (loose end) and re-glue an end', async () => {
  await reset();
  const a = await addAt('process', 250, 200);
  const b = await addAt('process', 650, 200);
  await tab('Inicio');
  await page.locator('[data-nv-item="diagram.tool.connector"]').click();
  const ca = center(await body(a).boundingBox());
  const cb = center(await body(b).boundingBox());
  await drag(ca, cb);
  let list = await conns();
  assert.equal(list.length, 1);
  assert.equal(list[0].from.shape, a);
  assert.equal(list[0].to.shape, b);
  // drag into empty space: a loose end
  await drag(ca, { x: ca.x + 100, y: ca.y + 200 });
  list = await conns();
  assert.equal(list.length, 2);
  assert.ok('x' in list[1].to, 'loose end');
  await press('Puntero');
  // select the loose connector and drag its loose end onto B
  const loose = list[1].id;
  await ev(([id]) => window.__novaDiagram.ctl.setSelection([], [id]), [loose]);
  await settle();
  const h = center(await page.locator(`[data-endpoint="to"][data-endpoint-for="${loose}"]`).boundingBox());
  await drag(h, { x: cb.x, y: cb.y - 10 });
  list = await conns();
  assert.equal(list[1].to.shape, b);
});

await check('connector formatting: type, arrows, label', async () => {
  await reset();
  const a = await addAt('process', 250, 200);
  const b = await addAt('process', 650, 360);
  await ev(([a, b]) => { const c = window.__novaDiagram.ctl; c.setSelection([a, b]); c.connectSelected(); }, [a, b]);
  await settle();
  await tab('Inicio');
  await press('Tipo de conector');
  await page.getByRole('menuitem', { name: 'Conector: curvo' }).click();
  await press('Extremo inicial');
  await page.getByRole('menuitem', { name: 'Extremo inicial: rombo', exact: true }).click();
  await press('Extremo final');
  await page.getByRole('menuitem', { name: 'Extremo final: flecha abierta' }).click();
  let c = (await conns())[0];
  assert.deepEqual([c.routing, c.startArrow, c.endArrow], ['curve', 'diamond', 'open']);
  assert.match(await d(c.id), /C/);
  // label: double click on the line
  const mid = await ev(([id]) => {
    const el = document.querySelector(`[data-connector-id="${id}"] path`);
    const len = el.getTotalLength();
    const pt = el.getPointAtLength(len / 2);
    const m = el.getScreenCTM();
    return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f };
  }, [c.id]);
  await page.mouse.dblclick(mid.x, mid.y);
  const ta = page.getByRole('textbox', { name: 'Texto de la forma' });
  await ta.fill('sí');
  await ta.press('Control+Enter');
  await settle();
  c = (await conns())[0];
  assert.equal(c.text, 'sí');
  assert.match(await page.locator(`[data-connector-id="${c.id}"]`).textContent(), /sí/);
  await shot('connector-format');
});

await check('select: click, Shift+click, marquee, Ctrl+A; Delete removes; connectors survive loose', async () => {
  await reset();
  const ids = [];
  for (const [x, y] of [[200, 150], [450, 150], [700, 150], [450, 350]]) ids.push(await addAt('process', x, y));
  await ev(([a, b]) => { const c = window.__novaDiagram.ctl; c.setSelection([a, b]); c.connectSelected(); }, [ids[0], ids[1]]);
  await ev(() => window.__novaDiagram.ctl.clearSelection());
  await settle();
  const c0 = center(await body(ids[0]).boundingBox());
  await page.mouse.click(c0.x, c0.y);
  assert.equal((await st()).sel, 1);
  const c1 = center(await body(ids[2]).boundingBox());
  await page.keyboard.down('Shift');
  await page.mouse.click(c1.x, c1.y);
  await page.keyboard.up('Shift');
  assert.equal((await st()).sel, 2);
  await page.mouse.click(c0.x, c0.y + 200); // empty: clears
  assert.equal((await st()).sel, 0);
  const pb = await page.locator('[data-testid="page"]').boundingBox();
  await drag({ x: pb.x + 20, y: pb.y + 20 }, { x: pb.x + 860, y: pb.y + 440 });
  assert.equal((await st()).sel, 4);
  await ev(() => window.__novaDiagram.ctl.clearSelection());
  await page.locator('.dg-scroller').focus();
  await page.keyboard.press('Control+a');
  assert.equal((await st()).sel, 4);
  assert.equal((await st()).selC, 1);
  // delete just one shape: the connector stays with a loose end
  await ev(([id]) => window.__novaDiagram.ctl.setSelection([id]), [ids[1]]);
  await page.keyboard.press('Delete');
  await settle();
  const s = await st();
  assert.equal(s.shapes, 3);
  assert.equal(s.connectors, 1);
  assert.ok('x' in (await conns())[0].to);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await st()).shapes, 4);
  assert.equal((await conns())[0].to.shape, ids[1]);
});

await check('clipboard and arrows: copy/paste, duplicate, cut, nudge', async () => {
  await reset();
  const id = await addAt('hexagon', 300, 200);
  const x0 = (await shapes())[0].x;
  await page.locator('.dg-scroller').focus();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.keyboard.press('Control+v');
  const s = await shapes();
  assert.deepEqual(s.map((q) => q.x), [x0, x0 + 24, x0 + 48]);
  await page.keyboard.press('Control+d');
  assert.equal((await st()).shapes, 4);
  await page.keyboard.press('Control+x');
  assert.equal((await st()).shapes, 3);
  await ev(([id]) => window.__novaDiagram.ctl.setSelection([id]), [id]);
  await page.locator('.dg-scroller').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal((await shapes())[0].x, x0 + 8);
  await page.keyboard.press('Shift+ArrowDown');
  assert.equal((await shapes())[0].y, s[0].y + 1);
});

await check('format from the ribbon: fill colour, line width, bold, font size, shadow', async () => {
  await reset();
  const id = await addAt('process', 300, 200);
  await tab('Inicio');
  await page.getByRole('button', { name: 'Relleno (más)' }).click();
  await page.getByRole('button', { name: '#ffc000' }).click();
  assert.equal((await shapes())[0].fill, '#ffc000');
  await press('Negrita');
  assert.equal((await shapes())[0].bold, true);
  await page.getByRole('combobox', { name: 'Tamaño de fuente' }).selectOption('20');
  assert.equal((await shapes())[0].size, 20);
  await press('Grosor');
  await page.getByRole('menuitem', { name: 'Grosor de línea: 4 px' }).click();
  assert.equal(await ev(() => window.__novaDiagram.ctl.basePage.shapes[0].style.strokeWidth), 4);
  await press('Sombra');
  assert.equal(await ev(() => window.__novaDiagram.ctl.basePage.shapes[0].style.shadow), true);
  assert.ok(await page.locator(`[data-shape-id="${id}"]`).getAttribute('filter'));
  await shot('formatted');
});

await check('align, distribute and match size from the ribbon; z-order', async () => {
  await reset();
  const ids = [];
  for (const [x, y] of [[200, 150], [330, 260], [650, 190]]) ids.push(await addAt('process', x, y));
  await ev(([a, b, c]) => window.__novaDiagram.ctl.setSelection([a, b, c]), ids);
  await settle();
  await tab('Organizar');
  await press('Alinear');
  await page.getByRole('menuitem', { name: 'Centrar verticalmente' }).click();
  const ys = (await shapes()).map((s) => s.y + s.h / 2);
  assert.equal(new Set(ys).size, 1);
  await press('Distribuir horizontalmente');
  const sh = await shapes();
  const gap1 = sh[1].x - (sh[0].x + sh[0].w);
  const gap2 = sh[2].x - (sh[1].x + sh[1].w);
  assert.ok(Math.abs(gap1 - gap2) < 0.01, `${gap1} ${gap2}`);
  await ev(([a]) => window.__novaDiagram.ctl.setSelection([a]), [ids[0]]);
  await press('Traer al frente');
  assert.equal((await shapes())[2].id, ids[0]);
  await press('Enviar al fondo');
  assert.equal((await shapes())[0].id, ids[0]);
});

await check('locked shapes do not move; unlock frees them', async () => {
  await reset();
  const id = await addAt('process', 300, 200);
  await tab('Organizar');
  await press('Bloquear forma');
  const c = center(await body(id).boundingBox());
  await drag(c, { x: c.x + 80, y: c.y });
  assert.equal(await ev(() => window.__novaDiagram.ctl.basePage.shapes[0].x), (await shapes())[0].x);
  const x0 = (await shapes())[0].x;
  assert.equal(await page.locator('[data-handle]').count(), 0);
  await press('Desbloquear forma');
  const c2 = center(await body(id).boundingBox());
  await drag(c2, { x: c2.x + 80, y: c2.y });
  assert.notEqual((await shapes())[0].x, x0);
});

await check('pages: add, switch, rename, duplicate, reorder and delete', async () => {
  await reset();
  await addAt('process', 300, 200);
  await page.getByRole('button', { name: 'Página nueva', exact: true }).first().click();
  assert.equal((await st()).pages, 2);
  assert.equal((await st()).shapes, 0);
  await page.getByRole('tab', { name: 'Página 1', exact: true }).last().click();
  assert.equal((await st()).shapes, 1);
  await tab('Insertar');
  await press('Cambiar nombre de la página…');
  await dialog().getByLabel('Nombre').fill('Resumen');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await dialog().waitFor({ state: 'hidden' });
  await settle();
  await settle();
  assert.ok(await page.getByRole('tab', { name: 'Resumen', exact: true }).count());
  await press('Duplicar página');
  assert.equal((await st()).pages, 3);
  assert.equal((await st()).shapes, 1);
  await press('Mover página a la izquierda');
  assert.equal(await ev(() => window.__novaDiagram.ctl.diagram.pages.map((p) => p.name).join('|')), 'Resumen (copia)|Resumen|Página 2');
  await press('Eliminar página');
  await settle();
  assert.equal((await st()).pages, 2);
  await tab('Inicio');
});

await check('page setup: size, grid and background; invalid values are refused; grid toggles', async () => {
  await reset();
  await tab('Diseño');
  await press('Configurar página…');
  await dialog().getByLabel('Ancho (px)').fill('50');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  assert.match(await dialog().getByRole('alert').textContent(), /entre 100 y 20000/);
  await dialog().getByLabel('Tamaño predefinido').selectOption('A4');
  await dialog().getByLabel('Cuadrícula (px, 0 = ninguna)').fill('16');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await dialog().waitFor({ state: 'hidden' });
  const p = await ev(() => { const x = window.__novaDiagram.ctl.basePage; return [x.width, x.height, x.grid]; });
  assert.deepEqual(p, [1123, 794, 16]); // A4 keeping landscape
  await press('Orientación vertical');
  assert.deepEqual(await ev(() => [window.__novaDiagram.ctl.basePage.width, window.__novaDiagram.ctl.basePage.height]), [794, 1123]);
  assert.equal(await page.locator('#dg-grid').count(), 1);
  await press('Mostrar cuadrícula');
  assert.equal(await page.locator('rect[fill="url(#dg-grid)"]').count(), 0);
  await press('Mostrar cuadrícula');
  await press('Ajustar a la cuadrícula');
  const id = await addAt('process', 300, 200);
  const c = center(await body(id).boundingBox());
  const x0 = (await shapes())[0].x;
  await drag(c, { x: c.x + 13, y: c.y });
  assert.equal((await shapes())[0].x, x0 + 13 - ((x0 + 13) % 1)); // no snapping with the option off
  await press('Ajustar a la cuadrícula');
  await tab('Inicio');
});

await check('zoom with Ctrl+wheel and fit to window', async () => {
  await reset();
  await page.locator('.dg-scroller').hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await settle();
  assert.equal((await st()).zoom, 110);
  await tab('Vista');
  await press('Ajustar a la ventana');
  const z = (await st()).zoom;
  assert.ok(z >= 10 && z < 200, `zoom ${z}`);
  const sc = await page.locator('.dg-scroller').boundingBox();
  const pg = await page.locator('[data-testid="page"]').boundingBox();
  assert.ok(pg.width <= sc.width && pg.height <= sc.height + 1, 'the page fits');
  await tab('Inicio');
  await ev(() => window.__novaDiagram.ctl.setZoom(100));
});

await check('save as .novadiagram and reopen it identical; damaged files are refused', async () => {
  await reset();
  const a = await addAt('terminator', 250, 150);
  const b = await addAt('umlClass', 600, 250);
  await ev(([a, b]) => { const c = window.__novaDiagram.ctl; c.setText(a, 'Inicio'); c.setText(b, 'A\n---\nx\n---\ny()'); c.setSelection([a, b]); c.connectSelected(); c.newPage(); c.addStencil('cloud', { x: 300, y: 300 }); c.goToPage(c.diagram.pages[0].id); }, [a, b]);
  const sig = () => ev(() => JSON.stringify(window.__novaDiagram.ctl.diagram));
  const before = await sig();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  assert.match(dl.suggestedFilename(), /\.novadiagram$/);
  JSON.parse(fs.readFileSync(file, 'utf8'));
  await reset();
  assert.equal((await st()).shapes, 0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaDiagram.ctl.diagram.pages.length === 2);
  assert.equal(await sig(), before);
  assert.equal((await st()).dirty, false);
  const bad = path.join(tmp, 'roto.novadiagram');
  fs.writeFileSync(bad, '{"format":"novadiagram","pages":');
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await c2.setFiles(bad);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /no es un diagrama/);
  const vsd = path.join(tmp, 'viejo.vsd');
  fs.writeFileSync(vsd, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  const [c3] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await c3.setFiles(vsd);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /\.vsd.*vsdx/);
  assert.equal(await sig(), before);
});

await check('export SVG and PNG', async () => {
  await ev(() => window.__novaDiagram.ctl.goToPage(window.__novaDiagram.ctl.diagram.pages[0].id));
  await tab('Diseño');
  await press('Exportar');
  const [sv] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /SVG/ }).click()]);
  const sf = path.join(tmp, sv.suggestedFilename());
  await sv.saveAs(sf);
  const svg = fs.readFileSync(sf, 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /Inicio/);
  assert.ok((svg.match(/<path /g) ?? []).length >= 6);
  // the exported file is a picture the browser can draw
  const ok = await page.evaluate(async (s) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' })); });
    return [img.width, img.height];
  }, svg);
  assert.deepEqual(ok, [1123, 794]);
  await press('Exportar');
  await page.getByRole('menuitem', { name: /PNG/ }).click();
  await dialog().getByLabel('Zona').selectOption('page');
  await dialog().getByLabel('Escala').selectOption('2');
  const [pn] = await Promise.all([page.waitForEvent('download'), dialog().getByRole('button', { name: 'Exportar', exact: true }).click()]);
  const pf = path.join(tmp, pn.suggestedFilename());
  await pn.saveAs(pf);
  const png = fs.readFileSync(pf);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 2246);
  assert.equal(png.readUInt32BE(20), 1588);
  await dialog().waitFor({ state: 'hidden' });
  await tab('Inicio');
});

await check('export to Visio (.vsdx) and import it back', async () => {
  await tab('Diseño');
  await press('Exportar');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Visio/ }).click()]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  assert.ok(zip.file('visio/document.xml'));
  assert.ok(zip.file('visio/pages/page1.xml'));
  assert.ok(zip.file('visio/pages/page2.xml'));
  assert.match(await zip.file('visio/pages/page1.xml').async('string'), /Inicio/);
  const before = await ev(() => window.__novaDiagram.ctl.diagram.pages.map((p) => [p.shapes.length, p.connectors.length, p.shapes.map((s) => s.text).join('|')]));
  await reset();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Importar de Visio (.vsdx)…' }).click()]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaDiagram.ctl.diagram.pages.length === 2);
  const after = await ev(() => window.__novaDiagram.ctl.diagram.pages.map((p) => [p.shapes.length, p.connectors.length, p.shapes.map((s) => s.text).join('|')]));
  assert.deepEqual(after, before);
  assert.equal(await ev(() => window.__novaDiagram.ctl.dirty), true, 'imported drawings are unsaved');
  await shot('vsdx-imported');
  await tab('Inicio');
});

await check('print builds a page per diagram page with the drawing as SVG', async () => {
  await tab('Diseño');
  await press('Exportar');
  await page.getByRole('menuitem', { name: /Imprimir/ }).click();
  await page.waitForSelector('iframe[srcdoc]', { state: 'attached' });
  const html = await page.locator('iframe[srcdoc]').getAttribute('srcdoc');
  assert.equal((html.match(/<section /g) ?? []).length, 2);
  assert.equal((html.match(/<svg /g) ?? []).length, 2);
  assert.match(html, /@page\{size:1123px 794px/);
  await tab('Inicio');
});

await check('five hundred shapes and three hundred connectors stay responsive', async () => {
  await reset();
  await ev(() => {
    const { ctl } = window.__novaDiagram;
    const shapes = [];
    for (let i = 0; i < 500; i++) shapes.push({ id: `s${i}`, stencil: ['process', 'decision', 'ellipse', 'umlClass', 'cloud'][i % 5], x: 40 + (i % 25) * 150, y: 40 + Math.floor(i / 25) * 100, w: 110, h: 60, rot: 0, text: `Forma ${i}`, style: { fill: '#ffffff', stroke: '#2f4f6f', strokeWidth: 1.5, dash: 'solid', opacity: 1, shadow: false }, font: { family: 'Segoe UI', size: 13, color: '#1b1b1b', bold: false, italic: false, underline: false, align: 'center', valign: 'middle' }, locked: false });
    const connectors = [];
    for (let i = 0; i < 300; i++) connectors.push({ id: `c${i}`, from: { shape: `s${i}`, port: 'auto' }, to: { shape: `s${i + 1}`, port: 'auto' }, routing: 'elbow', stroke: '#2f4f6f', strokeWidth: 1.5, dash: 'solid', startArrow: 'none', endArrow: 'arrow', text: '', font: { family: 'Segoe UI', size: 12, color: '#1b1b1b', bold: false, italic: false, underline: false, align: 'center', valign: 'middle' } });
    const d = ctl.diagram;
    ctl.commit({ ...d, pages: [{ ...d.pages[0], width: 4000, height: 2200, shapes, connectors }] });
  });
  await page.waitForSelector('[data-shape-id="s499"]', { state: 'attached', timeout: 15000 });
  assert.equal(await page.locator('[data-shape-id]').count(), 500);
  assert.equal(await page.locator('[data-connector-id]').count(), 300);
  const c = center(await body('s0').boundingBox());
  const t0 = Date.now();
  await drag(c, { x: c.x + 60, y: c.y + 30 }, 20);
  const dt = Date.now() - t0;
  assert.ok(dt < 6000, `a 20-step drag took ${dt} ms`);
  assert.equal((await st()).dirty, true);
  await ev(() => window.__novaDiagram.ctl.selectAll());
  const t1 = Date.now();
  await page.locator('.dg-scroller').focus();
  await page.keyboard.press('ArrowRight');
  await settle();
  assert.ok(Date.now() - t1 < 4000, 'nudging everything');
});

await check('mirror, pictures, links and shape data (panel, {{name}} in text, CSV), saved and exported', async () => {
  await ev(() => window.__novaDiagram.ctl.reset());
  await settle();
  const S = () => ev(() => window.__novaDiagram.ctl.basePage.shapes.map((s) => ({ id: s.id, stencil: s.stencil, flipH: s.flipH, flipV: s.flipV, link: s.link, data: s.data, image: s.image ? { fit: s.image.fit, ok: s.image.src.startsWith('data:image/png') } : null, text: s.text, showData: s.showData })));
  // mirror
  const a = await addAt('arrowRight', 300, 200);
  await ev((id) => window.__novaDiagram.ctl.setSelection([id]), a);
  await tab('Organizar');
  await press('Reflejar horizontalmente');
  assert.equal((await S())[0].flipH, true);
  await press('Reflejar verticalmente');
  assert.equal((await S())[0].flipV, true);
  await ev(() => window.__novaDiagram.ctl.undo());
  assert.equal((await S())[0].flipV, undefined, 'mirroring is one undo step');
  // text is not mirrored: the <text> is outside the mirrored group
  assert.equal(await page.locator(`[data-shape-id="${a}"] > g[transform*="scale(-1 1)"] text`).count(), 0);
  // picture
  const png = await ev(() => { const cv = document.createElement('canvas'); cv.width = 240; cv.height = 120; const g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 240, 0); gr.addColorStop(0, '#e03131'); gr.addColorStop(1, '#1971c2'); g.fillStyle = gr; g.fillRect(0, 0, 240, 120); g.fillStyle = '#fff'; g.font = '30px sans-serif'; g.fillText('Foto', 90, 70); return cv.toDataURL('image/png').split(',')[1]; });
  await tab('Contenido');
  await page.locator('[data-testid=dg-image-input]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => window.__novaDiagram.ctl.basePage.shapes.some((s) => s.stencil === 'image'));
  const img = (await S()).find((s) => s.stencil === 'image');
  assert.deepEqual(img.image, { fit: 'contain', ok: true });
  assert.equal(await page.locator(`[data-shape-id="${img.id}"] image`).count(), 1, 'the picture is drawn');
  await press('Rellenar la forma con la imagen');
  assert.equal((await S()).find((s) => s.stencil === 'image').image.fit, 'cover');
  await shot('diagram-picture');
  // links
  await press('Vínculo…');
  const d = page.getByRole('dialog');
  await d.getByLabel('Dirección', { exact: true }).fill('javascript:alert(1)');
  assert.ok(await d.getByRole('alert').count(), 'an unsafe address is refused');
  await d.getByLabel('Dirección', { exact: true }).fill('https://example.org/ayuda');
  await d.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await S()).find((s) => s.stencil === 'image').link.url, 'https://example.org/ayuda');
  assert.equal(await page.locator('.dg-linkbadge').count(), 1);
  const box = await body(img.id).boundingBox();
  await ev(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await page.keyboard.down('Control');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Control');
  await settle();
  assert.deepEqual(await ev(() => window.__opened), ['https://example.org/ayuda'], 'Ctrl+click follows the web link');
  // a link to another page
  await ev(() => { const c = window.__novaDiagram.ctl; c.newPage(); c.goToPage(c.diagram.pages[0].id); c.setSelection([c.basePage.shapes.find((s) => s.stencil === 'image').id]); });
  await press('Vínculo…');
  await page.getByRole('dialog').getByLabel('Vincular a').selectOption('page');
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const link = (await S()).find((s) => s.stencil === 'image').link;
  assert.ok(link.page);
  const box2 = await body(img.id).boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.keyboard.up('Control');
  await settle();
  assert.equal(await ev(() => window.__novaDiagram.ctl.pageId), link.page, 'a page link goes to that page');
  await ev(() => { const c = window.__novaDiagram.ctl; c.goToPage(c.diagram.pages[0].id); c.setSelection([c.basePage.shapes[0].id]); });
  // data
  await press('Datos de forma');
  const pane = page.locator('[data-testid=data-pane]');
  await pane.getByLabel('Nombre del dato nuevo').fill('Costo');
  await pane.getByRole('button', { name: 'Agregar dato', exact: true }).click();
  await pane.getByLabel('Valor del dato 1').fill('120');
  await ev(() => { const c = window.__novaDiagram.ctl; c.setText(c.basePage.shapes[0].id, 'Total {{costo}}'); });
  await settle();
  assert.match(await page.locator(`[data-shape-id="${a}"]`).textContent(), /Total 120/);
  await press('Mostrar los datos bajo la forma');
  assert.match(await page.locator(`[data-shape-id="${a}"]`).textContent(), /Costo: 120/);
  await shot('diagram-data');
  const [dl] = await Promise.all([page.waitForEvent('download'), press('Exportar los datos de las formas (CSV)…')]);
  const csvPath = path.join(tmp, 'datos.csv');
  await dl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  assert.match(csv, /Costo/);
  assert.match(csv, /120/);
  // saved and read back
  const saved = await ev(() => JSON.stringify({ format: 'novadiagram', ...window.__novaDiagram.ctl.diagram }));
  await ev((txt) => window.__novaDiagram.load(txt, 'x.novadiagram'), saved);
  await settle();
  const again = await S();
  assert.equal(again[0].flipH, true);
  assert.deepEqual(again[0].data, [{ name: 'Costo', value: '120', type: 'text' }]);
  assert.equal(again.find((s) => s.stencil === 'image').image.fit, 'cover');
  assert.ok(again.find((s) => s.stencil === 'image').link.page);
});

await check('groups (select together, move, resize and turn as a block, sub-select, ungroup) and layers (hide, lock, active layer, assign), saved', async () => {
  await ev(() => window.__novaDiagram.ctl.reset());
  await settle();
  const ids = [await addAt('rect', 200, 200), await addAt('ellipse', 420, 200), await addAt('rect', 640, 380)];
  const G = () => ev(() => window.__novaDiagram.ctl.basePage.shapes.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, rot: s.rot, group: s.group, layer: s.layer })));
  const sel = () => ev(() => window.__novaDiagram.ctl.selShapes.length);
  await ev(() => window.__novaDiagram.ctl.selectAll());
  await tab('Organizar');
  await press('Agrupar');
  let gs = await G();
  assert.ok(gs[0].group && gs.every((s) => s.group === gs[0].group), 'the three shapes share a group');
  await ev(() => window.__novaDiagram.ctl.clearSelection());
  await body(ids[1]).click();
  assert.equal(await sel(), 3, 'clicking one selects the whole group');
  // moving one member moves the group
  const c0 = center(await body(ids[0]).boundingBox());
  await drag(c0, { x: c0.x + 50, y: c0.y + 30 });
  const moved = await G();
  assert.ok(moved.every((s, i) => Math.abs(s.x - gs[i].x - 48) <= 9 && Math.abs(s.y - gs[i].y - 32) <= 9), 'all members moved by the same amount');
  // resizing the block scales every member
  const w0 = moved.reduce((m, s) => Math.max(m, s.x + s.w), 0) - moved.reduce((m, s) => Math.min(m, s.x), 1e9);
  const hb = center(await page.locator('[data-bhandle=se]').boundingBox());
  await drag(hb, { x: hb.x + 100, y: hb.y + 40 });
  const grown = await G();
  const w1 = grown.reduce((m, s) => Math.max(m, s.x + s.w), 0) - grown.reduce((m, s) => Math.min(m, s.x), 1e9);
  assert.ok(w1 > w0 + 60, `the block got wider (${Math.round(w0)} → ${Math.round(w1)})`);
  assert.ok(grown[0].w > moved[0].w, 'each member got wider');
  await shot('diagram-group');
  // turning the block
  const rb = center(await page.locator('[data-brotate]').boundingBox());
  const bb = await page.locator('[data-testid=block] rect.dg-multibox').boundingBox();
  const cc = center(bb);
  await drag(rb, { x: cc.x + (cc.y - rb.y), y: cc.y }, 10);
  const turned = await G();
  assert.ok(turned.every((s) => s.rot > 30 && s.rot < 150), `members turned together (${turned.map((s) => Math.round(s.rot))})`);
  await ev(() => window.__novaDiagram.ctl.undo());
  // a second click on a member of the selected group selects only that member
  await body(ids[2]).click();
  assert.equal(await sel(), 1, 'a click on a selected group member picks it alone');
  // ungroup
  await ev(() => window.__novaDiagram.ctl.setSelection(window.__novaDiagram.ctl.basePage.shapes.map((s) => s.id)));
  await tab('Organizar');
  await press('Desagrupar');
  assert.ok((await G()).every((s) => !s.group), 'ungrouped');
  await ev(() => window.__novaDiagram.ctl.undo());
  assert.ok((await G()).every((s) => s.group), 'ungroup is one undo step');

  // layers
  await ev(() => window.__novaDiagram.ctl.clearSelection());
  await tab('Estructura');
  await press('Capas');
  const pane = page.locator('[data-testid=layers-pane]');
  assert.equal(await pane.locator('li').count(), 1);
  await pane.getByRole('button', { name: 'Capa nueva', exact: true }).click();
  assert.equal(await pane.locator('li').count(), 2);
  const extra = await addAt('triangle', 300, 520);
  const layers = await ev(() => window.__novaDiagram.ctl.basePage.layers.map((l) => l.id));
  assert.equal((await G()).find((s) => s.id === extra).layer, layers[1], 'a new shape goes to the active layer');
  // hide the new layer
  await pane.getByLabel('Capa 2: visible').uncheck();
  assert.equal(await page.locator(`[data-shape-id="${extra}"]`).count(), 0, 'a hidden layer is not drawn');
  await pane.getByLabel('Capa 2: visible').check();
  assert.equal(await page.locator(`[data-shape-id="${extra}"]`).count(), 1);
  // lock it
  await pane.getByLabel('Capa 2: bloqueada').check();
  const bx = center(await body(extra).boundingBox());
  await page.mouse.click(bx.x, bx.y);
  assert.equal(await sel(), 0, 'a locked layer cannot be selected');
  await ev(() => window.__novaDiagram.ctl.selectAll());
  assert.equal(await sel(), 3, 'select all leaves out the locked layer');
  await pane.getByLabel('Capa 2: bloqueada').uncheck();
  // assign the selection to layer 2
  await ev((id) => window.__novaDiagram.ctl.setSelection([id]), ids[0]);
  await pane.getByRole('button', { name: 'Pasar la selección a la capa activa', exact: true }).click();
  assert.equal((await G()).find((s) => s.id === ids[0]).layer, layers[1]);
  await shot('diagram-layers');
  // saved and read back
  const saved = await ev(() => JSON.stringify({ format: 'novadiagram', ...window.__novaDiagram.ctl.diagram }));
  await ev((txt) => window.__novaDiagram.load(txt, 'x.novadiagram'), saved);
  await settle();
  const again = await G();
  assert.ok(again.filter((s) => s.id !== extra).every((s) => s.group));
  assert.equal(await ev(() => window.__novaDiagram.ctl.basePage.layers.length), 2);
  assert.equal(again.find((s) => s.id === ids[0]).layer, layers[1]);
});

await check('containers and swimlanes: members follow, size grows/fits by itself, wrap selection, lanes (grow, resize, rename, add, remove), saved', async () => {
  await ev(() => window.__novaDiagram.ctl.reset());
  await settle();
  const P = () => ev(() => window.__novaDiagram.ctl.basePage.shapes.map((s) => ({ id: s.id, stencil: s.stencil, x: s.x, y: s.y, w: s.w, h: s.h, parent: s.parent, lane: s.lane, c: s.container ? { auto: s.container.autoSize, lanes: s.container.lanes?.map((l) => ({ id: l.id, title: l.title, size: l.size })) } : null })));
  const by = (arr, id) => arr.find((s) => s.id === id);
  // a container holds what is inside it
  const box = await addAt('container', 400, 300);
  const inner = await addAt('rect', 400, 330);
  let s0 = await P();
  assert.equal(by(s0, inner).parent, box, 'a shape inside is held');
  assert.equal((await P())[0].id, box, 'the container is behind');
  // moving the container by its title band moves the member
  const bb = await page.locator(`[data-shape-id="${box}"] path`).first().boundingBox();
  const grab = { x: bb.x + bb.width / 2, y: bb.y + 10 };
  await drag(grab, { x: grab.x + 80, y: grab.y + 40 });
  const s1 = await P();
  assert.ok(Math.abs(by(s1, inner).x - by(s0, inner).x - 80) <= 9 && Math.abs(by(s1, box).x - by(s0, box).x - 80) <= 9, 'the member moved with its container');
  // drag the member towards the right edge: the container grows to keep it with its margin
  const mc = center(await body(inner).boundingBox());
  const cw0 = by(s1, box).w;
  await drag(mc, { x: mc.x + 150, y: mc.y }, 10);
  const s2 = await P();
  assert.ok(by(s2, box).w > cw0 + 20, `the container grew (${cw0} → ${by(s2, box).w})`);
  assert.equal(by(s2, inner).parent, box);
  // "always fit" makes it shrink around the member
  await ev((id) => window.__novaDiagram.ctl.setSelection([id]), box);
  await tab('Estructura');
  await press('Tamaño del contenedor: siempre ajustado');
  const s3 = await P();
  assert.ok(by(s3, box).w < by(s2, box).w, 'fit shrinks it');
  assert.equal(by(s3, box).c.auto, 'fit');
  await shot('diagram-container');
  // wrap a selection
  const a = await addAt('rect', 200, 600);
  const b = await addAt('ellipse', 340, 640);
  await ev(([x, y]) => window.__novaDiagram.ctl.setSelection([x, y]), [a, b]);
  await press('Rodear con un contenedor');
  const s4 = await P();
  const wrap = s4.find((s) => s.stencil === 'container' && s.id !== box);
  assert.ok(wrap && by(s4, a).parent === wrap.id && by(s4, b).parent === wrap.id, 'the container surrounds both shapes');

  // a swimlane pool
  await ev(() => window.__novaDiagram.ctl.reset());
  await settle();
  const pool = await addAt('pool', 480, 330);
  let q = await P();
  const lanes = by(q, pool).c.lanes;
  assert.equal(lanes.length, 3);
  const pl = by(q, pool);
  const m = await addAt('rect', pl.x + 300, pl.y + 100 + 50);
  q = await P();
  assert.equal(by(q, m).lane, lanes[1].id, 'a shape belongs to the lane it is in');
  // dragging it down inside lane 2 beyond its limit makes the lane taller
  const mc2 = center(await body(m).boundingBox());
  await drag(mc2, { x: mc2.x, y: mc2.y + 36 }, 8);
  q = await P();
  const lane2 = by(q, pool).c.lanes[1].size;
  assert.ok(lane2 > 100, `lane 2 grew to ${Math.round(lane2)}`);
  // the lane grip resizes by hand
  await ev((id) => window.__novaDiagram.ctl.setSelection([id]), pool);
  await settle();
  const grip = center(await page.locator(`[data-lane-grip="${lanes[0].id}"]`).boundingBox());
  await drag(grip, { x: grip.x, y: grip.y + 40 }, 8);
  q = await P();
  assert.ok(by(q, pool).c.lanes[0].size >= 130, `lane 1 resized (${by(q, pool).c.lanes[0].size})`);
  // rename a lane with a double click on its title
  const t0 = await page.locator(`[data-shape-id="${pool}"] text`).first().boundingBox();
  await page.mouse.dblclick(t0.x + t0.width / 2, t0.y + t0.height / 2);
  await page.getByLabel('Nombre del carril').fill('Ventas');
  await page.keyboard.press('Enter');
  await settle();
  assert.equal(by(await P(), pool).c.lanes[0].title, 'Ventas');
  // add and remove lanes
  await ev((id) => window.__novaDiagram.ctl.setSelection([id]), pool);
  await page.getByRole('button', { name: /Agregar un carril después de Ventas/ }).click();
  q = await P();
  assert.equal(by(q, pool).c.lanes.length, 4);
  assert.equal(by(q, m).lane, lanes[1].id, 'members stay in their lane when a lane is added');
  await page.getByRole('button', { name: 'Quitar el carril Carril 4' }).click();
  assert.equal(by(await P(), pool).c.lanes.length, 3);
  await shot('diagram-pool');
  // saved and read back
  const saved = await ev(() => JSON.stringify({ format: 'novadiagram', ...window.__novaDiagram.ctl.diagram }));
  await ev((txt) => window.__novaDiagram.load(txt, 'x.novadiagram'), saved);
  await settle();
  q = await P();
  assert.equal(by(q, pool).c.lanes.length, 3);
  assert.equal(by(q, pool).c.lanes[0].title, 'Ventas');
  assert.equal(by(q, m).parent, pool);
});

await check('several connectors at one connection point are spread apart (and meet again when the spacing is 0)', async () => {
  await ev(() => window.__novaDiagram.ctl.reset());
  await settle();
  const t = await addAt('rect', 800, 300);
  const srcs = [await addAt('rect', 200, 120), await addAt('rect', 200, 300), await addAt('rect', 200, 480)];
  await ev(([t, srcs]) => { const c = window.__novaDiagram.ctl; for (const s of srcs) c.addConnectorBetween({ shape: s, port: 1 }, { shape: t, port: 3 }); }, [t, srcs]);
  await settle();
  const ends = () => page.locator('[data-connector-id] > path:first-child').evaluateAll((els) => els.map((e) => { const d = e.getAttribute('d'); const nums = d.match(/-?[\d.]+/g).map(Number); return { x: nums[nums.length - 2], y: nums[nums.length - 1] }; }));
  let e = await ends();
  assert.equal(e.length, 3);
  assert.ok(new Set(e.map((p) => Math.round(p.y))).size === 3, `three different heights (${JSON.stringify(e)})`);
  assert.ok(e.every((p) => Math.abs(p.x - e[0].x) < 0.5), 'all on the same side of the shape');
  const sorted = [...e].map((p) => p.y).sort((a, b) => a - b);
  assert.ok(Math.abs(sorted[1] - sorted[0] - 10) < 0.6, 'ten pixels apart');
  await shot('diagram-spread');
  // the spacing is a page setting
  await tab('Diseño');
  await press('Configurar página…');
  const d = page.getByRole('dialog');
  await d.getByLabel('Separación de conectores en un mismo punto (px, 0 = juntos)').fill('0');
  await d.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  e = await ends();
  assert.equal(new Set(e.map((p) => Math.round(p.y))).size, 1, 'at 0 they meet at the point');
  assert.equal(await ev(() => window.__novaDiagram.ctl.basePage.spread), 0);
});

await check('automatic layout: layered, tree, radial, circular, grid, organic; direction, options, one undo step, selection only', async () => {
  await ev(() => window.__novaDiagram.ctl.reset());
  await settle();
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  const at = { a: [700, 500], b: [150, 150], c: [400, 650], d: [900, 160], e: [260, 420], f: [820, 320] };
  const ids = {};
  for (const n of names) ids[n] = await addAt('rect', at[n][0], at[n][1]);
  await ev(([ids]) => { const c = window.__novaDiagram.ctl; for (const [a, b] of [['a', 'b'], ['a', 'c'], ['b', 'd'], ['b', 'e'], ['c', 'f']]) c.addConnectorBetween({ shape: ids[a], port: 'auto' }, { shape: ids[b], port: 'auto' }); c.clearSelection(); }, [ids]);
  const pos = () => ev((ids) => Object.fromEntries(Object.entries(ids).map(([k, id]) => { const s = window.__novaDiagram.ctl.basePage.shapes.find((x) => x.id === id); return [k, { x: s.x, y: s.y, w: s.w, h: s.h }]; })), ids);
  const run = async (label) => { await tab('Diseño'); await page.getByRole('button', { name: 'Diseño automático', exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); await settle(); };
  const undoDepth = () => ev(() => window.__novaDiagram.ctl.past?.length ?? null).catch(() => null);
  // layered, top to bottom
  await run('Diseño jerárquico (por capas)');
  let p = await pos();
  assert.ok(p.b.y > p.a.y && p.c.y > p.a.y && p.d.y > p.b.y && p.e.y > p.b.y && p.f.y > p.c.y, 'children are below their parents');
  assert.ok(Math.abs(p.b.y - p.c.y) < 1 && Math.abs(p.d.y - p.e.y) < 1, 'layers are aligned');
  await shot('diagram-layout');
  // one undo step brings the old arrangement back
  await ev(() => window.__novaDiagram.ctl.undo());
  p = await pos();
  assert.ok(Math.abs(p.a.x - 700 + 60) < 80, 'undo restores the first arrangement');
  // left to right
  await page.getByRole('button', { name: 'Dirección', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Dirección: de izquierda a derecha', exact: true }).click();
  await run('Diseño jerárquico (por capas)');
  p = await pos();
  assert.ok(p.b.x > p.a.x && p.d.x > p.b.x, 'left to right');
  // the other kinds run and keep every shape on the page
  for (const label of ['Diseño de árbol', 'Diseño radial', 'Diseño circular', 'Diseño en cuadrícula', 'Diseño orgánico']) {
    await run(label);
    p = await pos();
    assert.ok(Object.values(p).every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)), label);
  }
  // options: larger spacing makes the layers farther apart
  await run('Diseño jerárquico (por capas)');
  const gap0 = (await pos()).b.x - (await pos()).a.x;
  await page.getByRole('button', { name: 'Diseño automático', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Opciones del diseño automático…', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Separación entre niveles (px)').fill('160');
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await run('Diseño jerárquico (por capas)');
  const gap1 = (await pos()).b.x - (await pos()).a.x;
  assert.ok(gap1 > gap0 + 60, `levels farther apart (${Math.round(gap0)} → ${Math.round(gap1)})`);
  // only the selected shapes are laid out
  await ev(([ids]) => { const c = window.__novaDiagram.ctl; c.setSelection([ids.d, ids.e, ids.f]); }, [ids]);
  const before = await pos();
  await run('Diseño en cuadrícula');
  const after = await pos();
  assert.deepEqual(after.a, before.a, 'shapes that were not selected stay');
  assert.deepEqual(after.b, before.b);
});

await shot('final');
await browser.close();

const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of results) console.log(r[0].padEnd(4), r[1], r[2] ? `\n     ${r[2]}` : '');
if (errors.length) console.log('\nconsole errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length || errors.length ? 1 : 0);
