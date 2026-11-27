// Sending and notices in Nova Mail (second round, phase 5): undo send, send later, the Outbox, failures, new mail at
// once, notices (inside the program and the ones asked to Windows) and reminders that can be snoozed.
// With a simulated server and simulated Windows notices. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-mail-send.mjs [--shots dir]
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
  ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
  page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on('dialog', (d) => (questions.push(`${d.type()}: ${d.message()}`), (answer ? d.accept() : d.dismiss()).catch(() => {})));
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
  await ev(async () => {
    const m = await import('/src/mail/fake-server.ts');
    const f = m.standardServer();
    f.accounts = [m.account()];
    window.__fake = f;
    window.__mailFake = m;
    window.__notices = [];
    window.__novaMail.setNotifier({
      show: async (n) => void window.__notices.push(n),
      listen: () => () => {},
    });
    window.__novaMail.setTransport(f.transport);
    await window.__novaMail.ctl.loadAccounts();
    await window.__novaMail.ctl.syncAll();
  });
  questions.length = 0;
  await settle(300);
};

const rows = () => page.locator('.ml-item');
const row = (subject) => page.locator('.ml-item', { has: page.locator('.ml-item__subject > span', { hasText: new RegExp(`^${subject}( |$)`) }) }).first();
const folder = (name) => page.locator('.ml-folders [role="tree"] .ml-folder-name', { has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) });
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const command = (id) => page.locator(`[data-nv-item="${id}"]`);
const dialog = () => page.getByRole('dialog').last();
const pane = () => page.locator('.ml-mail__pane');
const toasts = () => page.getByRole('region', { name: 'Recordatorios' });
const undoBar = () => page.getByRole('region', { name: 'Envío en espera' });
const sent = () => ev(() => window.__fake.sent.length);
const options = async () => {
  await tab('Enviar y recibir');
  await command('mail.options').click();
  await dialog().getByText('Avisos y envío').first().waitFor();
};
const closeDialog = async (name = 'Cerrar') => {
  await dialog().getByRole('button', { name, exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
};
const write = async (subject, to = 'luis@x.es') => {
  await page.keyboard.press('Control+Shift+M');
  await pane().getByLabel('Para', { exact: true }).fill(to);
  await pane().getByLabel('Asunto').fill(subject);
  await pane().getByLabel('Cuerpo del mensaje').click();
  await page.keyboard.type('Texto del mensaje');
  await settle(150);
};
const sendButton = () => pane().getByRole('button', { name: 'Enviar', exact: true });
const localTime = (plusMinutes) => {
  const d = new Date(Date.now() + plusMinutes * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

await check('deshacer envío: se elige el retraso, se recupera lo escrito y, si no, sale solo', async () => {
  await options();
  await dialog().getByLabel('Retrasar el envío para poder deshacerlo').selectOption('5');
  assert.match(await dialog().getByRole('list', { name: 'Cómo se recibe cada cuenta' }).innerText(), /al instante/);
  await shot('opciones');
  await closeDialog();
  await tab('Inicio');
  await write('Con arrepentimiento');
  await sendButton().click();
  await undoBar().waitFor();
  assert.match(await undoBar().innerText(), /Enviando «Con arrepentimiento» en [45] s/);
  assert.equal(await sent(), 0);
  assert.equal(await folder('Bandeja de salida').count(), 1);
  assert.match(await page.getByTestId('outbox-status').innerText(), /En la Bandeja de salida: 1/);
  await shot('deshacer');
  await undoBar().getByRole('button', { name: 'Deshacer envío' }).click();
  await pane().getByLabel('Asunto').waitFor();
  assert.equal(await pane().getByLabel('Asunto').inputValue(), 'Con arrepentimiento');
  assert.match(await pane().getByLabel('Cuerpo del mensaje').innerText(), /Texto del mensaje/);
  assert.equal(await folder('Bandeja de salida').count(), 0, 'empty, the Outbox goes away');
  await settle(6000);
  assert.equal(await sent(), 0);
  await sendButton().click();
  await page.waitForFunction(() => window.__fake.sent.length === 1, null, { timeout: 12000 });
  await undoBar().waitFor({ state: 'detached' });
  assert.deepEqual(await ctl((c) => [c.outbox.messages.length, c.data.messages.filter((m) => m.folder === 'sent').map((m) => m.subject).includes('Con arrepentimiento')]), [0, true]);
});

await check('enviar más tarde: programar, cambiar la hora, editar y enviar ahora', async () => {
  await write('Para mañana');
  await pane().getByRole('button', { name: 'Enviar más tarde…' }).click();
  await shot('mas-tarde');
  await dialog().getByLabel('El día y la hora').fill(localTime(-10));
  await dialog().getByRole('button', { name: 'Programar' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /no haya pasado/);
  await dialog().getByRole('group', { name: 'Momentos habituales' }).getByRole('button', { name: /Mañana a las 8:00/ }).click();
  await folder('Bandeja de salida').click();
  assert.equal(await folder('Bandeja de salida').locator('b').innerText(), '1');
  assert.match(await row('Para mañana').locator('.ml-item__out').innerText(), /^Programado para/);
  assert.match(await row('Para mañana').innerText(), /Para: luis@x\.es/);
  await row('Para mañana').click();
  await pane().getByRole('status').filter({ hasText: 'Programado' }).waitFor();
  assert.equal(await pane().getByRole('button', { name: 'Responder', exact: true }).count(), 0);
  await shot('bandeja-salida');
  const before = await ctl((c) => c.outbox.messages[0].outgoing.at);
  await pane().getByRole('button', { name: 'Cambiar la hora…' }).click();
  await dialog().getByLabel('El día y la hora').fill(localTime(60 * 48));
  await dialog().getByRole('button', { name: 'Programar' }).click();
  assert.ok((await ctl((c) => c.outbox.messages[0].outgoing.at)) > before);
  await row('Para mañana').dblclick();
  await pane().getByLabel('Asunto').waitFor();
  assert.equal(await sent(), 0);
  await pane().getByLabel('Asunto').fill('Para ya');
  await pane().getByRole('button', { name: 'Enviar más tarde…' }).click();
  await dialog().getByRole('group', { name: 'Momentos habituales' }).getByRole('button').first().click();
  await folder('Bandeja de salida').click();
  await row('Para ya').click({ button: 'right' });
  await page.locator('.ml-menu button', { hasText: 'Enviar ahora' }).click();
  await page.waitForFunction(() => window.__fake.sent.length === 1);
  await page.waitForFunction(() => !window.__novaMail.ctl.outbox.messages.length);
  assert.equal(await rows().count(), 0);
});

await check('sin conexión: se deja en la bandeja y se reintenta; un rechazo se queda en rojo', async () => {
  await ev(() => (window.__fake.failOnly = 'mail_send'));
  await write('Sin red');
  await sendButton().click();
  await pane().getByRole('alert').waitFor();
  assert.match(await pane().getByRole('alert').innerText(), /No se pudo enviar/);
  assert.equal(await pane().getByLabel('Asunto').inputValue(), 'Sin red', 'nothing is lost');
  await shot('fallo');
  await pane().getByRole('button', { name: 'Dejar en la Bandeja de salida' }).click();
  await folder('Bandeja de salida').click();
  assert.match(await row('Sin red').locator('.ml-item__out').innerText(), /Se enviará|Se reintentará|Se enviará en un momento/);
  // a refusal for good
  await ev(() => ((window.__fake.failOnly = null), (window.__fake.failWith = 'Error de SMTP: 550 destinatario desconocido')));
  await row('Sin red').click();
  await pane().getByRole('button', { name: 'Enviar ahora' }).click();
  await page.waitForFunction(() => window.__novaMail.ctl.outbox.messages[0]?.outgoing.held);
  assert.match(await row('Sin red').locator('.ml-item__out.is-held').innerText(), /No se envió: Error de SMTP: 550/);
  await toasts().waitFor();
  assert.match(await toasts().innerText(), /No se pudo enviar «Sin red»/);
  assert.equal(await ev(() => window.__notices.length), 1);
  await shot('retenido');
  await ev(() => (window.__fake.failWith = null));
  await pane().getByRole('button', { name: 'Enviar ahora' }).click();
  await page.waitForFunction(() => window.__fake.sent.length === 1);
});

await check('cerrar con algo en la bandeja pregunta, aunque el archivo esté guardado', async () => {
  await ctl(async (c) => {
    await c.send({ id: 'x', to: 'a@x.es', cc: '', bcc: '', subject: 'Programado', body: 't', attachments: [], from: 'a1' }, 'a1', { at: Date.now() + 3600000 });
    c.markSaved('correo.novamail', null);
  });
  answer = false;
  await page.reload({ timeout: 5000 }).catch(() => {});
  assert.ok(questions.some((q) => q.startsWith('beforeunload')), questions.join());
  assert.equal(await ctl((c) => c.outbox.messages.length), 1);
});

await check('el correo nuevo llega al instante, con aviso dentro y en Windows, y al pulsarlo se abre', async () => {
  await folder('Archivo').click();
  await ev(() => window.__fake.deliver(window.__mailFake.FakeServer.mail('30', 'Llegó ahora')));
  await toasts().waitFor();
  assert.match(await toasts().innerText(), /Ana\s+Llegó ahora/);
  assert.deepEqual(await ev(() => window.__notices.map((n) => [n.title, n.body])), [['Ana', 'Llegó ahora']]);
  await shot('correo-nuevo');
  await toasts().getByRole('button', { name: 'Abrir' }).click();
  assert.match(await pane().locator('h2').innerText(), /Llegó ahora/);
  // turned off, it only arrives with the synchronisation
  await options();
  await dialog().getByRole('checkbox', { name: /Recibir al instante/ }).uncheck();
  await dialog().getByRole('checkbox', { name: /avisos de Windows/ }).uncheck();
  await closeDialog();
  await ev(() => window.__fake.deliver(window.__mailFake.FakeServer.mail('31', 'Más tarde')));
  await settle(1500);
  assert.equal(await ctl((c) => c.data.messages.some((m) => m.subject === 'Más tarde')), false);
  await tab('Enviar y recibir');
  await command('mail.sync').click();
  await toasts().filter({ hasText: 'Más tarde' }).waitFor();
  assert.equal(await ev(() => window.__notices.length), 1, 'no notice to Windows');
});

await check('recordatorios: abrir, posponer y descartar, y lo que se pide a Windows', async () => {
  await ctl((c) => {
    const now = Date.now();
    c.addEvent({ id: 'ev1', uid: 'u', title: 'Revisión', location: '', description: '', start: now + 5 * 60000, end: now + 65 * 60000, allDay: false, rrule: '', exdates: [], reminder: 15 });
    const m = c.data.messages.find((x) => x.subject === 'Uno');
    c.followMany([m.id], null, now - 1000);
  });
  await toasts().waitFor();
  assert.equal(await toasts().locator('.ml-toast').count(), 2);
  assert.deepEqual(await ev(() => window.__notices.map((n) => [n.title, n.actions.map((a) => a.label)])), [
    ['Uno', ['Posponer 10 min', 'Descartar']],
    ['Revisión', ['Posponer 10 min', 'Descartar']],
  ]);
  await shot('recordatorios');
  await toasts().getByLabel('Posponer Revisión').selectOption('15');
  assert.equal(await toasts().locator('.ml-toast').count(), 1);
  assert.ok((await ctl((c) => Object.values(c.data.reminders)[0].until)) > Date.now() + 14 * 60000);
  await toasts().getByRole('button', { name: 'Abrir' }).click();
  assert.match(await pane().locator('h2').innerText(), /Uno/);
  await toasts().getByRole('button', { name: 'Descartar' }).click();
  await toasts().waitFor({ state: 'detached' });
  // the appointment opens in the calendar
  await ctl((c) => c.openReminder(`ev1@${c.data.events[0].start}`));
  assert.equal(await page.locator('.ml-ev', { hasText: 'Revisión' }).count() > 0, true);
});

await check('la bandeja, los avisos y los cuadros se leen en los cuatro temas', async () => {
  await ctl(async (c) => {
    await c.send({ id: 'x', to: 'a@x.es', cc: '', bcc: '', subject: 'Programado', body: 't', attachments: [], from: 'a1' }, 'a1', { at: Date.now() + 3600000 });
    await c.send({ id: 'y', to: 'a@x.es', cc: '', bcc: '', subject: 'Retenido', body: 't', attachments: [], from: 'a1' }, 'a1', { at: Date.now() + 3600000 });
    const m = c.outbox.messages.find((x) => x.subject === 'Retenido');
    m.outgoing = { ...m.outgoing, held: true, error: 'Error de SMTP: 550' };
    c.alerts.set({ delay: 60 });
    await c.send({ id: 'z', to: 'a@x.es', cc: '', bcc: '', subject: 'En espera', body: 't', attachments: [], from: 'a1' }, 'a1');
    c.setFolder('outbox');
  });
  await row('Retenido').click();
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await ctl((c) => c.alerts.newMail([c.data.messages.find((m) => m.subject === 'Dos').id]));
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['.ml-folders', '.ml-list', '.ml-follow', '.ml-undo', '.ml-toasts']), [], theme);
    await shot(`tema-${theme}`);
    await options();
    await settle(300);
    assert.deepEqual(await lowContrast(page, ['[role="dialog"]']), [], `opciones ${theme}`);
    await closeDialog();
  }
});

await browser.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
if (errors.length) console.log('Console errors:', [...new Set(errors)].slice(0, 8));
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
