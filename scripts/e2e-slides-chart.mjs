// End-to-end checks for the charts in Nova Slides: live drawing with tooltips, ribbon menus (elements, colours, quick styles) and the dialog tabs. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-chart.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const results = [];
const check = async (name, fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.sl-surface');
    await fn(page);
    assert.deepEqual(errors, [], 'sin errores de consola');
    results.push(['ok', name]);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png` }).catch(() => {});
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
  } finally {
    await ctx.close();
  }
};
const shot = (page, n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const chartEl = (page) => page.evaluate(() => { const e = window.__novaSlides.ctl.slide.shapes.find((x) => x.kind === 'chart'); return e && { spec: e.chart, grid: e.grid }; });
const insert = async (page) => {
  await page.evaluate(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.newSlide(); c.goTo(1); });
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Gráfico…', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(500);
};

await check('el gráfico del escenario es vivo: la información emergente sale al pasar el ratón', async (page) => {
  await insert(page);
  const box = page.locator('.sl-surface canvas').first();
  await box.waitFor();
  const b = await box.boundingBox();
  for (const fx of [0.25, 0.35, 0.45, 0.55, 0.65, 0.75]) await page.mouse.move(b.x + b.width * fx, b.y + b.height * 0.75, { steps: 3 });
  await page.waitForTimeout(500);
  const tip = await page.locator('.sl-surface div').filter({ hasText: /Serie 1|Serie 2/ }).count();
  assert.ok(tip > 0, 'aparece la información emergente');
  await shot(page, 'tooltip');
});

await check('cinta: Agregar elemento, Cambiar colores y Estilos rápidos sobre el gráfico elegido', async (page) => {
  await insert(page);
  await page.evaluate(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((x) => x.kind === 'chart').id]); });
  const pick = async (menu, item) => {
    await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
    await page.getByRole('button', { name: menu }).first().click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await page.waitForTimeout(300);
  };
  await pick('Agregar elemento de gráfico', 'Leyenda a la derecha');
  assert.equal((await chartEl(page)).spec.legendPos, 'r');
  await pick('Agregar elemento de gráfico', 'Tabla de datos con claves de leyenda');
  assert.deepEqual((await chartEl(page)).spec.dataTable, { keys: true });
  await pick('Cambiar colores', 'Colorido 3');
  assert.equal((await chartEl(page)).spec.series[0].color, '#a5a5a5');
  await pick('Estilos rápidos', 'Estilo 3');
  assert.equal((await chartEl(page)).spec.chartArea.fill, '#f2f2f2');
  await shot(page, 'cinta');
});

await check('cuadro: Elementos, Formato de serie, Áreas y fuentes y Estilos; se guarda en el .pptx', async (page) => {
  await insert(page);
  await page.evaluate(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((x) => x.kind === 'chart').id]); });
  await page.getByRole('tab', { name: /Diseño de gráfico/ }).click();
  await page.getByRole('button', { name: 'Editar datos y tipo del gráfico…' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('tab', { name: 'Elementos' }).click();
  await page.getByLabel('Mostrar etiquetas de datos').check();
  await page.getByLabel('Título del eje vertical').check();
  await page.getByRole('tab', { name: 'Formato de serie' }).click();
  await page.getByLabel('Color de relleno').fill('#c00000');
  await page.getByLabel('Ancho del intervalo').fill('40');
  await page.getByRole('tab', { name: 'Áreas y fuentes' }).click();
  await page.getByLabel('Área del gráfico: Color de relleno').fill('#262626');
  await shot(page, 'cuadro');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(400);
  const c = (await chartEl(page)).spec;
  assert.ok(c.series.every((x) => x.labels?.value));
  assert.equal(c.axisY.title, 'Título del eje');
  assert.equal(c.series[0].color, '#c00000');
  assert.equal(c.gapWidth, 40);
  assert.equal(c.chartArea.fill, '#262626');
  const zip = await JSZip.loadAsync(Buffer.from(await page.evaluate(() => window.__novaSlides.write())));
  const name = Object.keys(zip.files).find((f) => /ppt\/charts\/chart\d*\.xml$/.test(f));
  const back = name ? await zip.file(name).async('string') : '';
  assert.ok(back.includes('<c:dLbls>'), 'etiquetas en el archivo');
  assert.ok(back.includes('<c:gapWidth val="40"/>'), 'intervalo en el archivo');
  assert.ok(back.includes('262626'), 'fondo en el archivo');
});

for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
