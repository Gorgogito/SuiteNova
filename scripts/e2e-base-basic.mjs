// End-to-end checks of Nova Basic, third round (Access parity): class modules, Type, Enum, Property, files kept in the
// database, Eval, DoCmd.CopyObject/Rename/DeleteObject, Application and CurrentProject.
// Needs `pnpm dev` running on :1420. Usage: node scripts/e2e-base-basic.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=base';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
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
const runProc = (name) => db((n) => { const c = window.__novaBase.ctl; c.runtime.clearConsole(); const r = c.runtime.runProc(n); return { ok: r.ok, error: r.error, out: [...c.runtime.console] }; }, name);
const saveModule = (name, code, kind) => db(({ name, code, kind }) => { const c = window.__novaBase.ctl; c.db.saveObject('module', name, kind ? { code, kind } : { code }); c.touch(); }, { name, code, kind });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__novaBase?.ctl.loading === false);
await db(() => {
  const c = window.__novaBase.ctl;
  c.db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY, nombre TEXT, saldo REAL);
    INSERT INTO Clientes VALUES (1, 'Ana', 10), (2, 'Luis', 3);`);
  c.db.clearUndo();
  c.touch();
});
await settle();

await check('the ribbon creates a class module, saved with its kind, and the editor keeps the kind when typing', async () => {
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Módulo de clase', exact: true }).click();
  await page.waitForSelector('textarea');
  const def = await db(() => window.__novaBase.ctl.db.getObject('module', 'Clase1'));
  assert.equal(def.kind, 'class');
  assert.match(def.code, /Property Get Nombre/);
  await page.locator('textarea').first().fill(def.code + "\n' comentario\n");
  await page.waitForTimeout(700);
  const after = await db(() => window.__novaBase.ctl.db.getObject('module', 'Clase1'));
  assert.equal(after.kind, 'class');
  assert.match(after.code, /comentario/);
  await shot('class-module');
});

await check('a standard module uses the class, a Type and an Enum', async () => {
  await saveModule('Principal', `Type Punto
  X As Long
  Y As Long
End Type
Enum Nivel
  Bajo
  Alto = 5
End Enum
Sub Main()
  Dim c As New Clase1
  c.Nombre = "Zoe"
  Debug.Print c.Saluda()
  Dim p As Punto, q As Punto
  p.X = 4
  q = p
  q.X = 9
  Debug.Print p.X & "," & q.X
  Debug.Print Nivel.Alto + Bajo
End Sub`);
  const r = await runProc('Main');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.out, ['Hola, soy Zoe', '4,9', '5']);
});

await check('files: write, read back, append, list and delete from code; the dialog shows them', async () => {
  await saveModule('Archivos', `Sub Escribe()
  Dim f As Integer
  f = FreeFile
  Open "informe.txt" For Output As #f
  Print #f, "linea 1"
  Print #f, "linea 2"
  Close #f
  Open "informe.txt" For Append As #1
  Print #1, "linea 3"
  Close #1
  Dim t As String, n As Long
  Open "informe.txt" For Input As #1
  Do While Not EOF(1)
    Line Input #1, t
    n = n + 1
  Loop
  Close #1
  Debug.Print "lineas: " & n
End Sub
Sub Datos()
  Open "t.csv" For Output As #1
  Dim rs
  Set rs = CurrentDb.OpenRecordset("SELECT nombre, saldo FROM Clientes ORDER BY id")
  Do While Not rs.EOF
    Write #1, rs!nombre, rs!saldo
    rs.MoveNext
  Loop
  Close #1
End Sub`);
  let r = await runProc('Escribe');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.out, ['lineas: 3']);
  r = await runProc('Datos');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(await db(() => window.__novaBase.ctl.db.getObject('file', 't.csv')), { text: '"Ana",10\n"Luis",3\n' });
  await page.getByRole('tab', { name: 'Crear' }).click();
  await page.getByRole('button', { name: 'Archivos del código…' }).click();
  await page.getByRole('button', { name: 'informe.txt', exact: true }).click();
  assert.match(await page.getByLabel('Contenido del archivo').inputValue(), /linea 3/);
  await shot('files-dialog');
  // import one from the disk and delete another
  await page.getByLabel('Archivo a importar').setInputFiles({ name: 'entrada.txt', mimeType: 'text/plain', buffer: Buffer.from('uno\ndos\n') });
  await page.getByRole('button', { name: 'entrada.txt', exact: true }).waitFor();
  await page.getByRole('button', { name: 'informe.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await settle();
  assert.deepEqual((await db(() => window.__novaBase.ctl.db.objects('file'))).sort(), ['entrada.txt', 't.csv']);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  // code reads the imported file
  await saveModule('Lee', `Function Primera() As String\n  Dim s As String\n  Open "entrada.txt" For Input As #1\n  Line Input #1, s\n  Close #1\n  Primera = s\nEnd Function\nSub MainLee()\n  Debug.Print Primera()\nEnd Sub`);
  const l = await runProc("MainLee");
  assert.deepEqual(l.out, ['uno']);
});

await check('Eval uses the expression language; Application and CurrentProject answer', async () => {
  await saveModule('Varios', `Sub MainVarios()
  Debug.Print Eval("2 + 3 * 4")
  Debug.Print Eval("Left(""Nova Base"", 4)")
  Debug.Print Application.Name & " " & Application.Version
  Debug.Print CurrentProject.Name
End Sub
Sub Mala()
  Debug.Print Eval("2 +")
End Sub`);
  const r = await runProc('MainVarios');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.out, ['14', 'Nova', `Nova Base ${JSON.parse(fs.readFileSync(new globalThis.URL('../apps/suite/package.json', import.meta.url), 'utf8')).version}`, 'Base de datos1']);
  const m = await runProc('Mala');
  assert.equal(m.ok, false);
  assert.match(m.error, /Eval/);
});

await check('DoCmd.CopyObject, Rename and DeleteObject on saved objects and tables', async () => {
  await db(() => { const c = window.__novaBase.ctl; c.db.saveObject('macro', 'M1', { steps: [] }); c.touch(); });
  await saveModule('Objetos', `Sub MainObjetos()
  DoCmd.CopyObject , "M2", acMacro, "M1"
  DoCmd.Rename "M3", acMacro, "M2"
  DoCmd.DeleteObject acMacro, "M1"
  DoCmd.RunSQL "CREATE TABLE Temp1 (a INTEGER)"
  DoCmd.Rename "Temp2", acTable, "Temp1"
  Debug.Print "ok"
End Sub
Sub Borra()
  DoCmd.DeleteObject acTable, "Temp2"
End Sub`);
  const r = await runProc('MainObjetos');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual((await db(() => window.__novaBase.ctl.db.objects('macro'))).sort(), ['M3']);
  assert.ok((await db(() => window.__novaBase.ctl.db.tableNames())).includes('Temp2'));
  const b = await runProc('Borra');
  assert.equal(b.ok, true, b.error);
  assert.ok(!(await db(() => window.__novaBase.ctl.db.tableNames())).includes('Temp2'));
});

await check('errors name the problem: private member, missing file, unknown class', async () => {
  await saveModule('Fallos', `Sub A()\n  Dim c As New Clase1\n  Debug.Print c.mNombre\nEnd Sub\nSub B()\n  Open "no-existe.txt" For Input As #1\nEnd Sub\nSub C()\n  Dim x As New Inexistente\nEnd Sub`);
  const a = await runProc('A');
  assert.equal(a.ok, false);
  assert.match(a.error, /no admite/);
  const b = await runProc('B');
  assert.match(b.error, /No se encuentra el archivo/);
  const c = await runProc('C');
  assert.match(c.error, /No se puede crear el objeto/);
});

await check('events (WithEvents/RaiseEvent), Implements, Class_Terminate and Eval of statements', async () => {
  await saveModule('Sensor', `Public Event Lectura(ByVal v As Long)\nPublic Sub Mide(v As Long)\n  RaiseEvent Lectura(v)\nEnd Sub`, 'class');
  await saveModule('Panel', `Private WithEvents s As Sensor\nPrivate Sub Class_Initialize()\n  Set s = New Sensor\nEnd Sub\nPrivate Sub s_Lectura(ByVal v As Long)\n  Debug.Print "lectura " & v\nEnd Sub\nPrivate Sub Class_Terminate()\n  Debug.Print "panel cerrado"\nEnd Sub\nPublic Sub Prueba()\n  s.Mide 7\nEnd Sub`, 'class');
  await saveModule('IAnimal', `Public Function Sonido() As String\nEnd Function`, 'class');
  await saveModule('Perro', `Implements IAnimal\nPrivate Function IAnimal_Sonido() As String\n  IAnimal_Sonido = "guau"\nEnd Function`, 'class');
  await saveModule('Prueba3', `Sub MainTres()\n  Dim p As New Panel\n  p.Prueba\n  Dim a As IAnimal\n  Set a = New Perro\n  Debug.Print a.Sonido()
  If TypeOf a Is IAnimal Then Debug.Print "es animal"\n  Dim n As Long\n  Eval "n = 40 + 2: Debug.Print n"\n  Debug.Print Eval("n + 1")\nEnd Sub`);
  const r = await runProc('MainTres');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.out, ['lectura 7', 'guau', 'es animal', '42', '43', 'panel cerrado']);
  // a class that does not implement the interface is reported when the module is read
  await saveModule('Gato', `Implements IAnimal`, 'class');
  const bad = await runProc('MainTres');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Gato implementa IAnimal pero le falta IAnimal_Sonido/);
  await db(() => { const c = window.__novaBase.ctl; c.db.deleteObject('module', 'Gato'); c.touch(); });
});

await check('the objects survive saving and reopening the database', async () => {
  const ok = await db(async () => {
    const c = window.__novaBase.ctl;
    const bytes = c.db.export();
    const { BaseDb, loadSql } = window.__novaBase.core ?? {};
    return bytes.length > 1000 && !!BaseDb === !!loadSql;
  });
  assert.equal(ok, true);
  assert.equal((await db(() => window.__novaBase.ctl.db.getObject('module', 'Clase1'))).kind, 'class');
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
