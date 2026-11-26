// End-to-end checks of the single title bar in the browser, with a stand-in for the desktop window: the three buttons,
// what they ask for, their place and colours, and the question before leaving unsaved changes. The real window is checked
// by e2e-window-native.mjs. Needs `pnpm dev` on :1420. Usage: node scripts/e2e-window.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const errors = [];
let ctx;
let page;
/** A new window; with `host`, the page believes it is a desktop window without title bar. */
const fresh = async ({ host = true, width = 1400 } = {}) => {
  await ctx?.close();
  ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: 'light' });
  if (host) {
    await ctx.addInitScript(() => {
      const calls = [];
      const resize = new Set();
      let maximized = false;
      window.__windowCalls = calls;
      window.__novaWindowHost = {
        minimize: () => calls.push('minimize'),
        toggleMaximize: () => {
          calls.push('toggleMaximize');
          maximized = !maximized;
          resize.forEach((f) => f());
        },
        close: () => calls.push('close'),
        isMaximized: async () => maximized,
        onResize: (f) => {
          resize.add(f);
          return () => resize.delete(f);
        },
        setBackground: (c) => calls.push(`background ${c}`),
      };
    });
  }
  page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
};

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png`, timeout: 5000 }).catch(() => {});
    results.push(['FAIL', name]);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 10).join(' | ')}`);
  }
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const open = async (app, theme = 'colorful') => {
  const url = `${BASE}?app=${app}`;
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      break;
    } catch (e) {
      if (attempt) throw e; // the development server sometimes stalls (see e2e-app-frame.mjs)
    }
  }
  await page.waitForSelector('.nv-titlebar');
  await page.evaluate((t) => localStorage.setItem('suitenova.theme', JSON.stringify(t)), theme);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.nv-titlebar');
  await settle(600);
};
const calls = () => page.evaluate(() => window.__windowCalls.filter((c) => !c.startsWith('background')));
const button = (name) => page.getByRole('group', { name: 'Ventana' }).getByRole('button', { name, exact: true });
/** The element a click at the centre of the close button would reach. */
const hitOnClose = () =>
  page.evaluate(() => {
    const r = document.querySelector('.nv-wincontrol--close').getBoundingClientRect();
    return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.nv-wincontrol--close');
  });

await check('sin ventana de escritorio no hay botones ni zonas de arrastre', async () => {
  await fresh({ host: false });
  await open('writer');
  assert.equal(await page.locator('.nv-wincontrols').count(), 0);
  assert.equal(await page.locator('.nv-titlebar[data-tauri-drag-region]').count(), 0);
});

await check('minimizar, maximizar y cerrar en la esquina, del alto de la barra, con el buscador centrado', async () => {
  await fresh();
  await open('writer');
  await shot('botones');
  const boxes = [];
  for (const name of ['Minimizar', 'Maximizar', 'Cerrar ventana']) boxes.push(await button(name).boundingBox());
  assert.deepEqual(boxes.map((b) => [b.x, b.y, b.width, b.height]), [[1259, 0, 47, 48], [1306, 0, 47, 48], [1353, 0, 47, 48]]);
  const search = await page.locator('.nv-tellme').boundingBox();
  assert.ok(Math.abs(search.x + search.width / 2 - 700) <= 1, `buscador centrado: ${search.x}`);
});

await check('cada botón pide lo suyo y el de maximizar pasa a restaurar', async () => {
  await button('Minimizar').click();
  await button('Maximizar').click();
  await button('Restaurar').waitFor();
  assert.equal(await page.locator('[data-glyph="restore"]').count(), 1);
  await button('Restaurar').click();
  await button('Maximizar').waitFor();
  await button('Cerrar ventana').click();
  assert.deepEqual(await calls(), ['minimize', 'toggleMaximize', 'toggleMaximize', 'close']);
});

await check('la barra se arrastra entera salvo el buscador y los botones', async () => {
  assert.equal(await page.locator('.nv-titlebar').getAttribute('data-tauri-drag-region'), 'deep');
  assert.equal(await page.locator('.nv-tellme').getAttribute('data-tauri-drag-region'), 'false');
});

await check('colores bajo el ratón (medidos en Office) y fondo de la ventana según el tema', async () => {
  for (const [theme, hover, frame] of [['colorful', 'rgb(22, 81, 170)', '#e6e6e6'], ['white', 'rgb(253, 253, 253)', '#e6e6e6'], ['darkgray', 'rgb(100, 100, 100)', '#525252'], ['black', 'rgb(48, 48, 48)', '#1a1a1a']]) {
    await open('writer', theme);
    await button('Minimizar').hover();
    await settle(150);
    assert.equal(await button('Minimizar').evaluate((e) => getComputedStyle(e).backgroundColor), hover, theme);
    await button('Cerrar ventana').hover();
    await settle(150);
    assert.deepEqual(await button('Cerrar ventana').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]), ['rgb(232, 17, 35)', 'rgb(255, 255, 255)'], theme);
    assert.equal(await page.evaluate(() => window.__windowCalls.filter((c) => c.startsWith('background')).at(-1)), `background ${frame}`, theme);
    await shot(`hover-${theme}`);
  }
});

await check('la vista Archivo deja la barra de título a la vista', async () => {
  await open('writer');
  await page.getByRole('button', { name: 'Archivo', exact: true }).click();
  await settle();
  assert.equal((await page.locator('.nv-backstage').boundingBox()).y, 48);
  assert.ok(await hitOnClose());
  await shot('archivo');
  await page.keyboard.press('Escape');
});

await check('con un cuadro de diálogo abierto los botones de la ventana siguen funcionando', async () => {
  await open('writer');
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Marcador…', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.ok(await hitOnClose());
  await button('Minimizar').click();
  assert.deepEqual(await calls(), ['minimize']);
  assert.equal(await page.getByRole('dialog').count(), 1, 'el cuadro sigue abierto');
  await shot('dialogo');
});

await check('las nueve aplicaciones y el inicio tienen los botones, también en una ventana estrecha', async () => {
  for (const width of [1400, 640]) {
    await fresh({ width });
    for (const app of ['', 'writer', 'calc', 'slides', 'notes', 'mail', 'base', 'diagram', 'plan', 'forms']) {
      await open(app);
      const b = await button('Cerrar ventana').boundingBox();
      assert.deepEqual([b.x + b.width, b.y], [width, 0], `${app || 'inicio'} a ${width}`);
      assert.ok(await hitOnClose(), `${app || 'inicio'} a ${width}: tapado`);
      assert.ok((await page.locator('.nv-tellme').boundingBox()).width >= 180, `${app || 'inicio'} a ${width}: buscador`);
    }
    await shot(`estrecha-${width}`);
  }
});

await check('salir con cambios sin guardar pregunta; sin cambios, no', async () => {
  await fresh({ host: false });
  await open('writer');
  let asked = 0;
  page.on('dialog', (d) => {
    if (d.type() === 'beforeunload') asked++;
    void d.accept();
  });
  await page.reload({ waitUntil: 'load' });
  assert.equal(asked, 0);
  await page.waitForSelector('.ProseMirror');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Un cambio.');
  await settle();
  await page.reload({ waitUntil: 'load' });
  assert.equal(asked, 1);
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', errors.slice(0, 5));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
