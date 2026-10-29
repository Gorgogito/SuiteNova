// End-to-end checks for macros (Nova Basic with the Word object model). Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-macros.mjs [--shots dir]
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
const dialogs = [];
page.on('dialog', (d) => {
  dialogs.push(d.message());
  d.accept();
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
const newDoc = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await page.locator('.ProseMirror').click();
};

await check('editor: write a macro, run it and see its effect on the document', async () => {
  await newDoc();
  await page.keyboard.type('mal mal y mal');
  await tab('Programador');
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await page.getByRole('button', { name: 'Nuevo módulo' }).click();
  const code = 'Sub Corregir()\n  With ActiveDocument.Content.Find\n    .Text = "mal"\n    .Replacement.Text = "bien"\n    .Execute Replace:=wdReplaceAll\n  End With\n  ActiveDocument.Range(0, 4).Font.Bold = True\n  Debug.Print "palabras: " & ActiveDocument.Words.Count\nEnd Sub\n';
  await page.locator('textarea.nw-mac__code').fill(code);
  await shot('editor');
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).first().click();
  await settle(500);
  assert.match(await page.locator('.nw-mac__ok').innerText(), /terminó correctamente/);
  assert.match(await page.locator('.nw-mac__out').innerText(), /palabras: 4/);
  await page.getByRole('button', { name: 'Cerrar' }).click();
  await settle(300);
  assert.equal(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), 'bien bien y bien');
  assert.ok((await page.locator('.ProseMirror strong').count()) >= 1);
  await shot('after-macro');
});

await check('one undo reverts the whole macro', async () => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+z');
  await settle(400);
  const t = await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent);
  assert.equal(t, 'mal mal y mal');
});

await check('a syntax error is reported with its line, and the immediate window evaluates', async () => {
  await tab('Programador');
  await page.getByRole('button', { name: 'Editor de código…' }).click();
  await page.locator('textarea.nw-mac__code').fill('Sub A()\n  x = = 1\nEnd Sub\n');
  await settle(300);
  assert.match(await page.locator('.nw-mac__hint').innerText(), /Línea 2|línea 2/);
  await page.locator('textarea.nw-mac__code').fill('Sub A()\nEnd Sub\n');
  await page.getByLabel('Instrucción inmediata').fill('? ActiveDocument.Paragraphs.Count');
  await page.getByLabel('Instrucción inmediata').press('Enter');
  await settle(300);
  assert.match(await page.locator('.nw-mac__out').innerText(), /1/);
  await page.getByRole('button', { name: 'Cerrar' }).click();
});

await check('Macros… lists the Subs and runs the chosen one', async () => {
  await newDoc();
  await ev(() => {
    window.__novaWriter.ctl.macros = [{ name: 'M', code: 'Sub Saludar()\n  Selection.TypeText "Hola desde una macro"\nEnd Sub\n' }];
    window.__novaWriter.ctl.touch();
  });
  await tab('Programador');
  await page.getByRole('button', { name: 'Macros…' }).click();
  await page.getByRole('option', { name: /Saludar/ }).click();
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).click();
  await settle(400);
  assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /Hola desde una macro/);
});

await check('a document with macros opens with active content disabled, until it is enabled', async () => {
  const doc = await ev(async () => {
    const { ctl, docx } = window.__novaWriter;
    ctl.macros = [{ name: 'M', code: 'Sub AutoOpen()\n  Selection.TypeText "[auto]"\nEnd Sub\n' }];
    const { data } = await docx.writeDocx(ctl.toWriterDoc());
    let s = '';
    for (const b of data) s += String.fromCharCode(b);
    return btoa(s);
  });
  await newDoc();
  await ev(([b, n]) => window.__novaWriter.load(b, n), [doc, 'con-macros.docx']);
  await settle(800);
  assert.equal(await ev(() => window.__novaWriter.ctl.contentEnabled), false);
  assert.ok(await page.getByText('ADVERTENCIA DE SEGURIDAD').isVisible());
  await shot('security-bar');
  assert.doesNotMatch(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /\[auto\]/);
  // running is refused
  const r = await ev(() => window.__novaWriter.ctl.macroRt.run('AutoOpen'));
  assert.equal(r.ok, false);
  await page.getByRole('button', { name: 'Habilitar contenido' }).first().click();
  await settle(500);
  assert.equal(await ev(() => window.__novaWriter.ctl.contentEnabled), true);
  assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /\[auto\]/);
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
