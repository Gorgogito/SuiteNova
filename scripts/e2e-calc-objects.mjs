// End-to-end checks for the Nova Calc objects (validation, tables, links, notes, sparklines, pivots, slicers, charts, print, macros).
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-calc-objects.mjs [--shots dir]
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
  await page.waitForTimeout(250);
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
const at = (c, r) => [gb.x + 40 + c * 64 + 32, gb.y + 22 + r * 20 + 10];
const click = (c, r, o) => page.mouse.click(...at(c, r), o);
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (a) => ev((addr) => window.__novaCalc.text(addr), a);
const type = async (c, r, t) => {
  await ev(([cc, rr]) => window.__novaCalc.doc.selectCell(rr, cc), [c, r]);
  await page.keyboard.type(t);
  await page.keyboard.press('Enter');
};
const tab = async (name) => {
  await page.getByRole('tab', { name, exact: true }).first().click();
  await page.waitForTimeout(150);
};
const btn = (name) => page.getByRole('button', { name }).first();
const modal = () => page.locator('.fui-DialogSurface, [role=dialog]').first();

// ---- sample data
const data = [
  ['Región', 'Producto', 'Ventas', 'Costo'],
  ['Norte', 'A', '10', '4'],
  ['Sur', 'B', '25', '9'],
  ['Norte', 'B', '40', '15'],
  ['Este', 'A', '5', '2'],
  ['Oeste', 'A', '30', '11'],
  ['Sur', 'A', '15', '6'],
];
for (let r = 0; r < data.length; r++) for (let c = 0; c < 4; c++) await type(c, r, data[r][c]);
await shot('datos');

await check('tabla de Excel con referencias estructuradas', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.selectRange({ r1: 0, c1: 0, r2: 6, c2: 3 });
    d.x.createTable(true);
  });
  await type(5, 0, '=SUM(Tabla1[Ventas])');
  assert.equal(await text('F1'), '125');
  await type(4, 0, 'Margen');
  assert.equal(await ev(() => window.__novaCalc.doc.sheet.tables[0].ref.c2), 4);
  await type(4, 1, '=[@Ventas]-[@Costo]');
  assert.equal(await text('E2'), '6');
  assert.equal(await ev(() => window.__novaCalc.doc.wb.getInputText(window.__novaCalc.doc.activeSheetId, 1, 4)), '=Tabla1[[#This Row],[Ventas]]-Tabla1[[#This Row],[Costo]]'.replace(/Tabla1\[\[#This Row\],\[(\w+)\]\]/g, '[@$1]'));
  await shot('tabla');
});

await check('validación de datos: lista desplegable y alerta', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.x.setValidation({ type: 'list', op: 'between', formula1: '"Norte,Sur,Este,Oeste"', allowBlank: true, showDropDown: true, showError: true, errorStyle: 'stop', errorTitle: 'Región', errorMessage: 'Elija una región de la lista.', showInput: true, inputTitle: 'Región', inputMessage: 'Elija de la lista', ranges: [] }, [{ r1: 7, c1: 0, r2: 12, c2: 0 }]);
  });
  await ev(() => window.__novaCalc.doc.selectCell(7, 0));
  await page.waitForTimeout(200);
  await shot('validacion-celda');
  await page.keyboard.type('Centro');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await shot('validacion-alerta');
  assert.equal(await ev(() => !!window.__novaCalc.doc.x.alert), true);
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.waitForTimeout(200);
  assert.equal(await ev(() => window.__novaCalc.doc.edit), null);
  assert.equal(await text('A8'), '');
});

await check('hipervínculo y nota', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.selectCell(8, 3);
    d.x.setHyperlink({ url: 'https://example.org', text: 'Ejemplo' });
    d.x.saveComment(8, 4, 'Una nota de prueba', 'Yo');
  });
  assert.equal(await text('D9'), 'Ejemplo');
  await shot('enlace-nota');
});

await check('minigráficos', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.wb.setInput(d.activeSheetId, 13, 0, '1');
    for (let c = 0; c < 5; c++) d.wb.setInput(d.activeSheetId, 13, c, String([3, 7, 2, 9, 5][c]));
    d.x.insertSparklines('line', { r1: 13, c1: 0, r2: 13, c2: 4 }, { r1: 13, c1: 5, r2: 13, c2: 5 });
    d.x.insertSparklines('column', { r1: 1, c1: 2, r2: 6, c2: 2 }, { r1: 7, c1: 5, r2: 7, c2: 5 });
  });
  assert.equal(await ev(() => window.__novaCalc.doc.sheet.sparklines.length), 2);
  await shot('minigraficos');
});

await check('gráficos: combinado, radar, 3D, superficie, cotizaciones', async () => {
  const kinds = ['combo', 'radarFilled', 'column3d', 'surface3d', 'stockHLC'];
  await ev(() => {
    const d = window.__novaCalc.doc;
    const rows = [['Día', 'Máx', 'Mín', 'Cierre'], ['L', '12', '8', '10'], ['M', '14', '9', '13'], ['X', '13', '10', '11'], ['J', '16', '11', '15']];
    rows.forEach((r, i) => r.forEach((t, c) => d.wb.setInput(d.activeSheetId, 20 + i, c, t)));
  });
  for (const k of kinds) {
    const err = await ev((kind) => {
      const d = window.__novaCalc.doc;
      d.selectRange(kind === 'stockHLC' ? { r1: 20, c1: 0, r2: 24, c2: 3 } : { r1: 0, c1: 0, r2: 6, c2: 3 });
      return d.insertChart(kind);
    }, k);
    assert.equal(err, null, `${k}: ${err}`);
  }
  assert.equal(await ev(() => window.__novaCalc.doc.sheet.charts.length), kinds.length);
  await page.waitForTimeout(500);
  await shot('graficos');
  assert.ok((await page.locator('.calc-chart svg, .calc-chart canvas').count()) >= kinds.length);
});

await check('tabla dinámica con panel de campos y segmentación', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.addSheet();
    const target = d.activeSheetId;
    const res = d.x.createPivot({ sheet: d.wb.sheets[0].name, ref: 'A1:D7' }, target, 2, 0);
    if (res.error) throw new Error(res.error);
    d.x.updatePivot(res.id, 'Campos', (p) => {
      p.rows = ['Región'];
      p.cols = ['Producto'];
      p.values = [{ field: 'Ventas', agg: 'sum' }];
    });
    d.x.insertSlicer({ kind: 'pivot', id: res.id }, 'Región');
  });
  await page.waitForTimeout(400);
  await shot('pivot');
  assert.equal(await text('A3'), 'Suma de Ventas');
  assert.ok((await page.locator('.calc-pane').count()) > 0, 'panel de campos');
  assert.ok((await page.locator('.calc-slicer').count()) > 0, 'segmentación');
  await page.locator('.calc-slicer__items button', { hasText: 'Sur' }).first().click();
  await page.waitForTimeout(250);
  await shot('pivot-segmentada');
  const shown = await ev(() => {
    const d = window.__novaCalc.doc;
    const out = [];
    for (let r = 3; r < 12; r++) out.push(d.wb.getValue(d.activeSheetId, r, 0));
    return out;
  });
  assert.ok(shown.includes('Sur') && !shown.includes('Norte'), JSON.stringify(shown));
});

await check('pestañas de la cinta nuevas', async () => {
  await ev(() => window.__novaCalc.doc.activateSheet(window.__novaCalc.doc.wb.sheets[0].id));
  for (const name of ['Insertar', 'Diseño de página', 'Revisar', 'Programador', 'Datos']) {
    await tab(name);
    await shot(`cinta-${name.replace(/\W+/g, '-')}`);
  }
});

await check('vista previa de impresión', async () => {
  await ev(() => {
    const d = window.__novaCalc.doc;
    d.selectRange({ r1: 0, c1: 0, r2: 24, c2: 5 });
    d.x.setPrintArea();
  });
  await page.mouse.click(700, 600);
  await page.keyboard.press('Control+p');
  await page.waitForSelector('[role=dialog]');
  await page.waitForTimeout(700);
  await shot('vista-previa');
  assert.ok((await page.locator('[role=dialog] iframe, [role=dialog] .calc-print, [role=dialog] [class*=preview]').count()) > 0, 'sin vista previa');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
});

await check('editor de macros: escribir, ejecutar y ver el resultado', async () => {
  await ev(() => { window.__novaCalc.doc.contentEnabled = true; window.__novaCalc.doc.wb.macros = []; });
  await page.mouse.click(700, 600);
  await page.keyboard.press('Alt+F11');
  await page.waitForSelector('.calc-mac__code');
  await page.getByRole('button', { name: 'Nuevo módulo' }).click();
  await page.waitForTimeout(300);
  await page.locator('.calc-mac__code').fill(['Sub Hola()', '  Range("H1").Value = "desde editor"', '  Debug.Print "listo"', 'End Sub'].join(String.fromCharCode(10)));
  await shot('editor-macros');
  await page.getByRole('button', { name: /Ejecutar/ }).first().click();
  await page.waitForTimeout(400);
  await shot('editor-macros-ejecutado');
  assert.equal(await text('H1'), 'desde editor');
  await page.keyboard.press('Escape');
});

await check('macro: ejecutar desde el editor y deshacer', async () => {
  const out = await ev(() => {
    const d = window.__novaCalc.doc;
    d.contentEnabled = true;
    d.wb.macros = [{ name: 'Modulo1', code: 'Sub Pintar()\n  Range("H1").Value = "macro"\n  Range("H2").Value = 42\nEnd Sub' }];
    const r = d.macros.run('Pintar');
    return { ok: r.ok, h1: d.wb.getValue(d.activeSheetId, 0, 7) };
  });
  assert.equal(out.ok, true);
  assert.equal(out.h1, 'macro');
  await ev(() => window.__novaCalc.doc.undo());
  assert.equal(await text('H1'), 'desde editor'); // back to what the editor macro left
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors.filter((e) => !/Keyborg/.test(e)), []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
