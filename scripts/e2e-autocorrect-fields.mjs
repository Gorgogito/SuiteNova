// End-to-end checks for AutoCorrect in plain text fields (Mail, Calc): list and exceptions of the field's language, and the dialog from the field menu. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-autocorrect-fields.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => (d.type() === 'beforeunload' ? d.accept() : (errors.push(`dialog: ${d.message()}`), d.dismiss())));
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
  }
};
const settle = (ms = 700) => page.waitForTimeout(ms);
const open = async (app, lang, store) => {
  await page.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
  await page.evaluate(({ lang, store }) => {
    localStorage.setItem('nova.spell.lang', lang);
    if (store) localStorage.setItem('nova.writer.autocorrect', JSON.stringify(store));
    else localStorage.removeItem('nova.writer.autocorrect');
  }, { lang, store });
  await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load' });
  await settle(900);
};
const mailBody = async () => {
  await page.keyboard.press('Control+Shift+M');
  const body = page.getByLabel('Cuerpo del mensaje');
  await body.click();
  return body;
};

await check('Mail en español: la lista española corrige «tambien» y deja «teh»', async () => {
  await open('mail', 'es');
  const body = await mailBody();
  await page.keyboard.type('hola tambien teh ');
  assert.equal(await body.inputValue(), 'Hola también teh ');
});

await check('Mail en inglés: la lista inglesa corrige «teh» y deja «tambien»', async () => {
  await open('mail', 'en');
  const body = await mailBody();
  await page.keyboard.type('hello tambien teh ');
  assert.equal(await body.inputValue(), 'Hello tambien the ');
});

const store = { version: 2, flags: {}, lists: {}, exceptions: { es: { firstLetter: ['zzz'], twoInitialCaps: [], other: [] } } };
await check('la excepción «zzz» del español vale en un campo en español y no en uno en inglés', async () => {
  await open('mail', 'es', store);
  let body = await mailBody();
  await page.keyboard.type('ok zzz. hola ');
  assert.equal(await body.inputValue(), 'Ok zzz. hola ');
  await open('mail', 'en', store);
  body = await mailBody();
  await page.keyboard.type('ok zzz. hola ');
  assert.equal(await body.inputValue(), 'Ok zzz. Hola ');
});

await check('el menú del botón derecho del campo abre el cuadro de autocorrección (sin pestaña matemática)', async () => {
  await open('mail', 'es');
  const body = await mailBody();
  await page.keyboard.type('hola mundo ');
  const box = await body.boundingBox();
  await page.mouse.click(box.x + 20, box.y + 12, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Opciones de autocorrección…' }).click();
  await page.getByRole('dialog', { name: 'Opciones de autocorrección' }).waitFor();
  assert.ok(await page.getByRole('tab', { name: 'Autoformato' }).count());
  assert.equal(await page.getByRole('tab', { name: 'Autocorrección matemática' }).count(), 0);
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

await check('un reemplazo añadido desde el campo vale al seguir escribiendo', async () => {
  await open('mail', 'es');
  const body = await mailBody();
  await page.keyboard.type('hola mundo ');
  const box = await body.boundingBox();
  await page.mouse.click(box.x + 20, box.y + 12, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Opciones de autocorrección…' }).click();
  await page.getByRole('dialog', { name: 'Opciones de autocorrección' }).waitFor();
  await page.getByRole('textbox', { name: 'Reemplazar' }).fill('qqq');
  await page.getByRole('textbox', { name: 'Con' }).fill('quiero que quede');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle(300);
  await body.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('qqq ');
  assert.match(await body.inputValue(), /quiero que quede $/);
});

await check('Calc en inglés: la celda corrige «teh» con la lista inglesa', async () => {
  await open('calc', 'en');
  await page.waitForSelector('.calc-grid__scroller');
  const box = await page.locator('.calc-grid__scroller').boundingBox();
  await page.mouse.click(box.x + 72, box.y + 32);
  await page.keyboard.type('hello teh ');
  assert.equal(await page.locator('.calc-editor').inputValue(), 'hello the ');
});

await page.evaluate(() => localStorage.removeItem('nova.writer.autocorrect'));
await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? '✔' : '✘', r[1], r[2] ?? '');
if (errors.length) console.log('Errores de consola:', errors.slice(0, 5));
process.exit(results.some((r) => r[0] !== 'ok') ? 1 : 0);
