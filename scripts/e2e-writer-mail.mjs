// End-to-end checks for envelopes, labels and mail merge. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-mail.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(here, 'mm-test.csv');
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
const newDoc = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle();
  await page.locator('.ProseMirror').click();
};
const sectionTexts = () =>
  ev(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.forEach((s) => out.push(s.textContent));
    return out;
  });

await check('recipients: read a CSV, edit the list in the dialog', async () => {
  await newDoc();
  await tab('Correspondencia');
  await page.getByRole('button', { name: 'Destinatarios' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Usar una lista existente/ }).click();
  (await chooser).setFiles(CSV);
  await page.locator('table[aria-label="Destinatarios"]').waitFor();
  assert.equal(await page.locator('table[aria-label="Destinatarios"] tbody tr').count(), 3);
  assert.equal(await page.locator('input[aria-label="Nombre 3"]').inputValue(), 'Eva María');
  assert.equal(await page.locator('input[aria-label="Dirección 3"]').inputValue(), 'Plaza Mayor, 3');
  await shot('recipients');
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle(300);
  const n = await ev(() => window.__novaWriter.ctl.mailMerge.records.length);
  assert.equal(n, 3);
});

await check('fields: insert a field, an address block and a rule from the ribbon', async () => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Estimado/a ');
  await page.getByRole('button', { name: 'Insertar campo combinado…' }).click();
  await page.locator('#nw-mf-name').selectOption('Nombre');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await settle(300);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Bloque de direcciones…' }).click();
  const tpl = await page.locator('#nw-mb-text').inputValue();
  assert.match(tpl, /\{Nombre\} \{Apellidos\}\n\{Dirección\}\n\{CP\} \{Ciudad\}/);
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await settle(300);
  await page.getByRole('button', { name: 'Reglas' }).click();
  await page.getByRole('menuitem', { name: /Si… entonces/ }).click();
  await page.locator('#nw-mr-f').selectOption('Edad');
  await page.locator('#nw-mr-op').selectOption('>=');
  await page.locator('#nw-mr-v').fill('18');
  await page.locator('#nw-mr-yes').fill(' (mayor de edad)');
  await page.locator('#nw-mr-no').fill(' (menor)');
  await page.getByRole('button', { name: 'Insertar', exact: true }).click();
  await settle();
  assert.ok((await page.locator('.ProseMirror .nw-field-mergefield').count()) >= 6);
  assert.equal(await page.locator('.ProseMirror .nw-field-merge-rule').count(), 1);
  await shot('fields');
});

await check('preview: values replace the fields and the arrows move between records', async () => {
  await page.getByRole('button', { name: 'Vista previa de resultados' }).click();
  await settle(300);
  assert.equal(await page.locator('.ProseMirror .nw-merge-pv').first().innerText(), 'Ana');
  await shot('preview-1');
  await page.getByRole('button', { name: 'Registro siguiente' }).click();
  await settle(300);
  assert.equal(await page.locator('.ProseMirror .nw-merge-pv').first().innerText(), 'Luis');
  const all = await page.locator('.ProseMirror .nw-merge-pv').allInnerTexts();
  assert.ok(all.includes('A Coruña') && all.includes('Gómez'), JSON.stringify(all));
  assert.ok(all.includes(' (menor)'), 'the IF rule shows its result: ' + JSON.stringify(all));
  await shot('preview-2');
  await page.getByRole('button', { name: 'Vista previa de resultados' }).click();
  await settle(300);
  assert.equal(await page.locator('.ProseMirror .nw-merge-pv').count(), 0);
});

await check('finish: merge all records in place, one page each; undo brings the template back', async () => {
  await page.getByRole('button', { name: 'Finalizar y combinar…' }).click();
  await page.getByRole('button', { name: 'Combinar', exact: true }).click();
  await settle(1200);
  const s = await sectionTexts();
  assert.equal(s.length, 3);
  assert.match(s[0], /Estimado\/a Ana/);
  assert.match(s[0], /Pérez/);
  assert.match(s[0], /mayor de edad/);
  assert.match(s[1], /Luis[\s\S]*menor/);
  assert.match(s[2], /Eva María/);
  assert.equal((await ev(() => window.__novaWriter.ctl.pages)) >= 3, true);
  await shot('merged');
  await ev(() => document.querySelector('.ProseMirror').focus());
  await page.keyboard.press('Control+z');
  await settle(500);
  assert.equal((await sectionTexts()).length, 1);
});

await check('merged document goes through .docx with its fields and rule intact', async () => {
  const out = await ev(async () => {
    const { ctl, docx } = window.__novaWriter;
    const { data } = await docx.writeDocx(ctl.toWriterDoc());
    const { doc } = await docx.readDocx(data);
    const f = [];
    doc.body.descendants((n) => {
      if (n.type.name === 'field') f.push([n.attrs.kind, n.attrs.arg, n.attrs.switches]);
    });
    return { f, md: doc.mailMerge?.records.length };
  });
  assert.ok(out.f.some((x) => x[0] === 'mergefield' && x[1] === 'Nombre'), JSON.stringify(out.f));
  assert.ok(out.f.some((x) => x[0] === 'merge-rule' && x[1] === 'IF' && /Edad >= "18"/.test(x[2])), JSON.stringify(out.f));
  assert.equal(out.md, 3);
});

await check('envelope: added as the first page with the size of the envelope', async () => {
  await newDoc();
  await page.keyboard.type('Carta');
  await tab('Correspondencia');
  await page.getByRole('button', { name: 'Sobres…' }).click();
  await page.locator('#nw-env-size').selectOption('dl');
  await page.locator('#nw-env-to').fill('Ana Pérez\nCalle Sol 1\n28001 Madrid');
  await page.locator('#nw-env-from').fill('Mi empresa\nCalle Luna 2');
  await shot('envelope-dialog');
  await page.getByRole('button', { name: 'Agregar al documento' }).click();
  await settle(1200);
  const info = await ev(() => {
    const secs = window.__novaWriter.ctl.sections();
    return { n: secs.length, w: secs[0].props.page.width, h: secs[0].props.page.height };
  });
  assert.equal(info.n, 2);
  assert.ok(Math.abs(info.w - 623.6) < 1 && Math.abs(info.h - 311.8) < 1, JSON.stringify(info));
  assert.ok((await page.locator('.ProseMirror .nw-shape').count()) === 2);
  await shot('envelope');
});

await check('labels: one label per recipient on a sheet', async () => {
  await newDoc();
  await tab('Correspondencia');
  await page.getByRole('button', { name: 'Destinatarios' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: /Usar una lista existente/ }).click();
  (await chooser).setFiles(CSV);
  await page.locator('table[aria-label="Destinatarios"]').waitFor();
  await page.getByRole('button', { name: 'Aceptar' }).click();
  await settle(300);
  await page.getByRole('button', { name: 'Etiquetas…' }).click();
  await page.locator('#nw-lb-text').fill('{Nombre} {Apellidos}\n{Dirección}\n{CP} {Ciudad}');
  await page.getByRole('button', { name: 'Crear etiquetas' }).click();
  await settle(1500);
  const text = await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent);
  assert.match(text, /Ana Pérez/);
  assert.match(text, /Eva María Ruiz/);
  assert.match(text, /41001 Sevilla/);
  assert.equal(await page.locator('.ProseMirror table td').count(), 21);
  await shot('labels');
});

await check('templates: the gallery builds a document from a template', async () => {
  await newDoc();
  await page.getByRole('button', { name: 'Archivo' }).click();
  await page.getByRole('menuitem', { name: /Nuevo desde plantilla/ }).or(page.getByRole('button', { name: /Nuevo desde plantilla/ })).first().click();
  await page.locator('.nw-tpl[data-template="report"]').waitFor();
  assert.ok((await page.locator('.nw-tpl').count()) >= 8);
  await shot('templates');
  await page.locator('.nw-tpl[data-template="report"]').click();
  await settle(1200);
  const info = await ev(() => ({ secs: window.__novaWriter.ctl.sections().length, text: window.__novaWriter.ctl.mainView.state.doc.textContent, controls: document.querySelectorAll('.ProseMirror .nw-cc').length }));
  assert.equal(info.secs, 2);
  assert.match(info.text, /Introducción/);
  assert.ok(info.controls >= 5, String(info.controls));
  await shot('template-report');
  // a placeholder is replaced by typing
  await page.locator('.ProseMirror .nw-cc').first().click();
  await page.keyboard.type('Informe anual');
  await settle(300);
  assert.match(await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent), /Informe anual/);
});

await check('no console errors', async () => {
  assert.deepEqual(errors, []);
});
for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
