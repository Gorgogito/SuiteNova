// End-to-end checks for copying a chart from one product to another: Calc → Slides → Writer → Calc. One browser, one real clipboard.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-chart-clipboard.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const results = [];
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  page.setDefaultTimeout(10000);
};
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
  }
};
const shot = (page, n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());

const calc = await ctx.newPage();
watch(calc);
await calc.goto(`${BASE}?app=calc`, { waitUntil: 'load' });
await calc.waitForSelector('.calc-grid__scroller');
await calc.waitForTimeout(400);

await check('Calc: se copia el gráfico elegido con su formato (Ctrl+C)', async () => {
  await calc.evaluate(() => {
    const d = window.__novaCalc.doc;
    [['Mes', 'Ventas', 'Gastos'], ['Ene', '12', '8'], ['Feb', '15', '9'], ['Mar', '19', '10']].forEach((r, i) => r.forEach((t, c) => d.wb.setInput(d.activeSheetId, i, c, t)));
    d.selectRange({ r1: 0, c1: 0, r2: 3, c2: 2 });
    const err = d.insertChart('column');
    if (err) throw new Error(err);
    const id = d.sheet.charts.at(-1).id;
    d.updateChart(id, { title: 'Resultados', legend: true, legendPos: 'r', series: d.sheet.charts.at(-1).series.map((s, i) => ({ ...s, ...(i === 0 ? { color: '#c00000' } : {}) })) });
    d.selectChart(id);
  });
  await calc.locator('.calc-grid').focus();
  await calc.keyboard.press('Control+C');
  await calc.waitForTimeout(300);
  const clip = await calc.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const it = items.find((i) => i.types.includes('text/html'));
    return it ? await (await it.getType('text/html')).text() : '';
  });
  assert.ok(clip.includes('data-nova-chart'), 'el portapapeles lleva el gráfico');
  assert.ok(clip.includes('<td>Ene</td>'), 'y una tabla con los datos');
});

const slides = await ctx.newPage();
watch(slides);
await slides.goto(`${BASE}?app=slides`, { waitUntil: 'networkidle' });
await slides.waitForSelector('.sl-surface');
await check('Slides: Ctrl+V pega el gráfico de Calc con su rejilla y su formato', async () => {
  await slides.evaluate(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(1); });
  await slides.locator('.sl-surface').first().click({ position: { x: 20, y: 20 } });
  await slides.keyboard.press('Control+V');
  await slides.waitForTimeout(600);
  const el = await slides.evaluate(() => { const e = window.__novaSlides.ctl.slide.shapes.find((x) => x.kind === 'chart'); return e && { type: e.chart.type, title: e.chart.title, legendPos: e.chart.legendPos, color: e.chart.series[0].color, grid: e.grid, n: e.chart.series.length }; });
  assert.ok(el, 'hay un gráfico en la diapositiva');
  assert.equal(el.type, 'column');
  assert.equal(el.title, 'Resultados');
  assert.equal(el.legendPos, 'r');
  assert.equal(el.color, '#c00000');
  assert.equal(el.n, 2);
  assert.deepEqual(el.grid[1], ['Ene', 12, 8]);
  await shot(slides, 'slides-pegado');
});

await check('Slides: copiar y pegar dentro de Slides sigue haciendo una copia exacta', async () => {
  await slides.evaluate(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((x) => x.kind === 'chart').id]); });
  await slides.locator('.sl-surface').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await slides.evaluate(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((x) => x.kind === 'chart').id]); c.copy(); });
  await slides.waitForTimeout(300);
  await slides.keyboard.press('Control+V');
  await slides.waitForTimeout(500);
  const n = await slides.evaluate(() => window.__novaSlides.ctl.slide.shapes.filter((x) => x.kind === 'chart').length);
  assert.equal(n, 2, 'dos gráficos');
});

const writer = await ctx.newPage();
watch(writer);
await writer.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
await writer.waitForSelector('.ProseMirror');
await check('Writer: Ctrl+V pega el gráfico que copió Slides', async () => {
  await slides.evaluate(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((x) => x.kind === 'chart').id]); c.copy(); });
  await slides.waitForTimeout(400);
  await writer.bringToFront();
  await writer.locator('.ProseMirror').first().click();
  await writer.keyboard.type('Texto: ');
  await writer.keyboard.press('Control+V');
  await writer.waitForTimeout(600);
  const n = await writer.evaluate(() => {
    let out = null;
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => { if (n.type.name === 'chart' && !out) out = { type: n.attrs.chart.type, title: n.attrs.chart.title, cell: n.attrs.grid[1][1], series: n.attrs.chart.series.length }; });
    return out;
  });
  assert.ok(n, 'hay un gráfico en el documento');
  assert.equal(n.type, 'column');
  assert.equal(n.title, 'Resultados');
  assert.equal(n.cell, 12);
  assert.equal(n.series, 2);
  await shot(writer, 'writer-pegado');
});

await check('Writer: copiar el gráfico del documento y pegarlo en Calc (datos en las celdas y gráfico nuevo)', async () => {
  await writer.evaluate(() => {
    const v = window.__novaWriter.ctl.mainView;
    let pos = -1;
    v.state.doc.descendants((n, p) => { if (n.type.name === 'chart' && pos < 0) pos = p; });
    const sel = v.state.selection.constructor.create(v.state.doc, pos);
    v.dispatch(v.state.tr.setSelection(sel));
    v.focus();
  });
  await writer.keyboard.press('Control+C');
  await writer.waitForTimeout(400);
  await calc.bringToFront();
  const before = await calc.evaluate(() => window.__novaCalc.doc.sheet.charts.length);
  await calc.evaluate(() => { const d = window.__novaCalc.doc; d.selectChart(null); d.selectRange({ r1: 10, c1: 0, r2: 10, c2: 0 }); });
  await calc.locator('.calc-grid').focus();
  await calc.keyboard.press('Control+V');
  await calc.waitForTimeout(600);
  const res = await calc.evaluate(() => {
    const d = window.__novaCalc.doc;
    const c = d.sheet.charts.at(-1);
    return { n: d.sheet.charts.length, a11: window.__novaCalc.text('A12'), b12: window.__novaCalc.text('B12'), title: c.title, values: c.series[0].values };
  });
  assert.equal(res.n, before + 1, 'un gráfico más');
  assert.equal(res.a11, 'Ene');
  assert.equal(res.b12, '12', 'valor pegado');
  assert.equal(res.title, 'Resultados');
  assert.match(res.values, /\$B\$1[12]:\$B\$1[45]/, 'apunta a las celdas pegadas');
  await shot(calc, 'calc-pegado');
});

assert.deepEqual(errors, [], 'sin errores de consola');
results.push(['ok', 'sin errores de consola']);
for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
