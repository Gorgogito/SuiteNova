// End-to-end checks for shapes and text boxes in Nova Calc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-shapes.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
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

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.waitForTimeout(400);
await page.mouse.click(300, 400);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shapes = () => ev(() => window.__novaCalc.doc.sheet.shapes.map((s) => ({ ...s })));

await check('Insertar > Formas > Rectángulo y Elipse desde la cinta', async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await ev(() => window.__novaCalc.doc.selectCell(2, 1));
  for (const name of ['Rectángulo', 'Elipse']) {
    await page.getByRole('button', { name: 'Formas' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await page.waitForTimeout(250);
    // mueve la selección para que la siguiente forma no caiga encima
    await ev(() => window.__novaCalc.doc.selectCell(8, 1));
  }
  const s = await shapes();
  assert.deepEqual(s.map((x) => x.kind), ['rect', 'ellipse']);
  await shot('formas-insertadas');
});

await check('Cuadro de texto: doble clic, escribir y confirmar con Ctrl+Intro', async () => {
  await ev(() => window.__novaCalc.doc.selectCell(2, 6));
  await page.getByRole('button', { name: 'Cuadro de texto' }).click();
  await page.waitForTimeout(300);
  const box = page.locator('.calc-shape[data-shape-id]').nth(2);
  await box.dblclick();
  await page.waitForTimeout(250);
  const area = page.locator('.calc-shape__edit');
  assert.equal(await area.count(), 1);
  await area.fill('Resumen\nde ventas');
  await shot('editando-texto');
  await area.press('Control+Enter');
  await page.waitForTimeout(250);
  const s = await shapes();
  assert.equal(s[2].text, 'Resumen\nde ventas');
  assert.equal(s[2].kind, 'textBox');
});

await check('arrastrar y redimensionar con el ratón, y deshacer', async () => {
  const before = (await shapes())[0];
  const el = page.locator('.calc-shape[data-shape-id]').first();
  const b = await el.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const moved = (await shapes())[0];
  assert.ok(moved.x > before.x + 40 && moved.y > before.y + 25, `movió de ${before.x},${before.y} a ${moved.x},${moved.y}`);
  // asa inferior derecha
  const b2 = await page.locator('.calc-shape[data-shape-id]').first().boundingBox();
  await page.locator('.calc-shape[data-shape-id]').first().locator('.calc-chart__handle--se').hover();
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width + 40, b2.y + b2.height + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const grown = (await shapes())[0];
  assert.ok(grown.width > moved.width + 25, `ancho ${moved.width} → ${grown.width}`);
  await ev(() => window.__novaCalc.doc.undo());
  assert.equal((await shapes())[0].width, moved.width);
  await shot('movida-y-redimensionada');
});

await check('Formato de forma: relleno, contorno y texto; Supr elimina', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.x.selectObject('shape', d.sheet.shapes[0].id);
  });
  await page.getByRole('tab', { name: /Formato de forma/ }).click();
  await page.getByRole('button', { name: 'Formato de forma…' }).click();
  await page.locator('#sh-text').fill('Meta');
  await page.locator('input[type=color][aria-label="Color de relleno"]').fill('#ff9900');
  await page.getByLabel('Negrita').check();
  await shot('dialogo-formato');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(300);
  const s = (await shapes())[0];
  assert.equal(s.text, 'Meta');
  assert.equal(s.fill, '#ff9900');
  assert.equal(s.bold, true);
  await shot('formato-aplicado');
  await page.locator('.calc-shape[data-shape-id]').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  assert.equal((await shapes()).length, 2);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors.filter((e) => !/Keyborg/.test(e)), []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
