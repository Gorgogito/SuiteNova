// Closing checks for the icon gallery: speed (open, search, more, insert) and accessibility (names, keyboard, roles, live region, dark theme).
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-icons-close.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(`${BASE}?app=calc`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaCalc);
await page.waitForTimeout(800);
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) await page.keyboard.press('Escape');
  }
};
const timings = {};
const openGallery = async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: /Iconos/ }).first().click();
  const d = page.getByRole('dialog', { name: 'Iconos' });
  await d.waitFor();
  return d;
};

await check('abrir la galería (catálogo y trazos, 1.ª vez) tarda menos de 3 s y la 2.ª menos de 1 s', async () => {
  let t0 = Date.now();
  let d = await openGallery();
  await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option').first().waitFor();
  timings.openFirst = Date.now() - t0;
  assert.ok(timings.openFirst < 3000, `1.ª apertura ${timings.openFirst} ms`);
  await page.keyboard.press('Escape');
  await d.waitFor({ state: 'detached' });
  t0 = Date.now();
  d = await openGallery();
  await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option').first().waitFor();
  timings.openSecond = Date.now() - t0;
  assert.ok(timings.openSecond < 1000, `2.ª apertura ${timings.openSecond} ms`);
});

await check('buscar, cambiar de categoría y «Mostrar más» responden en menos de 500 ms', async () => {
  const d = page.getByRole('dialog', { name: 'Iconos' });
  const box = d.getByLabel('Buscar icono');
  let t0 = Date.now();
  await box.fill('flecha');
  await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option').first().waitFor();
  timings.search = Date.now() - t0;
  assert.ok(timings.search < 500, `búsqueda ${timings.search} ms`);
  await box.fill('');
  t0 = Date.now();
  await d.getByRole('listbox', { name: 'Categorías' }).getByRole('option').nth(3).getByRole('button').click();
  await page.waitForTimeout(50);
  timings.category = Date.now() - t0;
  assert.ok(timings.category < 500, `categoría ${timings.category} ms`);
  await d.getByRole('listbox', { name: 'Categorías' }).getByRole('option').first().getByRole('button').click();
  const before = await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option').count();
  t0 = Date.now();
  await d.getByRole('button', { name: /Mostrar más/ }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[role=listbox][aria-label="Iconos"] [role=option]').length > n, before);
  timings.more = Date.now() - t0;
  assert.ok(timings.more < 500, `mostrar más ${timings.more} ms`);
  assert.equal(await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option').count(), before * 2);
});

await check('cada icono tiene nombre accesible y el buscador acepta español e inglés', async () => {
  const d = page.getByRole('dialog', { name: 'Iconos' });
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('[role=listbox][aria-label="Iconos"] [role=option]')].filter((b) => !(b.getAttribute('aria-label') || '').trim()).length);
  assert.equal(unnamed, 0);
  for (const [q, re] of [['casa', /casa|hogar|inicio/i], ['home', /casa|hogar|inicio/i], ['calendar', /calendario/i]]) {
    await d.getByLabel('Buscar icono').fill(q);
    await page.waitForTimeout(250);
    const names = await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option').evaluateAll((els) => els.slice(0, 40).map((e) => e.getAttribute('aria-label')));
    assert.ok(names.some((n) => re.test(n)), `${q}: ${names.slice(0, 5)}`);
  }
});

await check('teclado: se llega a un icono con Tab, Espacio lo elige, el contador avisa (aria-live) y Intro inserta', async () => {
  const d = page.getByRole('dialog', { name: 'Iconos' });
  await d.getByLabel('Buscar icono').fill('calendario');
  await page.waitForTimeout(250);
  await d.getByLabel('Buscar icono').focus();
  let reached = false;
  for (let i = 0; i < 14 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'option' && !!document.activeElement.closest('[aria-label="Iconos"]'));
  }
  assert.ok(reached, 'Tab no llega a un icono en 14 pulsaciones');
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-selected')), 'true');
  assert.match(await d.locator('[aria-live=polite]').innerText(), /1 seleccionados?/);
  const insert = d.getByRole('button', { name: 'Insertar', exact: true });
  assert.ok(await insert.isEnabled());
  await insert.focus();
  await page.keyboard.press('Enter');
  await d.waitFor({ state: 'detached' });
  await page.waitForTimeout(600);
  const alt = await page.evaluate(() => window.__novaCalc.doc.sheet.images.at(-1)?.alt);
  assert.match(alt, /Calendario/);
});

await check('Escape cierra la galería y devuelve el foco a la aplicación', async () => {
  const d = await openGallery();
  await page.keyboard.press('Escape');
  await d.waitFor({ state: 'detached' });
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'HTML');
});

await check('teclado: las flechas recorren los iconos y las categorías, y con el tema oscuro los iconos se ven sobre su baldosa clara', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const d = await openGallery();
  const list = d.getByRole('listbox', { name: 'Iconos' });
  await list.getByRole('option').first().waitFor();
  assert.equal(await list.locator('[role=option][tabindex="0"]').count(), 1, 'un solo icono en el orden de Tab');
  await list.getByRole('option').first().focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'option');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('[role=listbox][aria-label="Iconos"] [role=option]')].indexOf(document.activeElement)), 1);
  await page.keyboard.press('ArrowDown');
  assert.ok((await page.evaluate(() => [...document.querySelectorAll('[role=listbox][aria-label="Iconos"] [role=option]')].indexOf(document.activeElement))) > 2);
  const cats = d.getByRole('listbox', { name: 'Categorías' });
  assert.equal(await cats.locator('button[tabindex="0"]').count(), 1);
  await cats.locator('button[tabindex="0"]').focus();
  await page.keyboard.press('ArrowDown');
  assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /\(\d+\)/);
  const bg = await page.evaluate(() => ({ dlg: getComputedStyle(document.querySelector('[role=dialog]')).backgroundColor, tile: getComputedStyle(document.querySelector('[role=listbox][aria-label="Iconos"] [role=option]')).backgroundColor }));
  assert.equal(bg.tile, 'rgb(255, 255, 255)');
  results.push(['ok', `   (diálogo ${bg.dlg}, baldosa ${bg.tile})`]);
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/oscuro.png` });
  await page.keyboard.press('Escape');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

console.log('tiempos (ms):', JSON.stringify(timings));
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
