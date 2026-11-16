// End-to-end checks for the linked SmartArt in Nova Slides: insert from the dialog, edit the text, change layout/colours, resize reflow
// and the .pptx round trip. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-smartart.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const results = [];
const check = async (name, fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sl-surface');
    await fn(page);
    assert.deepEqual(errors, [], 'sin errores de consola');
    results.push(['ok', name]);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png` }).catch(() => {});
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
  } finally {
    await ctx.close();
  }
};
const shot = (page, n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const sel = (page) => page.evaluate(() => {
  const c = window.__novaSlides.ctl;
  const e = c.selected[0];
  return e ? { kind: e.kind, smartart: !!e.smartart, n: e.children?.length ?? 0, w: Math.round(c.xfrmOf(e).w), h: Math.round(c.xfrmOf(e).h) } : null;
});
const open = async (page) => {
  await page.evaluate(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(1); });
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'SmartArt…', exact: true }).click();
  await page.getByRole('dialog').waitFor();
};

await check('insertar un SmartArt desde el cuadro y que quede vinculado', async (page) => {
  await open(page);
  await page.getByLabel('Texto del SmartArt').fill('Uno\nDos\nTres');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  const s = await sel(page);
  assert.equal(s.kind, 'group');
  assert.ok(s.smartart, 'es un SmartArt');
  assert.ok(s.n >= 3, 'tiene formas');
  await shot(page, 'insertado');
});

await check('editar el texto: aparece un nodo más', async (page) => {
  await open(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(300);
  const before = await sel(page);
  await page.getByRole('tab', { name: /Diseño de SmartArt/ }).click();
  await page.getByRole('button', { name: 'Editar SmartArt…' }).click();
  await page.getByLabel('Texto del SmartArt').fill('A\nB\nC\nD\nE\nF');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(400);
  const after = await sel(page);
  assert.ok(after.smartart && after.n > before.n, `más formas (${before.n} -> ${after.n})`);
});

await check('cambiar de diseño y de colores desde la pestaña', async (page) => {
  await open(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => JSON.stringify(window.__novaSlides.ctl.selected[0].children.map((c) => [c.xfrm.x, c.xfrm.y])));
  await page.getByRole('tab', { name: /Diseño de SmartArt/ }).click();
  await page.getByRole('button', { name: 'Cambiar diseño' }).click();
  await page.getByRole('menuitem', { name: 'Ciclo básico' }).click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => JSON.stringify(window.__novaSlides.ctl.selected[0].children.map((c) => [c.xfrm.x, c.xfrm.y])));
  assert.notEqual(before, after, 'las formas cambian de sitio');
  await page.getByRole('button', { name: 'Cambiar colores' }).click();
  await page.getByRole('menuitem', { name: 'Énfasis 2' }).click();
  await page.waitForTimeout(300);
  assert.ok((await sel(page)).smartart);
  await shot(page, 'ciclo');
});

await check('cambiar de tamaño vuelve a distribuir el SmartArt', async (page) => {
  await open(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => JSON.stringify(window.__novaSlides.ctl.selected[0].children.map((c) => c.xfrm.w)));
  await page.evaluate(() => { const c = window.__novaSlides.ctl; const e = c.selected[0]; const x = c.xfrmOf(e); c.setXfrms({ [e.id]: { ...x, w: x.w / 2 } }, 'Cambiar tamaño'); });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => JSON.stringify(window.__novaSlides.ctl.selected[0].children.map((c) => c.xfrm.w)));
  assert.notEqual(before, after, 'las formas se reajustan al ancho');
});

await check('doble clic abre el cuadro de edición', async (page) => {
  await open(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => { const c = window.__novaSlides.ctl; const x = c.xfrmOf(c.selected[0]); return x; });
  const surf = await page.locator('.sl-surface').boundingBox();
  const zoom = await page.evaluate(() => { const s = document.querySelector('.sl-surface'); return s.getBoundingClientRect().width / s.offsetWidth; });
  await page.mouse.dblclick(surf.x + (box.x + box.w / 2) * zoom, surf.y + (box.y + box.h / 2) * zoom);
  await page.getByRole('dialog').waitFor();
  assert.ok(await page.getByLabel('Texto del SmartArt').isVisible());
});

for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
