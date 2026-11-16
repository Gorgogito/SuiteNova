// End-to-end checks for WordArt in Nova Writer: insert from the gallery, transform, edit the text, format dialog, save/reopen as .docx,
// remove, and the fallback without system fonts. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-wordart.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
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
const check = async (name, permission, fn) => {
  try {
    await session(permission, fn);
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ') + ' @ ' + (e.stack.split(String.fromCharCode(10)).find((l) => l.includes('e2e-writer-wordart')) ?? '').trim()]);
  }
};

const wordart = (page) =>
  page.evaluate(() => {
    let out = null;
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'shape' && n.attrs.wordart && !out) out = { wordart: n.attrs.wordart, text: n.textContent, kind: n.attrs.kind };
    });
    return out;
  });
const insertStyle = async (page, id) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'WordArt', exact: true }).first().click();
  await page.locator(`[data-wordart-style="${id}"]`).click();
  await page.waitForTimeout(700);
};
const shapeTab = async (page) => {
  await page.locator('[role=tab]').filter({ hasText: 'Formato de forma' }).click();
};
const drawn = (page) => page.evaluate(() => { const s = document.querySelector('.ProseMirror .nw-shape[data-wordart]'); const p = s?.querySelector('svg.nw-wordart path[d]'); return p ? (p.getAttribute('d').match(/L/g) ?? []).length : 0; });

await check('Insertar › WordArt: la galería tiene 22 estilos y se inserta un cuadro dibujado con el motor', true, async (page, shot) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'WordArt', exact: true }).first().click();
  assert.equal(await page.locator('.wa-grid button').count(), 22);
  await shot('galeria');
  await page.locator('[data-wordart-style="gr3"]').click();
  await page.waitForTimeout(700);
  const w = await wordart(page);
  assert.equal(w.text, 'Su texto aquí');
  assert.equal(w.wordart.fx.fill.type, 'gradient');
  assert.equal(w.wordart.warp, null);
  assert.ok((await drawn(page)) > 100, 'contornos de letras dibujados');
  assert.equal(await page.locator('.ProseMirror .nw-shape[data-wordart]').count(), 1);
  await shot('insertado');
});

await check('Transformar: arco, onda y «Sin transformación» cambian el dibujo y el modelo', true, async (page, shot) => {
  await insertStyle(page, 'sh2');
  await shapeTab(page);
  const plain = await drawn(page);
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  assert.equal(await page.locator('[data-warp]').count(), 41, '40 transformaciones y «Sin transformación»');
  await page.locator('[data-warp="textArchUp"]').click();
  await page.waitForTimeout(700);
  assert.equal((await wordart(page)).wordart.warp.prst, 'textArchUp');
  const arch = await drawn(page);
  assert.ok(arch > 0 && arch !== plain, 'el dibujo cambió');
  await shot('arco');
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textWave1"]').click();
  await page.waitForTimeout(700);
  assert.equal((await wordart(page)).wordart.warp.prst, 'textWave1');
  await shot('onda');
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="none"]').click();
  await page.waitForTimeout(500);
  assert.equal((await wordart(page)).wordart.warp, null);
});

await check('Editar el texto: se ve el texto normal mientras se escribe y el dibujo se actualiza al salir', true, async (page, shot) => {
  await insertStyle(page, 'gr3');
  await shapeTab(page);
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textArchUp"]').click();
  await page.waitForTimeout(600);
  await page.locator('.ProseMirror .nw-shape[data-wordart] .nw-shape-text').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.ProseMirror .nw-shape[data-wordart][data-editing]').count(), 1, 'está en edición');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror svg.nw-wordart')).display), 'none', 'el dibujo se oculta');
  await shot('editando');
  await page.keyboard.press('End');
  await page.keyboard.type(' nuevo');
  await page.locator('.ProseMirror .nw-p').first().click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.ProseMirror .nw-shape[data-wordart][data-editing]').count(), 0, 'sale de la edición');
  assert.match((await wordart(page)).text, /nuevo$/);
  assert.ok((await drawn(page)) > 100, 'se vuelve a dibujar');
  await shot('actualizado');
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
  const w = (await wordart(page)).wordart;
  assert.equal(w.fx.fill.type, 'gradient');
  assert.ok(w.fx.outline && w.fx.shadow && w.fx.glow && w.fx.reflection);
  assert.equal(w.warp.prst, 'textInflate');
  assert.ok(await page.locator('.ProseMirror svg.nw-wordart feGaussianBlur').count(), 'sombra y resplandor son filtros');
  await shot('formateado');
});

await check('guardar y volver a leer el .docx conserva el estilo y la transformación; Quitar WordArt lo deshace', true, async (page) => {
  await insertStyle(page, 'rf1');
  await shapeTab(page);
  await page.getByRole('button', { name: 'Transformar', exact: true }).click();
  await page.locator('[data-warp="textCircle"]').click();
  await page.waitForTimeout(500);
  const before = (await wordart(page)).wordart;
  const back = await page.evaluate(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    let a = null;
    d.body.descendants((n) => void (n.type.name === 'shape' && n.attrs.wordart && !a && (a = n.attrs.wordart)));
    return a;
  });
  assert.equal(back.warp.prst, 'textCircle');
  assert.equal(back.fx.fill.type, before.fx.fill.type);
  assert.ok(back.fx.reflection, 'el reflejo vuelve');
  await page.getByRole('button', { name: 'Quitar WordArt' }).click();
  await page.waitForTimeout(500);
  assert.equal(await wordart(page), null);
  assert.equal(await page.locator('.ProseMirror .nw-shape[data-wordart]').count(), 0);
});

await check('sin permiso de fuentes: el texto se queda normal y visible, y nada se rompe', false, async (page) => {
  await insertStyle(page, 'gr3');
  const w = await wordart(page);
  assert.equal(w.text, 'Su texto aquí', 'el modelo conserva el WordArt');
  assert.equal(await page.locator('.ProseMirror .nw-shape[data-wordart]').count(), 0, 'sin dibujo deformado');
  const color = await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror .nw-shape .nw-shape-text')).color);
  assert.notEqual(color, 'rgba(0, 0, 0, 0)', 'el texto normal sigue visible');
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
