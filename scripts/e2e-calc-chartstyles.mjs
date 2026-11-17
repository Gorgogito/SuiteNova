// End-to-end checks for styles and colours (palettes, quick styles, chart and plot area, fonts) in Nova Calc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-chartstyles.mjs [--shots dir]
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
const tab = () => page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
const pick = async (menu, item) => {
  await tab();
  await btn(menu).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  await page.waitForTimeout(350);
};

await check('Cambiar colores: un juego colorido y uno monocromático; queda marcado', async () => {
  await makeChart('column', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await page.waitForTimeout(300);
  await pick('Cambiar colores', 'Colorido 2');
  let c = await chartN();
  assert.deepEqual(c.series.map((s) => s.color), ['#ed7d31', '#ffc000']);
  await tab();
  await btn('Cambiar colores').click();
  const mark = (name) => page.getByRole('menuitem', { name, exact: true }).locator('svg.lucide-check').count();
  assert.equal(await mark('Colorido 2'), 1, 'el juego aplicado aparece marcado');
  assert.equal(await mark('Colorido 1'), 0, 'los demás no');
  await shot('colores');
  await page.keyboard.press('Escape');
  await pick('Cambiar colores', 'Monocromático azul');
  c = await chartN();
  assert.equal(new Set(c.series.map((s) => s.color)).size, 2);
});

await check('Estilos rápidos: fondo oscuro y vuelta al estilo 1', async () => {
  await makeChart('line', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await page.waitForTimeout(300);
  await pick('Estilos rápidos', 'Estilo 5');
  let c = await chartN();
  assert.equal(c.chartArea.fill, '#262626');
  assert.equal(c.fonts.chart.color, '#f2f2f2');
  await shot('estilo-oscuro');
  await pick('Estilos rápidos', 'Estilo 1');
  c = await chartN();
  assert.equal(c.chartArea, undefined);
  assert.equal(c.fonts, undefined);
});

await check('Formato del gráfico > Áreas y fuentes: relleno, borde y fuente del título; se guarda en .xlsx', async () => {
  await makeChart('column', { r1: 0, c1: 0, r2: 7, c2: 2 });
  await page.waitForTimeout(300);
  await ev(() => { const d = window.__novaCalc.doc; d.updateChart(d.sheet.charts.at(-1).id, { title: 'Ventas' }); });
  await tab();
  await btn('Formato del gráfico…').click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('tab', { name: 'Áreas y fuentes' }).click();
  await page.getByLabel('Área del gráfico: Color de relleno').fill('#f2f2f2');
  await page.getByLabel('Área del gráfico: Borde: Color').fill('#123456');
  await page.getByLabel('Área del gráfico: Borde: Ancho (pt)').fill('2');
  await page.getByLabel('Área de trazado: Color de relleno').fill('#ffffcc');
  await page.getByLabel('Elemento de texto').selectOption('title');
  await page.getByLabel('Tipo de letra').selectOption('Georgia');
  await page.getByLabel('Tamaño de letra').fill('20');
  await page.getByLabel('Color del texto').fill('#c00000');
  await shot('areas-y-fuentes');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(400);
  const c = await chartN();
  assert.equal(c.chartArea.fill, '#f2f2f2');
  assert.deepEqual(c.chartArea.line, { color: '#123456', width: 2 });
  assert.equal(c.plotArea.fill, '#ffffcc');
  assert.deepEqual(c.fonts.title, { family: 'Georgia', size: 20, color: '#c00000' });
  const back = await ev(async () => (await window.__novaCalc.xlsxRoundTrip()).charts.at(-1));
  assert.equal(back.chartArea.fill, '#f2f2f2');
  assert.equal(back.fonts.title.family, 'Georgia');
  assert.equal(back.fonts.title.size, 20);
  await shot('grafico-formateado');
});

assert.deepEqual(errors, [], 'sin errores de consola');
results.push(['ok', 'sin errores de consola']);
for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
