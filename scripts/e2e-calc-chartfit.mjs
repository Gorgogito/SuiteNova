// End-to-end checks for trendlines and error bars in Nova Calc charts. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-chartfit.mjs [--shots dir]
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

await check('columnas: tendencia lineal con ecuación y barras de error desde la cinta', async () => {
  await makeChart('column', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await shot('pestana-grafico');
  await btn('Línea de tendencia').click();
  await page.getByRole('menuitem', { name: 'Lineal' }).click();
  await page.waitForTimeout(250);
  await btn('Barras de error').click();
  await page.getByRole('menuitem', { name: 'Error estándar' }).click();
  await page.waitForTimeout(400);
  const def = await ev(() => window.__novaCalc.doc.sheet.charts[0]);
  assert.equal(def.series.length, 2);
  assert.equal(def.series.every((s) => s.trendlines?.[0]?.type === 'linear'), true);
  assert.equal(def.series.every((s) => s.errY?.kind === 'stderr'), true);
  await shot('columnas-tendencia-error');
});

await check('Formato del gráfico > Análisis: ecuación, R² y prolongación', async () => {
  await btn('Formato del gráfico…').click();
  await page.getByRole('tab', { name: 'Análisis' }).click();
  await shot('dialogo-analisis');
  await page.getByLabel('Presentar ecuación en el gráfico').first().check();
  await page.getByLabel('Presentar el valor R cuadrado en el gráfico').first().check();
  await page.getByLabel('Prolongar hacia delante').first().fill('2');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(500);
  const tl = await ev(() => window.__novaCalc.doc.sheet.charts[0].series[0].trendlines[0]);
  assert.equal(tl.dispEq, true);
  assert.equal(tl.dispR2, true);
  assert.equal(tl.forward, 2);
  await shot('columnas-ecuacion');
});

await check('dispersión: tendencia polinómica con ecuación y barras de error en X e Y', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.selectChart(null);
    d.wb.setInput(d.activeSheetId, 0, 4, 'X');
    d.wb.setInput(d.activeSheetId, 0, 5, 'Y');
    [1, 2, 3, 4, 5, 6, 7].forEach((x, i) => { d.wb.setInput(d.activeSheetId, i + 1, 4, String(x)); d.wb.setInput(d.activeSheetId, i + 1, 5, String([12, 15, 19, 21, 26, 29, 34][i])); });
    d.selectRange({ r1: 0, c1: 4, r2: 7, c2: 5 });
    if (d.insertChart('scatter')) throw new Error('no se creó');
    const id = d.sheet.charts[d.sheet.charts.length - 1].id;
    d.updateChart(id, {
      x: 40,
      y: 330,
      series: [{ ...d.chartById(id).series[0], trendlines: [{ type: 'poly', order: 2, dispEq: true, dispR2: true }], errY: { kind: 'fixed', value: 2, direction: 'both' }, errX: { kind: 'percent', value: 10, direction: 'both' } }],
    });
    d.selectChart(id);
  });
  await page.waitForTimeout(500);
  await shot('dispersion');
  const n = await ev(() => window.__novaCalc.doc.sheet.charts.length);
  assert.equal(n, 2);
});

await check('un gráfico apilado no ofrece tendencias, pero sí barras de error', async () => {
  const enabled = await ev(() => {
    const d = window.__novaCalc.doc;
    const id = d.sheet.charts[0].id;
    d.selectChart(id);
    d.updateChart(id, { stacked: true });
    return true;
  });
  assert.equal(enabled, true);
  await page.waitForTimeout(300);
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await btn('Línea de tendencia').click();
  const item = page.getByRole('menuitem', { name: 'Exponencial' });
  assert.equal(await item.isDisabled(), true);
  await page.keyboard.press('Escape');
  await shot('apilado');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors.filter((e) => !/Keyborg/.test(e)), []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
