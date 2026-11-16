// End-to-end checks for the charts in Nova Writer: insert from the dialog, edit data/type from the contextual tab, double click,
// and save/reopen as .docx. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-chart.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const results = [];
let step = 0;

const session = async (fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('.ProseMirror');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Texto del documento.');
  const shot = async (name) => {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
  };
  try {
    await fn(page, shot);
    assert.deepEqual(errors, [], 'sin errores de consola');
  } finally {
    await ctx.close();
  }
};
const check = async (name, fn) => {
  try {
    await session(fn);
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
  }
};

/** El primer gráfico del documento. */
const chart = (page) =>
  page.evaluate(() => {
    let out = null;
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'chart' && !out) out = { type: n.attrs.chart.type, title: n.attrs.chart.title, grid: n.attrs.grid, wrap: n.attrs.wrap, width: n.attrs.width };
    });
    return out;
  });
const openDlg = async (page) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Gráfico…', exact: true }).click();
  await page.getByRole('dialog').waitFor();
};

await check('insertar un gráfico desde el cuadro: tipo, título, datos y se ve', async (page, shot) => {
  await openDlg(page);
  await page.getByLabel('Tipo de gráfico').selectOption('line');
  await page.getByLabel('Título del gráfico', { exact: true }).fill('Ventas');
  await page.getByLabel('Fila 1, columna 2').fill('9');
  await shot('dialogo');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  const c = await chart(page);
  assert.ok(c, 'hay un gráfico');
  assert.equal(c.type, 'line');
  assert.equal(c.title, 'Ventas');
  assert.equal(c.grid[1][1], 9);
  assert.ok(await page.locator('.ProseMirror .nw-chart img').isVisible(), 'se dibuja');
  await shot('insertado');
});

await check('editar desde la pestaña contextual y con doble clic; también un tipo de Office 2016', async (page) => {
  await openDlg(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('[role=tab]').filter({ hasText: 'Diseño de gráfico' }).click();
  await page.getByRole('button', { name: 'Editar datos y tipo del gráfico…' }).click();
  await page.getByRole('button', { name: 'Agregar fila', exact: true }).click();
  await page.getByLabel('Fila 5, columna 1').fill('Nueva');
  await page.getByLabel('Fila 5, columna 2').fill('7');
  await page.getByLabel('Tipo de gráfico').selectOption('waterfall');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(300);
  let c = await chart(page);
  assert.equal(c.type, 'waterfall');
  assert.equal(c.grid[5][0], 'Nueva');
  await page.locator('.ProseMirror .nw-chart').dblclick();
  await page.getByRole('dialog').waitFor();
  await page.getByLabel('Tipo de gráfico').selectOption('pie');
  await page.getByLabel('Ancho del gráfico').fill('400');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(300);
  c = await chart(page);
  assert.equal(c.type, 'pie');
  assert.equal(c.width, 400);
});

await check('guardar y volver a leer el .docx conserva el gráfico con sus datos', async (page) => {
  await openDlg(page);
  await page.getByLabel('Tipo de gráfico').selectOption('waterfall');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  const back = await page.evaluate(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    let a = null;
    d.body.descendants((n) => void (n.type.name === 'chart' && !a && (a = n.attrs)));
    return a && { type: a.chart.type, cell: a.grid[1][1] };
  });
  assert.ok(back, 'vuelve el gráfico');
  assert.equal(back.type, 'waterfall');
  assert.equal(back.cell, 4.3);
});

for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
