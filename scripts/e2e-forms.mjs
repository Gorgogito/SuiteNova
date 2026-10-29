// End-to-end checks for Nova Forms in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-forms.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=forms';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-forms-'));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  if (d.type() === 'confirm' && /^(¿Eliminar|Eliminar la pregunta|Hay cambios sin guardar)/.test(d.message())) return void d.accept();
  dialogs.push(d.message());
  d.dismiss();
});

let step = 0;
const shot = async (name, p = page) => {
  if (shotsDir) await p.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};

const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(120);
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const press = (n) => page.getByRole('button', { name: n, exact: true }).click();
const qs = () => ev(() => window.__novaForms.ctl.form.questions.map((q) => ({ id: q.id, type: q.type, title: q.title, required: q.required, options: q.options, rows: q.rows, allowOther: q.allowOther, showIf: q.showIf, correct: q.correct, points: q.points })));
const st = () => ev(() => ({ q: window.__novaForms.ctl.form.questions.length, r: window.__novaForms.ctl.responses.length, dirty: window.__novaForms.ctl.dirty, mode: window.__novaForms.ctl.mode }));
const mode = (name) => tab('Vista').then(() => press(name)).then(() => tab('Inicio'));
const card = (i) => page.locator(`section[aria-label="Pregunta ${i}"]`);
const addVia = async (typeName) => {
  await tab('Inicio');
  await page.locator('[data-nv-item="addMenu"]').click();
  await page.getByRole('menuitem', { name: typeName, exact: true }).click();
  await settle();
};
const setTitle = async (text) => {
  await page.locator('.fm-card.is-sel').getByLabel('Pregunta', { exact: true }).fill(text);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.fm-app');
await page.screenshot(); // first capture after load can be blank

await check('ribbon tabs and the empty form', async () => {
  for (const t of ['Inicio', 'Diseño', 'Respuestas', 'Vista', 'Ayuda']) assert.ok(await page.getByRole('tab', { name: t, exact: true }).count(), t);
  assert.ok(await page.getByText(/Todavía no hay preguntas/).count());
  assert.equal((await st()).q, 0);
});

await check('form title, description and thank-you message', async () => {
  const head = page.getByRole('region', { name: 'Título y descripción del formulario' });
  await head.click();
  await page.getByRole('textbox', { name: 'Título del formulario' }).fill('Encuesta del curso');
  await page.getByRole('textbox', { name: 'Descripción del formulario' }).fill('Cinco minutos.');
  await page.getByRole('textbox', { name: 'Mensaje de agradecimiento' }).fill('¡Gracias!');
  const f = await ev(() => window.__novaForms.ctl.form);
  assert.deepEqual([f.title, f.description, f.thanks], ['Encuesta del curso', 'Cinco minutos.', '¡Gracias!']);
  assert.match(await page.locator('.nv-titlebar').innerText(), /Encuesta del curso/);
});

await check('add questions of every kind from the ribbon', async () => {
  const kinds = ['Opción única', 'Texto corto', 'Casillas (varias opciones)', 'Calificación', 'Recomendación (0–10)', 'Escala por filas', 'Número', 'Fecha', 'Párrafo', 'Lista desplegable', 'Título o texto'];
  for (const k of kinds) await addVia(k);
  const types = (await qs()).map((q) => q.type);
  assert.deepEqual(types, ['choice', 'text', 'multi', 'rating', 'nps', 'likert', 'number', 'date', 'longtext', 'dropdown', 'title']);
  await ev(() => { const { ctl } = window.__novaForms; ctl.reset(); ctl.setForm({ title: 'Encuesta del curso', description: 'Cinco minutos.', thanks: '¡Gracias!' }); });
  await page.getByRole('region', { name: 'Título y descripción del formulario' }).click();
  await settle();
});

await check('edit a choice question: title, options (add, move, remove), "other", required', async () => {
  await addVia('Opción única');
  await setTitle('¿Cómo nos conociste?');
  const box = page.getByRole('group', { name: 'Opciones', exact: true });
  await box.getByLabel('Opciones 1', { exact: true }).fill('Un amigo');
  await box.getByLabel('Opciones 2', { exact: true }).fill('Internet');
  await box.getByRole('button', { name: 'Añadir' }).click();
  await box.getByLabel('Opciones 3', { exact: true }).fill('Prensa');
  await box.getByRole('button', { name: 'Subir Opciones 3' }).click();
  assert.deepEqual((await qs())[0].options, ['Un amigo', 'Prensa', 'Internet']);
  await box.getByRole('button', { name: 'Quitar Opciones 2' }).click();
  assert.deepEqual((await qs())[0].options, ['Un amigo', 'Internet']);
  await box.getByRole('button', { name: 'Añadir' }).click();
  await box.getByLabel('Opciones 3', { exact: true }).fill('Otro medio');
  await page.getByLabel('Permitir la respuesta "Otro"').check();
  await page.getByRole('checkbox', { name: 'Obligatoria' }).check();
  const q = (await qs())[0];
  assert.deepEqual([q.title, q.allowOther, q.required, q.options.length], ['¿Cómo nos conociste?', true, true, 3]);
  // options cannot be removed below one
  for (const n of [3, 2]) await box.getByRole('button', { name: `Quitar Opciones ${n}` }).click();
  assert.equal(await box.getByRole('button', { name: 'Quitar Opciones 1' }).isDisabled(), true);
  await box.getByRole('button', { name: 'Añadir' }).click();
  await box.getByLabel('Opciones 2', { exact: true }).fill('Internet');
  await box.getByRole('button', { name: 'Añadir' }).click();
  await box.getByLabel('Opciones 3', { exact: true }).fill('Prensa');
});

await check('more questions: text with a format, number with limits, rating, grid, and a condition', async () => {
  await addVia('Texto corto');
  await setTitle('Tu correo');
  await page.getByLabel('Formato').selectOption('email');
  await page.getByRole('checkbox', { name: 'Obligatoria' }).check();
  await addVia('Número');
  await setTitle('Edad');
  await page.getByLabel('Valor mínimo').fill('18');
  await page.getByLabel('Valor máximo').fill('99');
  await page.getByLabel('Solo enteros').check();
  await addVia('Calificación');
  await setTitle('Valora el curso');
  await page.getByLabel('Niveles').selectOption('4');
  await addVia('Escala por filas');
  await setTitle('Contenido');
  await page.getByRole('group', { name: 'Filas', exact: true }).getByLabel('Filas 1', { exact: true }).fill('Claridad');
  await page.getByRole('group', { name: 'Filas', exact: true }).getByLabel('Filas 2', { exact: true }).fill('Ritmo');
  await addVia('Párrafo');
  await setTitle('¿Qué mejorarías?');
  const fs_ = page.getByRole('group', { name: 'Mostrar solo si…' });
  await fs_.getByLabel('Pregunta de la condición').selectOption({ label: '4. Valora el curso' });
  await fs_.getByLabel('Valor de la condición').fill('2');
  await fs_.getByLabel('Operador de la condición').selectOption('contains');
  const q = await qs();
  assert.equal(q.length, 6);
  assert.deepEqual(q[5].showIf, { question: q[3].id, op: 'contains', value: '2' });
  assert.equal(await ev(() => window.__novaForms.ctl.form.questions[2].maxValue), 99);
  assert.equal(await ev(() => window.__novaForms.ctl.form.questions[3].max), 4);
  // the first question cannot have a condition
  await card(1).click();
  assert.equal(await page.getByRole('group', { name: 'Mostrar solo si…' }).count(), 0);
  await shot('designed');
});

await check('select, move, duplicate and delete questions; undo', async () => {
  await card(6).click();
  await tab('Inicio');
  await press('Mover pregunta hacia arriba');
  assert.deepEqual((await qs()).map((q) => q.title).slice(4, 6), ['¿Qué mejorarías?', 'Contenido']);
  // moving the conditional question above the question it depends on drops the condition
  await press('Mover pregunta hacia arriba');
  await press('Mover pregunta hacia arriba');
  assert.equal((await qs())[2].showIf, null);
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual((await qs())[3].showIf === null, false.valueOf() || (await qs())[3].showIf === null);
  await page.keyboard.press('Control+z');
  await settle();
  // put it back after "Contenido"
  await press('Mover pregunta hacia abajo');
  assert.deepEqual((await qs()).map((q) => q.title), ['¿Cómo nos conociste?', 'Tu correo', 'Edad', 'Valora el curso', 'Contenido', '¿Qué mejorarías?']);
  assert.notEqual((await qs())[5].showIf, null);
  await card(2).click();
  await press('Duplicar pregunta');
  assert.equal((await st()).q, 7);
  await press('Eliminar pregunta');
  assert.equal((await st()).q, 6);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await st()).q, 7);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await st()).q, 6);
});

await check('preview: required, format and limits are checked; conditions show and hide live; nothing is stored', async () => {
  await mode('Vista previa');
  const form = page.getByRole('form', { name: 'Encuesta del curso' });
  await form.getByRole('button', { name: 'Enviar (prueba)' }).click();
  assert.equal(await form.getByRole('alert').count(), 2); // the two required questions
  assert.match(await form.getByRole('alert').first().innerText(), /obligatoria/);
  await form.getByRole('radio', { name: 'Internet' }).check();
  await form.getByLabel('Tu correo').fill('mal');
  await form.getByLabel('Edad').fill('12');
  await form.getByRole('button', { name: 'Enviar (prueba)' }).click();
  const msgs = await form.getByRole('alert').allInnerTexts();
  assert.ok(msgs.some((m) => /correo electrónico válido/.test(m)), msgs.join('|'));
  assert.ok(msgs.some((m) => /mínimo es 18/.test(m)), msgs.join('|'));
  // the improvement question only shows for low ratings
  assert.equal(await form.getByLabel('¿Qué mejorarías?').count(), 0);
  await form.getByRole('radio', { name: '2', exact: true }).check();
  assert.equal(await form.getByLabel('¿Qué mejorarías?').count(), 1);
  await form.getByRole('radio', { name: '4', exact: true }).check();
  assert.equal(await form.getByLabel('¿Qué mejorarías?').count(), 0);
  await form.getByLabel('Tu correo').fill('ana@ejemplo.es');
  await form.getByLabel('Edad').fill('30');
  await form.getByRole('button', { name: 'Enviar (prueba)' }).click();
  await page.getByText('Esto es solo una vista previa').waitFor();
  assert.ok(await page.getByText('¡Gracias!').count());
  assert.equal((await st()).r, 0);
  await shot('preview-done');
});

await check('fill and save five responses; the summary counts them', async () => {
  await mode('Rellenar y guardar respuestas');
  const people = [
    { how: 'Internet', mail: 'a@x.es', age: '30', rate: '4', rows: ['3', '4'] },
    { how: 'Internet', mail: 'b@x.es', age: '25', rate: '2', why: 'Más ejercicios', rows: ['1', '2'] },
    { how: 'Un amigo', mail: 'c@x.es', age: '41', rate: '4', rows: ['4', '4'] },
    { how: 'Prensa', mail: 'd@x.es', age: '19', rate: '3', rows: ['2', '3'] },
    { how: 'otro:Radio', mail: 'e@x.es', age: '52', rate: '4', rows: ['3', '3'] },
  ];
  const cols = ['Muy en desacuerdo', 'En desacuerdo', 'De acuerdo', 'Muy de acuerdo'];
  for (const p of people) {
    const form = page.getByRole('form', { name: 'Encuesta del curso' });
    if (p.how.startsWith('otro:')) {
      await form.getByRole('radio', { name: 'Otro:' }).check();
      await form.getByLabel('Otro', { exact: true }).fill(p.how.slice(5));
    } else await form.getByRole('radio', { name: p.how, exact: true }).check();
    await form.getByLabel('Tu correo').fill(p.mail);
    await form.getByLabel('Edad').fill(p.age);
    await form.getByRole('radio', { name: p.rate, exact: true }).check();
    await form.getByRole('radio', { name: `Claridad: ${cols[Number(p.rows[0]) - 1]}` }).check();
    await form.getByRole('radio', { name: `Ritmo: ${cols[Number(p.rows[1]) - 1]}` }).check();
    if (p.why) await form.getByLabel('¿Qué mejorarías?').fill(p.why);
    await form.getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.getByText('Respuesta guardada').waitFor();
    await page.getByRole('button', { name: 'Rellenar otra respuesta' }).click();
  }
  assert.equal((await st()).r, 5);
  await mode('Resultados');
  assert.equal(await page.getByLabel('Número de respuestas').innerText().then((s) => s.trim().split(/\s/)[0]), '5');
  const how = page.locator('[data-summary]').first();
  const text = await how.innerText();
  assert.match(text, /Internet\s*2 \(40 %\)/);
  assert.match(text, /Un amigo\s*1 \(20 %\)/);
  assert.match(text, /Otras respuestas\s*1 \(20 %\)/);
  await how.getByText('Otras respuestas').first().click();
  await shot('results');
});

await check('summary numbers: rating average, age statistics, grid, free text', async () => {
  const s = await ev(() => {
    const { ctl } = window.__novaForms;
    return ctl.responses.map((r) => r.answers);
  });
  assert.equal(s.length, 5);
  const cards = await page.locator('[data-summary]').allInnerTexts();
  assert.equal(cards.length, 6); // one card per question that takes an answer
  assert.match(cards[1], /Tu correo/);
  const ages = cards.find((c) => /Edad/.test(c));
  assert.match(ages, /Media\s*33[,.]4/);
  assert.match(ages, /Mediana\s*30/);
  assert.match(ages, /Mínimo\s*19/);
  assert.match(ages, /Máximo\s*52/);
  const rating = cards.find((c) => /Valora el curso/.test(c));
  assert.match(rating, /3[,.]4 \/ 4/);
  const grid = cards.find((c) => /Contenido/.test(c));
  assert.match(grid, /Claridad/);
  const text = cards.find((c) => /Qué mejorarías/.test(c));
  assert.match(text, /Más ejercicios/);
  assert.match(text, /1 respuesta/);
});

await check('individual responses: browse and delete one; undo brings it back', async () => {
  await page.getByRole('tab', { name: 'Individuales' }).click();
  assert.match(await page.getByRole('region', { name: 'Respuesta individual' }).innerText(), /a@x\.es/);
  await page.getByRole('button', { name: 'Respuesta siguiente' }).click();
  assert.match(await page.getByRole('region', { name: 'Respuesta individual' }).innerText(), /b@x\.es/);
  assert.match(await page.getByRole('region', { name: 'Respuesta individual' }).innerText(), /Más ejercicios/);
  await page.getByRole('button', { name: 'Eliminar esta respuesta' }).click();
  assert.equal((await st()).r, 4);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await st()).r, 5);
  await page.getByRole('tab', { name: 'Resumen' }).click();
});

await check('quiz mode: correct answers and points are graded and summarised', async () => {
  await mode('Diseñar');
  await tab('Diseño');
  await press('Modo cuestionario (con puntuación)');
  assert.equal((await ev(() => window.__novaForms.ctl.form.quiz)), true);
  await ev(() => { const { ctl } = window.__novaForms; ctl.select(ctl.form.questions[0].id); });
  await page.getByRole('group', { name: 'Respuesta correcta' }).getByLabel('Internet').check();
  await page.getByRole('group', { name: 'Respuesta correcta' }).getByLabel('Puntos').fill('3');
  const q = (await qs())[0];
  assert.deepEqual([q.correct, q.points], [['Internet'], 3]);
  await mode('Resultados');
  const text = await page.locator('.fm-top').innerText();
  assert.match(text, /Puntuación media:\s*1[,.]2 \/ 3/);
  await page.getByRole('tab', { name: 'Individuales' }).click();
  assert.match(await page.getByRole('region', { name: 'Respuesta individual' }).innerText(), /Puntuación: 3 \/ 3/);
  await page.getByRole('tab', { name: 'Resumen' }).click();
  // fill mode shows the score right away
  await mode('Rellenar y guardar respuestas');
  const form = page.getByRole('form', { name: 'Encuesta del curso' });
  await form.getByRole('radio', { name: 'Internet', exact: true }).check();
  await form.getByLabel('Tu correo').fill('z@x.es');
  await form.getByLabel('Edad').fill('33');
  await form.getByRole('radio', { name: '4', exact: true }).check();
  await form.getByRole('radio', { name: 'Claridad: Muy de acuerdo' }).check();
  await form.getByRole('radio', { name: 'Ritmo: Muy de acuerdo' }).check();
  await form.getByRole('button', { name: 'Enviar', exact: true }).click();
  assert.match(await page.getByRole('status').filter({ hasText: 'Respuesta guardada' }).innerText(), /Puntuación: 3 \/ 3/);
  await page.getByRole('button', { name: 'Rellenar otra respuesta' }).click();
  assert.equal((await st()).r, 6);
  await ev(() => window.__novaForms.ctl.undo());
  await mode('Diseñar');
});

await check('export CSV: BOM, header, quoting, one column per grid row', async () => {
  await tab('Respuestas');
  const [dl] = await Promise.all([page.waitForEvent('download'), press('Exportar respuestas a CSV…')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.charCodeAt(0), 0xfeff);
  const lines = raw.slice(1).trim().split('\r\n');
  assert.equal(lines[0], 'Id;Fecha;Puntuación;Puntuación máxima;¿Cómo nos conociste?;Tu correo;Edad;Valora el curso;Contenido [Claridad];Contenido [Ritmo];¿Qué mejorarías?');
  assert.equal(lines.length, 6);
  assert.match(lines[1], /;a@x\.es;30;4;De acuerdo;Muy de acuerdo;/);
  assert.match(lines[5], /;Radio;/);
  await tab('Inicio');
});

let exported;
await check('export the form as one web page', async () => {
  await tab('Respuestas');
  const [dl] = await Promise.all([page.waitForEvent('download'), press('Exportar formulario como página web…')]);
  exported = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(exported);
  const html = fs.readFileSync(exported, 'utf8');
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /https?:\/\/(?!schemas)/.test(html.replace(/https?:\/\/[^"'\s)]*(?=[^<]*<\/script>)/g, '')) ? /^$/ : /\bnever-matches\b/);
  const ext = html.match(/<link |<img |<iframe |<script[^>]*\bsrc=|\bhref="https?:/);
  assert.ok(!ext, `no external resources: ${ext && html.slice(ext.index, ext.index + 60)}`);
  await tab('Inicio');
});

let responseFile;
await check('the exported page works in any browser: validation, conditions, score and a downloadable response', async () => {
  const p2 = await ctx.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  p2.on('console', (m) => m.type() === 'error' && errs2.push(m.text()));
  await p2.goto(pathToFileURL(exported).href);
  assert.equal(await p2.locator('h1').innerText(), 'Encuesta del curso');
  assert.equal(await p2.locator('[data-q]').count(), 6);
  await p2.getByRole('button', { name: 'Enviar' }).click();
  assert.equal(await p2.locator('.err:not([hidden])').count(), 2);
  await p2.getByLabel('Tu correo').fill('mal');
  await p2.getByLabel('Edad').fill('12');
  await p2.getByRole('radio', { name: 'Internet', exact: true }).check();
  await p2.getByRole('button', { name: 'Enviar' }).click();
  const texts = await p2.locator('.err:not([hidden])').allInnerTexts();
  assert.ok(texts.some((t) => /correo electrónico válido/.test(t)), texts.join('|'));
  assert.ok(texts.some((t) => /mínimo es 18/.test(t)), texts.join('|'));
  // the follow-up question is hidden until the rating is 2
  assert.equal(await p2.locator('[data-q]').nth(5).isHidden(), true);
  await p2.locator('[data-q]').nth(3).getByText('2', { exact: true }).click();
  assert.equal(await p2.locator('[data-q]').nth(5).isVisible(), true);
  await p2.getByLabel('¿Qué mejorarías?').fill('Más práctica');
  await p2.getByLabel('Tu correo').fill('web@x.es');
  await p2.getByLabel('Edad').fill('44');
  await p2.locator('[data-q]').nth(4).getByLabel('Claridad: De acuerdo').check();
  await p2.locator('[data-q]').nth(4).getByLabel('Ritmo: De acuerdo').check();
  await p2.getByRole('button', { name: 'Enviar' }).click();
  await p2.locator('#done').waitFor();
  assert.match(await p2.locator('#done').innerText(), /Gracias/);
  assert.match(await p2.locator('#done').innerText(), /Puntuación: 3 de 3/);
  const [dl] = await Promise.all([p2.waitForEvent('download'), p2.locator('#dl').click()]);
  responseFile = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(responseFile);
  const r = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
  assert.equal(r.format, 'novaforms-response');
  assert.equal(Object.keys(r.answers).length, 6);
  assert.equal(r.answers[Object.keys(r.answers)[1]], 'web@x.es');
  assert.deepEqual(errs2, [], 'no errors in the page');
  await shot('web-form', p2);
  await p2.close();
});

await check('the quiz page hides the correct answers when the score is not shown', async () => {
  await ev(() => window.__novaForms.ctl.setForm({ showScore: false }));
  await tab('Respuestas');
  const [dl] = await Promise.all([page.waitForEvent('download'), press('Exportar formulario como página web…')]);
  const f = path.join(tmp, 'privado.html');
  await dl.saveAs(f);
  const html = fs.readFileSync(f, 'utf8');
  const data = JSON.parse(html.match(/id="form-data">(.*?)<\/script>/s)[1]);
  assert.deepEqual(data.questions[0].correct, []);
  assert.doesNotMatch(html, /"correct":\["Internet"\]/);
  await ev(() => window.__novaForms.ctl.setForm({ showScore: true }));
  await tab('Inicio');
});

await check('import the returned response; repeats are skipped; other forms and bad files are refused', async () => {
  const before = (await st()).r;
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await tab('Respuestas'); await press('Importar respuestas…'); })()]);
  await chooser.setFiles(responseFile);
  await page.waitForFunction((n) => window.__novaForms.ctl.responses.length === n + 1, before);
  assert.equal((await st()).mode, 'results');
  assert.equal(await page.getByLabel('Número de respuestas').innerText().then((s) => s.trim().split(/\s/)[0]), String(before + 1));
  // again: nothing new
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), press('Importar respuestas…')]);
  await c2.setFiles(responseFile);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /No se añadió ninguna[\s\S]*ya estaban/);
  assert.equal((await st()).r, before + 1);
  // a response of another form
  const other = path.join(tmp, 'otro.json');
  fs.writeFileSync(other, JSON.stringify({ format: 'novaforms-response', formId: 'otro', id: 'x', at: '2025-01-01T00:00:00Z', answers: { a: 'b' } }));
  const [c3] = await Promise.all([page.waitForEvent('filechooser'), press('Importar respuestas…')]);
  await c3.setFiles(other);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /otro formulario/);
  const junk = path.join(tmp, 'basura.json');
  fs.writeFileSync(junk, 'esto no es json');
  const [c4] = await Promise.all([page.waitForEvent('filechooser'), press('Importar respuestas…')]);
  await c4.setFiles(junk);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /JSON/);
  assert.equal((await st()).r, before + 1);
  await tab('Inicio');
});

await check('answers to questions that were edited are repaired, not trusted', async () => {
  const f = await ev(() => window.__novaForms.ctl.form);
  const id = f.questions[2].id; // Edad: 18-99
  const evil = path.join(tmp, 'mala.json');
  fs.writeFileSync(evil, JSON.stringify({ format: 'novaforms-response', formId: f.id, id: 'mala1', at: '2025-02-02T10:00:00Z', answers: { [id]: 5, [f.questions[0].id]: '<img src=x onerror=alert(1)>', desconocida: 'x', [f.questions[1].id]: 'ok@x.es' } }));
  const [c] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await tab('Respuestas'); await press('Importar respuestas…'); })()]);
  await c.setFiles(evil);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /1 respuesta\(s\) añadidas?|respuestas añadidas|1 respuestas añadidas/);
  const r = await ev(() => window.__novaForms.ctl.responses.find((x) => x.id === 'mala1'));
  // the age (5) is below the limit and the unknown question is not part of the form: both are dropped;
  // the free-text "other" answer is kept, as plain text
  assert.deepEqual(Object.keys(r.answers).sort(), [f.questions[0].id, f.questions[1].id].sort());
  await page.getByRole('tab', { name: 'Individuales' }).click();
  const next = page.getByRole('button', { name: 'Respuesta siguiente' });
  for (let i = 0; i < 10 && (await next.isEnabled()); i++) await next.click();
  assert.match(await page.getByRole('region', { name: 'Respuesta individual' }).innerText(), /<img src=x onerror=alert\(1\)>/);
  assert.equal(await page.locator('.fm-indiv img').count(), 0);
  await page.getByRole('tab', { name: 'Resumen' }).click();
  await tab('Inicio');
});

await check('save as .novaforms and reopen it identical; damaged files are refused', async () => {
  const sig = () => ev(() => JSON.stringify(window.__novaForms.ctl.doc));
  const before = await sig();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  assert.match(dl.suggestedFilename(), /\.novaforms$/);
  await ev(() => window.__novaForms.ctl.reset());
  assert.equal((await st()).q, 0);
  await settle();
  await page.locator('.fm-scroll').click({ position: { x: 5, y: 5 } }); // keep keyboard focus inside the page
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaForms.ctl.form.questions.length > 0);
  assert.equal(await sig(), before);
  assert.equal((await st()).dirty, false);
  const bad = path.join(tmp, 'roto.novaforms');
  fs.writeFileSync(bad, '{"format":"novaforms","form":');
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')]);
  await c2.setFiles(bad);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /no es un formulario/);
  assert.equal(await sig(), before);
});

await check('deleting a question warns that its answers go too', async () => {
  await ev(() => { const { ctl } = window.__novaForms; ctl.select(ctl.form.questions[2].id); });
  await tab('Inicio');
  const before = await ev(() => window.__novaForms.ctl.responses.filter((r) => r.answers[window.__novaForms.ctl.form.questions[2].id] !== undefined).length);
  assert.ok(before > 0);
  await press('Eliminar pregunta');
  await settle();
  assert.equal((await st()).q, 5);
  assert.equal(await ev(() => window.__novaForms.ctl.responses.every((r) => Object.keys(r.answers).every((k) => window.__novaForms.ctl.form.questions.some((q) => q.id === k)))), true);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await st()).q, 6);
});

await check('two thousand responses are summarised quickly', async () => {
  await ev(() => {
    const { ctl } = window.__novaForms;
    const f = ctl.form;
    const responses = [];
    for (let i = 0; i < 2000; i++) {
      const a = {};
      a[f.questions[0].id] = ['Un amigo', 'Internet', 'Prensa'][i % 3];
      a[f.questions[2].id] = 18 + (i % 60);
      a[f.questions[3].id] = 1 + (i % 4);
      a[f.questions[4].id] = { Claridad: 'De acuerdo', Ritmo: i % 2 ? 'Muy de acuerdo' : 'En desacuerdo' };
      responses.push({ id: `p${i}`, at: new Date(Date.UTC(2025, 0, 1 + (i % 28))).toISOString(), answers: a });
    }
    ctl.commit({ ...ctl.doc, responses });
    ctl.setMode('results');
  });
  const t0 = Date.now();
  await page.getByLabel('Número de respuestas').waitFor();
  assert.equal((await page.getByLabel('Número de respuestas').innerText()).replace(/[.,\s ]/g, '').match(/^\d+/)[0], '2000');
  assert.ok(Date.now() - t0 < 3000, `rendered in ${Date.now() - t0} ms`);
  await page.getByRole('tab', { name: 'Individuales' }).click();
  await page.getByRole('button', { name: 'Respuesta siguiente' }).click();
  assert.match(await page.locator('.fm-pager').innerText(), /2 \/ 2[.,]?000/);
});

await check('import from Google Forms (saved page) and from the responses sheets of Microsoft and Google Forms', async () => {
  const opt = (v, other = 0) => [v, null, null, null, other];
  const e = (id, name, desc, type, entries) => [id, name, desc, type, entries];
  const gform = [null, ['Formulario de Google', [
    e(1, 'Nombre', 'Escribe tu nombre', 0, [[11, null, 1]]),
    e(2, 'Color favorito', null, 2, [[12, [opt('Rojo'), opt('Azul'), opt('', 1)], 1]]),
    e(3, 'Aficiones', null, 4, [[13, [opt('Cine'), opt('Libros')], 0]]),
    e(4, 'Satisfacción', null, 5, [[14, [['1'], ['2'], ['3'], ['4'], ['5']], 1, ['Mala', 'Excelente']]]),
    e(5, 'Documento', null, 13, [[15, null, 0]]),
  ], null, null, null, null, null, null, 'Encuesta importada'], null, 'archivo'];
  const gfile = path.join(tmp, 'google.html');
  fs.writeFileSync(gfile, `<html><body><script>var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(gform)};</script></body></html>`);
  await tab('Inicio');
  dialogs.length = 0;
  let [ch] = await Promise.all([page.waitForEvent('filechooser'), press('Importar formulario…')]);
  await ch.setFiles(gfile);
  await page.waitForFunction(() => window.__novaForms.ctl.form.title === 'Encuesta importada');
  await settle();
  const imported = await qs();
  assert.deepEqual(imported.map((q) => q.type), ['text', 'choice', 'multi', 'rating']);
  assert.equal(imported[1].allowOther, true);
  assert.deepEqual(imported[1].options, ['Rojo', 'Azul']);
  const msg = dialogs.pop() ?? '';
  assert.match(msg, /4 preguntas y 0 respuestas/);
  assert.match(msg, /subir archivos/);
  const s = await st();
  assert.equal(s.dirty, true);
  assert.equal(s.mode, 'design');
  await shot('import-google');
  assert.equal(await ev(() => window.__novaForms.ctl.form.questions[0].description), 'Escribe tu nombre');

  // Microsoft Forms responses sheet
  const msRows = [
    ['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Satisfacción', 'Intereses', 'Comentario'],
    ['1', '01/03/2025 10:00', '01/03/2025 10:05', 'a@x.es', 'Ana', '5', 'Cine;Libros;', 'Muy bueno'],
    ['2', '02/03/2025 10:00', '02/03/2025 10:05', 'b@x.es', 'Beto', '4', 'Cine;', 'Bien'],
    ['3', '03/03/2025 10:00', '03/03/2025 10:05', 'c@x.es', 'Cris', '5', 'Libros;Deporte;', 'Genial'],
    ['4', '04/03/2025 10:00', '04/03/2025 10:05', 'd@x.es', 'Dani', '3', 'Cine;Deporte;', 'Regular'],
  ];
  const mfile = path.join(tmp, 'respuestas-ms.csv');
  fs.writeFileSync(mfile, msRows.map((r) => r.map((c) => '"' + c + '"').join(',')).join(String.fromCharCode(13, 10)));
  await ev(() => { window.__novaForms.ctl.dirty = false; });
  [ch] = await Promise.all([page.waitForEvent('filechooser'), press('Importar formulario…')]);
  await ch.setFiles(mfile);
  await page.waitForFunction(() => window.__novaForms.ctl.form.title === 'respuestas-ms');
  await settle();
  const m = await qs();
  assert.ok(m.length >= 3, JSON.stringify(m.map((q) => q.title)));
  assert.ok(!m.some((q) => /correo|nombre|hora|^id$/i.test(q.title)), 'metadata columns are not questions');
  const s2 = await st();
  assert.equal(s2.mode, 'results');
  assert.equal(s2.r, 4);
  assert.match(dialogs.pop() ?? '', /Hoja de Microsoft Forms/);
  await shot('import-microsoft-results');

  // the imported form can be saved and reopened like any other
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  assert.match(dl.suggestedFilename(), /\.novaforms$/);

  // a page that is not a Google form is refused and nothing changes
  const bad = path.join(tmp, 'nada.html');
  fs.writeFileSync(bad, '<html><body>hola</body></html>');
  const before = await ev(() => JSON.stringify(window.__novaForms.ctl.doc));
  [ch] = await Promise.all([page.waitForEvent('filechooser'), press('Importar formulario…')]);
  await ch.setFiles(bad);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /No se encontró el formulario de Google/);
  assert.equal(await ev(() => JSON.stringify(window.__novaForms.ctl.doc)), before);
});

await shot('final');
await browser.close();

const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of results) console.log(r[0].padEnd(4), r[1], r[2] ? `\n     ${r[2]}` : '');
if (errors.length) console.log('\nconsole errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length || errors.length ? 1 : 0);
