// End-to-end checks for WordArt in Nova Calc: insert from the gallery, transform, restyle, format dialog, edit the text, save/reopen as
// .xlsx, remove, and the fallback without system fonts. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-wordart.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const origin = new globalThis.URL(URL).origin;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const results = [];
let step = 0;

const session = async (permission, fn) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  if (permission) await ctx.grantPermissions(['local-fonts'], { origin });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => {
    errors.push(`dialog: ${d.message()}`);
    d.dismiss().catch(() => {});
  });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('.calc-grid__scroller');
  await page.waitForTimeout(400);
  await page.mouse.click(300, 400);
  const shot = async (name) => {
    if (shotsDir) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
    }
  };
  try {
    await fn(page, shot);
    assert.deepEqual(errors, [], 'sin errores de consola');
  } finally {
    await ctx.close();
  }
};
const check = async (name, permission, fn) => {
  try {
    await session(permission, fn);
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ') + ' @ ' + (e.stack.split(String.fromCharCode(10)).find((l) => l.includes('e2e-calc-wordart')) ?? '').trim()]);
  }
};

const shapes = (page) => page.evaluate(() => window.__novaCalc.doc.sheet.shapes.map((s) => ({ ...s })));
const drawn = (page) =>
  page.evaluate(() => {
    const p = document.querySelector('.calc-shape svg.calc-shape__wordart path[d]');
    return p ? (p.getAttribute('d').match(/L/g) ?? []).length : 0;
  });
const insertStyle = async (page, id) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'WordArt', exact: true }).first().click();
  await page.locator(`[data-wordart-style="${id}"]`).click();
  await page.waitForTimeout(700);
};

const pathD = (page) => page.evaluate(() => document.querySelector('.calc-shape svg.calc-shape__wordart path[d]')?.getAttribute('d') ?? '');
const dragHandle = async (page, sel, dx, dy) => {
  const b = await page.locator(sel).first().boundingBox();
  assert.ok(b, 'el asa existe: ' + sel);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  return b;
};
const shapeTab = (page) => page.locator('[role=tab]').filter({ hasText: 'Formato de forma' }).click();

await check('Insertar › WordArt: la galería tiene 22 estilos y se inserta un cuadro dibujado con el motor', true, async (page, shot) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'WordArt', exact: true }).first().click();
  assert.equal(await page.locator('.wa-grid button').count(), 22);
  await shot('galeria');
  await page.locator('[data-wordart-style="gr3"]').click();
  await page.waitForTimeout(700);
  const s = await shapes(page);
  assert.equal(s.length, 1);
  assert.equal(s[0].text, 'Su texto aquí');
  assert.equal(s[0].kind, 'textBox');
  assert.equal(s[0].wordart.fx.fill.type, 'gradient');
  assert.equal(s[0].wordart.warp, null);
  assert.ok((await drawn(page)) > 100, 'contornos de letras dibujados');
  assert.equal(await page.locator('.calc-shape__text').count(), 0, 'el texto normal se oculta');
  await shot('insertado');
});

await check('Transformar: arco, onda y «Sin transformación» cambian el dibujo y el modelo', true, async (page, shot) => {
  await insertStyle(page, 'sh2');
  await shapeTab(page);
  const plain = await drawn(page);
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  assert.equal(await page.locator('[data-warp]').count(), 41);
  await page.locator('[data-warp="textArchUp"]').click();
  await page.waitForTimeout(700);
  assert.equal((await shapes(page))[0].wordart.warp.prst, 'textArchUp');
  const arch = await drawn(page);
  assert.ok(arch > 0 && arch !== plain, 'el dibujo cambió');
  await shot('arco');
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textWave1"]').click();
  await page.waitForTimeout(700);
  assert.equal((await shapes(page))[0].wordart.warp.prst, 'textWave1');
  await shot('onda');
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="none"]').click();
  await page.waitForTimeout(500);
  assert.equal((await shapes(page))[0].wordart.warp, null);
});

await check('Estilos de WordArt (pestaña de forma) cambia el estilo y conserva la transformación', true, async (page) => {
  await insertStyle(page, 'tx1');
  await shapeTab(page);
  const first = (await shapes(page))[0].wordart.fx;
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textInflate"]').click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Estilos de WordArt', exact: true }).first().click();
  await page.locator('[data-wordart-style="gr1"]').click();
  await page.waitForTimeout(600);
  const w = (await shapes(page))[0].wordart;
  assert.equal(w.warp.prst, 'textInflate', 'conserva la transformación');
  assert.notDeepEqual(w.fx, first, 'el estilo cambió');
});

await check('Formato de WordArt…: relleno, contorno, sombra, resplandor, reflejo y transformación', true, async (page, shot) => {
  await insertStyle(page, 'tx1');
  await shapeTab(page);
  await page.getByRole('button', { name: 'Formato de WordArt…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Relleno del texto').selectOption('gradient');
  await dlg.getByLabel('Contorno del texto').check();
  await dlg.getByLabel('Sombra', { exact: true }).check();
  await dlg.getByLabel('Resplandor', { exact: true }).check();
  await dlg.getByLabel('Reflejo', { exact: true }).check();
  await dlg.getByLabel('Transformar', { exact: true }).selectOption('textInflate');
  await shot('dialogo');
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(800);
  const w = (await shapes(page))[0].wordart;
  assert.equal(w.fx.fill.type, 'gradient');
  assert.ok(w.fx.outline && w.fx.shadow && w.fx.glow && w.fx.reflection);
  assert.equal(w.warp.prst, 'textInflate');
  assert.ok(await page.locator('.calc-shape svg.calc-shape__wordart feGaussianBlur').count(), 'sombra y resplandor son filtros');
  await shot('formateado');
});

await check('Editar el texto: textarea con el texto normal y el dibujo se actualiza al confirmar', true, async (page, shot) => {
  await insertStyle(page, 'gr3');
  await shapeTab(page);
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textArchUp"]').click();
  await page.waitForTimeout(600);
  const before = await drawn(page);
  await page.locator('.calc-shape[data-shape-id]').first().dblclick();
  await page.waitForTimeout(300);
  const area = page.locator('.calc-shape__edit');
  assert.equal(await area.count(), 1);
  assert.equal(await page.locator('svg.calc-shape__wordart').count(), 0, 'el dibujo se oculta mientras se edita');
  await shot('editando');
  await area.fill('Hola mundo grande');
  await area.press('Control+Enter');
  await page.waitForTimeout(800);
  assert.equal((await shapes(page))[0].text, 'Hola mundo grande');
  const after = await drawn(page);
  assert.ok(after > 100 && after !== before, 'se vuelve a dibujar con el texto nuevo');
  await shot('actualizado');
});

await check('guardar y volver a leer el .xlsx conserva el estilo y la transformación; Quitar WordArt lo deshace', true, async (page) => {
  await insertStyle(page, 'rf1');
  await shapeTab(page);
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textCircle"]').click();
  await page.waitForTimeout(500);
  const before = (await shapes(page))[0].wordart;
  const rt = await page.evaluate(() => window.__novaCalc.xlsxRoundTrip());
  assert.ok(rt.drawing.includes('<a:prstTxWarp prst="textCircle">'), 'a:prstTxWarp en el dibujo');
  assert.ok(!rt.drawing.includes('w14:'), 'sin extensiones de Word');
  const back = rt.shapes[0].wordart;
  assert.equal(back.warp.prst, 'textCircle');
  assert.equal(back.fx.fill.type, before.fx.fill.type);
  assert.ok(back.fx.reflection, 'el reflejo vuelve');
  await page.getByRole('button', { name: 'Quitar WordArt' }).click();
  await page.waitForTimeout(500);
  assert.equal((await shapes(page))[0].wordart, undefined);
  assert.equal(await page.locator('svg.calc-shape__wordart').count(), 0);
  assert.equal(await page.locator('.calc-shape__text').count(), 1, 'vuelve el texto normal');
  await page.evaluate(() => window.__novaCalc.doc.undo());
  await page.waitForTimeout(500);
  assert.equal((await shapes(page))[0].wordart.warp.prst, 'textCircle', 'deshacer devuelve el WordArt');
});

await check('asas de la transformación: aparecen con la forma elegida, se arrastran y se deshacen', true, async (page, shot) => {
  await insertStyle(page, 'tx1');
  await shapeTab(page);
  assert.equal(await page.locator('[data-warp-handle]').count(), 0, 'sin transformación no hay asas');
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textWave1"]').click();
  await page.waitForTimeout(500);
  assert.ok(await page.locator('[data-warp-handle]').count() >= 1, 'una onda tiene asas');
  const before = await pathD(page);
  const h0 = await dragHandle(page, '[data-warp-handle="0"]', 0, -12);
  const w = (await shapes(page))[0].wordart.warp;
  assert.equal(w.prst, 'textWave1');
  assert.ok(w.adj && Object.keys(w.adj).length, 'el ajuste quedó guardado: ' + JSON.stringify(w));
  const h1 = await page.locator('[data-warp-handle="0"]').first().boundingBox();
  assert.ok(Math.abs(h1.y - (h0.y - 12)) < 4, 'el asa quedó donde se soltó');
  assert.notEqual(await pathD(page), before, 'el dibujo cambió');
  await shot('asa-onda');
  // arco: asa polar
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textArchUp"]').click();
  await page.waitForTimeout(500);
  await dragHandle(page, '[data-warp-handle="0"]', 60, 30);
  assert.ok((await shapes(page))[0].wordart.warp.adj, 'el asa del arco cambió su ángulo');
  await shot('asa-arco');
  await page.evaluate(() => window.__novaCalc.doc.undo());
  await page.waitForTimeout(400);
  assert.equal((await shapes(page))[0].wordart.warp.adj, undefined, 'deshacer devuelve el ajuste');
});

await check('sin permiso de fuentes: el texto se queda normal y visible, y el modelo conserva el WordArt', false, async (page) => {
  await insertStyle(page, 'gr3');
  const s = (await shapes(page))[0];
  assert.ok(s.wordart, 'el modelo conserva el WordArt');
  assert.equal(await page.locator('svg.calc-shape__wordart').count(), 0, 'sin dibujo deformado');
  assert.equal(await page.locator('.calc-shape__text').count(), 1, 'el texto normal sigue visible');
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
