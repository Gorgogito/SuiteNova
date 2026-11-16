// End-to-end checks for chart elements (axis titles, data labels, legend position, gridlines, data table) in Nova Calc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-chartelements.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.waitForTimeout(400);
await page.mouse.click(300, 400);
const ev = (fn, arg) => page.evaluate(fn, arg);
const btn = (name) => page.getByRole('button', { name }).first();

// datos: mes, ventas (con tendencia casi lineal), costos
await ev(() => {
  const d = window.__novaCalc.doc;
  const rows = [['Mes', 'Ventas', 'Costos'], ['Ene', '12', '8'], ['Feb', '15', '9'], ['Mar', '19', '9.5'], ['Abr', '21', '11'], ['May', '26', '12'], ['Jun', '29', '12.5'], ['Jul', '34', '14']];
  rows.forEach((r, i) => r.forEach((t, c) => d.wb.setInput(d.activeSheetId, i, c, t)));
});

const makeChart = (kind, range) =>
  ev(([k, r]) => {
    const d = window.__novaCalc.doc;
    d.selectRange(r);
    const err = d.insertChart(k);
    if (err) throw new Error(err);
    const id = d.sheet.charts[d.sheet.charts.length - 1].id;
    d.selectChart(id);
    return id;
  }, [kind, range]);

const menu = async (group, item) => {
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await btn('Agregar elemento de gráfico').click();
  await page.getByRole('menuitem', { name: item, exact: true }).first().click();
  await page.waitForTimeout(350);
};
const chart0 = () => ev(() => window.__novaCalc.doc.sheet.charts.at(-1));

await check('menú Agregar elemento: título de eje, leyenda a la derecha y cuadrícula secundaria', async () => {
  await makeChart('column', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await page.waitForTimeout(300);
  await btn('Agregar elemento de gráfico').or(page.getByRole('tab', { name: /Diseño de gráfico/ })).first().click().catch(() => {});
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await shot('menu');
  await btn('Agregar elemento de gráfico').click();
  await shot('menu-abierto');
  await page.getByRole('menuitem', { name: 'Título del eje vertical' }).first().click();
  await page.waitForTimeout(300);
  let c = await chart0();
  assert.equal(c.axisY.title, 'Título del eje');
  await menu('Leyenda', 'Leyenda a la derecha');
  c = await chart0();
  assert.equal(c.legend, true);
  assert.equal(c.legendPos, 'r');
  await menu('Cuadrícula', 'Cuadrícula secundaria horizontal');
  c = await chart0();
  assert.equal(c.axisY.minorGridlines, true);
  await shot('resultado');
});

await check('etiquetas de datos y tabla de datos desde el menú; deshacer vuelve atrás', async () => {
  await makeChart('line', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await page.waitForTimeout(300);
  await menu('Etiquetas de datos', 'Etiquetas: arriba');
  let c = await chart0();
  assert.ok(c.series.every((s) => s.labels?.value && s.labels.pos === 't'), 'etiquetas arriba en todas las series');
  await menu('Tabla de datos', 'Tabla de datos con claves de leyenda');
  c = await chart0();
  assert.deepEqual(c.dataTable, { keys: true });
  await shot('tabla-de-datos');
  await ev(() => window.__novaCalc.doc.undo());
  c = await chart0();
  assert.equal(c.dataTable, undefined);
});

await check('guardar y volver a leer el .xlsx conserva los elementos', async () => {
  await makeChart('column', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await menu('Leyenda', 'Leyenda arriba');
  await menu('Etiquetas de datos', 'Etiquetas: interior final');
  const back = await ev(async () => {
    const r = await window.__novaCalc.xlsxRoundTrip();
    const c = r.charts.at(-1);
    return { legendPos: c.legendPos, pos: c.series[0].labels?.pos, value: c.series[0].labels?.value };
  });
  assert.equal(back.legendPos, 't');
  assert.equal(back.pos, 'inEnd');
  assert.equal(back.value, true);
});

assert.deepEqual(errors, [], 'sin errores de consola');
results.push(['ok', 'sin errores de consola']);
for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
