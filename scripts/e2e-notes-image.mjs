// End-to-end checks for the picture options of Nova Notes (the reduced set: turn, flip, crop and alternative text). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-notes-image.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=notes';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-notes-img-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
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
const wait = (ms = 300) => page.waitForTimeout(ms);
const image = () => ev(() => window.__novaNotes.ctl.page.containers.find((c) => c.kind === 'image'));

// a 300×200 PNG: white with a red disc
const b64 = await ev(async () => {
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

let before;
await check('insertar una imagen y abrir sus opciones', async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Imagen…', exact: true }).click()]);
  await chooser.setFiles(pngFile);
  await page.waitForSelector('.nn-box--image img');
  before = await image();
  assert.ok(!before.rotation && !before.crop);
  await page.locator('.nn-box--image').click({ button: 'right' });
  await page.getByRole('group', { name: 'Girar y recortar' }).waitFor();
  await shot('opciones');
});

await check('girar a la derecha 90°: se guarda y la imagen gira dentro de su caja', async () => {
  await page.getByRole('button', { name: 'Girar 90° a la derecha' }).click();
  await wait();
  assert.equal((await image()).rotation, 90);
  const tf = await page.locator('.nn-box--image img').evaluate((i) => i.parentElement.parentElement.style.transform);
  assert.match(tf, /rotate\(90deg\)/);
  assert.equal(await page.getByLabel('Giro en grados').inputValue(), '90');
  await page.getByRole('button', { name: 'Girar 90° a la izquierda' }).click();
  await wait();
  assert.equal((await image()).rotation, undefined, 'dos giros contrarios no dejan giro');
});

await check('voltear horizontalmente y escribir los grados a mano', async () => {
  await page.getByRole('button', { name: 'Voltear horizontalmente' }).click();
  await wait();
  assert.equal((await image()).flipH, true);
  assert.match(await page.locator('.nn-box--image img').evaluate((i) => i.parentElement.parentElement.style.transform), /scaleX\(-1\)/);
  await page.getByLabel('Giro en grados').fill('45');
  await wait();
  assert.equal((await image()).rotation, 45);
  await shot('girada');
});

await check('recortar a 16:9: el recorte queda en la imagen y la caja se ajusta sin mover la imagen', async () => {
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await wait();
  const clean = await image();
  assert.ok(!clean.rotation && !clean.flipH && !clean.crop);
  await page.getByLabel('Relación de aspecto').selectOption({ label: 'Horizontal 16:9' });
  await wait(500);
  const c = await image();
  assert.ok(c.crop && (c.crop.t > 0 || c.crop.b > 0), `recorte ${JSON.stringify(c.crop)}`);
  assert.ok(Math.abs(c.w / c.h - 16 / 9) < 0.05, `caja ${c.w}×${c.h}`);
  assert.equal(c.w, before.w, 'se recorta arriba y abajo: el ancho se queda');
  assert.ok(c.h < before.h);
  // lo que se ve está recortado: la imagen de dentro es más alta que la caja
  const ratio = await page.locator('.nn-box--image img').evaluate((i) => i.getBoundingClientRect().height / i.parentElement.getBoundingClientRect().height);
  assert.ok(ratio > 1.05, `ratio ${ratio}`);
  await shot('recortada');
});

await check('quitar el recorte devuelve la caja y la imagen original sigue entera', async () => {
  await page.getByRole('button', { name: 'Quitar el recorte' }).click();
  await wait();
  const c = await image();
  assert.equal(c.crop, undefined);
  assert.ok(Math.abs(c.h - before.h) <= 1 && Math.abs(c.w - before.w) <= 1 && Math.abs(c.y - before.y) <= 1, `${c.w}×${c.h} en ${c.y} frente a ${before.w}×${before.h} en ${before.y}`);
});

await check('el texto alternativo se guarda con el giro y el recorte', async () => {
  await page.getByRole('button', { name: 'Girar 90° a la derecha' }).click();
  await page.getByLabel(/Texto alternativo \(/).fill('Un disco rojo');
  await page.getByRole('button', { name: 'Guardar el texto alternativo' }).click();
  await wait();
  const c = await image();
  assert.equal(c.alt, 'Un disco rojo');
  assert.equal(c.rotation, 90);
});

await check('el cambio se deshace', async () => {
  await page.keyboard.press('Control+Z');
  await wait();
  const c = await image();
  assert.ok(c.alt !== 'Un disco rojo' || c.rotation !== 90, 'deshacer cambió algo');
});

await check('la página exportada conserva el giro, el volteo y el recorte', async () => {
  const html = await ev(async () => {
    const { ctl } = window.__novaNotes;
    const mod = await import('/src/notes/export.ts');
    ctl.setImageFrame(ctl.page.containers.find((c) => c.kind === 'image').id, { rotation: 90, flipH: true, crop: { l: 10000, t: 10000, r: 10000, b: 10000 } });
    return mod.pageToHtml(ctl.nb, ctl.page);
  });
  assert.match(html, /rotate\(90deg\) scaleX\(-1\)/);
  assert.match(html, /<img style="[^"]*width:125%/);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
