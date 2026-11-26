// End-to-end checks of the application themes (as in Office): the five choices, the colours of each zone, saved values.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-app-theme.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, colorScheme: 'light' });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));

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
const open = async (app) => {
  await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load' });
  await page.waitForSelector('.nv-titlebar');
  await settle(500);
};
const choose = async (label) => {
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.click('[data-nv-item="themeMenu"]');
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await settle();
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await settle();
};
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
/** Background and text colour of each zone of the window. */
const zones = () =>
  page.evaluate(() => {
    const of = (sel) => {
      const s = getComputedStyle(document.querySelector(sel));
      return [s.backgroundColor, s.color];
    };
    return {
      mode: document.querySelector('[data-app]').dataset.theme,
      title: of('.nv-titlebar'),
      tabs: [of('.nv-ribbon__tabs')[0], of('.nv-tab:not(.is-active):not(.nv-tab--file)')[1]],
      line: getComputedStyle(document.querySelector('.nv-tab.is-active')).borderBottomColor,
      ribbon: of('.nv-ribbon')[0],
      status: of('.nv-status'),
    };
  });
const expect = async (mode, want) => {
  const z = await zones();
  assert.equal(z.mode, mode);
  assert.deepEqual(z.title, want.title.map(rgb), 'barra de título');
  assert.deepEqual(z.tabs, want.tabs.map(rgb), 'pestañas');
  assert.equal(z.line, rgb(want.line), 'subrayado');
  assert.equal(z.ribbon, rgb(want.ribbon), 'cinta');
  assert.deepEqual(z.status, want.status.map(rgb), 'barra de estado');
};

const white = '#ffffff';
const dark = '#242424';
const WANT = {
  Multicolor: { app: { writer: '#185abd', calc: '#107c41', slides: '#c43e1c' }, line: { writer: '#1651aa', calc: '#0f703b', slides: '#b13719' } },
  Blanco: { mode: 'white', title: ['#e6e6e6', dark], tabs: ['#e6e6e6', dark], ribbon: white, status: ['#f5f5f5', dark], line: { writer: '#1651aa', calc: '#0f703b', slides: '#b13719' } },
  'Gris oscuro': { mode: 'darkgray', title: ['#525252', white], tabs: ['#525252', white], ribbon: '#bdbdbd', status: ['#525252', white], line: { writer: '#aec6f0', calc: '#a0d8b9', slides: '#edbcb0' } },
  Negro: { mode: 'black', title: ['#1a1a1a', white], tabs: ['#1a1a1a', white], ribbon: '#292929', status: ['#141414', white], line: { writer: '#82abf1', calc: '#60bd82', slides: '#e1966d' } },
};
const want = (label, app) =>
  label === 'Multicolor'
    ? { title: [WANT.Multicolor.app[app], white], tabs: ['#e6e6e6', dark], ribbon: white, status: ['#f5f5f5', dark], line: WANT.Multicolor.line[app] }
    : { ...WANT[label], line: WANT[label].line[app] };

await open('writer');
await page.evaluate(() => localStorage.removeItem('suitenova.theme'));

for (const app of ['writer', 'calc', 'slides']) {
  await open(app);
  for (const label of ['Multicolor', 'Blanco', 'Gris oscuro', 'Negro']) {
    await check(`${app}: «${label}» pinta cada zona como Office`, async () => {
      await choose(label);
      await shot(`${app}-${WANT[label].mode ?? 'colorful'}`);
      await expect(WANT[label].mode ?? 'colorful', want(label, app));
    });
  }
}

await check('the menu lists the five themes of Office and marks the chosen one', async () => {
  await open('writer');
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.click('[data-nv-item="themeMenu"]');
  const items = page.getByRole('menu').getByRole('menuitem');
  assert.deepEqual((await items.allInnerTexts()).map((s) => s.trim()), ['Multicolor', 'Gris oscuro', 'Negro', 'Blanco', 'Utilizar la configuración del sistema']);
  // the menu is mounted outside the frame and still gets the colours of the theme
  const accent = await items.first().evaluate((el) => getComputedStyle(el).getPropertyValue('--nv-accent').trim());
  assert.equal(accent, '#185abd');
  await shot('menu');
  await page.keyboard.press('Escape');
});

await check('the choice is kept after reloading, in every window', async () => {
  await choose('Gris oscuro');
  await open('calc');
  await expect('darkgray', want('Gris oscuro', 'calc'));
});

await check('«use system setting» follows Windows, live', async () => {
  await open('writer');
  await choose('Utilizar la configuración del sistema');
  await expect('white', want('Blanco', 'writer'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await settle();
  await expect('black', want('Negro', 'writer'));
  await page.emulateMedia({ colorScheme: 'light' });
  await settle();
  await expect('white', want('Blanco', 'writer'));
});

await check('a theme saved by the previous version is converted', async () => {
  for (const [old, mode] of [['light', 'colorful'], ['dark', 'black'], ['contrast', 'white']]) {
    await page.evaluate((v) => localStorage.setItem('suitenova.theme', JSON.stringify(v)), old);
    await open('writer');
    assert.equal((await zones()).mode, mode, old);
  }
});

await check('Windows high contrast applies over the chosen theme and Options says so', async () => {
  await page.evaluate(() => localStorage.setItem('suitenova.theme', JSON.stringify('white')));
  await open('writer');
  await page.emulateMedia({ forcedColors: 'active' });
  await settle();
  assert.equal((await zones()).mode, 'contrast');
  await page.getByRole('tab', { name: 'Archivo', exact: true }).or(page.getByRole('button', { name: 'Archivo', exact: true })).first().click();
  await page.getByRole('button', { name: 'Opciones', exact: true }).click();
  assert.match(await page.getByRole('note').innerText(), /contraste alto/);
  assert.ok(await page.getByRole('radio', { name: 'Blanco', exact: true }).isChecked());
  await page.emulateMedia({ forcedColors: 'none' });
  await settle();
  assert.equal(await page.getByRole('note').count(), 0);
  await page.getByRole('radio', { name: 'Negro', exact: true }).check();
  await settle();
  assert.equal((await zones()).mode, 'black');
  await shot('options');
  await page.keyboard.press('Escape');
});

await check('the other modules and the start window take the theme', async () => {
  await page.evaluate(() => localStorage.setItem('suitenova.theme', JSON.stringify('darkgray')));
  for (const app of ['', 'notes', 'mail', 'base', 'diagram', 'plan', 'forms']) {
    await open(app);
    const z = await zones();
    assert.equal(z.mode, 'darkgray', app);
    assert.deepEqual(z.title, ['#525252', white].map(rgb), app || 'inicio');
    await shot(`other-${app || 'hub'}`);
  }
});

await page.evaluate(() => localStorage.removeItem('suitenova.theme'));
await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? `  ✔ ${r[1]}` : `  ✘ ${r[1]}\n      ${r[2]}`);
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', errors.slice(0, 5));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
