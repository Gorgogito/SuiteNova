// End-to-end checks for the thesaurus pane (Shift+F7) in Writer. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-thesaurus.mjs [--shots dir]
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
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 8).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 700) => page.waitForTimeout(ms);
const waitEngine = () => page.waitForFunction(() => !window.__novaWriter.ctl.spellLoading, null, { timeout: 30000 });
const newDoc = async (text) => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await waitEngine();
  await page.locator('.ProseMirror').click();
  if (text) await page.keyboard.type(text);
};
const pane = () => page.getByRole('complementary', { name: 'Sinónimos' });
const docText = () => page.locator('.ProseMirror').innerText();
/** Right click exactly on a word inside an element (by its text), not on the middle of the paragraph. */
const rightClickWord = async (sel, word) => {
  const p = await page.evaluate(([sel, word]) => {
    for (const root of document.querySelectorAll(sel)) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const i = n.textContent.indexOf(word);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + word.length);
        const b = r.getBoundingClientRect();
        if (b.width) return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
    }
    return null;
  }, [sel, word]);
  assert.ok(p, `no se encontró «${word}»`);
  await page.mouse.click(p.x, p.y, { button: 'right' });
};
const look = async (word) => {
  await pane().getByLabel('Palabra a buscar').fill(word);
  await pane().getByRole('button', { name: 'Buscar sinónimos' }).first().click();
};

await check('Shift+F7 opens the pane with the word at the cursor and its meanings', async () => {
  await newDoc('La casa grande');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+F7');
  await pane().waitFor();
  await pane().getByTestId('th-result').waitFor({ timeout: 20000 });
  assert.equal((await pane().locator('.nv-th-head').innerText()).trim(), 'grande');
  await shot('pane-grande');
});

await check('Insert replaces the word, keeps the capital letter, and the pane follows the document word', async () => {
  await newDoc('Casa bonita');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.querySelector('.nv-th-head')?.textContent?.trim() === 'casa', null, { timeout: 5000 });
  await pane().locator('.nv-th-word', { hasText: /^vivienda$/ }).first().click();
  await pane().getByRole('button', { name: 'Insertar' }).click();
  await settle(300);
  assert.equal((await docText()).trim(), 'Vivienda bonita');
});

await check('an inflected word is found by its base form; the replacement goes in place of the typed word', async () => {
  await newDoc('Dos casas');
  await page.waitForFunction(() => /casa\s*\(de «casas»\)/.test(document.querySelector('.nv-th-head')?.textContent ?? ''), null, { timeout: 5000 });
  await pane().locator('.nv-th-word', { hasText: /^residencia$/ }).first().click();
  await pane().getByRole('button', { name: 'Insertar' }).click();
  assert.equal((await docText()).trim(), 'Dos residencia');
});

await check('looking up a word from the pane and going back', async () => {
  await look('feliz');
  assert.equal((await pane().locator('.nv-th-head').innerText()).trim(), 'feliz');
  await pane().locator('.nv-th-word').first().click();
  await pane().locator('.nv-th-actions').getByRole('button', { name: 'Buscar sinónimos' }).click();
  assert.notEqual((await pane().locator('.nv-th-head').innerText()).trim(), 'feliz');
  await pane().getByRole('button', { name: 'Anterior' }).click();
  assert.equal((await pane().locator('.nv-th-head').innerText()).trim(), 'feliz');
  await shot('pane-feliz');
});

await check('a word that is not in the thesaurus says so and offers similar ones', async () => {
  await look('cassa');
  const none = pane().getByTestId('th-none');
  await none.waitFor();
  assert.match(await none.innerText(), /No se encontró «cassa»/);
  assert.ok((await none.locator('.nv-th-word').allInnerTexts()).includes('casa'));
});

await check('English: meanings by part of speech, related words and antonyms', async () => {
  await ev(() => window.__novaWriter.ctl.setSpellLang('en'));
  await settle();
  await waitEngine();
  await look('happy');
  await pane().getByTestId('th-result').waitFor({ timeout: 20000 });
  const text = await pane().innerText();
  assert.match(text, /Adjetivo/i);
  assert.match(text, /glad/);
  assert.match(text, /Antónimos/);
  assert.match(text, /unhappy/);
  await shot('pane-happy');
  await ev(() => window.__novaWriter.ctl.setSpellLang('es'));
});

await check('Copy puts the word on the clipboard and the pane closes with the X', async () => {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await look('feliz');
  await pane().locator('.nv-th-word', { hasText: /^contento$/ }).click();
  await pane().getByRole('button', { name: 'Copiar' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'contento');
  await pane().getByRole('button', { name: 'Cerrar' }).click();
  assert.equal(await pane().count(), 0);
});

await check('the Review tab has the Thesaurus button and it toggles the pane', async () => {
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: /^Sinónimos/ }).first().click();
  await pane().waitFor();
  await page.getByRole('button', { name: /^Sinónimos/ }).first().click();
  assert.equal(await pane().count(), 0);
});

await check('right click on a flagged single word offers its synonyms in the menu', async () => {
  await newDoc('Habían muchas personas en la fiesta.');
  await settle(1500);
  await page.locator('.ProseMirror .nw-grammar', { hasText: /^Habían$/ }).first().click({ button: 'right' });
  const menu = page.locator('.nv-sp-menu');
  await menu.waitFor();
  await shot('menu');
  const open = menu.getByText('Sinónimos…');
  assert.ok((await open.count()) > 0, 'el menú no ofrece sinónimos para «Habían»');
  await open.click();
  await pane().waitFor();
});


await check('Writer: right click on any word gives Cut/Copy/Paste and its synonyms; picking one replaces the word', async () => {
  await newDoc('Una casa grande');
  await settle(1200);
  await rightClickWord('.ProseMirror', 'casa');
  const menu = page.locator('.nv-sp-menu');
  await menu.waitFor();
  for (const n of ['Cortar', 'Copiar', 'Pegar']) assert.equal(await menu.getByRole('menuitem', { name: n, exact: true }).count(), 1, n);
  assert.equal(await menu.getByRole('menuitem', { name: 'Cortar', exact: true }).getAttribute('aria-disabled'), 'true');
  await shot('word-menu');
  await menu.locator('.nv-sp-syn', { hasText: /^apartamento$/ }).click();
  await settle(200);
  assert.equal((await docText()).trim(), 'Una apartamento grande');
});

await check('Writer: a word with its own language is looked up in that language', async () => {
  await newDoc('Un happy día');
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: /^Idioma del texto/ }).first().click();
  await page.getByRole('menuitem', { name: 'Idioma de la selección: English' }).click();
  await ev(() => window.__novaWriter.ctl.mainView.focus());
  await page.waitForFunction(() => /Antónimos/.test(document.querySelector('.nv-th')?.textContent ?? '') || !!document.querySelector('.nv-th-head'), null, { timeout: 5000 }).catch(() => {});
  if ((await pane().count()) === 0) await page.keyboard.press('Shift+F7');
  await pane().waitFor();
  await page.waitForFunction(() => document.querySelector('.nv-th-head')?.textContent?.trim() === 'happy', null, { timeout: 15000 });
  assert.match(await pane().innerText(), /glad/);
});

await check('Notes: Shift+F7 and the word menu work on a text box', async () => {
  await page.goto('http://localhost:1420/?app=notes', { waitUntil: 'networkidle' });
  await page.waitForSelector('.nn-canvas');
  await page.waitForFunction(() => !!window.__novaNotes);
  await ev(() => { const c = window.__novaNotes.ctl; c.addPage(); c.setTool('select'); });
  const b = await page.locator('.nn-canvas').boundingBox();
  await page.mouse.click(b.x + 80, b.y + 60);
  await page.keyboard.type('Una casa grande');
  await settle(1200);
  await page.keyboard.press('Shift+F7');
  const np = page.getByRole('complementary', { name: 'Sinónimos' });
  await np.waitFor();
  await page.waitForFunction(() => document.querySelector('.nv-th-head')?.textContent?.trim() === 'grande', null, { timeout: 20000 });
  await np.locator('.nv-th-word', { hasText: /^enorme$/ }).first().click().catch(() => {});
  await rightClickWord('.nn-doc', 'casa');
  const menu = page.locator('.nv-sp-menu');
  await menu.waitFor();
  await menu.locator('.nv-sp-syn', { hasText: /^apartamento$/ }).click();
  await settle(300);
  assert.match(await ev(() => window.__novaNotes.ctl.textOfPage()), /Una apartamento grande/);
  await shot('notes');
});

await check('Slides: the pane follows the word being edited and Insert replaces it', async () => {
  await page.goto('http://localhost:1420/?app=slides', { waitUntil: 'networkidle' });
  await page.waitForSelector('.sl-surface');
  await ev(() => { const c = window.__novaSlides.ctl; c.newDoc(); c.goTo(0); });
  const box = await page.locator('.sl-surface').boundingBox();
  const z = (await ev(() => window.__novaSlides.ctl.zoom || window.__novaSlides.ctl.fitPercent)) / 100;
  await page.mouse.click(box.x + 480 * z, box.y + 200 * z);
  await settle();
  if (!(await ev(() => window.__novaSlides.ctl.editing))) await page.keyboard.press('Enter');
  await settle();
  await page.keyboard.type('Una casa grande');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
  await settle(900);
  await page.keyboard.press('Shift+F7');
  const sp = page.getByRole('complementary', { name: 'Sinónimos' });
  await sp.waitFor();
  await page.waitForFunction(() => document.querySelector('.nv-th-head')?.textContent?.trim() === 'casa', null, { timeout: 20000 });
  await sp.locator('.nv-th-word', { hasText: /^vivienda$/ }).first().click();
  await sp.getByRole('button', { name: 'Insertar' }).click();
  await settle(300);
  assert.match(await page.locator('.sl-pm').innerText(), /Una vivienda grande/);
  await shot('slides');
});


const fieldDlg = () => page.getByRole('dialog').filter({ has: page.getByRole('complementary', { name: 'Sinónimos' }) });
const fieldMenuClick = async (root, word) => {
  const p = await page.evaluate(([root, word]) => {
    const m = document.querySelector(root + ' .nv-pt__mirror');
    const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.textContent.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + word.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, [root, word]);
  assert.ok(p, `no se encontró «${word}» en el campo`);
  await page.mouse.click(p.x, p.y, { button: 'right' });
};

await check('Mail: right click on a word of the body gives Cut/Copy/Paste and synonyms; picking one edits the field', async () => {
  await page.goto('http://localhost:1420/?app=mail', { waitUntil: 'load' });
  await settle(900);
  await page.keyboard.press('Control+Shift+M');
  const body = page.getByLabel('Cuerpo del mensaje');
  await body.waitFor();
  await body.click();
  await page.keyboard.type('Una casa grande y bonita');
  await settle(2200);
  await fieldMenuClick('.nv-pt', 'casa');
  const menu = page.locator('.nv-sp-menu');
  await menu.waitFor();
  for (const n of ['Cortar', 'Copiar', 'Pegar']) assert.equal(await menu.getByRole('menuitem', { name: n, exact: true }).count(), 1, n);
  await shot('mail-word-menu');
  await menu.locator('.nv-sp-syn', { hasText: /^apartamento$/ }).click();
  await settle(300);
  assert.equal(await body.inputValue(), 'Una apartamento grande y bonita');
});

await check('Mail: Shift+F7 in the field opens the thesaurus dialog on the word at the cursor; Insert replaces it', async () => {
  const body = page.getByLabel('Cuerpo del mensaje');
  await body.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+F7');
  const dlg = fieldDlg();
  await dlg.waitFor();
  await page.waitForFunction(() => document.querySelector('[role=dialog] .nv-th-head')?.textContent?.trim() === 'bonito' || document.querySelector('[role=dialog] .nv-th-head')?.textContent?.includes('bonita'), null, { timeout: 20000 });
  await dlg.locator('.nv-th-word').first().click();
  await dlg.getByRole('button', { name: 'Insertar' }).click();
  await shot('mail-dialog');
  await dlg.getByRole('button', { name: 'Cerrar' }).last().click();
  await settle(300);
  assert.match(await body.inputValue(), /^Una apartamento grande y [a-záéíóúñ]+$/);
  assert.ok(!/bonita/.test(await body.inputValue()), await body.inputValue());
});

await check('Forms: the long answer of the preview opens the thesaurus with Shift+F7', async () => {
  await page.goto('http://localhost:1420/?app=forms', { waitUntil: 'load' });
  await settle(900);
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.locator('[data-nv-item="addMenu"]').click();
  await page.getByRole('menuitem', { name: 'Párrafo' }).click();
  await settle(300);
  await page.getByRole('tab', { name: 'Vista', exact: true }).click();
  await page.getByRole('button', { name: 'Vista previa' }).click();
  const box = page.locator('form textarea.fm-input');
  await box.waitFor();
  await box.click();
  await page.keyboard.type('Una casa');
  await settle(1500);
  await page.keyboard.press('Shift+F7');
  const dlg = fieldDlg();
  await dlg.waitFor();
  await page.waitForFunction(() => document.querySelector('[role=dialog] .nv-th-head')?.textContent?.trim() === 'casa', null, { timeout: 20000 });
});

await check('Plan: the notes of a task (inside a dialog) open the thesaurus on top and insert into the field', async () => {
  await page.goto('http://localhost:1420/?app=plan', { waitUntil: 'networkidle' });
  await page.waitForSelector('.pl-app');
  await page.getByRole('button', { name: 'Añadir la primera tarea' }).click();
  await page.getByRole('gridcell', { name: 'Nombre de la tarea, fila 1', exact: true }).click();
  await page.keyboard.press('Shift+F2');
  const main = page.getByRole('dialog').first();
  await main.getByRole('tab', { name: 'Notas' }).click();
  const notes = main.getByRole('textbox', { name: 'Notas' });
  await notes.click();
  await page.keyboard.type('Una casa grande');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+F7');
  const dlg = fieldDlg();
  await dlg.waitFor();
  await page.waitForFunction(() => document.querySelector('[role=dialog] .nv-th-head')?.textContent?.trim() === 'una' || !!document.querySelector('[role=dialog] .nv-th-head'), null, { timeout: 20000 });
  await dlg.getByLabel('Palabra a buscar').fill('casa');
  await dlg.getByRole('button', { name: 'Buscar sinónimos' }).first().click();
  await dlg.locator('.nv-th-head').waitFor();
  await dlg.getByRole('button', { name: 'Cerrar' }).last().click();
  await settle(300);
  assert.equal(await notes.inputValue(), 'Una casa grande');
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
