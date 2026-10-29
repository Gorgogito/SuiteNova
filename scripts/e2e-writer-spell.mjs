// End-to-end checks for the spelling check. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-spell.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 700) => page.waitForTimeout(ms);
const tab = async (n) => {
  const t = page.getByRole('tab', { name: n, exact: true });
  if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
};
const waitEngine = () => page.waitForFunction(() => !window.__novaWriter.ctl.spellLoading, null, { timeout: 30000 });
const newDoc = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await waitEngine();
  await page.locator('.ProseMirror').click();
};
const underlined = () => page.locator('.ProseMirror .nw-misspelled').allInnerTexts();

await check('mistakes are underlined while typing and correct words are not', async () => {
  await newDoc();
  await page.keyboard.type('Esta es una cassa muy bonita y el perro ladra fuerrte.');
  await settle(800);
  assert.deepEqual(await underlined(), ['cassa', 'fuerrte']);
  await shot('underlined');
});

await check('right click offers suggestions and fixes the word', async () => {
  await page.locator('.ProseMirror .nw-misspelled').first().click({ button: 'right' });
  await page.locator('.nw-ctl-popup[aria-label="Ortografía"]').waitFor();
  const items = await page.locator('.nw-ctl-popup [role=menuitem]').allInnerTexts();
  assert.ok(items.includes('casa'), JSON.stringify(items));
  assert.ok(items.includes('Omitir todo') && items.includes('Agregar al diccionario'));
  await shot('menu');
  await page.locator('.nw-ctl-popup [role=menuitem]', { hasText: /^casa$/ }).click();
  await settle(500);
  assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /una casa muy/);
  assert.deepEqual(await underlined(), ['fuerrte']);
});

await check('the spelling dialog (F7) walks the mistakes, changes and adds to the dictionary', async () => {
  await newDoc();
  await page.keyboard.type('Una frase con ortografia mala y un zorbaxilo raro.');
  await settle(800);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).first().click();
  await page.locator('[data-testid="spell-word"]').waitFor();
  assert.equal(await page.locator('[data-testid="spell-word"]').innerText(), 'ortografia');
  const sug = await page.locator('#nw-sp-sug option').allInnerTexts();
  assert.ok(sug.includes('ortografía'), JSON.stringify(sug));
  await shot('spell-dialog');
  await page.locator('#nw-sp-sug').selectOption('ortografía');
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="spell-word"]')?.textContent === 'zorbaxilo');
  await page.getByRole('button', { name: 'Agregar al diccionario' }).click();
  await page.getByText('La revisión ortográfica ha terminado.').waitFor();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle(500);
  const text = await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent);
  assert.match(text, /ortografía mala/);
  assert.deepEqual(await underlined(), []);
  const saved = await ev(() => localStorage.getItem('nova.writer.userDictionary'));
  assert.match(saved, /zorbaxilo/);
});

await check('language: switching to English checks English words', async () => {
  await newDoc();
  await page.keyboard.type('I will recieve the letter');
  await settle(800);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'English' }).click();
  await waitEngine();
  await settle(800);
  assert.deepEqual(await underlined(), ['recieve']);
  await shot('english');
});

await check('check while typing can be turned off', async () => {
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Revisar mientras escribe' }).click();
  await settle(500);
  assert.deepEqual(await underlined(), []);
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Revisar mientras escribe' }).click();
  await waitEngine();
  await settle(600);
  assert.deepEqual(await underlined(), ['recieve']);
  await ev(() => window.__novaWriter.ctl.setSpellLang('es'));
  await waitEngine();
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
