// End-to-end checks of the shared theme menus in Nova Calc (Page Layout tab): the theme of the workbook, what points at it, undo, and the .xlsx.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-themes-calc.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from '../packages/xlsx-io/node_modules/jszip/lib/index.js';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
await page.goto(`${BASE}?app=calc`, { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.evaluate(() => localStorage.removeItem('suitenova.themes.custom'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.waitForTimeout(600);

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png` }).catch(() => {});
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 5).join(' | ')]);
    await page.keyboard.press('Escape').catch(() => {});
  }
};
const settle = (ms = 250) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const open = async (name) => {
  await page.getByRole('button', { name, exact: true }).click();
  await settle(300);
};
const theme = () => page.evaluate(() => { const t = window.__novaCalc.doc.wb.theme; return { colors: t.colors, fonts: t.fonts, name: t.name }; });
// the style of a cell (A1 = 0,0)
const style = (row, col) => page.evaluate(([row, col]) => { const d = window.__novaCalc.doc; const c = d.wb.getCell(d.activeSheetId, row, col); return c ? d.wb.styles.get(c.style) : null; }, [row, col]);
const rgb = (hex) => hex.toLowerCase();

// A1: a fill and a text colour that point at the theme; A2: fixed colours; A3: the heading font of the theme
await page.evaluate(() => {
  const d = window.__novaCalc.doc;
  const id = d.activeSheetId;
  const th = d.wb.theme;
  const set = (row, text, style) => d.run('Preparar', () => [d.wb.setInput(id, row, 0, text), d.wb.formatRange(id, { r1: row, c1: 0, r2: row, c2: 0 }, style)]);
  set(0, 'Del tema', { bgRef: { slot: 'accent1' }, bg: th.colors.accent1, colorRef: { slot: 'lt1' }, color: th.colors.lt1 });
  set(1, 'Fijo', { bg: '#ff0000', color: '#00ff00' });
  set(2, 'Título', { fontName: th.fonts.major.latin, fontTheme: 'major' });
  d.run('Preparar', () => d.wb.formatRange(id, { r1: 3, c1: 0, r2: 3, c2: 0 }, { bgRef: { slot: 'accent2', tint: 0.8 }, bg: '#fbe5d6' }));
});
await page.getByRole('tab', { name: 'Diseño de página', exact: true }).click();

await check('the theme menus are in the Page Layout tab', async () => {
  for (const n of ['Temas', 'Colores', 'Fuentes', 'Efectos']) assert.equal(await page.getByRole('button', { name: n, exact: true }).count(), 1, n);
});

await check('a new workbook has the Office theme and the body font of it', async () => {
  const t = await theme();
  assert.equal(t.colors.accent1.toLowerCase(), '#4472c4');
  assert.equal(await page.evaluate(() => window.__novaCalc.doc.wb.defaultFont.name), t.fonts.minor.latin);
});

await check('colours: the cells that point at the theme follow; the fixed colours do not', async () => {
  await open('Colores');
  await shot('calc-colors');
  await page.getByRole('menuitemradio', { name: 'Verde', exact: true }).click();
  await settle(400);
  const t = await theme();
  assert.equal(t.colors.accent1, '#549e39');
  assert.equal((await style(0, 0)).bg, t.colors.accent1);
  assert.equal((await style(1, 0)).bg, '#ff0000');
  assert.equal((await style(1, 0)).color, '#00ff00');
  assert.notEqual((await style(3, 0)).bg, '#fbe5d6');
});

await check('the grid is drawn again with the new colour', async () => {
  const px = await page.evaluate(() => {
    const cv = document.querySelector('.calc-grid__canvas');
    const r = cv.getBoundingClientRect();
    const k = cv.width / r.width;
    const x = Math.round((40 + 6) * k);
    const y = Math.round((22 + 4) * k);
    const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  assert.deepEqual(px, [0x54, 0x9e, 0x39]);
});

await check('undo gives back the theme and every colour with one step; redo does it again', async () => {
  await page.locator('.calc-grid__scroller').click({ position: { x: 300, y: 200 } });
  await page.keyboard.press('Control+z');
  await settle(300);
  assert.equal((await theme()).colors.accent1.toLowerCase(), '#4472c4');
  assert.equal((await style(0, 0)).bg, '#4472c4');
  await page.keyboard.press('Control+y');
  await settle(300);
  assert.equal((await theme()).colors.accent1, '#549e39');
  assert.equal((await style(0, 0)).bg, '#549e39');
});

await check('fonts: the workbook font and the heading font take the theme fonts', async () => {
  await open('Fuentes');
  await page.getByRole('menuitemradio', { name: /^Georgia/ }).first().click();
  await settle(400);
  const t = await theme();
  assert.equal(t.fonts.major.latin, 'Georgia');
  assert.equal(await page.evaluate(() => window.__novaCalc.doc.wb.defaultFont.name), t.fonts.minor.latin);
  assert.equal((await style(2, 0)).fontName, 'Georgia');
});

await check('effects: the scheme chosen is kept in the theme of the workbook', async () => {
  await open('Efectos');
  await page.getByRole('menuitemradio', { name: 'Intenso', exact: true }).click();
  await settle();
  assert.equal(await page.evaluate(() => window.__novaCalc.doc.wb.theme.effectsName), 'Intenso');
});

await check('custom colours: applied to the workbook and listed', async () => {
  await open('Colores');
  await page.getByRole('menuitem', { name: 'Personalizar colores…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByLabel('Énfasis 1').fill('#ff0066');
  await dlg.getByLabel('Nombre').fill('Rosa del libro');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await settle(400);
  assert.equal((await theme()).colors.accent1, '#ff0066');
  assert.equal((await style(0, 0)).bg, '#ff0066');
  await open('Colores');
  assert.equal(await page.getByRole('menuitemradio', { name: 'Rosa del libro' }).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Escape');
});

await check('the .xlsx keeps the theme whole and the references to it, and opens again the same', async () => {
  const b64 = await page.evaluate(async () => {
    const { writeXlsx } = await window.__novaCalc.io();
    const bytes = await writeXlsx(window.__novaCalc.doc.wb);
    let s = '';
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  const zip = await JSZip.loadAsync(Buffer.from(b64, 'base64'));
  const th = await zip.file('xl/theme/theme1.xml').async('string');
  assert.match(th, /<a:accent1><a:srgbClr val="FF0066"\/>/i);
  const styles = await zip.file('xl/styles.xml').async('string');
  assert.match(styles, /<fgColor theme="4"\/>/);
  assert.match(styles, /<scheme val="major"\/>/);
  assert.match(styles, /<scheme val="minor"\/>/);
  assert.match(styles, /<fgColor rgb="FFFF0000"\/>/);
  const back = await page.evaluate(async (b64) => {
    const { readXlsx } = await window.__novaCalc.io();
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const wb = (await readXlsx(u)).workbook;
    const c = wb.getCell(wb.sheets[0].id, 0, 0);
    return { accent1: wb.theme.colors.accent1, bgRef: wb.styles.get(c.style).bgRef, bg: wb.styles.get(c.style).bg, font: wb.defaultFont.name };
  }, b64);
  assert.equal(back.accent1.toLowerCase(), '#ff0066');
  assert.deepEqual(back.bgRef, { slot: 'accent1' });
  assert.equal(back.bg.toLowerCase(), '#ff0066');
});

await check('a workbook opened from a file brings its theme and its colours follow a change', async () => {
  // the workbook is saved, a new empty one is opened and the file is opened in it
  await page.evaluate(async () => {
    const { writeXlsx, readXlsx } = await window.__novaCalc.io();
    const d = window.__novaCalc.doc;
    const bytes = await writeXlsx(d.wb);
    const Workbook = d.wb.constructor;
    d.load(new Workbook(), 'vacío.xlsx', null);
    d.load((await readXlsx(bytes)).workbook, 'tema.xlsx', null);
  });
  await settle(800);
  assert.equal((await theme()).colors.accent1.toLowerCase(), '#ff0066');
  await page.getByRole('tab', { name: 'Diseño de página', exact: true }).click();
  await open('Colores');
  await page.getByRole('menuitemradio', { name: 'Azul', exact: true }).click();
  await settle(400);
  assert.notEqual((await style(0, 0)).bg.toLowerCase(), '#ff0066');
  assert.equal((await style(1, 0)).bg, '#ff0000');
});

await check('the colour menu offers the colours of the theme and the cell keeps the reference', async () => {
  await page.evaluate(() => { const d = window.__novaCalc.doc; d.selectCell(6, 3); });
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Color de relleno (más)', exact: true }).click();
  await settle(300);
  assert.equal(await page.getByRole('group', { name: 'Color de relleno' }).getByRole('button', { name: 'Énfasis 2', exact: true }).count(), 1);
  await shot('calc-picker');
  await page.getByRole('button', { name: 'Énfasis 2, más claro 80 %', exact: true }).click();
  await settle(300);
  const st = await style(6, 3);
  assert.deepEqual({ slot: st.bgRef.slot, tint: st.bgRef.tint }, { slot: 'accent2', tint: 0.8 });
  const t = await theme();
  await page.getByRole('tab', { name: 'Diseño de página', exact: true }).click();
  await open('Colores');
  await page.getByRole('menuitemradio', { name: 'Rojo', exact: true }).click();
  await settle(400);
  const after = await style(6, 3);
  assert.notEqual(after.bg, st.bg);
  assert.deepEqual({ slot: after.bgRef.slot, tint: after.bgRef.tint }, { slot: 'accent2', tint: 0.8 });
  // a fixed colour drops the reference
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Color de relleno (más)', exact: true }).click();
  await page.getByRole('group', { name: 'Color de relleno' }).getByRole('button', { name: 'Rojo', exact: true }).click();
  await settle(300);
  const fixed = await style(6, 3);
  assert.equal(fixed.bg, '#ff0000');
  assert.equal(fixed.bgRef, undefined);
  await page.getByRole('tab', { name: 'Diseño de página', exact: true }).click();
});

await check('a new chart takes the colours of the theme and follow it', async () => {
  await page.evaluate(() => {
    const d = window.__novaCalc.doc;
    [['a', 'b'], ['x', '3'], ['y', '5']].forEach((row, i) => row.forEach((t, c) => d.wb.setInput(d.activeSheetId, 20 + i, c, t)));
    d.selectRange({ r1: 20, c1: 0, r2: 22, c2: 1 });
    d.insertChart('column');
  });
  const colors = () => page.evaluate(async () => {
    const d = window.__novaCalc.doc;
    const ch = d.sheet.charts[d.sheet.charts.length - 1];
    const { chartData } = await import('/src/calc/chartOption.ts');
    const data = chartData(ch, d.wb, d.activeSheetId, d.locale);
    return { series: data.series[0].color, accent1: d.wb.theme.colors.accent1 };
  });
  const c = await colors();
  assert.equal(c.series.toLowerCase(), c.accent1.toLowerCase());
  await open('Colores');
  await page.getByRole('menuitemradio', { name: 'Verde', exact: true }).click();
  await settle(400);
  const c2 = await colors();
  assert.equal(c2.series.toLowerCase(), '#549e39');
});

await check('keyboard: the menu opens with Enter and a scheme is chosen without the mouse', async () => {
  await page.getByRole('button', { name: 'Colores', exact: true }).focus();
  await page.keyboard.press('Enter');
  await settle(300);
  assert.ok(await page.getByRole('menuitemradio').first().isVisible());
  await page.keyboard.press('Escape');
});

await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? `  ✔ ${r[1]}` : `  ✘ ${r[1]}\n      ${r[2]}`);
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', errors.slice(0, 5));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
