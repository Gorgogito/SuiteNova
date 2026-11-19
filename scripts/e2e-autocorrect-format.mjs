// Autocorrección con formato (fase 3): *negrita*, _cursiva_, ordinales con superíndice, líneas de borde e idioma por texto, en Writer y Notes.
// Necesita `pnpm dev` en :1420. Uso: node scripts/e2e-autocorrect-format.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_URL ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  if (d.type() === 'beforeunload') return void d.accept();
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
  }
};
const settle = (ms = 300) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const type = (s) => page.keyboard.type(s, { delay: 8 });

// ------------------------------------------------------------------------------------------------- Writer
await page.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await ev(() => localStorage.removeItem('nova.writer.autocorrect'));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await settle(500);

/** Los párrafos del documento: texto con las marcas de cada trozo y el borde. */
const paras = () =>
  ev(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name !== 'paragraph') return;
      const runs = [];
      n.forEach((c) => runs.push({ t: c.text ?? '', m: c.marks.map((x) => x.type.name) }));
      out.push({ text: n.textContent, runs, border: n.attrs.border });
    });
    return out;
  });
const fresh = async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await settle(500);
  await page.locator('.ProseMirror').click();
};
const marksOf = (ps, word) => ps.flatMap((p) => p.runs).find((r) => r.t === word)?.m ?? null;

await check('Writer: *negrita* y _cursiva_ al cerrar el marcador', async () => {
  await fresh();
  await type('Un *hola* y _mundo_ ya');
  const ps = await paras();
  assert.equal(ps[0].text, 'Un hola y mundo ya');
  assert.deepEqual(marksOf(ps, 'hola'), ['strong']);
  assert.deepEqual(marksOf(ps, 'mundo'), ['em']);
  assert.deepEqual(marksOf(ps, ' y '), []);
  assert.deepEqual(marksOf(ps, ' ya'), [], 'lo que se escribe después no hereda el formato');
});

await check('Writer: lo que no es marcado se deja (2 * 3 *, a*b*, snake_case_x)', async () => {
  await fresh();
  await type('Uno 2 * 3 * 4 y a*b* y snake_case_x');
  const ps = await paras();
  assert.equal(ps[0].text, 'Uno 2 * 3 * 4 y a*b* y snake_case_x');
  assert.deepEqual(ps[0].runs.length, 1);
});

await check('Writer: con la casilla apagada no se aplica el marcado ni las líneas de borde', async () => {
  await ev(() => {
    const k = 'nova.writer.autocorrect';
    const s = JSON.parse(localStorage.getItem(k) ?? '{"version":2,"flags":{},"lists":{},"exceptions":{}}');
    s.flags = { ...s.flags, markup: false, borders: false };
    localStorage.setItem(k, JSON.stringify(s));
  });
  // el documento lee las opciones al abrir el cuadro: se usa el cuadro de verdad
  await fresh();
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: 'Ortografía' }).nth(1).click();
  await page.getByRole('menuitem', { name: /Opciones de autocorrección/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('tab', { name: 'Autoformato' }).click();
  assert.equal(await dlg.getByLabel(/Negrita/).isChecked(), false, 'la casilla refleja lo guardado');
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await settle(600);
  await page.locator('.ProseMirror').click();
  await type('Un *hola* ya');
  await page.keyboard.press('Enter');
  await type('---');
  await page.keyboard.press('Enter');
  const ps = await paras();
  assert.equal(ps[0].text, 'Un *hola* ya');
  assert.equal(ps[1].text, '---');
  assert.ok(!ps[1].border);
  // se vuelven a encender desde el cuadro
  await page.getByRole('button', { name: 'Ortografía' }).nth(1).click();
  await page.getByRole('menuitem', { name: /Opciones de autocorrección/ }).click();
  await dlg.getByRole('tab', { name: 'Autoformato' }).click();
  await dlg.getByLabel(/Negrita/).check();
  await dlg.getByLabel(/Líneas de borde/).check();
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await settle(600);
});

await check('Writer: --- y Intro dejan una línea fina bajo el párrafo y un párrafo nuevo debajo', async () => {
  await fresh();
  await type('Título');
  await page.keyboard.press('Enter');
  await type('---');
  await page.keyboard.press('Enter');
  await type('texto');
  const ps = await paras();
  assert.equal(ps.length, 3, JSON.stringify(ps));
  assert.equal(ps[1].text, '');
  assert.deepEqual({ s: ps[1].border.sides, st: ps[1].border.style }, { s: 'bottom', st: 'single' });
  assert.equal(ps[2].text, 'texto');
  assert.ok(!ps[2].border);
  const css = await ev(() => getComputedStyle(document.querySelectorAll('.ProseMirror p')[1]).borderBottomStyle);
  assert.equal(css, 'solid');
  await shot('linea');
});

await check('Writer: === ___ *** ~~~ ### dan sus estilos de línea', async () => {
  await fresh();
  for (const l of ['===', '___', '***', '~~~', '###']) {
    await type(l);
    await page.keyboard.press('Enter');
  }
  const ps = (await paras()).filter((p) => p.border);
  assert.deepEqual(
    ps.map((p) => [p.border.style, p.border.width]),
    [['double', 0.75], ['single', 2.25], ['dotted', 0.75], ['wave', 0.75], ['triple', 0.75]],
  );
});

await check('Writer: en español 1.o y 2.a dan 1.º y 2.ª', async () => {
  await fresh();
  await type('El 1.o y la 2.a ');
  assert.equal((await paras())[0].text, 'El 1.º y la 2.ª ');
});

await check('Writer: en un documento en inglés, 1st lleva «st» en superíndice y se usa la lista inglesa', async () => {
  await fresh();
  await ev(() => window.__novaWriter.ctl.setSpellLang('en'));
  await settle(300);
  await type('The 1st and 22nd teh ');
  const ps = await paras();
  assert.equal(ps[0].text, 'The 1st and 22nd the ');
  assert.deepEqual(marksOf(ps, 'st'), ['superscript']);
  assert.deepEqual(marksOf(ps, 'nd'), ['superscript']);
  assert.deepEqual(marksOf(ps, 'The 1'), []);
  await ev(() => window.__novaWriter.ctl.setSpellLang('es'));
});

await check('Writer: el idioma del texto manda sobre el del documento (texto marcado en inglés en un documento en español)', async () => {
  await fresh();
  await ev(() => window.__novaWriter.ctl.setSpellLang('es'));
  const langMark = await ev(() => Object.keys(window.__novaWriter.ctl.mainView.state.schema.marks).filter((k) => /lang/i.test(k)));
  assert.ok(langMark.length > 0, 'hay una marca de idioma');
  await type('Xx ');
  const ok = await ev((name) => {
    const v = window.__novaWriter.ctl.mainView;
    const m = v.state.schema.marks[name];
    const attrKey = Object.keys(m.spec.attrs ?? {})[0];
    v.dispatch(v.state.tr.setStoredMarks([m.create({ [attrKey]: 'en-US' })]));
    return attrKey;
  }, langMark[0]);
  assert.ok(ok);
  await type('teh tambien ');
  const ps = await paras();
  assert.ok(ps[0].text.includes('the tambien'), ps[0].text); // todo el texto está marcado en inglés: «teh» se corrige y «tambien» (lista española) no
});

// ------------------------------------------------------------------------------------------------- Notes
await check('Notes: *negrita*, línea de borde y ordinal español en una nota', async () => {
  await page.goto(`${BASE}?app=notes`, { waitUntil: 'load' });
  await page.waitForSelector('.ProseMirror', { timeout: 15000 });
  await settle(800);
  await page.locator('.ProseMirror').first().click();
  await type('Nota *clave* y 3.o ');
  await page.keyboard.press('Enter');
  await type('---');
  await page.keyboard.press('Enter');
  const info = await ev(() => {
    const root = document.querySelector('.ProseMirror');
    return { html: root.innerHTML, text: root.textContent };
  });
  assert.ok(/<strong>clave<\/strong>/.test(info.html), info.html.slice(0, 300));
  assert.ok(info.text.includes('3.º'), info.text);
  assert.ok(/border-bottom:[^;]*solid/.test(info.html), info.html.slice(0, 500));
  await shot('notes');
});

await check('Slides: *negrita*, _cursiva_, ordinal con superíndice, reemplazo y mayúscula al escribir en una forma', async () => {
  await page.goto(`${BASE}?app=slides`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sl-surface');
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.newDoc();
    c.goTo(0);
  });
  const box = await page.locator('.sl-surface').boundingBox();
  const z = (await ev(() => window.__novaSlides.ctl.zoom || window.__novaSlides.ctl.fitPercent)) / 100;
  await page.mouse.click(box.x + 480 * z, box.y + 200 * z);
  await settle();
  if (!(await ev(() => window.__novaSlides.ctl.editing))) await page.keyboard.press('Enter');
  await settle();
  await type('Un *hola* y _mundo_ tambien 2.o ');
  const info = await ev(() => {
    const v = window.__novaSlides.ctl.editor;
    const runs = [];
    v.state.doc.descendants((n) => void (n.isText && runs.push({ t: n.text, r: n.marks.find((m) => m.type.name === 'run')?.attrs.r ?? {} })));
    return { text: v.state.doc.textContent, runs };
  });
  assert.equal(info.text, 'Un hola y mundo también 2.º ');
  assert.equal(info.runs.find((x) => x.t === 'hola')?.r.b, true);
  assert.equal(info.runs.find((x) => x.t === 'mundo')?.r.i, true);
  assert.ok(!info.runs.find((x) => x.t.startsWith(' y '))?.r.b, 'lo de después no hereda');
  await shot('slides');
});

await check('Slides: el ordinal inglés lleva superíndice (baseline) en una presentación en inglés', async () => {
  await ev(() => localStorage.setItem('nova.slides.spellLang', 'en'));
  await page.goto(`${BASE}?app=slides`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sl-surface');
  await ev(() => {
    const c = window.__novaSlides.ctl;
    c.newDoc();
    c.goTo(0);
  });
  const box = await page.locator('.sl-surface').boundingBox();
  const z = (await ev(() => window.__novaSlides.ctl.zoom || window.__novaSlides.ctl.fitPercent)) / 100;
  await page.mouse.click(box.x + 480 * z, box.y + 200 * z);
  await settle();
  if (!(await ev(() => window.__novaSlides.ctl.editing))) await page.keyboard.press('Enter');
  await settle();
  await type('The 1st teh ');
  const info = await ev(() => {
    const v = window.__novaSlides.ctl.editor;
    const runs = [];
    v.state.doc.descendants((n) => void (n.isText && runs.push({ t: n.text, r: n.marks.find((m) => m.type.name === 'run')?.attrs.r ?? {} })));
    return { text: v.state.doc.textContent, runs };
  });
  assert.equal(info.text, 'The 1st the ');
  assert.equal(info.runs.find((x) => x.t === 'st')?.r.baseline, 30);
  assert.ok(!info.runs.find((x) => x.t === 'The 1')?.r.baseline);
  await ev(() => localStorage.removeItem('nova.slides.spellLang'));
});

await check('Slides: el cuadro de autocorrección está en Revisar y no ofrece vínculos, listas ni bordes', async () => {
  await page.goto(`${BASE}?app=slides`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sl-surface');
  await page.getByRole('tab', { name: 'Revisar', exact: true }).click();
  await page.getByRole('button', { name: /Opciones de autocorrección/ }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('tab', { name: 'Autoformato' }).click();
  await dlg.getByLabel(/Negrita/).waitFor();
  assert.equal(await dlg.getByLabel(/vínculos/).count(), 0);
  assert.equal(await dlg.getByLabel(/Listas automáticas/).count(), 0);
  assert.equal(await dlg.getByLabel(/Líneas de borde/).count(), 0);
  await shot('slides-cuadro');
  await dlg.getByRole('button', { name: 'Cancelar' }).click();
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
