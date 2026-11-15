// End-to-end checks for the common shape gallery in Nova Writer: insert shapes of several categories from the ribbon,
// draw them from the catalog, and keep them through .docx save and reopen. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-shapes.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss().catch(() => {});
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 12).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const editor = page.locator('.ProseMirror').first();
const shapes = () =>
  page.evaluate(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'shape') out.push({ kind: n.attrs.kind, width: n.attrs.width, height: n.attrs.height });
    });
    return out;
  });
const pick = async (kind) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Formas', exact: true }).click();
  await page.locator(`[data-shape="${kind}"]`).click();
  await page.waitForTimeout(300);
};

await editor.click();
await page.keyboard.type('Texto con formas.');

await check('la galería ofrece las 9 categorías del catálogo común', async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Formas', exact: true }).click();
  const titles = await page.locator('.ss-title').allInnerTexts();
  assert.deepEqual(titles, ['Líneas', 'Rectángulos', 'Formas básicas', 'Flechas de bloque', 'Formas de ecuación', 'Diagrama de flujo', 'Estrellas y cintas', 'Llamadas', 'Botones de acción']);
  await shot('galeria');
  await page.keyboard.press('Escape');
});

await check('insertar una elipse, una estrella, una flecha y una línea', async () => {
  for (const k of ['ellipse', 'star5', 'rightArrow', 'line']) await pick(k);
  const s = await shapes();
  assert.deepEqual(s.map((x) => x.kind), ['ellipse', 'star5', 'rightArrow', 'line']);
  assert.ok(s[3].height < s[0].height, 'la línea es más baja que una figura cerrada');
  await shot('insertadas');
});

await check('cada forma se dibuja con trazados del catálogo (sin caer en un rectángulo)', async () => {
  const d = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror [data-kind]')].map((el) => ({ kind: el.dataset.kind, d: [...el.querySelectorAll('svg path')].map((p) => p.getAttribute('d')).join('|') })));
  assert.equal(d.length, 4);
  for (const x of d) assert.ok(x.d.length > 10, `${x.kind} sin dibujo`);
  assert.equal(new Set(d.map((x) => x.d)).size, 4, 'las cuatro formas se dibujan distinto');
});

await check('forma de una categoría rara (botón de acción) se inserta y se dibuja', async () => {
  await pick('actionButtonHome');
  const s = await shapes();
  assert.equal(s.at(-1).kind, 'actionButtonHome');
  const n = await page.locator('.ProseMirror [data-kind="actionButtonHome"] svg path').count();
  assert.ok(n >= 2, 'el botón de acción tiene varios trazados');
});

await check('el cuadro de texto sigue disponible y es editable', async () => {
  await page.getByRole('button', { name: 'Cuadro de texto', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.ProseMirror [data-kind="textbox"] .nw-shape-text').last().click();
  await page.keyboard.type('Dentro');
  const t = await page.locator('.ProseMirror [data-kind="textbox"] .nw-shape-text').last().innerText();
  assert.match(t, /Dentro/);
});

await check('todo sobrevive a guardar y volver a leer el .docx', async () => {
  const back = await page.evaluate(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    const out = [];
    d.body.descendants((n) => {
      if (n.type.name === 'shape') out.push(n.attrs.kind);
    });
    return out;
  });
  assert.deepEqual(back, ['ellipse', 'star5', 'rightArrow', 'line', 'actionButtonHome', 'textbox']);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
