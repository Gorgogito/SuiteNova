// End-to-end checks for the pictures in the body of a message in Nova Mail: insert, edit with the shared tools, send as inline image,
// save the draft and open it again. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-mail-images.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=mail';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-mail-img-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ml-item, .ml-folders');
await page.waitForTimeout(500);

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
const wait = (ms = 500) => page.waitForTimeout(ms);
const dialogs = () => page.getByRole('dialog');

// a 300×200 PNG: white with a red disc
const b64 = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 300, 200);
  g.fillStyle = '#e02020';
  g.beginPath();
  g.arc(150, 100, 60, 0, 7);
  g.fill();
  return c.toDataURL('image/png').split(',')[1];
});
const pngFile = path.join(tmp, 'foto.png');
fs.writeFileSync(pngFile, Buffer.from(b64, 'base64'));

const exportEml = async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar .eml' }).click()]);
  const f = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(f);
  return fs.readFileSync(f, 'utf8');
};
const qp = (t) => t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
const inlineBytes = (eml) => {
  const m = /Content-Type: image\/png[\s\S]*?Content-Transfer-Encoding: base64\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(eml);
  return m ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64') : null;
};

await check('insertar imagen: queda una marca en el texto y la imagen se elige para cambiarla', async () => {
  await page.keyboard.press('Control+Shift+M');
  await page.getByLabel('Para', { exact: true }).fill('bea@x.es');
  await page.getByLabel('Asunto').fill('Con imagen');
  await page.getByLabel('Cuerpo del mensaje').fill('Mira esto:\n');
  const [c] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Insertar imagen/ }).click()]);
  await c.setFiles(pngFile);
  await wait(500);
  assert.match(await page.getByLabel('Cuerpo del mensaje').inputValue(), /\[Imagen: foto\.png\]/);
  // la imagen recién insertada ya está elegida
  await page.getByLabel('Texto alternativo de la imagen').fill('Un disco rojo');
  await page.getByLabel('Ancho de la imagen (px)').fill('200');
  await shot('insertada');
});

let plainSize = 0;
await check('sin cambios se envía la imagen original tal cual, dentro del HTML', async () => {
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  const eml = await exportEml();
  assert.match(eml, /multipart\/related/);
  assert.match(qp(eml), /<img src="cid:[^"]+" alt="Un disco rojo" width="200"/);
  assert.match(eml, /Content-ID: </);
  const png = inlineBytes(eml);
  assert.ok(png && png.length > 100);
  plainSize = png.length;
  assert.equal(Buffer.compare(png, fs.readFileSync(pngFile)), 0, 'el original byte a byte');
});

await check('saturación a cero: se envía la imagen cambiada y el original se conserva; «Restablecer imagen» lo devuelve', async () => {
  await page.getByRole('button', { name: 'Color…' }).click();
  await wait();
  await dialogs().last().getByRole('tab', { name: 'Color' }).click().catch(() => undefined);
  await dialogs().last().getByRole('slider', { name: 'Saturación' }).fill('0');
  await shot('color');
  await dialogs().last().getByRole('button', { name: 'Aceptar' }).click();
  await wait(900);
  const eml = await exportEml();
  const png = inlineBytes(eml);
  assert.notEqual(Buffer.compare(png, fs.readFileSync(pngFile)), 0, 'la imagen enviada cambió');
  // el disco ya es gris: se comprueba en el navegador
  const grey = await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(bmp.width / 2, bmp.height / 2, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, png.toString('base64'));
  assert.ok(Math.abs(grey[0] - grey[1]) < 4 && Math.abs(grey[1] - grey[2]) < 4, `centro ${grey}`);
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await wait(300);
  const again = inlineBytes(await exportEml());
  assert.equal(again.length, plainSize, 'otra vez el original');
});

await check('relación de aspecto 16:9: se envía recortada', async () => {
  await page.getByRole('button', { name: 'Relación de aspecto' }).click();
  await page.getByRole('menuitem', { name: 'Horizontal 16:9' }).click();
  await wait(700);
  const png = inlineBytes(await exportEml());
  const size = await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    return [bmp.width, bmp.height];
  }, png.toString('base64'));
  assert.equal(size[0], 300);
  assert.ok(Math.abs(size[0] / size[1] - 16 / 9) < 0.03, `${size}`);
});

await check('el borrador guardado vuelve con la imagen, su texto alternativo y su ancho', async () => {
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.locator('.ml-folders li button', { hasText: 'Borradores' }).click();
  await page.locator('.ml-item').first().dblclick();
  await wait();
  assert.match(await page.getByLabel('Cuerpo del mensaje').inputValue(), /\[Imagen: foto\.png\]/);
  await page.locator('.ml-chip button[aria-pressed]').first().click();
  assert.equal(await page.getByLabel('Texto alternativo de la imagen').inputValue(), 'Un disco rojo');
  assert.equal(await page.getByLabel('Ancho de la imagen (px)').inputValue(), '200');
  await shot('reabierto');
});

await check('quitar la imagen quita también su marca del texto', async () => {
  await page.getByRole('button', { name: /Quitar foto\.png/ }).click();
  assert.doesNotMatch(await page.getByLabel('Cuerpo del mensaje').inputValue(), /Imagen:/);
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  const eml = await exportEml();
  assert.doesNotMatch(eml, /multipart\/related/);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
