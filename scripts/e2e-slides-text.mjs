// End-to-end checks of the text tools of Nova Slides: spacing, direction, alignment, autofit, case, symbol, fields, SmartArt,
// replace fonts, text fill/outline/effects and paste from outside. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-slides-text.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=slides';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 950 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => void d.dismiss());

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/txt-${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
    for (let i = 0; i < 3 && (await page.locator('[role=dialog]').count()); i++) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 250) => page.waitForTimeout(ms);
const home = () => page.getByRole('tab', { name: 'Inicio', exact: true }).click();
const menu = async (button, item) => {
  await page.getByRole('button', { name: button }).first().click();
  await settle(350);
  await page.getByRole('menuitem', { name: item }).first().click();
  await settle();
};
const shape = () => ev(() => { const e = window.__novaSlides.ctl.slide.shapes.find((s) => s.id === window.__id); return JSON.parse(JSON.stringify(e)); });
const firstPara = async () => (await shape()).text.doc.content[0];
/** a rectangle with text, selected (not editing) */
const newTextShape = async (text) => {
  await ev(() => {
    const n = window.__novaSlides;
    const c = n.ctl;
    c.select(c.slide.shapes.map((e) => e.id));
    c.deleteSelected();
    window.__id = n.addShape('rect', 120, 120, 420, 200);
  });
  await ev(() => window.__novaSlides.ctl.beginEdit(window.__id));
  await settle(400);
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await settle();
  await ev(() => window.__novaSlides.ctl.select([window.__id]));
  await settle();
};
const textOf = async () => (await shape()).text.doc.content.map((p) => (p.content ?? []).map((c) => c.text ?? c.attrs?.text ?? '').join('')).join('\n');

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.sl-surface');
await home();

await check('home: line spacing, direction, vertical alignment and autofit', async () => {
  await newTextShape('hola mundo');
  await menu('Espaciado entre líneas', /^1,5/);
  assert.equal((await firstPara()).attrs.p.lnSpc.pct, 150000);
  await menu('Espaciado entre líneas', /^2,0/);
  assert.equal((await firstPara()).attrs.p.lnSpc.pct, 200000);
  await menu('Dirección del texto', /Girar todo el texto 270/);
  assert.equal((await shape()).text.body.vert, 'vert270');
  await menu('Dirección del texto', /^Horizontal/);
  assert.equal((await shape()).text.body.vert, undefined);
  await menu('Alinear texto', /^Inferior/);
  assert.equal((await shape()).text.body.anchor, 'b');
  await menu('Ajuste automático', /^Reducir texto/);
  assert.equal((await shape()).text.body.fit.t, 'norm');
  await shot('home-text-group');
});

await check('home: character spacing and change case (whole text, then the selection)', async () => {
  await menu('Espaciado entre caracteres', /^Holgado/);
  const run = (await firstPara()).content[0].marks[0].attrs.r;
  assert.equal(run.spc, 3);
  await menu('Cambiar mayúsculas y minúsculas', /^MAYÚSCULAS/);
  assert.equal(await textOf(), 'HOLA MUNDO');
  await menu('Cambiar mayúsculas y minúsculas', /^Tipo oración/);
  assert.equal(await textOf(), 'Hola mundo');
  // only the selected word while editing
  await ev(() => window.__novaSlides.ctl.beginEdit(window.__id));
  await settle(400);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+Control+ArrowLeft');
  await menu('Cambiar mayúsculas y minúsculas', /^MAYÚSCULAS/);
  assert.equal(await ev(() => window.__novaSlides.ctl.editor.state.doc.textContent), 'Hola MUNDO');
  await page.keyboard.press('Escape');
});

await check('insert: symbol, date and slide number fields at the cursor', async () => {
  await ev(() => window.__novaSlides.ctl.beginEdit(window.__id));
  await settle(400);
  await page.keyboard.press('Control+End');
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Símbolo…' }).click();
  await settle(400);
  await shot('symbol-dialog');
  await page.getByRole('dialog').locator('button[aria-pressed]').first().dblclick();
  await settle();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  await settle(400);
  const after = await ev(() => window.__novaSlides.ctl.editor.state.doc.textContent);
  assert.ok(after.length > 'Hola MUNDO'.length, 'a symbol was inserted: ' + after);
  await page.getByRole('button', { name: /Insertar el n\.º de diapositiva/ }).click();
  await page.getByRole('button', { name: /Fecha y hora: corta/ }).click();
  await settle();
  await shot('fields');
  await page.keyboard.press('Escape');
  await settle();
  const fields = (await firstPara()).content.filter((n) => n.type === 'field').map((n) => n.attrs.ftype);
  assert.deepEqual(fields, ['slidenum', 'datetime1']);
  await home();
});

await check('text fill, outline and effects (Formato de forma)', async () => {
  await ev(() => window.__novaSlides.ctl.select([window.__id]));
  await page.getByRole('tab', { name: /Formato de forma/ }).click();
  await page.getByRole('button', { name: 'Relleno de texto' }).first().click();
  await settle();
  let r = (await firstPara()).content[0].marks[0].attrs.r;
  assert.ok(r.color, 'text colour set');
  await page.getByRole('button', { name: 'Contorno de texto' }).first().click();
  await settle();
  r = (await firstPara()).content[0].marks[0].attrs.r;
  assert.ok(r.fx?.ln, 'outline set');
  await page.getByRole('button', { name: 'Efectos de texto' }).click();
  await settle(350);
  await page.getByRole('menuitem', { name: /Reflejo: parte superior/ }).click();
  await settle();
  r = (await firstPara()).content[0].marks[0].attrs.r;
  assert.ok(r.fx?.effects?.reflection, 'reflection set');
  await shot('text-effects');
  await home();
});

await check('convert text to SmartArt keeps the lines and the place', async () => {
  await newTextShape('Uno');
  await ev(() => window.__novaSlides.ctl.beginEdit(window.__id));
  await settle(300);
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Dos');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Tres');
  await page.keyboard.press('Escape');
  await ev(() => window.__novaSlides.ctl.select([window.__id]));
  await settle();
  await menu('Convertir en SmartArt', /Proceso|Lista|Ciclo/);
  const s = await ev(() => window.__novaSlides.ctl.slide.shapes.map((e) => ({ kind: e.kind, n: e.children?.length })));
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, 'group');
  assert.ok(s[0].n >= 3, 'one shape per line');
  await shot('smartart');
});

await check('replace fonts across the presentation', async () => {
  await newTextShape('texto');
  await ev(() => { const c = window.__novaSlides.ctl; c.select([window.__id]); });
  await page.locator('.sl-font, select[aria-label=Fuente]').first().selectOption('Georgia');
  await settle();
  await page.getByRole('button', { name: 'Reemplazar fuentes…' }).click();
  await settle(400);
  await page.getByRole('dialog').getByLabel('Fuente que se reemplaza').selectOption('Georgia');
  await page.getByRole('dialog').getByLabel('Fuente nueva').selectOption('Verdana');
  await shot('replace-fonts');
  await page.getByRole('dialog').getByRole('button', { name: 'Reemplazar', exact: true }).click();
  await settle(400);
  const r = (await firstPara()).content[0].marks[0].attrs.r;
  assert.equal(r.latin, 'Verdana');
});

await check('paste from outside: text, image, and our own copy', async () => {
  await ev(() => { const c = window.__novaSlides.ctl; c.select(c.slide.shapes.map((e) => e.id)); c.deleteSelected(); });
  await page.locator('.sl-surface').click({ position: { x: 5, y: 5 } });
  const paste = (init) =>
    ev((i) => {
      const dt = new DataTransfer();
      if (i.text) dt.setData('text/plain', i.text);
      if (i.png) dt.items.add(new File([Uint8Array.from(atob(i.png), (c) => c.charCodeAt(0))], 'x.png', { type: 'image/png' }));
      document.querySelector('.sl-surface').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, init);
  await paste({ text: 'Texto desde fuera\nsegunda línea' });
  await settle();
  let s = await ev(() => window.__novaSlides.ctl.slide.shapes.map((e) => ({ kind: e.kind, tb: !!e.isTextBox })));
  assert.equal(s.length, 1);
  assert.equal(s[0].tb, true);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await paste({ png });
  await settle(600);
  s = await ev(() => window.__novaSlides.ctl.slide.shapes.map((e) => e.kind));
  assert.deepEqual(s, ['shape', 'pic']);
  // our own copy: the text on the clipboard is the one we put there, so the shapes are pasted
  await ev(() => { const c = window.__novaSlides.ctl; c.select([c.slide.shapes[0].id]); c.copy(); });
  await paste({ text: await ev(() => window.__novaSlides.ctl.clipText) });
  await settle();
  s = await ev(() => window.__novaSlides.ctl.slide.shapes.length);
  assert.equal(s, 3);
});

await check('saved and reopened: spacing, direction, anchor and fonts survive', async () => {
  await newTextShape('guardar');
  await menu('Espaciado entre líneas', /^1,5/);
  await menu('Dirección del texto', /Girar todo el texto 90/);
  await menu('Alinear texto', /^Medio/);
  const bytes = await ev(() => window.__novaSlides.write());
  await ev((b) => window.__novaSlides.load(b), bytes);
  await settle();
  const sh = await ev(() => window.__novaSlides.ctl.slide.shapes.find((e) => e.kind === 'shape'));
  assert.equal(sh.text.body.vert, 'vert');
  assert.equal(sh.text.body.anchor, 'ctr');
  assert.equal(sh.text.doc.content[0].attrs.p.lnSpc.pct, 150000);
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
