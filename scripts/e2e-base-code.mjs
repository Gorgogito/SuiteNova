// End-to-end checks of Nova Base's macros, modules (Nova Basic) and form events, including the security bar.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-code.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
const settle = () => page.waitForTimeout(250);
const rows = (sql) => db((s) => window.__novaBase.ctl.db.execute(s).rows, sql);
const nav = (name) => page.locator('.bs-nav-pane li button', { hasText: new RegExp(`^${name}$`) });
const consoleText = () => page.locator('.bs-consoleout').innerText();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await page.screenshot();

await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, saldo REAL, activo BOOLEAN);
    CREATE TABLE Bitacora (msg TEXT);
    INSERT INTO Clientes (nombre, saldo, activo) VALUES ('Ana', 10, 1), ('Luis', 3, 0), ('Eva', 7, 1);`);
  c.db.clearUndo();
  c.touch();
});
await settle();

const setCode = async (code) => {
  const ta = page.getByRole('textbox', { name: /^Código del módulo/ });
  await ta.fill(code);
  await settle();
};

await check('module: create it, write code, run it, see Debug.Print and the data it changed', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Módulo', exact: true }).click();
  await page.getByRole('textbox', { name: /^Código del módulo/ }).waitFor();
  assert.match(await page.getByRole('textbox', { name: /^Código del módulo/ }).inputValue(), /Sub Principal/);
  await setCode(`Option Explicit

Sub Principal()
    Dim rs As Object, total As Double
    Set rs = CurrentDb.OpenRecordset("SELECT nombre, saldo FROM Clientes WHERE activo = True ORDER BY id")
    Do While Not rs.EOF
        Debug.Print rs!nombre & ": " & Format(rs!saldo, "0.00")
        total = total + rs!saldo
        rs.MoveNext
    Loop
    rs.Close
    CurrentDb.Execute "INSERT INTO Bitacora VALUES ('total " & total & "')"
    Debug.Print "Total = " & total
End Sub
`);
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).click();
  await settle();
  const out = await consoleText();
  assert.match(out, /Ana: 10,00/);
  assert.match(out, /Eva: 7,00/);
  assert.match(out, /Total = 17/);
  assert.deepEqual(await rows('SELECT msg FROM Bitacora'), [['total 17']]);
  assert.match(await page.locator('.bs-ok').innerText(), /terminó correctamente/);
  await shot('module');
});

await check('the code is saved in the database and a code change is one undo step', async () => {
  const stored = await db(() => window.__novaBase.ctl.db.getObject('module', 'Modulo1').code);
  assert.match(stored, /OpenRecordset/);
  await page.locator('.bs-tabs').click({ position: { x: 900, y: 10 } });
  await page.keyboard.press('Control+z');
  await settle();
  assert.deepEqual(await rows('SELECT count(*) FROM Bitacora'), [[0]]);
});

await check('syntax errors are shown with their line, and Run takes you to it', async () => {
  await setCode(`Sub Principal()
    Dim x
    x = 1 +
    Debug.Print x
End Sub
`);
  assert.match(await page.locator('.bs-toolbar .bs-hint').first().innerText(), /Línea 3/);
  assert.ok(await page.locator('.bs-gutter .is-bad').count());
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).click();
  await settle();
  assert.match(await page.locator('.bs-error').innerText(), /errores de sintaxis.*línea 3/);
  await shot('syntax');
});

await check('a runtime error names the module, the line and the procedure', async () => {
  await setCode(`Sub Principal()
    Dim x
    x = 1
    x = x / 0
End Sub
`);
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).click();
  await settle();
  assert.match(await page.locator('.bs-error').innerText(), /Error 11 en Modulo1, línea 4 \(Principal\): División por cero/);
});

await check('immediate window: ? expressions, statements, history', async () => {
  const input = page.getByRole('textbox', { name: 'Instrucción inmediata' });
  await setCode(`Function Doble(n)
    Doble = n * 2
End Function
`);
  await input.fill('? Doble(21)');
  await input.press('Enter');
  await input.fill('Debug.Print "hola " & UCase("mundo")');
  await input.press('Enter');
  await input.fill('? 1 / 0');
  await input.press('Enter');
  const out = await consoleText();
  assert.match(out, /> \? Doble\(21\)\n42/);
  assert.match(out, /hola MUNDO/);
  assert.match(out, /⚠ Error 11/);
  await input.press('ArrowUp');
  assert.equal(await input.inputValue(), '? 1 / 0');
});

await check('an endless loop is stopped by the limit, and the page stays alive', async () => {
  await db(() => { window.__novaBase.ctl.runtime.limits = { maxMillis: 400, maxSteps: 50_000_000 }; window.__novaBase.ctl.runtime.load(true); });
  await setCode(`Sub Principal()
    Do
    Loop
End Sub
`);
  await page.getByRole('button', { name: 'Ejecutar', exact: true }).click();
  await settle();
  assert.match(await page.locator('.bs-error').innerText(), /se detuvo|bucle sin fin/);
  await db(() => { window.__novaBase.ctl.runtime.limits = {}; });
});

await check('macro: steps, condition, SQL, message, temporary variables; shows warnings for what does not exist', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Macro', exact: true }).click();
  await page.getByRole('list', { name: 'Pasos de la macro' }).waitFor();
  const add = async (action) => {
    await page.getByLabel('Acción nueva').selectOption({ label: action });
    await page.getByRole('button', { name: 'Agregar paso' }).click();
  };
  await add('Establecer variable temporal');
  await page.getByLabel('Nombre 1', { exact: true }).fill('limite');
  await page.getByLabel('Expresión 1', { exact: true }).fill('5');
  await add('Ejecutar SQL');
  await page.getByLabel('Instrucción SQL 2').fill(`="INSERT INTO Bitacora VALUES ('limite=" & [limite] & "')"`);
  await add('Ejecutar SQL');
  await page.getByLabel('Instrucción SQL 3').fill(`INSERT INTO Bitacora VALUES ('no debe')`);
  await page.getByLabel('Condición del paso 3').fill('[limite] > 100');
  await add('Cuadro de mensaje');
  await page.getByLabel('Mensaje 4').fill('="Hecho: " & [limite]');
  await add('Abrir formulario');
  await page.getByLabel('Formulario 5').selectOption('');
  assert.match(await page.locator('.bs-warn').innerText(), /Paso 5 \(Abrir formulario\): falta "Formulario"/);
  await page.getByRole('button', { name: 'Quitar el paso 5' }).click();
  await page.getByRole('button', { name: 'Ejecutar macro' }).click();
  await settle();
  assert.match(await page.locator('.bs-ok').innerText(), /terminó correctamente/);
  assert.deepEqual(await rows('SELECT msg FROM Bitacora ORDER BY rowid DESC LIMIT 1'), [['limite=5']]);
  assert.deepEqual(await rows(`SELECT count(*) FROM Bitacora WHERE msg = 'no debe'`), [[0]]);
  assert.ok(dialogs.some((d) => d === 'alert: Hecho: 5'));
  await shot('macro');
});

await check('a form button runs a macro; after-update and on-open events run code', async () => {
  // a module with the event procedures and a macro that uses the current record
  const eventos = `Sub AlAbrir()
    Debug.Print "abierto " & Me.Name
End Sub
Sub Cambio()
    Debug.Print "nombre ahora: " & Me!nombre
    CurrentDb.Execute "INSERT INTO Bitacora VALUES ('cambio " & Me!nombre & "')"
End Sub
`;
  await db((code) => {
    const c = window.__novaBase.ctl;
    c.db.saveObject('module', 'Eventos', { code });
    c.db.saveObject('macro', 'Duplicar', { steps: [{ action: 'SetValue', args: { item: 'saldo', expression: '[saldo] * 2' } }] });
    c.touch();
  }, eventos);
  await nav('Clientes').click();
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Formulario', exact: true }).click();
  await page.waitForSelector('.bs-formcanvas');
  await page.getByRole('button', { name: 'Vista Diseño' }).click();
  // the form's own events
  await page.getByLabel('Al abrir', { exact: true }).selectOption({ label: 'AlAbrir' });
  // a button that runs the macro
  await page.getByRole('button', { name: 'Botón', exact: true }).click();
  await page.getByLabel('Título del botón').fill('Duplicar saldo');
  await page.getByLabel('Acción del botón').selectOption('run');
  await page.getByLabel('Al hacer clic').selectOption('macro:Duplicar');
  // the name box runs a procedure after it is updated
  await page.getByRole('button', { name: /^Cuadro de texto Texto2$/ }).click();
  await page.getByLabel('Después de actualizar').selectOption('proc:Cambio');
  await page.getByRole('button', { name: 'Vista Formulario' }).click();
  await page.waitForSelector('.bs-formcanvas');
  await settle();
  assert.match(await consoleTextFromCtl(), /abierto Formulario1/);
  await page.getByRole('button', { name: 'Duplicar saldo' }).click();
  await settle();
  assert.deepEqual(await rows('SELECT saldo FROM Clientes WHERE id = 1'), [[20]]);
  await page.locator('#f-nombre').fill('Ana María');
  await page.locator('#f-nombre').blur();
  await settle();
  assert.deepEqual(await rows(`SELECT msg FROM Bitacora WHERE msg LIKE 'cambio%'`), [['cambio Ana María']]);
  assert.match(await consoleTextFromCtl(), /nombre ahora: Ana María/);
  await shot('form-events');
});
async function consoleTextFromCtl() {
  return db(() => window.__novaBase.ctl.runtime.console.join('\n'));
}

await check('security: a file with macros opens with them off; the bar enables them', async () => {
  const bytes = await db(() => Array.from(window.__novaBase.ctl.db.export()));
  await db((arr) => {
    const c = window.__novaBase.ctl;
    c.openBytes(new Uint8Array(arr), 'con-macros.sqlite', null);
  }, bytes);
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.contentEnabled), false);
  assert.match(await page.getByRole('alert').first().innerText(), /ADVERTENCIA DE SEGURIDAD/);
  // a form button does nothing but explain
  await nav('Formulario1').dblclick();
  await page.waitForSelector('.bs-formcanvas');
  await page.getByRole('button', { name: 'Duplicar saldo' }).click();
  await settle();
  assert.match(await page.locator('.bs-error').innerText(), /contenido activo.*deshabilitado/);
  assert.deepEqual(await rows('SELECT saldo FROM Clientes WHERE id = 1'), [[20]]);
  // code in the immediate window is refused too
  await nav('Modulo1').dblclick();
  const input = page.getByRole('textbox', { name: 'Instrucción inmediata' });
  await input.fill('? 1 + 1');
  await input.press('Enter');
  assert.match(await consoleText(), /deshabilitado/);
  await shot('security');
  await page.getByRole('button', { name: 'Habilitar contenido' }).click();
  await settle();
  assert.equal(await page.getByRole('alert').filter({ hasText: 'ADVERTENCIA DE SEGURIDAD' }).count(), 0);
  await input.fill('? 1 + 1');
  await input.press('Enter');
  assert.match(await consoleText(), /> \? 1 \+ 1\n2/);
});

await check('a new, empty database starts with content enabled', async () => {
  await db(() => window.__novaBase.ctl.newDb());
  await settle();
  assert.equal(await db(() => window.__novaBase.ctl.contentEnabled), true);
});

await check('no console errors; the only dialogs were the ones the code asked for', async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs.filter((d) => !/^alert: Hecho: 5$/.test(d)), []);
});

await browser.close();
let failed = 0;
for (const [s, n, msg] of results) {
  if (s !== 'ok') failed++;
  console.log(`${s === 'ok' ? '✓' : '✗'} ${n}${msg ? '\n    ' + msg : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
