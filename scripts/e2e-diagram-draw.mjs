// Nova Diagram, drawing as in Visio (phase 4), in a real browser (Edge). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-diagram-draw.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=diagram';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new globalThis.URL(URL).origin });
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
};
const page = await ctx.newPage();
watch(page);

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
const settle = (ms = 150) => page.waitForTimeout(ms);
const open = async (p) => {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await p.waitForSelector('.dg-app', { timeout: 90000 });
  await p.waitForFunction(() => window.__novaDiagram);
};
const shapes = () => ev(() => window.__novaDiagram.ctl.basePage.shapes.map((s) => ({ id: s.id, stencil: s.stencil, x: s.x, y: s.y, w: s.w, h: s.h, rot: s.rot, text: s.text, fill: s.style.fill })));
const conns = () => ev(() => window.__novaDiagram.ctl.basePage.connectors.map((c) => ({ id: c.id, from: c.from, to: c.to, text: c.text })));
const guides = () => ev(() => window.__novaDiagram.ctl.basePage.guides ?? []);
const selected = () => ev(() => window.__novaDiagram.ctl.selShapes);
const addAt = (stencil, x, y, text = '') =>
  ev(([s, x, y, text]) => { const c = window.__novaDiagram.ctl; const id = c.addStencil(s, { x, y }).id; if (text) c.setText(id, text); c.clearSelection(); return id; }, [stencil, x, y, text]);
const reset = async () => {
  await ev(() => { const c = window.__novaDiagram.ctl; c.reset(); c.closeFind(); c.pane = 'none'; c.setZoom(100); });
  await ev(() => { const el = document.querySelector('.dg-scroller'); el.scrollLeft = 130; el.scrollTop = 130; });
  await settle();
};
const body = (id) => page.locator(`[data-shape-id="${id}"] path`).first();
const mid = async (id) => { const b = await body(id).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
/** A point of the page on screen. */
const at = (x, y) => ev(([x, y]) => { const m = document.querySelector('svg.dg-svg').getScreenCTM(); const p = new DOMPoint(x, y).matrixTransform(m); return { x: p.x, y: p.y }; }, [x, y]);
const drag = async (a, b, mods = [], up = true) => {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  if (up) {
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
  }
  await settle();
};
const focus = () => page.locator('.dg-scroller').focus();
const menuItem = (name) => page.getByRole('menu').getByRole(/menuitem/, { name }).first();
const item = (name) => page.locator('.ml-menu button', { has: page.locator('.ml-menu__label', { hasText: name }) }).first();
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();

await open(page);
await page.screenshot();

await check('the arrows around a shape add the next one, connected, and the quick shapes choose which', async () => {
  await reset();
  const a = await addAt('terminator', 300, 200, 'Inicio');
  const c = await mid(a);
  await page.mouse.move(c.x, c.y);
  const south = page.locator(`[data-auto="s"][data-auto-for="${a}"]`);
  await south.waitFor();
  assert.equal(await page.locator('[data-auto]').count(), 4);
  await south.hover();
  await page.locator('.dg-quick').waitFor();
  await shot('flechas-y-formas-rapidas');
  assert.equal(await page.locator('.dg-quick button').count(), 4);
  await south.click();
  await settle();
  let s = await shapes();
  assert.deepEqual(s.map((x) => x.stencil), ['terminator', 'process']);
  assert.equal((await conns()).length, 1);
  assert.deepEqual(await selected(), [s[1].id]);
  // a chosen shape, from the side of the new one
  const n = s[1].id;
  const cn = await mid(n);
  await page.mouse.move(cn.x, cn.y);
  const east = page.locator(`[data-auto="e"][data-auto-for="${n}"]`);
  await east.waitFor();
  await east.hover();
  await page.locator('.dg-quick').getByRole('button', { name: 'Decisión' }).click();
  await settle();
  s = await shapes();
  assert.equal(s[2].stencil, 'decision');
  assert.ok(s[2].x > s[1].x + s[1].w);
  assert.equal((await conns()).length, 2);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await shapes()).length, 2);
});

await check('a moved shape lines up with others, shows the guide, and Alt lets it go free', async () => {
  await reset();
  const a = await addAt('process', 250, 200);
  const b = await addAt('process', 520, 380);
  const s0 = await shapes();
  const c = await mid(b);
  // bring b to 4 px of the same height as a: it jumps into line
  const dy = s0[0].y - s0[1].y + 4;
  await drag(c, { x: c.x + 13, y: c.y + dy }, [], false);
  assert.ok((await page.locator('[data-snap="align"]').count()) > 0, 'a guide line shows');
  // the outline of the selection goes with the shape
  const [outline, drawn] = await Promise.all([page.locator(`[data-selected="${b}"]`).boundingBox(), body(b).boundingBox()]);
  assert.ok(Math.abs(outline.y - drawn.y) < 3, `outline ${outline.y} shape ${drawn.y}`);
  await shot('guia-inteligente');
  await page.mouse.up();
  await settle();
  let s = await shapes();
  assert.equal(s[1].y, s[0].y);
  assert.equal(await page.locator('[data-snap]').count(), 0);
  await page.keyboard.press('Control+z');
  await settle();
  const c2 = await mid(b);
  await drag(c2, { x: c2.x + 13, y: c2.y + dy }, ['Alt']);
  s = await shapes();
  assert.ok(Math.abs(s[1].y - s[0].y - 4) < 0.5, `free ${s[1].y - s[0].y}`);
  void a;
});

await check('rulers: a guide is pulled out, shapes stick to it, and it goes back to the ruler', async () => {
  await reset();
  assert.equal(await page.locator('[data-ruler]').count(), 2);
  const a = await addAt('process', 300, 200);
  const left = await page.locator('[data-ruler="v"]').boundingBox();
  const target = await at(500, 250);
  await drag({ x: left.x + left.width / 2, y: target.y }, target);
  let g = await guides();
  assert.equal(g.length, 1);
  assert.equal(g[0].axis, 'x');
  assert.ok(Math.abs(g[0].pos - 500) <= 8, `${g[0].pos}`);
  // the shape sticks to it by its left edge
  const s0 = (await shapes())[0];
  const c = await mid(a);
  await drag(c, { x: c.x + (g[0].pos - s0.x) + 3, y: c.y + 100 });
  assert.equal((await shapes())[0].x, g[0].pos);
  await shot('regla-y-guia');
  // a guide is moved, deleted with the key, and thrown back on its ruler
  const on = await at(g[0].pos, 470);
  await drag(on, await at(g[0].pos + 120, 470));
  assert.ok((await guides())[0].pos > g[0].pos + 100);
  await focus();
  const moved = await at((await guides())[0].pos, 450);
  await page.mouse.click(moved.x, moved.y);
  await page.keyboard.press('Delete');
  await settle();
  assert.equal((await guides()).length, 0);
  assert.equal((await shapes()).length, 1, 'Delete took the guide, not the shape');
  const top = await page.locator('[data-ruler="h"]').boundingBox();
  const down = await at(400, 470);
  await drag({ x: down.x, y: top.y + top.height / 2 }, down);
  g = await guides();
  assert.equal(g[0].axis, 'y');
  await drag(await at(800, g[0].pos), { x: down.x, y: top.y + 5 });
  assert.equal((await guides()).length, 0);
  await tab('Vista');
  await page.locator('[data-nv-item="diagram.rulers.show"]').click();
  await settle();
  assert.equal(await page.locator('[data-ruler]').count(), 0);
  await page.locator('[data-nv-item="diagram.rulers.show"]').click();
});

await check('space or the middle button drag the drawing without moving anything', async () => {
  await reset();
  const a = await addAt('process', 300, 200);
  await ev(() => window.__novaDiagram.ctl.setZoom(200));
  await settle();
  const scroll = () => ev(() => { const el = document.querySelector('.dg-scroller'); return [el.scrollLeft, el.scrollTop]; });
  const before = await scroll();
  const s0 = await shapes();
  await focus();
  await page.keyboard.down(' ');
  await drag({ x: 700, y: 450 }, { x: 600, y: 390 });
  await page.keyboard.up(' ');
  const after = await scroll();
  assert.deepEqual([after[0] - before[0], after[1] - before[1]], [100, 60]);
  await page.mouse.move(700, 450);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(750, 480, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  await settle();
  assert.deepEqual(await scroll(), [after[0] - 50, after[1] - 30]);
  assert.deepEqual(await shapes(), s0);
  void a;
});

await check('typing on a selected shape writes over its text; F2 chooses all of it', async () => {
  await reset();
  const a = await addAt('process', 300, 200, 'viejo');
  const c = await mid(a);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.type('Nuevo texto');
  const box = page.getByRole('textbox', { name: 'Texto de la forma' });
  assert.equal(await box.inputValue(), 'Nuevo texto');
  await page.keyboard.press('Control+Enter');
  await settle();
  assert.equal((await shapes())[0].text, 'Nuevo texto');
  // Escape keeps what was there
  await page.mouse.click(c.x, c.y);
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await settle();
  assert.equal((await shapes())[0].text, 'Nuevo texto');
  await page.keyboard.press('F2');
  await page.keyboard.type('otro');
  await page.keyboard.press('Control+Enter');
  await settle();
  assert.equal((await shapes())[0].text, 'otro');
  // Ctrl+Z while writing undoes the writing, not the diagram
  await page.keyboard.press('F2');
  await page.keyboard.type('mas');
  await page.keyboard.press('Control+z');
  assert.equal((await shapes()).length, 1);
  await page.keyboard.press('Escape');
});

await check('the secondary button opens a menu of what is under it; the keyboard opens it too', async () => {
  await reset();
  const a = await addAt('process', 300, 200, 'A');
  const c = await mid(a);
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await page.locator('.ml-menu').first().waitFor();
  assert.deepEqual(await selected(), [a]);
  await shot('menu-de-forma');
  await item('Cambiar forma').click();
  await item('Diagrama de flujo').hover();
  await item('Decisión').click();
  await settle();
  assert.equal((await shapes())[0].stencil, 'decision');
  assert.equal(await page.locator('.ml-menu').count(), 0);
  // paste goes where the menu opened
  await focus();
  await page.keyboard.press('Control+c');
  const there = await at(620, 460);
  await page.mouse.click(there.x, there.y, { button: 'right' });
  await item('Pegar').click();
  await settle(400);
  const s = await shapes();
  assert.equal(s.length, 2);
  assert.ok(Math.abs(s[1].x - 620) <= 1 && Math.abs(s[1].y - 460) <= 1, `${s[1].x},${s[1].y}`);
  await focus();
  await page.keyboard.press('Shift+F10');
  await page.locator('.ml-menu').first().waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ml-menu').count(), 0);
  void menuItem;
});

await check('copy and paste between windows, text and a picture from outside', async () => {
  await reset();
  const a = await addAt('hexagon', 300, 200, 'Viajera');
  await ev(([a]) => window.__novaDiagram.ctl.setSelection([a]), [a]);
  await focus();
  await page.keyboard.press('Control+c');
  const other = await ctx.newPage();
  watch(other);
  await open(other);
  await other.locator('.dg-scroller').focus();
  await other.keyboard.press('Control+v');
  await other.waitForFunction(() => window.__novaDiagram.ctl.basePage.shapes.length === 1);
  assert.deepEqual(await other.evaluate(() => window.__novaDiagram.ctl.basePage.shapes.map((s) => [s.stencil, s.text])), [['hexagon', 'Viajera']]);
  // what other programs get
  assert.equal(await other.evaluate(() => navigator.clipboard.readText()), 'Viajera');
  // text written elsewhere
  await other.evaluate(() => navigator.clipboard.writeText('Texto de otro programa\nsegunda línea'));
  await other.keyboard.press('Control+v');
  await other.waitForFunction(() => window.__novaDiagram.ctl.basePage.shapes.length === 2);
  assert.deepEqual(await other.evaluate(() => { const s = window.__novaDiagram.ctl.basePage.shapes[1]; return [s.stencil, s.text]; }), ['text', 'Texto de otro programa\nsegunda línea']);
  // a picture copied elsewhere
  await other.evaluate(async () => {
    const cv = document.createElement('canvas');
    cv.width = 40;
    cv.height = 30;
    cv.getContext('2d').fillRect(0, 0, 40, 30);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await other.keyboard.press('Control+v');
  await other.waitForFunction(() => window.__novaDiagram.ctl.basePage.shapes.some((s) => s.image));
  // the button of the ribbon reads the clipboard of the system too
  await page.bringToFront();
  await page.evaluate(() => navigator.clipboard.writeText('con el botón'));
  await tab('Inicio');
  await page.locator('[data-nv-item="diagram.paste"]').click();
  await page.waitForFunction(() => window.__novaDiagram.ctl.basePage.shapes.some((s) => s.text === 'con el botón'));
  // and the copy button leaves the shapes for a paste with the keys
  await ev(([a]) => window.__novaDiagram.ctl.setSelection([a]), [a]);
  await page.locator('[data-nv-item="diagram.copy"]').click();
  await settle();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Viajera');
  // copy as a picture, for other programs
  await page.locator('[data-nv-item="diagram.copy.picture"]').click();
  await settle(600);
  assert.ok(await page.evaluate(async () => (await navigator.clipboard.read()).some((i) => i.types.includes('image/png'))));
  await other.close();
});

await check('the format painter gives the format once, or until Esc when pressed twice', async () => {
  await reset();
  const a = await addAt('process', 250, 200, 'A');
  const b = await addAt('process', 450, 200, 'B');
  const c = await addAt('ellipse', 650, 200, 'C');
  await ev(([a]) => { const k = window.__novaDiagram.ctl; k.setSelection([a]); k.setStyle({ fill: '#ffc000' }); }, [a]);
  await page.mouse.move(700, 500);
  const painter = page.locator('[data-nv-item="diagram.format.painter"]');
  await painter.click();
  assert.equal(await page.locator('.dg-scroller.is-painting').count(), 1);
  const pb = await mid(b);
  await page.mouse.click(pb.x, pb.y);
  await settle();
  assert.equal((await shapes())[1].fill, '#ffc000');
  assert.equal(await page.locator('.dg-scroller.is-painting').count(), 0);
  await ev(([a]) => window.__novaDiagram.ctl.setSelection([a]), [a]);
  await painter.dblclick();
  await settle();
  const pc = await mid(c);
  await page.mouse.click(pc.x, pc.y);
  await settle();
  assert.equal((await shapes())[2].fill, '#ffc000');
  assert.equal(await page.locator('.dg-scroller.is-painting').count(), 1);
  await focus();
  await page.keyboard.press('Escape');
  await settle();
  assert.equal(await page.locator('.dg-scroller.is-painting').count(), 0);
});

await check('size and position by numbers, and change of shape from the ribbon', async () => {
  await reset();
  const a = await addAt('process', 300, 200, 'Medida');
  await ev(([a]) => window.__novaDiagram.ctl.setSelection([a]), [a]);
  await tab('Vista');
  await page.locator('[data-nv-item="diagram.size.pane"]').click();
  const pane = page.getByTestId('size-pane');
  const put = async (label, value) => { const f = pane.getByLabel(label, { exact: true }); await f.fill(value); await f.press('Enter'); await settle(); };
  await put('Ancho', '200');
  await put('X (centro)', '400');
  await put('Ángulo (grados)', '30');
  let s = (await shapes())[0];
  assert.deepEqual([s.w, s.x, s.rot], [200, 300, 30]);
  await put('Alto', 'abc');
  assert.equal((await shapes())[0].h, s.h);
  await shot('tamano-y-posicion');
  await tab('Inicio');
  await page.getByRole('button', { name: 'Cambiar forma', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Cambiar la forma por: documento' }).click();
  await settle();
  s = (await shapes())[0];
  assert.deepEqual([s.stencil, s.w, s.text], ['document', 200, 'Medida']);
});

await check('find with Ctrl+F goes to each match; Ctrl+H replaces one and then all', async () => {
  await reset();
  const a = await addAt('process', 300, 200, 'Pedido nuevo');
  const b = await addAt('process', 500, 300, 'pedido viejo');
  await ev(() => { const c = window.__novaDiagram.ctl; c.newPage(); const id = c.addStencil('rect', { x: 900, y: 700 }).id; c.setText(id, 'Otro pedido'); c.goToPage(c.diagram.pages[0].id); c.clearSelection(); });
  await settle();
  await focus();
  await page.keyboard.press('Control+f');
  const find = page.getByRole('search');
  await find.getByLabel('Buscar', { exact: true }).fill('pedido');
  await settle();
  assert.match(await find.getByRole('status').first().textContent(), /1 de 3/);
  assert.deepEqual(await selected(), [a]);
  await find.getByLabel('Buscar', { exact: true }).press('Enter');
  await settle();
  assert.deepEqual(await selected(), [b]);
  await find.getByRole('button', { name: 'Siguiente' }).click();
  await settle();
  assert.equal(await ev(() => window.__novaDiagram.ctl.pageId === window.__novaDiagram.ctl.diagram.pages[1].id), true);
  await find.getByRole('button', { name: 'Cerrar' }).click();
  await ev(() => window.__novaDiagram.ctl.goToPage(window.__novaDiagram.ctl.diagram.pages[0].id));
  await focus();
  await page.keyboard.press('Control+h');
  await find.getByLabel('Buscar', { exact: true }).fill('pedido');
  await find.getByLabel('Reemplazar con').fill('envío');
  await find.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  await settle();
  assert.equal((await shapes())[0].text, 'envío nuevo');
  await shot('buscar-y-reemplazar');
  await find.getByRole('button', { name: 'Reemplazar todo' }).click();
  await settle();
  const texts = await ev(() => window.__novaDiagram.ctl.diagram.pages.flatMap((p) => p.shapes.map((s) => s.text)));
  assert.deepEqual(texts, ['envío nuevo', 'envío viejo', 'Otro envío']);
  await find.getByRole('button', { name: 'Cerrar' }).click();
  await focus();
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await shapes())[1].text, 'pedido viejo');
});

await browser.close();
for (const r of results) console.log(r.join('  '));
if (errors.length) console.log('errors:', errors);
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`${results.length - failed}/${results.length} checks`);
process.exit(failed + errors.length ? 1 : 0);
