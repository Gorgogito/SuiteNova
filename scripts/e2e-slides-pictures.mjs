// End-to-end checks of the picture tools of Nova Slides: remove background, artistic effects, compress, icons, photo album,
// save as picture and screenshot. Needs `pnpm dev` on :1420.   Usage: node scripts/e2e-slides-pictures.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|getDisplayMedia|Permission/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());
let step = 0;
const shot = async (n) => shotsDir && page.screenshot({ path: `${shotsDir}/pic-${String(++step).padStart(2, '0')}-${n}.png` });
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    await shot('FAIL-' + name.replace(/\W+/g, '-'));
    for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 300) => page.waitForTimeout(ms);
const picTab = () => page.getByRole('tab', { name: /Formato de imagen/ }).click();

/** a PNG as base64: white background with a red disc (and optionally noise) */
const makePng = (w, h, noisy = false) =>
  ev(([w, h, noisy]) => {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    if (noisy) for (let i = 0; i < 4000; i++) ((g.fillStyle = `rgb(${(i * 37) % 256},${(i * 91) % 256},${(i * 53) % 256})`), g.fillRect((i * 131) % w, (i * 71) % h, 6, 6));
    g.fillStyle = '#c81e1e';
    g.beginPath();
    g.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2);
    g.fill();
    return cv.toDataURL('image/png').split(',')[1];
  }, [w, h, noisy]);
const insertPng = async (b64, name = 'prueba.png') => {
  await ev(([b64, name]) => {
    const c = window.__novaSlides.ctl;
    c.select(c.slide.shapes.map((e) => e.id));
    c.deleteSelected();
    window.__novaSlides.ctl.emit('files', [new File([Uint8Array.from(atob(b64), (x) => x.charCodeAt(0))], name, { type: 'image/png' })]);
  }, [b64, name]);
  await page.waitForFunction(() => window.__novaSlides.ctl.slide.shapes.some((e) => e.kind === 'pic'));
  await settle();
};
/** decodes the asset of the first picture: size, corner alpha, centre colour */
const probe = () =>
  ev(async () => {
    const c = window.__novaSlides.ctl;
    const pic = c.slide.shapes.find((e) => e.kind === 'pic');
    const a = c.deck.assets[pic.src];
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([a.data], { type: a.mime }));
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    const at = (x, y) => [...g.getImageData(x, y, 1, 1).data];
    return { id: pic.src, mime: a.mime, bytes: a.data.length, w: cv.width, h: cv.height, corner: at(2, 2), centre: at(cv.width >> 1, cv.height >> 1), srcRect: pic.srcRect };
  });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');

await check('remove background: the corner turns transparent, the subject stays, one undo step', async () => {
  await insertPng(await makePng(300, 200));
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((e) => e.kind === 'pic').id]); });
  await settle();
  const before = await probe();
  assert.equal(before.corner[3], 255);
  await picTab();
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await settle(700);
  await shot('remove-bg-dialog');
  assert.match(await page.getByRole('dialog').innerText(), /Se quita el \d+ %/);
  await page.getByRole('dialog').getByRole('button', { name: 'Conservar los cambios' }).click();
  await settle(700);
  const after = await probe();
  assert.notEqual(after.id, before.id);
  assert.equal(after.corner[3], 0);
  assert.equal(after.centre[3], 255);
  assert.ok(after.centre[0] > 150 && after.centre[1] < 80, 'the disc keeps its red');
  await ev(() => window.__novaSlides.ctl.undo());
  assert.equal((await probe()).id, before.id);
  await ev(() => window.__novaSlides.ctl.redo());
});

await check('artistic effects: blur changes the pixels and keeps the size', async () => {
  await insertPng(await makePng(300, 200));
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((e) => e.kind === 'pic').id]); });
  const before = await probe();
  await picTab();
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await settle(350);
  await shot('artistic-menu');
  await page.getByRole('menuitemradio', { name: 'Mosaico' }).click();
  await settle(900);
  const after = await probe();
  assert.notEqual(after.id, before.id);
  assert.deepEqual([after.w, after.h], [before.w, before.h]);
});

await check('compress: fewer pixels, smaller file, cropped areas removed', async () => {
  await insertPng(await makePng(2400, 1600, true), 'grande.png');
  await ev(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); c.patch([p.id], 'recorte', (e) => ({ ...e, srcRect: { l: 10000, t: 0, r: 10000, b: 0 } })); c.select([p.id]); });
  const before = await probe();
  assert.equal(before.w, 2400);
  await picTab();
  await page.getByRole('button', { name: 'Comprimir imágenes…' }).click();
  await settle(400);
  await page.getByRole('dialog').getByLabel(/Correo electrónico/).check();
  await shot('compress-dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Comprimir', exact: true }).click();
  await page.waitForFunction(() => /comprimidas/.test(document.querySelector('[role=dialog]')?.textContent ?? ''));
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await settle();
  const after = await probe();
  assert.ok(Math.max(after.w, after.h) <= 960, `size ${after.w}x${after.h}`);
  assert.ok(after.bytes < before.bytes, `${after.bytes} < ${before.bytes}`);
  assert.equal(after.srcRect, undefined, 'the cropped-away part is gone');
});

await check('icons: search, pick and insert as a picture', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.select(c.slide.shapes.map((e) => e.id)); c.deleteSelected(); });
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Iconos…' }).click();
  await settle(900);
  await page.getByRole('dialog').getByLabel('Buscar icono').fill('corazon');
  await settle(300);
  await shot('icons-dialog');
  await page.getByRole('dialog').getByRole('listbox', { name: 'Iconos' }).getByRole('option', { name: /^Corazón/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Insertar', exact: true }).click();
  await settle(900);
  const p = await probe();
  assert.equal(p.mime, 'image/png');
  assert.equal(p.w, 256);
  assert.ok(p.bytes > 300);
});

await check('photo album: three pictures, two per slide, with captions', async () => {
  const slides0 = await ev(() => window.__novaSlides.ctl.deck.slides.length);
  await page.getByRole('button', { name: 'Álbum de fotografías…' }).click();
  await settle(400);
  const files = [];
  for (const [i, [w, h]] of [[400, 300], [300, 400], [500, 200]].entries()) files.push({ name: `foto${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(await makePng(w, h), 'base64') });
  await page.getByRole('dialog').getByLabel('Elegir imágenes').setInputFiles(files);
  await settle(300);
  await shot('album-dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Crear' }).click();
  await settle(1200);
  const info = await ev((n) => { const d = window.__novaSlides.ctl.deck; return { added: d.slides.length - n, pics: d.slides.flatMap((s) => s.shapes).filter((e) => e.kind === 'pic').length }; }, slides0);
  assert.equal(info.added, 2);
  assert.ok(info.pics >= 3);
  await shot('album-result');
});

await check('save as picture: a PNG file of the selection', async () => {
  await ev(() => window.__novaSlides.ctl.goTo(0));
  await insertPng(await makePng(300, 200));
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((e) => e.kind === 'pic').id]); });
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  const dl = page.waitForEvent('download', { timeout: 15000 });
  await ev(() => document.dispatchEvent(new Event('x')));
  await page.getByRole('button', { name: 'Organizar' }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: 'Guardar como imagen…' }).click();
  const file = await dl;
  const path = await file.path();
  const bytes = fs.readFileSync(path);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.ok(bytes.length > 500);
});

await check('screenshot: asks for a screen and either inserts it or says why not', async () => {
  const n0 = await ev(() => window.__novaSlides.ctl.slide.shapes.length);
  // a fake screen: a canvas stream instead of the system picker (which cannot be driven from a test)
  await ev(() => {
    const cv = document.createElement('canvas');
    cv.width = 320;
    cv.height = 200;
    const g = cv.getContext('2d');
    setInterval(() => ((g.fillStyle = '#2a6'), g.fillRect(0, 0, 320, 200)), 30);
    navigator.mediaDevices.getDisplayMedia = async () => cv.captureStream(15);
  });
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Captura de pantalla' }).click();
  await settle(2500);
  const info = await ev((n) => ({ n: window.__novaSlides.ctl.slide.shapes.length - n, msg: window.__novaSlides.ctl.message }), n0);
  assert.equal(info.n, 1, JSON.stringify(info));
  const w = await ev(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic' && e.descr?.includes('Captura')); return p ? c.deck.assets[p.src].mime : null; });
  assert.equal(w, 'image/png');
});


const picEdits = () => ev(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); return { src: p.src, orig: p.orig ?? null, edits: p.edits ?? null, adjust: p.adjust ?? null, geom: p.geom ?? null, ln: p.ln ?? null, effects: p.effects ? Object.keys(p.effects) : null, srcRect: p.srcRect ?? null, xfrm: p.xfrm }; });
const selectPic = () => ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((e) => e.kind === 'pic').id]); });

await check('reversible: an artistic effect keeps the original, can be changed in intensity, and «Restablecer imagen» brings the original back', async () => {
  await insertPng(await makePng(300, 200));
  await selectPic();
  const before = await probe();
  await picTab();
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await settle(300);
  await page.getByRole('menuitemradio', { name: 'Mosaico' }).click();
  await settle(900);
  const a = await picEdits();
  assert.equal(a.orig, before.id, 'the original is kept');
  assert.notEqual(a.src, before.id);
  assert.deepEqual(a.edits, { artistic: { id: 'mosaic', level: 50 } });
  // the dialog changes the intensity: the picture is made again from the original
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitem', { name: /Opciones de efectos artísticos/ }).click();
  await settle(500);
  await shot('format-artistic');
  await page.getByRole('dialog').getByRole('slider', { name: 'Intensidad' }).fill('80');
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar' }).click();
  await settle(900);
  const b = await picEdits();
  assert.equal(b.orig, before.id);
  assert.deepEqual(b.edits, { artistic: { id: 'mosaic', level: 80 } });
  assert.notEqual(b.src, a.src);
  // taking the effect off goes back to the original image itself
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitemradio', { name: 'Ninguno' }).click();
  await settle(700);
  const c = await picEdits();
  assert.equal(c.src, before.id);
  assert.equal(c.orig, null);
  // and «Restablecer imagen» also works after several edits
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitemradio', { name: 'Desenfoque' }).click();
  await settle(700);
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await settle(500);
  const d = await picEdits();
  assert.equal(d.src, before.id);
  assert.equal(d.edits, null);
});

await check('Formato de imagen: sharpness, saturation and transparency in one dialog; brightness stays native for PowerPoint', async () => {
  await insertPng(await makePng(300, 200));
  await selectPic();
  const before = await probe();
  await picTab();
  await page.getByRole('button', { name: 'Correcciones', exact: true }).click();
  await page.getByRole('menuitem', { name: /Opciones de color de imagen/ }).click();
  await settle(500);
  await page.getByRole('dialog').getByRole('slider', { name: 'Saturación' }).fill('0');
  await page.getByRole('dialog').getByRole('slider', { name: 'Transparencia' }).fill('30');
  await shot('format-color');
  await page.getByRole('dialog').getByRole('tab', { name: 'Correcciones' }).click();
  await page.getByRole('dialog').getByRole('slider', { name: 'Brillo' }).fill('20');
  await page.getByRole('dialog').getByRole('button', { name: 'Aceptar' }).click();
  await settle(900);
  const a = await picEdits();
  assert.deepEqual(a.edits, { saturation: 0 }, 'only what PowerPoint cannot do goes into the pixels');
  assert.deepEqual(a.adjust, { bright: 20, alpha: 70 });
  assert.equal(a.orig, before.id);
  const p = await probe();
  // the red disc is grey now
  assert.ok(Math.abs(p.centre[0] - p.centre[1]) < 3 && Math.abs(p.centre[1] - p.centre[2]) < 3, `centre ${p.centre}`);
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await settle(500);
  const r = await picEdits();
  assert.deepEqual([r.src, r.edits, r.adjust], [before.id, null, null]);
});

await check('remove background with marks: a region marked to remove goes, the marks are kept with the picture and can be discarded', async () => {
  await insertPng(await makePng(300, 200));
  await selectPic();
  const before = await probe();
  await picTab();
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await settle(700);
  await page.getByRole('dialog').getByRole('radio', { name: 'Marcar áreas para quitar' }).check();
  // a click on the red disc marks it to be removed
  const box = await page.getByRole('dialog').getByLabel('Vista previa').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await settle(300);
  assert.match(await page.getByRole('dialog').innerText(), /Marcas: 0 para mantener, 1 para quitar/);
  await shot('remove-bg-marks');
  await page.getByRole('dialog').getByRole('button', { name: 'Conservar los cambios' }).click();
  await settle(900);
  const a = await picEdits();
  assert.equal(a.orig, before.id);
  assert.equal(a.edits.background.remove.length, 1);
  const p = await probe();
  assert.equal(p.centre[3], 0, 'the marked disc was removed');
  assert.equal(p.corner[3], 0, 'and so was the background');
  // reopening the dialog shows the same marks; discarding brings the picture back
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await settle(700);
  assert.match(await page.getByRole('dialog').innerText(), /1 para quitar/);
  await page.getByRole('dialog').getByRole('button', { name: 'Descartar todos los cambios' }).click();
  await settle(700);
  const d = await picEdits();
  assert.equal(d.src, before.id);
  assert.equal(d.edits, null);
});

await check('picture styles and aspect ratio: a style sets shape, border and effects; 16:9 crops and keeps the image in place', async () => {
  await insertPng(await makePng(300, 200));
  await selectPic();
  const b = await picEdits();
  await picTab();
  await page.getByRole('button', { name: 'Estilos de imagen' }).click();
  await settle(300);
  await shot('styles-gallery');
  await page.getByRole('menuitem', { name: 'Redondeado con marco blanco' }).click();
  await settle(400);
  const s = await picEdits();
  assert.deepEqual(s.geom, { prst: 'roundRect' });
  assert.equal(s.ln.w, 6);
  assert.ok(s.effects.includes('outer'));
  await page.getByRole('button', { name: 'Relación de aspecto' }).click();
  await page.getByRole('menuitem', { name: 'Horizontal 16:9' }).click();
  await settle(400);
  const a = await picEdits();
  assert.ok(a.srcRect, 'cropped');
  assert.ok(Math.abs(a.xfrm.w / a.xfrm.h - 16 / 9) < 0.02, `${a.xfrm.w}x${a.xfrm.h}`);
  assert.deepEqual(a.geom, { prst: 'roundRect' }, 'the style stays');
  // choosing another style keeps the crop
  await page.getByRole('button', { name: 'Estilos de imagen' }).click();
  await page.getByRole('menuitem', { name: 'Sin estilo' }).click();
  await settle(300);
  const n = await picEdits();
  assert.equal(n.geom, null);
  assert.deepEqual(n.srcRect, a.srcRect);
  void b;
});

await check('edits survive saving and opening: the original comes back, the picture can still be changed', async () => {
  await insertPng(await makePng(300, 200));
  await selectPic();
  const before = await probe();
  await picTab();
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitemradio', { name: 'Desenfoque' }).click();
  await settle(900);
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle(700);
  const a = await picEdits();
  assert.deepEqual(a.edits, { artistic: { id: 'blur', level: 50 } });
  assert.ok(a.orig && a.orig !== a.src);
  const origSize = await ev(() => { const c = window.__novaSlides.ctl; return c.deck.assets[c.slide.shapes.find((e) => e.kind === 'pic').orig].data.length; });
  assert.equal(origSize, before.bytes, 'the original is byte for byte the one inserted');
  await selectPic();
  await picTab();
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await settle(500);
  const r = await picEdits();
  assert.equal(r.edits, null);
});

await check('compress an edited picture: the original is shrunk and the picture made again, so it stays changeable', async () => {
  await insertPng(await makePng(2400, 1600, true), 'enorme.png');
  await selectPic();
  await picTab();
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitemradio', { name: 'Carteles (pocos colores)' }).click();
  await settle(2500);
  const before = await picEdits();
  await page.getByRole('button', { name: 'Comprimir imágenes…' }).click();
  await settle(400);
  await page.getByRole('dialog').getByLabel(/Correo electrónico/).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Comprimir', exact: true }).click();
  await page.waitForFunction(() => /comprimidas/.test(document.querySelector('[role=dialog]')?.textContent ?? ''), null, { timeout: 30000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await settle(900);
  const after = await picEdits();
  assert.notEqual(after.orig, before.orig, 'a smaller original');
  assert.deepEqual(after.edits, before.edits, 'the effect is still there');
  const size = await ev(() => { const c = window.__novaSlides.ctl; const p = c.slide.shapes.find((e) => e.kind === 'pic'); const a = c.deck.assets[p.orig]; return a.data.length; });
  assert.ok(size < 800000, `original ${size} bytes`);
});

await check('saved and reopened: the processed pictures survive', async () => {
  await ev(() => window.__novaSlides.ctl.goTo(0));
  await insertPng(await makePng(300, 200));
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((e) => e.kind === 'pic').id]); });
  await picTab();
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await settle(700);
  await page.getByRole('dialog').getByRole('button', { name: 'Conservar los cambios' }).click();
  await settle(700);
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle(600);
  const p = await probe();
  assert.equal(p.corner[3], 0);
});

await check('no console errors', async () => assert.deepEqual(errors, []));
await browser.close();
let failed = 0;
for (const [s, n, m] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${m ? '\n    ' + m : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
