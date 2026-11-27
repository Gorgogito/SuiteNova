// End-to-end checks for the picture sources shared by the products: clipboard, screenshot and icons (Writer, Calc, Notes, Diagram and Mail). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-image-sources.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--disable-gpu', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--auto-select-tab-capture-source-by-title=Nova'],
});
const results = [];
let step = 0;
const errors = [];

async function open(app, ready) {
  const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push(`${app}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(`${app}: ${m.text()}`));
  const alerts = [];
  page.on('dialog', (d) => (alerts.push(d.message()), d.dismiss()));
  await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load' });
  await page.waitForSelector(ready);
  await page.waitForTimeout(600);
  return { page, ctx, alerts };
}
const check = async (name, page, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-FAIL-${name.replace(/\W+/g, '-').slice(0, 50)}.png` });
  }
};
// press a ribbon button, looking for it in the tabs when it is not on the current one
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
const putOnClipboard = (page) =>
  page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = '#e02020';
    g.fillRect(0, 0, 120, 80);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
// in Diagram a selected picture is replaced instead of adding another, so click on an empty place first
const deselect = (page) => page.mouse.click(1500, 300);
const iconInsert = async (page) => {
  const d = page.getByRole('dialog');
  await d.getByLabel('Buscar icono').fill('corazon');
  await d.getByRole('listbox', { name: 'Iconos' }).getByRole('option', { name: /^Corazón/ }).first().click();
  await d.getByRole('button', { name: 'Insertar', exact: true }).click();
  await page.waitForTimeout(900);
};

const PRODUCTS = [
  { app: 'writer', ready: '.ProseMirror', tabs: ['Insertar'], count: (p) => p.locator('.ProseMirror img[src^="data:"]').count() },
  { app: 'calc', ready: '.calc-grid__scroller', tabs: ['Insertar'], count: (p) => p.evaluate(() => window.__novaCalc.doc.sheet.images.length) },
  { app: 'notes', ready: '.nn-canvas', tabs: ['Insertar'], count: (p) => p.evaluate(() => window.__novaNotes.ctl.page.containers.filter((c) => c.kind === 'image').length) },
  { app: 'diagram', ready: '[data-stencil]', tabs: ['Contenido', 'Insertar', 'Inicio'], count: (p) => p.evaluate(() => window.__novaDiagram.ctl.basePage.shapes.filter((s) => s.stencil === 'image').length) },
];

for (const pr of PRODUCTS) {
  const { page, ctx, alerts } = await open(pr.app, pr.ready);
  await check(`${pr.app}: sin imagen en el portapapeles se avisa y no se inserta nada`, page, async () => {
    await page.getByRole('tab', { name: pr.tabs[0], exact: true }).click();
    await page.evaluate(() => navigator.clipboard.writeText('solo texto'));
    const n = await pr.count(page);
    await press(page, 'Imagen del portapapeles', pr.tabs);
    await page.waitForTimeout(500);
    assert.equal(await pr.count(page), n);
    assert.ok(alerts.some((a) => /No hay ninguna imagen en el portapapeles/.test(a)), alerts.join(' | '));
  });
  await check(`${pr.app}: la imagen del portapapeles se inserta`, page, async () => {
    const n = await pr.count(page);
    await putOnClipboard(page);
    await press(page, 'Imagen del portapapeles', pr.tabs);
    await page.waitForTimeout(900);
    assert.equal(await pr.count(page), n + 1);
  });
  await check(`${pr.app}: un icono se busca, se elige y se inserta como imagen`, page, async () => {
    if (pr.app === 'diagram') await deselect(page);
    const n = await pr.count(page);
    await press(page, 'Iconos…', pr.tabs);
    await iconInsert(page);
    assert.equal(await pr.count(page), n + 1);
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${pr.app}-icono.png` });
  });
  if (pr.app !== 'notes') {
    await check(`${pr.app}: el recorte de pantalla (toda la captura) inserta una imagen`, page, async () => {
      if (pr.app === 'diagram') await deselect(page);
      const n = await pr.count(page);
      await press(page, 'Recorte de pantalla…', pr.tabs);
      await page.getByRole('dialog', { name: 'Recorte de pantalla' }).getByRole('button', { name: 'Insertar todo', exact: true }).click();
      await page.waitForTimeout(1500);
      assert.equal(await pr.count(page), n + 1, alerts.join(' | '));
    });
  }
  await ctx.close();
}

// Mail: the three buttons are in the composer
{
  const { page, ctx, alerts } = await open('mail', '.ml-item, .ml-folders');
  const pics = () => page.locator('.ml-attach img, .ml-compose img, [data-pic]').count();
  await check('mail: se abre el mensaje nuevo con los tres orígenes de imagen', page, async () => {
    await page.keyboard.press('Control+Shift+M');
    await page.getByRole('button', { name: /Imagen del portapapeles/ }).waitFor();
    await page.getByRole('button', { name: /Recorte de pantalla/ }).waitFor();
    await page.getByRole('button', { name: /Iconos/ }).waitFor();
  });
  await check('mail: la imagen del portapapeles y un icono quedan en el cuerpo', page, async () => {
    await page.getByLabel('Cuerpo del mensaje').fill('Mira:\n');
    await putOnClipboard(page);
    await page.getByRole('button', { name: /Imagen del portapapeles/ }).click();
    await page.waitForTimeout(700);
    const body = () => page.evaluate(() => window.__novaMail.ctl.compose.body);
    const first = await body();
    assert.match(first, /\[Imagen/i, first);
    await page.getByRole('button', { name: /Iconos/ }).click();
    await iconInsert(page);
    const second = await body();
    assert.ok((second.match(/\[Imagen/gi) ?? []).length >= 2, second);
  });
  await ctx.close();
}

results.push([errors.length ? 'FAIL' : 'ok', 'sin errores de consola', errors.slice(0, 4).join(' | ')]);
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
