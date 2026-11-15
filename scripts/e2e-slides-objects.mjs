// End-to-end checks of the object tools of Nova Slides: selection pane, merge shapes, change shape. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-objects.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 } });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/obj-${String(++step).padStart(2, '0')}-${name}.png` });
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
const settle = (ms = 250) => page.waitForTimeout(ms);
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const shapes = () => ev(() => window.__novaSlides.ctl.slide.shapes.map((e) => ({ id: e.id, name: e.name, kind: e.kind, hidden: !!e.hidden, cust: !!(e.geom && e.geom.cust), prst: e.geom && e.geom.prst })));
const addTwo = async () => {
  await ev(() => {
    const n = window.__novaSlides;
    const c = n.ctl;
    c.select(c.slide.shapes.map((e) => e.id));
    c.deleteSelected();
    const a = n.addShape('rect', 100, 100, 200, 150);
    const b = n.addShape('ellipse', 200, 150, 200, 150);
    c.select([a, b]);
  });
  await settle();
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');

await check('merge shapes: union leaves one freeform shape', async () => {
  await addTwo();
  await page.getByRole('tab', { name: /Formato de forma/ }).click();
  await page.getByRole('button', { name: /Combinar formas/ }).click();
  await settle(500);
  assert.notEqual(await page.getByRole('menuitem', { name: /^Unión/ }).getAttribute('aria-disabled'), 'true', 'the merge entries are enabled with two shapes selected');
  await shot('merge-menu');
  await page.getByRole('menuitem', { name: /^Unión/ }).click();
  await settle();
  const s = await shapes();
  assert.equal(s.length, 1);
  assert.ok(s[0].cust, 'it is a custom geometry');
  await shot('union');
});

await check('merge shapes: intersect, subtract, combine and fragment', async () => {
  const expect = { intersect: 1, subtract: 1, combine: 1, fragment: 3 };
  for (const [op, n] of Object.entries(expect)) {
    await addTwo();
    await ev((o) => window.__novaSlides.ctl.mergeSelected(o), op);
    await settle(100);
    assert.equal((await shapes()).length, n, op);
    if (op === 'fragment') await shot('fragment');
  }
});

await check('merge result is one undo step and survives save and reopen', async () => {
  await addTwo();
  await ev(() => window.__novaSlides.ctl.mergeSelected('subtract'));
  assert.equal((await shapes()).length, 1);
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal((await shapes()).length, 2);
  await ev(() => window.__novaSlides.ctl.redo());
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle();
  const s = await shapes();
  assert.equal(s.length, 1);
  assert.ok(s[0].cust);
});

await check('change shape keeps size and swaps the geometry', async () => {
  await addTwo();
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes[0].id]); });
  const before = await ev(() => { const c = window.__novaSlides.ctl; return c.xfrmOf(c.selected[0]); });
  await page.getByRole('tab', { name: /Formato de forma/ }).click();
  await page.getByRole('button', { name: /Cambiar forma/ }).click();
  await shot('change-shape-gallery');
  await page.locator('[data-shape="triangle"]').click();
  await settle();
  const after = await ev(() => { const c = window.__novaSlides.ctl; return { x: c.xfrmOf(c.selected[0]), g: c.selected[0].geom }; });
  assert.equal(after.g.prst, 'triangle');
  assert.deepEqual(after.x, before);
});

await check('selection pane: lists objects, hides, renames, reorders and selects', async () => {
  await addTwo();
  await tab('Inicio');
  await page.getByRole('button', { name: 'Organizar' }).click();
  await page.getByRole('menuitem', { name: /Panel de selección/ }).click();
  await settle();
  const pane = page.getByRole('complementary', { name: 'Panel de selección' });
  assert.equal(await pane.locator('.sl-sellist li').count(), 2);
  assert.match(await pane.locator('.sl-sellist li').first().innerText(), /ellipse/);
  await pane.getByRole('button', { name: /Mostrar u ocultar: ellipse/ }).click();
  await settle();
  assert.equal((await shapes()).find((s) => s.prst === 'ellipse').hidden, true);
  await shot('selection-pane');
  await pane.getByRole('button', { name: /Mostrar u ocultar: ellipse/ }).click();
  await pane.locator('.sl-selitem').first().dblclick();
  await pane.getByRole('textbox', { name: 'Nombre del objeto' }).fill('Círculo azul');
  await page.keyboard.press('Enter');
  await settle();
  assert.ok((await shapes()).some((s) => s.name === 'Círculo azul'));
  await pane.getByRole('button', { name: /Enviar atrás: Círculo azul/ }).click();
  await settle();
  assert.equal((await shapes())[0].name, 'Círculo azul');
  await pane.locator('.sl-selitem', { hasText: 'rect' }).click();
  assert.equal(await ev(() => window.__novaSlides.ctl.selection.length), 1);
  await pane.getByRole('button', { name: 'Ocultar todo' }).click();
  assert.ok((await shapes()).every((s) => s.hidden));
  await pane.getByRole('button', { name: 'Mostrar todo' }).click();
  assert.ok((await shapes()).every((s) => !s.hidden));
  await pane.getByRole('button', { name: /Mostrar u ocultar: rect/ }).click();
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle();
  const s = await shapes();
  assert.ok(s.some((x) => x.name === 'Círculo azul'));
  assert.ok(s.some((x) => x.hidden));
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
