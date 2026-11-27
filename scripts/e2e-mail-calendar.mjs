// The calendar of Nova Mail (second round, phase 6): work week and agenda, several calendars, dragging and stretching,
// single occurrences, meetings by mail (invite, answer, cancel) and printing. With a simulated server.
// Needs `pnpm dev` on :1420. Usage: node scripts/e2e-mail-calendar.mjs [--shots dir]
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
const HOUR = 44;

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

/** June 2026: the 10th is a Wednesday. */
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
    const at = (d, h, m = 0) => new Date(2026, 5, d, h, m).getTime();
    const ev = (id, title, start, end, extra = {}) => ({ id, uid: `${id}@x`, title, location: '', description: '', start, end, allDay: false, rrule: '', exdates: [], reminder: null, ...extra });
    c.data.events = [
      ev('plan', 'Plan', at(10, 9), at(10, 10), { location: 'Sala 1' }),
      ev('semana', 'Revisión', at(1, 11), at(1, 12), { rrule: 'FREQ=WEEKLY' }),
      ev('feria', 'Feria', at(11, 0), at(12, 0), { allDay: true }),
    ];
    c.anchor = at(10, 12);
    c.go('calendar');
  });
  questions.length = 0;
  await settle(300);
};

const block = (title) => page.locator('.ml-ev', { hasText: title }).first();
const column = (day) => page.locator(`.ml-week__col[data-day="${new Date(2026, 5, day).getTime()}"]`);
const cell = (day) => page.locator(`.ml-month__cell[data-day="${new Date(2026, 5, day).getTime()}"]`);
const view = (name) => page.getByRole('group', { name: 'Vista del calendario' }).getByRole('button', { name, exact: true }).click();
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const command = (id) => page.locator(`[data-nv-item="${id}"]`);
const dialog = () => page.getByRole('dialog').last();
const closed = () => page.getByRole('dialog').waitFor({ state: 'detached' });
const times = (id) => ctl((c, i) => {
  const e = c.data.events.find((x) => x.id === i);
  const f = (t) => `${new Date(t).getDate()} ${new Date(t).toTimeString().slice(0, 5)}`;
  return e && { start: f(e.start), end: f(e.end), changes: (e.changes ?? []).map((x) => [f(x.at), f(x.start), f(x.end), x.title]), gone: e.exdates.map(f) };
}, id);
/** Drags from near the top of an element to a column (or cell), `hours` further down. */
const drag = async (from, to, hours = 0, { release = true, grab = 6 } = {}) => {
  const a = await from.boundingBox();
  const b = to ? await to.boundingBox() : null;
  const x = a.x + a.width / 2;
  const y = a.y + Math.min(grab, a.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const tx = b ? b.x + b.width / 2 : x;
  const ty = b && !hours && !(await to.evaluate((e) => e.classList.contains('ml-week__col'))) ? b.y + b.height / 2 : y + hours * HOUR;
  await page.mouse.move(tx, ty, { steps: 8 });
  if (release) await page.mouse.up();
  await settle(150);
};
const calendars = () => page.getByRole('complementary', { name: 'Calendarios' });
const menuItem = (name) => page.locator('.ml-menu button', { has: page.locator('.ml-menu__label', { hasText: new RegExp(`^\\s*${name}$`) }) }).last();
const options = async (name) => calendars().getByRole('button', { name: `Opciones del calendario ${name}` }).click();

await check('vistas: semana laboral, agenda y mes, desde la cinta y desde la barra', async () => {
  await view('Semana laboral');
  assert.equal(await page.locator('.ml-week__col').count(), 5);
  assert.match(await page.locator('.ml-cal__bar h2').innerText(), /8 jun.*12 jun/i);
  await shot('semana-laboral');
  await command('cal.view.agenda').click();
  const agenda = page.getByRole('region', { name: 'Agenda' });
  await agenda.waitFor();
  assert.deepEqual((await agenda.locator('strong').allInnerTexts()).slice(0, 3), ['Plan', 'Feria', 'Revisión']);
  assert.match(await agenda.innerText(), /Sala 1/);
  await shot('agenda');
  await page.getByRole('button', { name: 'Siguiente' }).click();
  assert.match(await page.locator('.ml-cal__bar h2').innerText(), /10 jul/i);
  await page.getByRole('button', { name: 'Hoy', exact: true }).first().click();
  await ctl((c) => c.setAnchor(new Date(2026, 5, 10).getTime()));
  await view('Mes');
  assert.equal(await page.locator('.ml-month__cell').count(), 42);
  await view('Semana');
  assert.equal(await page.locator('.ml-week__col').count(), 7);
});

await check('arrastrar y estirar en la semana: mover de día y de hora, cambiar la duración, cancelar y deshacer', async () => {
  await drag(block('Plan'), column(12), 2);
  assert.deepEqual(await times('plan'), { start: '12 11:00', end: '12 12:00', changes: [], gone: [] });
  assert.equal(await page.getByRole('dialog').count(), 0, 'a drag does not open the appointment');
  await shot('movida');
  await drag(block('Plan').locator('.ml-ev__resize'), null, 1.5, { grab: 3 });
  assert.equal((await times('plan')).end, '12 13:30');
  // never shorter than a quarter of an hour
  await drag(block('Plan').locator('.ml-ev__resize'), null, -6, { grab: 3 });
  assert.equal((await times('plan')).end, '12 11:15');
  await drag(block('Plan'), column(9), 1, { release: false });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal((await times('plan')).start, '12 11:00', 'Escape leaves it where it was');
  await page.keyboard.press('Control+z');
  assert.equal((await times('plan')).end, '12 13:30');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  assert.deepEqual(await times('plan'), { start: '10 09:00', end: '10 10:00', changes: [], gone: [] });
  // a click without moving opens it
  await block('Plan').click();
  assert.equal(await dialog().getByLabel('Título').inputValue(), 'Plan');
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await closed();
});

await check('con el teclado, en el mes y los de todo el día', async () => {
  await block('Plan').focus();
  await page.keyboard.press('Control+ArrowDown');
  await page.keyboard.press('Control+ArrowRight');
  assert.equal((await times('plan')).start, '11 09:15');
  await page.keyboard.press('Control+Shift+ArrowDown');
  assert.equal((await times('plan')).end, '11 10:30');
  assert.equal(await ev(() => document.activeElement.textContent.includes('Plan')), true, 'the focus follows it');
  await drag(page.locator('.ml-week__allday .ml-ev', { hasText: 'Feria' }), page.locator(`.ml-week__allday [data-day="${new Date(2026, 5, 13).getTime()}"]`));
  assert.deepEqual((await times('feria')).start, '13 00:00');
  await view('Mes');
  await drag(block('Plan'), cell(24));
  assert.equal((await times('plan')).start, '24 09:15');
  await block('Plan').focus();
  await page.keyboard.press('Control+ArrowUp');
  assert.equal((await times('plan')).start, '17 09:15', 'up a week in the month');
});

await check('una repetición: moverla cambia solo esa; en el cuadro, esta o la serie; quitarla', async () => {
  await ctl((c) => c.setAnchor(new Date(2026, 5, 8).getTime()));
  await drag(block('Revisión'), column(9), 3);
  assert.deepEqual(await times('semana'), { start: '1 11:00', end: '1 12:00', changes: [['8 11:00', '9 14:00', '9 15:00', 'Revisión']], gone: [] });
  await block('Revisión').click();
  await dialog().getByRole('radio', { name: /Solo esta repetición/ }).check();
  assert.equal(await dialog().getByRole('combobox', { name: 'Repetición', exact: true }).count(), 0);
  assert.equal(await dialog().getByLabel('Hora de inicio').inputValue(), '14:00');
  await dialog().getByLabel('Título').fill('Revisión extraordinaria');
  await shot('repeticion');
  await dialog().getByRole('button', { name: 'Guardar', exact: true }).click();
  await closed();
  assert.equal((await times('semana')).changes[0][3], 'Revisión extraordinaria');
  await ctl((c) => c.setAnchor(new Date(2026, 5, 15).getTime()));
  await block('Revisión').click();
  assert.equal(await dialog().getByRole('radio', { name: 'Toda la serie' }).isChecked(), true);
  assert.equal(await dialog().getByLabel('Título').inputValue(), 'Revisión');
  await dialog().getByRole('button', { name: 'Eliminar solo esta repetición' }).click();
  await closed();
  assert.deepEqual((await times('semana')).gone, ['15 11:00']);
  assert.equal(await block('Revisión').count(), 0);
  await ctl((c) => c.setAnchor(new Date(2026, 5, 22).getTime()));
  await block('Revisión').click();
  await dialog().getByRole('combobox', { name: 'Repetición', exact: true }).selectOption('FREQ=MONTHLY');
  answer = false;
  await dialog().getByRole('button', { name: 'Guardar', exact: true }).click();
  assert.match(questions.at(-1), /se pierden 2 cambios/);
  assert.equal(await page.getByRole('dialog').count(), 1, 'it stays open');
  answer = true;
  await dialog().getByRole('button', { name: 'Guardar', exact: true }).click();
  await closed();
  assert.deepEqual(await times('semana'), { start: '1 11:00', end: '1 12:00', changes: [], gone: [] });
});

await check('calendarios: crear, poner una cita en él, ocultar, colorear, renombrar, exportar, importar y eliminar', async () => {
  await calendars().getByRole('button', { name: '+ Calendario nuevo' }).click();
  await calendars().getByLabel('Nombre del calendario').fill('Trabajo');
  await calendars().getByLabel('Color del calendario').selectOption('red');
  await calendars().getByRole('button', { name: 'Crear' }).click();
  await block('Plan').click();
  await dialog().getByLabel('Calendario').selectOption({ label: 'Trabajo' });
  await dialog().getByRole('button', { name: 'Guardar', exact: true }).click();
  await closed();
  assert.match(await block('Plan').getAttribute('style'), /--ev: ?#d13438/);
  await shot('calendarios');
  await calendars().getByRole('checkbox', { name: 'Trabajo' }).uncheck();
  assert.equal(await block('Plan').count(), 0);
  await calendars().getByRole('checkbox', { name: 'Trabajo' }).check();
  await options('Trabajo');
  await menuItem('Color').click();
  await menuItem('Verde').click();
  assert.match(await block('Plan').getAttribute('style'), /--ev: ?#13a10e/);
  await options('Trabajo');
  await menuItem('Cambiar nombre').click();
  await calendars().getByLabel('Nombre nuevo del calendario').fill('Calendario');
  await page.keyboard.press('Enter');
  assert.match(await calendars().getByRole('alert').innerText(), /Ya existe/);
  await calendars().getByLabel('Nombre nuevo del calendario').fill('Oficina');
  await page.keyboard.press('Enter');
  await options('Oficina');
  const [dl] = await Promise.all([page.waitForEvent('download'), menuItem('Exportar este calendario \\(\\.ics\\)…').click()]);
  assert.equal(dl.suggestedFilename(), 'Oficina.ics');
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(ics, /X-WR-CALNAME:Oficina/);
  assert.match(ics, /SUMMARY:Plan/);
  assert.doesNotMatch(ics, /Feria/);
  await options('Oficina');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menuItem('Importar \\.ics en este calendario…').click()]);
  await chooser.setFiles({ name: 'otra.ics', mimeType: 'text/calendar', buffer: Buffer.from('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:i@x\r\nSUMMARY:Importada\r\nDTSTART:20260609T140000\r\nDTEND:20260609T150000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n') });
  await block('Importada').waitFor();
  assert.equal(await ctl((c) => c.calendar.find(c.data.events.find((e) => e.title === 'Importada').id).calendar === c.data.calendars.find((x) => x.name === 'Oficina').id), true);
  answer = false;
  await options('Oficina');
  await menuItem('Eliminar el calendario').click();
  assert.match(questions.at(-1), /«Oficina» y sus 2 citas/);
  assert.equal(await block('Plan').count(), 1);
  answer = true;
  await options('Oficina');
  await menuItem('Eliminar el calendario').click();
  assert.equal(await block('Plan').count(), 0);
  assert.equal(await block('Feria').count(), 1);
});

const withAccount = () =>
  ev(async () => {
    const m = await import('/src/mail/fake-server.ts');
    const f = m.standardServer();
    f.accounts = [m.account('a1', 'Ana')];
    window.__fake = f;
    window.__novaMail.setTransport(f.transport);
    const c = window.__novaMail.ctl;
    c.setOwner({ name: 'Ana', email: 'a1@ejemplo.es' });
    await c.loadAccounts();
    await c.syncAll();
    c.go('calendar');
  });
const sent = () => ev(() => window.__fake.sent.map((s) => ({ to: s.recipients, subject: /^Subject: (.*)$/m.exec(s.raw)[1], method: /method=(\w+)/.exec(s.raw)?.[1] })));

await check('reunión: invitar, y al moverla avisar a los invitados; cancelarla', async () => {
  await withAccount();
  await page.keyboard.press('Control+Shift+Q');
  await dialog().getByText('Reunión nueva').waitFor();
  await dialog().getByLabel('Invitados').fill('Luis <luis@ejemplo.es>, marta@ejemplo.es');
  await dialog().getByLabel('Título').fill('Lanzamiento');
  await dialog().getByLabel('Lugar').fill('Sala 2');
  await shot('reunion-nueva');
  await dialog().getByRole('button', { name: 'Guardar y enviar la invitación' }).click();
  await closed();
  await page.waitForFunction(() => window.__fake.sent.length === 1);
  const [first] = await sent();
  assert.deepEqual([first.to, first.method], [['luis@ejemplo.es', 'marta@ejemplo.es'], 'REQUEST']);
  await drag(block('Lanzamiento'), column(12), 1);
  const notice = page.locator('.ml-moved');
  assert.match(await notice.innerText(), /Lanzamiento.*todavía no lo saben/s);
  await shot('aviso-actualizar');
  await notice.getByRole('button', { name: 'Enviar la actualización' }).click();
  await page.waitForFunction(() => window.__fake.sent.length === 2);
  await block('Lanzamiento').click();
  assert.match(await dialog().getByRole('list', { name: 'Respuestas' }).innerText(), /Luis\s+Sin respuesta/);
  await dialog().getByRole('button', { name: 'Cancelar la reunión' }).click();
  assert.match(questions.at(-1), /avisar a los invitados/);
  await closed();
  await page.waitForFunction(() => window.__fake.sent.length === 3);
  assert.equal((await sent())[2].method, 'CANCEL');
  assert.equal(await block('Lanzamiento').count(), 0);
});

await check('llega una invitación: se ve, se contesta, se actualiza y se cancela', async () => {
  await withAccount();
  // another mailbox writes the invitation
  await ev(async () => {
    const { MailCtl } = await import('/src/mail/ctl.ts');
    const m = await import('/src/mail/fake-server.ts');
    const boss = new MailCtl();
    boss.accounts = [m.account('jefa', 'Marta')];
    window.__fake.accounts.push(boss.accounts[0]);
    boss.setOwner({ name: 'Marta', email: 'jefa@ejemplo.es' });
    const at = new Date(2026, 5, 10, 9, 30).getTime();
    boss.addEvent({ id: 'r', uid: 'reunion@x', title: 'Presupuesto', location: 'Sala 3', description: 'Traer cifras', start: at, end: at + 3600000, allDay: false, rrule: '', exdates: [], reminder: null, attendees: [{ name: 'Ana', email: 'a1@ejemplo.es', status: 'needs-action' }] });
    boss.calendar.invite('r');
    await boss.outbox.process();
    window.__boss = boss;
    window.__fake.deliver({ key: '50', flags: [], raw: window.__fake.sent.at(-1).raw });
    window.__novaMail.ctl.go('mail');
    await window.__novaMail.ctl.syncAll();
  });
  await page.locator('.ml-item', { hasText: 'Invitación: Presupuesto' }).click();
  const card = page.getByRole('region', { name: 'Invitación a una reunión' });
  await card.waitFor();
  const text = await card.innerText();
  assert.match(text, /Presupuesto[\s\S]*Sala 3[\s\S]*Organiza Marta <jefa@ejemplo\.es>/);
  assert.match(text, /A esa hora tienes: Plan\./);
  assert.equal(await page.locator('.ml-item', { hasText: 'Invitación: Presupuesto' }).getByLabel('Reunión').count(), 1);
  await shot('invitacion');
  await card.getByRole('button', { name: 'Provisional' }).click();
  assert.match(await card.getByRole('status').innerText(), /quizá asistas/);
  await page.waitForFunction(() => window.__fake.sent.length === 2);
  assert.deepEqual((await sent())[1].to, ['jefa@ejemplo.es']);
  await card.getByRole('button', { name: 'Ver en el calendario' }).click();
  assert.match(await block('Presupuesto').getAttribute('class'), /is-tentative/);
  await block('Presupuesto').click();
  assert.match(await dialog().innerText(), /Organiza Marta\. Tu respuesta: Provisional\./);
  assert.equal(await dialog().getByLabel('Hora de inicio').isDisabled(), true);
  assert.equal(await dialog().getByRole('button', { name: /enviar/ }).count(), 0);
  await shot('reunion-ajena');
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  await closed();
  await drag(block('Presupuesto'), column(12), 1);
  assert.equal(await ctl((c) => new Date(c.data.events.find((e) => e.title === 'Presupuesto').start).getDate()), 10, 'the meeting of someone else does not move');
  // the organizer notes the answer, then moves it and cancels it
  await ev(async () => {
    const boss = window.__boss;
    const reply = window.__fake.sent[1].raw;
    const m = boss.importRaw(Uint8Array.from(reply, (ch) => ch.charCodeAt(0)), 'inbox', { read: false });
    boss.select(m.id);
    window.__answer = boss.data.events[0].attendees[0].status;
    boss.calendar.move('r', undefined, 3600000, 3600000);
    boss.calendar.invite('r');
    await boss.outbox.process();
    window.__fake.deliver({ key: '51', flags: [], raw: window.__fake.sent.at(-1).raw });
    await window.__novaMail.ctl.syncAll();
  });
  assert.equal(await ev(() => window.__answer), 'tentative');
  await ctl((c) => c.go('mail'));
  await page.locator('.ml-item', { hasText: 'Actualización: Presupuesto' }).click();
  const update = page.getByRole('region', { name: 'Cambios en una reunión' });
  await update.getByRole('button', { name: 'Aceptar' }).click();
  assert.equal(await ctl((c) => new Date(c.data.events.find((e) => e.title === 'Presupuesto').start).getHours()), 10);
  await page.locator('.ml-item', { hasText: /^[\s\S]*Invitación: Presupuesto/ }).last().click();
  await page.getByRole('region', { name: 'Invitación anticuada' }).waitFor();
  await ev(async () => {
    window.__boss.calendar.cancel('r', undefined, true);
    await window.__boss.outbox.process();
    window.__fake.deliver({ key: '52', flags: [], raw: window.__fake.sent.at(-1).raw });
    await window.__novaMail.ctl.syncAll();
  });
  await page.locator('.ml-item', { hasText: 'Cancelada: Presupuesto' }).click();
  const cancel = page.getByRole('region', { name: 'Reunión cancelada' });
  await shot('cancelada');
  await cancel.getByRole('button', { name: 'Quitar del calendario' }).click();
  assert.equal(await ctl((c) => c.data.events.some((e) => e.title === 'Presupuesto')), false);
  assert.match(await cancel.innerText(), /no está en tu calendario/);
});

await check('sin cuenta la invitación se guarda como .eml', async () => {
  await command('cal.meeting').click();
  await dialog().getByLabel('Título').fill('Café');
  await dialog().getByLabel('Invitados').fill('luis@ejemplo.es');
  assert.equal(await dialog().getByRole('button', { name: /Guardar y enviar/ }).count(), 0);
  const [dl] = await Promise.all([page.waitForEvent('download'), dialog().getByRole('button', { name: 'Guardar la invitación (.eml)' }).click()]);
  assert.equal(dl.suggestedFilename(), 'Café.eml');
  const raw = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(raw, /method=REQUEST/);
  assert.match(raw, /To: luis@ejemplo\.es/);
});

await check('imprimir la semana y el mes', async () => {
  await ev(() => {
    new MutationObserver((changes) => {
      for (const c of changes)
        for (const n of c.addedNodes)
          if (n.classList?.contains('ml-print'))
            n.addEventListener('load', () => (n.contentWindow.print = () => (window.__printed = n.contentDocument.body.innerText)));
    }).observe(document.body, { childList: true });
  });
  await block('Plan').focus();
  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => !!window.__printed);
  assert.match(await ev(() => window.__printed), /8 jun.*14 jun[\s\S]*09:00 – 10:00\s+Plan · Sala 1/i);
  await view('Mes');
  await ev(() => (window.__printed = ''));
  await command('cal.print').click();
  await page.waitForFunction(() => !!window.__printed);
  assert.match(await ev(() => window.__printed), /junio de 2026/i);
});

await check('el calendario, la agenda, el cuadro y la invitación se leen en los cuatro temas', async () => {
  await ctl((c) => {
    const w = c.calendar.add('Trabajo', 'yellow');
    c.data.events = c.data.events.map((e) => (e.id === 'plan' ? { ...e, calendar: w, attendees: [{ name: 'Luis', email: 'l@x.es', status: 'accepted' }, { name: 'Ana', email: 'a@x.es', status: 'declined' }] } : e.id === 'semana' ? { ...e, cancelled: false } : e));
    c.addEvent({ id: 'x', uid: 'x@x', title: 'Cancelada', location: '', description: '', start: new Date(2026, 5, 10, 14).getTime(), end: new Date(2026, 5, 10, 15).getTime(), allDay: false, rrule: '', exdates: [], reminder: null, cancelled: true });
    const raw = ['From: jefa@x.es', 'Subject: Invitacion', 'MIME-Version: 1.0', 'Content-Type: text/calendar; method=REQUEST; charset=utf-8', '', 'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT', 'UID:n@x', 'SUMMARY:Visita', 'DTSTART:20260610T090000', 'DTEND:20260610T100000', 'ORGANIZER:mailto:otra@x.es', 'ATTENDEE:mailto:a@x.es', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    c.importRaw(raw, 'inbox', { read: false });
  });
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await ctl((c) => c.go('calendar'));
    await view('Semana');
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-cals', '.ml-week', '.ml-cal__bar']), [], theme);
    await shot(`tema-${theme}-semana`);
    await view('Agenda');
    assert.deepEqual(await lowContrast(page, ['.ml-agenda']), [], `agenda ${theme}`);
    await block('Plan').click();
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['[role="dialog"] .ml-form']), [], `cuadro ${theme}`);
    await shot(`tema-${theme}-cuadro`);
    await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await closed();
    await ctl((c) => c.openMessage(c.data.messages.find((m) => m.subject === 'Invitacion').id));
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-invite']), [], `invitación ${theme}`);
    await shot(`tema-${theme}-invitacion`);
  }
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
