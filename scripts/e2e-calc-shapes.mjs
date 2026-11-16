// End-to-end checks for shapes and text boxes in Nova Calc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-shapes.mjs [--shots dir]
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
const shapes = () => ev(() => window.__novaCalc.doc.sheet.shapes.map((s) => ({ ...s })));

await check('Insertar > Formas > Rectángulo y Elipse desde la cinta', async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await ev(() => window.__novaCalc.doc.selectCell(2, 1));
  for (const name of ['Rectángulo', 'Elipse']) {
    await page.getByRole('button', { name: 'Formas' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await page.waitForTimeout(250);
    // mueve la selección para que la siguiente forma no caiga encima
    await ev(() => window.__novaCalc.doc.selectCell(8, 1));
  }
  const s = await shapes();
  assert.deepEqual(s.map((x) => x.kind), ['rect', 'ellipse']);
  await shot('formas-insertadas');
});

await check('Cuadro de texto: doble clic, escribir y confirmar con Ctrl+Intro', async () => {
  await ev(() => window.__novaCalc.doc.selectCell(2, 6));
  await page.getByRole('button', { name: 'Cuadro de texto' }).click();
  await page.waitForTimeout(300);
  const box = page.locator('.calc-shape[data-shape-id]').nth(2);
  await box.dblclick();
  await page.waitForTimeout(250);
  const area = page.locator('.calc-shape__edit');
  assert.equal(await area.count(), 1);
  await area.fill('Resumen\nde ventas');
  await shot('editando-texto');
  await area.press('Control+Enter');
  await page.waitForTimeout(250);
  const s = await shapes();
  assert.equal(s[2].text, 'Resumen\nde ventas');
  assert.equal(s[2].kind, 'textBox');
});

await check('arrastrar y redimensionar con el ratón, y deshacer', async () => {
  const before = (await shapes())[0];
  const el = page.locator('.calc-shape[data-shape-id]').first();
  const b = await el.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const moved = (await shapes())[0];
  assert.ok(moved.x > before.x + 40 && moved.y > before.y + 25, `movió de ${before.x},${before.y} a ${moved.x},${moved.y}`);
  // asa inferior derecha
  const b2 = await page.locator('.calc-shape[data-shape-id]').first().boundingBox();
  await page.locator('.calc-shape[data-shape-id]').first().locator('.calc-chart__handle--se').hover();
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width + 40, b2.y + b2.height + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const grown = (await shapes())[0];
  assert.ok(grown.width > moved.width + 25, `ancho ${moved.width} → ${grown.width}`);
  await ev(() => window.__novaCalc.doc.undo());
  assert.equal((await shapes())[0].width, moved.width);
  await shot('movida-y-redimensionada');
});

await check('Formato de forma: relleno, contorno y texto; Supr elimina', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.x.selectObject('shape', d.sheet.shapes[0].id);
  });
  await page.getByRole('tab', { name: /Formato de forma/ }).click();
  await page.getByRole('button', { name: 'Formato de forma…' }).click();
  await page.locator('#sh-text').fill('Meta');
  await page.locator('input[type=color][aria-label="Color de relleno"]').fill('#ff9900');
  await page.getByLabel('Negrita').check();
  await shot('dialogo-formato');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(300);
  const s = (await shapes())[0];
  assert.equal(s.text, 'Meta');
  assert.equal(s.fill, '#ff9900');
  assert.equal(s.bold, true);
  await shot('formato-aplicado');
  await page.locator('.calc-shape[data-shape-id]').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  assert.equal((await shapes()).length, 2);
});

await check('puntos de ajuste: el tirador amarillo cambia la esquina, se deshace y no aparece en las líneas', async () => {
  const id = await ev(() => {
    const d = window.__novaCalc.doc;
    const i = d.x.insertShape('roundRect');
    d.x.selectObject('shape', i);
    return i;
  });
  await page.waitForTimeout(300);
  const h = page.locator(`[data-shape-id="${id}"] .calc-shape__adj`);
  assert.equal(await h.count(), 1);
  const b = await h.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 25, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const adj = (await shapes()).find((x) => x.id === id).adj;
  assert.ok(adj && adj.adj > 16667, 'adj ' + JSON.stringify(adj));
  await shot('ajuste');
  await ev(() => window.__novaCalc.doc.undo());
  assert.equal((await shapes()).find((x) => x.id === id).adj, undefined);
  const line = await ev(() => {
    const d = window.__novaCalc.doc;
    const i = d.x.insertShape('line');
    d.x.selectObject('shape', i);
    return i;
  });
  await page.waitForTimeout(300);
  assert.equal(await page.locator(`[data-shape-id="${line}"] .calc-shape__adj`).count(), 0);
});

await check('rotación: asa, comandos Girar, cuadro de formato, redimensionar girada y deshacer', async () => {
  const id = await ev(() => {
    const d = window.__novaCalc.doc;
    const i = d.x.insertShape('rect');
    d.x.selectObject('shape', i);
    return i;
  });
  await page.waitForTimeout(300);
  const rotOf = async () => (await shapes()).find((x) => x.id === id).rotation;
  // asa de giro: arrastrar a la derecha del centro = 90°
  const box = await page.locator(`[data-shape-id="${id}"]`).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const h = await page.locator(`[data-shape-id="${id}"] .calc-shape__rot`).boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(cx + 120, cy + 3, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  assert.equal(await rotOf(), 90);
  assert.ok((await page.locator(`[data-shape-id="${id}"]`).getAttribute('style')).includes('rotate(90deg)'));
  await shot('girada');
  // comandos de la cinta (la pestaña contextual de la forma ya está activa)
  await page.locator('[data-nv-item="calc.shape.rotateRight"]').click();
  await page.waitForTimeout(250);
  assert.equal(await rotOf(), 180);
  await page.locator('[data-nv-item="calc.shape.rotateLeft"]').click();
  await page.waitForTimeout(250);
  assert.equal(await rotOf(), 90);
  // deshacer devuelve al paso anterior
  await ev(() => window.__novaCalc.doc.undo());
  assert.equal(await rotOf(), 180);
  // redimensionar girada: el ancho sigue los ejes de la forma
  await ev(() => window.__novaCalc.doc.x.updateShape(window.__novaCalc.doc.sheet.shapes.find((x) => x.rotation === 180).id, { rotation: 90 }));
  await page.waitForTimeout(250);
  const before = (await shapes()).find((x) => x.id === id);
  const se = await page.locator(`[data-shape-id="${id}"] .calc-chart__handle--e`).boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  // girada 90°, el lado «este» de la forma está abajo en pantalla: arrastrar hacia abajo la ensancha
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = (await shapes()).find((x) => x.id === id);
  assert.ok(after.width > before.width + 30, `ancho ${before.width} -> ${after.width}`);
  assert.equal(after.height, before.height);
  // cuadro de formato: campo Rotación
  await page.locator('[data-nv-item="calc.shape.format"]').click();
  await page.getByLabel('Rotación (grados)').fill('45');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(400);
  assert.equal(await rotOf(), 45);
});

await check('grupos: Ctrl+clic, agrupar, mover/redimensionar/girar como bloque, deshacer, desagrupar y borrar', async () => {
  // dos formas limpias en una zona libre de la hoja
  const [a, b] = await ev(() => {
    const d = window.__novaCalc.doc;
    const ids = [d.x.insertShape('rect'), d.x.insertShape('ellipse')];
    d.x.updateShape(ids[0], { x: 600, y: 300, width: 100, height: 60 });
    d.x.updateShape(ids[1], { x: 760, y: 380, width: 80, height: 80 });
    d.x.selectObject(null, null);
    return ids;
  });
  await page.waitForTimeout(300);
  const get = async () => {
    const all = await shapes();
    return [all.find((x) => x.id === a), all.find((x) => x.id === b)];
  };
  const sel = () => ev(() => window.__novaCalc.doc.x.selectedShapes.length);
  const cmd = async (name) => {
    if ((await page.locator(`[data-nv-item="${name}"]`).count()) === 0) await page.locator('[role=tab]').filter({ hasText: 'Formato de forma' }).click();
    await page.locator(`[data-nv-item="${name}"]`).click();
    await page.waitForTimeout(300);
  };
  // selección múltiple con Ctrl+clic
  await page.locator(`[data-shape-id="${a}"]`).click({ position: { x: 20, y: 20 } });
  assert.equal(await sel(), 1);
  await page.locator(`[data-shape-id="${b}"]`).click({ position: { x: 40, y: 40 }, modifiers: ['Control'] });
  assert.equal(await sel(), 2);
  assert.equal(await page.locator('[data-group-frame]').count(), 1);
  await cmd('calc.shape.group');
  let [A, B] = await get();
  assert.ok(A.group && A.group === B.group, 'mismo grupo');
  // un clic en una sola forma selecciona el grupo entero
  await page.locator('.calc-charts').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
  await ev(() => window.__novaCalc.doc.x.selectObject(null, null));
  await page.locator(`[data-shape-id="${a}"]`).click({ position: { x: 20, y: 20 } });
  assert.equal(await sel(), 2);
  await shot('grupo');
  // arrastrar un miembro mueve todo el bloque
  const bb = await page.locator(`[data-shape-id="${a}"]`).boundingBox();
  await page.mouse.move(bb.x + 20, bb.y + 20);
  await page.mouse.down();
  await page.mouse.move(bb.x + 20 + 50, bb.y + 20 + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  let [A2, B2] = await get();
  assert.deepEqual([A2.x - A.x, A2.y - A.y, B2.x - B.x, B2.y - B.y], [50, 30, 50, 30]);
  await ev(() => window.__novaCalc.doc.undo());
  [A2, B2] = await get();
  assert.deepEqual([A2.x, A2.y, B2.x, B2.y], [A.x, A.y, B.x, B.y], 'un solo deshacer devuelve el bloque');
  // redimensionar con el asa sureste del marco: el bloque (240 x 160) pasa a 2x en ancho
  const se = await page.locator('[data-group-frame] .calc-chart__handle--se').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + se.width / 2 + 240, se.y + se.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  [A2, B2] = await get();
  assert.equal(A2.width, 200, 'el ancho de la primera se duplica');
  assert.equal(B2.width, 160);
  assert.equal(A2.height, 60, 'el alto no cambia');
  assert.equal(B2.x - A2.x, 2 * (B.x - A.x), 'la separación también se duplica');
  await ev(() => window.__novaCalc.doc.undo());
  // girar el grupo 90° con el comando: cada forma gira y sus centros dan el mismo giro
  await cmd('calc.shape.rotateRight');
  [A2, B2] = await get();
  assert.equal(A2.rotation, 90);
  assert.equal(B2.rotation, 90);
  const cAB = (p, q) => [q.x + q.width / 2 - (p.x + p.width / 2), q.y + q.height / 2 - (p.y + p.height / 2)];
  const [dx0, dy0] = cAB(A, B);
  const [dx1, dy1] = cAB(A2, B2);
  assert.ok(Math.abs(dx1 + dy0) <= 1 && Math.abs(dy1 - dx0) <= 1, `giro de los centros (${dx0},${dy0}) -> (${dx1},${dy1})`);
  await ev(() => window.__novaCalc.doc.undo());
  // desagrupar: las formas quedan sueltas y un clic selecciona una sola
  await cmd('calc.shape.ungroup');
  [A2, B2] = await get();
  assert.ok(!A2.group && !B2.group);
  await ev(() => window.__novaCalc.doc.x.selectObject(null, null));
  await page.locator(`[data-shape-id="${a}"]`).click({ position: { x: 20, y: 20 } });
  assert.equal(await sel(), 1);
  // volver a agrupar y borrar con Supr elimina las dos
  await page.locator(`[data-shape-id="${b}"]`).click({ position: { x: 40, y: 40 }, modifiers: ['Control'] });
  await cmd('calc.shape.group');
  const n0 = (await shapes()).length;
  await page.locator(`[data-shape-id="${a}"]`).click({ position: { x: 20, y: 20 } });
  assert.equal(await sel(), 2, 'el grupo se selecciona entero');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  assert.equal((await shapes()).length, n0 - 2);
});

await check('Seleccionar objetos: recuadro elige las formas que quedan dentro, Ctrl suma, un clic vacío deselecciona, Esc sale', async () => {
  const [a, b, c] = await ev(() => {
    const d = window.__novaCalc.doc;
    d.wb.editObjects(d.activeSheetId, (sh) => void (sh.shapes = []));
    const ids = [d.x.insertShape('rect'), d.x.insertShape('ellipse'), d.x.insertShape('rect')];
    d.x.updateShape(ids[0], { x: 600, y: 300, width: 100, height: 60 });
    d.x.updateShape(ids[1], { x: 760, y: 380, width: 80, height: 80 });
    d.x.updateShape(ids[2], { x: 1000, y: 300, width: 100, height: 60 });
    d.x.selectObject(null, null);
    return ids;
  });
  await page.waitForTimeout(300);
  const selected = () => ev(() => [...window.__novaCalc.doc.x.selectedShapes].sort());
  const layer = await page.locator('.calc-charts').boundingBox();
  const drag = async (x1, y1, x2, y2, mod) => {
    if (mod) await page.keyboard.down(mod);
    await page.mouse.move(layer.x + x1, layer.y + y1);
    await page.mouse.down();
    await page.mouse.move(layer.x + (x1 + x2) / 2, layer.y + (y1 + y2) / 2, { steps: 4 });
    await page.mouse.move(layer.x + x2, layer.y + y2, { steps: 4 });
    await page.mouse.up();
    if (mod) await page.keyboard.up(mod);
    await page.waitForTimeout(250);
  };
  // el modo se activa desde la cinta: Inicio › Buscar › Seleccionar objetos
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  // a 1400 px el grupo «Edición» está colapsado: se abre primero
  if (!(await page.getByRole('button', { name: 'Buscar', exact: true }).count())) await page.getByRole('button', { name: 'Edición', exact: true }).click();
  await page.getByRole('button', { name: 'Buscar', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Seleccionar objetos' }).click();
  await page.waitForTimeout(250);
  assert.equal(await ev(() => window.__novaCalc.doc.x.selectMode), true);
  // un recuadro que contiene A y B pero no C
  await drag(560, 260, 900, 500);
  assert.deepEqual(await selected(), [a, b].sort());
  assert.equal(await page.locator('[data-group-frame]').count(), 1, 'se ve el marco de la selección múltiple');
  await shot('recuadro');
  // un recuadro que solo corta a C (no lo encierra) no selecciona nada
  await drag(950, 280, 1050, 330);
  assert.deepEqual(await selected(), []);
  // Ctrl suma a lo elegido
  await drag(560, 260, 720, 380);
  assert.deepEqual(await selected(), [a]);
  await drag(960, 260, 1150, 400, 'Control');
  assert.deepEqual(await selected(), [a, c].sort());
  // un clic en vacío deselecciona
  await page.mouse.click(layer.x + 300, layer.y + 150);
  await page.waitForTimeout(200);
  assert.deepEqual(await selected(), []);
  // Esc vuelve al modo normal y se pueden elegir celdas otra vez
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert.equal(await ev(() => window.__novaCalc.doc.x.selectMode), false);
  assert.equal(await page.locator('[data-select-objects]').count(), 0);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors.filter((e) => !/Keyborg/.test(e)), []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
