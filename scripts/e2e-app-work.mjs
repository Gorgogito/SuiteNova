// End-to-end checks of the work areas in the application themes, as in Office: the dark page of Writer in Black (and
// View › Switch modes), the white sheet of Calc, rulers, formula bar and sheet tabs, and the work areas of the other
// applications. Needs `pnpm dev` on :1420. Usage: node scripts/e2e-app-work.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lowContrast } from './lib-contrast.mjs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const errors = [];
let ctx;
let page;
/** A clean profile: nothing saved from the check before. */
const fresh = async () => {
  await ctx?.close();
  ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
  page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|beforeunload/.test(m.text()) && errors.push(m.text()));
};

const results = [];
const check = async (name, fn) => {
  try {
    await fresh();
    await fn();
    results.push(['ok', name]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png`, timeout: 5000 }).catch(() => {});
    results.push(['FAIL', name]);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 40).join('\n      ')}`);
  }
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const THEMES = ['colorful', 'white', 'darkgray', 'black'];
const setTheme = async (theme) => {
  await page.evaluate((t) => window.__novaSettings.set('theme', t), theme);
  await page.waitForFunction((t) => document.querySelector('[data-app]')?.dataset.theme === t, theme);
  await settle(250);
};
const open = async (app, theme = 'colorful') => {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector('.nv-titlebar', { timeout: 30000 });
      break;
    } catch (e) {
      if (attempt) throw e; // the development server sometimes stalls (see e2e-app-frame.mjs)
    }
  }
  await setTheme(theme);
  await settle(500);
};
const command = async (name) => {
  await page.locator('#nv-tellme').fill(name);
  await page.keyboard.press('Enter');
  await settle(300);
};
const css = (selector, prop) => page.locator(selector).first().evaluate((e, p) => getComputedStyle(e)[p], prop);
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

// ------------------------------------------------------------------ Writer
/** The colour a text is really painted with (-webkit-text-fill-color, whatever way it is written) and its own colour. */
const paint = (selector) =>
  page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const seen = (value) => {
      canvas.clearRect(0, 0, 1, 1);
      canvas.fillStyle = '#010203';
      canvas.fillStyle = value;
      canvas.fillRect(0, 0, 1, 1);
      return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    return { fill: seen(s.webkitTextFillColor), own: seen(s.color) };
  });
const ratio = (a, b) => {
  const lum = (c) => {
    const [r, g, bl] = c.map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const PAGE_DARK = [38, 38, 38];
/** A document with normal text, a heading, a coloured word, a highlighted word and a table. */
const writeDocument = async () => {
  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await page.keyboard.type('Un título');
  await page.locator('.nv-ribbon__body select[aria-label="Estilo"], .nv-ribbon__body select[title*="stilo"]').first().selectOption({ label: 'Título 1' });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Texto normal');
  await page.keyboard.press('Enter');
  await page.keyboard.type('marcado');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Resaltado', exact: true }).click();
  await settle(400);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
  await page.getByRole('gridcell', { name: '2 × 2', exact: true }).click();
  await page.keyboard.type('celda');
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await settle(500);
};

await check('Writer en Negro: la página es oscura como en Word y todo el texto se lee, sin cambiar sus colores', async () => {
  await open('writer', 'colorful');
  await writeDocument();
  const before = await page.evaluate(() => window.__novaWriter.ctl.html());
  assert.equal(await css('.nw-page', 'backgroundColor'), 'rgb(255, 255, 255)');
  await setTheme('black');
  await shot('writer-negro');
  assert.equal(await css('.nw-page', 'backgroundColor'), rgb('#262626'));
  const normal = await paint('.ProseMirror p.nw-style-Normal');
  assert.deepEqual(normal.own, [0, 0, 0], 'el color del texto no cambia');
  assert.ok(normal.fill.every((v) => v > 230), `el texto negro se pinta casi blanco: ${normal.fill}`);
  const heading = await paint('.ProseMirror .nw-style-Heading1');
  assert.ok(ratio(heading.fill, PAGE_DARK) >= 4.5, `título: ${heading.fill}`);
  assert.ok(heading.fill[2] > heading.fill[0] + 20, `el título sigue siendo azul: ${heading.fill}`);
  const cell = await paint('.ProseMirror td p');
  assert.ok(ratio(cell.fill, PAGE_DARK) >= 4.5, `celda: ${cell.fill}`);
  const marked = await paint('.ProseMirror span[style*="background"]');
  assert.deepEqual(marked.fill, marked.own, 'sobre el resaltado el texto conserva su color');
  assert.equal(await page.evaluate(() => window.__novaWriter.ctl.html()), before, 'el documento no cambia');
});

await check('Vista › Cambiar modos: solo en Negro, alterna la página y se recuerda', async () => {
  await open('writer', 'darkgray');
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  assert.equal(await page.locator('[data-nv-item="writer.view.pageMode"]').count(), 0);
  assert.equal(await css('.nw-page', 'backgroundColor'), 'rgb(255, 255, 255)');
  await setTheme('black');
  const toggle = page.locator('[data-nv-item="writer.view.pageMode"]');
  assert.equal(await toggle.getAttribute('aria-label'), 'Cambiar modos');
  await toggle.click();
  await settle();
  assert.equal(await css('.nw-page', 'backgroundColor'), 'rgb(255, 255, 255)');
  assert.deepEqual((await paint('.ProseMirror p')).fill, [0, 0, 0]);
  await shot('writer-negro-pagina-blanca');
  await open('writer', 'black');
  assert.equal(await css('.nw-page', 'backgroundColor'), 'rgb(255, 255, 255)', 'se recuerda');
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.locator('[data-nv-item="writer.view.pageMode"]').click();
  await settle();
  assert.equal(await css('.nw-page', 'backgroundColor'), rgb('#262626'));
});

await check('la página oscura no llega a la impresión ni a un documento con color de página; la vista web también se oscurece', async () => {
  await open('writer', 'black');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Texto para imprimir.');
  await command('Imprimir');
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('.nw-page'));
  const printed = await page.evaluate(() => {
    const d = document.querySelector('iframe').contentDocument;
    const view = d.defaultView;
    const text = d.querySelector('.nw-doc p');
    return [view.getComputedStyle(d.querySelector('.nw-page')).backgroundColor, view.getComputedStyle(text).webkitTextFillColor, view.getComputedStyle(text).color];
  });
  assert.deepEqual(printed, ['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)']);
  await open('writer', 'black');
  await page.evaluate(() => window.__novaWriter.ctl.setPageColor('#ffeecc'));
  await settle(500);
  assert.equal(await css('.nw-page', 'backgroundColor'), rgb('#ffeecc'));
  assert.deepEqual((await paint('.ProseMirror p')).fill, [0, 0, 0]);
  await page.evaluate(() => window.__novaWriter.ctl.setPageColor(null));
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.locator('[data-nv-item="writer.view.web"]').click();
  await settle(500);
  assert.equal(await css('.nw-sheet.nw-view-web', 'backgroundColor'), rgb('#262626'));
  await shot('writer-web-negro');
});

// ------------------------------------------------------------------ rulers
const RULER = { colorful: ['#ffffff', '#616161', '#ececec'], white: ['#ffffff', '#616161', '#ececec'], darkgray: ['#6b6b6b', '#f0f0f0', '#555555'], black: ['#292929', '#ffffff', '#1c1c1c'] };
await check('las reglas de Writer y Slides siguen al tema como en Office', async () => {
  await open('writer');
  for (const theme of THEMES) {
    await setTheme(theme);
    const [bg, fg, margin] = RULER[theme];
    assert.equal(await css('.nw-hruler', 'backgroundColor'), rgb(bg), `writer ${theme}`);
    assert.equal(await css('.nw-hruler', 'color'), rgb(fg), `writer ${theme}`);
    assert.equal(await css('.nw-hruler-margin', 'backgroundColor'), rgb(margin), `writer ${theme}`);
    assert.equal(await css('.nw-vruler', 'backgroundColor'), rgb(bg), `writer vertical ${theme}`);
    await shot(`regla-writer-${theme}`);
  }
  await open('slides');
  await command('Reglas');
  for (const theme of THEMES) {
    await setTheme(theme);
    assert.equal(await css('.sl-ruler--h rect', 'fill'), rgb(RULER[theme][0]), `slides ${theme}`);
    assert.equal(await css('.sl-ruler--h text', 'fill'), rgb(RULER[theme][1]), `slides ${theme}`);
    await shot(`regla-slides-${theme}`);
  }
});

// ------------------------------------------------------------------ Calc
const CALC = {
  colorful: { header: '#f0f0f0', bar: '#ffffff', tabs: '#ececec' },
  white: { header: '#f0f0f0', bar: '#ffffff', tabs: '#ececec' },
  darkgray: { header: '#525252', bar: '#4d4d4d', tabs: '#555555' },
  black: { header: '#0a0a0a', bar: '#292929', tabs: '#1c1c1c' },
};
/** The colour of a point of the grid, read from its canvas (CSS pixels from its corner). */
const pixel = (x, y) =>
  page.evaluate(
    ([px, py]) => {
      const c = document.querySelector('.calc-grid__canvas');
      const d = c.getContext('2d').getImageData(Math.round(px * devicePixelRatio), Math.round(py * devicePixelRatio), 1, 1).data;
      return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
    },
    [x, y],
  );
await check('Calc: la hoja es blanca en todos los temas y encabezados, barra de fórmulas y pestañas siguen al tema', async () => {
  await open('calc');
  await page.locator('.calc-grid__scroller').click({ position: { x: 500, y: 300 } });
  await page.keyboard.type('Dato');
  await page.keyboard.press('Enter');
  for (const theme of THEMES) {
    await setTheme(theme);
    const want = CALC[theme];
    // inside a cell far from any text or line; in the row of letters and in the column of numbers, away from them
    assert.equal(await pixel(290, 230), 'rgb(255, 255, 255)', `celda ${theme}`);
    assert.equal(await pixel(290, 3), rgb(want.header), `encabezado de columna ${theme}`);
    assert.equal(await pixel(3, 233), rgb(want.header), `encabezado de fila ${theme}`);
    assert.equal(await css('.calc-fbar', 'backgroundColor'), rgb(want.bar), `barra de fórmulas ${theme}`);
    assert.equal(await css('.calc-tabs', 'backgroundColor'), rgb(want.tabs), `pestañas ${theme}`);
    assert.equal(await css('.calc-tab.is-active', 'backgroundColor'), 'rgb(255, 255, 255)', `hoja elegida ${theme}`);
    assert.deepEqual(await lowContrast(page, ['.calc-fbar', '.calc-tabs']), [], theme);
    await shot(`calc-${theme}`);
  }
  // the cell editor stays white too
  await page.keyboard.press('F2');
  await settle();
  assert.equal(await css('.calc-editor', 'backgroundColor'), 'rgb(255, 255, 255)');
});

await check('Slides: las miniaturas y las notas van sobre el color del lienzo, como en PowerPoint', async () => {
  await open('slides');
  await page.locator('.sl-notes textarea').fill('Una nota del orador.');
  for (const theme of THEMES) {
    await setTheme(theme);
    const canvas = rgb(RULER[theme][2]);
    assert.equal(await css('.sl-panel', 'backgroundColor'), canvas, `miniaturas ${theme}`);
    assert.equal(await css('.sl-notes', 'backgroundColor'), canvas, `notas ${theme}`);
    assert.deepEqual(await lowContrast(page, ['.sl-panel', '.sl-notes']), [], theme);
    await shot(`slides-notas-${theme}`);
  }
});

// ------------------------------------------------------------------ the other applications
await check('las zonas de trabajo de Mail, Base, Plan, Notes y Forms quedan blancas en Gris oscuro', async () => {
  for (const [app, selector] of [['mail', '.ml-app'], ['base', '.bs-app'], ['plan', '.pl-app'], ['notes', '.nn-pagehead'], ['forms', '.fm-card']]) {
    await open(app, 'darkgray');
    assert.equal(await css(selector, 'backgroundColor'), 'rgb(255, 255, 255)', app);
    await setTheme('black');
    assert.equal(await css(selector, 'backgroundColor'), rgb('#292929'), `${app} negro`);
    await setTheme('white');
    assert.equal(await css(selector, 'backgroundColor'), 'rgb(255, 255, 255)', `${app} blanco`);
  }
});

await check('lo escrito en un mensaje se lee en los cuatro temas', async () => {
  await open('mail');
  await page.keyboard.press('Control+Shift+M');
  const body = page.getByLabel('Cuerpo del mensaje');
  await body.click();
  await page.keyboard.type('Texto del mensaje.');
  for (const theme of THEMES) {
    await setTheme(theme);
    assert.deepEqual(await lowContrast(page, ['.ml-editorbox', '.ml-format', '.ml-composer .ml-compose']), [], theme);
    // the message is written on white paper, like a page or a sheet
    assert.equal(await css('.ml-editorbox', 'backgroundColor'), 'rgb(255, 255, 255)', theme);
    await shot(`mensaje-${theme}`);
  }
});

await check('el texto de las zonas de trabajo se lee en las nueve aplicaciones y en los cuatro temas', async () => {
  const bad = [];
  const look = async (app, where) => {
    for (const theme of THEMES) {
      await setTheme(theme);
      // the page of Writer is checked on its own: its dark paper is not an ancestor of the text
      for (const line of await lowContrast(page, ['.nv-content', '.fui-DialogSurface'], 4.5, '.nw-sheet')) bad.push(`${app} ${theme} [${where}] ${line}`);
      await shot(`trabajo-${app}-${where.replace(/\W+/g, '-')}-${theme}`);
    }
  };
  const work = {
    writer: [],
    calc: [['con datos', async () => { await page.locator('.calc-grid__scroller').click({ position: { x: 200, y: 100 } }); await page.keyboard.type('12'); await page.keyboard.press('Enter'); }]],
    slides: [['clasificador', async () => command('Clasificador de diapositivas')], ['esquema', async () => command('Esquema')]],
    notes: [['con texto', async () => command('Página nueva')]],
    mail: [['mensaje nuevo', async () => { await page.keyboard.press('Control+Shift+M'); await settle(700); }], ['calendario', async () => command('Calendario')], ['contactos', async () => command('Contactos')], ['tareas', async () => command('Tareas')]],
    base: [['tabla nueva', async () => { await page.getByRole('tab', { name: 'Crear', exact: true }).click(); await page.click('[data-nv-item="base.table.new"]'); }]],
    diagram: [],
    plan: [['con tareas', async () => { await command('Tarea nueva'); await command('Tarea nueva'); }], ['recursos', async () => command('Hoja de recursos')]],
    forms: [['con una pregunta', async () => { await page.getByRole('button', { name: 'Añadir pregunta', exact: true }).last().click(); await settle(400); }], ['vista previa', async () => command('Vista previa')]],
  };
  for (const [app, steps] of Object.entries(work)) {
    await open(app);
    await look(app, 'al abrir');
    for (const [where, step] of steps) {
      await setTheme('colorful');
      await step();
      await settle(500);
      await look(app, where);
    }
  }
  await open('');
  await look('inicio', 'al abrir');
  assert.equal(bad.length, 0, `\n${[...new Set(bad)].join('\n')}`);
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
