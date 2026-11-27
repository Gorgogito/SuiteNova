// End-to-end checks for the shared table controls in Nova Writer and Nova Notes: the size picker, the style gallery with its options, shading and borders.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-tables.mjs [--shots dir]
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

const A = 'rgb(68, 114, 196)'; // accent 1
const TINT40 = 'rgb(207, 213, 234)';
const TINT20 = 'rgb(233, 235, 245)';

async function session(app, ready) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (e) => errors.push(`${app}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(`${app}: ${m.text()}`));
  await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load' });
  await page.waitForSelector(ready);
  await page.waitForTimeout(700);
  const check = async (name, fn) => {
    try {
      await fn();
      results.push(['ok', `${app}: ${name}`]);
    } catch (e) {
      results.push(['FAIL', `${app}: ${name}`, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
      if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-FAIL-${app}.png` });
      for (let i = 0; i < 2; i++) await page.keyboard.press('Escape');
    }
  };
  return { page, ctx, check };
}
const shot = async (page, name) => shotsDir && (await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` }));
const bg = (page, sel) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);

const PRODUCTS = [
  { app: 'writer', ready: '.nw-doc', cell: '.nw-doc table td', row: '.nw-doc table tr', insertTab: 'Insertar', tableTab: 'Tabla' },
  { app: 'notes', ready: '.nn-canvas', cell: '.nn-doc td, .nn-box--text td', row: '.nn-doc tr, .nn-box--text tr', insertTab: 'Insertar', tableTab: 'Tabla' },
];

for (const P of PRODUCTS) {
  const { page, ctx, check } = await session(P.app, P.ready);
  if (P.app === 'writer') await page.click('.nw-doc');
  else {
    const b = await page.locator('.nn-canvas').boundingBox();
    await page.mouse.click(b.x + 120, b.y + 90);
    await page.keyboard.type('texto');
    await page.waitForTimeout(200);
  }
  const cells = () => page.locator(P.cell);
  const tab = (n) => page.getByRole('tab', { name: n, exact: n !== 'Tabla' }).click();
  const gallery = async () => {
    await tab(P.tableTab);
    await page.getByRole('button', { name: 'Estilos de tabla', exact: true }).click();
  };

  await check('el selector de tamaño: pasar por la cuadrícula dice el tamaño y un clic inserta esa tabla', async () => {
    await tab(P.insertTab);
    await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
    await page.getByRole('gridcell', { name: '4 × 3', exact: true }).hover();
    assert.match(await page.locator('.nv-tbl-size').innerText(), /Tabla de 4 × 3/);
    await shot(page, 'selector');
    await page.getByRole('gridcell', { name: '4 × 3', exact: true }).click();
    await page.waitForTimeout(400);
    assert.equal(await cells().count(), 12);
    assert.equal(await page.locator(P.row).count(), 3);
  });

  await check('con el teclado: flechas cambian el tamaño e Intro inserta', async () => {
    await page.locator(P.cell).first().click();
    await page.keyboard.press('Control+End');
    await tab(P.insertTab);
    await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
    const grid = page.getByRole('grid', { name: 'Insertar tabla' });
    await grid.focus();
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    // the size picked with the mouse is where the arrows start from: 4 × 3 → 2 × 2
    assert.match(await page.locator('.nv-tbl-size').innerText(), /Tabla de 2 × 2/);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    assert.equal(await cells().count(), 16);
  });

  await check('la galería: un estilo cambia la tabla al instante (encabezado, bandas) y se recuerda', async () => {
    await cells().first().click();
    await gallery();
    await shot(page, 'galeria');
    await page.getByRole('button', { name: 'Medio – Énfasis 1', exact: true }).click();
    await page.waitForTimeout(300);
    const first = cells().first();
    const st = await first.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color, w: getComputedStyle(e).fontWeight }));
    assert.equal(st.bg, A);
    assert.equal(st.fg, 'rgb(255, 255, 255)');
    assert.ok(Number(st.w) >= 600, `negrita ${st.w}`);
    // the first body row is the darker band, the second the lighter one
    assert.equal(await cells().nth(4).evaluate((e) => getComputedStyle(e).backgroundColor), TINT40);
    assert.equal(await cells().nth(8).evaluate((e) => getComputedStyle(e).backgroundColor), TINT20);
    await shot(page, 'estilo-medio');
    await gallery();
    assert.equal(await page.getByRole('button', { name: 'Medio – Énfasis 1', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.keyboard.press('Escape');
  });

  await check('las opciones: sin fila de encabezado y con fila de totales', async () => {
    await cells().first().click();
    await gallery();
    await page.getByLabel('Fila de encabezado').uncheck();
    await page.getByLabel('Fila de totales').check();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal(await cells().first().evaluate((e) => getComputedStyle(e).backgroundColor), TINT40, 'sin encabezado la primera fila es una banda');
    assert.equal(await cells().nth(8).evaluate((e) => getComputedStyle(e).backgroundColor), A, 'la última fila es la de totales');
    await shot(page, 'opciones');
  });

  await check('sombreado: un color, sin color y volver al color del estilo', async () => {
    await cells().nth(4).click();
    await tab(P.tableTab);
    await page.getByRole('button', { name: 'Sombreado', exact: true }).click();
    await page.getByRole('button', { name: 'Naranja', exact: true }).first().click();
    await page.waitForTimeout(250);
    assert.equal(await cells().nth(4).evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(255, 192, 0)');
    await page.getByRole('button', { name: 'Sombreado', exact: true }).click();
    await page.getByRole('button', { name: 'Sin color', exact: true }).click();
    await page.waitForTimeout(250);
    const none = await cells().nth(4).evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.ok(none === 'rgba(0, 0, 0, 0)' || none === 'transparent', none);
    await page.getByRole('button', { name: 'Sombreado', exact: true }).click();
    await page.getByRole('button', { name: 'Restablecer el color del estilo', exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal(await cells().nth(4).evaluate((e) => getComputedStyle(e).backgroundColor), TINT20);
  });

  await check('bordes: el exterior de una celda con el lápiz elegido, y quitarlos', async () => {
    await cells().nth(5).click();
    await tab(P.tableTab);
    await page.getByRole('button', { name: 'Bordes', exact: true }).click();
    await page.getByLabel('Grosor de línea').selectOption('3');
    await page.getByLabel('Color de la línea').fill('#ff0000');
    await page.getByRole('menuitem', { name: 'Borde exterior', exact: true }).click();
    await page.waitForTimeout(250);
    const b = await cells().nth(5).evaluate((e) => ({ w: getComputedStyle(e).borderTopWidth, c: getComputedStyle(e).borderTopColor, s: getComputedStyle(e).borderTopStyle }));
    assert.equal(b.c, 'rgb(255, 0, 0)');
    assert.equal(b.s, 'solid');
    assert.ok(parseFloat(b.w) >= 3, b.w);
    // the neighbour above shares the edge
    assert.equal(await cells().nth(1).evaluate((e) => getComputedStyle(e).borderBottomColor), 'rgb(255, 0, 0)');
    await shot(page, 'bordes');
    await page.getByRole('button', { name: 'Bordes', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sin borde', exact: true }).click();
    await page.waitForTimeout(250);
    assert.notEqual(await cells().nth(5).evaluate((e) => getComputedStyle(e).borderTopColor), 'rgb(255, 0, 0)');
  });

  await check('deshacer devuelve el aspecto anterior y «Borrar estilo» deja la tabla sin estilo', async () => {
    await cells().first().click();
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    await cells().first().click();
    await gallery();
    await page.getByRole('button', { name: 'Borrar estilo' }).click();
    await page.waitForTimeout(300);
    const bgc = await cells().first().evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.ok(bgc === 'rgba(0, 0, 0, 0)' || bgc === 'transparent', bgc);
  });

  if (P.app === 'writer')
    await check('fórmula: «Fórmula…» suma la columna con SUM(ABOVE), recalcula y se puede editar', async () => {
      const cols = await page.locator(`${P.row}`).first().locator('td, th').count();
      const rows = await page.locator(P.row).count();
      assert.ok(rows >= 3, `filas ${rows}`);
      await cells().nth(0).click();
      await page.keyboard.type('2');
      await cells().nth(cols).click();
      await page.keyboard.type('3');
      await cells().nth(2 * cols).click();
      await tab(P.tableTab);
      await page.getByRole('button', { name: 'Fórmula…' }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Fórmula', { exact: true }).waitFor();
      await dlg.getByRole('button', { name: 'Aceptar' }).click();
      await page.waitForTimeout(400);
      const shown = await page.locator('.nw-doc .nw-field-formula').first().innerText();
      assert.equal(shown.trim(), '5');
    });

  await check('los controles de tabla están desactivados fuera de una tabla', async () => {
    if (P.app === 'writer') {
      await page.click('.nw-doc p, .nw-doc');
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('Control+Shift+End');
    }
    // the Table tab only shows inside a table: outside it the controls are not reachable
    const tabs = await page.getByRole('tab', { name: P.tableTab }).count();
    assert.ok(tabs <= 1);
  });

  await ctx.close();
}

// ---- Slides: the same size picker, and the family «Lista» in its own gallery
{
  const { page, ctx, check } = await session('slides', '.sl-surface');
  const table = () => page.evaluate(() => window.__novaSlides.ctl.slide.shapes.find((e) => e.kind === 'table') ?? null);
  await check('el selector de tamaño de Insertar › Tabla inserta una tabla de 3 filas × 4 columnas', async () => {
    await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
    await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
    await page.getByRole('gridcell', { name: '4 × 3', exact: true }).hover();
    assert.match(await page.locator('.nv-tbl-size').innerText(), /Tabla de 4 × 3/);
    await shot(page, 'slides-selector');
    await page.getByRole('gridcell', { name: '4 × 3', exact: true }).click();
    await page.waitForTimeout(500);
    const t = await table();
    assert.ok(t, 'hay una tabla');
    assert.equal(t.rows.length, 3);
    assert.equal(t.cols.length, 4);
  });
  await check('«Insertar tabla…» sigue abriendo el cuadro con el número de filas y columnas', async () => {
    await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
    await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
    await page.getByRole('button', { name: 'Insertar tabla…', exact: true }).click();
    await page.getByLabel('Número de columnas').fill('2');
    await page.getByLabel('Número de filas').fill('2');
    await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
    await page.waitForTimeout(400);
    const n = await page.evaluate(() => window.__novaSlides.ctl.slide.shapes.filter((e) => e.kind === 'table').length);
    assert.equal(n, 2);
  });
  await check('la galería de estilos tiene la familia «Lista» en los seis colores y aplicarla cambia el estilo de la tabla', async () => {
    await page.evaluate(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes.find((e) => e.kind === 'table').id]); });
    await page.getByRole('tab', { name: /Diseño de tabla/ }).click();
    await page.getByRole('button', { name: 'Estilos de tabla', exact: true }).click();
    const items = page.getByRole('menuitem', { name: /^Lista - Énfasis \d$/ });
    assert.equal(await items.count(), 6);
    await shot(page, 'slides-galeria');
    await items.nth(0).click();
    await page.waitForTimeout(300);
    const id = await page.evaluate(() => window.__novaSlides.ctl.slide.shapes.find((e) => e.kind === 'table').styleId);
    assert.match(id, /^\{4E4F5641-0004-4000-8000-000000000001\}$/);
    const def = await page.evaluate((i) => window.__novaSlides.ctl.deck.tableStyles.find((s) => s.id === i)?.name, id);
    assert.equal(def, 'Lista - Énfasis 1');
  });
  await ctx.close();
}

// ---- Mail: a table in the body of a message (token in the text, HTML table and aligned text when sent, draft that opens again)
{
  const { page, ctx, check } = await session('mail', '.ml-item, .ml-folders');
  const exportEml = async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar .eml' }).click()]);
    const f = (await dl.path()) ?? '';
    return fs.readFileSync(f, 'utf8');
  };
  const qp = (t) => t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  await check('insertar tabla: queda en el texto, las celdas se escriben y una fórmula da su resultado', async () => {
    await page.keyboard.press('Control+Shift+M');
    await page.getByLabel('Para', { exact: true }).fill('bea@x.es');
    await page.getByLabel('Asunto').fill('Con tabla');
    await page.getByLabel('Cuerpo del mensaje').click();
    await page.keyboard.type('Cifras:');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
    await page.getByRole('gridcell', { name: '2 × 3', exact: true }).click();
    // the cursor is in the first cell
    await page.keyboard.type('Cant');
    for (const value of ['Nota', '2', 'a', '3', 'b']) {
      await page.keyboard.press('Tab');
      await page.keyboard.type(value);
    }
    await page.getByRole('toolbar', { name: 'Herramientas de tabla' }).getByRole('button', { name: 'Agregar fila' }).click();
    await page.keyboard.press('Tab');
    await page.keyboard.type('=SUM(ABOVE)');
    await page.getByLabel('Asunto').click();
    await page.waitForFunction(() => document.querySelector('.ml-editor .nn-fval:not(.nn-fval--hint)')?.textContent === '5');
    await shot(page, 'mail-tabla');
  });
  await check('exportar: el HTML lleva la tabla con su estilo y el texto la lleva alineada con el resultado de la fórmula', async () => {
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    const eml = qp(await exportEml());
    assert.match(eml, /<table cellspacing="0"/);
    assert.match(eml, /<t[hd][^>]* style="[^"]*border-top:/);
    assert.match(eml, />5<\/td>/);
    assert.doesNotMatch(eml.split('text/html')[1], /=SUM/);
    assert.match(eml, /Cant \| Nota\r?\n\s*2 \| a\r?\n\s*3 \| b\r?\n\s*5/);
  });
  await ctx.close();
}

results.push([errors.length ? 'FAIL' : 'ok', 'sin errores de consola', errors.slice(0, 4).join(' | ')]);
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
