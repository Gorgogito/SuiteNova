// End-to-end checks for the extended conditional formats and autofilter of Nova Calc. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-calc-cf2.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=calc';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss();
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.calc-grid__scroller');
await page.waitForTimeout(400);
await page.mouse.click(300, 400);
const gb = await page.locator('.calc-grid__scroller').boundingBox();
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (a) => ev((addr) => window.__novaCalc.text(addr), a);

// datos: A = saldo (con negativos), B = fecha, C = nota 0-100, D = texto
await ev(() => {
  const d = window.__novaCalc.doc;
  const id = d.activeSheetId;
  const set = (r, c, t) => d.wb.setInput(id, r, c, t);
  const iso = (offset) => {
    const x = new Date();
    x.setDate(x.getDate() + offset);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  ['Saldo', 'Fecha', 'Nota', 'Zona'].forEach((h, c) => set(0, c, h));
  const saldo = [-40, -15, 0, 20, 55, 80, -5, 30];
  const fechas = [-60, -3, -1, 0, 1, 2, 40, -400];
  const notas = [12, 35, 50, 61, 74, 88, 95, 20];
  saldo.forEach((v, i) => {
    set(i + 1, 0, String(v));
    set(i + 1, 1, iso(fechas[i]));
    set(i + 1, 2, String(notas[i]));
    set(i + 1, 3, ['Norte', 'Sur', 'Este', 'Oeste'][i % 4]);
  });
  d.selectRange({ r1: 0, c1: 0, r2: 8, c2: 3 });
});

await check('barras de datos con negativos, iconos nuevos y fechas con borde y formato de número', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    const mk = (extra, ranges) => d.addCF({ ranges, ...extra });
    mk({ type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' }, negativeColor: '#d64545' }, [{ r1: 1, c1: 0, r2: 8, c2: 0 }]);
    mk({ type: 'timePeriod', period: 'thisWeek', format: { bg: '#ffeb9c', bold: true, numFmt: 'ddd dd/mm', top: { style: 'thin', color: '#c00000' }, bottom: { style: 'thin', color: '#c00000' }, left: { style: 'thin', color: '#c00000' }, right: { style: 'thin', color: '#c00000' } } }, [{ r1: 1, c1: 1, r2: 8, c2: 1 }]);
    mk({ type: 'iconSet', set: '5Rating', thresholds: [0, 20, 40, 60, 80].map((v) => ({ type: 'percent', value: v })) }, [{ r1: 1, c1: 2, r2: 8, c2: 2 }]);
    mk({ type: 'iconSet', set: '3Stars', thresholds: [0, 33, 67].map((v) => ({ type: 'percent', value: v })) }, [{ r1: 1, c1: 3, r2: 4, c2: 3 }]);
    d.selectCell(0, 5);
  });
  await page.waitForTimeout(500);
  await shot('formato-condicional');
  const n = await ev(() => window.__novaCalc.doc.condFormats.length);
  assert.equal(n, 4);
  // el formato de número de la regla se ve en la celda: una fecha de esta semana ya no se muestra como dd/mm/aaaa
  const shown = await ev(() => {
    const d = window.__novaCalc.doc;
    return d.display(d.activeSheetId, 4, 1, 'ddd dd/mm').text;
  });
  assert.match(shown, /^[a-záéíóú]{3,4}\.? \d\d\/\d\d$/i);
});

await check('un gráfico de iconos y barras se dibuja sin errores en las 20 variantes', async () => {
  const sets = ['3Arrows', '3ArrowsGray', '3Flags', '3TrafficLights', '3TrafficLights2', '3Signs', '3Symbols', '3Symbols2', '3Stars', '3Triangles', '4Arrows', '4ArrowsGray', '4RedToBlack', '4Rating', '4TrafficLights', '5Arrows', '5ArrowsGray', '5Rating', '5Quarters', '5Boxes'];
  await ev((all) => {
    const d = window.__novaCalc.doc;
    d.clearCF('sheet');
    all.forEach((set, i) => {
      const n = Number(set[0]);
      d.addCF({ type: 'iconSet', set, thresholds: Array.from({ length: n }, (_x, k) => ({ type: 'percent', value: Math.round((k * 100) / n) })), ranges: [{ r1: 12 + (i % 10), c1: 6 + Math.floor(i / 10) * 2, r2: 12 + (i % 10), c2: 6 + Math.floor(i / 10) * 2 }] });
    });
    // valores para que cada icono se vea: columna G y I con números 1..5
    const id = d.activeSheetId;
    all.forEach((_s, i) => d.wb.setInput(id, 12 + (i % 10), 6 + Math.floor(i / 10) * 2, String(1 + (i % 5))));
    d.wb.setInput(id, 11, 6, '1');
    d.wb.setInput(id, 22, 6, '5');
    d.addCF({ type: 'dataBar', color: '#638ec6', min: { type: 'num', value: 0 }, max: { type: 'num', value: 6 }, ranges: [{ r1: 0, c1: 6, r2: 0, c2: 6 }] });
  }, sets);
  await page.waitForTimeout(400);
  await shot('iconos-20-variantes');
});

await check('autofiltro: menú con diez mejores, promedio, fechas y color', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.clearCF('sheet');
    d.selectRange({ r1: 0, c1: 0, r2: 8, c2: 3 });
    d.toggleAutoFilter();
    // colorea un par de celdas de la columna D para ofrecer el filtro por color
    d.selectRange({ r1: 2, c1: 3, r2: 3, c2: 3 });
    d.applyStyle({ bg: '#ffeb9c' });
    d.selectCell(0, 5);
  });
  await page.waitForTimeout(300);
  // abre el menú de la columna B (fechas): botón de filtro en el borde derecho del encabezado
  await page.mouse.click(gb.x + 40 + 2 * 64 - 10, gb.y + 22 + 10);
  await page.waitForTimeout(300);
  await shot('menu-fechas');
  assert.equal(await page.getByLabel('Filtros de fecha').count(), 1);
  await page.getByLabel('Filtros de fecha').selectOption('thisWeek');
  await page.waitForTimeout(400);
  await shot('filtro-esta-semana');
  const hidden = await ev(() => [...window.__novaCalc.doc.sheet.filterHidden].sort((a, b) => a - b));
  // fechas: −60, −3, −1, 0, +1, +2, +40, −400 días respecto a hoy; la semana (dom–sáb) deja las más cercanas según el día
  assert.ok(hidden.includes(1) && hidden.includes(7) && hidden.includes(8), `ocultas: ${hidden}`);
  assert.ok(!hidden.includes(4), 'la fecha de hoy debe verse');
  // diez mejores en la columna C
  await ev(() => window.__novaCalc.doc.setColumnFilter(1, null));
  await page.mouse.click(gb.x + 40 + 3 * 64 - 10, gb.y + 22 + 10);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Diez mejores…' }).click();
  await page.locator('.calc-fmenu input[type=number]').fill('3');
  await page.locator('.calc-fmenu button.is-primary').first().click();
  await page.waitForTimeout(400);
  await shot('diez-mejores');
  const hiddenTop = await ev(() => [...window.__novaCalc.doc.sheet.filterHidden].length);
  assert.equal(hiddenTop, 5); // 8 filas con datos, quedan 3
  // por color de relleno (columna D)
  await ev(() => window.__novaCalc.doc.clearColumnFilters());
  await page.mouse.click(gb.x + 40 + 4 * 64 - 10, gb.y + 22 + 10);
  await page.waitForTimeout(300);
  await shot('menu-color');
  await page.getByRole('button', { name: /Relleno #ffeb9c/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await ev(() => window.__novaCalc.doc.sheet.filterHidden.size), 6); // solo 2 filas con ese relleno
  await shot('filtro-color');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors.filter((e) => !/Keyborg/.test(e)), []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
