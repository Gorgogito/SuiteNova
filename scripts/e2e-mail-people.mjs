// Contacts and tasks of Nova Mail (second round, phase 7): groups, pictures, duplicates, adding from a message,
// repeating tasks and their reminders, and their own undo. With a simulated server.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-mail-people.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lowContrast } from './lib-contrast.mjs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const errors = [];
const questions = [];
let answer = true;
let ctx;
let page;

const results = [];
const check = async (name, fn) => {
  try {
    await fresh();
    await fn();
    results.push(['ok', name]);
    console.log(`  ✔ ${name}`);
  } catch (e) {
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/fail-${results.length}.png`, timeout: 5000 }).catch(() => {});
    results.push(['FAIL', name]);
    console.log(`  ✘ ${name}\n      ${e.message.split('\n').filter(Boolean).slice(0, 14).join('\n      ')}`);
  }
};
const settle = (ms = 200) => page.waitForTimeout(ms);
const shot = (n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const ev = (fn, arg) => page.evaluate(fn, arg);
const ctl = (fn, arg) => page.evaluate(`(${fn})(window.__novaMail.ctl, ${JSON.stringify(arg ?? null)})`);

const fresh = async () => {
  await ctx?.close();
  answer = true;
  ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light', acceptDownloads: true });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('dialog', (d) => (questions.push(d.message()), (answer ? d.accept() : d.dismiss()).catch(() => {})));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404|beforeunload|Blocked script|img-src data:/.test(m.text()) && errors.push(m.text()));
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${BASE}?app=mail`, { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector('.ml-app', { timeout: 30000 });
      break;
    } catch (e) {
      if (attempt) throw e;
    }
  }
  await page.waitForFunction(() => !!window.__novaMail, null, { timeout: 60000 });
  await ctl((c) => {
    const person = (id, name, email, extra = {}) => ({ id, uid: `${id}@x`, name, first: name.split(' ')[0], last: name.split(' ').slice(1).join(' '), org: '', title: '', emails: [{ label: 'trabajo', value: email }], phones: [], address: '', url: '', birthday: '', note: '', ...extra });
    c.data.contacts = [person('ana', 'Ana García', 'ana@ejemplo.es', { org: 'Obras' }), person('luis', 'Luis Pérez', 'luis@ejemplo.es')];
    c.setOwner({ name: 'Yo', email: 'yo@ejemplo.es' });
    c.importRaw('From: "Marta Ruiz" <marta@ejemplo.es>\r\nTo: yo@ejemplo.es, ana@ejemplo.es\r\nSubject: Presupuesto\r\nDate: Mon, 8 Jun 2026 10:00:00 +0200\r\n\r\nHola\r\n', 'inbox', { read: false });
  });
  questions.length = 0;
  await settle(300);
};

const command = (id) => page.locator(`[data-nv-item="${id}"]`);
const section = (s) => ctl((c, x) => c.go(x), s);
const list = () => page.getByRole('listbox', { name: 'Contactos' });
const person = (name) => list().getByRole('button', { name: new RegExp(name) });
const field = (name) => page.getByRole('textbox', { name, exact: true });
const button = (name) => page.getByRole('button', { name, exact: true });
const menuItem = (name) => page.locator('.ml-menu button', { has: page.locator('.ml-menu__label', { hasText: name }) }).last();
const contacts = () => ctl((c) => c.data.contacts.map((x) => ({ name: x.name, emails: x.emails.map((e) => e.value), members: x.members?.map((m) => m.email), photo: x.photo?.slice(0, 23) })));
const tasks = () => ctl((c) => c.data.tasks.map((x) => ({ title: x.title, done: x.done, due: x.due && new Date(x.due).toLocaleDateString('es-ES'), rrule: x.rrule, remind: x.remind && `${new Date(x.remind).toLocaleDateString('es-ES')} ${new Date(x.remind).toTimeString().slice(0, 5)}` })));
/** A picture drawn in the page, larger than what is kept. */
const picture = async () =>
  Buffer.from(
    await ev(() => {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 600;
      const g = c.getContext('2d');
      g.fillStyle = '#0a6';
      g.fillRect(0, 0, 900, 600);
      g.fillStyle = '#fc0';
      g.beginPath();
      g.arc(450, 300, 220, 0, 7);
      g.fill();
      return c.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );

await check('grupo: crearlo, agregar personas, y escribir a todas desde él y desde «Para»', async () => {
  await section('contacts');
  await command('contact.group.new').click();
  await field('Nombre del grupo').fill('Equipo de obra');
  const add = page.getByRole('combobox', { name: 'Agregar personas' });
  await add.fill('ana');
  await page.getByRole('listbox', { name: 'Sugerencias de destinatarios' }).getByRole('option', { name: /Ana García/ }).click();
  await add.pressSequentially('luis pérez, nueva@ejemplo.es, Fulano');
  await button('Agregar').last().click();
  assert.match(await page.getByRole('alert').innerText(), /No se reconoce: Fulano/);
  assert.equal(await add.inputValue(), 'Fulano');
  await add.fill('');
  await button('Guardar grupo').click();
  assert.deepEqual((await contacts())[2], { name: 'Equipo de obra', emails: [], members: ['ana@ejemplo.es', 'luis@ejemplo.es', 'nueva@ejemplo.es'], photo: undefined });
  assert.match(await person('Equipo de obra').innerText(), /3 personas/);
  await shot('grupo');
  await button('Quitar nueva@ejemplo.es').click();
  await button('Guardar grupo').click();
  await button('Nuevo correo').click();
  assert.match(await page.getByRole('combobox', { name: 'Para' }).inputValue(), /Ana García <ana@ejemplo\.es>, Luis Pérez <luis@ejemplo\.es>/);
  await ctl((c) => c.closeCompose());
  await ctl((c) => c.newMessage());
  const to = page.getByRole('combobox', { name: 'Para' });
  await to.pressSequentially('equi');
  const option = page.getByRole('listbox', { name: 'Sugerencias de destinatarios' }).getByRole('option', { name: /Equipo de obra/ });
  assert.match(await option.innerText(), /2 personas/);
  await shot('sugerencia-grupo');
  await to.press('Enter');
  assert.match(await to.inputValue(), /^Ana García <ana@ejemplo\.es>, Luis Pérez <luis@ejemplo\.es>, $/);
});

await check('foto: se elige, se hace pequeña, se ve en la lista y en el mensaje, y se quita', async () => {
  await ctl((c) => c.openContact('ana'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button('Agregar una foto…').click()]);
  await chooser.setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: await picture() });
  await page.locator('.ml-contactform img.ml-avatar').waitFor();
  assert.equal((await contacts())[0].photo, undefined, 'not saved yet');
  await button('Guardar contacto').click();
  assert.equal((await contacts())[0].photo, 'data:image/jpeg;base64,');
  assert.deepEqual(await page.locator('.ml-contactform img.ml-avatar').evaluate((i) => [i.naturalWidth, i.naturalHeight]), [256, 171]);
  assert.equal(await person('Ana García').locator('img').count(), 1);
  await shot('foto');
  const [bad] = await Promise.all([page.waitForEvent('filechooser'), button('Cambiar la foto…').click()]);
  await bad.setFiles({ name: 'no.png', mimeType: 'image/png', buffer: Buffer.from('esto no es una imagen') });
  assert.match(await page.getByRole('alert').innerText(), /no es una imagen/);
  await ctl((c) => {
    c.importRaw('From: Ana <ana@ejemplo.es>\r\nSubject: Con foto\r\n\r\nx\r\n', 'inbox');
    c.openMessage(c.data.messages.find((m) => m.subject === 'Con foto').id);
  });
  await page.getByRole('img', { name: 'Foto del contacto' }).waitFor();
  await shot('foto-mensaje');
  await ctl((c) => c.openContact('ana'));
  await button('Quitar la foto').click();
  await button('Guardar contacto').click();
  assert.equal((await contacts())[0].photo, undefined);
  await page.locator('.ml-contacts__list').click();
  await page.keyboard.press('Control+z');
  assert.equal((await contacts())[0].photo, 'data:image/jpeg;base64,');
});

await check('desde un mensaje: agregar al remitente, verlo después, y desde el menú de la lista', async () => {
  await page.locator('.ml-item', { hasText: 'Presupuesto' }).click();
  await page.locator('.ml-read .ml-who', { hasText: 'Marta Ruiz' }).click();
  await shot('menu-direccion');
  await menuItem('Agregar a contactos').click();
  await field('Nombre').waitFor();
  assert.equal(await field('Nombre').inputValue(), 'Marta');
  assert.equal(await field('Apellidos').inputValue(), 'Ruiz');
  assert.equal(await page.getByRole('textbox', { name: 'Correo electrónico 1' }).inputValue(), 'marta@ejemplo.es');
  await section('mail');
  await page.locator('.ml-read .ml-who', { hasText: 'Marta Ruiz' }).click();
  await menuItem('Ver el contacto').click();
  assert.equal((await contacts()).length, 3);
  // a recipient who is already there, and the one of the person, who is not
  await section('mail');
  await page.locator('.ml-read .ml-who', { hasText: 'ana@ejemplo.es' }).click();
  await menuItem('Ver el contacto').click();
  assert.equal(await ctl((c) => c.selectedContact), 'ana');
  await ctl((c) => c.people.remove(c.data.contacts[2].id));
  await section('mail');
  await page.locator('.ml-item', { hasText: 'Presupuesto' }).click({ button: 'right' });
  await menuItem('Agregar a contactos').click();
  assert.equal((await contacts()).at(-1).name, 'Marta Ruiz');
});

await check('eliminar un contacto se deshace, y duplicados: se avisa, se combinan y se deshace', async () => {
  await ctl((c) => c.openContact('luis'));
  await button('Eliminar contacto').click();
  assert.match(questions.at(-1), /Ctrl\+Z/);
  assert.equal((await contacts()).length, 1);
  await page.keyboard.press('Control+z');
  assert.equal((await contacts()).length, 2);
  await ctl((c) => {
    c.addContact({ ...c.data.contacts[0], id: 'ana2', uid: 'a2@x', name: 'A. García', org: 'Reformas', emails: [{ label: 'casa', value: 'ANA@ejemplo.es' }, { label: 'casa', value: 'ana@casa.es' }] });
    c.addContact({ ...c.data.contacts[1], id: 'luis2', uid: 'l2@x', emails: [{ label: 'casa', value: 'luis@casa.es' }] });
    c.openContact('ana');
  });
  assert.match(await page.getByRole('note').innerText(), /mismo correo: A\. García/);
  await button('Revisar duplicados…').click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.locator('fieldset').count(), 2);
  const boxes = dialog.getByRole('checkbox');
  assert.deepEqual([await boxes.nth(0).isChecked(), await boxes.nth(1).isChecked()], [true, false], 'a shared name is not ticked');
  await settle(400);
  await shot('duplicados');
  await dialog.getByRole('button', { name: 'Combinar los marcados' }).click();
  assert.match(await dialog.getByRole('status').innerText(), /Se combinaron 2 contactos/);
  assert.equal(await dialog.locator('fieldset').count(), 1);
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await dialog.waitFor({ state: 'detached' });
  const after = await contacts();
  assert.equal(after.length, 3);
  assert.deepEqual(after[0].emails.map((x) => x.toLowerCase()), ['ana@ejemplo.es', 'ana@casa.es']);
  await page.locator('.ml-contacts__list').click();
  await page.keyboard.press('Control+z');
  assert.equal((await contacts()).length, 4);
});

await check('importar una vCard con foto y grupo, y exportarla', async () => {
  await section('contacts');
  const jpg = (await picture()).toString('base64');
  const vcf = ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Zoe Foto', 'EMAIL:zoe@ejemplo.es', `PHOTO;ENCODING=b;TYPE=PNG:${jpg}`, 'END:VCARD', 'BEGIN:VCARD', 'VERSION:3.0', 'FN:Peña', 'X-ADDRESSBOOKSERVER-KIND:group', 'X-ADDRESSBOOKSERVER-MEMBER;CN="Zoe Foto":mailto:zoe@ejemplo.es', 'END:VCARD', ''].join('\r\n');
  await page.getByRole('tab', { name: 'Datos', exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), command('data.import.contacts').click()]);
  await chooser.setFiles({ name: 'agenda.vcf', mimeType: 'text/vcard', buffer: Buffer.from(vcf) });
  await person('Zoe Foto').first().waitFor();
  const all = await contacts();
  assert.equal(all.length, 4);
  assert.deepEqual(all[3].members, ['zoe@ejemplo.es']);
  // the large picture was made small
  assert.ok((await ctl((c) => c.data.contacts[2].photo.length)) < 150000);
  const [dl] = await Promise.all([page.waitForEvent('download'), command('data.export.vcf').click()]);
  const out = fs.readFileSync(await dl.path(), 'utf8').replace(/\r\n /g, '');
  assert.match(out, /PHOTO;ENCODING=b;TYPE=(JPEG|PNG):/);
  assert.match(out, /X-ADDRESSBOOKSERVER-MEMBER;CN="Zoe Foto":mailto:zoe@ejemplo\.es/);
  await page.keyboard.press('Control+z');
});

await check('tarea que se repite con aviso: guardarla, completarla, deshacer', async () => {
  await section('tasks');
  await page.getByRole('textbox', { name: 'Tarea nueva' }).fill('Informe mensual');
  await page.keyboard.press('Enter');
  await page.getByLabel('Fecha de vencimiento').fill('2027-01-31');
  await page.getByRole('combobox', { name: 'Repetición' }).selectOption({ label: 'Todos los meses' });
  await page.getByRole('checkbox', { name: 'Recordármelo' }).check();
  assert.equal(await page.getByLabel('Fecha del aviso').inputValue(), '2027-01-31');
  await page.getByLabel('Fecha del aviso').fill('2027-01-29');
  await page.getByLabel('Hora del aviso').fill('17:30');
  await shot('tarea');
  await button('Guardar tarea').click();
  assert.deepEqual(await tasks(), [{ title: 'Informe mensual', done: false, due: '31/1/2027', rrule: 'FREQ=MONTHLY', remind: '29/1/2027 17:30' }]);
  assert.equal(await page.getByRole('img', { name: 'Se repite' }).count(), 1);
  assert.equal(await page.getByRole('img', { name: 'Con aviso' }).count(), 1);
  await page.getByRole('checkbox', { name: 'Completar Informe mensual' }).first().click();
  assert.deepEqual(await tasks(), [
    { title: 'Informe mensual', done: false, due: '28/2/2027', rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', remind: '26/2/2027 17:30' },
    { title: 'Informe mensual', done: true, due: '31/1/2027', rrule: undefined, remind: undefined },
  ]);
  assert.match(await page.getByTestId('sync-status').innerText(), /la siguiente vence/);
  assert.equal(await page.getByRole('combobox', { name: 'Repetición' }).inputValue(), 'FREQ=MONTHLY');
  assert.equal(await page.getByLabel('Fecha de vencimiento').inputValue(), '2027-02-28');
  await page.locator('.ml-tasks__list').click({ position: { x: 20, y: 400 } });
  await page.keyboard.press('Control+z');
  assert.equal((await tasks()).length, 1);
  assert.equal((await tasks())[0].due, '31/1/2027');
  await page.getByRole('spinbutton', { name: 'Cada cuántas veces' }).fill('2');
  await page.getByLabel('Repetir hasta').fill('2027-02-15');
  await button('Guardar tarea').click();
  await page.getByRole('checkbox', { name: 'Completar Informe mensual' }).first().click();
  await button('Todas').click();
  assert.deepEqual((await tasks()).map((x) => x.done), [true], 'the series ended');
});

await check('el aviso de una tarea: sale, se pospone, se abre y se descarta', async () => {
  await ctl((c) => {
    const past = Date.now() - 60000;
    c.people.addTask({ id: 'av', uid: 'av@x', title: 'Llamar al banco', notes: '', due: null, done: false, completedAt: null, priority: 'normal', remind: past });
  });
  const toast = page.locator('.ml-toast', { hasText: 'Llamar al banco' });
  await toast.waitFor();
  assert.match(await toast.innerText(), /Tarea/);
  await shot('aviso-tarea');
  await toast.getByRole('button', { name: 'Abrir' }).click();
  assert.equal(await page.getByLabel('Título de la tarea').inputValue(), 'Llamar al banco');
  await toast.getByRole('combobox').selectOption('15');
  await toast.waitFor({ state: 'detached' });
  assert.ok((await ctl((c) => c.data.tasks[0].remind - Date.now())) > 800000);
  await ctl((c) => c.updateTask({ ...c.data.tasks[0], remind: Date.now() - 1000 }));
  await toast.waitFor();
  await toast.getByRole('button', { name: 'Descartar' }).click();
  await toast.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('checkbox', { name: 'Recordármelo' }).isChecked(), false);
});

await check('contactos, grupo, duplicados y tarea se leen en los cuatro temas', async () => {
  await ctl((c) => {
    c.addContact({ ...c.data.contacts[0], id: 'ana2', uid: 'a2@x' });
    c.addContact({ id: 'g', uid: 'g@x', name: 'Equipo', first: '', last: '', org: '', title: '', emails: [], phones: [], address: '', url: '', birthday: '', note: '', members: [{ name: 'Luis', email: 'luis@ejemplo.es' }] });
    c.people.addTask({ id: 't', uid: 't@x', title: 'Informe', notes: '', due: Date.now(), done: false, completedAt: null, priority: 'high', rrule: 'FREQ=WEEKLY', remind: Date.now() + 86400000 });
  });
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await ctl((c) => c.openContact('ana'));
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-contacts']), [], `contacto ${theme}`);
    await shot(`tema-${theme}-contacto`);
    await button('Revisar duplicados…').click();
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['[role="dialog"] .ml-dups']), [], `duplicados ${theme}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await ctl((c) => c.openContact('g'));
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-contacts']), [], `grupo ${theme}`);
    await shot(`tema-${theme}-grupo`);
    await ctl((c) => c.openTask('t'));
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-tasks']), [], `tarea ${theme}`);
    await shot(`tema-${theme}-tarea`);
    await section('mail');
    await page.locator('.ml-item', { hasText: 'Presupuesto' }).click();
    await page.locator('.ml-read .ml-who').first().hover();
    await settle(200);
    assert.deepEqual(await lowContrast(page, ['.ml-read header']), [], `mensaje ${theme}`);
  }
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
