// End-to-end checks of panes, dialogs, menus and the File view in the application themes: the colours measured on Office
// (docs/office-temas/MEDIDAS.md), the theme choice in File › Account, and a walk through every dialog and pane of every
// application, measuring the contrast of its text in the four looks.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-app-surfaces.mjs [--shots dir] [--only app,app] [--no-walk]
// (the whole run takes about a quarter of an hour; --only limits the walk to those applications)
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lowContrast } from './lib-contrast.mjs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const shotsDir = arg('--shots');
const only = arg('--only')?.split(',');
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 900 }, colorScheme: 'light' });
const errors = [];
let page;
const newPage = async () => {
  await page?.close().catch(() => {});
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  page.on('filechooser', () => {});
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|beforeunload/.test(m.text()) && errors.push(m.text()));
};
await newPage();

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png`, timeout: 5000 }).catch(() => {});
    results.push(['FAIL', name]);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 60).join('\n      ')}`);
    await newPage();
  }
};
const settle = (ms = 250) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const open = async (app, theme = 'colorful') => {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector('.nv-titlebar', { timeout: 30000 });
      break;
    } catch (e) {
      if (attempt) throw e; // the development server sometimes stalls (see e2e-app-frame.mjs)
      await newPage();
    }
  }
  await setTheme(theme);
  await settle(500);
};
/** Changes the theme of the open window, without reloading: whatever is open stays open. */
const setTheme = async (theme) => {
  await page.evaluate((t) => window.__novaSettings.set('theme', t), theme);
  await page.waitForFunction((t) => document.querySelector('[data-app]')?.dataset.theme === t, theme);
  await settle(120);
};
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const style = (selector, prop, pseudo) => page.locator(selector).first().evaluate((el, [p, s]) => getComputedStyle(el, s)[p], [prop, pseudo ?? null]);
const THEMES = ['colorful', 'white', 'darkgray', 'black'];
const fileView = () => page.locator('.nv-tab--file').click();

const WANT = {
  colorful: { nav: ['#ebebeb', '#242424'], mark: '#1651aa', content: '#f5f5f5', dialog: '#ffffff', title: '#185abd', primary: ['#1651aa', '#ffffff'], secondary: '#ffffff', pane: '#f0f0f0', menu: '#616161' },
  white: { nav: ['#ebebeb', '#242424'], mark: '#1651aa', content: '#f5f5f5', dialog: '#ffffff', title: '#185abd', primary: ['#1651aa', '#ffffff'], secondary: '#ffffff', pane: '#f0f0f0', menu: '#616161' },
  darkgray: { nav: ['#343535', '#ffffff'], mark: '#aec6f0', content: '#525252', dialog: '#525252', title: '#aec6f0', primary: ['#aec6f0', '#000000'], secondary: '#bdbdbd', pane: '#525252', menu: '#666666' },
  black: { nav: ['#181818', '#ffffff'], mark: '#82abf1', content: '#141414', dialog: '#292929', title: '#82abf1', primary: ['#82abf1', '#000000'], secondary: '#292929', pane: '#0a0a0a', menu: '#adadad' },
};

for (const theme of THEMES) {
  const want = WANT[theme];
  await check(`${theme}: la vista Archivo, como en Office`, async () => {
    await open('writer', theme);
    await fileView();
    await settle();
    assert.equal(await style('.nv-backstage__nav', 'backgroundColor'), rgb(want.nav[0]));
    assert.equal(await style('.nv-backstage__nav', 'color'), rgb(want.nav[1]));
    assert.equal(await style('.nv-backstage__content', 'backgroundColor'), rgb(want.content));
    assert.equal(await style('.nv-backstage__item.is-active', 'borderLeftColor', '::before'), rgb(want.mark));
    assert.equal(await style('.nv-backstage__item.is-active', 'color'), rgb(want.mark));
    // an entry under the mouse: a grey line, no change of background
    const other = page.locator('.nv-backstage__item:not(.is-active):not(:disabled)').first();
    await other.hover();
    await settle();
    assert.equal(await other.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
    await shot(`archivo-${theme}`);
  });

  await check(`${theme}: un cuadro de diálogo con sus botones`, async () => {
    await open('writer', theme);
    await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
    await page.locator('[data-nv-item="writer.link"]').first().click();
    await page.locator('.fui-DialogSurface').waitFor();
    await page.mouse.move(5, 500);
    await settle(400);
    assert.equal(await style('.fui-DialogSurface', 'backgroundColor'), rgb(want.dialog));
    assert.equal(await style('.fui-DialogTitle', 'color'), rgb(want.title));
    const buttons = await page.locator('.fui-DialogActions .fui-Button:not(:disabled)').evaluateAll((all) => all.map((b) => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color]));
    assert.ok(buttons.some(([bg, fg]) => bg === rgb(want.primary[0]) && fg === rgb(want.primary[1])), `botón principal: ${JSON.stringify(buttons)}`);
    assert.ok(buttons.some(([bg]) => bg === rgb(want.secondary)), `otros botones: ${JSON.stringify(buttons)}`);
    await shot(`cuadro-${theme}`);
  });

  await check(`${theme}: los paneles laterales`, async () => {
    for (const [app, selector] of [['diagram', '.dg-panel'], ['base', '.bs-nav-pane'], ['mail', '.ml-folders']]) {
      await open(app, theme);
      assert.equal(await style(selector, 'backgroundColor'), rgb(want.pane), app);
      await shot(`panel-${app}-${theme}`);
    }
    await open('writer', theme);
    await page.getByRole('tab', { name: 'Vista', exact: true }).click();
    await page.getByRole('button', { name: 'Panel de navegación', exact: true }).first().click();
    await settle(400);
    assert.equal(await style('.nw-nav', 'backgroundColor'), rgb(want.pane), 'writer');
    await shot(`panel-writer-${theme}`);
  });

  await check(`${theme}: los menús, con su borde y como la cinta`, async () => {
    await open('writer', theme);
    await page.getByRole('tab', { name: 'Vista', exact: true }).click();
    await page.click('[data-nv-item="themeMenu"]');
    await page.locator('.fui-MenuPopover').waitFor();
    assert.equal(await style('.fui-MenuPopover', 'borderTopColor'), rgb(want.menu));
    assert.equal(await style('.fui-MenuPopover', 'backgroundColor'), await style('.nv-ribbon__pinned', 'backgroundColor'));
    await shot(`menu-${theme}`);
    await page.keyboard.press('Escape');
  });
}

await check('Archivo › Cuenta cambia el tema al momento, y dice que no hay cuentas', async () => {
  await open('writer', 'colorful');
  await fileView();
  await page.getByRole('button', { name: 'Cuenta', exact: true }).click();
  const choice = page.getByRole('combobox', { name: 'Tema de SuiteNova' });
  assert.deepEqual((await choice.locator('option').allInnerTexts()).map((s) => s.trim()), ['Multicolor', 'Gris oscuro', 'Negro', 'Blanco', 'Utilizar la configuración del sistema']);
  for (const [value, mode] of [['darkgray', 'darkgray'], ['black', 'black'], ['white', 'white']]) {
    await choice.selectOption(value);
    await page.waitForFunction((m) => document.querySelector('[data-app]').dataset.theme === m, mode);
  }
  assert.match(await page.locator('.nv-backstage__content').innerText(), /no usa cuentas/);
  await shot('cuenta');
});

await check('el aviso de seguridad de Calc sigue al tema elegido, no al modo de Windows', async () => {
  const seen = async () =>
    page.evaluate(() => {
      const bar = document.createElement('div');
      bar.className = 'calc-secbar';
      document.querySelector('[data-app]').appendChild(bar);
      const color = getComputedStyle(bar).backgroundColor;
      bar.remove();
      return color;
    });
  await page.emulateMedia({ colorScheme: 'dark' });
  await open('calc', 'white');
  assert.equal(await seen(), 'rgb(255, 244, 206)');
  await page.emulateMedia({ colorScheme: 'light' });
  await setTheme('black');
  assert.equal(await seen(), 'rgb(74, 60, 0)');
});

// ------------------------------------------------------------------ every dialog and pane of every application
const SURFACES = ['.fui-DialogSurface', '.nv-panel', '.nv-backstage', '.fui-MenuPopover', '.fui-PopoverSurface'];
/** Commands that open something to look at: dialogs («…») and panes. The ones that touch files or the screen are left out. */
const WANTED = /…$|Panel|Comentarios|Revisión|Editor|Sinónimos|Capas|Datos de forma|Buscar|Reemplazar|Selección/;
const SKIP = /Guardar|Abrir…|Imprimir|Exportar|Importar|Recorte|Captura|Desde un archivo|Imagen…|Nuevo desde|Cerrar|Grabar|Leer en voz|Dictar|Sonido|Vídeo|Adjuntar|Insertar archivo|Reutilizar/;

const walkApp = async (app) => {
  const bad = new Map();
  const note = async (where) => {
    for (const theme of ['darkgray', 'black', 'white', 'colorful']) {
      await setTheme(theme);
      for (const line of await lowContrast(page, SURFACES)) {
        // one line for each different element, with the first place it was seen
        const key = `${theme} ${line.replace(/«.*?»/, '').replace(/^\S+ /, '')}`;
        if (!bad.has(key)) bad.set(key, `${theme} [${where}] ${line}`);
      }
    }
    await setTheme('darkgray');
  };
  const reset = async () => {
    for (let i = 0; i < 3; i++) {
      if (!(await page.locator('.fui-DialogSurface, .fui-MenuPopover, .fui-PopoverSurface, .nv-backstage').count())) return true;
      await page.keyboard.press('Escape');
      await settle(200);
    }
    const close = page.locator('.fui-DialogSurface').getByRole('button', { name: /^(Cancelar|Cerrar|Listo|Aceptar)$/ }).first();
    if (await close.count()) await close.click({ timeout: 2000 }).catch(() => {});
    await settle(200);
    return !(await page.locator('.fui-DialogSurface, .fui-MenuPopover, .fui-PopoverSurface').count());
  };
  await open(app, 'darkgray');
  let seen = 0;
  // the File view, page by page
  if (await page.locator('.nv-tab--file').count()) {
    await fileView();
    await settle();
    const pages = await page.locator('.nv-backstage__item').allInnerTexts();
    for (const label of pages.map((s) => s.trim()).filter((s) => /^(Información|Cuenta|Opciones|Ayuda|Propiedades)/.test(s))) {
      await page.locator('.nv-backstage__item', { hasText: label }).first().click();
      await settle();
      await note(`Archivo › ${label}`);
      seen++;
    }
    await reset();
  }
  const tabs = await page.locator('.nv-tabstrip [role="tab"]').allInnerTexts();
  const done = new Set();
  const startTab = async (tab) => {
    await page.locator('.nv-tabstrip [role="tab"]', { hasText: tab }).first().click({ timeout: 4000 });
    await settle(150);
  };
  for (const tab of tabs.map((s) => s.trim())) {
    try {
      await startTab(tab);
    } catch {
      // something left open covers the tabs: start again on a clean window
      await open(app, 'darkgray');
      await startTab(tab);
    }
    const items = await page.locator('.nv-ribbon__body [data-nv-item]').evaluateAll((all) =>
      all.map((e) => ({ id: e.dataset.nvItem, label: e.getAttribute('aria-label') ?? e.textContent.trim(), menu: e.getAttribute('aria-haspopup') })),
    );
    for (const item of items) {
      const entries = [];
      if (item.menu === 'menu') {
        // the entries of a menu
        try {
          await page.locator(`.nv-ribbon__body [data-nv-item="${item.id}"]`).first().click({ timeout: 3000 });
          await settle(150);
          await note(`${tab} › ${item.label} (menú)`);
          entries.push(...(await page.locator('.fui-MenuPopover [role="menuitem"]:not([aria-disabled="true"])').allInnerTexts()).map((s) => s.split('\n')[0].trim()).filter((s) => WANTED.test(s) && !SKIP.test(s)));
        } catch {
          /* disabled or hidden: nothing to look at */
        }
        if (!(await reset())) await open(app, 'darkgray');
      } else if (WANTED.test(item.label) && !SKIP.test(item.label)) entries.push(null);
      for (const entry of entries) {
        const name = entry ?? item.label;
        if (done.has(name)) continue;
        done.add(name);
        try {
          await startTab(tab);
          const button = page.locator(`.nv-ribbon__body [data-nv-item="${item.id}"]`).first();
          if (await button.isDisabled()) continue;
          await button.click({ timeout: 3000 });
          if (entry) await page.locator('.fui-MenuPopover [role="menuitem"]', { hasText: entry }).first().click({ timeout: 3000 });
          await settle(350);
          if (await page.locator('.fui-DialogSurface, .nv-panel, .fui-PopoverSurface').count()) {
            await note(`${tab} › ${name}`);
            seen++;
            if (shotsDir && (await page.locator('.fui-DialogSurface').count())) await shot(`walk-${app}-${seen}`);
          }
        } catch {
          /* a command that needs a selection, or that closed the ribbon: nothing to look at */
        }
        if (!(await reset())) await open(app, 'darkgray');
      }
    }
  }
  return { seen, bad: [...bad.values()] };
};

if (!process.argv.includes('--no-walk')) {
  for (const app of ['writer', 'calc', 'slides', 'notes', 'mail', 'base', 'diagram', 'plan', 'forms']) {
    if (only && !only.includes(app)) continue;
    await check(`${app}: el texto de sus cuadros, paneles, menús y vista Archivo se lee en los cuatro temas`, async () => {
      await newPage();
      const { seen, bad } = await walkApp(app);
      console.log(`      (${app}: ${seen} superficies revisadas)`);
      assert.ok(seen >= 3, `solo se revisaron ${seen}`);
      assert.equal(bad.length, 0, `\n${bad.join('\n')}`);
    });
  }
}

// ------------------------------------------------------------------ what only shows up while working
await check('al trabajar en Writer: comentario, búsqueda, ortografía, tabla, ecuación y lectura en voz alta se leen', async () => {
  await newPage();
  await open('writer', 'darkgray');
  const bad = [];
  const scopes = [...SURFACES, '.nv-sp-menu', '.nv-voicebar'];
  const seen = [];
  const look = async (where, needed) => {
    await settle(400);
    assert.ok(await page.locator(needed).count(), `${where}: no apareció ${needed}`);
    await shot(`trabajo-${seen.length}`);
    for (const theme of THEMES) {
      await setTheme(theme);
      for (const line of await lowContrast(page, scopes)) bad.push(`${theme} [${where}] ${line}`);
    }
    await setTheme('darkgray');
    seen.push(where);
  };
  const run = async (command) => {
    await page.locator('#nv-tellme').fill(command);
    await page.keyboard.press('Enter');
    await settle(300);
  };
  const editor = () => page.locator('.ProseMirror').first();
  await editor().click();
  await page.keyboard.type('Una cassa mal escrita para probar los paneles.');
  await settle(1500);
  await page.locator('.ProseMirror .nw-misspelled').first().click({ button: 'right' });
  await look('menú ortográfico', '.nv-sp-menu');
  await page.keyboard.press('Escape');
  await editor().click();
  await page.keyboard.press('Control+a');
  await run('Nuevo comentario');
  await page.keyboard.type('Un comentario de prueba.');
  await page.keyboard.press('Control+Enter');
  await look('comentarios', '.nv-panel');
  await open('writer', 'darkgray');
  await editor().click();
  await page.keyboard.type('casa y casa.');
  await page.keyboard.press('Control+h');
  await page.keyboard.type('casa');
  await look('buscar y reemplazar', '.nv-find-bar, .nv-panel');
  await open('writer', 'darkgray');
  await editor().click();
  await page.keyboard.type('Texto para leer en voz alta.');
  await run('Leer en voz alta');
  await look('lectura en voz alta', '.nv-voicebar');
  await open('writer', 'darkgray');
  await editor().click();
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
  await look('selector de tabla', '.fui-PopoverSurface, .fui-MenuPopover');
  await page.getByRole('gridcell', { name: '4 × 3', exact: true }).click();
  await settle(400);
  await page.locator('.nv-tab--contextual').first().click();
  await page.getByRole('button', { name: 'Estilos de tabla', exact: true }).click();
  await look('estilos de tabla', '.fui-PopoverSurface, .fui-MenuPopover');
  await open('writer', 'darkgray');
  await editor().click();
  await run('Ecuación…');
  await look('ecuación', '.fui-DialogSurface');
  console.log(`      (${seen.join(', ')})`);
  assert.equal(bad.length, 0, `\n${[...new Set(bad)].join('\n')}`);
});

await check('la ventana de inicio se lee en los cuatro temas', async () => {
  await open('', 'darkgray');
  const bad = [];
  for (const theme of THEMES) {
    await setTheme(theme);
    for (const line of await lowContrast(page, ['.hub'])) bad.push(`${theme} ${line}`);
    await shot(`inicio-${theme}`);
  }
  assert.equal(bad.length, 0, `\n${bad.join('\n')}`);
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
