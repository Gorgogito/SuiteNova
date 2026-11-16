// End-to-end checks for series and point formatting (fill, border, line, markers, gap width, point colours, pie options) in Nova Calc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-chartformat.mjs [--shots dir]
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

const chartN = () => ev(() => window.__novaCalc.doc.sheet.charts.at(-1));
const openFormat = async () => {
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await btn('Formato del gráfico…').click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('tab', { name: 'Formato de serie' }).click();
};
const accept = async () => {
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(350);
};

await check('columnas: relleno, transparencia, borde, hueco, superposición y color de un punto', async () => {
  await makeChart('column', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await page.waitForTimeout(300);
  await openFormat();
  await page.getByLabel('Color de relleno').fill('#c00000');
  await page.getByLabel('Transparencia del relleno').fill('30');
  await page.getByLabel('Borde: Color').fill('#002060');
  await page.getByLabel('Borde: Ancho (pt)').fill('2');
  await page.getByLabel('Borde: Tipo de guion').selectOption('dash');
  await page.getByLabel('Ancho del intervalo').fill('60');
  await page.getByLabel('Superposición de series').fill('-10');
  await page.getByLabel('Color del punto 3').fill('#00b050');
  await shot('formato-columnas');
  await accept();
  const c = await chartN();
  assert.equal(c.series[0].color, '#c00000');
  assert.equal(c.series[0].transparency, 30);
  assert.deepEqual(c.series[0].line, { color: '#002060', width: 2, dash: 'dash' });
  assert.equal(c.gapWidth, 60);
  assert.equal(c.overlap, -10);
  assert.deepEqual(c.series[0].points, [{ idx: 2, color: '#00b050' }]);
  await shot('columnas');
});

await check('líneas: grosor, guiones y marcador; sin línea en otra serie', async () => {
  await makeChart('line', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await page.waitForTimeout(300);
  await openFormat();
  await page.getByLabel('Línea: Ancho (pt)').fill('4.5');
  await page.getByLabel('Línea: Tipo de guion').selectOption('dot');
  await page.getByLabel('Tipo de marcador').selectOption('diamond');
  await page.getByLabel('Tamaño del marcador').fill('11');
  await page.getByLabel('Serie que se formatea').selectOption('1');
  await page.getByText('Sin línea').first().click();
  await accept();
  const c = await chartN();
  assert.equal(c.series[0].line.width, 4.5);
  assert.equal(c.series[0].line.dash, 'dot');
  assert.equal(c.series[0].marker.symbol, 'diamond');
  assert.equal(c.series[0].marker.size, 11);
  assert.equal(c.series[1].line.none, true);
  await shot('lineas');
});

await check('circular y anillo: ángulo, explosión, color de un sector y agujero; se guarda en .xlsx', async () => {
  await makeChart('pie', { r1: 0, c1: 0, r2: 4, c2: 1 });
  await page.waitForTimeout(300);
  await openFormat();
  await page.getByLabel('Ángulo del primer sector').fill('45');
  await page.getByLabel('Explosión de la serie').fill('8');
  await page.getByLabel('Color del punto 2').fill('#ffc000');
  await page.getByLabel('Explosión del punto 2').fill('25');
  await accept();
  let c = await chartN();
  assert.equal(c.firstSliceAng, 45);
  assert.equal(c.series[0].explosion, 8);
  assert.deepEqual(c.series[0].points, [{ idx: 1, color: '#ffc000', explosion: 25 }]);
  const back = await ev(async () => (await window.__novaCalc.xlsxRoundTrip()).charts.at(-1));
  assert.equal(back.firstSliceAng, 45);
  assert.deepEqual(back.series[0].points, [{ idx: 1, color: '#ffc000', explosion: 25 }]);
  await shot('circular');
  await makeChart('doughnut', { r1: 0, c1: 0, r2: 4, c2: 1 });
  await page.waitForTimeout(300);
  await openFormat();
  await page.getByLabel('Tamaño del agujero').fill('70');
  await accept();
  c = await chartN();
  assert.equal(c.holeSize, 70);
});

assert.deepEqual(errors, [], 'sin errores de consola');
results.push(['ok', 'sin errores de consola']);
for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
