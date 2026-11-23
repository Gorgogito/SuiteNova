// End-to-end checks for icons in Nova Slides: the shared gallery (several at once), the SVG with its PNG, fill, outline, styles, effects, Convert to Shape and
// what goes in the .pptx. Needs `pnpm dev` on :1420. Usage: node scripts/e2e-slides-icons.mjs [--shots dir] [--out file.pptx]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const page = await (await browser.newContext({ viewport: { width: 2200, height: 950 } })).newPage();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__novaSlides);
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
const settle = (ms = 400) => page.waitForTimeout(ms);
const icons = () =>
  ev(() => {
    const c = window.__novaSlides.ctl;
    return c.slide.shapes
      .filter((e) => e.kind === 'pic' && e.svg)
      .map((e) => {
        const s = new TextDecoder().decode(c.deck.assets[e.svg].data);
        const root = /<svg[^>]*>/.exec(s)?.[0] ?? '';
        return { id: e.id, alt: e.descr, w: e.xfrm.w, fill: /fill="([^"]*)"/.exec(root)?.[1], opacity: /fill-opacity="([^"]*)"/.exec(root)?.[1] ?? null, stroke: /stroke="([^"]*)"/.exec(root)?.[1] ?? null, sw: /stroke-width="([^"]*)"/.exec(root)?.[1] ?? null, pngMime: c.deck.assets[e.src].mime, png: c.deck.assets[e.src].data.length, svgMime: c.deck.assets[e.svg].mime, effects: e.effects ?? null, src: e.src };
      });
  });
// the Graphics group may be folded into one button when the window is narrow
const pressGfx = async (label) => {
  const b = page.getByRole('button', { name: label, exact: true });
  if (!(await b.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Gráficos', exact: true }).first().click();
  await b.click();
};
const menu = async (label, pick) => {
  await pressGfx(label);
  await pick(page.getByRole('menu', { name: label }));
  await settle(600);
  // the folded group's own popup stays open after choosing: close it
  if (await page.getByRole('button', { name: 'Estilos de gráfico', exact: true }).isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await settle(200);
};
const selectIcons = async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.select(c.slide.shapes.filter((e) => e.kind === 'pic' && e.svg).map((e) => e.id)); });
  await settle(300);
  await page.getByRole('tab', { name: /Formato de imagen/ }).click();
};

await check('la galería compartida inserta dos iconos juntos: cada uno es un PNG con su SVG, centrados en la diapositiva', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.select(c.slide.shapes.map((e) => e.id)); c.deleteSelected(); });
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Iconos…' }).click();
  const d = page.getByRole('dialog', { name: 'Iconos' });
  await d.waitFor();
  await d.getByLabel('Buscar icono').fill('estrella');
  await settle(300);
  const opts = d.getByRole('listbox', { name: 'Iconos' }).getByRole('option');
  await opts.nth(0).click();
  await opts.nth(1).click();
  await shot('galeria');
  await d.getByRole('button', { name: 'Insertar (2)' }).click();
  await d.waitFor({ state: 'detached' });
  await settle(600);
  const list = await icons();
  assert.equal(list.length, 2);
  for (const i of list) {
    assert.equal(i.pngMime, 'image/png');
    assert.equal(i.svgMime, 'image/svg+xml');
    assert.ok(i.png > 300);
    assert.match(i.alt, /Estrella/);
    assert.equal(i.w, 96);
  }
  const xs = await ev(() => window.__novaSlides.ctl.slide.shapes.map((e) => e.xfrm.x));
  assert.ok(xs[1] > xs[0], 'uno al lado del otro');
  await shot('insertados');
});

await check('el icono se dibuja en la diapositiva con su SVG (nítido)', async () => {
  const src = await ev(() => { const el = document.querySelector('[data-id] image, [data-id] img'); return el ? (el.getAttribute('href') ?? el.getAttribute('src') ?? '') : ''; });
  assert.match(src, /^blob:/);
  const mime = await ev(async (u) => (await (await fetch(u)).blob()).type, src);
  assert.equal(mime, 'image/svg+xml');
});

await check('Gráficos solo aparece con un icono seleccionado', async () => {
  await selectIcons();
  assert.ok((await page.getByRole('button', { name: 'Gráficos', exact: true }).count()) + (await page.getByRole('button', { name: 'Estilos de gráfico', exact: true }).count()) > 0);
  await shot('formato-imagen');
});

await check('relleno: un color cambia el SVG de los dos iconos y rehace sus PNG', async () => {
  const before = await icons();
  await menu('Relleno de gráfico', (m) => m.getByRole('button', { name: 'Rojo', exact: true }).click());
  const a = await icons();
  assert.deepEqual(a.map((i) => i.fill), ['#ff0000', '#ff0000']);
  assert.notDeepEqual(a.map((i) => i.src), before.map((i) => i.src));
  assert.ok(a.every((i) => i.png > 500));
});

await check('contorno, transparencia y sin relleno', async () => {
  await selectIcons();
  await menu('Contorno de gráfico', (m) => m.getByRole('button', { name: 'Azul', exact: true }).click());
  await selectIcons();
  await menu('Contorno de gráfico', (m) => m.getByRole('menuitemradio', { name: '2 pt' }).click());
  let a = (await icons())[0];
  assert.equal(a.stroke, '#0070c0');
  assert.equal(a.sw, '2');
  await selectIcons();
  await menu('Relleno de gráfico', (m) => m.getByRole('menuitemradio', { name: '50 %' }).click());
  assert.equal((await icons())[0].opacity, '0.5');
  await selectIcons();
  await menu('Relleno de gráfico', (m) => m.getByRole('menuitemradio', { name: 'Sin relleno' }).click());
  a = (await icons())[0];
  assert.equal(a.fill, 'none');
  assert.equal(a.stroke, '#0070c0');
  await shot('contorno');
});

await check('un estilo de gráfico (con sombra) pone el aspecto y el efecto de la imagen', async () => {
  await selectIcons();
  await menu('Estilos de gráfico', (m) => m.getByRole('menuitem', { name: 'Con sombra', exact: true }).click());
  const a = (await icons())[0];
  assert.equal(a.fill, '#1f4e79');
  assert.equal(a.stroke, null);
  assert.ok(a.effects?.outer, 'sombra exterior');
  await shot('estilo-sombra');
});

await check('deshacer devuelve el aspecto anterior', async () => {
  const before = (await icons())[0];
  await ev(() => window.__novaSlides.ctl.undo());
  await settle(400);
  const a = (await icons())[0];
  assert.notEqual(a.fill, before.fill);
  assert.equal(a.fill, 'none');
});

await check('al guardar el .pptx y abrirlo, cada icono sigue siendo un SVG con su PNG, con su aspecto', async () => {
  const bytes = await ev(() => window.__novaSlides.write());
  if (outFile) fs.writeFileSync(outFile, Buffer.from(bytes));
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle(800);
  const list = await icons();
  assert.equal(list.length, 2);
  assert.ok(list.every((i) => i.fill === 'none' && i.stroke === '#0070c0' && i.svgMime === 'image/svg+xml' && i.pngMime === 'image/png'), JSON.stringify(list.map((i) => [i.fill, i.stroke])));
});

await check('Convertir en forma: los iconos pasan a formas libres con su relleno y contorno, en el mismo sitio', async () => {
  await selectIcons();
  await menu('Relleno de gráfico', (m) => m.getByRole('button', { name: 'Verde', exact: true }).click());
  const pos = await ev(() => window.__novaSlides.ctl.slide.shapes.map((e) => [e.xfrm.x, e.xfrm.y, e.xfrm.w]));
  await selectIcons();
  await page.getByRole('button', { name: 'Convertir en forma', exact: true }).click().catch(async () => { await page.getByRole('button', { name: 'Gráficos', exact: true }).first().click(); await page.getByRole('button', { name: 'Convertir en forma', exact: true }).click(); });
  await settle(600);
  const r = await ev(() => window.__novaSlides.ctl.slide.shapes.map((e) => ({ kind: e.kind, cust: !!e.geom?.cust, paths: e.geom?.cust?.length, fill: e.fill?.c?.rgb, ln: e.ln?.fill?.c?.rgb, pos: [e.xfrm.x, e.xfrm.y, e.xfrm.w], alt: e.descr })));
  assert.equal(r.length, 2);
  for (const s of r) {
    assert.equal(s.kind, 'shape');
    assert.ok(s.cust && s.paths >= 1);
    assert.equal(s.fill, '#00b050');
    assert.equal(s.ln, '#0070c0');
    assert.match(s.alt, /Estrella/);
  }
  assert.deepEqual(r.map((s) => s.pos), pos);
  const svg = await ev(() => document.querySelectorAll('[data-id] svg path').length);
  assert.ok(svg > 0, 'se dibuja');
  await shot('formas');
  // y sobreviven al .pptx
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle(800);
  const back = await ev(() => window.__novaSlides.ctl.slide.shapes.map((e) => ({ kind: e.kind, cust: !!e.geom?.cust, fill: e.fill?.c?.rgb })));
  assert.deepEqual(back, [{ kind: 'shape', cust: true, fill: '#00b050' }, { kind: 'shape', cust: true, fill: '#00b050' }]);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
