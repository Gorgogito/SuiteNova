// End-to-end checks for the proofing of plain text fields (Mail body, Forms long answer) and the shared AutoCorrect. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-proof-fields.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => (d.type() === 'beforeunload' ? d.accept() : (errors.push(`dialog: ${d.message()}`), d.dismiss())));
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
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const settle = (ms = 700) => page.waitForTimeout(ms);
const open = async (app) => {
  await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load' });
  await settle(900);
};
const underlined = (root) => root.locator('.nv-pt__mirror .nw-misspelled').allInnerTexts();
const grammar = (root) => root.locator('.nv-pt__mirror .nw-grammar').allInnerTexts();

await check('Mail: the body underlines spelling and grammar, aligned under the typed words', async () => {
  await open('mail');
  await page.keyboard.press('Control+Shift+M');
  const body = page.getByLabel('Cuerpo del mensaje');
  await body.waitFor();
  await body.click();
  await page.keyboard.type('Hola, una cassa  rara.\nOtra linea con los mesa.');
  await settle(2500);
  const wrap = page.locator('.nv-pt').first();
  assert.deepEqual(await underlined(wrap), ['cassa']);
  assert.ok((await grammar(wrap)).length >= 2, JSON.stringify(await grammar(wrap)));
  // el subrayado está justo bajo la palabra: el centro del rectángulo de «cassa» cae dentro del campo, sobre su línea
  const geo = await page.evaluate(() => {
    const m = document.querySelector('.nv-pt__mirror .nw-misspelled').getBoundingClientRect();
    const t = document.querySelector('.nv-pt textarea');
    const r = t.getBoundingClientRect();
    const probe = document.createElement('div');
    const cs = getComputedStyle(t);
    probe.style.cssText = `position:fixed;visibility:hidden;white-space:pre;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
    probe.textContent = 'Hola, una ';
    document.body.append(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return { mx: m.left - r.left - parseFloat(cs.paddingLeft) - parseFloat(cs.borderLeftWidth), expected: w, inside: m.top >= r.top && m.bottom <= r.bottom };
  });
  assert.ok(Math.abs(geo.mx - geo.expected) < 2, JSON.stringify(geo));
  assert.ok(geo.inside);
  await shot('mail-body');
});

await check('Mail: right click on a word corrects it in the field and the message keeps the text', async () => {
  const wrap = page.locator('.nv-pt').first();
  await wrap.locator('.nv-pt__mirror .nw-misspelled').first().evaluate(() => {});
  const box = await page.evaluate(() => {
    const r = document.querySelector('.nv-pt__mirror .nw-misspelled').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await page.locator('.nv-sp-menu').waitFor();
  await shot('mail-menu');
  await page.locator('.nv-sp-menu [role=menuitem]', { hasText: /^casa$/ }).click();
  await settle(900);
  assert.match(await page.getByLabel('Cuerpo del mensaje').inputValue(), /una casa {2}rara/);
  assert.deepEqual(await underlined(wrap), []);
});

await check('Mail: grammar issues can be fixed from the menu', async () => {
  const wrap = page.locator('.nv-pt').first();
  const box = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.nv-pt__mirror .nw-grammar')];
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  const item = page.locator('.nv-sp-menu [role=menuitem]').first();
  await item.waitFor();
  await item.click();
  await settle(900);
  const v = await page.getByLabel('Cuerpo del mensaje').inputValue();
  assert.ok(!/ {2}rara/.test(v) || !/los mesa/.test(v), v);
  assert.ok((await grammar(wrap)).length < 2);
});

await check('AutoCorrect while typing in a field: capital after a period, smart quotes and symbols', async () => {
  await open('mail');
  await page.keyboard.press('Control+Shift+M');
  const body = page.getByLabel('Cuerpo del mensaje');
  await body.click();
  await page.keyboard.type('hola. mañana (c) dijo "si" y mide 1/2 ');
  assert.equal(await body.inputValue(), 'Hola. Mañana © dijo “si” y mide ½ ');
});

await check('the shared AutoCorrect list: a replacement added in Writer applies in Mail', async () => {
  await open('writer');
  await page.evaluate(() => localStorage.setItem('nova.writer.autocorrect', JSON.stringify({ custom: { bss: 'buenos días' } })));
  await open('mail');
  await page.keyboard.press('Control+Shift+M');
  const body = page.getByLabel('Cuerpo del mensaje');
  await body.click();
  await page.keyboard.type('bss ');
  assert.equal(await body.inputValue(), 'Buenos días ');
  await page.evaluate(() => localStorage.removeItem('nova.writer.autocorrect'));
});

await check('Forms: a long-text answer is proofed in the preview', async () => {
  await open('forms');
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.locator('[data-nv-item="addMenu"]').click();
  await page.getByRole('menuitem', { name: 'Párrafo' }).click();
  await settle(300);
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.getByRole('button', { name: 'Vista previa' }).click();
  const box = page.locator('form textarea.fm-input');
  await box.waitFor();
  await box.click();
  await page.keyboard.type('Una cassa en el formulario.');
  await settle(2500);
  assert.deepEqual(await underlined(page.locator('form .nv-pt').first()), ['cassa']);
  await shot('forms-runner');
});

await check('Calc: F7 walks the text cells, changes a word in one cell and everywhere, and shows only spelling', async () => {
  await open('calc');
  await page.waitForSelector('.calc-grid__scroller');
  const box = await page.locator('.calc-grid__scroller').boundingBox();
  const at = (col, row) => ({ x: box.x + 40 + col * 64 + 32, y: box.y + 22 + row * 20 + 10 });
  const type = async (col, row, text) => {
    const p = at(col, row);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  };
  await type(0, 0, 'Una cassa rara');
  await type(0, 1, 'otra cassa mas');
  await type(0, 2, '123');
  await type(0, 3, '=A1&"x"');
  const p = at(0, 0);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('F7');
  await page.locator('[data-testid="spell-word"]').waitFor();
  assert.equal(await page.locator('[data-testid="spell-word"]').innerText(), 'cassa');
  assert.match(await page.getByRole('dialog').innerText(), /Celda A1 · quedan 2/);
  await shot('calc-spell');
  await page.locator('#calc-sp-sug').selectOption('casa');
  await page.getByRole('button', { name: 'Cambiar todas', exact: true }).click();
  await page.getByTestId('spell-done').waitFor();
  const t = await page.evaluate(() => [window.__novaCalc.text('A1'), window.__novaCalc.text('A2'), window.__novaCalc.text('A3')]);
  assert.deepEqual(t, ['Una casa rara', 'otra casa mas', '123']);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
});

await check('Calc: typing in a cell applies AutoCorrect (smart quotes, symbols) but not to formulas or the first word', async () => {
  await page.waitForTimeout(300);
  const box = await page.locator('.calc-grid__scroller').boundingBox();
  const at = (col, row) => ({ x: box.x + 40 + col * 64 + 32, y: box.y + 22 + row * 20 + 10 });
  const p = at(2, 0);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type('dijo "si" (c) fin. luego');
  await page.keyboard.press('Enter');
  const p2 = at(2, 1);
  await page.mouse.click(p2.x, p2.y);
  await page.keyboard.type('=SUMA(1;2)');
  await page.keyboard.press('Enter');
  const t = await page.evaluate(() => [window.__novaCalc.text('C1'), window.__novaCalc.text('C2')]);
  assert.equal(t[0], 'dijo “si” © fin. luego');
  assert.equal(t[1], '3');
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
