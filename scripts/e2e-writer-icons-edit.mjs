// End-to-end checks for editing an icon in Nova Writer (Format Graphics): fill, outline, transparency, shadow, glow, styles, rotate, undo, and what
// goes in the .docx. Needs `pnpm dev` on :1420. Usage: node scripts/e2e-writer-icons-edit.mjs [--shots dir] [--out file.docx]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
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
const first = () =>
  ev(() => {
    let a = null;
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => { if (n.type.name === 'image' && !a) a = { ...n.attrs }; });
    if (!a) return null;
    const svg = decodeURIComponent(a.src.split(',')[1] ?? '');
    const root = /<svg[^>]*>/.exec(svg)?.[0] ?? '';
    return { fill: /fill="([^"]*)"/.exec(root)?.[1], opacity: /fill-opacity="([^"]*)"/.exec(root)?.[1] ?? null, stroke: /stroke="([^"]*)"/.exec(root)?.[1] ?? null, sw: /stroke-width="([^"]*)"/.exec(root)?.[1] ?? null, png: (a.png ?? '').length, fx: a.fx, rotate: a.rotate, alt: a.alt };
  });
const selectIcon = async () => {
  await page.locator('.ProseMirror img.nw-image').first().click();
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
};
const pop = async (label, item) => {
  await page.getByRole('button', { name: label, exact: true }).click();
  const m = page.getByRole('menu', { name: label });
  await m.waitFor();
  await item(m);
  await page.waitForTimeout(500);
};
const pickColor = (name) => async (m) => m.getByRole('button', { name, exact: true }).click();

await check('se inserta un icono y al seleccionarlo aparece Formato de imagen con el grupo Gráficos', async () => {
  await page.locator('.ProseMirror').first().click();
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: /Iconos/ }).first().click();
  const d = page.getByRole('dialog', { name: 'Iconos' });
  await d.getByLabel('Buscar icono').fill('estrella');
  await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option').first().click();
  await d.getByRole('button', { name: 'Insertar', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await selectIcon();
  for (const n of ['Estilos de gráfico', 'Relleno de gráfico', 'Contorno de gráfico', 'Efectos de gráfico']) assert.ok(await page.getByRole('button', { name: n, exact: true }).isEnabled(), n);
  await shot('grupo-graficos');
});

await check('relleno: un color cambia el SVG y rehace el PNG de respaldo', async () => {
  const before = await first();
  await pop('Relleno de gráfico', pickColor('Rojo'));
  const a = await first();
  assert.equal(a.fill, '#ff0000');
  assert.notEqual(a.png, before.png);
  assert.ok(a.png > 500);
  await shot('relleno-rojo');
});

await check('transparencia 50 % y sin relleno', async () => {
  await selectIcon();
  await pop('Relleno de gráfico', (m) => m.getByRole('menuitemradio', { name: '50 %' }).click());
  assert.equal((await first()).opacity, '0.5');
  await selectIcon();
  await pop('Relleno de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Sin relleno' }).click());
  assert.equal((await first()).fill, 'none');
});

await check('contorno: color y grosor; el relleno no cambia', async () => {
  await selectIcon();
  await pop('Contorno de gráfico', pickColor('Azul'));
  let a = await first();
  assert.equal(a.stroke, '#0070c0');
  await selectIcon();
  await pop('Contorno de gráfico', (m) => m.getByRole('menuitemradio', { name: '2 pt' }).click());
  a = await first();
  assert.equal(a.sw, '2');
  assert.equal(a.fill, 'none');
  await shot('contorno');
  await selectIcon();
  await pop('Contorno de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Sin contorno' }).click());
  assert.equal((await first()).stroke, null);
});

await check('sombra y resplandor se guardan en la imagen y se dibujan (filter)', async () => {
  await selectIcon();
  await pop('Relleno de gráfico', pickColor('Verde'));
  await selectIcon();
  await pop('Efectos de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Exterior, abajo a la derecha' }).click());
  let a = await first();
  assert.deepEqual(a.fx.shadow, { color: '#000000', blur: 4, dist: 3, angle: 45, alpha: 0.4 });
  await selectIcon();
  await pop('Efectos de gráfico', (m) => m.getByRole('menuitemradio', { name: '10 puntos' }).click());
  a = await first();
  assert.equal(a.fx.glow.radius, 10);
  assert.ok(a.fx.shadow, 'la sombra se queda al añadir el resplandor');
  const css = await ev(() => getComputedStyle(document.querySelector('.ProseMirror img.nw-image')).filter);
  assert.match(css, /drop-shadow/);
  await shot('efectos');
  await selectIcon();
  await pop('Efectos de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Sin sombra' }).click());
  await selectIcon();
  await pop('Efectos de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Sin resplandor' }).click());
  assert.equal((await first()).fx, null);
});

await check('un estilo cambia el aspecto entero (relleno, contorno, transparencia y efectos)', async () => {
  await selectIcon();
  await pop('Estilos de gráfico', (m) => m.getByRole('menuitem', { name: 'Con sombra', exact: true }).click());
  let a = await first();
  assert.equal(a.fill, '#1f4e79');
  assert.ok(a.fx.shadow);
  await selectIcon();
  await pop('Estilos de gráfico', (m) => m.getByRole('menuitem', { name: 'Solo contorno', exact: true }).click());
  a = await first();
  assert.equal(a.fill, 'none');
  assert.equal(a.stroke, '#1f4e79');
  assert.equal(a.fx, null, 'el estilo quita los efectos anteriores');
  await shot('estilo-contorno');
});

await check('girar, texto alternativo y deshacer', async () => {
  await selectIcon();
  await page.locator('[aria-label="Girar a la derecha"], [title*="Girar a la derecha"], [aria-label*="Girar 90"]').first().click();
  assert.equal((await first()).rotate, 90);
  await page.locator('.ProseMirror').first().press('Control+z');
  await page.waitForTimeout(300);
  assert.equal((await first()).rotate, 0);
  await page.locator('.ProseMirror').first().press('Control+z');
  await page.waitForTimeout(500);
  assert.equal((await first()).stroke, null, 'deshacer quita el estilo y vuelve al relleno anterior');
  assert.match((await first()).alt, /Estrella/);
});

await check('con un icono con aspecto propio, al guardar y leer el .docx todo vuelve igual', async () => {
  await selectIcon();
  await pop('Relleno de gráfico', pickColor('Naranja'));
  await selectIcon();
  await pop('Contorno de gráfico', pickColor('Azul oscuro'));
  await selectIcon();
  await pop('Efectos de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Exterior, abajo', exact: true }).click());
  const r = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const back = (await w.docx.readDocx(data)).doc;
    let a = null;
    back.body.descendants((n) => { if (n.type.name === 'image' && !a) a = { ...n.attrs }; });
    const svg = atob(a.src.split(',')[1]);
    let bin = '';
    for (const b of data) bin += String.fromCharCode(b);
    return { fill: /fill="([^"]*)"/.exec(svg)?.[1], stroke: /stroke="([^"]*)"/.exec(svg)?.[1], fx: a.fx, png: (a.png ?? '').slice(0, 15), b64: btoa(bin) };
  });
  assert.equal(r.fill, '#ffc000');
  assert.equal(r.stroke, '#002060');
  assert.equal(r.fx.shadow.angle, 90);
  assert.match(r.png, /^data:image\/png/);
  if (outFile) fs.writeFileSync(outFile, Buffer.from(r.b64, 'base64'));
});

await check('una imagen que no es un icono: sin relleno ni contorno de gráfico, pero sí efectos', async () => {
  await ev(() => {
    const v = window.__novaWriter.ctl.mainView;
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    v.dispatch(v.state.tr.insert(v.state.doc.content.size - 1, v.state.schema.nodes.paragraph.create(null, v.state.schema.nodes.image.create({ src: PNG, width: 40, height: 40, alt: 'foto' }))));
  });
  await page.locator('.ProseMirror img[alt="foto"]').click();
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
  assert.equal(await page.getByRole('button', { name: 'Relleno de gráfico', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Contorno de gráfico', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Efectos de gráfico', exact: true }).isEnabled(), true);
  await pop('Efectos de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Exterior, centrada y difuminada' }).click());
  const fx = await ev(() => { let f = null; window.__novaWriter.ctl.mainView.state.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.alt === 'foto') f = n.attrs.fx; }); return f; });
  assert.equal(fx.shadow.dist, 0);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
