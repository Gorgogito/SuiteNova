// End-to-end checks for the shared OCR in Nova Notes with the real Tesseract engine: reading images with word boxes, saving them, where a search
// falls in the picture, a turned picture, reading only a zone, and a notebook from before (text only). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-notes-ocr.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=notes';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-notes-ocr-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1900, height: 1000 } })).newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.dismiss());
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.nn-canvas');
await page.waitForTimeout(500);

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
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
const ev = (fn, arg) => page.evaluate(fn, arg);

// two pictures with text: a page of two lines, and the same turned a quarter turn
const draw = (turn) =>
  ev((turn) => {
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
    if (!turn) return c.toDataURL('image/png').split(',')[1];
    const t = document.createElement('canvas');
    t.width = 220;
    t.height = 700;
    const tg = t.getContext('2d');
    tg.translate(110, 350);
    tg.rotate(Math.PI / 2);
    tg.drawImage(c, -350, -110);
    return t.toDataURL('image/png').split(',')[1];
  }, turn);
const upright = path.join(tmp, 'factura.png');
const turned = path.join(tmp, 'girada.png');
fs.writeFileSync(upright, Buffer.from(await draw(0), 'base64'));
fs.writeFileSync(turned, Buffer.from(await draw(1), 'base64'));

const insert = async (file) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Imagen…', exact: true }).click()]);
  await chooser.setFiles(file);
  await page.waitForTimeout(400);
};
const waitRead = () => page.waitForFunction(() => window.__novaNotes.ctl.ocrPending === 0 && !window.__novaNotes.ctl.ocr.running, null, { timeout: 120000 });
const images = () => ev(() => window.__novaNotes.ctl.page.containers.filter((c) => c.kind === 'image').map((c) => ({ id: c.id, asset: c.asset })));
const stored = (asset) => ev((a) => JSON.parse(JSON.stringify(window.__novaNotes.ctl.nb.ocr[a] ?? null)), asset);

let first;
await check('al insertar una imagen se lee y se guardan las palabras con su caja', async () => {
  await insert(upright);
  await waitRead();
  first = (await images())[0];
  const r = await stored(first.asset);
  assert.ok(r, 'sin lectura');
  assert.match(r.text, /Factura/);
  assert.match(r.text, /4821/);
  assert.ok(r.lines?.length >= 2, `líneas ${r.lines?.length}`);
  assert.deepEqual(r.size, [700, 220]);
  const w = r.lines[0][4].find((x) => /Factura/.test(x[0]));
  assert.ok(w && w[1] < 120 && w[2] < 80, `caja de «Factura» ${JSON.stringify(w)}`);
});

await check('la búsqueda del cuaderno sigue encontrando el texto de la imagen', async () => {
  const where = await ev(() => {
    const { ctl } = window.__novaNotes;
    ctl.search('TOTAL a pagar');
    return ctl.results[0]?.where;
  });
  assert.equal(where, 'image');
});

await check('la imagen girada un cuarto de vuelta se lee con el giro automático', async () => {
  await insert(turned);
  await waitRead();
  const second = (await images()).find((i) => i.asset !== first.asset);
  const r = await stored(second.asset);
  assert.match(r.text, /Factura/);
  assert.ok(r.rotation === 90 || r.rotation === 270, `giro ${r.rotation}`);
});

await check('el cuadro de la imagen señala dónde está lo buscado', async () => {
  await page.locator('.nn-box--image').first().click({ button: 'right' });
  await page.getByRole('group', { name: 'Girar y recortar' }).waitFor();
  await page.getByLabel('Buscar en el texto de la imagen').fill('total');
  await page.waitForSelector('rect[data-ocr="found"]');
  const n = await page.locator('rect[data-ocr="found"]').count();
  assert.equal(n, 1);
  const y = Number(await page.locator('rect[data-ocr="found"]').getAttribute('y'));
  assert.ok(y > 100, `«Total» está abajo (y=${y})`);
  await shot('dónde');
  await page.getByLabel('Buscar en el texto de la imagen').fill('');
  assert.ok((await page.locator('rect[data-ocr="word"]').count()) >= 6);
});

await check('reconocer solo una zona: lee lo de abajo y deja las cajas en la imagen entera', async () => {
  const svg = page.locator('svg[aria-label="Arrastra para elegir la zona que se lee"]');
  const b = await svg.boundingBox();
  await page.mouse.move(b.x + 2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2, b.y + b.height - 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForSelector('rect[data-ocr="zone"]');
  await page.getByRole('button', { name: 'Reconocer solo la zona' }).click();
  await page.waitForFunction((a) => /Total/.test(window.__novaNotes.ctl.nb.ocr[a]?.text ?? '') && !/Factura/.test(window.__novaNotes.ctl.nb.ocr[a]?.text ?? ''), first.asset);
  const r = await stored(first.asset);
  assert.ok(r.zone, 'sin zona guardada');
  assert.ok(r.lines[0][1] > 20 && r.lines[0][1] < 700 && r.lines[0][2] > 100, `caja ${JSON.stringify(r.lines[0].slice(0, 4))}`);
  await shot('zona');
});

await check('reconocer de nuevo con giro fijo cambia lo guardado y se puede quitar la zona', async () => {
  await page.getByRole('button', { name: 'Quitar la zona' }).click();
  await page.getByRole('button', { name: 'Reconocer con estos ajustes' }).click();
  await page.waitForFunction((a) => /Factura/.test(window.__novaNotes.ctl.nb.ocr[a]?.text ?? ''), first.asset);
  const r = await stored(first.asset);
  assert.ok(!r.zone);
});

await check('un cuaderno de antes (solo el texto) se abre y se busca', async () => {
  const out = await ev(async () => {
    const core = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/notes-core/src/index.ts');
    const nb = core.newNotebook('Viejo');
    const raw = JSON.parse(JSON.stringify(nb));
    raw.ocr = { x: { text: 'Texto de antes', lang: 'spa', at: 1 } };
    const back = core.parseNotebook(JSON.stringify(raw));
    return back.ocr.x;
  });
  assert.deepEqual(out, { text: 'Texto de antes', lang: 'spa', at: 1 });
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
