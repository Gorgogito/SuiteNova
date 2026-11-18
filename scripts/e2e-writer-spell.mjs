// End-to-end checks for the spelling check. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-spell.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
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
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 700) => page.waitForTimeout(ms);
const tab = async (n) => {
  const t = page.getByRole('tab', { name: n, exact: true });
  if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
};
const waitEngine = () => page.waitForFunction(() => !window.__novaWriter.ctl.spellLoading, null, { timeout: 30000 });
const newDoc = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await waitEngine();
  await page.locator('.ProseMirror').click();
};
const underlined = () => page.locator('.ProseMirror .nw-misspelled').allInnerTexts();

await check('mistakes are underlined while typing and correct words are not', async () => {
  await newDoc();
  await page.keyboard.type('Esta es una cassa muy bonita y el perro ladra fuerrte.');
  await settle(800);
  assert.deepEqual(await underlined(), ['cassa', 'fuerrte']);
  await shot('underlined');
});

await check('right click offers suggestions and fixes the word', async () => {
  await page.locator('.ProseMirror .nw-misspelled').first().click({ button: 'right' });
  await page.locator('.nv-sp-menu[aria-label="Ortografía"]').waitFor();
  const items = await page.locator('.nv-sp-menu [role=menuitem]').allInnerTexts();
  assert.ok(items.includes('casa'), JSON.stringify(items));
  assert.ok(items.includes('Omitir todo') && items.includes('Agregar al diccionario'));
  await shot('menu');
  await page.locator('.nv-sp-menu [role=menuitem]', { hasText: /^casa$/ }).click();
  await settle(500);
  assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /una casa muy/);
  assert.deepEqual(await underlined(), ['fuerrte']);
});

await check('the spelling dialog (F7) walks the mistakes, changes and adds to the dictionary', async () => {
  await newDoc();
  await page.keyboard.type('Una frase con ortografia mala y un zorbaxilo raro.');
  await settle(800);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).first().click();
  await page.locator('[data-testid="spell-word"]').waitFor();
  assert.equal(await page.locator('[data-testid="spell-word"]').innerText(), 'ortografia');
  const sug = await page.locator('#nv-sp-sug option').allInnerTexts();
  assert.ok(sug.includes('ortografía'), JSON.stringify(sug));
  await shot('spell-dialog');
  await page.locator('#nv-sp-sug').selectOption('ortografía');
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="spell-word"]')?.textContent === 'zorbaxilo');
  await page.getByRole('button', { name: 'Agregar al diccionario' }).click();
  await page.getByText('La revisión ha terminado: no hay más problemas.').waitFor();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle(500);
  const text = await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent);
  assert.match(text, /ortografía mala/);
  assert.deepEqual(await underlined(), []);
  const saved = await ev(() => localStorage.getItem('nova.writer.userDictionary'));
  assert.match(saved, /zorbaxilo/);
});

await check('language: switching to English checks English words', async () => {
  await newDoc();
  await page.keyboard.type('I will recieve the letter');
  await settle(800);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'English' }).click();
  await waitEngine();
  await settle(800);
  assert.deepEqual(await underlined(), ['recieve']);
  await shot('english');
});

await check('check while typing can be turned off', async () => {
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Revisar mientras escribe' }).click();
  await settle(500);
  assert.deepEqual(await underlined(), []);
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Revisar mientras escribe' }).click();
  await waitEngine();
  await settle(600);
  assert.deepEqual(await underlined(), ['recieve']);
  await ev(() => window.__novaWriter.ctl.setSpellLang('es'));
  await waitEngine();
});

await check('language: Spanish of Mexico and of Peru accept their own words, Spanish of Spain does not', async () => {
  await newDoc();
  await page.keyboard.type('Esta fiesta es chévere y la cassa también.');
  await settle(800);
  assert.deepEqual(await underlined(), ['chévere', 'cassa']);
  for (const lang of ['es-MX', 'es-PE']) {
    await tab('Revisar');
    await page.getByRole('button', { name: 'Ortografía' }).last().click();
    await page.getByRole('menuitem', { name: lang === 'es-MX' ? 'Español (México)' : 'Español (Perú)' }).click();
    await waitEngine();
    await settle(600);
    assert.deepEqual(await underlined(), ['cassa'], lang);
  }
  await ev(() => window.__novaWriter.ctl.setSpellLang('es'));
  await waitEngine();
});

const underlinedBy = (cls) => page.locator(`.ProseMirror .${cls}`).allInnerTexts();
const resetOptions = () => ev(() => localStorage.removeItem('nova.review.options'));

await check('grammar, punctuation and style are underlined in blue and green, apart from spelling in red', async () => {
  await newDoc();
  await page.keyboard.type('Pienso de que la casa es bonita.  Los mesa están a nivel de todo.');
  await settle(900);
  assert.deepEqual(await underlined(), []);
  const g = await underlinedBy('nw-grammar');
  assert.ok(g.some((x) => x.includes('de')) && g.includes('Los mesa'), JSON.stringify(g));
  assert.deepEqual(await underlinedBy('nw-style'), ['a nivel de']);
  await shot('grammar-underlines');
});

await check('right click on a grammar issue shows its message and applies the correction', async () => {
  await page.locator('.ProseMirror .nw-grammar', { hasText: 'Los mesa' }).click({ button: 'right' });
  const menu = page.locator('.nv-sp-menu');
  await menu.waitFor();
  const items = await menu.locator('[role=menuitem]').allInnerTexts();
  assert.ok(items.includes('la mesa') || items.includes('Los mesas') || items.some((i) => /mesa/.test(i)), JSON.stringify(items));
  assert.ok(items.includes('Omitir una vez'), JSON.stringify(items));
  assert.ok(items.some((i) => i.startsWith('No volver a marcar')), JSON.stringify(items));
  assert.match(await menu.innerText(), /Concordancia/);
  await shot('grammar-menu');
  await menu.locator('[role=menuitem]', { hasText: /^Las mesas$/ }).click();
  await settle(600);
  assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /Las mesas están/);
  assert.ok(!(await underlinedBy('nw-grammar')).includes('Los mesa'));
});

await check('«Omitir una vez» hides one issue only and survives typing elsewhere', async () => {
  await newDoc();
  await page.keyboard.type('Hola  mundo y aquí  también.');
  await settle(800);
  assert.equal((await underlinedBy('nw-grammar')).length, 2);
  await page.locator('.ProseMirror .nw-grammar').first().click({ button: 'right' });
  await page.locator('.nv-sp-menu [role=menuitem]', { hasText: 'Omitir una vez' }).click();
  await settle(500);
  assert.equal((await underlinedBy('nw-grammar')).length, 1);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Fin.');
  await settle(600);
  assert.equal((await underlinedBy('nw-grammar')).length, 1);
});

await check('the F7 dialog also walks grammar issues, with their corrections', async () => {
  await newDoc();
  await page.keyboard.type('Creo de que la cassa es grande.  Fin');
  await settle(900);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).first().click();
  await page.locator('[data-testid="spell-word"]').waitFor();
  assert.equal(await page.locator('[data-testid="spell-word"]').innerText(), 'de');
  assert.match(await page.locator('[data-testid="spell-count"]').innerText(), /Gramática/);
  await shot('f7-grammar');
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="spell-word"]')?.textContent === 'cassa');
  await page.locator('#nv-sp-sug').selectOption('casa');
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="spell-word"]')?.textContent?.trim() === '' || /^\s{2}|\s\s/.test(document.querySelector('[data-testid="spell-word"]')?.textContent ?? ''));
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.getByText('La revisión ha terminado: no hay más problemas.').waitFor();
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle(400);
  assert.equal(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), 'Creo que la casa es grande. Fin');
});

await check('the Editor pane lists issues by category and corrects with one click', async () => {
  await newDoc();
  await page.keyboard.type('Una cassa  rara y el el perro.');
  await settle(900);
  await ev(() => window.__novaWriter.ctl.mainView.focus());
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Editor', exact: true }).click();
  const pane = page.locator('aside.nv-ed');
  await pane.waitFor();
  const tabs = await pane.getByRole('tab').allInnerTexts();
  assert.deepEqual(tabs.map((x) => x.replace(/\s+/g, ' ')), ['Ortografía (1)', 'Gramática y puntuación (2)', 'Estilo (0)']);
  await pane.getByRole('button', { name: 'casa', exact: true }).first().click();
  await settle(600);
  assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /Una casa/);
  await pane.getByRole('tab', { name: /Gramática/ }).click();
  assert.equal(await pane.locator('.nv-ed-item').count(), 2);
  await shot('editor-pane');
  await pane.getByRole('button', { name: 'Cerrar' }).click();
  assert.equal(await page.locator('aside.nv-ed').count(), 0);
});

await check('options: turning a rule off, ignoring capitals and the optional long sentence rule', async () => {
  await resetOptions();
  await newDoc();
  await page.keyboard.type('Un ejemplo  con NASAA y otra  cosa.');
  await settle(900);
  assert.equal((await underlinedBy('nw-grammar')).length, 2);
  assert.deepEqual(await underlined(), []);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Opciones de revisión…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Opciones de revisión' });
  await dlg.waitFor();
  await shot('options');
  await dlg.getByLabel('Espacios dobles').uncheck();
  await dlg.getByLabel('Omitir palabras en MAYÚSCULAS').uncheck();
  await dlg.getByLabel('Frases muy largas').check();
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
  await settle(700);
  assert.equal((await underlinedBy('nw-grammar')).length, 0);
  assert.deepEqual(await underlined(), ['NASAA']);
  const saved = JSON.parse(await ev(() => localStorage.getItem('nova.review.options')));
  assert.equal(saved.ignoreUppercase, false);
  assert.equal(saved.rules['double-space'], false);
  assert.equal(saved.rules['long-sentence'], true);
  await resetOptions();
  await ev(() => {
    window.__novaWriter.ctl.dirty = false;
    window.location.reload();
  });
  await page.waitForSelector('.ProseMirror');
  await waitEngine();
  await settle(2500);
});

await check('turning grammar off leaves only spelling', async () => {
  await resetOptions();
  await newDoc();
  await page.keyboard.type('Una cassa  rara.');
  await settle(900);
  assert.equal((await underlinedBy('nw-grammar')).length, 1);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Opciones de revisión…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Opciones de revisión' });
  await dlg.getByLabel('Revisar la gramática, la puntuación y el estilo').uncheck();
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
  await settle(700);
  assert.equal((await underlinedBy('nw-grammar')).length, 0);
  assert.deepEqual(await underlined(), ['cassa']);
  await resetOptions();
});

await check('personal dictionary: add a word by hand, it stops being underlined; remove it and it comes back', async () => {
  await ev(() => localStorage.removeItem('nova.writer.userDictionary'));
  await resetOptions();
  await newDoc();
  await page.keyboard.type('Visite Zorbalandia pronto.');
  await settle(800);
  assert.deepEqual(await underlined(), ['Zorbalandia']);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Diccionario personalizado…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Diccionario personalizado' });
  await dlg.getByLabel('Palabra nueva').fill('Zorbalandia');
  await dlg.getByRole('button', { name: 'Agregar', exact: true }).click();
  assert.deepEqual(await dlg.locator('.nv-sp-dict li span').allInnerTexts(), ['Zorbalandia']);
  await shot('dictionary');
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
  await settle(700);
  assert.deepEqual(await underlined(), []);
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).last().click();
  await page.getByRole('menuitem', { name: 'Diccionario personalizado…' }).click();
  await page.getByRole('dialog', { name: 'Diccionario personalizado' }).getByRole('button', { name: 'Quitar Zorbalandia' }).click();
  await page.getByRole('dialog', { name: 'Diccionario personalizado' }).getByRole('button', { name: 'Cerrar' }).click();
  await settle(700);
  assert.deepEqual(await underlined(), ['Zorbalandia']);
});

await check('the selected language survives a reload (es-MX is kept)', async () => {
  await ev(() => window.__novaWriter.ctl.setSpellLang('es-MX'));
  await ev(() => {
    window.__novaWriter.ctl.dirty = false;
    window.location.reload();
  });
  await page.waitForSelector('.ProseMirror');
  await waitEngine();
  assert.equal(await ev(() => window.__novaWriter.ctl.spellLang), 'es-MX');
  await ev(() => window.__novaWriter.ctl.setSpellLang('es'));
  await waitEngine();
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
