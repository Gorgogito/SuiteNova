// Shared search in Nova Mail: in the message being written (F4, Ctrl+H, F3, replace, wildcards) and in the message being read (F4, highlights).
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-find-mail.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=mail';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ml-item, .ml-folders');
await page.waitForFunction(() => !!window.__novaMail, null, { timeout: 60000 });
await page.waitForTimeout(500);
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').slice(0, 4).join(' | ')]);
  }
};
const wait = (ms = 200) => page.waitForTimeout(ms);
const bar = page.locator('.nv-find-bar');
const find = bar.getByLabel('Buscar', { exact: true });
const info = () => bar.locator('.nv-find-info').first().innerText();

await check('writing: F4 finds, counts and selects in the body', async () => {
  await page.keyboard.press('Control+Shift+M');
  const body = page.getByLabel('Cuerpo del mensaje');
  await body.fill('Hola Ana\nGato y gato y GATO\nAdiós');
  await body.click();
  await page.keyboard.press('F4');
  await bar.waitFor();
  await find.fill('gato');
  await wait();
  assert.equal(await info(), '1 de 3');
  await bar.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await wait();
  assert.equal(await info(), '2 de 3');
  const sel = await page.evaluate(() => {
    const t = document.querySelector('textarea[aria-label="Cuerpo del mensaje"]');
    return t.value.slice(t.selectionStart, t.selectionEnd);
  });
  assert.equal(sel.toLowerCase(), 'gato');
});

await check('writing: F3 goes on from the body', async () => {
  await page.keyboard.press('F3');
  await wait();
  const sel = await page.evaluate(() => {
    const t = document.querySelector('textarea[aria-label="Cuerpo del mensaje"]');
    return [t.selectionStart, t.value.slice(t.selectionStart, t.selectionEnd)];
  });
  assert.equal(sel[1].toLowerCase(), 'gato');
  assert.ok(sel[0] > 15);
});

await check('writing: Ctrl+H replaces all with groups (wildcards) and the draft keeps it', async () => {
  await page.getByLabel('Cuerpo del mensaje').click();
  await page.keyboard.press('Control+h');
  await wait();
  await bar.getByLabel('Opciones de búsqueda').click();
  await bar.getByLabel('Cómo se lee lo que se busca').selectOption('wildcards');
  await find.fill('(<[A-Z][a-z]@>) (<[A-Z][a-z]@>)');
  await bar.getByLabel('Coincidir mayúsculas').check();
  await bar.getByLabel('Reemplazar con').fill('\\2 \\1');
  await bar.getByRole('button', { name: 'Reemplazar todo', exact: true }).click();
  await wait();
  const v = await page.getByLabel('Cuerpo del mensaje').inputValue();
  assert.ok(v.startsWith('Ana Hola\n'), v);
});

await check('writing: replace one by one with ^p', async () => {
  await bar.getByLabel('Coincidir mayúsculas').uncheck();
  await bar.getByLabel('Cómo se lee lo que se busca').selectOption('normal');
  await find.fill(' y ');
  await bar.getByLabel('Reemplazar con').fill('^p');
  await wait();
  await bar.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  await wait();
  const v = await page.getByLabel('Cuerpo del mensaje').inputValue();
  assert.ok(v.includes('Gato\ngato y GATO'), v);
  await bar.getByRole('button', { name: 'Cerrar', exact: true }).click();
  // the message has text: closing it asks
  await page.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
  await page.getByRole('button', { name: 'Descartar', exact: true }).click();
});

await check('reading: F4 highlights and counts in the message', async () => {
  const raw = ['From: Ana <ana@x.es>', 'To: yo@nova.local', 'Subject: Gatos', 'Date: Mon, 1 Jan 2024 10:00:00 +0000', 'Content-Type: text/html; charset=utf-8', '', '<p>Un <b>gato</b> negro</p><p>Otro gato y otro GATO</p>'].join('\r\n');
  const id = await page.evaluate((raw) => window.__novaMail.ctl.importRaw(raw, 'inbox', { read: true }).id, raw);
  await page.evaluate((id) => { window.__novaMail.ctl.selectedId = id; window.__novaMail.ctl.touch?.(); }, id);
  await page.locator('.ml-item', { hasText: 'Gatos' }).first().click();
  await page.locator('.ml-frame').waitFor();
  await wait(400);
  await page.getByRole('button', { name: 'Buscar en el mensaje', exact: true }).click();
  await find.fill('gato');
  await wait();
  assert.equal(await info(), '1 de 3');
  const n = await page.locator('.ml-frame').evaluate((f) => f.contentWindow.CSS.highlights?.get('nova-find')?.size ?? -1);
  assert.equal(n, 3);
  await bar.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await wait();
  assert.equal(await info(), '2 de 3');
  assert.equal(await bar.getByLabel('Reemplazar con').count(), 0);
  await bar.getByRole('button', { name: 'Cerrar', exact: true }).click();
  const after = await page.locator('.ml-frame').evaluate((f) => f.contentWindow.CSS.highlights?.get('nova-find')?.size ?? 0);
  assert.equal(after, 0);
});

await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ?? '');
if (errors.length) console.log('page errors:', errors.slice(0, 3));
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`${results.length - failed} de ${results.length} bien`);
process.exit(failed || errors.length ? 1 : 0);
