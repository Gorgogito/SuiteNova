// Closing checks of the application themes: Windows high contrast (dark and light contrast themes, also changed while the
// window is open), «Use system setting» following Windows, several windows at once, the keyboard focus ring in every
// zone and theme, and the time a change of theme takes.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-app-close.mjs [--shots dir]
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
const watch = (p) => {
  p.setDefaultTimeout(15000);
  p.on('dialog', (d) => d.accept().catch(() => {}));
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/Keyborg|404|beforeunload/.test(m.text()) && errors.push(m.text()));
};
/** A clean profile: nothing saved from the check before. */
const fresh = async (options = {}) => {
  await ctx?.close();
  ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light', ...options });
  page = await ctx.newPage();
  watch(page);
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
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 40).join('\n      ')}`);
  }
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const APPS = ['', 'writer', 'calc', 'slides', 'notes', 'mail', 'base', 'diagram', 'plan', 'forms'];
const THEMES = ['colorful', 'white', 'darkgray', 'black'];
const modeOf = (p) => p.evaluate(() => document.querySelector('[data-app]')?.dataset.theme);
const waitMode = (p, mode) => p.waitForFunction((m) => document.querySelector('[data-app]')?.dataset.theme === m, mode);
const goto = async (p, app) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await p.goto(`${BASE}?app=${app}`, { waitUntil: 'load', timeout: 45000 });
      await p.waitForSelector('.nv-titlebar', { timeout: 30000 });
      break;
    } catch (e) {
      if (attempt) throw e; // the development server sometimes stalls (see e2e-app-frame.mjs)
    }
  }
  await p.waitForTimeout(600);
};
const open = (app) => goto(page, app);
const setTheme = async (theme, p = page) => {
  await p.evaluate((t) => window.__novaSettings.set('theme', t), theme);
  await waitMode(p, theme);
  await p.waitForTimeout(250);
};
const css = (selector, prop, pseudo = null) => page.locator(selector).first().evaluate((e, [p, s]) => getComputedStyle(e, s)[p], [prop, pseudo]);
const WHITE = 'rgb(255, 255, 255)';
const BLACK = 'rgb(0, 0, 0)';
/** The colour of a point of the grid of Calc, read from its canvas. */
const pixel = (x, y) =>
  page.evaluate(
    ([px, py]) => {
      const c = document.querySelector('.calc-grid__canvas');
      const d = c.getContext('2d').getImageData(Math.round(px * devicePixelRatio), Math.round(py * devicePixelRatio), 1, 1).data;
      return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
    },
    [x, y],
  );

// ------------------------------------------------------------------ Windows high contrast
for (const [scheme, canvas, ink] of [['dark', BLACK, WHITE], ['light', WHITE, BLACK]]) {
  const kind = scheme === 'dark' ? 'oscuro' : 'claro';
  await check(`contraste alto ${kind}: manda sobre el tema elegido en todas las aplicaciones`, async () => {
    await fresh({ colorScheme: scheme, forcedColors: 'active' });
    for (const app of APPS) {
      await open(app);
      assert.equal(await modeOf(page), 'contrast', app || 'inicio');
      await page.evaluate(() => window.__novaSettings.set('theme', 'colorful'));
      await settle(150);
      assert.equal(await modeOf(page), 'contrast', app || 'inicio');
      await shot(`hc-${kind}-${app || 'inicio'}`);
    }
  });

  await check(`contraste alto ${kind}: Writer marca el borde de la página, el resaltado, la búsqueda y las muestras de color`, async () => {
    await fresh({ colorScheme: scheme, forcedColors: 'active' });
    await open('writer');
    assert.equal(await css('.nw-page', 'outlineStyle'), 'solid');
    assert.equal(await css('.nw-page', 'outlineColor'), ink);
    const editor = page.locator('.ProseMirror').first();
    await editor.click();
    await page.keyboard.type('casa y casa.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('marcado');
    await page.keyboard.press('Shift+Home');
    await page.getByRole('button', { name: 'Resaltado', exact: true }).click();
    await settle(500);
    const mark = '.ProseMirror span[style*="background"]';
    assert.equal(await css(mark, 'forcedColorAdjust'), 'none');
    assert.notEqual(await css(mark, 'backgroundColor'), canvas, 'el resaltado se ve');
    await editor.click();
    await page.keyboard.press('Control+h');
    await settle(400);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('casa');
    await settle(500);
    assert.notEqual(await css('.nw-find', 'backgroundColor'), 'rgba(0, 0, 0, 0)');
    assert.notEqual(await css('.nw-find-cur', 'backgroundColor'), 'rgba(0, 0, 0, 0)');
    await shot(`hc-${kind}-writer-buscar`);
    await page.keyboard.press('Escape');
    assert.equal(await css('.nv-colorbar', 'forcedColorAdjust'), 'none');
    await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
    await page.getByRole('button', { name: 'Insertar tabla', exact: true }).click();
    await page.getByRole('gridcell', { name: '3 × 3', exact: true }).hover();
    await settle();
    const inside = await css('.nv-tbl-grid button[data-on="true"]', 'backgroundColor');
    assert.notEqual(inside, await css('.nv-tbl-grid button[data-on="false"]', 'backgroundColor'), 'las celdas elegidas se distinguen');
    await shot(`hc-${kind}-tabla`);
  });

  await check(`contraste alto ${kind}: la hoja de Calc usa los colores del sistema y los gráficos de Plan también`, async () => {
    await fresh({ colorScheme: scheme, forcedColors: 'active' });
    await open('calc');
    assert.equal(await pixel(290, 230), canvas, 'celda');
    assert.equal(await pixel(290, 3), canvas, 'encabezado');
    await shot(`hc-${kind}-calc`);
    await open('plan');
    await page.getByRole('button', { name: 'Añadir la primera tarea', exact: true }).click();
    await settle(500);
    const head = await page.evaluate(() => {
      const rect = document.querySelector('.pl-app svg rect[class]');
      return rect && getComputedStyle(rect).fill;
    });
    assert.equal(head, canvas, 'el dibujo del Gantt sigue al tema de contraste');
    await shot(`hc-${kind}-plan`);
  });

  await check(`contraste alto ${kind}: la diapositiva y el diagrama conservan sus colores, con su borde`, async () => {
    await fresh({ colorScheme: scheme, forcedColors: 'active' });
    await open('slides');
    assert.equal(await css('.sl-stagearea .sl-slide', 'forcedColorAdjust'), 'none');
    assert.equal(await css('.sl-stagearea .sl-slide', 'backgroundColor'), WHITE);
    assert.equal(await css('.sl-stagearea .sl-slide', 'outlineColor'), ink);
    await shot(`hc-${kind}-slides`);
    await open('diagram');
    assert.equal(await css('.dg-svg', 'forcedColorAdjust'), 'none');
    await shot(`hc-${kind}-diagram`);
  });
}

await check('el contraste alto se activa, cambia de oscuro a claro y se quita con la ventana abierta', async () => {
  await fresh();
  await open('calc');
  assert.equal(await modeOf(page), 'white');
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  await waitMode(page, 'contrast');
  await settle(500);
  assert.equal(await pixel(290, 230), BLACK);
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
  await settle(500);
  assert.equal(await pixel(290, 230), WHITE);
  await page.emulateMedia({ forcedColors: 'none', colorScheme: 'dark' });
  await waitMode(page, 'black');
  await settle(500);
  assert.equal(await pixel(290, 230), WHITE, 'sin contraste alto la hoja es blanca');
  assert.equal(await pixel(290, 3), 'rgb(10, 10, 10)');
});

// ------------------------------------------------------------------ «Use system setting»
await check('«Utilizar la configuración del sistema» sigue a Windows con la ventana abierta, en todas las aplicaciones', async () => {
  await fresh();
  for (const app of APPS) {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(app);
    assert.equal(await modeOf(page), 'white', app || 'inicio');
    await page.emulateMedia({ colorScheme: 'dark' });
    await waitMode(page, 'black');
    await page.emulateMedia({ colorScheme: 'light' });
    await waitMode(page, 'white');
  }
});

// ------------------------------------------------------------------ several windows
await check('con varias ventanas, el cambio de tema llega a todas, también a un cuadro abierto, y a las nuevas', async () => {
  await fresh();
  const others = [page];
  await open('writer');
  for (const app of ['calc', 'slides', '']) {
    const p = await ctx.newPage();
    watch(p);
    await goto(p, app);
    others.push(p);
  }
  const [writer, calc] = others;
  // a dialog open in one window while the theme changes in another
  await writer.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await writer.locator('[data-nv-item="writer.link"]').first().click();
  await writer.locator('.fui-DialogSurface').waitFor();
  const dialogColour = () => writer.locator('.fui-DialogSurface').evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.equal(await dialogColour(), WHITE);
  for (const theme of ['black', 'darkgray', 'colorful']) {
    await setTheme(theme, calc);
    for (const p of others) await waitMode(p, theme);
    await writer.waitForTimeout(300);
    assert.equal(await dialogColour(), { black: 'rgb(41, 41, 41)', darkgray: 'rgb(82, 82, 82)', colorful: WHITE }[theme], theme);
  }
  await setTheme('darkgray', others[2]);
  const later = await ctx.newPage();
  watch(later);
  await goto(later, 'notes');
  assert.equal(await modeOf(later), 'darkgray');
});

// ------------------------------------------------------------------ keyboard focus
/** Controls with a ring of their own colour that does not reach 3:1 against what is around it. */
const faintRings = () =>
  page.evaluate(() => {
    const parse = (c) => {
      const n = (c.match(/-?[\d.]+(e-?\d+)?/g) ?? []).map(Number);
      return n.length < 3 ? [0, 0, 0, 0] : [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    };
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (h + 0.05) / (l + 0.05);
    };
    const behind = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0.5) return c;
      }
      return [255, 255, 255];
    };
    // areas that show the focus by what is selected in them, boxes that show it with the caret, and the buttons of
    // Fluent, which draw theirs only after a real key press
    const left = '.calc-grid, .calc-editor, .sl-stagearea, .dg-scroller, .ml-list__scroll, .nn-title, .fui-Button';
    const bad = [];
    const seen = new Set();
    let count = 0;
    for (const el of document.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || el.disabled || el.matches(left) || getComputedStyle(el).visibility !== 'visible') continue;
      const key = `${el.tagName.toLowerCase()}.${typeof el.className === 'string' ? el.className.split(' ')[0] : ''}`;
      if (seen.has(key)) continue;
      el.focus({ focusVisible: true });
      if (document.activeElement !== el) continue;
      seen.add(key);
      count++;
      const own = getComputedStyle(el);
      if (own.outlineStyle !== 'auto') {
        const rings = [];
        if (own.outlineStyle !== 'none' && parseFloat(own.outlineWidth) >= 1) rings.push([own.outlineColor, parseFloat(own.outlineOffset) < 0 ? behind(el) : behind(el.parentElement)]);
        for (const [node, pseudo] of [[el, '::after'], [el.parentElement, null], [el.parentElement, '::after']]) {
          const s = getComputedStyle(node, pseudo);
          if (pseudo && s.content === 'none') continue;
          // a ring outside a box is seen against what is around that box
          if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) rings.push([s.outlineColor, behind(!pseudo && parseFloat(s.outlineOffset) >= 0 ? node.parentElement : el.parentElement)]);
          if (pseudo && parseFloat(s.borderBottomWidth) >= 2) rings.push([s.borderBottomColor, behind(el.parentElement)]);
        }
        const best = Math.max(0, ...rings.map(([c, bg]) => (parse(c)[3] < 0.3 ? 0 : ratio(parse(c), bg))));
        if (best < 3) bad.push(`<${key}> «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}» ${best.toFixed(2)} (${rings.map((x) => x[0]).join(', ') || 'sin anillo'})`);
      }
      el.blur();
    }
    return { bad, count };
  });

await check('el foco del teclado se ve (3:1) en cada zona, en las diez ventanas y los cuatro temas', async () => {
  await fresh();
  const bad = [];
  let total = 0;
  for (const app of APPS) {
    await open(app);
    for (const theme of THEMES) {
      await setTheme(theme);
      await page.keyboard.press('Tab');
      const found = await faintRings();
      total += found.count;
      bad.push(...found.bad.map((line) => `${app || 'inicio'} ${theme} ${line}`));
    }
  }
  console.log(`      (${total} controles medidos)`);
  assert.ok(total > 200, `solo se midieron ${total}`);
  assert.equal(bad.length, 0, `\n${bad.join('\n')}`);
});

// ------------------------------------------------------------------ the time a change takes
const timeChanges = () =>
  page.evaluate(async () => {
    const times = [];
    for (const theme of ['black', 'darkgray', 'white', 'colorful', 'black', 'darkgray', 'white', 'colorful']) {
      const start = performance.now();
      window.__novaSettings.set('theme', theme);
      // until the next frame has been produced with the new colours
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      times.push(performance.now() - start);
    }
    return Math.round(Math.max(...times));
  });

await check('cambiar de tema tarda menos de medio segundo en cualquier ventana, también con un documento largo', async () => {
  await fresh();
  const seen = [];
  for (const app of APPS) {
    await open(app);
    seen.push([app || 'inicio', await timeChanges()]);
  }
  await open('writer');
  await page.evaluate(() => {
    const html = Array.from({ length: 3000 }, (_, i) => `<p>Párrafo ${i} con texto suficiente para ocupar una línea entera de la página del documento.</p>`).join('');
    const data = new DataTransfer();
    data.setData('text/html', html);
    const editor = document.querySelector('.ProseMirror');
    editor.focus();
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.ProseMirror p').length >= 3000, null, { timeout: 60000 });
  await settle(5000);
  seen.push(['writer, 3000 párrafos', await timeChanges()]);
  console.log(`      (peor de 8 cambios, ms: ${seen.map(([a, ms]) => `${a} ${ms}`).join(' · ')})`);
  for (const [app, ms] of seen) assert.ok(ms < 500, `${app}: ${ms} ms`);
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
