// End-to-end checks for the picture of a question in Nova Forms: pick, size, alternative text, preview, web page and remove. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-forms-images.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=forms';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-forms-img-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.dismiss());
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.fm-app');
await page.screenshot();

let step = 0;
const shot = async (name, p = page) => {
  if (shotsDir) await p.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
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
const wait = (ms = 250) => page.waitForTimeout(ms);
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const press = (n) => page.getByRole('button', { name: n, exact: true }).click();
const mode = (name) => tab('Vista').then(() => press(name)).then(() => tab('Inicio'));
const image = () => ev(() => window.__novaForms.ctl.form.questions[0]?.image);

// a 300×200 PNG
const b64 = await ev(async () => {
  const c = document.createElement('canvas');
  c.width = 300;
  c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = '#1971c2';
  g.fillRect(0, 0, 300, 200);
  g.fillStyle = '#fff';
  g.font = '40px sans-serif';
  g.fillText('Logo', 100, 115);
  return c.toDataURL('image/png').split(',')[1];
});
const pngFile = path.join(tmp, 'logotipo.png');
fs.writeFileSync(pngFile, Buffer.from(b64, 'base64'));

await check('una pregunta sin imagen: el editor ofrece elegirla y no muestra tamaño ni texto alternativo', async () => {
  await ev(() => {
    const { ctl } = window.__novaForms;
    ctl.reset();
    ctl.setForm({ title: 'Con imagen' });
    ctl.addQuestion('choice');
  });
  await page.locator('section[aria-label="Pregunta 1"]').click();
  await page.locator('.fm-card.is-sel').getByLabel('Pregunta', { exact: true }).fill('¿Cuál es nuestro logotipo?');
  await page.getByRole('group', { name: 'Imagen de la pregunta' }).waitFor();
  assert.equal(await page.getByLabel('Tamaño de la imagen').count(), 0);
  assert.equal(await image(), undefined);
});

await check('elegir una imagen: se guarda con el nombre como texto alternativo y tamaño mediano, y se ve', async () => {
  await page.getByLabel('Elegir imagen').setInputFiles(pngFile);
  await page.waitForFunction(() => !!window.__novaForms.ctl.form.questions[0].image);
  const m = await image();
  assert.match(m.src, /^data:image\/png;base64,/);
  assert.equal(m.alt, 'logotipo');
  assert.equal(m.size, 'medium');
  const img = page.locator('.fm-card.is-sel .fm-qimg');
  assert.equal(await img.getAttribute('alt'), 'logotipo');
  assert.equal(await img.evaluate((i) => i.getBoundingClientRect().width), 320);
  await shot('elegida');
});

await check('tamaño pequeño y texto alternativo propio', async () => {
  await page.getByLabel('Tamaño de la imagen').selectOption({ label: 'Pequeña' });
  await page.getByLabel('Texto alternativo de la imagen').fill('Logotipo azul de la escuela');
  await wait();
  const m = await image();
  assert.equal(m.size, 'small');
  assert.equal(m.alt, 'Logotipo azul de la escuela');
  assert.equal(await page.locator('.fm-card.is-sel .fm-qimg').evaluate((i) => i.getBoundingClientRect().width), 160);
});

await check('una imagen de más de 1,5 MB se rechaza con un aviso y la pregunta no cambia', async () => {
  const big = path.join(tmp, 'grande.png');
  fs.writeFileSync(big, Buffer.alloc(1_600_000, 1));
  await page.getByLabel('Elegir imagen').setInputFiles(big);
  await page.getByRole('alert').filter({ hasText: /1,5 MB/ }).waitFor();
  assert.equal((await image()).alt, 'Logotipo azul de la escuela');
});

await check('la vista previa muestra la imagen con su texto alternativo y su ancho', async () => {
  await mode('Vista previa');
  const form = page.getByRole('form', { name: 'Con imagen' });
  const img = form.locator('.fm-qimg');
  assert.equal(await img.count(), 1);
  assert.equal(await img.getAttribute('alt'), 'Logotipo azul de la escuela');
  assert.equal(await img.evaluate((i) => i.naturalWidth > 0 && i.getBoundingClientRect().width), 160);
  await shot('vista-previa');
});

await check('la página web exportada trae la imagen, sin recursos externos y sin errores', async () => {
  await tab('Respuestas');
  const [dl] = await Promise.all([page.waitForEvent('download'), press('Exportar formulario como página web…')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  const p2 = await ctx.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  p2.on('console', (m) => m.type() === 'error' && !/Content Security Policy/.test(m.text()) && errs.push(m.text()));
  await p2.goto(pathToFileURL(file).href);
  const img = p2.locator('img.q-img');
  assert.equal(await img.count(), 1);
  assert.equal(await img.getAttribute('alt'), 'Logotipo azul de la escuela');
  assert.equal(await img.evaluate((i) => i.complete && i.naturalWidth > 0 && i.style.width), '160px');
  assert.deepEqual(errs, []);
  await shot('pagina', p2);
  await p2.close();
  await tab('Inicio');
});

await check('quitar la imagen la borra de la pregunta', async () => {
  await mode('Diseñar');
  await page.locator('section[aria-label="Pregunta 1"]').click();
  await press('Quitar la imagen');
  await wait();
  assert.equal(await image(), undefined);
  assert.equal(await page.locator('.fm-qimg').count(), 0);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
