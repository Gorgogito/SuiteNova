// End-to-end checks of the shared theme menus in Nova Slides (Design tab): themes, colours, fonts, effects, custom ones, .thmx files and reset.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-themes-slides.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');
await page.evaluate(() => localStorage.removeItem('suitenova.themes.custom'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');
await page.getByRole('tab', { name: 'Diseño', exact: true }).click();

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png` }).catch(() => {});
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 5).join(' | ')]);
    await page.keyboard.press('Escape').catch(() => {});
  }
};
const settle = (ms = 200) => page.waitForTimeout(ms);
const theme = () => page.evaluate(() => { const t = window.__novaSlides.ctl.realDeck.themes[0]; return { name: t.name, colors: t.colors, fonts: t.fonts, fmt: JSON.stringify(t.fmt) }; });
const open = async (name) => { await page.getByRole('button', { name, exact: true }).click(); await settle(300); };
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());

await check('the menus are in the Design tab: Themes, Colors, Fonts, Effects', async () => {
  for (const n of ['Temas', 'Colores', 'Fuentes', 'Efectos']) assert.equal(await page.getByRole('button', { name: n, exact: true }).count(), 1, n);
});

await check('colour scheme: marks the current one, changes the theme and undoes', async () => {
  const before = (await theme()).colors.accent1;
  await open('Colores');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Office', exact: true }).first().getAttribute('aria-checked'), 'true');
  await shot('colors-menu');
  await page.getByRole('menuitemradio', { name: 'Verde', exact: true }).click();
  await settle();
  assert.equal((await theme()).colors.accent1, '#549e39');
  await open('Colores');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Verde', exact: true }).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__novaSlides.ctl.undo());
  assert.equal((await theme()).colors.accent1, before);
});

await check('fonts: a pair of Office, and the menu marks it', async () => {
  await open('Fuentes');
  await page.getByRole('menuitemradio', { name: /^Georgia/ }).first().click();
  await settle();
  assert.equal((await theme()).fonts.major.latin, 'Georgia');
  await open('Fuentes');
  assert.equal(await page.getByRole('menuitemradio', { name: /^Georgia/ }).first().getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Escape');
});

await check('effects: Intense changes the format scheme and is the marked one', async () => {
  const before = (await theme()).fmt;
  await open('Efectos');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Office', exact: true }).getAttribute('aria-checked'), 'true', 'un documento nuevo tiene los efectos de Office');
  await shot('effects-menu');
  await page.getByRole('menuitemradio', { name: 'Intenso', exact: true }).click();
  await settle();
  assert.notEqual((await theme()).fmt, before);
  await open('Efectos');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Intenso', exact: true }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitem', { name: 'Restablecer los efectos del tema' }).click();
  await settle();
  await open('Efectos');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Office', exact: true }).getAttribute('aria-checked'), 'true', 'vuelve a Office');
  await page.keyboard.press('Escape');
});

await check('whole theme from the gallery (colours and fonts)', async () => {
  await open('Temas');
  await shot('themes-gallery');
  await page.getByRole('menuitemradio', { name: 'Azul', exact: true }).click();
  await settle();
  assert.equal((await theme()).colors.accent1.toLowerCase(), '#0f6fc6');
});

await check('customize colours: saved in the list, applied, and deleted', async () => {
  await open('Colores');
  await page.getByRole('menuitem', { name: 'Personalizar colores…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByLabel('Énfasis 1').fill('#ff0066');
  await dlg.getByLabel('Nombre').fill('Rosa mío');
  await shot('custom-colors');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await settle();
  assert.equal((await theme()).colors.accent1, '#ff0066');
  await open('Colores');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Rosa mío' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('button', { name: 'Eliminar Rosa mío' }).click();
  await settle();
  assert.equal(await page.getByRole('menuitemradio', { name: 'Rosa mío' }).count(), 0);
  await page.keyboard.press('Escape');
});

await check('customize fonts', async () => {
  await open('Fuentes');
  await page.getByRole('menuitem', { name: 'Personalizar fuentes…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByLabel('Fuente de los títulos').fill('Verdana');
  await dlg.getByLabel('Fuente del cuerpo').fill('Tahoma');
  await dlg.getByLabel('Nombre').fill('Mis fuentes');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await settle();
  const f = (await theme()).fonts;
  assert.equal(f.major.latin, 'Verdana');
  assert.equal(f.minor.latin, 'Tahoma');
});

await check('the custom things survive a reload (kept in the program)', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.sl-surface');
  await page.getByRole('tab', { name: 'Diseño', exact: true }).click();
  await open('Fuentes');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Mis fuentes' }).count(), 1);
  await page.keyboard.press('Escape');
});

let thmx = null;
await check('save the current theme as a .thmx file', async () => {
  await open('Colores');
  await page.getByRole('menuitemradio', { name: 'Verde', exact: true }).click();
  await settle();
  await open('Temas');
  await page.getByRole('menuitem', { name: 'Guardar tema actual…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByLabel('Nombre').fill('Prueba');
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Guardar como archivo…' }).click()]);
  thmx = path.join(os.tmpdir(), 'nova-prueba.thmx');
  await dl.saveAs(thmx);
  assert.equal(dl.suggestedFilename(), 'Prueba.thmx');
  assert.ok(fs.statSync(thmx).size > 1000);
});

await check('Browse for themes: opens the .thmx and applies it', async () => {
  await open('Colores');
  await page.getByRole('menuitemradio', { name: 'Rojo', exact: true }).click();
  await settle();
  const red = (await theme()).colors.accent1;
  assert.notEqual(red, '#549e39');
  await open('Temas');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Buscar temas…' }).click()]);
  await chooser.setFiles(thmx);
  await settle(500);
  assert.equal((await theme()).colors.accent1, '#549e39', 'vuelve el tema guardado');
});

await check('a file that is not a theme gives a clear error', async () => {
  const bad = path.join(os.tmpdir(), 'nova-malo.thmx');
  fs.writeFileSync(bad, 'esto no es un zip');
  await open('Temas');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('menuitem', { name: 'Buscar temas…' }).click()]);
  await chooser.setFiles(bad);
  await page.getByRole('alert').waitFor();
  await page.keyboard.press('Escape');
});

await check('reset the theme goes back to Office', async () => {
  await open('Temas');
  await page.getByRole('menuitem', { name: 'Restablecer el tema' }).click();
  await settle();
  const t = await theme();
  assert.equal(t.colors.accent1.toLowerCase(), '#4472c4');
  assert.equal(t.fonts.major.latin, 'Calibri Light');
});

await check('the theme goes into the .pptx and comes back', async () => {
  await open('Colores');
  await page.getByRole('menuitemradio', { name: 'Verde', exact: true }).click();
  await settle();
  const bytes = await page.evaluate(() => window.__novaSlides.write());
  await page.evaluate((b) => window.__novaSlides.load(b), bytes);
  await settle();
  assert.equal((await theme()).colors.accent1, '#549e39');
});

await check('keyboard: the menu opens with Enter and its items are reached with Tab', async () => {
  await page.getByRole('button', { name: 'Colores', exact: true }).focus();
  await page.keyboard.press('Enter');
  await settle(300);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitemradio');
  await page.keyboard.press('Escape');
});

await check('no console errors', async () => assert.deepEqual(errors, []));
await browser.close();
for (const [s, n, d] of results) console.log(s === 'ok' ? `✓ ${n}` : `✗ ${n}\n    ${d}`);
const ok = results.filter((r) => r[0] === 'ok').length;
console.log(`\n${ok}/${results.length} checks passed`);
process.exit(ok === results.length ? 0 : 1);
