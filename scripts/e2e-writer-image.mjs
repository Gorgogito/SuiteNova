// End-to-end checks for the picture tools of Nova Writer: format dialog, rotate, flip, crop, wrapping.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-writer-image.mjs [--shots dir]
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
const info = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  if (/^Se marcaron|^Los dos documentos|^Hay cambios sin guardar/.test(d.message())) {
    info.push(d.message());
    d.accept().catch(() => {});
  } else {
    errors.push(`dialog: ${d.message()}`);
    d.dismiss().catch(() => {});
  }
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
const ev = (fn, arg) => page.evaluate(fn, arg);
const editor = page.locator('.ProseMirror').first();
const dialog = () => page.getByRole('dialog');
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const ok = async () => {
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(500);
};
const cmd = async (label) => {
  const b = page.getByRole('button', { name: label, exact: true }).first();
  if (await b.isVisible().catch(() => false)) await b.click();
  else {
    await page.getByRole('button', { name: 'Documento', exact: true }).first().click();
    await page.getByRole('menuitem', { name: label }).click();
  }
  await page.waitForTimeout(500);
};
const closeDlg = async (name = 'Cerrar') => {
  await dialog().getByRole('button', { name }).click();
  await page.waitForTimeout(600);
};


const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
await editor.click();
await page.keyboard.type('Texto antes de la imagen y texto después para ver el ajuste alrededor de la figura.');
await ev((src) => {
  const { ctl } = window.__novaWriter;
  const v = ctl.mainView;
  const s = v.state.schema;
  const img = s.nodes.image.create({ src, alt: '', width: 160, height: 100 });
  let pos = null;
  v.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph' && pos === null) pos = p + 1; });
  v.dispatch(v.state.tr.insert(pos, img));
}, PNG);
const selectImage = () => ev(() => {
  const v = window.__novaWriter.ctl.mainView;
  let pos = null;
  v.state.doc.descendants((n, p) => { if (n.type.name === 'image' && pos === null) pos = p; });
  const { NodeSelection } = window.__novaWriter.pm ?? {};
  const sel = v.state.selection.constructor.create ? null : null;
  v.dom.querySelector('img.nw-image, .nw-imgbox img')?.click();
  return pos;
});
const imageAttrs = () => ev(() => { let a = null; window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'image' && !a) a = n.attrs; }); return a; });
const clickImage = async () => {
  await page.locator('.ProseMirror img.nw-image').first().click();
  await page.waitForTimeout(400);
};

await check('al seleccionar una imagen aparece la pestaña «Formato de imagen»', async () => {
  await clickImage();
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await shot('pestana');
});

await check('girar a la derecha y voltear cambian la imagen y se pueden deshacer', async () => {
  await page.getByRole('button', { name: 'Girar a la derecha' }).click();
  await page.getByRole('button', { name: 'Voltear horizontalmente' }).click();
  await page.waitForTimeout(300);
  assert.deepEqual([(await imageAttrs()).rotate, (await imageAttrs()).flipH], [90, true]);
  const css = await page.locator('.ProseMirror img.nw-image').first().getAttribute('style');
  assert.match(css, /rotate\(90deg\) scaleX\(-1\)/);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  assert.equal((await imageAttrs()).rotate, 0);
  await clickImage();
});

await check('el diálogo cambia texto alternativo, recorte, borde y ajuste; el recorte conserva la escala', async () => {
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await page.getByRole('button', { name: 'Formato de imagen…' }).click();
  await page.waitForTimeout(400);
  await dialog().getByLabel('Texto alternativo').fill('Figura de prueba');
  await dialog().getByLabel('Izquierda').fill('25');
  await dialog().getByLabel('Derecha').fill('25');
  await dialog().getByLabel('Ajuste del texto').selectOption('left');
  await dialog().getByRole('checkbox', { name: 'Borde' }).check();
  await shot('dialogo');
  await ok();
  const a = await imageAttrs();
  assert.equal(a.alt, 'Figura de prueba');
  assert.deepEqual(a.crop, { l: 0.25, t: 0, r: 0.25, b: 0 });
  assert.equal(a.width, 80); // 160 × (1 − 0.5): no se estira
  assert.equal(a.height, 100);
  assert.equal(a.wrap, 'left');
  assert.deepEqual(a.border, { color: '#000000', width: 1 });
  // recortada: caja con overflow oculto y la imagen entera dentro
  const box = await page.locator('.ProseMirror .nw-imgbox').first().evaluate((el) => ({ w: el.getBoundingClientRect().width, float: getComputedStyle(el).cssFloat, overflow: getComputedStyle(el).overflow }));
  assert.equal(Math.round(box.w), 80);
  assert.equal(box.float, 'left');
  assert.equal(box.overflow, 'hidden');
  await shot('recortada');
});

await check('todo sobrevive a guardar y volver a leer el .docx', async () => {
  const back = await ev(async (src) => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    let a = null;
    d.body.descendants((n) => { if (n.type.name === 'image' && !a) a = n.attrs; });
    return { alt: a.alt, crop: a.crop, wrap: a.wrap, border: a.border, width: a.width, height: a.height };
  });
  assert.deepEqual(back, { alt: 'Figura de prueba', crop: { l: 0.25, t: 0, r: 0.25, b: 0 }, wrap: 'left', border: { color: '#000000', width: 1 }, width: 80, height: 100 });
});

await check('«Restablecer imagen» quita recorte, borde y ajuste y devuelve el tamaño completo', async () => {
  await page.locator('.ProseMirror .nw-imgbox').first().click();
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await page.waitForTimeout(300);
  const a = await imageAttrs();
  assert.deepEqual([a.crop, a.border, a.wrap, a.width, a.height], [null, null, null, 160, 100]);
});


// ---- shared picture tools (image-core): reversible effects, colour, background, aspect ratio, .docx
const rich = () => ev(() => { let a = null; window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.alt === 'rica') a = n.attrs; }); return a && { src: a.src.length, srcHead: a.src.slice(0, 40), orig: a.orig ? a.orig.length : null, edits: a.edits, crop: a.crop, width: a.width, height: a.height }; });
const centre = () => ev(async () => {
  let src = null;
  window.__novaWriter.ctl.state.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.alt === 'rica') src = n.attrs.src; });
  const im = new Image(); im.src = src; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  return [...g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data];
});
const pickRich = async () => {
  await page.locator('.ProseMirror img[alt="rica"]').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
};
await ev(async () => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#e02020'; g.beginPath(); g.arc(150, 100, 60, 0, 7); g.fill();
  const v = window.__novaWriter.ctl.mainView;
  let pos = null;
  v.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph' && pos === null) pos = p + 1; });
  v.dispatch(v.state.tr.insert(pos, v.state.schema.nodes.image.create({ src: c.toDataURL('image/png'), alt: 'rica', width: 300, height: 200 })));
});

await check('efecto artístico reversible: guarda el original, el efecto se cambia de intensidad y «Restablecer imagen» lo devuelve', async () => {
  await pickRich();
  const before = await rich();
  assert.equal(before.orig, null);
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitemradio', { name: 'Mosaico' }).click();
  await page.waitForTimeout(900);
  const a = await rich();
  assert.ok(a.orig, 'se guardó el original');
  assert.equal(a.orig, before.src);
  assert.deepEqual(a.edits, { artistic: { id: 'mosaic', level: 50 } });
  await shot('efecto');
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitem', { name: /Opciones de efectos artísticos/ }).click();
  await page.waitForTimeout(500);
  await dialog().getByRole('slider', { name: 'Intensidad' }).fill('80');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(900);
  assert.deepEqual((await rich()).edits, { artistic: { id: 'mosaic', level: 80 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  assert.equal((await rich()).edits.artistic.level, 50, 'un solo paso de deshacer por cambio');
  await pickRich();
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await page.waitForTimeout(500);
  const r = await rich();
  assert.deepEqual([r.orig, r.edits, r.src], [null, null, before.src]);
});

await check('color: la saturación a cero deja la imagen en grises y el original sigue ahí', async () => {
  await pickRich();
  await page.getByRole('button', { name: 'Correcciones' }).click();
  await page.getByRole('menuitem', { name: /Opciones de color de imagen/ }).click();
  await page.waitForTimeout(500);
  await dialog().getByRole('tab', { name: 'Color' }).click();
  await dialog().getByRole('slider', { name: 'Saturación' }).fill('0');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(900);
  const a = await rich();
  assert.deepEqual(a.edits, { saturation: 0 });
  const [r, g, b] = await centre();
  assert.ok(Math.abs(r - g) < 4 && Math.abs(g - b) < 4, `centro ${r},${g},${b}`);
  await page.getByRole('button', { name: 'Restablecer imagen' }).click();
  await page.waitForTimeout(500);
  assert.equal((await rich()).edits, null);
});

await check('quitar fondo con una zona marcada: las marcas se guardan y se pueden descartar', async () => {
  await pickRich();
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await page.waitForTimeout(700);
  await dialog().getByRole('radio', { name: 'Marcar áreas para quitar' }).check();
  const box = await dialog().getByLabel('Vista previa').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  await dialog().getByRole('button', { name: 'Conservar los cambios' }).click();
  await page.waitForTimeout(900);
  const a = await rich();
  assert.equal(a.edits.background.remove.length, 1);
  const c = await centre();
  assert.equal(c[3], 0, 'el disco marcado se quitó');
  await page.getByRole('button', { name: 'Quitar fondo…' }).click();
  await page.waitForTimeout(700);
  await dialog().getByRole('button', { name: 'Descartar todos los cambios' }).click();
  await page.waitForTimeout(700);
  assert.equal((await rich()).edits, null);
});

await check('relación de aspecto 16:9 recorta y deja el tamaño visible con esa proporción', async () => {
  await pickRich();
  await page.getByRole('button', { name: 'Relación de aspecto' }).click();
  await page.getByRole('menuitem', { name: 'Horizontal 16:9' }).click();
  await page.waitForTimeout(500);
  const a = await rich();
  assert.ok(a.crop, 'recortada');
  assert.ok(Math.abs(a.width / a.height - 16 / 9) < 0.03, `${a.width}x${a.height}`);
});

await check('guardar y abrir el .docx devuelve el original y las ediciones; Word ve la imagen ya editada', async () => {
  await pickRich();
  await page.getByRole('button', { name: 'Efectos artísticos' }).click();
  await page.getByRole('menuitemradio', { name: 'Desenfoque' }).click();
  await page.waitForTimeout(900);
  const before = await rich();
  const back = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    let a = null;
    d.body.descendants((n) => { if (n.type.name === 'image' && n.attrs.alt === 'rica') a = n.attrs; });
    return a && { edits: a.edits, orig: a.orig ? a.orig.length : null, src: a.src.length };
  });
  assert.deepEqual(back.edits, { artistic: { id: 'blur', level: 50 } });
  assert.equal(back.orig, before.orig);
  assert.equal(back.src, before.src);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
