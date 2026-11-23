// End-to-end checks for the icon gallery in Nova Writer: Insert › Icons, categories, search in Spanish and English, several icons at once, line or
// filled, colour, and how they go in the .docx (PNG with the SVG hanging from it). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-icons.mjs [--shots dir] [--out file.docx]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
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
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const dlg = () => page.getByRole('dialog', { name: 'Iconos' });
const images = () =>
  ev(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'image') out.push({ src: n.attrs.src.slice(0, 40), svg: decodeURIComponent(n.attrs.src.split(',')[1] ?? ''), png: (n.attrs.png ?? '').slice(0, 22), alt: n.attrs.alt, w: n.attrs.width, h: n.attrs.height });
    });
    return out;
  });
const open = async () => {
  await page.locator('.ProseMirror').first().click();
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: /Iconos/ }).first().click();
  await dlg().waitFor();
  await page.getByRole('option', { name: /./ }).first().waitFor();
};

await check('Insertar › Iconos abre la galería con categorías y miles de iconos', async () => {
  await open();
  const cats = await dlg().getByRole('listbox', { name: 'Categorías' }).getByRole('option').count();
  assert.ok(cats >= 18, `categorías: ${cats}`);
  assert.match(await dlg().innerText(), /2649 iconos/);
  await shot('galeria');
});

await check('buscar en español y en inglés, sin tildes', async () => {
  const q = dlg().getByLabel('Buscar icono');
  await q.fill('camara');
  await page.waitForTimeout(200);
  const names = await dlg().getByRole('listbox', { name: 'Iconos' }).getByRole('option').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  assert.ok(names.length > 3 && names.every((n) => /cámara/i.test(n)), names.join(','));
  await q.fill('calendar');
  await page.waitForTimeout(200);
  assert.ok((await dlg().getByRole('listbox', { name: 'Iconos' }).getByRole('option').count()) > 5);
  await q.fill('zzzxq');
  await page.waitForTimeout(200);
  assert.match(await dlg().innerText(), /Ningún icono coincide/);
  await q.fill('');
});

await check('una categoría reduce la lista', async () => {
  await dlg().getByRole('listbox', { name: 'Categorías' }).getByRole('option', { name: /^Seguridad/ }).getByRole('button').click();
  await page.waitForTimeout(200);
  const n = await dlg().getByRole('listbox', { name: 'Iconos' }).getByRole('option').count();
  assert.ok(n > 20 && n < 100, `seguridad: ${n}`);
  await dlg().getByRole('listbox', { name: 'Categorías' }).getByRole('option', { name: /^Todos/ }).getByRole('button').click();
});

await check('elegir dos iconos (relleno, color propio) y insertarlos juntos: cada uno es un SVG con su PNG y su nombre como texto alternativo', async () => {
  await dlg().getByLabel('Buscar icono').fill('calendario');
  await page.waitForTimeout(200);
  await dlg().getByRole('radio', { name: 'Relleno' }).click();
  await dlg().getByLabel('Color del icono').fill('#c00000');
  const opts = dlg().getByRole('listbox', { name: 'Iconos' }).getByRole('option');
  await opts.nth(0).click();
  await opts.nth(1).click();
  assert.match(await dlg().innerText(), /2 seleccionados/);
  await shot('dos-elegidos');
  await dlg().getByRole('button', { name: 'Insertar (2)' }).click();
  await dlg().waitFor({ state: 'detached' });
  const imgs = await images();
  assert.equal(imgs.length, 2);
  for (const i of imgs) {
    assert.match(i.src, /^data:image\/svg\+xml/);
    assert.match(i.svg, /fill="#c00000"/);
    assert.match(i.png, /^data:image\/png;base64,/);
    assert.match(i.alt, /Calendario/);
    assert.equal(i.w, 64);
    assert.equal(i.h, 64);
  }
  assert.notEqual(imgs[0].alt, imgs[1].alt);
  await shot('insertados');
});

await check('el icono se ve en la página (el SVG se dibuja, con el color elegido)', async () => {
  const px = await ev(async () => {
    const el = document.querySelector('.ProseMirror img.nw-image');
    await el.decode();
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.drawImage(el, 0, 0, 64, 64);
    const d = c.getImageData(0, 0, 64, 64).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 150 && d[i + 1] < 40) red++;
    return red;
  });
  assert.ok(px > 200, `píxeles rojos: ${px}`);
});

await check('al guardar el .docx: PNG de imagen y SVG colgado (asvg:svgBlip); al leerlo vuelve el SVG con su PNG', async () => {
  const r = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const back = (await w.docx.readDocx(data)).doc;
    const imgs = [];
    back.body.descendants((n) => { if (n.type.name === 'image') imgs.push({ src: n.attrs.src.slice(0, 26), png: (n.attrs.png ?? '').slice(0, 22), alt: n.attrs.alt, w: n.attrs.width }); });
    let bin = '';
    for (const b of data) bin += String.fromCharCode(b);
    return { imgs, b64: btoa(bin) };
  });
  assert.equal(r.imgs.length, 2);
  for (const i of r.imgs) {
    assert.equal(i.src, 'data:image/svg+xml;base64,');
    assert.match(i.png, /^data:image\/png;base64,/);
    assert.match(i.alt, /Calendario/);
    assert.equal(i.w, 64);
  }
  if (outFile) fs.writeFileSync(outFile, Buffer.from(r.b64, 'base64'));
});

await check('Esc cierra la galería sin insertar nada más', async () => {
  const before = (await images()).length;
  await open();
  await page.keyboard.press('Escape');
  await dlg().waitFor({ state: 'detached' });
  assert.equal((await images()).length, before);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
