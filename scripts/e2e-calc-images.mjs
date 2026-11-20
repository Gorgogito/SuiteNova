// End-to-end checks for the picture tools of Nova Calc: reversible effects, colour, background, aspect ratio, styles, rotation, how the picture
// follows the cells, undo and save/reopen as .xlsx. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-images.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.waitForTimeout(500);
await page.mouse.click(300, 400);

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
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 10).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const dialog = () => page.getByRole('dialog');
const wait = (ms = 500) => page.waitForTimeout(ms);

// a 300×200 picture: white with a red disc in the middle
const insertRich = () =>
  ev(async () => {
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
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const d = window.__novaCalc.doc;
    d.selectCell(2, 1);
    return d.x.insertImage('image/png', bytes, 300, 200, 'rica');
  });
const img = () =>
  ev(() => {
    const d = window.__novaCalc.doc;
    const i = d.sheet.images[d.sheet.images.length - 1];
    return i && { id: i.id, media: i.media, orig: i.orig ?? null, edits: i.edits ?? null, crop: i.crop ?? null, shape: i.shape ?? null, rotation: i.rotation ?? 0, flipH: !!i.flipH, anchor: i.anchor ?? null, x: i.x, y: i.y, width: i.width, height: i.height };
  });
const centre = () =>
  ev(async () => {
    const d = window.__novaCalc.doc;
    const i = d.sheet.images[d.sheet.images.length - 1];
    const m = d.wb.media.get(i.media);
    const bmp = await createImageBitmap(new Blob([m.data], { type: m.mime }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return [...g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data];
  });
const select = async (id) => {
  await ev((i) => window.__novaCalc.doc.x.selectObject('image', i), id);
  await wait(300);
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
};

let id = null;
await check('efecto artístico reversible: guarda el original, cambia de intensidad, se deshace y «Restablecer imagen» lo devuelve', async () => {
  id = await insertRich();
  await select(id);
  const before = await img();
  assert.equal(before.orig, null);
  assert.equal(before.anchor, 'twoCell', 'como Excel: mover y ajustar con las celdas');
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitemradio', { name: 'Mosaico' }).click();
  await wait(900);
  const a = await img();
  assert.equal(a.orig, before.media, 'el original se guarda');
  assert.deepEqual(a.edits, { artistic: { id: 'mosaic', level: 50 } });
  await shot('efecto');
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitem', { name: /Opciones de efectos artísticos/ }).click();
  await wait();
  await dialog().getByRole('slider', { name: 'Intensidad' }).fill('80');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await wait(900);
  assert.equal((await img()).edits.artistic.level, 80);
  await page.keyboard.press('Control+z');
  await wait(400);
  assert.equal((await img()).edits.artistic.level, 50, 'un solo paso de deshacer');
  await select(id);
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await wait();
  const r = await img();
  assert.deepEqual([r.orig, r.edits, r.media], [null, null, before.media]);
});

await check('color: saturación a cero deja grises y el original sigue ahí', async () => {
  await select(id);
  await page.getByRole('button', { name: 'Correcciones' }).click();
  await page.getByRole('menuitem', { name: /Opciones de color de imagen/ }).click();
  await wait();
  await dialog().getByRole('tab', { name: 'Color' }).click();
  await dialog().getByRole('slider', { name: 'Saturación' }).fill('0');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await wait(900);
  assert.deepEqual((await img()).edits, { saturation: 0 });
  const [r, g, b] = await centre();
  assert.ok(Math.abs(r - g) < 4 && Math.abs(g - b) < 4, `centro ${r},${g},${b}`);
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await wait();
  assert.equal((await img()).edits, null);
});

await check('quitar fondo con una zona marcada y descartar', async () => {
  await select(id);
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await wait(700);
  await dialog().getByRole('radio', { name: 'Marcar áreas para quitar' }).check();
  const box = await dialog().getByLabel('Vista previa').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await wait(300);
  await dialog().getByRole('button', { name: 'Conservar los cambios' }).click();
  await wait(900);
  assert.equal((await img()).edits.background.remove.length, 1);
  assert.equal((await centre())[3], 0, 'el disco marcado se quitó');
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await wait(700);
  await dialog().getByRole('button', { name: 'Descartar todos los cambios' }).click();
  await wait(700);
  assert.equal((await img()).edits, null);
});

await check('relación de aspecto 16:9 recorta y la imagen se queda en su sitio; el estilo «Óvalo» da forma y borde', async () => {
  await select(id);
  const b = await img();
  await page.getByRole('button', { name: 'Relación de aspecto' }).click();
  await page.getByRole('menuitem', { name: 'Horizontal 16:9' }).click();
  await wait();
  const a = await img();
  assert.ok(a.crop, 'recortada');
  assert.ok(Math.abs(a.width / a.height - 16 / 9) < 0.03, `${a.width}x${a.height}`);
  assert.equal(a.width, b.width, 'el ancho se conserva (el recorte es vertical)');
  assert.ok(a.y > b.y, 'la parte visible no se mueve: la caja baja lo que se recortó arriba');
  await page.getByRole('button', { name: 'Estilos de imagen' }).click();
  await page.getByRole('menuitem', { name: 'Óvalo con borde' }).click();
  await wait();
  const s = await img();
  assert.equal(s.shape, 'ellipse');
  assert.deepEqual(s.crop, a.crop, 'el recorte se conserva');
  await shot('oval');
});

await check('girar a la derecha y voltear', async () => {
  await select(id);
  await page.getByRole('button', { name: 'Girar a la derecha' }).click();
  await page.getByRole('button', { name: 'Voltear horizontalmente' }).click();
  await wait(300);
  const a = await img();
  assert.deepEqual([a.rotation, a.flipH], [90, true]);
  const tf = await page.locator(`[data-image-id="${id}"]`).evaluate((el) => el.style.transform);
  assert.match(tf, /rotate\(90deg\) scaleX\(-1\)/);
  await page.keyboard.press('Control+z');
  await wait(300);
  assert.equal((await img()).flipH, false);
});

await check('las propiedades «mover y ajustar»: con las celdas, una fila más alta encima mueve la imagen y una dentro la estira', async () => {
  await select(id);
  await page.getByRole('button', { name: 'Propiedades' }).click();
  await page.getByRole('menuitemradio', { name: 'Mover y ajustar tamaño con celdas' }).click().catch(async () => page.getByRole('menuitem', { name: 'Mover y ajustar tamaño con celdas' }).click());
  await wait(300);
  const b = await img();
  assert.equal(b.anchor, 'twoCell');
  // una fila por encima de la imagen (la imagen empieza en la fila 3)
  await ev(() => window.__novaCalc.doc.setRowHeight([0], 50));
  await wait(300);
  const m = await img();
  assert.equal(m.y, b.y + 30, 'la imagen baja lo que creció la fila');
  assert.ok(Math.abs(m.height - b.height) < 0.01);
  // una fila que la imagen cubre
  await ev(() => window.__novaCalc.doc.setRowHeight([4], 60));
  await wait(300);
  const s = await img();
  assert.ok(Math.abs(s.height - (m.height + 40)) < 0.01, 'la imagen crece con la fila');
  await page.keyboard.press('Control+z');
  await wait(300);
  assert.equal((await img()).height, m.height, 'deshacer devuelve el tamaño');
  // sin ajustar: solo se mueve; sin mover: se queda
  await ev((i) => window.__novaCalc.doc.x.updateImage(i, { anchor: 'oneCell' }), id);
  await ev(() => window.__novaCalc.doc.setRowHeight([4], 60));
  await wait(300);
  assert.equal((await img()).height, m.height);
  await ev((i) => window.__novaCalc.doc.x.updateImage(i, { anchor: 'absolute' }), id);
  const y0 = (await img()).y;
  await ev(() => window.__novaCalc.doc.setRowHeight([0], 80));
  await wait(300);
  assert.equal((await img()).y, y0, 'sin mover, se queda donde está');
});

await check('guardar y volver a leer el .xlsx conserva recorte, forma, original y ediciones', async () => {
  await select(id);
  await ev((i) => window.__novaCalc.doc.x.updateImage(i, { anchor: 'twoCell', rotation: 30 }), id);
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitemradio', { name: 'Desenfoque' }).click();
  await wait(900);
  const before = await img();
  const rt = await ev(() => window.__novaCalc.xlsxRoundTrip());
  const back = rt.images[rt.images.length - 1];
  assert.deepEqual(back.crop, before.crop);
  assert.equal(back.shape, 'ellipse');
  assert.equal(back.rotation, 30);
  assert.equal(back.anchor, 'twoCell');
  assert.deepEqual(back.edits, { artistic: { id: 'blur', level: 50 } });
  assert.ok(back.orig && back.orig !== back.media, 'el original vuelve');
  assert.match(rt.drawing, /<a:srcRect /);
  assert.match(rt.drawing, /prst="ellipse"/);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
