// End-to-end checks of the Design tab of Nova Slides: variants (colours, fonts, background styles), slide size and Reset slide.
// Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-slides-design.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 950 } })).newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/des-${String(++step).padStart(2, '0')}-${n}.png` });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    await shot('FAIL-' + name.replace(/\W+/g, '-'));
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 300) => page.waitForTimeout(ms);
const theme = () => ev(() => { const d = window.__novaSlides.ctl.realDeck; return { colors: d.themes[0].colors, fonts: d.themes[0].fonts, bg: d.masters[0].bg, bg1: d.masters[0].clrMap.bg1 }; });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');
await page.getByRole('tab', { name: 'Diseño', exact: true }).click();

await check('colour scheme from the ribbon, with undo', async () => {
  const before = (await theme()).colors.accent1;
  await page.getByRole('button', { name: 'Colores', exact: true }).click();
  await settle(350);
  await shot('colors-gallery');
  await page.getByRole('menuitem', { name: 'Verde' }).click();
  await settle();
  assert.equal((await theme()).colors.accent1, '#549e39');
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal((await theme()).colors.accent1, before);
});

await check('font pair from the ribbon', async () => {
  await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: /Georgia/ }).click();
  await settle();
  const f = (await theme()).fonts;
  assert.equal(f.major.latin, 'Georgia');
  assert.equal(f.minor.latin, 'Verdana');
});

await check('background styles: dark one flips text colours, gradient one is a gradient', async () => {
  await page.getByRole('button', { name: 'Estilos de fondo', exact: true }).click();
  await settle(350);
  await shot('bg-gallery');
  await page.getByRole('menuitem', { name: 'Estilo 3', exact: true }).click();
  await settle();
  let t = await theme();
  assert.equal(t.bg1, 'dk1');
  assert.equal(t.bg.fill.t, 'solid');
  await page.getByRole('button', { name: 'Estilos de fondo', exact: true }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: 'Estilo 11', exact: true }).click();
  await settle(400);
  t = await theme();
  assert.equal(t.bg.fill.t, 'grad');
  assert.equal(t.bg1, 'dk1');
  await shot('dark-gradient');
  await page.getByRole('button', { name: 'Estilos de fondo', exact: true }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: 'Estilo 1', exact: true }).click();
  await settle();
  assert.equal((await theme()).bg1, 'lt1');
});

await check('slide size from the ribbon (4:3, then 16:9)', async () => {
  await page.getByRole('button', { name: 'Tamaño de diapositiva' }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: /Estándar/ }).click();
  await settle();
  assert.deepEqual(await ev(() => { const s = window.__novaSlides.ctl.deck.size; return [s.w, s.h]; }), [720, 540]);
  await page.getByRole('button', { name: 'Tamaño de diapositiva' }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: /Panorámica/ }).click();
  await settle();
  assert.deepEqual(await ev(() => { const s = window.__novaSlides.ctl.deck.size; return [s.w, s.h]; }), [960, 540]);
});

await check('reset slide puts the title placeholder back in place', async () => {
  const id = await ev(() => { const c = window.__novaSlides.ctl; return c.slide.shapes.find((e) => e.ph)?.id; });
  assert.ok(id);
  await ev((i) => { const c = window.__novaSlides.ctl; c.setXfrm(i, { x: 5, y: 5, w: 100, h: 40 }); }, id);
  assert.equal(await ev((i) => window.__novaSlides.ctl.element(i).xfrm?.x, id), 5);
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Restablecer diapositiva' }).click();
  await settle();
  assert.equal(await ev((i) => window.__novaSlides.ctl.element(i).xfrm, id), undefined);
});

await check('saved and reopened: colours, fonts and background style survive', async () => {
  await page.getByRole('tab', { name: 'Diseño', exact: true }).click();
  await page.getByRole('button', { name: 'Colores', exact: true }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: 'Verde' }).click();
  await settle();
  await page.getByRole('button', { name: 'Estilos de fondo', exact: true }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: 'Estilo 4', exact: true }).click();
  await settle();
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle(500);
  const t = await theme();
  assert.equal(t.colors.accent1, '#549e39');
  assert.equal(t.fonts.major.latin, 'Georgia');
  assert.equal(t.bg1, 'dk1');
  assert.ok(t.bg?.fill, 'the background of the master was kept');
});

await check('no console errors', async () => assert.deepEqual(errors, []));
await browser.close();
let failed = 0;
for (const [s, n, m] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${m ? '\n    ' + m : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
