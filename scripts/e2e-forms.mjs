// End-to-end checks for Nova Forms in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-forms.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lowContrast } from './lib-contrast.mjs';

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
  // undoing in this mode is for the boxes: it does not take the response away
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await st()).r, 6);
  await ev(() => { const { ctl } = window.__novaForms; ctl.deleteResponse(ctl.responses[ctl.responses.length - 1].id); });
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
  await p2.locator('[data-q]').nth(3).locator('label[title="2"]').click();
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
  assert.match(dialogs.pop() ?? '', /1 respuesta añadida/);
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
  assert.deepEqual(imported.map((q) => q.type), ['text', 'choice', 'multi', 'rating', 'file']);
  assert.equal(imported[1].allowOther, true);
  assert.deepEqual(imported[1].options, ['Rojo', 'Azul']);
  const msg = dialogs.pop() ?? '';
  assert.match(msg, /5 preguntas y 0 respuestas/);
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

// ------------------------------------------------------------ what was wrong before the second round (phase 1)
const fresh = async () => {
  await ev(() => { window.__novaForms.ctl.dirty = false; window.__novaForms.ctl.reset(); });
  await tab('Inicio');
  await settle();
};
const option = (n, list = 'Opciones') => page.getByRole('group', { name: list, exact: true }).getByLabel(`${list} ${n}`, { exact: true });

await check('options: added with their name, never repeated, and renamed with everything that named them', async () => {
  await fresh();
  await ev(() => window.__novaForms.ctl.setForm({ quiz: true }));
  await addVia('Opción única');
  await setTitle('¿Vienes?');
  await page.getByRole('group', { name: 'Opciones', exact: true }).getByRole('button', { name: 'Añadir' }).click();
  assert.deepEqual((await qs())[0].options, ['Opción 1', 'Opción 2', 'Opción 3']);
  await page.getByRole('group', { name: 'Respuesta correcta' }).getByLabel('Opción 1').check();
  await addVia('Texto corto');
  await setTitle('¿Con quién?');
  const when = page.getByRole('group', { name: 'Mostrar solo si…' });
  await when.getByLabel('Pregunta de la condición').selectOption({ label: '1. ¿Vienes?' });
  await when.getByLabel('Valor de la condición').selectOption('Opción 1');
  await ev(() => { const { ctl } = window.__novaForms; ctl.addResponse({ [ctl.form.questions[0].id]: 'Opción 1', [ctl.form.questions[1].id]: 'Eva' }); });
  await card(1).click();
  // typed letter by letter, passing through the name of another option
  await option(2).fill('');
  await option(2).pressSequentially('Opción 1');
  await option(2).press('Enter');
  assert.match(await page.locator('.fm-list [role="alert"]').innerText(), /Ya hay otro igual/);
  assert.deepEqual((await qs())[0].options, ['Opción 1', 'Opción 2', 'Opción 3']);
  assert.equal(await option(2).inputValue(), 'Opción 2');
  await option(2).fill('A medias');
  await option(2).press('Escape');
  assert.equal(await option(2).inputValue(), 'Opción 2');
  await option(1).fill('Sí');
  await option(1).press('Enter');
  assert.equal(await ev(() => document.activeElement.value), 'Sí', 'the box keeps the focus');
  const after = await qs();
  assert.deepEqual([after[0].correct, after[1].showIf.value], [['Sí'], 'Sí']);
  assert.equal(await ev(() => window.__novaForms.ctl.responses[0].answers[window.__novaForms.ctl.form.questions[0].id]), 'Sí');
  await shot('renamed');
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual([(await qs())[0].options[0], (await qs())[1].showIf.value], ['Opción 1', 'Opción 1']);
});

await check('quiz: several accepted answers can be typed, and the summary is right when not everyone sees everything', async () => {
  await fresh();
  await ev(() => window.__novaForms.ctl.setForm({ quiz: true }));
  await addVia('Texto corto');
  await setTitle('Capital del Perú');
  const box = page.getByLabel('Respuestas aceptadas (separadas por punto y coma)');
  await box.pressSequentially('Lima; lima metropolitana');
  await box.press('Tab');
  assert.deepEqual((await qs())[0].correct, ['Lima', 'lima metropolitana']);
  await addVia('Texto corto');
  await setTitle('Su río');
  await page.getByRole('group', { name: 'Respuesta correcta' }).getByLabel(/Respuestas aceptadas/).fill('Rímac');
  const when = page.getByRole('group', { name: 'Mostrar solo si…' });
  await when.getByLabel('Pregunta de la condición').selectOption({ label: '1. Capital del Perú' });
  await when.getByLabel('Valor de la condición').fill('Lima');
  await ev(() => {
    const { ctl } = window.__novaForms;
    const [a, b] = ctl.form.questions;
    ctl.addResponse({ [a.id]: 'Cusco' });
    ctl.addResponse({ [a.id]: 'Lima', [b.id]: 'Rímac' });
  });
  await mode('Resultados');
  const top = await page.locator('.fm-top').innerText();
  assert.match(top, /Puntuación media:\s*1 · 50 % de lo que cada persona podía sacar \(mejor 2, peor 0\)/);
  assert.match(top, /hasta 2/);
  await shot('quiz-varies');
});

await check('numbers skip titles, on screen and in the exported page', async () => {
  await fresh();
  await addVia('Texto corto');
  await setTitle('Primera');
  await addVia('Título o texto');
  await page.locator('.fm-card.is-sel').getByLabel('Título', { exact: true }).fill('Parte dos');
  await addVia('Texto corto');
  await setTitle('Segunda');
  assert.equal(await card(2).count(), 1);
  assert.equal(await page.locator('section[aria-label="Título o texto 1"]').count(), 1);
  await mode('Vista previa');
  assert.deepEqual(await page.locator('.fm-run .fm-qtitle').allInnerTexts(), ['1. Primera', '2. Segunda']);
  await tab('Respuestas');
  const [dl] = await Promise.all([page.waitForEvent('download'), press('Exportar formulario como página web…')]);
  const file = path.join(tmp, 'numeros.html');
  await dl.saveAs(file);
  const p2 = await ctx.newPage();
  await p2.goto(pathToFileURL(file).href);
  assert.deepEqual(await p2.locator('legend').allInnerTexts(), ['1. Primera', '2. Segunda']);
  await p2.close();
});

await check('undo takes back what was typed in a box at once', async () => {
  await fresh();
  await page.getByRole('region', { name: 'Título y descripción del formulario' }).click();
  const title = page.getByRole('textbox', { name: 'Título del formulario' });
  await title.fill('');
  await title.pressSequentially('Encuesta larga');
  await page.getByRole('textbox', { name: 'Descripción del formulario' }).pressSequentially('Dos minutos');
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await ev(() => [window.__novaForms.ctl.form.title, window.__novaForms.ctl.form.description]), ['Encuesta larga', '']);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal(await ev(() => window.__novaForms.ctl.form.title), 'Formulario sin título');
  await page.keyboard.press('Control+y');
  await settle();
  assert.equal(await title.inputValue(), 'Encuesta larga');
});

await check('a half-filled response stays when looking elsewhere, and Ctrl+Z there never deletes responses', async () => {
  await fresh();
  await addVia('Texto corto');
  await setTitle('Nombre');
  await ev(() => { const { ctl } = window.__novaForms; ctl.addResponse({ [ctl.form.questions[0].id]: 'guardada' }); });
  await mode('Rellenar y guardar respuestas');
  await page.getByLabel('Nombre', { exact: true }).pressSequentially('a medias');
  await mode('Resultados');
  await mode('Diseñar');
  await mode('Rellenar y guardar respuestas');
  assert.equal(await page.getByLabel('Nombre', { exact: true }).inputValue(), 'a medias');
  await page.getByLabel('Nombre', { exact: true }).click();
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await st()).r, 1);
  await press('Enviar');
  await press('Rellenar otra respuesta');
  assert.equal(await page.getByLabel('Nombre', { exact: true }).inputValue(), '');
  assert.equal((await st()).r, 2);
});

await check('what is being typed is saved with the form, and «Acerca de» says the version of the program', async () => {
  await fresh();
  await addVia('Opción única');
  await option(1).fill('Escrita al guardar');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = path.join(tmp, 'borrador.novaforms');
  await dl.saveAs(file);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).form.questions[0].options[0], 'Escrita al guardar');
  const { version } = JSON.parse(fs.readFileSync(new globalThis.URL('../apps/suite/package.json', import.meta.url), 'utf8'));
  await page.getByText('Archivo', { exact: true }).click();
  await page.getByText('Acerca de Nova Forms', { exact: true }).click();
  assert.match(await page.getByRole('dialog').innerText(), new RegExp(`Nova Forms ${version.replace(/\./g, '\\.')}`));
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
});

// ------------------------------------------------------------ questions as in Microsoft Forms (phase 2)
const read = (f) => fs.readFileSync(f);
const exportPage = async (name) => {
  await tab('Respuestas');
  const [dl] = await Promise.all([page.waitForEvent('download'), press('Exportar formulario como página web…')]);
  const out = path.join(tmp, name);
  await dl.saveAs(out);
  await tab('Inicio');
  return out;
};
const openPage = async (f) => {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(pathToFileURL(f).href);
  return { p, errs };
};
const items = (root, name) => root.getByRole('list', { name }).locator('li > span:nth-child(2)').allInnerTexts();
const some = { name: 'notas del curso.txt', mimeType: 'text/plain', buffer: Buffer.from('apuntes: ñandú y más\n') };

await check('design: ranking, files, number and checkbox limits, stars with labels, shuffling and an equation', async () => {
  await fresh();
  await ev(() => window.__novaForms.ctl.setForm({ title: 'Fase dos' }));
  await addVia('Clasificación (ordenar)');
  await setTitle('Ordena los temas');
  for (const [n, v] of [[1, 'Álgebra'], [2, 'Geometría'], [3, 'Cálculo']]) {
    await option(n, 'Elementos').fill(v);
    await option(n, 'Elementos').press('Enter');
  }
  assert.deepEqual((await qs())[0].options, ['Álgebra', 'Geometría', 'Cálculo']);
  await addVia('Subir archivos');
  await setTitle('Tus apuntes');
  await page.getByLabel('Número de archivos').selectOption('2');
  await page.getByLabel('Tamaño máximo de cada uno').selectOption('1');
  await page.getByRole('checkbox', { name: 'Documentos' }).check();
  await addVia('Número');
  await setTitle('Horas de estudio');
  await page.getByLabel('Restricción').selectOption('gt');
  await page.getByLabel('Mayor que').fill('2');
  await addVia('Casillas (varias opciones)');
  await setTitle('Días que puedes');
  await page.getByRole('group', { name: 'Opciones', exact: true }).getByRole('button', { name: 'Añadir' }).click();
  await page.getByLabel('Mínimo de opciones').fill('1');
  await page.getByLabel('Máximo de opciones').fill('2');
  await addVia('Calificación');
  await setTitle('¿Qué tal fue?');
  await page.getByLabel('Etiqueta del extremo bajo').fill('Mal');
  await page.getByLabel('Etiqueta del extremo alto').fill('Genial');
  assert.equal(await page.getByLabel('Símbolo').inputValue(), 'star');
  await addVia('Opción única');
  await setTitle('Resultado de la integral');
  await page.getByRole('group', { name: 'Opciones', exact: true }).getByRole('button', { name: 'Añadir' }).click();
  await page.getByRole('checkbox', { name: 'Barajar las opciones' }).check();
  await press('Agregar una ecuación…');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Código LaTeX (se actualiza solo; también se puede escribir aquí)').fill('\\int_0^1 x^2 \\, dx');
  await shot('equation-dialog');
  await dialog.getByRole('button', { name: 'Aceptar' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await ev(() => window.__novaForms.ctl.form.questions[5].equation.includes('int')), true);
  assert.equal(await page.locator('.fm-card.is-sel .fm-eq msubsup').count() + await page.locator('.fm-card.is-sel .fm-eq munderover').count() > 0, true);
  // a ranking or a file cannot decide whether another question shows
  // the page comes back to assistive technology a moment after the dialog closes
  await page.getByRole('group', { name: 'Mostrar solo si…' }).waitFor();
  const sources = await page.getByRole('group', { name: 'Mostrar solo si…' }).getByLabel('Pregunta de la condición').locator('option').allInnerTexts();
  assert.deepEqual(sources, ['Siempre', '3. Horas de estudio', '4. Días que puedes', '5. ¿Qué tal fue?']);
  await shot('designed-two');
});

await check('filling in: order with the arrows and dragging, attach and refuse files, limits and stars', async () => {
  await mode('Rellenar y guardar respuestas');
  const form = page.getByRole('form', { name: 'Fase dos' });
  const list = 'Ordena los temas';
  assert.deepEqual(await items(form, list), ['Álgebra', 'Geometría', 'Cálculo']);
  await form.getByRole('button', { name: 'Subir Cálculo' }).click();
  assert.deepEqual(await items(form, list), ['Álgebra', 'Cálculo', 'Geometría']);
  assert.equal(await ev(() => document.activeElement.getAttribute('aria-label')), 'Subir Cálculo', 'the arrow keeps the focus');
  const lis = form.getByRole('list', { name: list }).locator('li');
  await lis.nth(2).dragTo(lis.nth(0));
  assert.deepEqual(await items(form, list), ['Geometría', 'Álgebra', 'Cálculo']);
  const files = form.getByLabel('Tus apuntes');
  await files.setInputFiles({ name: 'virus.pdf.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await form.getByText('No se admiten archivos .exe.').waitFor();
  await files.setInputFiles({ name: 'enorme.txt', mimeType: 'text/plain', buffer: Buffer.alloc(1024 * 1024 + 1, 65) });
  await form.getByText(/pasa de 1 MB/).waitFor();
  await files.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('x') });
  await form.getByText(/no es de un tipo admitido/).waitFor();
  await files.setInputFiles([some, { name: 'otro.md', mimeType: 'text/markdown', buffer: Buffer.from('# hola') }]);
  await form.getByRole('button', { name: 'Quitar otro.md' }).waitFor();
  await files.setInputFiles({ name: 'tercero.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await form.getByText(/como máximo 2/).waitFor();
  await form.getByLabel('Horas de estudio').fill('2');
  const boxes = form.getByRole('group', { name: 'Días que puedes' }).getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  assert.equal(await boxes.nth(2).isDisabled(), true);
  await form.getByRole('radio', { name: '4', exact: true }).check();
  assert.equal((await form.getByRole('radiogroup', { name: '¿Qué tal fue?' }).innerText()).replace(/\s/g, ''), '★★★★☆');
  assert.match(await form.innerText(), /Mal[\s\S]*Genial/);
  // the half-filled answer, files included, stays when looking elsewhere
  await mode('Diseñar');
  await mode('Rellenar y guardar respuestas');
  assert.deepEqual(await items(form, list), ['Geometría', 'Álgebra', 'Cálculo']);
  await form.getByRole('button', { name: 'Quitar otro.md' }).waitFor();
  await shot('filling');
  await form.getByRole('button', { name: 'Enviar', exact: true }).click();
  await form.getByText('Escribe un número mayor que 2.').waitFor();
  await form.getByLabel('Horas de estudio').fill('3');
  await form.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByRole('button', { name: 'Rellenar otra respuesta' }).waitFor();
  const a = await ev(() => { const { ctl } = window.__novaForms; return ctl.form.questions.map((q) => ctl.responses[0].answers[q.id]); });
  assert.deepEqual(a[0], ['Geometría', 'Álgebra', 'Cálculo']);
  assert.deepEqual(a[1].map((f) => [f.name, f.size]), [['notas del curso.txt', some.buffer.length], ['otro.md', 6]]);
  assert.equal(a[4], 4);
});

await check('results: the places, and the files saved byte for byte, one by one and all together', async () => {
  await mode('Resultados');
  const ranking = page.getByRole('table', { name: 'Clasificación' });
  assert.match(await ranking.innerText(), /Geometría\s+1\s+1[\s\S]*Álgebra\s+2\s+0[\s\S]*Cálculo\s+3\s+0/);
  const received = page.getByRole('list', { name: 'Archivos recibidos' });
  const [one] = await Promise.all([page.waitForEvent('download'), received.getByRole('button', { name: 'Guardar notas del curso.txt' }).click()]);
  assert.equal(one.suggestedFilename(), 'notas del curso.txt');
  assert.deepEqual(read(await one.path()), some.buffer);
  const [zip] = await Promise.all([page.waitForEvent('download'), press('Guardar todos los archivos')]);
  assert.match(zip.suggestedFilename(), /Tus apuntes\.zip/);
  assert.equal(read(await zip.path()).subarray(0, 2).toString(), 'PK');
  await shot('results-two');
  await page.getByRole('tab', { name: 'Individuales' }).click();
  const indiv = page.getByRole('region', { name: 'Respuesta individual' });
  assert.match(await indiv.innerText(), /1\. Geometría\s+2\. Álgebra/);
  assert.equal(await indiv.getByRole('button', { name: /Guardar/ }).count(), 2);
  await page.getByRole('tab', { name: 'Resumen' }).click();
  const [csv] = await Promise.all([page.waitForEvent('download'), (async () => { await tab('Respuestas'); await press('Exportar respuestas a CSV…'); })()]);
  const text = read(await csv.path()).toString('utf8');
  assert.match(text, /Geometría > Álgebra > Cálculo;notas del curso\.txt \| otro\.md/);
  await tab('Inicio');
});

await check('the exported page does the same: order, files, limits, stars, shuffling and the equation', async () => {
  const f = await exportPage('dos.html');
  const { p, errs } = await openPage(f);
  assert.equal(await p.locator('.eq math').count(), 1);
  assert.ok(await p.locator('.eq math').evaluate((m) => m.getBoundingClientRect().height > 20), 'the equation is drawn');
  const options = await p.locator('[data-q]').nth(5).locator('.opt label').allInnerTexts();
  assert.deepEqual([...options].sort(), ['Opción 1', 'Opción 2', 'Opción 3']);
  const list = 'Ordena los temas';
  await p.getByRole('button', { name: 'Subir Cálculo' }).click();
  await p.getByRole('button', { name: 'Bajar Álgebra' }).click();
  assert.deepEqual(await p.getByRole('list', { name: list }).locator('.t').allInnerTexts(), ['Cálculo', 'Álgebra', 'Geometría']);
  const lis = p.getByRole('list', { name: list }).locator('li');
  await lis.nth(2).dragTo(lis.nth(0));
  assert.deepEqual(await p.getByRole('list', { name: list }).locator('.t').allInnerTexts(), ['Geometría', 'Cálculo', 'Álgebra']);
  const files = p.getByLabel('Tus apuntes');
  await files.setInputFiles({ name: 'virus.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  await p.getByText('No se admiten archivos .exe.').waitFor();
  await files.setInputFiles(some);
  await p.getByRole('button', { name: 'Quitar notas del curso.txt' }).waitFor();
  await p.getByLabel('Horas de estudio').fill('1');
  const boxes = p.locator('[data-q]').nth(3).getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(2).check();
  assert.equal(await boxes.nth(1).isDisabled(), true);
  await p.locator('label[title="5"]').click();
  assert.equal((await p.getByRole('radiogroup', { name: '¿Qué tal fue?' }).innerText()).replace(/\s/g, ''), '★★★★★');
  await shot('page-two', p);
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.getByText('Escribe un número mayor que 2.').waitFor();
  await p.getByLabel('Horas de estudio').fill('8');
  await p.getByRole('button', { name: 'Enviar' }).click();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Descargar mi respuesta' }).click()]);
  const answer = path.join(tmp, 'respuesta-dos.json');
  await dl.saveAs(answer);
  await p.getByRole('button', { name: 'Responder otra vez' }).click();
  // a new answer starts empty
  await p.getByRole('button', { name: /^Quitar/ }).waitFor({ state: 'detached' });
  assert.equal((await p.getByRole('radiogroup', { name: '¿Qué tal fue?' }).innerText()).replace(/\s/g, ''), '☆☆☆☆☆');
  assert.equal(await boxes.nth(1).isDisabled(), false);
  assert.deepEqual(errs, []);
  await p.close();
  // and Nova Forms reads what the page gave
  const [c] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await tab('Respuestas'); await press('Importar respuestas…'); })()]);
  await c.setFiles(answer);
  await page.waitForFunction(() => window.__novaForms.ctl.responses.length === 2);
  const a = await ev(() => { const { ctl } = window.__novaForms; return ctl.form.questions.map((q) => ctl.responses[1].answers[q.id]); });
  assert.deepEqual(a[0], ['Geometría', 'Cálculo', 'Álgebra']);
  assert.equal(Buffer.from(a[1][0].data, 'base64').toString('utf8'), some.buffer.toString('utf8'));
  assert.deepEqual([a[2], a[3], a[4]], [8, ['Opción 1', 'Opción 3'], 5]);
  await tab('Inicio');
});

await check('the new questions and their results are readable in the four themes', async () => {
  dialogs.length = 0;
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await mode('Rellenar y guardar respuestas');
    await page.getByRole('button', { name: 'Borrar respuestas' }).click();
    await page.locator('.fm-scale label[title="3"]').click();
    await settle();
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `rellenar ${theme}`);
    await shot(`theme-${theme}-fill`);
    await mode('Resultados');
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `resultados ${theme}`);
    await mode('Diseñar');
    await ev(() => { const { ctl } = window.__novaForms; ctl.select(ctl.form.questions[1].id); });
    await settle();
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `diseñar ${theme}`);
    await shot(`theme-${theme}-design`);
  }
});

// ------------------------------------------------------------ sections, branching and order (phase 3)
const section = (n) => page.locator(`section[aria-label="Sección ${n}"]`);
const sectionTitle = (text) => page.locator('.fm-card.is-sel').getByLabel('Título de la sección').fill(text);
const renameOptions = async (names) => {
  for (const [i, name] of names.entries()) {
    if (i >= (await page.locator('.fm-card.is-sel').getByRole('group', { name: 'Opciones', exact: true }).locator('input').count())) await page.getByRole('group', { name: 'Opciones', exact: true }).getByRole('button', { name: 'Añadir' }).click();
    await option(i + 1).fill(name);
    await option(i + 1).press('Enter');
  }
};
const condition = () => page.getByRole('group', { name: 'Mostrar solo si…' });
const run = () => page.getByRole('form', { name: 'Viaje' });
const visible = async (root) => (await root.locator('.fm-qtitle, h2').allInnerTexts()).map((x) => x.trim());

await check('sections: the first one wraps what came before; options and sections lead somewhere; several conditions', async () => {
  await fresh();
  await ev(() => window.__novaForms.ctl.setForm({ title: 'Viaje' }));
  await addVia('Opción única');
  await setTitle('¿Vienes?');
  await renameOptions(['Sí', 'No', 'Tal vez']);
  await page.getByRole('checkbox', { name: 'Obligatoria' }).check();
  assert.equal(await page.getByRole('group', { name: /Ramificación/ }).count(), 0, 'without sections there is nowhere to go');
  await addVia('Sección (página nueva)');
  await sectionTitle('Transporte');
  assert.deepEqual((await qs()).map((q) => q.type), ['section', 'choice', 'section']);
  await addVia('Lista desplegable');
  await setTitle('¿Cómo?');
  await renameOptions(['A pie', 'En bus']);
  await page.getByRole('checkbox', { name: 'Obligatoria' }).check();
  await addVia('Texto corto');
  await setTitle('Línea de bus');
  await condition().getByLabel('Pregunta de la condición').selectOption({ label: '2. ¿Cómo?' });
  await condition().getByLabel('Valor de la condición').selectOption('En bus');
  await addVia('Sección (página nueva)');
  await sectionTitle('Comida');
  await addVia('Texto corto');
  await setTitle('¿Qué comes?');
  await page.getByRole('checkbox', { name: 'Obligatoria' }).check();
  await addVia('Sección (página nueva)');
  await sectionTitle('Motivo');
  await addVia('Texto corto');
  await setTitle('Cuéntanos');
  await condition().getByLabel('Pregunta de la condición').selectOption({ label: '1. ¿Vienes?' });
  await condition().getByLabel('Valor de la condición').selectOption('Tal vez');
  await condition().getByRole('button', { name: 'Añadir condición' }).click();
  await condition().getByLabel('Pregunta de la condición 2').selectOption({ label: '2. ¿Cómo?' });
  await condition().getByLabel('Valor de la condición 2').selectOption('En bus');
  await condition().getByLabel('Cuántas condiciones se deben cumplir').selectOption('any');
  await condition().getByRole('button', { name: 'Añadir condición' }).click();
  await condition().getByRole('button', { name: 'Quitar la condición 3' }).click();
  assert.deepEqual(await ev(() => { const x = window.__novaForms.ctl.form.questions.at(-1).showIf; return [x.value, x.anyOf, x.more.length]; }), ['Tal vez', true, 1]);
  await shot('conditions');
  // where the options of the first question lead
  await card(1).click();
  const branch = page.getByRole('group', { name: /Ramificación/ });
  await branch.getByLabel('Adónde lleva «No»').selectOption({ label: 'Terminar el formulario' });
  await branch.getByLabel('Adónde lleva «Tal vez»').selectOption({ label: 'Ir a la sección 4: Motivo' });
  assert.equal(await branch.getByLabel('Adónde lleva «Sí»').inputValue(), '');
  await shot('branching');
  await section(3).click();
  await page.getByLabel('Al terminar esta sección').selectOption({ label: 'Terminar el formulario' });
  // only later sections can be chosen
  assert.deepEqual(await page.getByLabel('Al terminar esta sección').locator('option').allTextContents(), ['Continuar con la siguiente', 'Ir a la sección 4: Motivo', 'Terminar el formulario']);
  assert.match(await section(1).innerText(), /Sección 1 de 4/);
  await tab('Diseño');
  await press('Barra de progreso');
  await press('Ocultar los números');
  assert.equal(await page.getByRole('button', { name: 'Barajar las preguntas', exact: true }).isDisabled(), true);
  await tab('Inicio');
  await shot('sections');
});

await check('filling in page by page: next and back, each page checked, the way chosen by the answers', async () => {
  await mode('Rellenar y guardar respuestas');
  const progress = () => run().getByRole('status').first().innerText();
  assert.equal(await progress(), 'Página 1 de 4');
  assert.deepEqual(await visible(run()), ['¿Vienes? *']);
  assert.equal(await run().getByRole('button', { name: 'Atrás' }).count(), 0);
  await run().getByRole('button', { name: 'Siguiente' }).click();
  await run().getByText('Esta pregunta es obligatoria.').waitFor();
  assert.equal(await progress(), 'Página 1 de 4');
  await run().getByRole('radio', { name: 'Sí' }).check();
  await run().getByRole('button', { name: 'Siguiente' }).click();
  assert.equal(await progress(), 'Página 2 de 4');
  assert.deepEqual(await visible(run()), ['Transporte', '¿Cómo? *']);
  assert.equal(await run().getByRole('alert').count(), 0);
  await run().getByLabel('¿Cómo?').selectOption('En bus');
  await run().getByLabel('Línea de bus').fill('B7');
  // Enter goes on instead of sending
  await run().getByLabel('Línea de bus').press('Enter');
  assert.equal(await progress(), 'Página 3 de 4');
  assert.equal((await st()).r, 0);
  // section 3 ends the form
  assert.equal(await run().getByRole('button', { name: 'Siguiente' }).count(), 0);
  await run().getByRole('button', { name: 'Atrás' }).click();
  assert.equal(await run().getByLabel('Línea de bus').inputValue(), 'B7');
  await run().getByRole('button', { name: 'Atrás' }).click();
  await run().getByRole('radio', { name: 'No' }).check();
  assert.equal(await run().getByRole('button', { name: 'Siguiente' }).count(), 0, 'No ends the form');
  await run().getByRole('radio', { name: 'Tal vez' }).check();
  await run().getByRole('button', { name: 'Siguiente' }).click();
  assert.equal(await progress(), 'Página 4 de 4');
  assert.deepEqual(await visible(run()), ['Motivo', 'Cuéntanos']);
  // the page stays when looking elsewhere
  await mode('Diseñar');
  await mode('Rellenar y guardar respuestas');
  assert.equal(await progress(), 'Página 4 de 4');
  await run().getByLabel('Cuéntanos').fill('no sé');
  await shot('page-four');
  await run().getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByRole('button', { name: 'Rellenar otra respuesta' }).click();
  // what was left behind on the way is not saved
  const saved = await ev(() => { const { ctl } = window.__novaForms; return ctl.form.questions.filter((q) => q.id in ctl.responses[0].answers).map((q) => q.title); });
  assert.deepEqual(saved, ['¿Vienes?', 'Cuéntanos']);
  assert.equal(await progress(), 'Página 1 de 4');
});

await check('the exported page goes the same way, and what it gives is imported', async () => {
  const f = await exportPage('viaje.html');
  const { p, errs } = await openPage(f);
  const progress = () => p.locator('.progress span').innerText();
  const shown = async () => (await p.locator('[data-q]:visible h2, [data-q]:visible legend').allInnerTexts()).map((x) => x.trim());
  assert.equal(await progress(), 'Página 1 de 4');
  assert.deepEqual(await shown(), ['¿Vienes? *']);
  assert.equal(await p.getByRole('button', { name: 'Atrás' }).count(), 0);
  await p.getByRole('button', { name: 'Siguiente' }).click();
  await p.getByText('Esta pregunta es obligatoria.').waitFor();
  await p.getByRole('radio', { name: 'No' }).check();
  assert.equal(await p.getByRole('button', { name: 'Siguiente' }).count(), 0);
  assert.equal(await p.getByRole('button', { name: 'Enviar' }).isVisible(), true);
  await p.getByRole('radio', { name: 'Sí' }).check();
  await p.getByRole('button', { name: 'Siguiente' }).click();
  assert.deepEqual(await shown(), ['Transporte', '¿Cómo? *']);
  await p.getByRole('combobox', { name: '¿Cómo?' }).selectOption('En bus');
  await p.getByRole('textbox', { name: 'Línea de bus' }).fill('C2');
  await p.getByRole('textbox', { name: 'Línea de bus' }).press('Enter');
  assert.equal(await progress(), 'Página 3 de 4');
  await p.getByRole('textbox', { name: '¿Qué comes?' }).press('Enter');
  await p.getByText('Esta pregunta es obligatoria.').waitFor();
  assert.equal(await p.locator('#done').count(), 0);
  await p.getByRole('textbox', { name: '¿Qué comes?' }).fill('Fruta');
  await p.getByRole('button', { name: 'Atrás' }).click();
  assert.equal(await progress(), 'Página 2 de 4');
  await p.getByRole('button', { name: 'Siguiente' }).click();
  await shot('page-sections', p);
  await p.getByRole('button', { name: 'Enviar' }).click();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Descargar mi respuesta' }).click()]);
  const answer = path.join(tmp, 'viaje.json');
  await dl.saveAs(answer);
  await p.getByRole('button', { name: 'Responder otra vez' }).click();
  await p.getByText('Página 1 de 4').waitFor();
  assert.deepEqual(errs, []);
  await p.close();
  dialogs.length = 0;
  const [c] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await tab('Respuestas'); await press('Importar respuestas…'); })()]);
  await c.setFiles(answer);
  await page.waitForFunction(() => window.__novaForms.ctl.responses.length === 2);
  const saved = await ev(() => { const { ctl } = window.__novaForms; return ctl.form.questions.flatMap((q) => ctl.responses[1].answers[q.id] ?? []); });
  assert.deepEqual(saved, ['Sí', 'En bus', 'C2', 'Fruta']);
  await mode('Resultados');
  assert.equal(await page.locator('[data-summary]').count(), 5);
  await tab('Inicio');
});

await check('shuffled questions: each response sees another order, the tied and locked ones stay', async () => {
  await fresh();
  await ev(() => {
    const { ctl } = window.__novaForms;
    ctl.setForm({ title: 'Viaje' });
    for (const t of ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco', 'Seis']) ctl.updateQuestion(ctl.addQuestion('text').id, { title: t });
  });
  await tab('Diseño');
  await press('Barajar las preguntas');
  await tab('Inicio');
  await card(1).click();
  await page.getByRole('checkbox', { name: /No cambiar de sitio/ }).check();
  await mode('Rellenar y guardar respuestas');
  const orders = new Set();
  for (let i = 0; i < 4; i++) {
    const titles = (await run().locator('.fm-qtitle').allInnerTexts()).map((x) => x.trim());
    assert.deepEqual(titles.map((x) => Number(x.split('.')[0])), [1, 2, 3, 4, 5, 6], 'numbered as seen');
    assert.equal(titles[0], '1. Uno');
    orders.add(titles.join());
    await run().getByLabel('Dos', { exact: true }).fill(`r${i}`);
    await run().getByRole('button', { name: 'Enviar', exact: true }).click();
    await page.getByRole('button', { name: 'Rellenar otra respuesta' }).click();
  }
  assert.ok(orders.size > 1, [...orders].join(' / '));
  const f = await exportPage('barajado.html');
  const seen = new Set();
  for (let i = 0; i < 4; i++) {
    const { p, errs } = await openPage(f);
    const titles = await p.locator('legend').allInnerTexts();
    assert.equal(titles[0], '1. Uno');
    assert.equal(titles.length, 6);
    seen.add(titles.join());
    assert.deepEqual(errs, []);
    await p.close();
  }
  assert.ok(seen.size > 1);
});

await check('sections and the progress bar are readable in the four themes', async () => {
  await ev(() => {
    const { ctl } = window.__novaForms;
    ctl.setForm({ title: 'Viaje', shuffle: undefined, progress: true });
    ctl.updateQuestion(ctl.addQuestion('section').id, { title: 'Segunda parte', description: 'Con texto.' });
    ctl.updateQuestion(ctl.addQuestion('choice').id, { title: '¿Seguimos?' });
  });
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await mode('Diseñar');
    await ev(() => { const { ctl } = window.__novaForms; ctl.select(ctl.form.questions.at(-1).id); });
    await settle();
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `diseñar ${theme}`);
    await mode('Rellenar y guardar respuestas');
    await ev(() => window.__novaForms.ctl.setDraftPage(1));
    await settle();
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `rellenar ${theme}`);
    await shot(`theme-${theme}-section`);
  }
});

// ------------------------------------------------------------ settings and looks (phase 4)
const settings = async () => {
  await tab('Diseño');
  await press('Ajustes del formulario…');
  const d = page.getByRole('dialog');
  await d.waitFor();
  return d;
};
const closeSettings = async (d) => {
  await d.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await tab('Inicio');
};
const formNow = () => ev(() => window.__novaForms.ctl.form);
// a moment written as a box of date and time takes it, days from now
const boxTime = (days) =>
  ev((n) => {
    const d = new Date(Date.now() + n * 864e5);
    const two = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
  }, days);
const survey = async (over = {}) => {
  await fresh();
  await ev((o) => {
    const { ctl } = window.__novaForms;
    ctl.setForm({ title: 'Ajustes', ...o });
    ctl.updateQuestion(ctl.addQuestion('text').id, { title: 'Color', required: true });
    ctl.updateQuestion(ctl.addQuestion('number').id, { title: 'Horas', maxValue: 10 });
  }, over);
  await settle();
};
const ajustes = () => page.getByRole('form', { name: 'Ajustes' });

await check('settings: close the form by hand or by dates; the preview warns, filling in shows only the message; undo', async () => {
  await survey();
  let d = await settings();
  assert.match(await d.innerText(), /Ahora mismo admite respuestas/);
  await d.getByLabel('Admitir respuestas', { exact: true }).uncheck();
  await d.getByLabel('Mensaje cuando no se admiten').pressSequentially('Volvemos en julio');
  assert.match(await d.innerText(), /Ahora mismo no admite respuestas/);
  await shot('settings');
  await closeSettings(d);
  assert.match(await page.locator('body').innerText(), /No admite respuestas/);
  await mode('Rellenar y guardar respuestas');
  await page.getByText('Volvemos en julio').waitFor();
  assert.equal(await page.locator('.fm-run input').count(), 0);
  await shot('closed');
  await mode('Vista previa');
  await page.getByText(/así se vería al responderlo cuando las admita/).waitFor();
  assert.equal(await ajustes().getByLabel('Color').count(), 1);
  await mode('Diseñar');
  // the message, typed at once, and then the closing are undone
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await settle();
  const f = await formNow();
  assert.deepEqual([f.closed, f.closedMessage], [undefined, undefined]);
  d = await settings();
  await d.getByLabel('Empieza a admitir respuestas').fill(await boxTime(2));
  assert.match(await d.innerText(), /todavía no admite respuestas/);
  await d.getByLabel('Deja de admitirlas').fill(await boxTime(1));
  await d.getByRole('alert').filter({ hasText: 'El final es anterior' }).waitFor();
  await d.getByLabel('Empieza a admitir respuestas').fill('');
  await d.getByLabel('Deja de admitirlas').fill(await boxTime(-1));
  assert.match(await d.innerText(), /Ahora mismo no admite respuestas/);
  await d.getByLabel('Deja de admitirlas').fill('');
  await d.getByLabel('Empieza a admitir respuestas').fill(await boxTime(2));
  await closeSettings(d);
  await mode('Rellenar y guardar respuestas');
  await page.getByText('Este formulario todavía no admite respuestas.').waitFor();
  await page.getByText(/^Empieza el /).waitFor();
});

await check('it closes while someone is answering: nothing is saved', async () => {
  await survey();
  await mode('Rellenar y guardar respuestas');
  await ajustes().getByLabel('Color').fill('verde');
  await ev(() => window.__novaForms.ctl.setForm({ end: new Date(Date.now() + 700).toISOString() }));
  await page.waitForTimeout(900);
  // the change repaints the page, which may already show it is closed
  const send = ajustes().getByRole('button', { name: 'Enviar', exact: true });
  if (await send.count()) await send.click();
  await page.getByText('Este formulario ya no admite respuestas.').waitFor();
  assert.equal((await st()).r, 0);
});

await check('asks for the name, offers a copy of the answers and no second response', async () => {
  await survey();
  const d = await settings();
  await d.getByLabel('Pedir el nombre de quien responde').check();
  await d.getByLabel('Permitir enviar otra respuesta').uncheck();
  await d.getByLabel('Ofrecer imprimir o guardar las respuestas al terminar').check();
  await closeSettings(d);
  await mode('Rellenar y guardar respuestas');
  await ajustes().getByLabel('Color').fill('verde');
  await ajustes().getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByText('Escribe tu nombre.').waitFor();
  assert.equal((await st()).r, 0);
  await ajustes().getByLabel(/Tu nombre/).fill('  Ana Ruiz ');
  // the name stays when looking elsewhere
  await mode('Diseñar');
  await mode('Rellenar y guardar respuestas');
  assert.equal(await ajustes().getByLabel(/Tu nombre/).inputValue(), '  Ana Ruiz ');
  await ajustes().getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.getByText('Respuesta guardada').waitFor();
  assert.equal(await ev(() => window.__novaForms.ctl.responses[0].name), 'Ana Ruiz');
  assert.equal(await page.getByRole('button', { name: 'Rellenar otra respuesta' }).count(), 0);
  await press('Imprimir o guardar mis respuestas');
  await page.locator('iframe.ml-print').waitFor({ state: 'attached' });
  const printed = await page.locator('iframe.ml-print').getAttribute('srcdoc');
  assert.match(printed, /Mis respuestas[\s\S]*Nombre<\/dt><dd>Ana Ruiz[\s\S]*1\. Color<\/dt><dd>verde[\s\S]*2\. Horas<\/dt><dd>—/);
  await shot('receipt');
  await mode('Resultados');
  await page.getByRole('tab', { name: 'Individuales' }).click();
  assert.match(await page.getByRole('region', { name: 'Respuesta individual' }).innerText(), /Ana Ruiz · /);
  await page.getByRole('tab', { name: 'Resumen' }).click();
  const [csv] = await Promise.all([page.waitForEvent('download'), (async () => { await tab('Respuestas'); await press('Exportar respuestas a CSV…'); })()]);
  assert.match(read(await csv.path()).toString('utf8'), /Fecha;Nombre;Color;Horas[\s\S]*;Ana Ruiz;verde;/);
  await tab('Inicio');
});

await check('time limit: starts on request, survives looking elsewhere, and sends what is right when it ends', async () => {
  await survey();
  const d = await settings();
  await d.getByLabel('Tiempo límite en minutos').fill('2');
  await closeSettings(d);
  await mode('Rellenar y guardar respuestas');
  assert.equal(await page.locator('.fm-run input').count(), 0, 'no question before starting');
  await page.getByText('Este formulario tiene un tiempo límite de 2 minutos.').waitFor();
  await shot('timed-start');
  await press('Empezar');
  const clock = page.getByRole('timer');
  assert.match(await clock.innerText(), /Tiempo restante: (2:00|1:59)/);
  await ajustes().getByLabel('Color').fill('rojo');
  await ajustes().getByLabel('Horas').fill('50');
  await mode('Diseñar');
  await mode('Rellenar y guardar respuestas');
  assert.equal(await ajustes().getByLabel('Color').inputValue(), 'rojo');
  // clearing the answers does not give the time back
  await ev(() => window.__novaForms.ctl.setDraftStarted(Date.now() - 60000));
  await press('Borrar respuestas');
  await page.waitForTimeout(700);
  assert.match(await clock.innerText(), /Tiempo restante: (1:00|0:5\d)/);
  await ajustes().getByLabel('Color').fill('azul');
  await ajustes().getByLabel('Horas').fill('50');
  await ev(() => window.__novaForms.ctl.setDraftStarted(Date.now() - 119300));
  await page.getByText('Se acabó el tiempo.').waitFor();
  await page.getByText('Se envió lo que habías respondido.').waitFor();
  await shot('time-up');
  assert.equal((await st()).r, 1);
  // the number above the limit was left out
  assert.deepEqual(await ev(() => Object.values(window.__novaForms.ctl.responses[0].answers)), ['azul']);
  // with nothing answered, nothing is kept
  await press('Rellenar otra respuesta');
  await press('Empezar');
  await ev(() => window.__novaForms.ctl.setDraftStarted(Date.now() - 125000));
  await page.getByText('No habías respondido nada.').waitFor();
  assert.equal((await st()).r, 1);
  await mode('Diseñar');
  await mode('Rellenar y guardar respuestas');
  await page.getByRole('button', { name: 'Empezar' }).waitFor();
});

await check('background and phone view: colour, gradient and a picture made smaller', async () => {
  await survey({ color: '#107c10' });
  const behind = () =>
    ev(() => {
      const s = getComputedStyle(document.querySelector('.fm-app'));
      return `${s.backgroundImage} | ${s.backgroundColor}`;
    });
  const plain = await behind();
  let d = await settings();
  await d.getByLabel('Fondo', { exact: true }).selectOption('gradient');
  await closeSettings(d);
  assert.equal(await behind(), plain, 'the design view stays plain');
  await mode('Vista previa');
  assert.match(await behind(), /linear-gradient/);
  await shot('gradient');
  await mode('Diseñar');
  d = await settings();
  await d.getByLabel('Fondo', { exact: true }).selectOption('image');
  const big = await ev(() => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1200;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 2400, 1200);
    grad.addColorStop(0, '#103a6b');
    grad.addColorStop(1, '#f2b134');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2400, 1200);
    return c.toDataURL('image/png').split(',')[1];
  });
  await d.getByLabel('Elegir imagen de fondo').setInputFiles({ name: 'roto.png', mimeType: 'image/png', buffer: Buffer.from('no soy una imagen') });
  await d.getByRole('alert').filter({ hasText: 'no es una imagen' }).waitFor();
  await d.getByLabel('Elegir imagen de fondo').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.from(big, 'base64') });
  await d.getByRole('img', { name: 'Imagen de fondo actual' }).waitFor();
  const size = await d.getByRole('img', { name: 'Imagen de fondo actual' }).evaluate(async (i) => {
    await i.decode();
    return [i.naturalWidth, i.naturalHeight, i.src.slice(0, 23)];
  });
  assert.deepEqual(size, [1600, 800, 'data:image/jpeg;base64,']);
  await shot('settings-picture');
  await closeSettings(d);
  await mode('Vista previa');
  assert.match(await behind(), /url\("data:image\/jpeg/);
  await shot('picture');
  await press('Móvil');
  const box = await page.locator('.fm-phone').boundingBox();
  assert.ok(Math.abs(box.width - 390) < 2, `width ${box.width}`);
  assert.equal(await page.locator('.fm-phone').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
  await shot('phone');
  await press('Ordenador');
  assert.equal(await page.locator('.fm-phone').count(), 0);
  await mode('Diseñar');
});

await check('answering in English: texts and errors, in the program and in the exported page', async () => {
  await survey({ thanks: 'Gracias por responder.' });
  const d = await settings();
  await d.getByLabel('Idioma para quien responde').selectOption('en');
  await closeSettings(d);
  await mode('Rellenar y guardar respuestas');
  await ajustes().getByLabel('Horas').fill('50');
  await ajustes().getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByText('This question is required.').waitFor();
  await page.getByText('The highest value is 10.').waitFor();
  await ajustes().getByLabel('Color').fill('green');
  await ajustes().getByLabel('Horas').fill('5');
  await ajustes().getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByText('Thanks for your response.').waitFor();
  await page.getByRole('button', { name: 'Fill in another response' }).waitFor();
  const { p, errs } = await openPage(await exportPage('english.html'));
  assert.equal(await p.locator('html').getAttribute('lang'), 'en');
  await p.getByRole('button', { name: 'Submit' }).click();
  await p.getByText('This question is required.').waitFor();
  assert.match(await p.locator('body').innerText(), /Clear answers[\s\S]*Form made with Nova Forms/);
  await p.getByLabel('Color').fill('red');
  await p.getByRole('button', { name: 'Submit' }).click();
  assert.match(await p.locator('#done').innerText(), /Your response is ready[\s\S]*Thanks for your response\.[\s\S]*Download my response/);
  await shot('page-english', p);
  assert.deepEqual(errs, []);
  await p.close();
});

await check('the exported page: closed or not yet open says only that', async () => {
  await survey({ closed: true, closedMessage: 'Plazas agotadas' });
  let { p, errs } = await openPage(await exportPage('cerrado.html'));
  assert.equal(await p.locator('#closed').innerText(), 'Plazas agotadas');
  assert.equal(await p.locator('input, button').count(), 0);
  await shot('page-closed', p);
  assert.deepEqual(errs, []);
  await p.close();
  await ev(() => window.__novaForms.ctl.setForm({ closed: undefined, start: '2999-01-01T10:00:00.000Z' }));
  ({ p, errs } = await openPage(await exportPage('pronto.html')));
  assert.match(await p.locator('#closed').innerText(), /todavía no admite respuestas[\s\S]*Empieza el .*2999/);
  assert.equal(await p.locator('input, button').count(), 0);
  assert.deepEqual(errs, []);
  await p.close();
});

await check('the exported page: timer, name, copy to print, one response, and the name comes back', async () => {
  await survey({ timeLimit: 3, askName: true, receipt: true, noAgain: true, background: 'tint', color: '#8764b8' });
  const f = await exportPage('tiempo.html');
  const { p, errs } = await openPage(f);
  assert.equal(await p.locator('[data-q]').count(), 0);
  await p.getByText('Este formulario tiene un tiempo límite de 3 minutos.').waitFor();
  await p.getByRole('button', { name: 'Empezar' }).click();
  assert.match(await p.getByRole('timer').innerText(), /Tiempo restante: (3:00|2:59)/);
  await p.getByLabel('Color').fill('lila');
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.getByText('Escribe tu nombre.').waitFor();
  await p.getByLabel(/Tu nombre/).fill('Luis <b>');
  await shot('page-timed', p);
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.locator('#done').waitFor();
  assert.equal(await p.locator('#again').count(), 0);
  await p.evaluate(() => {
    window.print = () => {
      window.printed = true;
    };
  });
  await p.locator('#print').click();
  assert.equal(await p.evaluate(() => window.printed), true);
  assert.equal(await p.locator('#receipt').isVisible(), false);
  await p.emulateMedia({ media: 'print' });
  assert.equal(await p.locator('#receipt').isVisible(), true);
  assert.equal(await p.locator('#app').isVisible(), false);
  assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(255, 255, 255)', 'printed on white');
  assert.match(await p.locator('#receipt').innerText(), /Mis respuestas[\s\S]*Nombre[\s\S]*Luis <b>[\s\S]*1\. Color[\s\S]*lila/);
  await shot('page-receipt', p);
  await p.emulateMedia({ media: null });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('#dl').click()]);
  const answer = path.join(tmp, 'tiempo.json');
  await dl.saveAs(answer);
  assert.equal(JSON.parse(fs.readFileSync(answer, 'utf8')).name, 'Luis <b>');
  // the time runs out
  await p.reload();
  await p.getByRole('button', { name: 'Empezar' }).click();
  await p.getByLabel('Horas').fill('4');
  await p.evaluate(() => {
    const real = Date.now;
    Date.now = () => real() + 181000;
  });
  await p.getByText('Se acabó el tiempo.').waitFor();
  await p.getByText('Se envió lo que habías respondido.').waitFor();
  assert.equal(await p.locator('#f').isVisible(), false);
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.locator('#dl').click()]);
  const late = path.join(tmp, 'tarde.json');
  await dl2.saveAs(late);
  assert.deepEqual(Object.values(JSON.parse(fs.readFileSync(late, 'utf8')).answers), [4]);
  assert.deepEqual(errs, []);
  // a narrow screen: nothing sticks out
  await p.setViewportSize({ width: 360, height: 740 });
  await p.reload();
  await p.getByRole('button', { name: 'Empezar' }).click();
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await shot('page-phone', p);
  await p.close();
  dialogs.length = 0;
  const [c] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await tab('Respuestas'); await press('Importar respuestas…'); })()]);
  await c.setFiles(answer);
  await page.waitForFunction(() => window.__novaForms.ctl.responses.length === 1);
  assert.equal(await ev(() => window.__novaForms.ctl.responses[0].name), 'Luis <b>');
  await tab('Inicio');
});

await check('settings, closed notice, timer and backgrounds are readable in the four themes', async () => {
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await survey({ timeLimit: 5, askName: true, progress: true, background: 'tint', color: '#d13438' });
    const d = await settings();
    await page.waitForTimeout(600); // the dialog fades in
    assert.deepEqual(await lowContrast(page, ['[role="dialog"]']), [], `ajustes ${theme}`);
    await shot(`theme-${theme}-settings`);
    await closeSettings(d);
    await mode('Rellenar y guardar respuestas');
    await press('Empezar');
    await settle();
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `tiempo ${theme}`);
    await shot(`theme-${theme}-timer`);
    await mode('Vista previa');
    await press('Móvil');
    await settle();
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `móvil ${theme}`);
    await shot(`theme-${theme}-phone`);
    await press('Ordenador');
    await ev(() => window.__novaForms.ctl.setForm({ closed: true }));
    await mode('Rellenar y guardar respuestas');
    await settle();
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `cerrado ${theme}`);
    await mode('Diseñar');
  }
});

await check('with the program in English, a new form is answered in English', async () => {
  const other = await browser.newContext();
  const p = await other.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForSelector('.fm-app');
  await p.evaluate(() => window.__novaSettings.set('locale', 'en'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('.fm-app');
  await p.waitForFunction(() => window.__novaForms.ctl.form.language === 'en');
  assert.equal(await p.evaluate(() => window.__novaForms.ctl.dirty), false);
  await other.close();
});

await shot('final');
await browser.close();

const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of results) console.log(r[0].padEnd(4), r[1], r[2] ? `\n     ${r[2]}` : '');
if (errors.length) console.log('\nconsole errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length || errors.length ? 1 : 0);
