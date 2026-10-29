// End-to-end checks for Nova Mail in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-mail.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=mail';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-mail-'));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// blocked remote images are expected: the test asks the browser to try one on purpose
page.on('console', (m) => m.type() === 'error' && !/Keyborg|Content Security Policy|ERR_NAME_NOT_RESOLVED/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  if (d.type() === 'confirm' && /^¿Eliminar/.test(d.message())) return void d.accept();
  dialogs.push(d.message());
  d.dismiss();
});

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const limit = Number(process.env.MAX_CHECKS ?? 1000);
const check = async (name, fn) => {
  if (results.length >= limit) return;
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 7).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(150);
const data = () => ev(() => window.__novaMail.ctl.data.messages.length);
const rows = () => page.locator('.ml-item');
const tab = (n) => page.getByRole('tab', { name: n, exact: true });
const folder = (n) => page.locator('.ml-folders li button', { hasText: n });

// ---------- fixtures ----------
const CRLF = (s) => s.replace(/\n/g, '\r\n');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const files = {
  'plano.eml': CRLF(`From: =?UTF-8?B?QW5hIFDDqXJleg==?= <ana@acme.es>
To: yo@nova.test, luis@acme.es
Cc: marta@acme.es
Subject: Presupuesto del próximo año
Date: Tue, 03 Sep 2024 10:15:00 +0200
Message-ID: <plano-1@acme.es>
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 8bit

Hola, adjunto la propuesta económica.
Visita https://example.org/info para más datos.
`),
  'html.eml': CRLF(`From: Tienda <tienda@shop.example>
To: yo@nova.test
Subject: Oferta con imágenes
Date: Wed, 04 Sep 2024 08:00:00 +0000
Message-ID: <html-1@shop.example>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="MIX"

--MIX
Content-Type: multipart/related; boundary="REL"

--REL
Content-Type: text/html; charset=utf-8

<html><body><h1>Oferta</h1><p>Mira <img src="cid:logo@x" width="8"> y <img src="https://tracker.example/pixel.gif">.</p>
<script>document.title='hackeado'</script><p onclick="alert(1)">Pulsa</p><a href="javascript:alert(2)">malo</a> <a href="https://example.org/oferta">bueno</a></body></html>
--REL
Content-Type: image/png
Content-ID: <logo@x>
Content-Transfer-Encoding: base64

${PNG}
--REL--

--MIX
Content-Type: text/csv; name="datos.csv"
Content-Disposition: attachment; filename="datos.csv"
Content-Transfer-Encoding: base64

${Buffer.from('a;b\n1;2\n').toString('base64')}
--MIX--
`),
  'latin1.eml': Buffer.concat([
    Buffer.from('From: Jos\xe9 <jose@x.es>\r\nTo: yo@nova.test\r\nSubject: =?ISO-8859-1?Q?Ni=F1o_y_caf=E9?=\r\nDate: Thu, 05 Sep 2024 09:00:00 +0200\r\nMessage-ID: <l1@x.es>\r\nContent-Type: text/plain; charset=ISO-8859-1\r\nContent-Transfer-Encoding: 8bit\r\n\r\nSe\xf1or, el caf\xe9 est\xe1 listo.\r\n', 'latin1'),
  ]),
};
for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(tmp, n), c);
const mbox = ['uno', 'dos', 'tres']
  .map((s, i) => `From a${i}@x.es Mon Sep  2 10:00:00 2024\nFrom: a${i}@x.es\nTo: yo@nova.test\nSubject: Buzón ${s}\nDate: Mon, 0${i + 2} Sep 2024 10:00:00 +0000\nMessage-ID: <mb${i}@x.es>\n\nCuerpo ${s}\nFrom aquí no se corta\n`)
  .join('\n');
fs.writeFileSync(path.join(tmp, 'buzon.mbox'), mbox);
const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const ics = CRLF(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:semanal@x
DTSTART:20240101T080000Z
DTEND:20240101T090000Z
RRULE:FREQ=WEEKLY;BYDAY=MO,WE
SUMMARY:Reunión semanal
LOCATION:Sala 2
END:VEVENT
BEGIN:VEVENT
UID:festivo@x
DTSTART;VALUE=DATE:20240102
DTEND;VALUE=DATE:20240103
SUMMARY:Festivo
END:VEVENT
BEGIN:VEVENT
UID:pronto@x
DTSTART:${inMinutes(5)}
DTEND:${inMinutes(65)}
SUMMARY:Llamada inminente
BEGIN:VALARM
TRIGGER:-PT15M
ACTION:DISPLAY
END:VALARM
END:VEVENT
BEGIN:VTODO
UID:tarea@x
SUMMARY:Enviar factura
DUE;VALUE=DATE:20200101
PRIORITY:1
STATUS:NEEDS-ACTION
END:VTODO
END:VCALENDAR`);
fs.writeFileSync(path.join(tmp, 'agenda.ics'), ics);
fs.writeFileSync(path.join(tmp, 'gente.vcf'), CRLF(`BEGIN:VCARD
VERSION:3.0
FN:Ana Pérez
N:Pérez;Ana;;;
ORG:ACME
EMAIL;TYPE=WORK:ana@acme.es
TEL;TYPE=CELL:600111222
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Luis Gómez
N:Gómez;Luis;;;
EMAIL:luis@gomez.es
END:VCARD`));
fs.writeFileSync(path.join(tmp, 'gente.csv'), 'Nombre,Apellidos,Correo electrónico,Teléfono móvil\nMarta,Ruiz,marta@ruiz.es,600333444\n', 'utf8');

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.ml-rail');
await page.screenshot(); // first capture after load can be blank
await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
await page.evaluate(() => window.__novaMail.ctl.setOwner({ name: 'Yo Mismo', email: 'yo@nova.test' }));

const importFiles = async (button, list) => {
  await tab('Datos').click();
  const [c] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: button }).click()]);
  await c.setFiles(list.map((f) => path.join(tmp, f)));
  await settle();
};

await check('rail, folders and ribbon tabs', async () => {
  for (const n of ['Inicio', 'Datos', 'Vista', 'Ayuda']) assert.ok(await tab(n).count(), n);
  for (const f of ['Bandeja de entrada', 'Borradores', 'Elementos enviados', 'Archivo', 'Correo no deseado', 'Elementos eliminados']) assert.ok(await folder(f).count(), f);
  for (const s of ['Correo', 'Calendario', 'Contactos', 'Tareas']) assert.ok(await page.locator('.ml-rail button', { hasText: s }).count(), s);
});

await check('import .eml files: list, unread counters, 8-bit and Latin-1 text', async () => {
  await importFiles('Importar mensajes (.eml)…', ['plano.eml', 'html.eml', 'latin1.eml']);
  await page.waitForFunction(() => window.__novaMail.ctl.data.messages.length === 3);
  await settle();
  assert.equal(await rows().count(), 3);
  assert.match(await folder('Bandeja de entrada').innerText(), /3/);
  // Latin-1 subject decoded from an RFC 2047 word, sender with an accent in an 8-bit header
  const subjects = await ev(() => window.__novaMail.ctl.data.messages.map((m) => m.subject).sort());
  assert.deepEqual(subjects, ['Niño y café', 'Oferta con imágenes', 'Presupuesto del próximo año']);
  assert.ok((await page.locator('.ml-item', { hasText: 'Niño y café' }).innerText()).includes('José'));
  assert.ok((await page.locator('.ml-item', { hasText: 'Niño y café' }).innerText()).includes('Señor, el café está listo'));
  await shot('inbox');
});

await check('reading a message: headers, text, links, mark as read, flag', async () => {
  await page.locator('.ml-item', { hasText: 'Presupuesto' }).click();
  const read = page.locator('.ml-read');
  await read.waitFor();
  assert.match(await read.innerText(), /Ana Pérez <ana@acme\.es>/);
  assert.match(await read.innerText(), /yo@nova\.test, luis@acme\.es/);
  assert.match(await read.innerText(), /Cc\s+marta@acme\.es/);
  const frame = page.frameLocator('.ml-frame');
  assert.match(await frame.locator('body').innerText(), /propuesta económica/);
  assert.match(await folder('Bandeja de entrada').innerText(), /2/, 'one fewer unread');
  // a link asks for confirmation before leaving
  await frame.locator('a', { hasText: 'example.org/info' }).click();
  assert.match(await page.getByRole('dialog').innerText(), /example\.org\/info/);
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.locator('.ml-item', { hasText: 'Presupuesto' }).locator('.ml-flag').click();
  assert.equal(await ev(() => window.__novaMail.ctl.data.messages.find((m) => m.subject.startsWith('Presupuesto')).flagged), true);
});

await check('HTML mail is neutralized: no scripts or handlers, remote images blocked until allowed, cid images inlined', async () => {
  await page.locator('.ml-item', { hasText: 'Oferta' }).click();
  await page.waitForSelector('.ml-frame');
  const doc = await page.locator('.ml-frame').evaluate((f) => f.srcdoc);
  assert.doesNotMatch(doc, /<script/i);
  assert.doesNotMatch(doc, /onclick/i);
  assert.doesNotMatch(doc, /javascript:/i);
  assert.match(doc, /img-src data:;/);
  assert.match(doc, /src="data:image\/png;base64,/);
  assert.match(doc, /https:\/\/example\.org\/oferta/);
  assert.match(await page.locator('.ml-remote').innerText(), /contenido externo/);
  assert.equal(await page.locator('.ml-frame').evaluate((f) => f.contentDocument.title), '', 'the script did not run');
  await page.getByRole('button', { name: 'Mostrar contenido externo' }).click();
  assert.match(await page.locator('.ml-frame').evaluate((f) => f.srcdoc), /img-src data: https: http:/);
  await shot('html');
});

await check('attachments are listed and download byte for byte', async () => {
  await page.locator('.ml-item', { hasText: 'Oferta' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /datos\.csv/ }).click()]);
  const f = path.join(tmp, 'bajado.csv');
  await dl.saveAs(f);
  assert.equal(fs.readFileSync(f, 'utf8'), 'a;b\n1;2\n');
  assert.equal(dl.suggestedFilename(), 'datos.csv');
});

await check('search: accents and case ignored; * searches every folder', async () => {
  await page.keyboard.press('Control+E');
  await page.getByRole('searchbox', { name: 'Buscar correo' }).fill('PROXIMO ano');
  await settle();
  assert.equal(await rows().count(), 1);
  assert.match(await rows().first().innerText(), /Presupuesto/);
  await page.getByRole('searchbox', { name: 'Buscar correo' }).fill('café');
  await settle();
  assert.equal(await rows().count(), 1);
  await page.getByRole('searchbox', { name: 'Buscar correo' }).fill('');
  await settle();
  assert.equal(await rows().count(), 3);
});

await check('reply, reply all and forward prepare the message', async () => {
  await page.locator('.ml-item', { hasText: 'Presupuesto' }).click();
  await page.getByRole('button', { name: 'Responder a todos' }).first().click();
  assert.equal(await page.getByLabel('Asunto').inputValue(), 'Re: Presupuesto del próximo año');
  assert.equal(await page.getByLabel('Para', { exact: true }).inputValue(), 'ana@acme.es, luis@acme.es');
  assert.equal(await page.getByLabel('Cc', { exact: true }).inputValue(), 'marta@acme.es');
  assert.match(await page.getByLabel('Cuerpo del mensaje').inputValue(), /> Hola, adjunto la propuesta/);
  await shot('reply');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Responder', exact: true }).first().click();
  assert.equal(await page.getByLabel('Para', { exact: true }).inputValue(), 'ana@acme.es');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.locator('.ml-item', { hasText: 'Oferta' }).click();
  await page.getByRole('button', { name: 'Reenviar' }).first().click();
  assert.equal(await page.getByLabel('Asunto').inputValue(), 'Fwd: Oferta con imágenes');
  assert.ok(await page.getByText(/datos\.csv/).count(), 'attachment travels with a forward');
  assert.match(await page.getByLabel('Cuerpo del mensaje').inputValue(), /Mensaje reenviado/);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
});

await check('compose: save a draft with Bcc, edit it, export a valid .eml', async () => {
  await page.keyboard.press('Control+Shift+M');
  await page.getByLabel('Para', { exact: true }).fill('bea@x.es');
  await page.getByLabel('Cco').fill('oculta@x.es');
  await page.getByLabel('Asunto').fill('Reunión de mañana ñ');
  await page.getByLabel('Cuerpo del mensaje').fill('Hola Bea,\nnos vemos mañana.\n');
  const att = path.join(tmp, 'nota.txt');
  fs.writeFileSync(att, 'contenido adjunto');
  const [c] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Adjuntar archivo/ }).click()]);
  await c.setFiles(att);
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  assert.match(await page.locator('.ml-ok').innerText(), /Borrador guardado/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar .eml' }).click()]);
  const f = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(f);
  const eml = fs.readFileSync(f, 'utf8');
  assert.match(eml, /^Date: /m);
  assert.match(eml, /^From: Yo Mismo <yo@nova\.test>/m);
  assert.match(eml, /^To: bea@x\.es/m);
  assert.doesNotMatch(eml, /oculta@x\.es/, 'Bcc is never written to the message');
  assert.match(eml, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(eml, /Content-Disposition: attachment; filename="nota\.txt"/);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await folder('Borradores').click();
  assert.equal(await rows().count(), 1);
  await rows().first().click();
  assert.match(await page.locator('.ml-read').innerText(), /Cco\s+oculta@x\.es/);
  await page.locator('.ml-item').first().dblclick();
  assert.equal(await page.getByLabel('Asunto').inputValue(), 'Reunión de mañana ñ');
  assert.equal(await page.getByLabel('Cco').inputValue(), 'oculta@x.es');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await rows().count(), 1, 'saving again replaces the draft');
  await folder('Bandeja de entrada').click();
});

await check('delete goes to the trash, then for good; move, archive, custom folders', async () => {
  await page.locator('.ml-item', { hasText: 'café' }).click();
  await page.getByRole('button', { name: 'Eliminar', exact: true }).first().click();
  await settle();
  assert.equal(await rows().count(), 2);
  await folder('Elementos eliminados').click();
  assert.equal(await rows().count(), 1);
  await page.locator('.ml-item').first().click();
  await page.getByRole('button', { name: 'Eliminar', exact: true }).first().click();
  await settle();
  assert.equal(await data(), 3, 'permanently deleted from the trash');
  await folder('Bandeja de entrada').click();
  await page.locator('.ml-item', { hasText: 'Oferta' }).click();
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.getByLabel('Mover a la carpeta').selectOption('archive');
  await settle();
  assert.equal(await rows().count(), 1);
  await folder('Archivo').click();
  assert.equal(await rows().count(), 1);
  await page.locator('.ml-addfolder').click();
  await page.getByLabel('Nombre de la carpeta').fill('Clientes');
  await page.keyboard.press('Enter');
  assert.ok(await folder('Clientes').count());
  await page.locator('.ml-item').first().click();
  await page.getByLabel('Mover a la carpeta').selectOption({ label: 'Clientes' });
  await folder('Clientes').click();
  assert.equal(await rows().count(), 1);
  await page.getByRole('button', { name: 'Eliminar carpeta' }).click();
  await settle();
  assert.ok(!(await folder('Clientes').count()));
  await folder('Archivo').click();
  assert.equal(await rows().count(), 1, 'its messages moved to Archive');
  await folder('Bandeja de entrada').click();
});

await check('import and export .mbox keep every message intact (including "From " lines)', async () => {
  await importFiles('Importar buzón (.mbox)…', ['buzon.mbox']);
  await page.waitForFunction(() => window.__novaMail.ctl.data.messages.filter((m) => m.subject.startsWith('Buzón')).length === 3);
  assert.ok((await ev(() => window.__novaMail.ctl.data.messages.find((m) => m.subject === 'Buzón uno').preview)).includes('From aquí no se corta'));
  await tab('Datos').click();
  const n = await ev(() => window.__novaMail.ctl.data.messages.filter((m) => m.folder === 'inbox').length);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar carpeta (.mbox)…' }).click()]);
  const f = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(f);
  const out = fs.readFileSync(f, 'latin1');
  assert.equal((out.match(/^From \S+ /gm) ?? []).length, n);
  assert.match(out, /^>From aqu/m);
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
});

await check('calendar: import .ics, week and month views, recurrence, all-day', async () => {
  await page.locator('.ml-rail button', { hasText: 'Calendario' }).click();
  await importFiles('Importar calendario (.ics)…', ['agenda.ics']);
  await page.waitForFunction(() => window.__novaMail.ctl.data.events.length === 3);
  // go to the week of 1 January 2024: Monday and Wednesday carry the weekly meeting
  await ev(() => window.__novaMail.ctl.setAnchor(new Date(2024, 0, 3).getTime()));
  await settle();
  assert.equal(await page.locator('.ml-week__col').count(), 7);
  assert.equal(await page.locator('.ml-ev--block', { hasText: 'Reunión semanal' }).count(), 2);
  assert.equal(await page.locator('.ml-week__allday .ml-ev', { hasText: 'Festivo' }).count(), 1);
  await page.getByRole('button', { name: 'Siguiente' }).click();
  assert.equal(await page.locator('.ml-ev--block', { hasText: 'Reunión semanal' }).count(), 2, 'repeats the following week');
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Vista Mes' }).click();
  assert.ok((await page.locator('.ml-month__cell .ml-ev', { hasText: 'Reunión semanal' }).count()) >= 8);
  await page.getByRole('button', { name: 'Vista Día' }).click();
  await shot('calendar');
});

await check('calendar: create, edit and delete events; delete a single occurrence', async () => {
  await ev(() => window.__novaMail.ctl.setAnchor(new Date(2030, 5, 12).getTime()));
  await page.getByRole('button', { name: 'Vista Semana' }).click();
  await page.getByRole('button', { name: 'Evento nuevo' }).click();
  await page.getByLabel('Título', { exact: true }).fill('Dentista');
  await page.getByLabel('Lugar').fill('Clínica');
  await page.getByLabel('Hora de inicio').fill('16:30');
  await page.getByLabel('Hora de fin').fill('17:15');
  await page.getByLabel('Recordatorio', { exact: true }).selectOption('15');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  await settle();
  const block = page.locator('.ml-ev--block', { hasText: 'Dentista' });
  assert.equal(await block.count(), 1);
  assert.match(await block.innerText(), /16:30/);
  // an end before the start is refused
  await block.click();
  await page.getByLabel('Hora de fin').fill('15:00');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  assert.match(await page.locator('.ml-error').innerText(), /no puede terminar antes/);
  await page.getByLabel('Hora de fin').fill('18:00');
  await page.getByLabel('Repetición').selectOption('FREQ=DAILY');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  await settle();
  assert.equal(await page.locator('.ml-ev--block', { hasText: 'Dentista' }).count(), 5, 'the daily series fills the rest of the week (it starts on Wednesday)');
  await page.locator('.ml-ev--block', { hasText: 'Dentista' }).nth(2).click();
  await page.getByRole('button', { name: 'Eliminar solo esta repetición' }).click();
  await settle();
  assert.equal(await page.locator('.ml-ev--block', { hasText: 'Dentista' }).count(), 4);
  await page.locator('.ml-ev--block', { hasText: 'Dentista' }).first().click();
  await page.getByRole('button', { name: 'Eliminar la serie' }).click();
  await settle();
  assert.equal(await page.locator('.ml-ev--block', { hasText: 'Dentista' }).count(), 0);
});

await check('reminders show a notice that can be dismissed', async () => {
  await ev(() => window.__novaMail.checkReminders());
  await page.waitForSelector('.ml-toast');
  assert.match(await page.locator('.ml-toast').innerText(), /Llamada inminente/);
  await page.getByRole('button', { name: 'Descartar' }).click();
  await settle();
  assert.equal(await page.locator('.ml-toast').count(), 0);
});

await check('contacts: import vCard and CSV, search, edit, write to a contact, delete', async () => {
  await page.locator('.ml-rail button', { hasText: 'Contactos' }).click();
  await importFiles('Importar contactos (.vcf, .csv)…', ['gente.vcf']);
  await importFiles('Importar contactos (.vcf, .csv)…', ['gente.csv']);
  await page.waitForFunction(() => window.__novaMail.ctl.data.contacts.length === 3);
  assert.equal(await page.locator('.ml-contacts__list li[role="option"]').count(), 3);
  await page.getByLabel('Buscar contactos').fill('gomez');
  assert.equal(await page.locator('.ml-contacts__list li[role="option"]').count(), 1);
  await page.locator('.ml-contacts__list li button').first().click();
  assert.equal(await page.getByLabel('Apellidos').inputValue(), 'Gómez');
  await page.getByLabel('Empresa').fill('Gómez e Hijos');
  await page.getByRole('button', { name: 'Guardar contacto' }).click();
  assert.equal(await ev(() => window.__novaMail.ctl.data.contacts.find((c) => c.last === 'Gómez').org), 'Gómez e Hijos');
  await page.getByRole('button', { name: 'Nuevo correo' }).click();
  assert.equal(await page.getByLabel('Para', { exact: true }).inputValue(), 'luis@gomez.es');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByLabel('Buscar contactos').fill('');
  await page.locator('.ml-contacts__list li button', { hasText: 'Marta' }).click();
  await page.getByRole('button', { name: 'Eliminar contacto' }).click();
  await settle();
  assert.equal(await ev(() => window.__novaMail.ctl.data.contacts.length), 2);
  await shot('contacts');
  await tab('Datos').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar contactos (.vcf)…' }).click()]);
  const f = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(f);
  const vcf = fs.readFileSync(f, 'utf8');
  assert.equal((vcf.match(/BEGIN:VCARD/g) ?? []).length, 2);
  assert.match(vcf, /FN:Ana Pérez/);
  assert.match(vcf, /ORG:Gómez e Hijos/);
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
});

await check('tasks: add, complete, filter, overdue marker, edit, imported tasks', async () => {
  await page.locator('.ml-rail button', { hasText: 'Tareas' }).click();
  assert.equal(await page.locator('.ml-tasks__list li:not(.ml-empty)').count(), 1, 'the task from the .ics file');
  assert.match(await page.locator('.ml-tasks__list').innerText(), /Enviar factura/);
  assert.match(await page.locator('.ml-tasks__list').innerText(), /vencida/);
  await page.getByRole('textbox', { name: 'Tarea nueva' }).fill('Llamar al banco');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.ml-tasks__list li:not(.ml-empty)').count(), 2);
  await page.getByLabel('Fecha de vencimiento').fill('2031-02-03');
  await page.getByLabel('Prioridad', { exact: true }).selectOption('high');
  await page.getByRole('button', { name: 'Guardar tarea' }).click();
  await page.getByLabel('Completar Llamar al banco').click(); // it leaves the "open" list at once, so check() could not verify the state
  await settle();
  assert.equal(await page.locator('.ml-tasks__list li:not(.ml-empty)').count(), 1);
  await page.getByRole('button', { name: 'Completadas' }).click();
  assert.match(await page.locator('.ml-tasks__list').innerText(), /Llamar al banco/);
  await page.getByRole('button', { name: 'Todas' }).click();
  assert.equal(await page.locator('.ml-tasks__list li:not(.ml-empty)').count(), 2);
  assert.equal(await ev(() => window.__novaMail.ctl.data.tasks.find((t) => t.title === 'Llamar al banco').priority), 'high');
});

await check('save the data file and reopen it identical; damaged files are refused', async () => {
  const sig = () => ev(() => { const d = window.__novaMail.ctl.data; return JSON.stringify([d.owner.email, d.messages.map((m) => [m.subject, m.folder, m.read, m.flagged]), d.events.length, d.tasks.map((t) => [t.title, t.done]), d.contacts.map((c) => c.name)]); });
  const before = await sig();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const f = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(f);
  assert.match(dl.suggestedFilename(), /\.novamail$/);
  await ev(() => window.__novaMail.ctl.newDoc());
  assert.equal(await data(), 0);
  const [c] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await c.setFiles(f);
  await page.waitForFunction(() => window.__novaMail.ctl.data.messages.length > 0);
  assert.equal(await sig(), before);
  const bad = path.join(tmp, 'roto.novamail');
  fs.writeFileSync(bad, '{"version":1,');
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await c2.setFiles(bad);
  await page.waitForTimeout(300);
  assert.equal(dialogs.length, 1);
  assert.match(dialogs.pop(), /no es de Nova Mail/);
});

await check('a mailbox of 5 000 messages stays usable (virtualized list, indexed search)', async () => {
  await page.locator('.ml-rail button', { hasText: 'Correo' }).click();
  const t0 = Date.now();
  await ev(async () => {
    const { ctl } = window.__novaMail;
    ctl.batch(() => {
    for (let i = 0; i < 5000; i++) {
      const raw = `From: Remitente ${i % 50} <r${i % 50}@x.es>\r\nTo: yo@nova.test\r\nSubject: Asunto número ${i}\r\nDate: ${new Date(Date.UTC(2023, 0, 1) + i * 3600000).toUTCString()}\r\nMessage-ID: <g${i}@x.es>\r\n\r\nTexto del mensaje ${i} con la palabra clave${i % 7}.\r\n`;
      ctl.importRaw(raw, 'inbox', { read: true });
    }
    });
  });
  const build = Date.now() - t0;
  await folder('Bandeja de entrada').click();
  await settle();
  assert.ok((await rows().count()) < 60, 'only the visible rows exist');
  const t1 = Date.now();
  await page.getByRole('searchbox', { name: 'Buscar correo' }).fill('clave3 número');
  await settle();
  assert.ok(Date.now() - t1 < 3000, 'search is fast');
  assert.ok((await ev(() => window.__novaMail.ctl.list().length)) > 100);
  assert.ok(build < 20000, `building ${build} ms`);
  await page.getByRole('searchbox', { name: 'Buscar correo' }).fill('');
});

await check('dark theme; no console errors or unexpected dialogs', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(200);
  await shot('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
