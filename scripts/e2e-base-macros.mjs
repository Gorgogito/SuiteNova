// End-to-end checks of Nova Base's macros, third round (Access parity): If / Else blocks and submacros edited in the
// interface, embedded macros in a form, data macros of a table (with undo and the security switch).
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-macros.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  dialogs.push(`${d.type()}: ${d.message()}`);
  d.accept();
});

let step = 0;
const shot = async (name) => {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
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
const db = (fn, arg) => page.evaluate(fn, arg);
const settle = () => page.waitForTimeout(300);
const rows = (sql) => db((s) => window.__novaBase.ctl.db.execute(s).rows, sql);
const tryExec = (sql) => db((s) => { try { window.__novaBase.ctl.db.execute(s); return null; } catch (e) { return e.message; } }, sql);
const logs = async () => (await rows('SELECT msg FROM Log ORDER BY rowid')).map((r) => r[0]);
const exact = { exact: true };

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY, nombre TEXT, saldo REAL);
    CREATE TABLE Log (msg TEXT);
    INSERT INTO Clientes VALUES (1, 'Ana', 10), (2, 'Luis', 3);`);
  c.db.clearUndo();
  c.touch();
});
await settle();

await check('a macro with If, Else and a submacro is built in the interface and runs', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Macro', exact: true }).click();
  await page.waitForSelector('.bs-macrosteps');
  // If 1 = 1 Then (insert 'then') Else (insert 'else')
  await page.getByLabel('Acción nueva', exact).selectOption({ label: 'Si… (If)' });
  await page.getByRole('button', { name: 'Agregar paso', exact: true }).click();
  await page.getByLabel('Condición del paso 1', exact).fill('1 = 1');
  await page.getByLabel('Nueva acción dentro del paso 1', exact).selectOption({ label: 'Ejecutar SQL' });
  await page.getByRole('button', { name: 'Agregar dentro del paso 1', exact: true }).click();
  await page.getByLabel('Instrucción SQL 1.1', exact).fill(`INSERT INTO Log VALUES ('then')`);
  await page.getByRole('button', { name: 'Agregar Si no al paso 1', exact: true }).click();
  await page.getByLabel('Nueva acción dentro del paso 1e', exact).selectOption({ label: 'Ejecutar SQL' });
  await page.getByRole('button', { name: 'Agregar dentro del Si no del paso 1', exact: true }).click();
  await page.getByLabel('Instrucción SQL 1e.1', exact).fill(`INSERT INTO Log VALUES ('else')`);
  await shot('macro-if-else');
  await page.getByRole('button', { name: 'Ejecutar macro', exact: true }).click();
  await settle();
  assert.deepEqual(await logs(), ['then']);
  await page.getByLabel('Condición del paso 1', exact).fill('1 = 2');
  await page.getByRole('button', { name: 'Ejecutar macro', exact: true }).click();
  await settle();
  assert.deepEqual(await logs(), ['then', 'else']);
  // a submacro and a call to it from the same macro
  await page.getByLabel('Acción nueva', exact).selectOption({ label: 'Submacro' });
  await page.getByRole('button', { name: 'Agregar paso', exact: true }).click();
  await page.getByLabel('Nombre 2', exact).fill('Aviso');
  await page.getByLabel('Nueva acción dentro del paso 2', exact).selectOption({ label: 'Ejecutar SQL' });
  await page.getByRole('button', { name: 'Agregar dentro del paso 2', exact: true }).click();
  await page.getByLabel('Instrucción SQL 2.1', exact).fill(`INSERT INTO Log VALUES ('sub')`);
  await page.getByLabel('Acción nueva', exact).selectOption({ label: 'Ejecutar macro' });
  await page.getByRole('button', { name: 'Agregar paso', exact: true }).click();
  await page.getByLabel('Macro 3', exact).fill('.Aviso');
  await page.getByRole('button', { name: 'Ejecutar macro', exact: true }).click();
  await settle();
  assert.deepEqual(await logs(), ['then', 'else', 'else', 'sub']);
  const def = await db(() => window.__novaBase.ctl.db.getObject('macro', 'Macro1'));
  assert.equal(def.steps[0].action, 'If');
  assert.equal(def.steps[0].children[0].args.sql.startsWith('INSERT'), true);
  assert.equal(def.steps[0].elseSteps.length, 1);
  assert.equal(def.steps[1].action, 'Submacro');
  await shot('macro-submacro');
});

await check('the editor warns about a missing submacro and a missing condition', async () => {
  await page.getByLabel('Macro 3', exact).fill('.Nada');
  const w = await page.getByRole('status', { name: 'Avisos de la macro' }).innerText();
  assert.match(w, /la submacro "nada" no existe/);
  await page.getByLabel('Macro 3', exact).fill('.Aviso');
  await page.getByLabel('Condición del paso 1', exact).fill('');
  assert.match(await page.getByRole('status', { name: 'Avisos de la macro' }).innerText(), /falta la condición/);
  await page.getByLabel('Condición del paso 1', exact).fill('1 = 2');
});

await check('OnError sends the failure to a submacro that reads MacroError', async () => {
  await db(() => {
    const c = window.__novaBase.ctl;
    c.db.saveObject('macro', 'Seguro', {
      steps: [
        { action: 'OnError', args: { mode: 'macro', macro: '.Falla' } },
        { action: 'RunSQL', args: { sql: 'INSERT INTO NoExiste VALUES (1)' } },
        { action: 'RunSQL', args: { sql: `INSERT INTO Log VALUES ('no llega')` } },
        { action: 'Submacro', args: { name: 'Falla' }, children: [{ action: 'RunSQL', args: { sql: `="INSERT INTO Log VALUES ('fallo controlado: " & Left([MacroError.Description], 20) & "')"` } }] },
      ],
    });
    c.touch();
  });
  const r = await db(() => window.__novaBase.ctl.runtime.runMacro('Seguro'));
  assert.equal(r.ok, true, r.error);
  const last = (await logs()).at(-1);
  assert.match(last, /^fallo controlado: /);
  assert.ok(!(await logs()).includes('no llega'));
});

await check('an embedded macro in a form: edited from the designer, runs on open, travels with the form', async () => {
  await page.locator('.bs-nav-pane li button', { hasText: /^Clientes$/ }).click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Formulario', exact: true }).click();
  await page.waitForSelector('.bs-formcanvas');
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.getByLabel('Al abrir', exact).selectOption('embedded:');
  await page.getByRole('button', { name: 'Editar la macro incrustada de Al abrir', exact: true }).click();
  await page.getByLabel('Acción nueva', exact).selectOption({ label: 'Ejecutar SQL' });
  await page.getByRole('button', { name: 'Agregar paso', exact: true }).click();
  await page.getByLabel('Instrucción SQL 1', exact).fill(`INSERT INTO Log VALUES ('form abierto')`);
  await shot('embedded-macro');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  const h = await db(() => { const c = window.__novaBase.ctl; return c.forms.get(c.active).layout.events.onOpen; });
  assert.equal(h.kind, 'embedded');
  assert.equal(h.macro.steps.length, 1);
  const before = (await logs()).length;
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  await page.waitForSelector('.bs-formcanvas');
  await settle();
  assert.equal((await logs()).length, before + 1);
  assert.equal((await logs()).at(-1), 'form abierto');
});

await check('an embedded macro with CancelEvent in "before update" refuses the change', async () => {
  await db(() => {
    const c = window.__novaBase.ctl;
    const f = c.forms.get(c.active);
    const l = JSON.parse(JSON.stringify(f.layout));
    l.events = { ...l.events, beforeUpdate: { kind: 'embedded', name: '', macro: { steps: [{ action: 'If', args: {}, condition: '[saldo] < 0', children: [{ action: 'CancelEvent', args: {} }] }] } } };
    c.saveForm(c.active, { ...f, layout: l });
  });
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  await page.waitForSelector('.bs-formcanvas');
  await page.locator('#f-saldo').fill('-5');
  await page.locator('#f-saldo').blur();
  await settle();
  assert.equal((await rows('SELECT saldo FROM Clientes WHERE id = 1'))[0][0], 10);
  assert.match(await page.getByRole('alert').innerText(), /se canceló/);
  await page.locator('#f-saldo').fill('12');
  await page.locator('#f-saldo').blur();
  await settle();
  assert.equal((await rows('SELECT saldo FROM Clientes WHERE id = 1'))[0][0], 12);
});

await check('data macros: After insert logs, Before change refuses a negative balance and fills a default', async () => {
  await db(() => window.__novaBase.ctl.openDesign('Clientes'));
  await page.waitForSelector('.bs-btn');
  await page.getByRole('button', { name: 'Macros de datos…', exact: true }).click();
  // After insert: create a Log record with the name
  await page.getByRole('tab', { name: /^Después de insertar/ }).click();
  await page.getByLabel('Acción nueva', exact).selectOption({ label: 'Crear registro' });
  await page.getByRole('button', { name: 'Agregar paso', exact: true }).click();
  await page.getByLabel('Tabla 1', exact).selectOption('Log');
  await page.getByLabel('Nueva acción dentro del paso 1', exact).selectOption({ label: 'Establecer campo' });
  await page.getByRole('button', { name: 'Agregar dentro del paso 1', exact: true }).click();
  await page.getByLabel('Campo 1.1', exact).fill('msg');
  await page.getByLabel('Valor 1.1', exact).fill('"alta " & [nombre]');
  // Before change: negative balance is an error; an empty balance becomes 0
  await page.getByRole('tab', { name: /^Antes de cambiar/ }).click();
  await page.getByLabel('Acción nueva', exact).selectOption({ label: 'Si… (If)' });
  await page.getByRole('button', { name: 'Agregar paso', exact: true }).click();
  await page.getByLabel('Condición del paso 1', exact).fill('[saldo] < 0');
  await page.getByLabel('Nueva acción dentro del paso 1', exact).selectOption({ label: 'Provocar un error' });
  await page.getByRole('button', { name: 'Agregar dentro del paso 1', exact: true }).click();
  await page.getByLabel('Mensaje 1.1', exact).fill('Saldo negativo no permitido');
  await page.getByLabel('Acción nueva', exact).selectOption({ label: 'Si… (If)' });
  await page.getByRole('button', { name: 'Agregar paso', exact: true }).click();
  await page.getByLabel('Condición del paso 2', exact).fill('IsNull([saldo])');
  await page.getByLabel('Nueva acción dentro del paso 2', exact).selectOption({ label: 'Establecer campo' });
  await page.getByRole('button', { name: 'Agregar dentro del paso 2', exact: true }).click();
  await page.getByLabel('Campo 2.1', exact).fill('saldo');
  await page.getByLabel('Valor 2.1', exact).fill('0');
  await shot('data-macros');
  await page.getByRole('button', { name: 'Guardar las macros de datos', exact: true }).click();
  await settle();
  const meta = await db(() => window.__novaBase.ctl.db.getMeta('Clientes').dataMacros);
  assert.deepEqual(Object.keys(meta).sort(), ['afterInsert', 'beforeChange']);
  const triggers = await rows(`SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE '__nova_val_%'`);
  assert.ok(triggers[0][0] >= 3);
  const before = (await logs()).length;
  assert.equal(await tryExec(`INSERT INTO Clientes (nombre, saldo) VALUES ('Zoe', 5)`), null);
  assert.equal((await logs()).at(-1), 'alta Zoe');
  assert.equal((await logs()).length, before + 1);
  assert.equal(await tryExec(`INSERT INTO Clientes (nombre) VALUES ('Beto')`), null);
  assert.deepEqual(await rows(`SELECT saldo FROM Clientes WHERE nombre = 'Beto'`), [[0]]);
  const err = await tryExec(`INSERT INTO Clientes (nombre, saldo) VALUES ('Mal', -1)`);
  assert.match(err, /Saldo negativo no permitido/);
  assert.deepEqual(await rows(`SELECT count(*) FROM Clientes WHERE nombre = 'Mal'`), [[0]]);
  assert.match(await tryExec(`UPDATE Clientes SET saldo = -9 WHERE nombre = 'Zoe'`), /Saldo negativo/);
});

await check('data macros fire from forms and the undo takes the whole change back; saving the design keeps them', async () => {
  const n = (await logs()).length;
  await db(() => { const c = window.__novaBase.ctl; c.db.insertRow('Clientes', { nombre: 'Dani', saldo: 1 }); c.touch(); });
  assert.equal((await logs()).at(-1), 'alta Dani');
  await db(() => window.__novaBase.ctl.db.undo());
  assert.equal((await logs()).length, n);
  assert.deepEqual(await rows(`SELECT count(*) FROM Clientes WHERE nombre = 'Dani'`), [[0]]);
  await db(() => window.__novaBase.ctl.db.redo());
  assert.equal((await logs()).at(-1), 'alta Dani');
  // the design of the table is saved: the data macros stay
  await db(() => window.__novaBase.ctl.openDesign('Clientes'));
  await page.getByRole('button', { name: 'Guardar tabla', exact: true }).click();
  await settle();
  const meta = await db(() => window.__novaBase.ctl.db.getMeta('Clientes').dataMacros);
  assert.deepEqual(Object.keys(meta).sort(), ['afterInsert', 'beforeChange']);
  assert.equal(await tryExec(`INSERT INTO Clientes (nombre, saldo) VALUES ('Eli', 2)`), null);
  assert.equal((await logs()).at(-1), 'alta Eli');
});

await check('with active content disabled (a file that carries macros) the data macros do not run', async () => {
  await db(() => { window.__novaBase.ctl.contentEnabled = false; });
  const n = (await logs()).length;
  assert.equal(await tryExec(`INSERT INTO Clientes (nombre, saldo) VALUES ('Fran', -3)`), null);
  assert.equal((await logs()).length, n);
  assert.equal(await db(() => window.__novaBase.ctl.hasActiveContent()), true);
  await db(() => { window.__novaBase.ctl.contentEnabled = true; });
  assert.match(await tryExec(`INSERT INTO Clientes (nombre, saldo) VALUES ('Gus', -3)`), /Saldo negativo/);
});

await check('data macros survive saving the database and opening it again', async () => {
  const ok = await db(async () => {
    const c = window.__novaBase.ctl;
    const bytes = c.db.export();
    const SQL = c.db.SQL;
    const again = c.db.constructor.open(SQL, bytes);
    const seen = [];
    again.dataMacroHook = (t, e) => void seen.push(`${t}:${e}`);
    again.execute(`INSERT INTO Clientes (nombre, saldo) VALUES ('Hugo', 4)`);
    return seen;
  });
  assert.deepEqual(ok, ['Clientes:beforeChange:insert', 'Clientes:afterInsert']);
});

await check('no console errors; the only dialogs were confirmations', async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs.filter((d) => !d.startsWith('confirm')), []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
