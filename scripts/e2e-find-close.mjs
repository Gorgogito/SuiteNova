// Closing checks of search and replace: speed with a long document and a big sheet, and accessibility of the shared bar (roles, names, announcements,
// keyboard only, focus back to the document). Needs `pnpm dev` on :1420. Usage: node scripts/e2e-find-close.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const errors = [];
const results = [];
const check = async (name, fn) => {
  try {
    const extra = await fn();
    results.push(['ok', name, extra ?? '']);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').slice(0, 4).join(' | ')]);
  }
};
const open = async (app, ready) => {
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load' });
  await page.waitForSelector(ready);
  await page.waitForTimeout(700);
  return page;
};

// ------------------------------------------------------------------ Writer
const w = await open('writer', '.nw-doc');
const PARAS = 3000;
await w.evaluate((n) => {
  const v = window.__novaWriter.ctl.mainView;
  const S = v.state.schema;
  const paras = [];
  for (let i = 0; i < n; i++) paras.push(S.nodes.paragraph.create(null, S.text(`Párrafo ${i} con el gato y la casa número ${i * 7}, otro gato más.`)));
  v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, paras));
}, PARAS);
await w.waitForTimeout(2500);
const bar = w.locator('.nw-find-bar');
const find = bar.getByLabel('Buscar', { exact: true });

await check(`Writer: ${PARAS} paragraphs, typing in the box stays quick`, async () => {
  await w.locator('.ProseMirror').first().click();
  await w.keyboard.press('Control+F');
  await bar.waitFor();
  const t0 = Date.now();
  await find.pressSequentially('gato', { delay: 0 });
  await w.waitForFunction(() => /de \d+/.test(document.querySelector('.nv-find-info')?.textContent ?? ''));
  const ms = Date.now() - t0;
  assert.match(await bar.locator('.nv-find-info').first().innerText(), /de 6000$/);
  assert.ok(ms < 6000, `${ms} ms`);
  return `${ms} ms`;
});

await check('Writer: replace all of 6000 matches is one step and quick', async () => {
  await w.keyboard.press('Control+H');
  await w.waitForTimeout(200);
  await bar.getByLabel('Reemplazar con').fill('perro');
  const t0 = Date.now();
  await bar.getByRole('button', { name: 'Reemplazar todo', exact: true }).click();
  await w.waitForFunction(() => /6000/.test(document.querySelector('.nv-find-info')?.textContent ?? ''), null, { timeout: 30000 });
  const ms = Date.now() - t0;
  const txt = await w.evaluate(() => window.__novaWriter.ctl.mainView.state.doc.textBetween(0, 200, '\n'));
  assert.match(txt, /perro/);
  await w.evaluate(() => window.__novaWriter.ctl.mainView.focus());
  await w.keyboard.press('Control+Z');
  await w.waitForTimeout(500);
  const back = await w.evaluate(() => window.__novaWriter.ctl.mainView.state.doc.textBetween(0, 200, '\n'));
  assert.match(back, /gato/);
  assert.ok(ms < 15000, `${ms} ms`);
  return `${ms} ms`;
});

await check('Writer: a pattern that matches everywhere is cut at the limit, not frozen', async () => {
  await w.keyboard.press('Control+F');
  await bar.waitFor();
  await bar.getByLabel('Opciones de búsqueda').click();
  await bar.getByLabel('Cómo se lee lo que se busca').selectOption('regex');
  const t0 = Date.now();
  await find.fill('.');
  await w.waitForFunction(() => /de \d+/.test(document.querySelector('.nv-find-info')?.textContent ?? ''), null, { timeout: 60000 });
  const ms = Date.now() - t0;
  assert.ok(ms < 20000, `${ms} ms`);
  await find.fill('');
  return `${ms} ms`;
});

await check('accessibility: the bar is a labelled search region, inputs have names, the count is announced politely', async () => {
  await find.fill('casa');
  await w.waitForTimeout(300);
  assert.equal(await bar.getAttribute('role'), 'search');
  assert.ok(await bar.getAttribute('aria-label'));
  const unnamed = await bar.locator('input:not([type=checkbox]),select,button').evaluateAll((els) => els.filter((e) => !(e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent?.trim() || e.closest('label'))).length);
  assert.equal(unnamed, 0);
  const live = bar.locator('.nv-find-info').first();
  assert.equal(await live.getAttribute('aria-live'), 'polite');
  assert.equal(await live.getAttribute('role'), 'status');
  assert.equal(await bar.getByLabel('Opciones de búsqueda').getAttribute('aria-expanded'), 'true');
});

await check('accessibility: all with the keyboard (Enter next, Shift+Enter previous, Escape closes and the document gets the focus back)', async () => {
  await find.fill('casa');
  await w.waitForTimeout(300);
  const first = await bar.locator('.nv-find-info').first().innerText();
  await find.press('Enter');
  await w.waitForTimeout(200);
  const second = await bar.locator('.nv-find-info').first().innerText();
  assert.notEqual(first, second);
  await find.press('Shift+Enter');
  await w.waitForTimeout(200);
  assert.equal(await bar.locator('.nv-find-info').first().innerText(), first);
  await find.press('Tab');
  await w.keyboard.press('Escape');
  await w.waitForTimeout(300);
  assert.equal(await bar.count(), 0);
  const inDoc = await w.evaluate(() => !!document.activeElement?.closest('.ProseMirror'));
  assert.ok(inDoc, 'the focus did not go back to the document');
});
await w.close();

// ------------------------------------------------------------------ Calc
const c = await open('calc', '.calc-fbar__name');
const ROWS = 20000;
await c.evaluate((n) => {
  const d = window.__novaCalc.doc;
  const s = d.activeSheetId;
  const changes = [];
  for (let r = 0; r < n; r++) {
    changes.push({ sheetId: s, row: r, col: 0, text: r % 3 === 0 ? `Gato ${r}` : `Perro ${r}` });
    changes.push({ sheetId: s, row: r, col: 1, text: String(r) });
  }
  d.setCellsText(changes);
}, ROWS * 1);
await c.waitForTimeout(1500);
const dlg = c.getByRole('dialog');

await check(`Calc: ${ROWS} rows × 2, finding and Find All with ${Math.ceil(ROWS / 3)} matches`, async () => {
  await c.evaluate(() => window.__novaCalc.doc.selectCell(0, 0));
  await c.locator('.calc-fbar__name').click();
  await c.keyboard.press('Escape');
  await c.keyboard.press('Control+F');
  await dlg.waitFor();
  const t0 = Date.now();
  await dlg.getByLabel('Buscar', { exact: true }).fill('gat?');
  await c.waitForFunction((n) => new RegExp(`de ${n}$`).test(document.querySelector('[role=dialog] .nv-find-info')?.textContent ?? ''), Math.ceil(ROWS / 3), { timeout: 60000 });
  const ms = Date.now() - t0;
  const t1 = Date.now();
  await dlg.getByRole('button', { name: 'Buscar todos', exact: true }).click();
  await dlg.locator('.nv-find-list button').first().waitFor();
  const ms2 = Date.now() - t1;
  assert.equal(await dlg.locator('.nv-find-list button').count(), 500);
  assert.ok(ms < 15000 && ms2 < 15000, `${ms} / ${ms2} ms`);
  return `${ms} ms / lista ${ms2} ms`;
});

await check(`Calc: replace all of ${Math.ceil(ROWS / 3)} cells is one undo step`, async () => {
  await dlg.getByRole('button', { name: 'Cerrar' }).first().click();
  await c.keyboard.press('Control+H');
  await dlg.waitFor();
  await dlg.getByLabel('Buscar', { exact: true }).fill('Gato');
  await dlg.getByLabel('Reemplazar con').fill('Lobo');
  const t0 = Date.now();
  await dlg.getByRole('button', { name: 'Reemplazar todo', exact: true }).click();
  await c.waitForFunction(() => /\d+ /.test(document.querySelector('[role=dialog] .nv-find-info')?.textContent ?? '') && /reemplaz/i.test(document.querySelector('[role=dialog] .nv-find-info')?.textContent ?? ''), null, { timeout: 60000 });
  const ms = Date.now() - t0;
  assert.equal(await c.evaluate(() => window.__novaCalc.text('A1')), 'Lobo 0');
  await dlg.getByRole('button', { name: 'Cerrar' }).first().click();
  await c.evaluate(() => window.__novaCalc.doc.undo?.());
  await c.waitForTimeout(500);
  assert.equal(await c.evaluate(() => window.__novaCalc.text('A1')), 'Gato 0');
  assert.ok(ms < 30000, `${ms} ms`);
  return `${ms} ms`;
});
await c.close();

await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ?? '');
if (errors.length) console.log('page errors:', errors.slice(0, 3));
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`${results.length - failed} de ${results.length} bien`);
process.exit(failed || errors.length ? 1 : 0);
