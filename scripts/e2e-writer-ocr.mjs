// End-to-end checks for the text of pictures (OCR) in Nova Writer with the real Tesseract engine: reading what is inserted, finding it with Ctrl+F,
// the dialog with where it is, the .docx, and that a file's own pictures are not read until asked. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-ocr.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 950 } })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.dismiss().catch(() => {}));
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
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(600);
const ev = (fn, arg) => page.evaluate(fn, arg);
const editor = page.locator('.ProseMirror').first();

const makePng = () =>
  ev(() => {
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
    g.fillText('Total a pagar 350 euros', 30, 120);
    return c.toDataURL('image/png');
  });
const insertImage = (src) =>
  ev((src) => {
    const v = window.__novaWriter.ctl.mainView;
    const img = v.state.schema.nodes.image.create({ src, alt: 'Una factura', width: 350, height: 110 });
    let pos = null;
    v.state.doc.descendants((n, p) => {
      if (n.type.name === 'paragraph' && pos === null) pos = p + 1;
    });
    v.dispatch(v.state.tr.insert(pos, img));
  }, src);
const images = () => ev(() => { const out = []; window.__novaWriter.ctl.mainState.doc.descendants((n, p) => { if (n.type.name === 'image') out.push({ pos: p, ocr: n.attrs.ocr ? JSON.parse(JSON.stringify(n.attrs.ocr)) : null }); }); return out; });
const waitRead = (n = 0) => page.waitForFunction((n) => { const d = window.__novaWriter.ctl.mainState.doc; let k = 0; d.descendants((x) => { if (x.type.name === 'image' && x.attrs.ocr) k++; }); return k > n && !window.__novaWriter.ctl.imageOcr.state.running; }, n, { timeout: 120000 });

const PNG = await makePng();
await editor.click();
await page.keyboard.type('Texto del documento antes de la imagen.');

await check('una imagen insertada se lee sola y guarda las palabras con su caja', async () => {
  await insertImage(PNG);
  await waitRead();
  const [im] = await images();
  assert.match(im.ocr.text, /Factura/);
  assert.match(im.ocr.text, /4821/);
  assert.ok(im.ocr.lines.length >= 2);
  assert.deepEqual(im.ocr.size, [700, 220]);
  await shot('leida');
});

await check('Ctrl+F encuentra el texto de dentro de la imagen y la marca', async () => {
  await editor.click();
  await page.keyboard.press('Control+F');
  await page.locator('.nw-find-bar').getByLabel('Buscar', { exact: true }).fill('TOTAL a pagar');
  await page.waitForSelector('.nw-find-img-cur');
  assert.equal(await page.locator('.nw-find-bar .nw-find-info').innerText(), '1 de 1');
  const sel = await ev(() => window.__novaWriter.ctl.mainState.selection.node?.type.name);
  assert.equal(sel, 'image');
  await shot('buscar');
  // el texto del documento y el de la imagen se buscan a la vez
  await page.locator('.nw-find-bar').getByLabel('Buscar', { exact: true }).fill('texto');
  await page.waitForFunction(() => /de/.test(document.querySelector('.nw-find-bar .nw-find-info')?.textContent ?? ''));
});

await check('reemplazar no toca el texto de la imagen', async () => {
  await page.locator('.nw-find-bar').getByLabel('Buscar', { exact: true }).fill('Factura');
  await page.waitForSelector('.nw-find-img-cur');
  const before = await images();
  await ev(() => window.__novaWriter.ctl.replaceAll('Factura', 'Nota', {}));
  const after = await images();
  assert.equal(after[0].ocr.text, before[0].ocr.text);
  await page.keyboard.press('Escape');
});

await check('el cuadro «Texto de la imagen» señala dónde está lo buscado y lee solo una zona', async () => {
  await page.locator('.ProseMirror img.nw-image').first().click();
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await page.getByRole('button', { name: 'Texto de la imagen…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Buscar en el texto de la imagen').fill('total');
  await dlg.locator('rect[data-ocr="found"]').waitFor();
  const y = Number(await dlg.locator('rect[data-ocr="found"]').getAttribute('y'));
  assert.ok(y > 100, `y=${y}`);
  await shot('dialogo');
  const svg = dlg.locator('svg[aria-label="Arrastra para elegir la zona que se lee"]');
  const b = await svg.boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height - 2, { steps: 5 });
  await page.mouse.up();
  await dlg.getByRole('button', { name: 'Leer solo la zona' }).click();
  await page.waitForFunction(() => { let t = ''; window.__novaWriter.ctl.mainState.doc.descendants((n) => { if (n.type.name === 'image') t = n.attrs.ocr?.text ?? ''; }); return /Total/.test(t) && !/Factura/.test(t); });
  await dlg.getByRole('button', { name: 'Quitar la zona' }).click();
  await dlg.getByRole('button', { name: 'Leer con estos ajustes' }).click();
  await page.waitForFunction(() => { let t = ''; window.__novaWriter.ctl.mainState.doc.descendants((n) => { if (n.type.name === 'image') t = n.attrs.ocr?.text ?? ''; }); return /Factura/.test(t) && /Total/.test(t); });
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
});

await check('copiar el texto de la imagen lo deja en el portapapeles', async () => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('.ProseMirror img.nw-image').first().click();
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await page.getByRole('button', { name: 'Copiar el texto de la imagen' }).click();
  const clip = await ev(() => navigator.clipboard.readText());
  assert.match(clip, /Factura número 4821/);
});

let bytes;
await check('el .docx lleva el texto en una parte propia y vuelve a abrirse con él; el texto del documento no lo incluye', async () => {
  const r = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    let ocr = null;
    d.body.descendants((n) => { if (n.type.name === 'image') ocr = n.attrs.ocr; });
    return { b64: btoa(String.fromCharCode(...data.subarray(0, 0))), n: data.length, text: ocr?.text, lines: ocr?.lines?.length, plain: w.ctl.mainState.doc.textBetween(0, w.ctl.mainState.doc.content.size) };
  });
  assert.match(r.text, /Factura/);
  assert.ok(r.lines >= 2);
  assert.ok(!/4821/.test(r.plain), 'el texto del documento no debe incluir el de la imagen');
  bytes = r.n;
});

await check('las imágenes que ya tenía un archivo no se leen solas, y «Leer el texto de las imágenes» las lee', async () => {
  await ev(async (src) => {
    const w = window.__novaWriter;
    const v = w.ctl.mainView;
    const img = v.state.schema.nodes.image.create({ src, alt: 'Una factura', width: 350, height: 110 });
    const doc = w.ctl.toWriterDoc();
    const p = v.state.schema.nodes.paragraph.create(null, [img]);
    // a document that comes from a file: one picture without reading
    const body = v.state.doc.type.create(v.state.doc.attrs, v.state.doc.content.replaceChild ? v.state.doc.content : v.state.doc.content);
    void body;
    const out = { ...doc, body: doc.body.type.create(doc.body.attrs, [doc.body.firstChild.type.create(doc.body.firstChild.attrs, [p])]) };
    w.ctl.load(out, 'abierto.docx', null);
  }, PNG);
  await page.waitForTimeout(4000);
  assert.equal((await images())[0].ocr, null, 'no debe leerse sola');
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Leer el texto de las imágenes' }).click();
  await waitRead();
  assert.match((await images())[0].ocr.text, /Factura/);
});

await check('con «Leer las imágenes nuevas» desactivado, una imagen nueva no se lee', async () => {
  await page.getByRole('button', { name: 'Leer las imágenes nuevas al insertarlas' }).click();
  assert.equal(await ev(() => window.__novaWriter.ctl.imageOcr.auto), false);
  await ev(() => {
    const v = window.__novaWriter.ctl.mainView;
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 100;
    const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 100); g.fillStyle = '#000'; g.font = '40px Arial'; g.fillText('Otra imagen', 10, 30);
    const img = v.state.schema.nodes.image.create({ src: canvas.toDataURL('image/png'), width: 150, height: 50 });
    v.dispatch(v.state.tr.insert(1, img));
  });
  await page.waitForTimeout(4000);
  const list = await images();
  assert.ok(list.some((i) => i.ocr === null), 'la imagen nueva sigue sin leer');
  await page.getByRole('button', { name: 'Leer las imágenes nuevas al insertarlas' }).click();
});

await check('editar los píxeles de la imagen borra su lectura para leerla de nuevo', async () => {
  const attrs = await ev(async () => {
    const m = await import('/src/writer/pichost.ts');
    const list = [];
    window.__novaWriter.ctl.mainState.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.ocr) list.push(n.attrs); });
    return m.editedAttrs(list[0], { brightness: 20 });
  });
  assert.equal(attrs.ocr, null);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
