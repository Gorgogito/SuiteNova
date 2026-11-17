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
      if (n.type.name === 'chart' && !out) out = { type: n.attrs.chart.type, title: n.attrs.chart.title, grid: n.attrs.grid, wrap: n.attrs.wrap, width: n.attrs.width, height: n.attrs.height, x: n.attrs.x, y: n.attrs.y, spec: n.attrs.chart };
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
  assert.ok(await page.locator('.ProseMirror .nw-chart canvas').first().isVisible(), 'se dibuja');
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

const insertDefault = async (page) => {
  await openDlg(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(500);
};

await check('con el ratón: elegir, cambiar de tamaño con los tiradores y mover cuando flota', async (page, shot) => {
  await insertDefault(page);
  const box = page.locator('.ProseMirror .nw-chart');
  await box.click({ position: { x: 40, y: 40 } });
  await page.waitForTimeout(200);
  assert.ok(await box.locator('[data-handle=se]').isVisible(), 'con el gráfico elegido aparecen los tiradores');
  await shot('elegido');
  const before = await chart(page);
  const h = await box.locator('[data-handle=se]').boundingBox();
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x + 104, h.y + 64, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const grown = await chart(page);
  assert.ok(grown.width >= before.width + 90 && grown.height >= before.height + 50, `crece (${before.width}x${before.height} → ${grown.width}x${grown.height})`);
  const w = await box.locator('[data-handle=w]').boundingBox();
  await page.mouse.move(w.x + 4, w.y + 4);
  await page.mouse.down();
  await page.mouse.move(w.x + 64, w.y + 4, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.ok((await chart(page)).width <= grown.width - 50, 'el tirador de la izquierda lo estrecha');
  // flotante: se mueve arrastrándolo
  await page.evaluate(() => {
    const v = window.__novaWriter.ctl.mainView;
    let pos = -1;
    v.state.doc.descendants((n, p) => { if (n.type.name === 'chart' && pos < 0) pos = p; });
    const n = v.state.doc.nodeAt(pos);
    v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, wrap: 'front', x: 20, y: 20 }));
  });
  await page.waitForTimeout(250);
  await box.click({ position: { x: 60, y: 60 } });
  const p0 = await chart(page);
  const b = await box.boundingBox();
  await page.mouse.move(b.x + 80, b.y + 80);
  await page.mouse.down();
  await page.mouse.move(b.x + 140, b.y + 120, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const p1 = await chart(page);
  assert.ok(p1.x >= p0.x + 50 && p1.y >= p0.y + 30, `se mueve (${p0.x},${p0.y} → ${p1.x},${p1.y})`);
  await shot('movido');
});

await check('el gráfico es vivo: al pasar el ratón sale la información emergente', async (page) => {
  await insertDefault(page);
  const box = page.locator('.ProseMirror .nw-chart');
  const b = await box.boundingBox();
  for (const fx of [0.25, 0.35, 0.45, 0.55, 0.65]) await page.mouse.move(b.x + b.width * fx, b.y + b.height * 0.7, { steps: 3 });
  await page.waitForTimeout(500);
  const tip = await page.locator('.nw-chart__live div').filter({ hasText: /Serie 1|Serie 2/ }).count();
  assert.ok(tip > 0, 'aparece la información emergente');
});

await check('cinta: Agregar elemento, Cambiar colores y Estilos rápidos sobre el gráfico elegido', async (page) => {
  await insertDefault(page);
  await page.locator('.ProseMirror .nw-chart').click({ position: { x: 40, y: 40 } });
  const pick = async (menu, item) => {
    await page.locator('[role=tab]').filter({ hasText: 'Diseño de gráfico' }).click();
    await page.getByRole('button', { name: menu }).first().click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await page.waitForTimeout(300);
  };
  await pick('Agregar elemento de gráfico', 'Leyenda arriba');
  assert.equal((await chart(page)).spec.legendPos, 't');
  await pick('Agregar elemento de gráfico', 'Etiquetas: exterior final');
  assert.equal((await chart(page)).spec.series[0].labels.pos, 'outEnd');
  await pick('Cambiar colores', 'Colorido 2');
  assert.equal((await chart(page)).spec.series[0].color, '#ed7d31');
  await pick('Estilos rápidos', 'Estilo 5');
  assert.equal((await chart(page)).spec.chartArea.fill, '#262626');
});

await check('cuadro: pestañas Elementos, Formato de serie, Áreas y fuentes y Estilos', async (page) => {
  await insertDefault(page);
  await page.locator('.ProseMirror .nw-chart').dblclick();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('tab', { name: 'Elementos' }).click();
  await page.getByLabel('Leyenda a la derecha').check();
  await page.getByLabel('Etiquetas: valor').or(page.getByLabel('Mostrar etiquetas de datos')).first().check();
  await page.getByRole('tab', { name: 'Formato de serie' }).click();
  await page.getByLabel('Color de relleno').fill('#c00000');
  await page.getByRole('tab', { name: 'Áreas y fuentes' }).click();
  await page.getByLabel('Área del gráfico: Color de relleno').fill('#f2f2f2');
  await page.getByRole('tab', { name: 'Estilos y colores' }).click();
  await page.getByRole('button', { name: 'Estilo 4' }).click();
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(400);
  const c = (await chart(page)).spec;
  assert.equal(c.legendPos, 'r');
  assert.ok(c.series.every((x) => x.labels?.value), 'etiquetas con valor');
  assert.equal(c.gapWidth, 50, 'el estilo 4 se aplica al final');
  assert.equal(c.series[0].line.color, '#ffffff');
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
