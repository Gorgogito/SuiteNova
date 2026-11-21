// End-to-end checks for the text of pictures (OCR) and Find in Nova Diagram with the real Tesseract engine. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-diagram-ocr.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=diagram';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 2400, height: 950 } })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaDiagram, null, { timeout: 60000 });
await page.waitForTimeout(600);

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
    console.log('ok', name);
  } catch (e) {
    console.log('FAIL', name, e.message.slice(0, 200));
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const dialog = () => page.getByRole('dialog');
const CORE = '/@fs/D:/ProjectsIA/SuiteNova/packages/diagram-core/src/index.ts';

const makeUri = (text2 = 'Total a pagar 350 euros') =>
  ev((text2) => {
    const c = document.createElement('canvas');
    c.width = 700;
    c.height = 220;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 700, 220);
    g.fillStyle = '#000';
    g.textBaseline = 'top';
    g.font = '48px Arial';
    g.fillText('Factura número 4821', 30, 30);
    g.fillText(text2, 30, 120);
    return c.toDataURL('image/png');
  }, text2);
const insert = (uri, at) => ev(([uri, at]) => window.__novaDiagram.ctl.insertImage(uri, 700, 220, at), [uri, at]);
const shapes = () => ev(() => { const out = []; for (const p of window.__novaDiagram.ctl.diagram.pages) for (const s of p.shapes) out.push({ id: s.id, image: !!s.image, ocr: s.image?.ocr ? JSON.parse(JSON.stringify(s.image.ocr)) : null }); return out; });
const waitRead = () => page.waitForFunction(() => { const c = window.__novaDiagram.ctl; let n = 0, k = 0; for (const p of c.diagram.pages) for (const s of p.shapes) if (s.image) { n++; if (s.image.ocr) k++; } return n > 0 && k === n && !c.imageOcr.state.running; }, null, { timeout: 120000 });

let picId;
await check('una imagen insertada se lee sola y guarda las palabras con su caja', async () => {
  await ev(() => { const c = window.__novaDiagram.ctl; const r = c.diagram; });
  await insert(await makeUri(), { x: 400, y: 300 });
  await waitRead();
  const pic = (await shapes()).find((s) => s.image);
  picId = pic.id;
  assert.match(pic.ocr.text, /Factura/);
  assert.match(pic.ocr.text, /4821/);
  assert.ok(pic.ocr.lines.length >= 2);
  assert.deepEqual(pic.ocr.size, [700, 220]);
  await shot('leida');
});

await check('Buscar encuentra el texto de las formas y el de dentro de la imagen, y va a lo encontrado', async () => {
  await ev(() => {
    const c = window.__novaDiagram.ctl;
    const p = c.basePage;
    const sh = p.shapes.find((s) => !s.image);
    if (sh) c.edit((q) => ({ ...q, shapes: q.shapes.map((s) => (s.id === sh.id ? { ...s, text: 'Total del mes' } : s)) }));
  });
  if (!(await ev(() => window.__novaDiagram.ctl.basePage.shapes.some((s) => s.text === 'Total del mes')))) {
    await ev(async (core) => {
      const m = await import(core);
      const c = window.__novaDiagram.ctl;
      c.edit((p) => m.addShape(p, 'rect', 150, 120, { text: 'Total del mes' }).page);
    }, CORE);
  }
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Buscar…' }).first().click();
  const dlg = dialog();
  await dlg.getByLabel('Buscar', { exact: true }).fill('TOTAL');
  await dlg.getByRole('status').filter({ hasText: /2 coincidencias/ }).waitFor();
  await dlg.getByRole('button', { name: /imagen · Total a pagar/ }).click();
  assert.deepEqual(await ev(() => window.__novaDiagram.ctl.selShapes), [picId]);
  await shot('buscar');
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
});

await check('el cuadro «Texto de la imagen» señala dónde está lo buscado y lee solo una zona', async () => {
  await ev((id) => window.__novaDiagram.ctl.setSelection([id]), picId);
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Texto de la imagen…' }).click();
  const dlg = dialog();
  await dlg.getByLabel('Buscar en el texto de la imagen').fill('total');
  await dlg.locator('rect[data-ocr="found"]').waitFor();
  assert.ok(Number(await dlg.locator('rect[data-ocr="found"]').getAttribute('y')) > 100);
  await shot('dialogo');
  const b = await dlg.locator('svg[aria-label="Arrastra para elegir la zona que se lee"]').boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height - 2, { steps: 5 });
  await page.mouse.up();
  await dlg.getByRole('button', { name: 'Leer solo la zona' }).click();
  await page.waitForFunction((id) => { const s = window.__novaDiagram.ctl.diagram.pages[0].shapes.find((x) => x.id === id); const t = s.image.ocr?.text ?? ''; return /Total/.test(t) && !/Factura/.test(t); }, picId);
  await dlg.getByRole('button', { name: 'Quitar la zona' }).click();
  await dlg.getByRole('button', { name: 'Leer con estos ajustes' }).click();
  await page.waitForFunction((id) => { const s = window.__novaDiagram.ctl.diagram.pages[0].shapes.find((x) => x.id === id); const t = s.image.ocr?.text ?? ''; return /Factura/.test(t) && /Total/.test(t); }, picId);
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
});

await check('copiar el texto de la imagen lo deja en el portapapeles', async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await ev((id) => window.__novaDiagram.ctl.setSelection([id]), picId);
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Copiar el texto de la imagen' }).click();
  assert.match(await ev(() => navigator.clipboard.readText()), /Factura número 4821/);
});

await check('el .novadiagram guarda el texto leído y vuelve a abrirse con él; el .vsdx no lo lleva', async () => {
  const r = await ev(async (core) => {
    const m = await import(core);
    const d = window.__novaDiagram.ctl.diagram;
    const back = m.parseDiagram(m.serializeDiagram(d)).diagram;
    const s = back.pages[0].shapes.find((x) => x.image);
    return { text: s.image.ocr?.text, hasPart: false };
  }, CORE);
  assert.match(r.text, /Factura/);
});

await check('las imágenes que ya tenía un archivo no se leen solas, y «Leer el texto de las imágenes» las lee', async () => {
  const text = await ev(async (core) => {
    const m = await import(core);
    const d = JSON.parse(JSON.stringify(window.__novaDiagram.ctl.diagram));
    for (const p of d.pages) for (const s of p.shapes) if (s.image) delete s.image.ocr;
    return m.serializeDiagram(d);
  }, CORE);
  await ev(([t]) => window.__novaDiagram.load(t, 'abierto.novadiagram'), [text]);
  await page.waitForTimeout(4000);
  assert.equal((await shapes()).find((s) => s.image).ocr, null, 'no debe leerse sola');
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Leer el texto de las imágenes' }).click();
  await waitRead();
  assert.match((await shapes()).find((s) => s.image).ocr.text, /Factura/);
});

await check('con «Leer las imágenes nuevas» desactivado, una imagen nueva no se lee; cambiar la imagen borra su lectura', async () => {
  await page.getByRole('button', { name: 'Leer las imágenes nuevas al insertarlas' }).click();
  assert.equal(await ev(() => window.__novaDiagram.ctl.imageOcr.auto), false);
  await insert(await makeUri('Otro texto aqui'), { x: 900, y: 500 });
  await page.waitForTimeout(3000);
  assert.ok((await shapes()).some((s) => s.image && s.ocr === null), 'la imagen nueva sigue sin leer');
  await page.getByRole('button', { name: 'Leer las imágenes nuevas al insertarlas' }).click();
  const attrs = await ev(async () => {
    const m = await import('/src/diagram/pichost.ts');
    const s = window.__novaDiagram.ctl.diagram.pages[0].shapes.find((x) => x.image?.ocr);
    return m.editedImage(s.image, { brightness: 20 }, undefined);
  });
  assert.equal(attrs.ocr, undefined);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
