// Closing checks of the shared tables: speed with a table of hundreds of rows (style decorations, typing, changing the style) and accessibility
// (alternative text read by assistive technology, header cells, keyboard). Needs `pnpm dev` on :1420. Usage: node scripts/e2e-tables-close.mjs
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

const ROWS = 400;
const COLS = 6;
// a table of 400 × 6 with a style and the alternative text, built through the editor's own schema
await page.evaluate(
  ({ rows, cols }) => {
    const v = window.__novaWriter.ctl.mainView;
    const S = v.state.schema;
    const cell = (txt, header) => S.nodes[header ? 'table_header' : 'table_cell'].create(null, S.nodes.paragraph.create(null, txt ? S.text(txt) : null));
    const trs = [];
    for (let r = 0; r < rows; r++) trs.push(S.nodes.table_row.create(null, Array.from({ length: cols }, (_x, c) => cell(r === 0 ? `Col ${c + 1}` : String(r * (c + 1)), r === 0))));
    const table = S.nodes.table.create({ tstyle: 'medium-1', topts: { firstRow: true, bandRows: true }, caption: 'Ventas', descr: 'Ventas por trimestre' }, trs);
    // the end of the document, after a paragraph: next to another table the editor would join them
    v.dispatch(v.state.tr.insert(v.state.doc.content.size - 1, [S.nodes.paragraph.create(), table, S.nodes.paragraph.create()]));
  },
  { rows: ROWS, cols: COLS },
);
await page.waitForTimeout(800);

await check(`la tabla de ${ROWS} filas se dibuja con su estilo`, async () => {
  const n = await page.locator('.nw-doc table tr').count();
  assert.ok(n >= ROWS, `${n} filas`);
  const bg = await page.locator('.nw-doc table tr').nth(0).locator('td, th').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.notEqual(bg, 'rgba(0, 0, 0, 0)');
});

await check('escribir en la tabla grande responde en menos de 250 ms por pulsación', async () => {
  await page.locator('.nw-doc table tr').nth(200).locator('td').first().click();
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) await page.keyboard.type('x');
  const per = (Date.now() - t0) / 20;
  console.log(`      ${per.toFixed(0)} ms por pulsación`);
  assert.ok(per < 250, `${per} ms`);
});

await check('cambiar el estilo de la tabla grande tarda menos de 3 s', async () => {
  const t0 = Date.now();
  await page.evaluate(() => {
    const ctl = window.__novaWriter.ctl;
    const v = ctl.mainView;
    let pos = -1;
    v.state.doc.descendants((n, p) => (n.type.name === 'table' ? ((pos = p), false) : true));
    v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...v.state.doc.nodeAt(pos).attrs, tstyle: 'dark-2' }));
  });
  await page.waitForFunction(() => document.querySelector('.nw-doc table')?.getAttribute('data-tstyle') === 'dark-2');
  const ms = Date.now() - t0;
  console.log(`      ${ms} ms`);
  assert.ok(ms < 3000, `${ms} ms`);
});

await check('accesibilidad: el título y la descripción de la tabla los lee el lector de pantalla', async () => {
  const t = page.locator('.nw-doc table').first();
  assert.equal(await t.getAttribute('aria-label'), 'Ventas');
  assert.equal(await t.getAttribute('aria-description'), 'Ventas por trimestre');
});

await check('accesibilidad: la fila de encabezado usa celdas de encabezado', async () => {
  assert.equal(await page.locator('.nw-doc table tr').first().locator('th').count(), COLS);
});

await check('teclado: Tab pasa a la celda siguiente y Mayús+Tab a la anterior', async () => {
  await page.locator('.nw-doc table tr').nth(3).locator('td').nth(1).click();
  const where = () => page.evaluate(() => { const s = getSelection().anchorNode; const td = (s.nodeType === 1 ? s : s.parentElement).closest('td, th'); return td ? [...td.parentElement.children].indexOf(td) : -1; });
  const a = await where();
  await page.keyboard.press('Tab');
  assert.equal(await where(), a + 1);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await where(), a);
});

results.push([errors.length ? 'FAIL' : 'ok', 'sin errores de página', errors.slice(0, 3).join(' | ')]);
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
