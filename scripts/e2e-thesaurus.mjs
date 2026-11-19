// End-to-end checks for the thesaurus pane (Shift+F7) in Writer. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-thesaurus.mjs [--shots dir]
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
page.on('dialog', (d) => (errors.push(`dialog: ${d.message()}`), d.dismiss()));
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
const waitEngine = () => page.waitForFunction(() => !window.__novaWriter.ctl.spellLoading, null, { timeout: 30000 });
const newDoc = async (text) => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await waitEngine();
  await page.locator('.ProseMirror').click();
  if (text) await page.keyboard.type(text);
};
const pane = () => page.getByRole('complementary', { name: 'Sinónimos' });
const docText = () => page.locator('.ProseMirror').innerText();
const look = async (word) => {
  await pane().getByLabel('Palabra a buscar').fill(word);
  await pane().getByRole('button', { name: 'Buscar sinónimos' }).first().click();
};

await check('Shift+F7 opens the pane with the word at the cursor and its meanings', async () => {
  await newDoc('La casa grande');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+F7');
  await pane().waitFor();
  await pane().getByTestId('th-result').waitFor({ timeout: 20000 });
  assert.equal((await pane().locator('.nv-th-head').innerText()).trim(), 'grande');
  await shot('pane-grande');
});

await check('Insert replaces the word, keeps the capital letter, and the pane follows the document word', async () => {
  await newDoc('Casa bonita');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.nv-th-head')?.textContent?.trim() === 'casa', null, { timeout: 5000 });
  await pane().locator('.nv-th-word', { hasText: /^vivienda$/ }).first().click();
  await pane().getByRole('button', { name: 'Insertar' }).click();
  await settle(300);
  assert.equal((await docText()).trim(), 'Vivienda bonita');
});

await check('an inflected word is found by its base form; the replacement goes in place of the typed word', async () => {
  await newDoc('Dos casas');
  await page.waitForFunction(() => /casa\s*\(de «casas»\)/.test(document.querySelector('.nv-th-head')?.textContent ?? ''), null, { timeout: 5000 });
  await pane().locator('.nv-th-word', { hasText: /^residencia$/ }).first().click();
  await pane().getByRole('button', { name: 'Insertar' }).click();
  assert.equal((await docText()).trim(), 'Dos residencia');
});

await check('looking up a word from the pane and going back', async () => {
  await look('feliz');
  assert.equal((await pane().locator('.nv-th-head').innerText()).trim(), 'feliz');
  await pane().locator('.nv-th-word').first().click();
  await pane().locator('.nv-th-actions').getByRole('button', { name: 'Buscar sinónimos' }).click();
  assert.notEqual((await pane().locator('.nv-th-head').innerText()).trim(), 'feliz');
  await pane().getByRole('button', { name: 'Anterior' }).click();
  assert.equal((await pane().locator('.nv-th-head').innerText()).trim(), 'feliz');
  await shot('pane-feliz');
});

await check('a word that is not in the thesaurus says so and offers similar ones', async () => {
  await look('cassa');
  const none = pane().getByTestId('th-none');
  await none.waitFor();
  assert.match(await none.innerText(), /No se encontró «cassa»/);
  assert.ok((await none.locator('.nv-th-word').allInnerTexts()).includes('casa'));
});

await check('English: meanings by part of speech, related words and antonyms', async () => {
  await ev(() => window.__novaWriter.ctl.setSpellLang('en'));
  await settle();
  await waitEngine();
  await look('happy');
  await pane().getByTestId('th-result').waitFor({ timeout: 20000 });
  const text = await pane().innerText();
  assert.match(text, /Adjetivo/i);
  assert.match(text, /glad/);
  assert.match(text, /Antónimos/);
  assert.match(text, /unhappy/);
  await shot('pane-happy');
  await ev(() => window.__novaWriter.ctl.setSpellLang('es'));
});

await check('Copy puts the word on the clipboard and the pane closes with the X', async () => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await look('feliz');
  await pane().locator('.nv-th-word', { hasText: /^contento$/ }).click();
  await pane().getByRole('button', { name: 'Copiar' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'contento');
  await pane().getByRole('button', { name: 'Cerrar' }).click();
  assert.equal(await pane().count(), 0);
});

await check('the Review tab has the Thesaurus button and it toggles the pane', async () => {
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: /^Sinónimos/ }).first().click();
  await pane().waitFor();
  await page.getByRole('button', { name: /^Sinónimos/ }).first().click();
  assert.equal(await pane().count(), 0);
});

await check('right click on a flagged single word offers its synonyms in the menu', async () => {
  await newDoc('Habían muchas personas en la fiesta.');
  await settle(1500);
  await page.locator('.ProseMirror .nw-grammar', { hasText: /^Habían$/ }).first().click({ button: 'right' });
  const menu = page.locator('.nv-sp-menu');
  await menu.waitFor();
  await shot('menu');
  const open = menu.getByText('Sinónimos…');
  assert.ok((await open.count()) > 0, 'el menú no ofrece sinónimos para «Habían»');
  await open.click();
  await pane().waitFor();
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
