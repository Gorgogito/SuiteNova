// Shared search in Writer: wildcards with groups, special characters across paragraphs, filter by format, replacing with a paragraph mark, undo,
// invalid expression and «Go to». Needs `pnpm dev` on :1420. Usage: node scripts/e2e-find-writer.mjs
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
await page.waitForSelector('.nw-doc');
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
const docText = () => page.evaluate(() => window.__novaWriter.ctl.mainView.state.doc.textBetween(0, window.__novaWriter.ctl.mainView.state.doc.content.size, '\n'));
const setDoc = (paras) =>
  page.evaluate((paras) => {
    const v = window.__novaWriter.ctl.mainView;
    const S = v.state.schema;
    const nodes = paras.map((p) => S.nodes.paragraph.create(null, p.text ? S.text(p.text, p.bold ? [S.marks.strong.create()] : []) : null));
    v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, nodes));
  }, paras);
const bar = page.locator('.nw-find-bar');
const find = bar.getByLabel('Buscar', { exact: true });
const info = bar.locator('.nv-find-info').first();
const openMore = async () => {
  if ((await bar.getByLabel('Opciones de búsqueda').getAttribute('aria-expanded')) !== 'true') await bar.getByLabel('Opciones de búsqueda').click();
};
const open = async (key) => {
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.press(key);
  await bar.waitFor();
};
const close = async () => {
  await bar.getByLabel('Cerrar').click();
};

await setDoc([{ text: 'Juan Lopez' }, { text: 'Ana Perez' }, { text: 'Hola mundo' }, { text: 'Hola de nuevo', bold: true }, { text: 'Adiós' }]);

await check('wildcards with groups replace all', async () => {
  await open('Control+H');
  await openMore();
  await bar.getByLabel('Cómo se lee lo que se busca').selectOption('wildcards');
  await bar.getByLabel('Coincidir mayúsculas').check();
  await find.fill('(<[A-Z][a-z]@>) (<[A-Z][a-z]@>)');
  await page.waitForTimeout(150);
  assert.equal(await info.innerText(), '1 de 2');
  await bar.getByLabel('Reemplazar con').fill('\\2, \\1');
  await bar.getByRole('button', { name: 'Reemplazar todo', exact: true }).click();
  await page.waitForTimeout(150);
  const txt = await docText();
  assert.ok(txt.startsWith('Lopez, Juan\nPerez, Ana\n'), txt);
});

await check('undo restores everything in one step', async () => {
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(150);
  const txt = await docText();
  assert.ok(txt.startsWith('Juan Lopez\nAna Perez\n'), txt);
  await close();
});

await check('^p finds across paragraphs and highlights', async () => {
  await open('Control+F');
  await find.fill('mundo^pHola');
  await page.waitForTimeout(150);
  assert.equal(await info.innerText(), '1 de 1');
  assert.ok((await page.locator('.nw-doc .nw-find').count()) >= 1);
});

await check('filter by bold', async () => {
  await find.fill('Hola');
  await page.waitForTimeout(150);
  assert.match(await info.innerText(), /de 2$/);
  await openMore();
  await bar.getByLabel('Negrita').check();
  await page.waitForTimeout(150);
  assert.equal(await info.innerText(), '1 de 1');
  await bar.getByLabel('Negrita').uncheck();
  await close();
});

await check('replace with ^p splits the paragraph', async () => {
  await open('Control+H');
  await find.fill('Hola mundo');
  await bar.getByLabel('Reemplazar con').fill('Hola^pmundo');
  await bar.getByRole('button', { name: 'Reemplazar todo', exact: true }).click();
  await page.waitForTimeout(150);
  const txt = await docText();
  assert.ok(txt.includes('Hola\nmundo\nHola de nuevo'), txt);
  await close();
});

await check('accents are ignored when asked', async () => {
  await open('Control+F');
  await find.fill('adios');
  await page.waitForTimeout(150);
  assert.equal(await info.innerText(), 'Sin resultados');
  await openMore();
  await bar.getByLabel('Ignorar acentos').check();
  await page.waitForTimeout(150);
  assert.equal(await info.innerText(), '1 de 1');
  await close();
});

await check('an invalid regular expression is reported, not thrown', async () => {
  await open('Control+F');
  await openMore();
  await bar.getByLabel('Cómo se lee lo que se busca').selectOption('regex');
  await find.fill('(abc');
  await page.waitForTimeout(150);
  assert.match(await info.innerText(), /no válida/i);
  await find.fill('H[a-z]+');
  await page.waitForTimeout(150);
  assert.match(await info.innerText(), /^1 de \d+$/);
  await close();
});

await check('go to a page that does not exist and one that does', async () => {
  await open('Control+G');
  const go = bar.getByLabel('Página', { exact: true });
  await go.fill('9');
  await go.press('Enter');
  await page.waitForTimeout(150);
  assert.match(await bar.locator('.nv-find-info').last().innerText(), /No hay una página 9/);
  await go.fill('1');
  await go.press('Enter');
  await page.waitForTimeout(150);
  assert.equal(await bar.locator('.nv-find-info').last().innerText(), '');
  assert.equal(await page.evaluate(() => window.__novaWriter.ctl.currentPage()), 1);
  await close();
});

await check('Escape closes the bar and clears the highlight', async () => {
  await open('Control+F');
  await find.fill('Hola');
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  assert.equal(await bar.count(), 0);
  assert.equal(await page.locator('.nw-doc .nw-find').count(), 0);
});

await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ?? '');
if (errors.length) console.log('page errors:', errors.slice(0, 3));
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`${results.length - failed} de ${results.length} bien`);
process.exit(failed || errors.length ? 1 : 0);
