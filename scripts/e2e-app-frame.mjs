// End-to-end checks of the window frame in the application themes: title bar, tabs, ribbon card, buttons, status bar and
// canvas, with the sizes and colours measured on Office (docs/office-temas/MEDIDAS.md).
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-app-frame.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, colorScheme: 'light' });
const errors = [];
let page;
const newPage = async () => {
  page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  // leaving a window with unsaved changes asks first; here the changes are thrown away
  page.on('dialog', (d) => d.accept().catch(() => {}));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
};
await newPage();

const results = [];
const check = async (name, fn) => {
  try {
    // an evaluation inside a frozen page never returns, so every check has a limit of its own
    let timer;
    await Promise.race([fn(), new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('sin respuesta en 240 s')), 240000)))]).finally(() => clearTimeout(timer));
    results.push(['ok', name]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png`, timeout: 5000 }).catch(() => {});
    results.push(['FAIL', name]);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 12).join(' | ')}`);
    // start the next check on a clean page, also if this one stopped answering
    await page.close().catch(() => {});
    await newPage();
  }
};
const settle = (ms = 250) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const visit = async (app, theme, collapsed) => {
  if (!page.url().startsWith(BASE)) await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await page.evaluate(
    ([t, c]) => {
      localStorage.setItem('suitenova.theme', JSON.stringify(t));
      localStorage.setItem('suitenova.ribbonCollapsed', JSON.stringify(c));
    },
    [theme, collapsed],
  );
  await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('.nv-titlebar');
};
/**
 * The development server serves hundreds of modules and, about once in fifty openings, leaves their requests waiting for
 * good (seen with every application, before any of its code runs). A second try on a new page is enough; it is reported.
 */
const open = async (app, theme, { collapsed = false } = {}) => {
  try {
    await visit(app, theme, collapsed);
  } catch (e) {
    console.log(`      (la apertura de «${app || 'inicio'}» se quedó colgada; segundo intento: ${e.message.split('\n')[0]})`);
    await page.close().catch(() => {});
    await newPage();
    try {
      await visit(app, theme, collapsed);
    } catch (again) {
      throw new Error(`abrir «${app || 'inicio'}» en ${theme}: ${again.message.split('\n')[0]}`);
    }
  }
  await settle(600);
  await page.mouse.move(700, 600);
};
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const css = (selector, props, pseudo) =>
  page.locator(selector).first().evaluate(
    (el, [names, p]) => {
      const s = getComputedStyle(el, p);
      return Object.fromEntries(names.map((n) => [n, s[n]]));
    },
    [props, pseudo ?? null],
  );
const box = (selector) => page.locator(selector).first().boundingBox();

const THEMES = {
  colorful: { search: '#8a8a8a', tabHover: '#d1d1d1', pressed: ['#ebebeb', '#616161'], disabled: '#bdbdbd', field: '#8a8a8a', qat: '#1651aa', hover: '#f5f5f5', canvas: '#ececec' },
  white: { search: '#d6d6d6', tabHover: '#d1d1d1', pressed: ['#ebebeb', '#616161'], disabled: '#bdbdbd', field: '#8a8a8a', qat: '#fdfdfd', hover: '#f5f5f5', canvas: '#ececec' },
  darkgray: { search: '#808080', tabHover: '#6b6b6b', pressed: ['#cccccc', '#7a7a7a'], disabled: '#858585', field: '#666666', qat: '#646464', hover: '#d1d1d1', canvas: '#555555' },
  black: { search: '#757575', tabHover: '#666666', pressed: ['#383838', '#adadad'], disabled: '#5c5c5c', field: '#757575', qat: '#303030', hover: '#3d3d3d', canvas: '#1c1c1c' },
};

for (const [theme, want] of Object.entries(THEMES)) {
  await check(`${theme}: tamaños de Office (barra de 48 px, buscador centrado, pestañas de 31 px, cinta en tarjeta)`, async () => {
    await open('writer', theme);
    await shot(`writer-${theme}`);
    assert.equal((await box('.nv-titlebar')).height, 48);
    const search = await box('.nv-tellme');
    assert.equal(search.height, 32);
    assert.equal(search.width, 368);
    assert.ok(Math.abs(search.x + search.width / 2 - 700) <= 1, `buscador centrado: ${search.x}`);
    assert.equal((await css('.nv-tellme', ['borderTopColor'])).borderTopColor, rgb(want.search));
    assert.equal((await box('.nv-ribbon__tabs')).height, 31);
    const card = await box('.nv-ribbon__pinned');
    assert.deepEqual([card.x, card.width, card.height], [8, 1384, 100]);
    assert.equal((await css('.nv-ribbon__pinned', ['borderTopLeftRadius'])).borderTopLeftRadius, '8px');
    // a strip of the frame colour separates the card from the document
    const ribbon = await box('.nv-ribbon');
    assert.equal(ribbon.y + ribbon.height - (card.y + card.height), 5);
    assert.equal((await css('.nv-ribbon', ['backgroundColor'])).backgroundColor, (await css('.nv-ribbon__tabs', ['backgroundColor'])).backgroundColor);
  });

  await check(`${theme}: pestañas, botones y cuadros con los estados medidos`, async () => {
    await open('writer', theme);
    // «Archivo» is plain text, like the other tabs
    assert.equal((await css('.nv-tab--file', ['backgroundColor'])).backgroundColor, 'rgba(0, 0, 0, 0)');
    const other = page.getByRole('tab', { name: 'Insertar', exact: true });
    await other.hover();
    await settle();
    assert.equal(await other.evaluate((el) => getComputedStyle(el, '::after').borderBottomColor), rgb(want.tabHover));
    assert.equal(await other.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    // a button that is on
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.press('Control+b');
    await page.mouse.move(700, 600);
    await settle();
    const bold = await css('.nv-btn[aria-pressed="true"]', ['backgroundColor', 'borderTopColor']);
    assert.deepEqual(bold, { backgroundColor: rgb(want.pressed[0]), borderTopColor: rgb(want.pressed[1]) });
    // under the mouse: only the background changes
    const plain = page.locator('.nv-ribbon__body .nv-btn:not([aria-pressed="true"]):not(:disabled)').first();
    await plain.hover();
    await settle();
    assert.equal(await plain.evaluate((el) => getComputedStyle(el).backgroundColor), rgb(want.hover));
    assert.equal(await plain.evaluate((el) => getComputedStyle(el).borderTopColor), 'rgba(0, 0, 0, 0)');
    const off = page.locator('.nv-ribbon__body .nv-btn:disabled').first();
    assert.equal(await off.evaluate((el) => getComputedStyle(el).color), rgb(want.disabled));
    assert.equal((await css('.nv-ribbon__body select', ['borderTopColor'])).borderTopColor, rgb(want.field));
    const qat = page.locator('.nv-qat__btn:not(:disabled)').first();
    await qat.hover();
    await settle();
    assert.equal(await qat.evaluate((el) => getComputedStyle(el).backgroundColor), rgb(want.qat));
    await shot(`states-${theme}`);
  });

  await check(`${theme}: el lienzo de Writer, Slides, Diagram y Forms`, async () => {
    // the colour really seen next to the page: the first background under a point just inside the left edge
    for (const [app, selector] of [['writer', '.nw-scroll'], ['slides', '.sl-stagearea'], ['diagram', '.dg-scroller'], ['forms', '.fm-scroll']]) {
      await open(app, theme);
      const area = await box(selector);
      const seen = await page.evaluate(
        ([x, y]) => {
          for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) {
            const c = getComputedStyle(e).backgroundColor;
            if (c !== 'rgba(0, 0, 0, 0)') return c;
          }
          return '';
        },
        [area.x + 6, area.y + area.height / 2],
      );
      assert.equal(seen, rgb(want.canvas), app);
      await shot(`canvas-${app}-${theme}`);
    }
  });

  await check(`${theme}: la cinta plegada se abre como tarjeta flotante`, async () => {
    await open('writer', theme, { collapsed: true });
    assert.equal(await page.locator('.nv-ribbon__body').count(), 0);
    assert.equal((await box('.nv-ribbon')).height, 31);
    await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
    await settle();
    const card = await box('.nv-ribbon__popup');
    assert.deepEqual([card.x, card.width, card.height], [8, 1384, 100]);
    assert.equal((await css('.nv-ribbon__popup', ['borderTopLeftRadius'])).borderTopLeftRadius, '8px');
    await shot(`collapsed-${theme}`);
  });
}

/**
 * Contrast of every visible text of the frame and of what is written straight on the canvas, against the background it
 * really has. Disabled controls are exempt, as in WCAG.
 */
const lowContrast = (scopes, minimum) =>
  page.evaluate(
    ([selectors, min]) => {
      const parse = (c) => {
        const n = (c.match(/-?[\d.]+(e-?\d+)?/g) ?? []).map(Number);
        const scale = c.startsWith('color(') ? 255 : 1;
        return n.length < 3 ? [0, 0, 0, 0] : [n[0] * scale, n[1] * scale, n[2] * scale, n.length > 3 ? n[3] : 1];
      };
      const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
      const background = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c[3] > 0) layers.push(c);
          if (c[3] === 1) break;
        }
        return layers.reduceRight((under, layer) => over(layer, under), [255, 255, 255]);
      };
      const lum = (c) => {
        const [r, g, b] = c.map((v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bad = [];
      for (const scope of selectors) {
        for (const root of document.querySelectorAll(scope)) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const el = node.parentElement;
            const text = node.textContent.trim();
            if (!text || el.closest(':disabled, [aria-disabled="true"], option')) continue;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            if (r.width < 2 || r.height < 2 || s.visibility !== 'visible') continue;
            const bg = background(el);
            const fg = over(parse(s.color), bg);
            const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
            const ratio = (hi + 0.05) / (lo + 0.05);
            if (ratio < min) bad.push(`${scope} «${text.slice(0, 30)}» ${ratio.toFixed(2)}`);
          }
        }
      }
      return [...new Set(bad)];
    },
    [scopes, minimum],
  );

const APPS = ['', 'writer', 'calc', 'slides', 'notes', 'mail', 'base', 'diagram', 'plan', 'forms'];
for (const theme of Object.keys(THEMES)) {
  await check(`${theme}: el texto del marco se lee en las nueve aplicaciones y en el inicio`, async () => {
    const bad = [];
    for (const app of APPS) {
      await open(app, theme);
      for (const b of await lowContrast(['.nv-titlebar', '.nv-ribbon', '.nv-status'], 4.5)) bad.push(`${app || 'inicio'}: ${b}`);
    }
    assert.deepEqual(bad, []);
  });
}

await check('una pestaña contextual se lee en los cuatro temas', async () => {
  for (const theme of Object.keys(THEMES)) {
    await open('writer', theme);
    await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
    await page.getByRole('button', { name: 'Formas', exact: true }).click();
    await page.locator('[data-shape="ellipse"]').click();
    await settle(500);
    // a click on the border selects the shape (in the middle it would put the cursor in its text)
    const shape = await box('.nw-shape-ellipse');
    await page.mouse.click(shape.x + 2, shape.y + shape.height / 2);
    const tab = page.locator('.nv-tab--contextual').first();
    await tab.waitFor();
    await tab.click();
    await settle();
    await shot(`contextual-${theme}`);
    assert.deepEqual(await lowContrast(['.nv-ribbon__tabs'], 4.5), [], theme);
  }
});

await check('lo escrito directamente sobre el lienzo se lee (clasificador y página de notas de Slides, Forms)', async () => {
  const bad = [];
  for (const theme of Object.keys(THEMES)) {
    await open('slides', theme);
    await page.getByRole('tab', { name: 'Vista', exact: true }).click();
    await page.getByRole('button', { name: /^Clasificador/ }).first().click();
    await settle(400);
    await shot(`sorter-${theme}`);
    for (const b of await lowContrast(['.sl-sorter'], 4.5)) bad.push(`${theme}: ${b}`);
    await page.getByRole('button', { name: /^Página de notas/ }).first().click();
    await settle(400);
    for (const b of await lowContrast(['.sl-notespage__bar'], 4.5)) bad.push(`${theme}: ${b}`);
    await open('forms', theme);
    for (const b of await lowContrast(['.fm-app'], 4.5)) bad.push(`${theme}: ${b}`);
    await page.getByRole('tab', { name: 'Vista', exact: true }).click();
    await page.click('[data-nv-item="forms.mode.results"]');
    await settle(400);
    await shot(`forms-results-${theme}`);
    for (const b of await lowContrast(['.fm-app'], 4.5)) bad.push(`${theme} (resultados): ${b}`);
    // the other windows with a canvas, as they open: nothing on or around the page may become unreadable
    for (const [app, selector] of [['writer', '.nw-app'], ['slides', '.sl-app'], ['diagram', '.dg-app']]) {
      await open(app, theme);
      for (const b of await lowContrast([selector], 3)) bad.push(`${theme}: ${b}`);
    }
  }
  assert.deepEqual(bad, []);
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', errors.slice(0, 5));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
