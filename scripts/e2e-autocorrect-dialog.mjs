// Cuadro único de autocorrección (fase 2): pestañas, idioma de la lista, excepciones, lista matemática conectada con Ecuaciones, importar y exportar.
// Necesita `pnpm dev` en :1420. Uso: node scripts/e2e-autocorrect-dialog.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
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
  await page.waitForTimeout(300);
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
    await page.keyboard.press('Escape').catch(() => {});
  }
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const saved = () => ev(() => JSON.parse(localStorage.getItem('nova.writer.autocorrect') ?? 'null'));
const tab = async (n) => {
  const t = n === 'Ecuación' ? page.locator('[role=tab]').filter({ hasText: 'Herramientas de ecuación' }) : page.getByRole('tab', { name: n, exact: true });
  if ((await t.getAttribute('aria-selected')) !== 'true') await t.click();
};
const openDialog = async () => {
  await tab('Revisar');
  await page.getByRole('button', { name: 'Ortografía' }).nth(1).click();
  await page.getByRole('menuitem', { name: /Opciones de autocorrección/ }).click();
  await settle();
  return page.getByRole('dialog');
};
const maths = () =>
  ev(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => void (n.type.name === 'math' && out.push(n.attrs.tex)));
    return out;
  });
const typeEquation = async (keys) => {
  await tab('Insertar');
  await page.getByRole('button', { name: 'Ecuación' }).last().click();
  await page.getByRole('menuitem', { name: 'Nueva ecuación' }).click();
  await page.locator('.ProseMirror .nw-math-editing').waitFor();
  await page.keyboard.type(keys);
  await page.keyboard.press('Enter');
  await settle();
};

await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await ev(() => localStorage.removeItem('nova.writer.autocorrect'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await settle(500);
await ev(() => window.__novaWriter.ctl.newDoc());
await settle(600);
await page.locator('.ProseMirror').click();

await check('el cuadro tiene tres pestañas y cada una enseña lo suyo', async () => {
  const dlg = await openDialog();
  await shot('cuadro');
  assert.equal(await dlg.getByRole('tab').count(), 3);
  for (const n of ['Autocorrección', 'Autoformato', 'Autocorrección matemática']) assert.equal(await dlg.getByRole('tab', { name: n, exact: true }).count(), 1, n);
  await dlg.getByLabel('Poner en mayúscula la primera letra de una oración').waitFor();
  await dlg.getByRole('tab', { name: 'Autoformato' }).click();
  await dlg.getByLabel('Comillas rectas por comillas tipográficas').waitFor();
  await dlg.getByLabel(/Ordinales/).waitFor();
  assert.equal(await dlg.getByLabel('Poner en mayúscula la primera letra de una oración').count(), 0);
  await shot('autoformato');
  await dlg.getByRole('button', { name: 'Cancelar' }).click();
});

await check('idioma de la lista: el inglés trae la suya y guardar uno no pisa el otro', async () => {
  const dlg = await openDialog();
  await dlg.getByRole('listitem').filter({ hasText: 'tambien' }).first().waitFor();
  await dlg.getByLabel('Idioma de la lista').selectOption('en');
  await settle(200);
  await dlg.getByRole('listitem').filter({ hasText: 'definately' }).first().waitFor();
  assert.equal(await dlg.getByRole('listitem').filter({ hasText: /^tambien/ }).count(), 0);
  await dlg.getByLabel('Reemplazar', { exact: true }).fill('omw');
  await dlg.getByLabel('Con', { exact: true }).fill('on my way');
  await dlg.getByRole('button', { name: 'Agregar' }).click();
  await shot('ingles');
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await settle(500);
  const s = await saved();
  assert.equal(s.lists.en.omw, 'on my way');
  assert.equal(s.lists.en.teh, 'the');
  assert.equal(s.lists.es.tambien, 'también');
  assert.equal(s.lists.es.omw, undefined);
});

await check('excepciones: se editan por idioma y se guardan', async () => {
  const dlg = await openDialog();
  await dlg.getByRole('button', { name: 'Excepciones…' }).click();
  await dlg.getByRole('tab', { name: 'Primeras letras' }).waitFor();
  await dlg.getByLabel('Nueva palabra').fill('xyz');
  await dlg.getByRole('button', { name: 'Agregar' }).click();
  await dlg.getByRole('tab', { name: 'Otras correcciones' }).click();
  await dlg.getByLabel('Nueva palabra').fill('pq');
  await dlg.getByRole('button', { name: 'Agregar' }).click();
  await shot('excepciones');
  await dlg.getByRole('button', { name: 'Volver' }).click();
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await settle(500);
  const s = await saved();
  assert.ok(s.exceptions.es.firstLetter.includes('xyz'));
  assert.ok(s.exceptions.es.other.includes('pq'));
  assert.ok(s.exceptions.es.firstLetter.includes('sr'), 'las de fábrica siguen');
  assert.equal(s.exceptions.en?.other?.includes('pq') ?? false, false);
});

await check('la excepción tiene efecto al escribir: la palabra de «otras correcciones» no se toca', async () => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('tambien hola. Dato xyz. mañana ');
  const t = await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent);
  assert.ok(t.startsWith('También'), t);
  await page.keyboard.type('Ya. zzz ');
  const t2 = await ev(() => window.__novaWriter.ctl.mainView.state.doc.textContent);
  assert.ok(t2.includes('Zzz'), t2);
  // la abreviatura propia no abre oración: «xyz. mañana» queda con minúscula
  assert.ok(t2.includes('xyz. mañana'), t2);
});

await check('Matemática: la lista propia gobierna lo que se escribe en las ecuaciones', async () => {
  const dlg = await openDialog();
  await dlg.getByRole('tab', { name: 'Autocorrección matemática' }).click();
  await dlg.getByRole('listitem').filter({ hasText: /^alpha/ }).first().waitFor();
  await dlg.getByLabel('Reemplazar (sin la barra)').fill('\\mio');
  await dlg.getByLabel('Con', { exact: true }).fill('★');
  await dlg.getByRole('button', { name: 'Agregar' }).click();
  await dlg.getByRole('button', { name: 'Quitar beta', exact: true }).click();
  await shot('matematica');
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await settle(500);
  const s = await saved();
  assert.equal(s.math.mio, '★');
  assert.equal(s.math.beta, undefined);
  assert.equal(s.math.alpha, 'α');
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await typeEquation('\\mio \\beta \\alpha ');
  const tex = (await maths())[0].replace(/\s+/g, '');
  assert.ok(tex.includes('★'), tex);
  assert.ok(tex.includes('\\text{\\beta}'), tex);
  assert.ok(tex.includes('\\alpha'), tex);
});

await check('«Lista de fábrica» devuelve lo de fábrica y borra lo guardado', async () => {
  const dlg = await openDialog();
  await dlg.getByRole('tab', { name: 'Autocorrección matemática' }).click();
  assert.equal(await dlg.getByRole('listitem').filter({ hasText: /^mio/ }).count(), 1);
  await dlg.getByRole('button', { name: 'Lista de fábrica' }).click();
  assert.equal(await dlg.getByRole('listitem').filter({ hasText: /^mio/ }).count(), 0);
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await settle(500);
  assert.equal((await saved()).math, undefined);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('Control+End');
  await typeEquation('\\beta ');
  const all = await maths();
  assert.equal(all[all.length - 1].replace(/\s+/g, ''), '\\beta');
});

await check('exportar da un CSV y importar lo lee, con comas y comillas', async () => {
  const dlg = await openDialog();
  await dlg.getByLabel('Reemplazar', { exact: true }).fill('bss');
  await dlg.getByLabel('Con', { exact: true }).fill('buenos días, "amigo"');
  await dlg.getByRole('button', { name: 'Agregar' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Exportar…' }).click()]);
  assert.match(dl.suggestedFilename(), /^autocorreccion-es\.csv$/);
  const file = path.join(os.tmpdir(), 'nova-ac-export.csv');
  await dl.saveAs(file);
  const csv = fs.readFileSync(file, 'utf8');
  assert.ok(csv.includes('bss,"buenos días, ""amigo"""'), csv);
  assert.ok(csv.includes('tambien,también'), csv);
  // se importa otro archivo: tabulador y punto y coma
  const inFile = path.join(os.tmpdir(), 'nova-ac-import.txt');
  fs.writeFileSync(inFile, '# prueba\nxq\tuna cosa\nxw;otra cosa\nmal formado\n');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), dlg.getByRole('button', { name: 'Importar…' }).click()]);
  await fc.setFiles(inFile);
  await dlg.getByRole('listitem').filter({ hasText: /^xq/ }).first().waitFor();
  await dlg.getByRole('listitem').filter({ hasText: /^xw/ }).first().waitFor();
  assert.match(await dlg.getByRole('status').textContent(), /Importadas 2/);
  await shot('importado');
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await settle(500);
  const s = await saved();
  assert.equal(s.lists.es.xq, 'una cosa');
  assert.equal(s.lists.es.bss, 'buenos días, "amigo"');
});

await check('Cancelar no guarda nada', async () => {
  const before = JSON.stringify(await saved());
  const dlg = await openDialog();
  await dlg.getByLabel('Reemplazar', { exact: true }).fill('nunca');
  await dlg.getByLabel('Con', { exact: true }).fill('jamás');
  await dlg.getByRole('button', { name: 'Agregar' }).click();
  await dlg.getByRole('button', { name: 'Cancelar' }).click();
  await settle(300);
  assert.equal(JSON.stringify(await saved()), before);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
