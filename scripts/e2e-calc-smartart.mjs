// End-to-end checks for the linked SmartArt in Nova Calc: insert from the dialog, edit text/layout/colours, resize reflow, double click,
// undo and save/reopen as .xlsx. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-smartart.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const results = [];
let step = 0;

const session = async (fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('.calc-grid__scroller');
  await page.waitForTimeout(400);
  await page.mouse.click(300, 400);
  const shot = async (name) => {
    if (shotsDir) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
    }
  };
  try {
    await fn(page, shot);
    assert.deepEqual(errors, [], 'sin errores de consola');
  } finally {
    await ctx.close();
  }
};
const check = async (name, fn) => {
  try {
    await session(fn);
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
  }
};

/** El primer SmartArt de la hoja: texto, diseño y tamaño. */
const art = (page) =>
  page.evaluate(() => {
    const i = window.__novaCalc.doc.sheet.images.find((x) => x.smartart);
    if (!i) return null;
    const texts = [...i.smartart.data.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    return { width: i.width, height: i.height, texts, layoutId: /uniqueId="([^"]+)"/.exec(i.smartart.layout)?.[1], shapes: (i.smartart.drawing?.match(/<dsp:sp /g) ?? []).length, media: i.media };
  });
const insertArt = async (page) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'SmartArt…', exact: true }).click();
  await page.getByRole('dialog').waitFor();
};

await check('insertar un SmartArt desde el cuadro: queda vinculado y se ve', async (page, shot) => {
  await insertArt(page);
  await page.getByLabel('Texto del SmartArt').fill('Uno\nDos\nTres');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(500);
  const a = await art(page);
  assert.ok(a, 'hay un SmartArt');
  assert.deepEqual(a.texts, ['Uno', 'Dos', 'Tres']);
  assert.ok(a.shapes >= 3, 'trae su dibujo');
  assert.ok(await page.locator('.calc-picture img').evaluate((i) => i.complete && i.naturalWidth > 0), 'se dibuja');
  await shot('insertado');
});

await check('editar: texto, diseño y colores desde la pestaña contextual; deshacer vuelve atrás', async (page, shot) => {
  await insertArt(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('[role=tab]').filter({ hasText: 'Diseño de SmartArt' }).click();
  await page.getByRole('button', { name: 'Editar SmartArt…' }).click();
  await page.getByLabel('Texto del SmartArt').fill('A\nB\nC\nD\nE');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(400);
  assert.deepEqual((await art(page)).texts, ['A', 'B', 'C', 'D', 'E']);
  await page.getByRole('button', { name: 'Cambiar diseño' }).click();
  await page.getByRole('menuitem', { name: 'Ciclo básico' }).click();
  await page.waitForTimeout(400);
  assert.equal((await art(page)).layoutId, 'urn:suitenova/layout/cycle');
  await page.getByRole('button', { name: 'Cambiar colores' }).click();
  await page.getByRole('menuitem', { name: 'Énfasis 2' }).click();
  await page.waitForTimeout(300);
  await shot('ciclo');
  await page.evaluate(() => window.__novaCalc.doc.undo());
  await page.evaluate(() => window.__novaCalc.doc.undo());
  assert.equal((await art(page)).layoutId, 'urn:suitenova/layout/process');
  assert.deepEqual((await art(page)).texts, ['A', 'B', 'C', 'D', 'E']);
});

await check('cambiar de tamaño con el ratón vuelve a distribuir el SmartArt', async (page) => {
  await insertArt(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  const before = await art(page);
  const box = await page.locator('.calc-picture.is-selected .calc-chart__handle--e').first().boundingBox();
  assert.ok(box, 'asa de tamaño');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await art(page);
  assert.ok(after.width < before.width - 50, `más estrecho (${before.width} -> ${after.width})`);
  assert.notEqual(after.media, before.media, 'el dibujo se vuelve a generar');
  assert.ok(after.shapes >= 3);
});

await check('doble clic abre el cuadro de edición', async (page) => {
  await insertArt(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.calc-picture').dblclick();
  await page.getByRole('dialog').waitFor();
  assert.ok(await page.getByLabel('Texto del SmartArt').isVisible());
});

await check('guardar y volver a leer el .xlsx conserva el SmartArt con su texto y su diseño', async (page) => {
  await insertArt(page);
  await page.locator('[data-sa-layout="urn:suitenova/layout/venn"]').click();
  await page.getByLabel('Texto del SmartArt').fill('Uno\nDos\nTres');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  const rt = await page.evaluate(() => window.__novaCalc.xlsxRoundTrip());
  assert.ok(rt.drawing.includes('dgm:relIds'), 'dgm:relIds en el dibujo');
  assert.ok(!rt.drawing.includes('<xdr:pic>'), 'no se escribe como imagen');
  const img = rt.images.find((i) => i.smartart);
  assert.ok(img, 'vuelve el SmartArt');
  assert.deepEqual([...img.smartart.data.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]), ['Uno', 'Dos', 'Tres']);
  assert.equal(/uniqueId="([^"]+)"/.exec(img.smartart.layout)?.[1], 'urn:suitenova/layout/venn');
  assert.ok(img.smartart.drawing);
});

for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
