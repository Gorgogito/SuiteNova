// End-to-end checks for the linked SmartArt in Nova Writer: insert from the dialog, edit text/layout/colours/size, double click,
// and save/reopen as .docx. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-smartart.mjs [--shots dir]
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

/** El primer SmartArt del documento: su texto, su diseño y su tamaño. */
const art = (page) =>
  page.evaluate(async () => {
    const w = window.__novaWriter;
    let out = null;
    w.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'smartart' && !out) out = { width: n.attrs.width, height: n.attrs.height, wrap: n.attrs.wrap, data: n.attrs.parts.data, layout: n.attrs.parts.layout, drawing: n.attrs.parts.drawing ?? '' };
    });
    if (!out) return null;
    const texts = [...out.data.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    return { width: out.width, height: out.height, wrap: out.wrap, texts, layoutId: /uniqueId="([^"]+)"/.exec(out.layout)?.[1], shapes: (out.drawing.match(/<dsp:sp /g) ?? []).length };
  });
const insertArt = async (page) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'SmartArt…', exact: true }).click();
  await page.getByRole('dialog').waitFor();
};

await check('insertar un SmartArt desde el cuadro: queda vinculado y se ve', async (page, shot) => {
  await insertArt(page);
  await page.getByLabel('Texto del SmartArt').fill('Uno\nDos\nTres');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(500);
  const a = await art(page);
  assert.ok(a, 'hay un SmartArt');
  assert.deepEqual(a.texts, ['Uno', 'Dos', 'Tres']);
  assert.ok(a.shapes >= 3, 'trae su dibujo');
  assert.ok(await page.locator('.ProseMirror .nw-smartart img').isVisible(), 'se dibuja');
  await shot('insertado');
});

await check('editar: texto, diseño y colores desde la pestaña contextual', async (page, shot) => {
  await insertArt(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('[role=tab]').filter({ hasText: 'Diseño de SmartArt' }).click();
  await page.getByRole('button', { name: 'Editar SmartArt…' }).click();
  await page.getByLabel('Texto del SmartArt').fill('A\nB\nC\nD\nE');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(400);
  assert.deepEqual((await art(page)).texts, ['A', 'B', 'C', 'D', 'E']);
  await page.getByRole('button', { name: 'Cambiar diseño' }).click();
  await page.getByRole('menuitem', { name: 'Ciclo básico' }).click();
  await page.waitForTimeout(400);
  assert.equal((await art(page)).layoutId, 'urn:suitenova/layout/cycle');
  await page.getByRole('button', { name: 'Cambiar colores' }).click();
  await page.getByRole('menuitem', { name: 'Énfasis 2' }).click();
  await page.waitForTimeout(300);
  assert.ok((await art(page)).texts.length === 5, 'conserva el texto');
  await shot('ciclo');
});

await check('el cuadro cambia el tamaño y el ajuste; el dibujo se vuelve a distribuir', async (page) => {
  await insertArt(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  const before = await art(page);
  await page.locator('[role=tab]').filter({ hasText: 'Diseño de SmartArt' }).click();
  await page.getByRole('button', { name: 'Editar SmartArt…' }).click();
  await page.getByLabel('Ancho del SmartArt').fill('300');
  await page.getByLabel('Alto del SmartArt').fill('200');
  await page.getByLabel('Ajuste del SmartArt').selectOption('topBottom');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await page.waitForTimeout(400);
  const after = await art(page);
  assert.equal(after.width, 300);
  assert.equal(after.height, 200);
  assert.equal(after.wrap, 'topBottom');
  assert.notEqual(before.width, after.width);
});

await check('doble clic abre el cuadro de edición', async (page) => {
  await insertArt(page);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.ProseMirror .nw-smartart img').dblclick();
  await page.getByRole('dialog').waitFor();
  assert.ok(await page.getByLabel('Texto del SmartArt').isVisible());
});

await check('guardar y volver a leer el .docx conserva el SmartArt con su texto y su diseño', async (page) => {
  await insertArt(page);
  await page.getByLabel('Texto del SmartArt').fill('Uno\nDos\nTres');
  await page.locator('[data-sa-layout="urn:suitenova/layout/venn"]').click();
  await page.getByLabel('Texto del SmartArt').fill('Uno\nDos\nTres');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(400);
  const back = await page.evaluate(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    let a = null;
    d.body.descendants((n) => void (n.type.name === 'smartart' && !a && (a = n.attrs.parts)));
    if (!a) return null;
    return { texts: [...a.data.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]), layoutId: /uniqueId="([^"]+)"/.exec(a.layout)?.[1], drawing: !!a.drawing };
  });
  assert.ok(back, 'vuelve el SmartArt');
  assert.deepEqual(back.texts, ['Uno', 'Dos', 'Tres']);
  assert.equal(back.layoutId, 'urn:suitenova/layout/venn');
  assert.ok(back.drawing);
});

for (const r of results) console.log(r.join('  '));
await browser.close();
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
