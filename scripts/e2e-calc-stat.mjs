// End-to-end checks for the statistical charts of Nova Calc (waterfall, funnel, histogram, box and whisker). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-stat.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
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
  await page.waitForTimeout(450);
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

await ev(() => {
  const d = window.__novaCalc.doc;
  const id = d.activeSheetId;
  const set = (r, c, t) => d.wb.setInput(id, r, c, t);
  // A: concepto, B: variación (cascada y embudo), D: muestras (histograma y cajas), E: grupo
  const rows = [['Inicio', 120], ['Ventas', 80], ['Devoluciones', -35], ['Costos', -60], ['Otros', 15], ['Final', 120]];
  set(0, 0, 'Concepto');
  set(0, 1, 'Importe');
  rows.forEach(([a, b], i) => {
    set(i + 1, 0, a);
    set(i + 1, 1, String(b));
  });
  set(0, 3, 'Muestra');
  set(0, 4, 'Grupo');
  const sample = [3, 5, 6, 6, 7, 8, 8, 9, 9, 10, 10, 11, 12, 12, 14, 15, 17, 19, 25, 41];
  sample.forEach((v, i) => {
    set(i + 1, 3, String(v));
    set(i + 1, 4, i % 2 === 0 ? 'Norte' : 'Sur');
  });
});

const make = (kind, rect, patch = {}) =>
  ev(
    ([k, r, p]) => {
      const d = window.__novaCalc.doc;
      d.selectRange(r);
      const err = d.insertChart(k);
      if (err) throw new Error(err);
      const c = d.sheet.charts[d.sheet.charts.length - 1];
      d.updateChart(c.id, { ...p });
      return c.id;
    },
    [kind, rect, patch],
  );

await check('cascada con totales', async () => {
  await make('waterfall', { r1: 0, c1: 0, r2: 6, c2: 1 }, { x: 330, y: 20, width: 500, height: 300, waterfall: { totals: [0, 5], connectors: true }, title: 'Puente de caja' });
  await page.waitForTimeout(400);
  const def = await ev(() => window.__novaCalc.doc.sheet.charts[0]);
  assert.equal(def.type, 'waterfall');
  assert.deepEqual(def.waterfall.totals, [0, 5]);
  await shot('cascada');
});

await check('embudo', async () => {
  await ev(() => window.__novaCalc.doc.selectChart(null));
  await make('funnel', { r1: 0, c1: 0, r2: 6, c2: 1 }, { x: 860, y: 20, width: 460, height: 300, title: 'Embudo' });
  assert.equal(await ev(() => window.__novaCalc.doc.sheet.charts[1].type), 'funnel');
  await shot('embudo');
});

await check('histograma con clases automáticas y con ancho fijo', async () => {
  await ev(() => window.__novaCalc.doc.selectChart(null));
  await make('histogram', { r1: 0, c1: 3, r2: 20, c2: 3 }, { x: 330, y: 340, width: 500, height: 300, title: 'Histograma' });
  await shot('histograma-auto');
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.updateChart(d.sheet.charts[2].id, { histogram: { binWidth: 5, overflow: 25 } });
  });
  await shot('histograma-ancho');
  assert.equal(await ev(() => window.__novaCalc.doc.sheet.charts[2].histogram.binWidth), 5);
});

await check('cajas y bigotes por grupo, con media y atípicos', async () => {
  await ev(() => window.__novaCalc.doc.selectChart(null));
  await make('boxwhisker', { r1: 0, c1: 4, r2: 20, c2: 3 }, { x: 860, y: 340, width: 460, height: 300, title: 'Cajas y bigotes' });
  const def = await ev(() => window.__novaCalc.doc.sheet.charts[3]);
  assert.equal(def.type, 'boxwhisker');
  await shot('cajas');
  // agrupadas: categorías = columna Grupo
  await ev(() => {
    const d = window.__novaCalc.doc;
    const c = d.sheet.charts[3];
    d.updateChart(c.id, { series: [{ ...c.series[0], values: 'Hoja1!$D$2:$D$21', categories: 'Hoja1!$E$2:$E$21' }], boxwhisker: { mean: true, outliers: true, inner: true } });
  });
  await shot('cajas-por-grupo');
});

await check('el menú de gráficos ofrece los cuatro tipos', async () => {
  await ev(() => window.__novaCalc.doc.selectChart(window.__novaCalc.doc.sheet.charts[0].id));
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await page.getByRole('button', { name: 'Cambiar tipo de gráfico' }).click();
  for (const n of ['Cascada', 'Embudo', 'Histograma', 'Cajas y bigotes']) assert.equal(await page.getByRole('menuitem', { name: n, exact: true }).count(), 1, n);
  await shot('menu-tipos');
  await page.keyboard.press('Escape');
});

await check('el cuadro Formato del gráfico muestra las opciones del tipo', async () => {
  await ev(() => window.__novaCalc.doc.selectChart(window.__novaCalc.doc.sheet.charts[2].id));
  await page.getByRole('button', { name: 'Formato del gráfico…' }).click();
  await page.getByRole('tab', { name: 'Opciones del tipo' }).click();
  await shot('opciones-histograma');
  assert.equal(await page.getByLabel('Ancho de clase').count(), 1);
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors.filter((e) => !/Keyborg/.test(e)), []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
