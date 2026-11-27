// End-to-end checks for Insert › Screen Clipping in Writer, Calc, Slides, Diagram and Mail (Notes is in e2e-clip): the shared dialog opens from each product,
// the area and a mark chosen there are what ends up in the document, and cancelling inserts nothing. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-clip-products.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const results = [];
const errors = [];
let step = 0;

async function open(app, ready) {
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => errors.push(`${app}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(`${app}: ${m.text()}`));
  const alerts = [];
  page.on('dialog', (d) => (alerts.push(d.message()), d.dismiss()));
  await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load' });
  await page.waitForSelector(ready);
  await page.waitForTimeout(600);
  // a flat blue 1600x900 screen instead of the system picker
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 1600;
      c.height = 900;
      const g = c.getContext('2d');
      const paint = () => ((g.fillStyle = '#2b6cb0'), g.fillRect(0, 0, 1600, 900));
      paint();
      setInterval(paint, 100);
      return c.captureStream(5);
    };
  });
  return { page, ctx, alerts };
}
const check = async (name, page, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-FAIL-${name.replace(/\W+/g, '-').slice(0, 50)}.png` });
    for (let i = 0; i < 3 && (await page.getByRole('dialog').count()); i++) await page.keyboard.press('Escape');
  }
};
const press = async (page, name, tabs) => {
  const b = page.getByRole('button', { name, exact: true }).first();
  if (!(await b.isVisible().catch(() => false))) {
    for (const t of tabs) {
      await page.getByRole('tab', { name: t, exact: true }).click();
      await page.waitForTimeout(200);
      if (await b.isVisible().catch(() => false)) break;
    }
  }
  await page.mouse.move(900, 700);
  await page.waitForTimeout(400);
  await b.click();
};
const dlg = (page) => page.getByRole('dialog', { name: 'Recorte de pantalla' });
const dragOn = async (page, pts) => {
  const b = await page.getByTestId('clip-canvas').boundingBox();
  await page.mouse.move(b.x + b.width * pts[0][0], b.y + b.height * pts[0][1]);
  await page.mouse.down();
  for (const [fx, fy] of pts.slice(1)) await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
};
/** Reads the pixels of a PNG given as a data URI. */
const pixels = (page, uri) =>
  page.evaluate(async (uri) => {
    const img = new Image();
    img.src = uri;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    return { W: img.width, H: img.height, mid: px(img.width / 2, img.height / 2), corner: px(2, 2) };
  }, uri);
const b64 = (bytes) => `data:image/png;base64,${bytes}`;

const PRODUCTS = [
  {
    app: 'writer', ready: '.ProseMirror', tabs: ['Insertar'],
    count: (p) => p.locator('.ProseMirror img[src^="data:"]').count(),
    last: (p) => p.evaluate(() => [...document.querySelectorAll('.ProseMirror img[src^="data:"]')].at(-1).src),
  },
  {
    app: 'calc', ready: '.calc-grid__scroller', tabs: ['Insertar'],
    count: (p) => p.evaluate(() => window.__novaCalc.doc.sheet.images.length),
    last: (p) => p.evaluate(() => { const d = window.__novaCalc.doc; const m = d.wb.media.get(d.sheet.images.at(-1).media); let s = ''; for (const b of m.data) s += String.fromCharCode(b); return `data:${m.mime};base64,${btoa(s)}`; }),
  },
  {
    app: 'slides', ready: '.sl-canvas, [data-slide-canvas], .slide-canvas, svg', tabs: ['Insertar'], button: 'Recorte de pantalla',
    count: (p) => p.evaluate(() => window.__novaSlides.ctl.slide.shapes.filter((e) => e.kind === 'pic').length),
    last: (p) => p.evaluate(() => { const c = window.__novaSlides.ctl; const pics = c.slide.shapes.filter((e) => e.kind === 'pic'); const a = c.deck.assets[pics.at(-1).src]; let s = ''; for (const b of a.data) s += String.fromCharCode(b); return `data:${a.mime};base64,${btoa(s)}`; }),
  },
  {
    app: 'diagram', ready: '[data-stencil]', tabs: ['Contenido', 'Insertar', 'Inicio'], pre: (p) => p.mouse.click(1500, 300),
    count: (p) => p.evaluate(() => window.__novaDiagram.ctl.basePage.shapes.filter((s) => s.stencil === 'image').length),
    last: (p) => p.evaluate(() => window.__novaDiagram.ctl.basePage.shapes.filter((s) => s.stencil === 'image').at(-1).image.src),
  },
];

for (const pr of PRODUCTS) {
  const { page, ctx, alerts } = await open(pr.app, pr.ready);
  const name = pr.button ?? 'Recorte de pantalla…';
  await check(`${pr.app}: el botón abre el diálogo de recorte y Cancelar no inserta nada`, page, async () => {
    if (pr.pre) await pr.pre(page);
    const n = await pr.count(page);
    await press(page, name, pr.tabs);
    await page.getByTestId('clip-canvas').waitFor();
    await dlg(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dlg(page).waitFor({ state: 'detached' });
    await page.waitForTimeout(300);
    assert.equal(await pr.count(page), n);
  });
  await check(`${pr.app}: la zona y la marca elegidas son lo que se inserta`, page, async () => {
    if (pr.pre) await pr.pre(page);
    const n = await pr.count(page);
    await press(page, name, pr.tabs);
    await page.getByTestId('clip-canvas').waitFor();
    await page.waitForTimeout(400);
    await dragOn(page, [[0.4, 0.4], [0.6, 0.6]]);
    await dlg(page).getByRole('radio', { name: 'Lápiz', exact: true }).click();
    await dlg(page).getByRole('button', { name: 'Rojo', exact: true }).click();
    await dlg(page).getByRole('radio', { name: 'Grueso', exact: true }).click();
    await dragOn(page, [[0.42, 0.5], [0.58, 0.5]]);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${pr.app}.png` });
    await dlg(page).getByRole('button', { name: 'Insertar el recorte', exact: true }).click();
    await dlg(page).waitFor({ state: 'detached' });
    await page.waitForTimeout(1200);
    assert.equal(await pr.count(page), n + 1, alerts.join(' | '));
    const r = await pixels(page, await pr.last(page));
    assert.ok(Math.abs(r.W - 320) <= 4 && Math.abs(r.H - 180) <= 4, `${r.W}x${r.H}`);
    assert.ok(r.mid[0] > 200 && r.mid[1] < 60, `centro ${r.mid}`);
    assert.ok(Math.abs(r.corner[0] - 43) < 8 && Math.abs(r.corner[2] - 176) < 8, `esquina ${r.corner}`);
  });
  await ctx.close();
}

{
  const { page, ctx, alerts } = await open('mail', '.ml-item, .ml-folders');
  await check('mail: el botón abre el recorte, Cancelar no inserta y el recorte entra en el cuerpo con su nombre', page, async () => {
    await page.keyboard.press('Control+Shift+M');
    const body = page.getByLabel('Cuerpo del mensaje');
    await body.fill('Mira:\n');
    await page.getByRole('button', { name: /Recorte de pantalla/ }).click();
    await page.getByTestId('clip-canvas').waitFor();
    await dlg(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await dlg(page).waitFor({ state: 'detached' });
    assert.doesNotMatch(await page.evaluate(() => window.__novaMail.ctl.compose.body), /\[Imagen/i);
    await page.getByRole('button', { name: /Recorte de pantalla/ }).click();
    await page.getByTestId('clip-canvas').waitFor();
    await page.waitForTimeout(400);
    await dragOn(page, [[0.4, 0.4], [0.6, 0.6]]);
    await dlg(page).getByRole('button', { name: 'Insertar el recorte', exact: true }).click();
    await dlg(page).waitFor({ state: 'detached' });
    await page.waitForTimeout(900);
    const text = await page.evaluate(() => window.__novaMail.ctl.compose.body);
    assert.match(text, /\[Imagen[^\]]*Recorte de pantalla \d{4}-\d\d-\d\d/i, text + alerts.join('|'));
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-mail.png` });
  });
  await ctx.close();
}

results.push([errors.length ? 'FAIL' : 'ok', 'sin errores de consola', errors.slice(0, 4).join(' | ')]);
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
