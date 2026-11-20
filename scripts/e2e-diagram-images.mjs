// End-to-end checks for the picture tools of Nova Diagram (the reduced set) and the pictures in the Visio export. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-diagram-images.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=diagram';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-diagram-img-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
const alerts = [];
page.on('dialog', (d) => {
  alerts.push(d.message());
  d.dismiss();
});
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('[data-stencil]');
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
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const press = (n) => page.getByRole('button', { name: n, exact: true }).click();
const dialogs = () => page.getByRole('dialog');
const pic = () => ev(() => window.__novaDiagram.ctl.basePage.shapes.find((s) => s.stencil === 'image'));
const sizeOf = (uri) =>
  ev(async (u) => {
    const bmp = await createImageBitmap(await (await fetch(u)).blob());
    return [bmp.width, bmp.height];
  }, uri);
const centre = (uri) =>
  ev(async (u) => {
    const bmp = await createImageBitmap(await (await fetch(u)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return [...g.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data];
  }, uri);

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

let orig;
await check('insertar una imagen: las herramientas se activan con la forma elegida', async () => {
  await tab('Contenido');
  assert.equal(await page.getByRole('button', { name: 'Restablecer imagen' }).isDisabled(), true, 'sin imagen elegida no hay nada que restablecer');
  await page.locator('[data-testid=dg-image-input]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(() => window.__novaDiagram.ctl.basePage.shapes.some((s) => s.stencil === 'image'));
  orig = (await pic()).image.src;
  assert.ok(!(await pic()).image.orig, 'sin ediciones no se guarda el original aparte');
  await shot('insertada');
});

await check('saturación a cero: se dibuja gris, el original se guarda y «Restablecer imagen» lo devuelve', async () => {
  await page.getByRole('button', { name: 'Correcciones' }).click();
  await page.getByRole('menuitem', { name: /Opciones de color de imagen/ }).click();
  await wait();
  await dialogs().last().getByRole('slider', { name: 'Saturación' }).fill('0');
  await dialogs().last().getByRole('button', { name: 'Aceptar' }).click();
  await wait(900);
  const s = await pic();
  assert.equal(s.image.orig, orig, 'el original es la imagen de antes');
  assert.ok(s.image.edits && /saturation/.test(s.image.edits), s.image.edits);
  const px = await centre(s.image.src);
  assert.ok(Math.abs(px[0] - px[1]) < 4 && Math.abs(px[1] - px[2]) < 4, `centro ${px}`);
  assert.equal(await page.locator(`[data-shape-id="${s.id}"] image`).getAttribute('href'), s.image.src, 'se dibuja la imagen cambiada');
  await shot('gris');
  await press('Restablecer imagen');
  await wait(700);
  const r = await pic();
  assert.equal(r.image.src, orig);
  assert.ok(!r.image.orig && !r.image.edits);
});

await check('relación de aspecto 16:9: la imagen queda recortada y se puede restablecer', async () => {
  await page.getByRole('button', { name: 'Relación de aspecto' }).click();
  await page.getByRole('menuitem', { name: 'Horizontal 16:9' }).click();
  await wait(800);
  const s = await pic();
  const [w, h] = await sizeOf(s.image.src);
  assert.equal(w, 300);
  assert.ok(Math.abs(w / h - 16 / 9) < 0.03, `${w}×${h}`);
  assert.equal(s.image.orig, orig);
  await press('Restablecer imagen');
  await wait(700);
  assert.deepEqual(await sizeOf((await pic()).image.src), [300, 200]);
});

await check('quitar fondo con el cuadro compartido: el blanco pasa a transparente', async () => {
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await wait(600);
  const d = dialogs().last();
  await d.getByRole('button', { name: /Conservar los cambios/ }).click();
  await wait(900);
  const s = await pic();
  assert.equal(s.image.orig, orig);
  const alpha = await ev(async (u) => {
    const bmp = await createImageBitmap(await (await fetch(u)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return [g.getImageData(3, 3, 1, 1).data[3], g.getImageData(150, 100, 1, 1).data[3]];
  }, s.image.src);
  assert.equal(alpha[0], 0, 'el fondo se quitó');
  assert.equal(alpha[1], 255, 'el disco se mantiene');
  await shot('sin-fondo');
});

await check('texto alternativo: se guarda, se dibuja y va en el SVG', async () => {
  await press('Texto alternativo…');
  await dialogs().last().getByLabel(/Descripción/).fill('Un disco rojo');
  await dialogs().last().getByRole('button', { name: 'Aceptar' }).click();
  await wait();
  const s = await pic();
  assert.equal(s.image.alt, 'Un disco rojo');
  assert.equal(await page.locator(`[data-shape-id="${s.id}"] image`).getAttribute('aria-label'), 'Un disco rojo');
  // the other picture options keep it
  await press('Ajustar la imagen a la forma');
  assert.equal((await pic()).image.alt, 'Un disco rojo');
  assert.ok((await pic()).image.orig, 'cambiar el ajuste no pierde el original');
  const svg = await ev(async () => (await import('/@fs/D:/ProjectsIA/SuiteNova/packages/diagram-core/src/index.ts')).pageToSvg(window.__novaDiagram.ctl.basePage));
  assert.match(svg, /<title>Un disco rojo<\/title>/);
});

await check('guardar el diagrama y abrirlo de nuevo conserva el original y las ediciones', async () => {
  const back = await ev(async () => {
    const m = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/diagram-core/src/index.ts');
    const d = m.parseDiagram(m.serializeDiagram(window.__novaDiagram.ctl.diagram)).diagram;
    return d.pages[0].shapes.find((s) => s.stencil === 'image').image;
  });
  const now = (await pic()).image;
  assert.equal(back.orig, now.orig);
  assert.equal(back.edits, now.edits);
  assert.equal(back.alt, 'Un disco rojo');
});

await check('exportar a Visio: la imagen va como forma de imagen con su archivo, bajo su forma', async () => {
  await tab('Diseño');
  await press('Exportar');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Visio/ }).click()]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const media = Object.keys(zip.files).filter((f) => f.startsWith('visio/media/') && !f.endsWith('/'));
  assert.equal(media.length, 1, media.join(','));
  const bytes = await zip.file(media[0]).async('nodebuffer');
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  // the picture in the file is the one Nova shows (with its edits made)
  assert.equal(`data:image/png;base64,${bytes.toString('base64')}`, (await pic()).image.src);
  const page1 = await zip.file('visio/pages/page1.xml').async('string');
  assert.match(page1, /Type="Foreign"/);
  assert.match(await zip.file('visio/pages/_rels/page1.xml.rels').async('string'), /relationships\/image/);
  assert.match(await zip.file('[Content_Types].xml').async('string'), /Extension="png"/);
  assert.ok(page1.indexOf('Type="Foreign"') < page1.indexOf('NovaStencil'), 'the picture is under its shape');
  assert.deepEqual(alerts.filter((a) => /Visio/.test(a)), [], 'sin avisos: la imagen sí cabe en Visio');
});

await check('una imagen SVG no cabe en Visio: se avisa y la forma sale sin ella', async () => {
  await ev(() => {
    const c = window.__novaDiagram.ctl;
    const svg = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>');
    c.insertImage(svg, 40, 40, { x: 600, y: 400 });
  });
  await wait();
  await press('Exportar');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Visio/ }).click()]);
  const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
  assert.equal(Object.keys(zip.files).filter((f) => f.startsWith('visio/media/') && !f.endsWith('/')).length, 1, 'solo la imagen PNG va en el archivo');
  await wait();
  assert.ok(alerts.some((a) => /1 imagen\(es\) no se exportaron a Visio/.test(a)), alerts.join(' | '));
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
