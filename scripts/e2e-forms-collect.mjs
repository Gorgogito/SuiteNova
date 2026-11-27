// End-to-end checks of collecting responses (Nova Forms) in a real browser (Edge). Needs `pnpm dev` running on :1420.
// The part of the desktop application that listens is replaced here by a small server of Node, so what is checked is the
// dialog, the page that is served and what the window does with what arrives. The real server has its own tests in Rust
// and `e2e-forms-native.mjs` checks it in the compiled application. Also: responses passed from Nova Mail.
// Usage: node scripts/e2e-forms-collect.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { lowContrast } from './lib-contrast.mjs';

const jsQR = createRequire(new globalThis.URL('../apps/suite/package.json', import.meta.url))('jsqr');
const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
// who answers is on another computer: a name that is not this one, so the browser treats the page as one of the network
const away = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--host-resolver-rules=MAP nova.test 127.0.0.1'] });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 }, acceptDownloads: true });
const phone = await away.newContext({ viewport: { width: 390, height: 780 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  // the refusals asked for in these checks are not errors of the program
  p.on('console', (m) => m.type() === 'error' && !/Keyborg|Failed to load resource|beforeunload/.test(m.text()) && errors.push(m.text()));
};
watch(page);
const questions = [];
let answer = true;
page.on('dialog', (d) => (questions.push(d.message()), (answer ? d.accept() : d.dismiss()).catch(() => {})));

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
    await shot(`FAIL-${name.replace(/\W+/g, '-').slice(0, 60)}`);
  }
};

const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 150) => page.waitForTimeout(ms);
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const press = (n) => page.getByRole('button', { name: n, exact: true }).click();
const dialog = () => page.getByRole('dialog');

// ---------------------------------------------------------------- the stand-in for the desktop server
const net = { server: null, content: null, url: '', force: null, log: [] };
const stopServer = async () => {
  if (!net.server) return;
  net.server.closeAllConnections();
  await new Promise((r) => net.server.close(r));
  net.server = null;
};
await page.exposeFunction('__nodeStart', async (address, content) => {
  await stopServer();
  net.content = content;
  net.log.push(`start ${address}`);
  net.server = http.createServer((req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type, Connection: 'close' });
      res.end(body);
    };
    if (req.method === 'GET' && req.url === '/clave') return send(200, 'text/html; charset=utf-8', net.content.page);
    if (req.method !== 'POST' || req.url !== '/clave/r') return send(404, 'text/plain', '404');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      if (net.force === 'drop') return req.socket.destroy();
      if (net.force) return send(net.force, 'application/json', JSON.stringify({ ok: false }));
      const verdict = await page.evaluate((b) => window.__arrived(b), Buffer.concat(chunks).toString('utf8'));
      send(verdict.ok ? 200 : 422, 'application/json', JSON.stringify(verdict));
    });
  });
  await new Promise((r) => net.server.listen(0, '127.0.0.1', r));
  net.url = `http://nova.test:${net.server.address().port}/clave`;
  return { url: net.url };
});
await page.exposeFunction('__nodeUpdate', (content) => {
  net.content = content;
  net.log.push('update');
});
await page.exposeFunction('__nodeStop', async () => {
  net.log.push('stop');
  await stopServer();
});
const bridge = () =>
  ev(() =>
    window.__novaForms.setCollectBridge({
      addresses: async () => [
        { ip: '192.168.1.20', name: 'Wi-Fi', main: true },
        { ip: '127.0.0.1', name: '', main: false },
      ],
      start: (address, content, arrived) => {
        window.__arrived = arrived;
        return window.__nodeStart(address, content);
      },
      update: (content) => window.__nodeUpdate(content),
      stop: () => window.__nodeStop(),
    }),
  );

const open = async (app) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${BASE}?app=${app}`, { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector(app === 'forms' ? '.fm-app' : '.ml-app', { timeout: 30000 });
      break;
    } catch (e) {
      if (attempt) throw e;
    }
  }
  await page.waitForFunction((a) => !!window[a === 'forms' ? '__novaForms' : '__novaMail'], app, { timeout: 60000 });
};
const survey = async (over = {}) => {
  await ev((o) => {
    const { ctl } = window.__novaForms;
    ctl.dirty = false;
    ctl.reset();
    ctl.setForm({ title: 'Merienda', ...o });
    ctl.updateQuestion(ctl.addQuestion('text').id, { title: 'Tu fruta', required: true });
    ctl.updateQuestion(ctl.addQuestion('number').id, { title: 'Cuántas', maxValue: 10 });
  }, over);
  await settle();
};
const collectDialog = async () => {
  await tab('Respuestas');
  await press('Recoger por la red local…');
  await dialog().waitFor();
  return dialog();
};
const closeDialog = async () => {
  await dialog().getByRole('button', { name: 'Cerrar', exact: true }).click();
  await dialog().waitFor({ state: 'detached' });
  await tab('Inicio');
};
const startCollecting = async () => {
  const d = await collectDialog();
  await d.getByRole('button', { name: 'Empezar a recoger' }).click();
  await d.getByLabel('Dirección para responder').waitFor();
  await closeDialog();
};
const stopCollecting = async () => {
  if (!(await ev(() => window.__novaForms.collector.running))) return;
  await ev(() => window.__novaForms.collector.stop());
  await settle();
};
const count = () => ev(() => window.__novaForms.ctl.responses.length);
// the page follows the form a moment after the change
const updated = async (fn) => {
  const before = net.log.filter((x) => x === 'update').length;
  await fn();
  await page.waitForTimeout(700);
  assert.ok(net.log.filter((x) => x === 'update').length > before, 'the served page was updated');
};
const visit = async () => {
  const p = await phone.newPage();
  watch(p);
  await p.goto(net.url);
  return p;
};

await open('forms');
await page.screenshot();

await check('in the browser it says it needs the desktop application', async () => {
  await survey();
  const d = await collectDialog();
  assert.match(await d.innerText(), /solo funciona en la aplicación de escritorio/);
  assert.equal(await d.getByRole('button', { name: 'Empezar a recoger' }).count(), 0);
  await closeDialog();
});

await check('the dialog warns, offers the addresses, and needs a question', async () => {
  await bridge();
  await ev(() => {
    window.__novaForms.ctl.dirty = false;
    window.__novaForms.ctl.reset();
  });
  const d = await collectDialog();
  const text = await d.innerText();
  assert.match(text, /No hay cifrado/);
  assert.match(text, /cortafuegos/);
  const select = d.getByLabel('Dirección de este equipo');
  await page.waitForFunction(() => document.querySelector('[role="dialog"] select')?.options.length === 2);
  assert.equal(await select.inputValue(), '192.168.1.20');
  assert.deepEqual(await select.locator('option').allInnerTexts(), ['192.168.1.20 — Wi-Fi (recomendada)', '127.0.0.1 — solo este equipo (para probar)']);
  await d.getByRole('alert').filter({ hasText: 'Añade al menos una pregunta' }).waitFor();
  assert.equal(await d.getByRole('button', { name: 'Empezar a recoger' }).isDisabled(), true);
  await shot('dialog-off');
  await closeDialog();
});

await check('starting gives an address and a QR code that says it; closing the dialog goes on collecting', async () => {
  await survey();
  const d = await collectDialog();
  await d.getByRole('button', { name: 'Empezar a recoger' }).click();
  await d.getByLabel('Dirección para responder').waitFor();
  assert.equal(await d.getByLabel('Dirección para responder').inputValue(), net.url);
  assert.deepEqual(net.log.slice(0, 1), ['start 192.168.1.20']);
  const decode = async () => {
    const pixels = await d.getByRole('img', { name: 'Código QR de la dirección' }).evaluate(async (svg) => {
      const side = 600;
      const img = new Image();
      img.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = side;
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0, side, side);
      return Array.from(g.getImageData(0, 0, side, side).data);
    });
    return jsQR(new Uint8ClampedArray(pixels), 600, 600)?.data;
  };
  assert.equal(await decode(), net.url);
  await shot('dialog-on');
  await d.getByRole('button', { name: 'Código más grande' }).click();
  assert.ok((await d.getByRole('img', { name: 'Código QR de la dirección' }).boundingBox()).width > 350);
  await shot('qr-large');
  await closeDialog();
  assert.equal(await page.getByRole('button', { name: /Recogiendo respuestas \(0\)/ }).count(), 1);
});

await check('answering from another device: it arrives by itself, and the same page can answer again', async () => {
  const p = await visit();
  assert.equal(await p.evaluate(() => window.isSecureContext), false, 'an ordinary page of the network');
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.getByText('Esta pregunta es obligatoria.').waitFor();
  await p.getByLabel('Tu fruta').fill('mango');
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.getByText('Respuesta enviada').waitFor();
  assert.equal(await p.getByRole('button', { name: 'Descargar mi respuesta' }).count(), 0, 'nothing to send by hand');
  await shot('phone-sent', p);
  assert.equal(await count(), 1);
  await page.getByRole('button', { name: /Recogiendo respuestas \(1\)/ }).waitFor();
  assert.match(await page.locator('body').innerText(), /Ha llegado una respuesta/);
  await p.getByRole('button', { name: 'Responder otra vez' }).click();
  await p.getByLabel('Tu fruta').fill('piña');
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.getByText('Respuesta enviada').waitFor();
  assert.deepEqual(await ev(() => window.__novaForms.ctl.responses.map((r) => Object.values(r.answers)[0])), ['mango', 'piña']);
  await page.getByRole('button', { name: /Recogiendo respuestas \(2\)/ }).click();
  assert.match(await dialog().innerText(), /2 respuestas recibidas/);
  await shot('dialog-counting');
  await closeDialog();
  await p.close();
});

await check('closing the form while someone answers: refused with its message, then retried once open', async () => {
  await stopCollecting();
  await survey();
  await startCollecting();
  const p = await visit();
  await p.getByLabel('Tu fruta').fill('uva');
  await updated(() => ev(() => window.__novaForms.ctl.setForm({ closed: true, closedMessage: 'Ya no hay merienda' })));
  const late = await visit();
  assert.equal(await late.locator('#closed').innerText(), 'Ya no hay merienda');
  await late.close();
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.locator('#failed').waitFor();
  assert.match(await p.locator('#failed').innerText(), /No se ha enviado[\s\S]*Ya no hay merienda/);
  assert.equal(await count(), 0);
  await shot('phone-refused', p);
  await updated(() => ev(() => window.__novaForms.ctl.setForm({ closed: undefined })));
  await p.getByRole('button', { name: 'Reintentar' }).click();
  await p.getByText('Respuesta enviada').waitFor();
  assert.equal(await count(), 1);
  assert.equal(await ev(() => window.__novaForms.collector.refused), 1);
  await p.close();
});

await check('the form changed under whoever answers: they can review what they wrote; a full download is left', async () => {
  const p = await visit();
  await p.getByLabel('Tu fruta').fill('kiwi');
  await updated(() => ev(() => window.__novaForms.ctl.updateQuestion(window.__novaForms.ctl.addQuestion('text').id, { title: 'Alergias', required: true })));
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.locator('#failed').waitFor();
  assert.match(await p.locator('#failed').innerText(), /Recarga la página/);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Descargar mi respuesta' }).click()]);
  assert.match(fs.readFileSync(await dl.path(), 'utf8'), /kiwi/);
  await p.getByRole('button', { name: 'Revisar mis respuestas' }).click();
  assert.equal(await p.getByLabel('Tu fruta').inputValue(), 'kiwi');
  assert.equal(await p.locator('#failed').count(), 0);
  await p.reload();
  await p.getByLabel('Tu fruta').fill('kiwi');
  await p.getByLabel('Alergias').fill('ninguna');
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.getByText('Respuesta enviada').waitFor();
  assert.equal(await count(), 2);
  await p.close();
});

await check('no connection, a busy program, and «already answered» are told apart', async () => {
  await stopCollecting();
  await survey({ noAgain: true });
  await startCollecting();
  const p = await visit();
  await p.getByLabel('Tu fruta').fill('pera');
  net.force = 'drop';
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.getByText('No se pudo conectar con quien recoge las respuestas.').waitFor();
  await shot('phone-offline', p);
  net.force = 503;
  await p.getByRole('button', { name: 'Reintentar' }).click();
  await p.getByText('La aplicación que recoge las respuestas no contesta: reintenta.').waitFor();
  net.force = 429;
  await p.getByRole('button', { name: 'Reintentar' }).click();
  await p.getByText('Hay demasiadas peticiones: espera un momento y reintenta.').waitFor();
  net.force = null;
  await p.getByRole('button', { name: 'Reintentar' }).click();
  await p.getByText('Respuesta enviada').waitFor();
  assert.equal(await count(), 1);
  assert.equal(await p.locator('#again').count(), 0);
  await p.reload();
  await p.getByLabel('Tu fruta').fill('otra');
  net.force = 409;
  await p.getByRole('button', { name: 'Enviar' }).click();
  await p.getByText('Ya has enviado tu respuesta.').waitFor();
  assert.equal(await p.locator('#failed button').count(), 0);
  net.force = null;
  await p.close();
});

await check('with a time limit and in English: what was right is sent when the time ends', async () => {
  await stopCollecting();
  await survey({ timeLimit: 2, language: 'en', askName: true });
  await startCollecting();
  const p = await visit();
  await p.getByRole('button', { name: 'Start' }).click();
  await p.getByLabel('Cuántas').fill('3');
  await p.evaluate(() => {
    const real = Date.now;
    Date.now = () => real() + 121000;
  });
  await p.getByText('Time is up.').waitFor();
  await p.getByText('What you had answered was sent.').waitFor();
  await shot('phone-time-up', p);
  assert.deepEqual(await ev(() => window.__novaForms.ctl.responses.map((r) => Object.values(r.answers))), [[3]]);
  await p.close();
});

await check('opening another form or closing asks first; stopping ends it', async () => {
  answer = false;
  questions.length = 0;
  await tab('Inicio');
  await ev(() => (window.__novaForms.ctl.dirty = false));
  await press('Abrir…').catch(async () => {
    await page.locator('.fm-scroll').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+o');
  });
  await settle(300);
  assert.match(questions.at(-1) ?? '', /Se están recogiendo respuestas/);
  assert.equal(await ev(() => window.__novaForms.collector.running), true);
  answer = true;
  const d = await collectDialog();
  await d.getByRole('button', { name: 'Dejar de recoger' }).click();
  await d.getByRole('button', { name: 'Empezar a recoger' }).waitFor();
  assert.equal(net.server, null);
  await closeDialog();
  assert.equal(await page.getByRole('button', { name: /Recogiendo respuestas/ }).count(), 0);
  // another form while collecting stops it
  await startCollecting();
  await ev(() => {
    window.__novaForms.ctl.dirty = false;
    window.__novaForms.ctl.reset();
  });
  await page.waitForFunction(() => !window.__novaForms.collector.running);
  const again = await collectDialog();
  assert.match(await again.innerText(), /Se dejó de recoger porque se abrió otro formulario/);
  await closeDialog();
});

await check('the dialog, the status bar and the notices are readable in the four themes', async () => {
  for (const theme of ['colorful', 'white', 'darkgray', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await stopCollecting();
    await survey();
    let d = await collectDialog();
    await page.waitForTimeout(600); // the dialog fades in
    assert.deepEqual(await lowContrast(page, ['[role="dialog"]']), [], `apagado ${theme}`);
    await d.getByRole('button', { name: 'Empezar a recoger' }).click();
    await d.getByLabel('Dirección para responder').waitFor();
    await settle();
    assert.deepEqual(await lowContrast(page, ['[role="dialog"]']), [], `encendido ${theme}`);
    await shot(`theme-${theme}-dialog`);
    await closeDialog();
    assert.deepEqual(await lowContrast(page, ['.nv-statusbar', '.fm-page']), [], `barra ${theme}`);
  }
  await stopCollecting();
  await ev(() => window.__novaSettings.set('theme', 'colorful'));
});

// ---------------------------------------------------------------- from Nova Mail
const responseJson = (formId, id, fruit) => JSON.stringify({ format: 'novaforms-response', formId, id, at: '2026-05-04T10:00:00Z', answers: { q1: fruit } });
const withFiles = (subject, from, files) => {
  const part = (name, text) => `--limite\r\nContent-Type: application/json; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(text).toString('base64')}\r\n`;
  return `From: ${from}\r\nTo: yo@x.test\r\nSubject: ${subject}\r\nMessage-ID: <${subject}@x.test>\r\nDate: Mon, 04 May 2026 10:00:00 GMT\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="limite"\r\n\r\n--limite\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMi respuesta.\r\n${files.map((f) => part(...f)).join('')}--limite--\r\n`;
};

await check('Nova Mail offers to pass attached responses to Nova Forms, and nothing for other attachments', async () => {
  await open('mail');
  await ev(() => new Promise((r) => Object.assign(indexedDB.deleteDatabase('nova-forms-inbox'), { onsuccess: r, onerror: r })));
  await ev(
    (mails) => {
      const c = window.__novaMail.ctl;
      c.setOwner({ name: 'Yo', email: 'yo@x.test' });
      c.batch(() => mails.forEach((raw) => c.importRaw(raw, 'inbox', {})));
    },
    [withFiles('respuestas', 'Ana <ana@x.test>', [['respuesta-r1.json', responseJson('formA', 'r1', 'mango')], ['respuesta-r2.json', responseJson('formA', 'r2', 'piña')]]), withFiles('datos', 'Luis <luis@x.test>', [['datos.json', '{"a":1}']])],
  );
  await settle(300);
  const message = (subject) => page.locator('.ml-item', { hasText: subject }).first().click();
  await message('datos');
  await page.getByRole('article', { name: 'Mensaje' }).getByText('datos.json').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Pasar a Nova Forms' }).count(), 0);
  await message('respuestas');
  await page.getByText('Este mensaje trae 2 respuestas de formularios.').waitFor();
  await shot('mail-offer');
  await press('Pasar a Nova Forms');
  await page.getByText(/Lista para Nova Forms/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Abrir Nova Forms' }).count(), 1);
});

await check('Nova Forms offers them only to their form, adds them when told, and then forgets them', async () => {
  await open('forms');
  const banner = page.getByRole('region', { name: 'Respuestas del correo' });
  await banner.waitFor();
  assert.match(await banner.innerText(), /Hay 2 respuestas del correo para otro formulario/);
  await shot('inbox-other');
  await ev(() => {
    const { ctl } = window.__novaForms;
    ctl.setForm({ title: 'Merienda' });
    ctl.commit({ ...ctl.doc, form: { ...ctl.form, id: 'formA', questions: [] } });
    ctl.addQuestion('text');
    ctl.commit({ ...ctl.doc, form: { ...ctl.form, questions: [{ ...ctl.form.questions[0], id: 'q1', title: 'Tu fruta' }] } });
  });
  await banner.getByText('Nova Mail dejó 2 respuestas para este formulario.').waitFor();
  assert.match(await banner.innerText(), /De: ana@x\.test/);
  assert.equal(await count(), 0, 'nothing is added by itself');
  await shot('inbox-here');
  for (const theme of ['colorful', 'black']) {
    await ev((t) => window.__novaSettings.set('theme', t), theme);
    await page.waitForFunction((t) => document.querySelector('[data-app]').dataset.theme === t, theme);
    await settle();
    assert.deepEqual(await lowContrast(page, ['.fm-page']), [], `aviso ${theme}`);
  }
  await ev(() => window.__novaSettings.set('theme', 'colorful'));
  await banner.getByRole('button', { name: 'Añadirlas' }).click();
  await banner.waitFor({ state: 'detached' });
  assert.deepEqual(await ev(() => window.__novaForms.ctl.responses.map((r) => r.answers.q1)), ['mango', 'piña']);
  await open('forms');
  await settle(500);
  assert.equal(await page.getByRole('region', { name: 'Respuestas del correo' }).count(), 0);
});

await check('another window hears of them at once, and discarding asks', async () => {
  const mail = await ctx.newPage();
  watch(mail);
  await mail.goto(`${BASE}?app=mail`, { waitUntil: 'load' });
  await mail.waitForFunction(() => !!window.__novaMail, null, { timeout: 60000 });
  await mail.evaluate((raw) => window.__novaMail.ctl.importRaw(raw, 'inbox', {}), withFiles('tercera', 'Eva <eva@x.test>', [['respuesta-r3.json', responseJson('formB', 'r3', 'uva')]]));
  await mail.locator('.ml-item', { hasText: 'tercera' }).first().click();
  await mail.getByRole('button', { name: 'Pasar a Nova Forms' }).click();
  const banner = page.getByRole('region', { name: 'Respuestas del correo' });
  await banner.getByText('Hay 1 respuesta del correo para otro formulario.', { exact: false }).waitFor();
  answer = false;
  await banner.getByRole('button', { name: 'Descartarlas' }).click();
  assert.match(questions.at(-1), /¿Descartar/);
  assert.equal(await banner.count(), 1);
  answer = true;
  await banner.getByRole('button', { name: 'Descartarlas' }).click();
  await banner.waitFor({ state: 'detached' });
  await mail.close();
});

await stopServer();
await browser.close();
await away.close();

const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of results) console.log(r[0].padEnd(4), r[1], r[2] ? `\n     ${r[2]}` : '');
if (errors.length) console.log('\nconsole errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length || errors.length ? 1 : 0);
