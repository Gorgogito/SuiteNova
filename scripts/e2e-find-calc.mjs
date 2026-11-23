// Shared search in Calc: Excel wildcards (? * ~), whole cell, formulas, whole workbook, by columns, «Find All» list, replace one by one and all
// (one undo step), regular expression. Needs `pnpm dev` on :1420. Usage: node scripts/e2e-find-calc.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?app=calc`, { waitUntil: 'load' });
await page.waitForSelector('.calc-fbar__name');
await page.waitForTimeout(700);
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').slice(0, 4).join(' | ')]);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (a) => ev((addr) => window.__novaCalc.text(addr), a);
// A1:A6 text, B1 a formula, a second sheet with one match
await ev(() => {
  const d = window.__novaCalc.doc;
  const s = d.activeSheetId;
  d.setCellsText([
    { sheetId: s, row: 0, col: 0, text: 'Gato' },
    { sheetId: s, row: 1, col: 0, text: 'gato negro' },
    { sheetId: s, row: 2, col: 0, text: 'Pato' },
    { sheetId: s, row: 3, col: 0, text: 'a*b' },
    { sheetId: s, row: 4, col: 0, text: 'axb' },
    { sheetId: s, row: 0, col: 1, text: '=CONCATENATE("ga","to")' },
    { sheetId: s, row: 0, col: 2, text: 'gato' },
  ]);
});
const dlg = page.getByRole('dialog');
const find = dlg.getByLabel('Buscar', { exact: true });
const info = () => dlg.locator('.nv-find-info').first().innerText();
const openMore = async () => {
  if ((await dlg.getByLabel('Opciones de búsqueda').getAttribute('aria-expanded')) !== 'true') await dlg.getByLabel('Opciones de búsqueda').click();
};
const open = async (key) => {
  await ev(() => window.__novaCalc.doc.selectCell(0, 0));
  await page.locator('.calc-fbar__name').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press(key);
  await dlg.waitFor();
};
const close = async () => {
  await dlg.getByRole('button', { name: 'Cerrar' }).first().click();
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
};

await check('? and * as Excel reads them, and ~ takes the next one literally', async () => {
  await open('Control+F');
  await find.fill('?ato');
  await page.waitForTimeout(150);
  assert.match(await info(), /de 5$/); // Gato, gato negro, Pato and the two cells that show «gato»
  await find.fill('g*o');
  await page.waitForTimeout(150);
  assert.match(await info(), /de 4$/);
  await find.fill('a~*b');
  await page.waitForTimeout(150);
  assert.equal(await info(), '1 de 1');
  assert.equal(await ev(() => window.__novaCalc.doc.sel.active.row), 3);
});

await check('whole cell contents', async () => {
  await openMore();
  await find.fill('gato');
  await page.waitForTimeout(150);
  const before = await info();
  await dlg.getByLabel('Todo el contenido de la celda').check();
  await page.waitForTimeout(150);
  const after = await info();
  assert.notEqual(before, after);
  assert.match(after, /de [0-9]$/);
  await dlg.getByLabel('Todo el contenido de la celda').uncheck();
});

await check('look in formulas', async () => {
  await find.fill('CONCATENAR');
  await page.waitForTimeout(150);
  assert.equal(await info(), 'Sin resultados');
  await dlg.getByLabel('Buscar en fórmulas').check();
  await page.waitForTimeout(150);
  assert.equal(await info(), '1 de 1');
  await dlg.getByLabel('Buscar en fórmulas').uncheck();
});

await check('Find All lists every cell and a click goes to it', async () => {
  await find.fill('gato');
  await dlg.getByRole('button', { name: 'Buscar todos', exact: true }).click();
  const items = dlg.locator('.nv-find-list button');
  assert.ok((await items.count()) >= 3);
  assert.match(await items.first().innerText(), /A1/);
  await items.nth(1).click();
  assert.ok(await ev(() => window.__novaCalc.doc.sel.active.row >= 0));
});

await check('by columns changes the order of the list', async () => {
  await dlg.getByLabel('Por columnas').check();
  await dlg.getByRole('button', { name: 'Buscar todos', exact: true }).click();
  const labels = await dlg.locator('.nv-find-list button strong').allInnerTexts();
  assert.ok(labels.join(',').indexOf('A2') < labels.join(',').indexOf('B1') || labels.join(',').indexOf('C1') > labels.join(',').indexOf('A2'), labels.join(','));
  await dlg.getByLabel('Por columnas').uncheck();
});

await check('replace all is one undo step', async () => {
  await close();
  await open('Control+H');
  await find.fill('Pato');
  await dlg.getByLabel('Reemplazar con').fill('Perro');
  await dlg.getByRole('button', { name: 'Reemplazar todo', exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(await text('A3'), 'Perro');
  await close();
  await ev(() => window.__novaCalc.doc.undo?.());
  await page.waitForTimeout(150);
  assert.equal(await text('A3'), 'Pato');
});

await check('replace the current one, then the next', async () => {
  await open('Control+H');
  await find.fill('gato');
  await dlg.getByLabel('Reemplazar con').fill('lobo');
  await page.waitForTimeout(150);
  await dlg.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  await page.waitForTimeout(150);
  assert.equal(await text('A1'), 'lobo');
  assert.equal(await text('A2'), 'gato negro');
  await close();
});

await check('a regular expression and an invalid one', async () => {
  await open('Control+F');
  await openMore();
  await dlg.getByLabel('Cómo se lee lo que se busca').selectOption('regex');
  await find.fill('^p.to$');
  await page.waitForTimeout(150);
  assert.equal(await info(), '1 de 1');
  await find.fill('(');
  await page.waitForTimeout(150);
  assert.match(await info(), /no válida/i);
  await close();
});

await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ?? '');
if (errors.length) console.log('page errors:', errors.slice(0, 3));
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`${results.length - failed} de ${results.length} bien`);
process.exit(failed || errors.length ? 1 : 0);
