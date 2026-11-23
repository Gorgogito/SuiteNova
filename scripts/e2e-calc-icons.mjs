// End-to-end checks for icons in Nova Calc: the shared gallery, the SVG with its PNG, fill, outline, styles, the shadow and what goes in the .xlsx.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-calc-icons.mjs [--shots dir] [--out file.xlsx]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 2100, height: 950 } })).newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaCalc);
await page.waitForTimeout(800);
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
    for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) await page.keyboard.press('Escape');
  }
};
const ev = (f, a) => page.evaluate(f, a);
const settle = (ms = 500) => page.waitForTimeout(ms);
const icons = () =>
  ev(() => {
    const d = window.__novaCalc.doc;
    return d.sheet.images
      .filter((i) => i.svg)
      .map((i) => {
        const s = new TextDecoder().decode(d.wb.media.get(i.svg).data);
        const root = /<svg[^>]*>/.exec(s)?.[0] ?? '';
        return { id: i.id, alt: i.alt, w: i.width, fill: /fill="([^"]*)"/.exec(root)?.[1], opacity: /fill-opacity="([^"]*)"/.exec(root)?.[1] ?? null, stroke: /stroke="([^"]*)"/.exec(root)?.[1] ?? null, sw: /stroke-width="([^"]*)"/.exec(root)?.[1] ?? null, pngMime: d.wb.media.get(i.media).mime, png: d.wb.media.get(i.media).data.length, svgMime: d.wb.media.get(i.svg).mime, media: i.media, shadow: i.shadow ?? null };
      });
  });
const menu = async (label, pick) => {
  await page.getByRole('button', { name: label, exact: true }).click();
  await pick(page.getByRole('menu', { name: label }));
  await settle(700);
};
const selectIcon = async () => {
  await ev(() => { const d = window.__novaCalc.doc; d.x.selectObject('image', d.sheet.images.find((i) => i.svg).id); });
  await settle(300);
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
};

await check('Insertar › Iconos abre la galería compartida e inserta el icono elegido: un PNG con su SVG, con su nombre como texto alternativo', async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: /Iconos/ }).first().click();
  const d = page.getByRole('dialog', { name: 'Iconos' });
  await d.waitFor();
  await d.getByLabel('Buscar icono').fill('calendario');
  await settle(300);
  await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option').first().click();
  await shot('galeria');
  await d.getByRole('button', { name: 'Insertar', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await settle(700);
  const list = await icons();
  assert.equal(list.length, 1);
  assert.equal(list[0].pngMime, 'image/png');
  assert.equal(list[0].svgMime, 'image/svg+xml');
  assert.ok(list[0].png > 300);
  assert.match(list[0].alt, /Calendario/);
  assert.equal(list[0].w, 64);
});

await check('el icono se dibuja en la hoja con su SVG', async () => {
  const mime = await ev(async () => { const el = document.querySelector('.calc-objects img, .calc-grid img, img[draggable="false"]'); return el ? (await (await fetch(el.src)).blob()).type : ''; });
  assert.equal(mime, 'image/svg+xml');
});

await check('al elegirlo aparece Formato de imagen con el grupo Gráficos', async () => {
  await selectIcon();
  for (const n of ['Estilos de gráfico', 'Relleno de gráfico', 'Contorno de gráfico', 'Efectos de gráfico']) assert.ok(await page.getByRole('button', { name: n, exact: true }).isEnabled(), n);
  await shot('formato-imagen');
});

await check('relleno: un color cambia el SVG y rehace el PNG', async () => {
  const before = (await icons())[0];
  await menu('Relleno de gráfico', (m) => m.getByRole('button', { name: 'Rojo', exact: true }).click());
  const a = (await icons())[0];
  assert.equal(a.fill, '#ff0000');
  assert.notEqual(a.media, before.media);
  assert.ok(a.png > 500);
});

await check('contorno, transparencia y sin relleno', async () => {
  await selectIcon();
  await menu('Contorno de gráfico', (m) => m.getByRole('button', { name: 'Azul', exact: true }).click());
  await selectIcon();
  await menu('Contorno de gráfico', (m) => m.getByRole('menuitemradio', { name: '2 pt' }).click());
  let a = (await icons())[0];
  assert.equal(a.stroke, '#0070c0');
  assert.equal(a.sw, '2');
  await selectIcon();
  await menu('Relleno de gráfico', (m) => m.getByRole('menuitemradio', { name: '50 %' }).click());
  assert.equal((await icons())[0].opacity, '0.5');
  await selectIcon();
  await menu('Relleno de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Sin relleno' }).click());
  a = (await icons())[0];
  assert.equal(a.fill, 'none');
  assert.equal(a.stroke, '#0070c0');
  await shot('contorno');
});

await check('sombra desde Efectos de gráfico (sin resplandor: Calc no lo dibuja) y los estilos sin el del resplandor', async () => {
  await selectIcon();
  await page.getByRole('button', { name: 'Efectos de gráfico', exact: true }).click();
  const m = page.getByRole('menu', { name: 'Efectos de gráfico' });
  assert.equal(await m.getByText('Resplandor', { exact: true }).count(), 0, 'sin resplandor');
  await m.getByRole('menuitemradio', { name: 'Exterior, abajo a la derecha' }).click();
  await settle(500);
  assert.deepEqual((await icons())[0].shadow, { color: '#000000', blur: 4, dist: 3, angle: 45, alpha: 0.4 });
  await selectIcon();
  await page.getByRole('button', { name: 'Estilos de gráfico', exact: true }).click();
  const s = page.getByRole('menu', { name: 'Estilos de gráfico' });
  assert.equal(await s.getByRole('menuitem', { name: 'Con resplandor', exact: true }).count(), 0);
  await s.getByRole('menuitem', { name: 'Azul sólido', exact: true }).click();
  await settle(600);
  const a = (await icons())[0];
  assert.equal(a.fill, '#1f4e79');
  assert.equal(a.shadow, null, 'el estilo quita la sombra anterior');
  await shot('estilo');
});

await check('deshacer devuelve el aspecto anterior', async () => {
  const before = (await icons())[0];
  await ev(() => window.__novaCalc.doc.undo());
  await settle(400);
  const a = (await icons())[0];
  assert.notEqual(a.fill, before.fill);
  assert.equal(a.fill, 'none');
});

await check('el .xlsx guarda cada icono como Excel (PNG con el SVG colgado) y al abrirlo vuelve el SVG con su PNG y su aspecto', async () => {
  const r = await ev(async () => {
    const { readXlsx, writeXlsx } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/xlsx-io/src/index.ts');
    const d = window.__novaCalc.doc;
    const bytes = await writeXlsx(d.wb);
    const back = await readXlsx(bytes);
    const im = back.workbook.sheets[0].images.find((i) => i.svg);
    const svg = new TextDecoder().decode(back.workbook.media.get(im.svg).data);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return { svg: /<svg[^>]*>/.exec(svg)[0], png: back.workbook.media.get(im.media).mime, alt: im.alt, b64: btoa(bin) };
  });
  assert.match(r.svg, /fill="none"/);
  assert.match(r.svg, /stroke="#0070c0"/);
  assert.equal(r.png, 'image/png');
  assert.match(r.alt, /Calendario/);
  if (outFile) fs.writeFileSync(outFile, Buffer.from(r.b64, 'base64'));
});

await check('una imagen que no es un icono no puede usar el grupo Gráficos (falta o está deshabilitado)', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    d.x.insertImage('image/png', png, 40, 40, 'foto');
  });
  await settle(400);
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  for (const n of ['Relleno de gráfico', 'Estilos de gráfico']) {
    const b = page.getByRole('button', { name: n, exact: true });
    assert.ok((await b.count()) === 0 || !(await b.first().isEnabled()), `${n}: debe faltar o estar deshabilitado`);
  }
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
