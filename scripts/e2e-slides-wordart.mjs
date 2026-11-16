// End-to-end checks for the WordArt engine (wordart-core) in Nova Slides: with the system fonts allowed, a NovaArt text with a transform
// is drawn deforming the letters' outlines (SVG paths), not as text on a path. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-wordart.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const origin = new globalThis.URL(URL).origin;

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const results = [];
let step = 0;
const run = async (permission, fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 } });
  if (permission) await ctx.grantPermissions(['local-fonts'], { origin });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sl-surface');
  try {
    await fn(page);
    assert.deepEqual(errors, [], 'sin errores de consola');
  } finally {
    await ctx.close();
  }
};
const check = async (name, permission, fn) => {
  try {
    await run(permission, fn);
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
  }
};
const insert = async (page, style, text, prst) => {
  await page.evaluate(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(1); });
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'WordArt (NovaArt)…', exact: true }).click();
  await page.getByRole('radio', { name: style }).click();
  await page.getByLabel('Texto de NovaArt').fill(text);
  await page.getByLabel('Transformar el texto').selectOption(prst);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(600);
};

await check('con fuentes del sistema: las letras se deforman (trazados SVG, sin texto sobre trayectoria)', true, async (page) => {
  await insert(page, 'Degradado azul', 'Hola WordArt', 'textArchUp');
  assert.equal(await page.locator('.sl-surface svg textPath').count(), 0, 'no usa el respaldo');
  const info = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('.sl-surface svg')].filter((s) => s.querySelector('path[d]') && s.querySelector('linearGradient'));
    const p = svgs[0]?.querySelector('path[d]');
    return { svgs: svgs.length, points: p ? (p.getAttribute('d').match(/L/g) ?? []).length : 0 };
  });
  assert.ok(info.svgs >= 1, 'hay un dibujo con degradado');
  assert.ok(info.points > 200, `contornos con muchos puntos: ${info.points}`);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-arco.png` });
});

await check('con otra transformación (onda) y un estilo con sombra', true, async (page) => {
  await insert(page, 'Negro con sombra', 'Onda', 'textWave1');
  assert.equal(await page.locator('.sl-surface svg textPath').count(), 0);
  assert.ok(await page.locator('.sl-surface svg feGaussianBlur').count(), 'la sombra es un filtro');
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-onda.png` });
});

await check('sin permiso de fuentes: se usa el respaldo (texto sobre trayectoria) y no se rompe nada', false, async (page) => {
  await insert(page, 'Degradado azul', 'Respaldo', 'textArchUp');
  assert.ok(await page.locator('.sl-surface svg textPath').count(), 'el respaldo sigue funcionando');
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
