// End-to-end checks for Nova Plan in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-plan.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=plan';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-plan-'));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  if (d.type() === 'confirm' && /^Hay cambios sin guardar/.test(d.message())) return void d.accept();
  dialogs.push(d.message());
  d.dismiss();
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
    await shot(`FAIL-${name.replace(/\W+/g, '-').slice(0, 40)}`);
    // a dialog left open by the failed check would block the next ones
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(200);
  }
};

const settle = () => page.waitForTimeout(150);
const ev = (fn, arg) => page.evaluate(fn, arg);
const text = (i, col) => ev(([i, col]) => window.__novaPlan.text(i, col), [i, col]);
const names = () => ev(() => window.__novaPlan.ctl.project.tasks.map((t) => t.name));
const tab = (n) => page.getByRole('tab', { name: n, exact: true }).click();
const press = (n) => page.getByRole('button', { name: n, exact: true }).click();
const menu = (n) => page.getByRole('menuitem', { name: n, exact: true }).click();
const COL = { name: 'Nombre de la tarea', duration: 'Duración', start: 'Comienzo', finish: 'Fin', percent: '% compl.', predecessors: 'Predecesoras', resources: 'Recursos', work: 'Trabajo', type: 'Tipo de tarea', actualWork: 'Trabajo real', actualCost: 'Costo real', cost: 'Costo' };
const cell = (row, col) => page.getByRole('gridcell', { name: `${COL[col] ?? col}, fila ${row + 1}`, exact: true });
const editCell = async (row, col, value) => {
  await cell(row, col).dblclick();
  const input = page.getByRole('textbox', { name: `${COL[col] ?? col}, fila ${row + 1}`, exact: true });
  await input.fill(value);
  await input.press('Enter');
  await settle();
};
const status = () => page.locator('.pl-msg').innerText().catch(() => '');
const bar = (row) => page.locator(`.pl-bar[data-row="${row}"]`);
const box = async (loc) => await loc.boundingBox();
const drag = async (from, to, steps = 8) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  await settle();
};
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const dialog = () => page.getByRole('dialog');
const closeDialog = async (name = 'Aceptar') => {
  await dialog().getByRole('button', { name, exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
};
const useScale = async (label) => {
  await tab('Vista');
  await press(label);
  await tab('Tarea');
};
const ctlEval = (fn, arg) => ev(([src, a]) => new Function('ctl', 'a', `return (${src})(ctl, a)`)(window.__novaPlan.ctl, a), [fn.toString(), arg]);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.pl-app');
await page.screenshot(); // first capture after load can be blank

await check('ribbon tabs and the empty project', async () => {
  for (const t of ['Tarea', 'Recurso', 'Proyecto', 'Vista', 'Ayuda']) assert.ok(await page.getByRole('tab', { name: t, exact: true }).count(), t);
  assert.ok(await page.getByText('El proyecto está vacío.').count());
  await page.getByRole('button', { name: 'Añadir la primera tarea' }).click();
  assert.equal((await names()).length, 1);
  assert.equal(await page.locator('.pl-tr').count(), 1);
});

await check('project information: start with an hour, hours per day, invalid values refused', async () => {
  await tab('Proyecto');
  await press('Información del proyecto…');
  await dialog().getByLabel('Nombre del proyecto').fill('Casa nueva');
  await dialog().getByLabel('Fecha de comienzo').fill('32/13/2025');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /comienzo no es válida/);
  await dialog().getByLabel('Fecha de comienzo').fill('03/03/2025 08:00');
  await dialog().getByLabel('Horas por día').fill('30');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /entre 0 y 24/);
  await dialog().getByLabel('Horas por día').fill('8');
  await closeDialog();
  const p = await ev(() => ({ n: window.__novaPlan.ctl.project.name, s: window.__novaPlan.ctl.project.start, m: window.__novaPlan.ctl.project.minutesPerDay }));
  assert.equal(p.n, 'Casa nueva');
  assert.equal(p.s, Math.floor(Date.UTC(2025, 2, 3) / 60000) + 480);
  assert.equal(p.m, 480);
  assert.match(await page.locator('.nv-titlebar').innerText(), /Casa nueva/);
  await tab('Tarea');
});

await check('add tasks, edit cells inline (durations with units), bad input is refused with a message', async () => {
  await press('Tarea nueva');
  await press('Tarea nueva');
  await press('Tarea nueva');
  assert.equal((await names()).length, 4);
  await editCell(0, 'name', 'Planos');
  await editCell(1, 'name', 'Permisos');
  await editCell(2, 'name', 'Obra gruesa');
  await editCell(3, 'name', 'Entrega');
  await editCell(0, 'duration', '2');
  await editCell(1, 'duration', '3d');
  await editCell(2, 'duration', '1sem');
  await editCell(3, 'duration', '0');
  assert.deepEqual(await names(), ['Planos', 'Permisos', 'Obra gruesa', 'Entrega']);
  assert.deepEqual(await ev(() => window.__novaPlan.ctl.project.tasks.map((t) => t.duration)), [960, 1440, 2400, 0]);
  await editCell(0, 'duration', 'mucho');
  assert.match(await status(), /duración/);
  assert.equal(await text(0, 'duration'), '2d');
  await editCell(0, 'percent', '150');
  assert.match(await status(), /entre 0 y 100/);
  await editCell(1, 'start', '31/02/2025');
  assert.match(await status(), /fecha/);
  assert.equal(await text(0, 'start'), '03/03/2025 08:00');
  await shot('tasks');
});

await check('predecessors with lags reschedule the tasks; times of day are shown', async () => {
  await editCell(1, 'predecessors', '1');
  await editCell(2, 'predecessors', '2FS+1d');
  await editCell(3, 'predecessors', '3');
  assert.equal(await text(1, 'start'), '05/03/2025 08:00');
  assert.equal(await text(1, 'finish'), '07/03/2025 17:00');
  assert.equal(await text(2, 'start'), '11/03/2025 08:00');
  assert.equal(await text(2, 'finish'), '17/03/2025 17:00');
  assert.equal(await text(3, 'start'), '17/03/2025 17:00');
  assert.equal(await text(2, 'predecessors'), '2FS+1d');
  const a = await box(bar(1).locator('.pl-body'));
  const b = await box(bar(2).locator('.pl-body'));
  assert.ok(b.x > a.x + a.width, 'B starts after A ends');
  assert.equal(await page.locator('.pl-arrow').count(), 3);
  await editCell(0, 'predecessors', '4');
  assert.match(await status(), /circular/);
  await editCell(0, 'predecessors', '1');
  assert.match(await status(), /sí misma/);
  await editCell(0, 'predecessors', '9');
  assert.match(await status(), /no existe/);
  assert.equal(await text(0, 'predecessors'), '');
});

await check('keyboard: arrows move, F2 edits, typing starts editing, Esc cancels', async () => {
  await cell(0, 'name').click();
  await page.keyboard.press('ArrowDown');
  assert.equal(await ev(() => window.__novaPlan.ctl.active), 1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  assert.deepEqual(await ev(() => window.__novaPlan.ctl.selected.slice().sort()), [2, 3]);
  await cell(0, 'name').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const input = page.getByRole('textbox', { name: 'Duración, fila 1', exact: true });
  await input.fill('7');
  await input.press('Escape');
  assert.equal(await text(0, 'duration'), '2d');
  await page.keyboard.press('3');
  await page.keyboard.press('Enter');
  await settle();
  assert.equal(await text(0, 'duration'), '3d');
  await editCell(0, 'duration', '2');
});

await check('timeline scales: hours of the day (with non-working shading), days, weeks, months', async () => {
  await tab('Vista');
  await press('Escala: horas');
  const hours = await page.locator('.pl-head .pl-htext--small').evaluateAll((els) => els.map((e) => e.textContent));
  assert.ok(hours.includes('08') && hours.includes('16'), 'hour labels');
  assert.ok((await page.locator('.pl-weekend').count()) > 0, 'night shading');
  await shot('hour-scale');
  await press('Escala: días');
  assert.ok((await page.locator('.pl-htext--small').count()) > 20);
  await press('Escala: meses');
  assert.match(await page.locator('.pl-head').evaluate((g) => g.textContent), /2025/);
  await press('Escala: semanas');
  await shot('week-scale');
  await press('Escala: días');
  await tab('Tarea');
});

await check('drag a bar to move it: sets "start no earlier than", one undo step', async () => {
  const c = center(await box(bar(0).locator('.pl-body')));
  await drag(c, { x: c.x + 56, y: c.y });
  assert.equal(await text(0, 'start'), '05/03/2025 08:00');
  const t = await ev(() => window.__novaPlan.ctl.project.tasks[0].constraint);
  assert.equal(t.type, 'snet');
  assert.equal(await text(1, 'start'), '07/03/2025 08:00');
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal(await text(0, 'start'), '03/03/2025 08:00');
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks[0].constraint.type), 'asap');
  await page.keyboard.press('Control+y');
  await settle();
  assert.equal(await text(0, 'start'), '05/03/2025 08:00');
  await page.keyboard.press('Control+z');
  await settle();
});

await check('a click without moving only selects (no constraint added)', async () => {
  const c = center(await box(bar(1).locator('.pl-body')));
  await page.mouse.click(c.x, c.y);
  assert.equal(await ev(() => window.__novaPlan.ctl.active), 1);
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks[1].constraint.type), 'asap');
});

await check('drag the right edge to change the duration', async () => {
  const b = await box(bar(0).locator('.pl-body'));
  await drag({ x: b.x + b.width - 1, y: b.y + b.height / 2 }, { x: b.x + b.width + 28 * 2 - 1, y: b.y + b.height / 2 });
  assert.equal(await text(0, 'duration'), '4d');
  assert.equal(await text(1, 'start'), '07/03/2025 08:00');
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal(await text(0, 'duration'), '2d');
});

await check('drag the progress handle to set the percent complete', async () => {
  const b = await box(bar(2).locator('.pl-body'));
  const h = await box(bar(2).locator('.pl-progress-handle'));
  await drag({ x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: b.x + b.width / 2, y: h.y + h.height / 2 });
  const pc = Number(await text(2, 'percent'));
  assert.ok(pc >= 45 && pc <= 55 && pc % 5 === 0, `percent ${pc}`);
  await editCell(2, 'percent', '0');
});

await check('drag from the link handle to another bar creates a link; cycles are refused', async () => {
  const h = await box(bar(3).locator('.pl-linkhandle'));
  const rowA = await box(page.locator('.pl-rowbg').nth(0));
  await drag({ x: h.x + h.width / 2, y: h.y + h.height / 2 }, { x: rowA.x + 400, y: rowA.y + 14 });
  assert.match(await status(), /circular/);
  assert.equal(await text(0, 'predecessors'), '');
  await cell(3, 'name').click();
  await page.getByRole('button', { name: 'Tarea nueva', exact: true }).click();
  await editCell(4, 'name', 'Mudanza');
  const h0 = await box(bar(0).locator('.pl-linkhandle'));
  const loose = await box(bar(4).locator('.pl-body'));
  await drag({ x: h0.x + h0.width / 2, y: h0.y + h0.height / 2 }, center(loose));
  assert.equal(await text(4, 'predecessors'), '1');
  await editCell(4, 'duration', '2');
  await shot('linked');
});

await check('critical path is highlighted and can be switched off', async () => {
  assert.ok((await page.locator('.pl-bar.is-critical').count()) >= 3);
  await tab('Vista');
  await press('Resaltar ruta crítica');
  assert.equal(await page.locator('.pl-bar.is-critical').count(), 0);
  await press('Resaltar ruta crítica');
  assert.ok((await page.locator('.pl-bar.is-critical').count()) >= 3);
  await tab('Tarea');
});

await check('indent makes a summary; collapse hides children; outdent restores', async () => {
  await cell(1, 'name').click();
  await press('Aumentar sangría (subordinar)');
  await cell(2, 'name').click();
  await press('Aumentar sangría (subordinar)');
  assert.equal(await ev(() => window.__novaPlan.ctl.sched.tasks[0].summary), true);
  assert.equal(await page.locator('.pl-tr.is-summary').count(), 1);
  assert.equal(await page.locator('.pl-bar[data-kind="summary"]').count(), 1);
  const rows = await page.locator('.pl-tr').count();
  await page.getByRole('button', { name: 'Contraer', exact: true }).click();
  assert.equal(await page.locator('.pl-tr').count(), rows - 2);
  await page.getByRole('button', { name: 'Expandir', exact: true }).click();
  assert.equal(await page.locator('.pl-tr').count(), rows);
  await cell(0, 'duration').dblclick();
  assert.equal(await page.getByRole('textbox', { name: 'Duración, fila 1', exact: true }).count(), 0);
  await cell(2, 'name').click();
  await press('Disminuir sangría (ascender)');
  await cell(1, 'name').click();
  await press('Disminuir sangría (ascender)');
  assert.equal(await page.locator('.pl-tr.is-summary').count(), 0);
});

await check('move a task up and down', async () => {
  await cell(4, 'name').click();
  await press('Mover tarea hacia arriba');
  assert.deepEqual(await names(), ['Planos', 'Permisos', 'Obra gruesa', 'Mudanza', 'Entrega']);
  await press('Mover tarea hacia abajo');
  assert.deepEqual(await names(), ['Planos', 'Permisos', 'Obra gruesa', 'Entrega', 'Mudanza']);
});

await check('task information dialog: tabs, validation, one undo step', async () => {
  await cell(1, 'name').click();
  await page.keyboard.press('Shift+F2');
  await dialog().getByLabel('Nombre', { exact: true }).fill('Permisos municipales');
  await dialog().getByLabel('Duración', { exact: true }).fill('4');
  await dialog().getByLabel('Costo fijo', { exact: true }).fill('250');
  await dialog().getByRole('tab', { name: 'Avanzado' }).click();
  await dialog().getByLabel('Restricción', { exact: true }).selectOption('snet');
  await dialog().getByLabel('Fecha de la restricción').fill('99/99/2025');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /fechas como/);
  await dialog().getByLabel('Fecha de la restricción').fill('10/03/2025 08:00');
  await dialog().getByLabel('Fecha límite').fill('12/03/2025 17:00');
  await dialog().getByRole('tab', { name: 'Notas' }).click();
  await dialog().getByRole('textbox', { name: 'Notas' }).fill('Pedir cita en el ayuntamiento');
  await closeDialog();
  const t = await ev(() => window.__novaPlan.ctl.project.tasks[1]);
  assert.deepEqual([t.name, t.duration, t.fixedCost, t.constraint.type, t.notes], ['Permisos municipales', 1920, 250, 'snet', 'Pedir cita en el ayuntamiento']);
  assert.equal(await text(1, 'start'), '10/03/2025 08:00');
  assert.equal(await page.locator('[data-testid="deadline"]').count(), 1);
  await page.keyboard.press('Control+z');
  await settle();
  assert.equal((await names())[1], 'Permisos');
  assert.equal(await text(1, 'start'), '05/03/2025 08:00');
});

await check('working calendars: a holiday moves the dates; a calendar with no working time is refused', async () => {
  const before = await text(1, 'finish');
  await tab('Proyecto');
  await press('Calendarios laborales…');
  await dialog().getByLabel('Desde', { exact: true }).fill('06/03/2025');
  await dialog().getByLabel('Nombre de la excepción').fill('Fiesta local');
  await dialog().getByRole('button', { name: 'Añadir', exact: true }).click();
  await closeDialog();
  assert.notEqual(await text(1, 'finish'), before);
  await press('Calendarios laborales…');
  assert.match(await dialog().getByRole('list', { name: 'Excepciones' }).innerText(), /06\/03\/2025/);
  await dialog().getByRole('button', { name: /Quitar excepción 06\/03\/2025/ }).click();
  await closeDialog();
  assert.equal(await text(1, 'finish'), before);
  await press('Calendarios laborales…');
  for (const d of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']) await dialog().getByLabel(`${d}: tipo de día`).selectOption('off');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /tiempo laborable/);
  await closeDialog('Cancelar');
  await tab('Tarea');
});

await check('a custom calendar with hours drives a task: 6-hour days make it longer in calendar time', async () => {
  await tab('Proyecto');
  await press('Calendarios laborales…');
  await dialog().getByRole('button', { name: 'Nuevo calendario' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('Turno corto');
  for (const [i, d] of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'].entries()) {
    await dialog().getByLabel(`${d}: tipo de día`).selectOption('hours');
    const h = dialog().getByLabel(`${d}: horario`);
    await h.fill('09:00-12:00, 13:00-16:00');
    await h.blur();
  }
  await closeDialog();
  const cals = await ev(() => window.__novaPlan.ctl.project.calendars.map((c) => c.name));
  assert.deepEqual(cals, ['Estándar', 'Turno corto']);
  // Mudanza (row 4) gets the new calendar: 2 days of 6 hours
  await cell(4, 'name').click();
  await page.keyboard.press('Shift+F2');
  await dialog().getByRole('tab', { name: 'Avanzado' }).click();
  await dialog().getByLabel('Calendario de la tarea').selectOption({ label: 'Turno corto' });
  await closeDialog();
  assert.equal(await text(4, 'start').then((s) => s.slice(0, 10)), '05/03/2025');
  assert.match(await text(4, 'start'), /09:00$/);
  assert.match(await text(4, 'finish'), /14:00$/); // 16 working hours on 6-hour days
  await cell(4, 'name').click();
  await page.keyboard.press('Shift+F2');
  await dialog().getByRole('tab', { name: 'Avanzado' }).click();
  await dialog().getByLabel('Calendario de la tarea').selectOption({ label: '(el del proyecto)' });
  await closeDialog();
  assert.match(await text(4, 'finish'), /17:00$/);
});

await check('resource sheet: create resources, calendars per resource, validation', async () => {
  await tab('Recurso');
  await press('Recurso nuevo');
  await page.getByRole('table', { name: 'Hoja de recursos' }).waitFor();
  await page.getByLabel('Nombre del recurso, Recurso 1').fill('Ana');
  await page.getByLabel('Nombre del recurso, Recurso 1').press('Enter');
  await page.getByLabel('Tasa estándar (por hora), Ana').fill('10');
  await page.getByLabel('Tasa estándar (por hora), Ana').blur();
  await press('Recurso nuevo');
  await page.getByLabel('Nombre del recurso, Recurso 2').fill('Cemento');
  await page.getByLabel('Nombre del recurso, Recurso 2').blur();
  await page.getByLabel('Tipo, Cemento').selectOption('material');
  await page.getByLabel('Tasa estándar (por hora), Cemento').fill('5');
  await page.getByLabel('Tasa estándar (por hora), Cemento').blur();
  await page.getByLabel('Costo por uso, Ana').fill('abc');
  await page.getByLabel('Costo por uso, Ana').blur();
  assert.match(await page.getByRole('alert').first().innerText(), /mayor o igual que cero/);
  await page.getByLabel('Calendario, Ana').selectOption({ label: 'Turno corto' });
  const r = await ev(() => window.__novaPlan.ctl.project.resources.map((x) => [x.name, x.type, x.rate, x.calendar]));
  assert.deepEqual(r.map((x) => x.slice(0, 3)), [['Ana', 'work', 10], ['Cemento', 'material', 5]]);
  assert.ok(r[0][3]);
  await page.getByLabel('Calendario, Ana').selectOption({ label: '(el del proyecto)' });
  await shot('resource-sheet');
  await press('Diagrama de Gantt').catch(() => tab('Tarea').then(() => press('Diagrama de Gantt')));
});

await check('assign by text, costs, over-allocation shown in the usage view and the graph', async () => {
  await tab('Tarea');
  await editCell(2, 'resources', 'Pepe');
  assert.match(await status(), /No existe el recurso/);
  await editCell(2, 'resources', 'Ana; Cemento[4]');
  assert.equal(await text(2, 'resources'), 'Ana;Cemento[4]');
  await editCell(0, 'resources', 'Ana');
  await editCell(4, 'resources', 'Ana');
  assert.equal(await ev(() => window.__novaPlan.ctl.sched.tasks[2].cost), 10 * 5 * 8 + 4 * 5);
  await editCell(4, 'predecessors', '');
  await editCell(4, 'start', '03/03/2025 08:00');
  await page.waitForFunction(() => window.__novaPlan.ctl.sched.overallocations.length > 0);
  assert.match(await page.locator('footer, .nv-statusbar').first().innerText().catch(() => ''), /sobreasignados/);
  await tab('Recurso');
  await press('Uso de recursos');
  const usage = page.getByRole('table', { name: 'Uso de recursos' });
  assert.match(await usage.innerText(), /Ana ⚠ sobreasignado/);
  assert.ok((await usage.locator('td.is-over').count()) > 0);
  await shot('resource-usage');
  await press('Gráfico de recursos');
  await page.locator('[data-chart="resource-load"]').waitFor();
  assert.match(await page.locator('.pl-over-msg').innerText(), /sobreasignado/);
  await shot('resource-graph');
  await press('Uso de tareas');
  assert.match(await page.getByRole('table', { name: 'Uso de tareas' }).innerText(), /Obra gruesa/);
  await tab('Tarea');
  await press('Diagrama de Gantt');
});

await check('columns dialog adds work, task type, actual work and cost columns', async () => {
  await tab('Vista');
  await press('Columnas de la tabla…');
  for (const label of ['Trabajo', 'Tipo de tarea', 'Trabajo real', 'Costo real']) await dialog().getByLabel('Añadir columna').selectOption({ label });
  await closeDialog();
  assert.deepEqual(await ev(() => window.__novaPlan.ctl.columns.slice(-4)), ['work', 'type', 'actualWork', 'actualCost']);
  await tab('Tarea');
  assert.equal(await text(2, 'work'), '40 h');
  assert.equal(await text(2, 'type'), 'Unidades fijas');
  await shot('columns');
});

await check('task types: fixed work and fixed duration, effort-driven, actual work and cost', async () => {
  // Obra gruesa: 5 days, Ana 100 %: 40 h. Fixed work: a second worker halves the duration.
  await editCell(2, 'type', 'Trabajo fijo');
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks[2].type), 'work');
  await editCell(2, 'resources', 'Ana; Cemento[4]; ');
  await page.waitForTimeout(100);
  await ev(() => {
    const { ctl } = window.__novaPlan;
    ctl.commit({ ...ctl.project, resources: [...ctl.project.resources, { ...ctl.project.resources[0], id: 'rb', name: 'Beto', rate: 20 }] });
  });
  await editCell(2, 'resources', 'Ana; Beto; Cemento[4]');
  assert.equal(await ev(() => window.__novaPlan.ctl.sched.tasks[2].duration), 1200);
  assert.equal(await text(2, 'work'), '40 h');
  await editCell(2, 'type', 'Duración fija');
  await editCell(2, 'duration', '5');
  assert.equal(await text(2, 'work'), '80 h');
  // actual work typed by hand
  await editCell(2, 'actualWork', '10');
  assert.equal(await text(2, 'actualWork'), '10 h');
  await editCell(2, 'actualWork', 'mucho');
  assert.match(await status(), /trabajo/);
  await editCell(2, 'actualWork', '');
  // the same through the task dialog: effort-driven + per-resource actual work and cost
  await cell(2, 'name').click();
  await page.keyboard.press('Shift+F2');
  await dialog().getByRole('tab', { name: 'Recursos y trabajo' }).click();
  await dialog().getByLabel('Tipo de tarea').selectOption('units');
  await dialog().getByLabel('Conducida por esfuerzo', { exact: false }).check();
  await dialog().getByRole('tab', { name: 'Real' }).click();
  await dialog().getByLabel('Trabajo real (horas), Ana').fill('12');
  await dialog().getByLabel('Costo real, Ana').fill('300');
  await closeDialog();
  const t = await ev(() => window.__novaPlan.ctl.project.tasks[2]);
  assert.equal(t.effortDriven, true);
  assert.equal(t.assignments.find((a) => a.resource !== 'rb' && a.actualWork !== null).actualWork, 720);
  assert.equal(await ev(() => window.__novaPlan.ctl.sched.assignments.find((a) => a.task === 2 && a.actualCost === 300) !== undefined), true);
  await page.keyboard.press('Control+z');
  await settle();
  await editCell(2, 'resources', 'Ana; Cemento[4]');
  await editCell(2, 'type', 'Unidades fijas');
});

await check('split a task: two bar segments with a gap, then remove the split', async () => {
  await cell(0, 'name').click();
  await tab('Tarea');
  await press('Dividir tarea…');
  await dialog().getByLabel('Interrumpir el').fill('04/03/2025 12:00');
  await dialog().getByLabel('Reanudar el').fill('10/03/2025 08:00');
  await closeDialog();
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks[0].splits.length), 1);
  assert.equal(await page.locator('.pl-bar[data-row="0"]').getAttribute('data-split'), '2');
  assert.equal(await page.locator('.pl-bar[data-row="0"] .pl-body').count(), 2);
  await shot('split');
  await press('Quitar divisiones');
  assert.equal(await page.locator('.pl-bar[data-row="0"]').getAttribute('data-split'), null);
  // a split point outside the task is refused
  await press('Dividir tarea…');
  await dialog().getByLabel('Interrumpir el').fill('01/01/2030 12:00');
  await dialog().getByLabel('Reanudar el').fill('02/01/2030 08:00');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /dentro de la tarea/);
  await closeDialog('Cancelar');
});

await check('manual scheduling: dashed bar, links do not move it, automatic brings it back', async () => {
  await cell(1, 'name').click();
  await press('Programar manualmente');
  assert.ok(await page.locator('.pl-bar.is-manual[data-row="1"]').count());
  await editCell(1, 'start', '24/03/2025 08:00');
  assert.equal(await text(1, 'start'), '24/03/2025 08:00');
  assert.equal(await text(1, 'predecessors'), '1');
  await shot('manual');
  await press('Programar automáticamente');
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks[1].manual), false);
  assert.equal(await text(1, 'start'), '05/03/2025 08:00');
});

await check('baselines: save several, compare against the chosen one, variance columns, partial save, clear', async () => {
  await tab('Proyecto');
  await press('Líneas base…');
  const row = (i) => dialog().locator(`tr[data-baseline="${i}"]`);
  await row(0).getByRole('button', { name: 'Guardar Línea base', exact: true }).click();
  await row(2).getByRole('button', { name: 'Guardar Línea base 2', exact: true }).click();
  assert.equal(await ev(() => window.__novaPlan.ctl.project.baselines.filter(Boolean).length), 2);
  assert.match(await row(2).innerText(), /\d{2}\/\d{2}\/\d{4}/);
  await closeDialog('Cerrar');
  assert.ok((await page.locator('.pl-baseline').count()) >= 4);
  await editCell(0, 'duration', '5');
  await ctlEval((ctl) => ctl.setBaselineShown(2));
  assert.equal(await ev(() => window.__novaPlan.ctl.baselineShown), 2);
  // only the selected task is saved over baseline 2
  await cell(0, 'name').click();
  await press('Líneas base…');
  await row(2).getByRole('button', { name: /Guardar las tareas seleccionadas en Línea base 2/ }).click();
  const n = await ev(() => Object.keys(window.__novaPlan.ctl.project.baselines[2].tasks).length);
  assert.ok(n >= 5, `partial save keeps the other tasks (${n})`);
  await row(2).getByRole('button', { name: 'Borrar Línea base 2', exact: true }).click();
  await row(0).getByRole('button', { name: 'Borrar Línea base', exact: true }).click();
  assert.equal(await ev(() => window.__novaPlan.ctl.project.baselines.filter(Boolean).length), 0);
  await closeDialog('Cerrar');
  assert.equal(await page.locator('.pl-baseline').count(), 0);
  await editCell(0, 'duration', '2');
  await tab('Tarea');
});

await check('status date line and today line are drawn', async () => {
  await tab('Proyecto');
  await press('Fecha de estado: hoy');
  await tab('Vista');
  assert.equal(await page.locator('[data-testid="status"]').count(), 1);
  await press('Ir a hoy');
  await tab('Tarea');
});

await check('filters: built-in from the ribbon, a custom one from the dialog', async () => {
  const rows = () => page.locator('.pl-tr').count();
  const all = await rows();
  await tab('Vista');
  await press('Filtro');
  await menu('Tareas críticas');
  assert.ok((await rows()) < all);
  await press('Filtro');
  await menu('Todas las tareas');
  assert.equal(await rows(), all);
  await press('Filtro');
  await menu('Filtros…');
  await dialog().getByRole('button', { name: 'Nuevo filtro' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('Con obra');
  await dialog().getByLabel('Valor 1').fill('obra');
  await dialog().getByLabel('Valor 1').blur();
  await closeDialog();
  assert.equal(await rows(), 1);
  assert.equal(await ev(() => window.__novaPlan.ctl.project.filters.length), 1);
  await shot('filter');
  await press('Filtro');
  await menu('Todas las tareas');
  assert.equal(await rows(), all);
  await tab('Tarea');
});

await check('groups: group by resource, headings with totals, collapse, ungroup', async () => {
  await tab('Vista');
  await press('Agrupar');
  await menu('Agrupaciones…');
  await dialog().getByRole('button', { name: 'Nueva agrupación' }).click();
  await closeDialog();
  assert.ok((await page.locator('.pl-group').count()) >= 2);
  assert.match(await page.locator('.pl-group').first().innerText(), /tarea/);
  await shot('grouped');
  await page.locator('.pl-group .pl-fold').first().click();
  await press('Agrupar');
  await menu('Sin agrupar');
  assert.equal(await page.locator('.pl-group').count(), 0);
  await tab('Tarea');
});

await check('custom fields: a formula column is calculated and bad formulas are refused', async () => {
  await tab('Proyecto');
  await press('Campos personalizados…');
  await dialog().getByRole('button', { name: 'Nuevo campo' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('Doble');
  await dialog().getByLabel('Tipo', { exact: true }).selectOption('number');
  await dialog().getByLabel('Fórmula (opcional)').fill('[Duración] * (');
  assert.match(await dialog().getByRole('status').innerText(), /paréntesis|incompleta|no es válida/);
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  assert.ok(await dialog().getByRole('alert').count());
  await dialog().getByLabel('Fórmula (opcional)').fill('[Duración] * 2');
  assert.match(await dialog().getByRole('status').innerText(), /válida/);
  await closeDialog();
  await tab('Vista');
  await press('Columnas de la tabla…');
  await dialog().getByLabel('Añadir columna').selectOption({ label: 'Doble' });
  await closeDialog();
  await tab('Tarea');
  const col = await ev(() => window.__novaPlan.ctl.columns.at(-1));
  assert.match(col, /^custom:/);
  assert.equal(await text(2, col), '10');
  // a plain custom field is editable in the cell and in the task dialog
  await tab('Proyecto');
  await press('Campos personalizados…');
  await dialog().getByRole('button', { name: 'Nuevo campo' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('Responsable');
  await closeDialog();
  await cell(0, 'name').click();
  await page.keyboard.press('Shift+F2');
  await dialog().getByRole('tab', { name: 'Campos personalizados' }).click();
  await dialog().getByLabel('Responsable').fill('Marta');
  await closeDialog();
  const id = await ev(() => window.__novaPlan.ctl.project.customFields.find((c) => c.name === 'Responsable').id);
  assert.equal(await ev((id) => window.__novaPlan.ctl.project.tasks[0].custom[id], id), 'Marta');
  await shot('custom-fields');
});

await check('network diagram (PERT): a box per task, critical path in red, click selects', async () => {
  await tab('Tarea');
  await press('Diagrama de red (PERT)');
  const n = await ev(() => window.__novaPlan.ctl.project.tasks.length);
  assert.equal(await page.locator('.pl-netnode').count(), n);
  assert.ok((await page.locator('.pl-netedge.is-critical').count()) >= 1);
  const tid = await ev(() => window.__novaPlan.ctl.project.tasks[2].id);
  await page.locator(`.pl-netnode[data-task-id="${tid}"]`).click();
  assert.equal(await ev(() => window.__novaPlan.ctl.active), 2);
  await shot('network');
  await press('Diagrama de Gantt');
});

await check('visual reports with charts: overview, cost, work, resources, earned value and burndown', async () => {
  // earned value needs a baseline
  await ctlEval((ctl) => ctl.saveBaseline(0));
  await tab('Proyecto');
  for (const [item, title] of [['Resumen del proyecto', 'Resumen del proyecto'], ['Costos', 'Costos'], ['Trabajo', 'Trabajo'], ['Recursos', 'Recursos'], ['Valor ganado', 'Valor ganado'], ['Trabajo restante (burndown)', 'Trabajo restante']]) {
    await press('Informes visuales');
    await menu(item);
    await page.locator('.pl-reporth').waitFor();
    assert.match(await page.locator('.pl-reporth').innerText(), new RegExp(title));
    assert.ok((await page.locator('.pl-kpi').count()) >= 2, `${item}: KPIs`);
    const charts = await page.locator('.pl-chartbox').count();
    assert.ok(charts >= 1, `${item}: charts`);
    assert.ok((await page.locator('.pl-chartbox canvas').first().evaluate((c) => c.width * c.height)) > 1000, `${item}: canvas drawn`);
    await shot(`report-${title.slice(0, 8).replace(/\W/g, '')}`);
  }
  await tab('Tarea');
  await press('Diagrama de Gantt');
});

await check('subprojects: insert a saved project as a summary task and refresh it', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const file = path.join(tmp, 'sub.novaplan');
  await dl.saveAs(file);
  const before = await ev(() => window.__novaPlan.ctl.project.tasks.length);
  await ev(() => window.__novaPlan.ctl.reset());
  await ctlEval((ctl) => ctl.add({ name: 'Fase previa', duration: 480 }));
  await tab('Proyecto');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press('Insertar subproyecto…')]);
  await chooser.setFiles(file);
  await page.waitForFunction((n) => window.__novaPlan.ctl.project.tasks.length === n + 2, before);
  const t = await ev(() => window.__novaPlan.ctl.project.tasks.map((x) => [x.name, x.outline]));
  assert.equal(t[1][1], 1);
  assert.ok(t.slice(2).every((x) => x[1] >= 2), 'inserted tasks are indented under the subproject');
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks[1].subproject.name.length > 0), true);
  assert.equal(await ev(() => window.__novaPlan.ctl.sched.tasks[1].summary), true);
  await tab('Tarea');
  await shot('subproject');
});

await check('save as .novaplan and reopen it identical; damaged and .mpp files are refused', async () => {
  const sig = () => ev(() => JSON.stringify(window.__novaPlan.ctl.sched.tasks.map((t) => [t.wbs, t.start, t.finish, t.cost])) + window.__novaPlan.ctl.project.name);
  const before = await sig();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  assert.match(dl.suggestedFilename(), /\.novaplan$/);
  JSON.parse(fs.readFileSync(file, 'utf8'));
  await ev(() => window.__novaPlan.ctl.reset());
  assert.equal((await names()).length, 0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaPlan.ctl.project.tasks.length > 0);
  assert.equal(await sig(), before);
  assert.equal(await ev(() => window.__novaPlan.ctl.dirty), false);
  const bad = path.join(tmp, 'roto.novaplan');
  fs.writeFileSync(bad, '{"format":"novaplan","tasks":');
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await c2.setFiles(bad);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /no es un proyecto/);
  const mpp = path.join(tmp, 'plan.mpp');
  fs.writeFileSync(mpp, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const [c3] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await c3.setFiles(mpp);
  await page.waitForTimeout(300);
  assert.match(dialogs.pop() ?? '', /\.mpp.*XML/);
  assert.equal(await sig(), before);
});

await check('export to Microsoft Project XML and import it back with the same schedule', async () => {
  const sig = () => ev(() => JSON.stringify(window.__novaPlan.ctl.sched.tasks.map((t) => [t.wbs, t.start, t.finish, t.duration])));
  const before = await sig();
  const res = await ev(() => window.__novaPlan.ctl.project.resources.length);
  await tab('Proyecto');
  await press('Exportar');
  const [dl] = await Promise.all([page.waitForEvent('download'), menu('Exportar a Microsoft Project (XML)…')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  const xml = fs.readFileSync(file, 'utf8');
  assert.match(xml, /<Project xmlns="http:\/\/schemas\.microsoft\.com\/project">/);
  assert.match(xml, /<PredecessorLink>/);
  assert.match(xml, /<Baseline>|<Calendars>/);
  await ev(() => window.__novaPlan.ctl.reset());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), press('Importar de Microsoft Project (XML)…')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaPlan.ctl.project.tasks.length > 0);
  assert.equal(await sig(), before);
  assert.equal(await ev(() => window.__novaPlan.ctl.project.resources.length), res);
  assert.equal(await ev(() => window.__novaPlan.ctl.dirty), true);
  await tab('Tarea');
});

await check('a Project XML written by another tool: 6-hour days, SS link with lag, holiday', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Name>Externo</Name><StartDate>2025-03-03T08:00:00</StartDate>
<MinutesPerDay>360</MinutesPerDay><CalendarUID>1</CalendarUID>
<Calendars><Calendar><UID>1</UID><Name>Std</Name><WeekDays>
<WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay><WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay></WeekDays>
<Exceptions><Exception><Name>Fiesta</Name><TimePeriod><FromDate>2025-03-06T00:00:00</FromDate><ToDate>2025-03-06T23:59:00</ToDate></TimePeriod><DayWorking>0</DayWorking></Exception></Exceptions></Calendar></Calendars>
<Tasks><Task><UID>0</UID><ID>0</ID><Name>Externo</Name><OutlineLevel>0</OutlineLevel></Task>
<Task><UID>1</UID><ID>1</ID><Name>Fase</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task>
<Task><UID>2</UID><ID>2</ID><Name>Uno</Name><OutlineLevel>2</OutlineLevel><Duration>PT24H0M0S</Duration></Task>
<Task><UID>3</UID><ID>3</ID><Name>Dos</Name><OutlineLevel>2</OutlineLevel><Duration>PT12H0M0S</Duration><PredecessorLink><PredecessorUID>2</PredecessorUID><Type>3</Type><LinkLag>3600</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
<Task><UID>4</UID><ID>4</ID><Name>Hito</Name><OutlineLevel>1</OutlineLevel><Duration>PT0H0M0S</Duration><Milestone>1</Milestone><PredecessorLink><PredecessorUID>3</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink></Task>
</Tasks></Project>`;
  const file = path.join(tmp, 'externo.xml');
  fs.writeFileSync(file, xml);
  await ev(() => window.__novaPlan.ctl.reset());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaPlan.ctl.project.name === 'Externo');
  assert.deepEqual(await names(), ['Fase', 'Uno', 'Dos', 'Hito']);
  assert.equal(await ev(() => window.__novaPlan.ctl.project.minutesPerDay), 360);
  assert.equal(await text(1, 'duration'), '4d');
  assert.equal(await text(2, 'duration'), '2d');
  assert.equal(await text(2, 'predecessors'), '2SS+1d');
  assert.equal((await text(1, 'start')).slice(0, 10), '03/03/2025');
  assert.match(await text(2, 'start'), /^03\/03\/2025 1\d:/); // one 6-hour day after the start of Uno, in minutes
  assert.equal(await ev(() => window.__novaPlan.ctl.dirty), true, 'imported projects are unsaved');
  await shot('imported');
});

await check('export CSV opens in a spreadsheet: BOM, separators and quoting', async () => {
  await tab('Proyecto');
  await press('Exportar');
  const [dl] = await Promise.all([page.waitForEvent('download'), menu('Exportar a CSV…')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.charCodeAt(0), 0xfeff);
  const lines = raw.slice(1).trim().split('\r\n');
  assert.match(lines[0], /^EDT;Nombre;Duración/);
  assert.equal(lines.length, 5);
  await tab('Tarea');
});

await check('print builds a page with the table (chosen columns) and the chart', async () => {
  await tab('Proyecto');
  await press('Exportar');
  await page.getByRole('menuitem', { name: 'Imprimir / PDF Ctrl+P', exact: true }).click();
  await page.waitForSelector('iframe[srcdoc]', { state: 'attached' });
  const html = await page.locator('iframe[srcdoc]').getAttribute('srcdoc');
  assert.match(html, /<h1>Externo<\/h1>/);
  assert.match(html, /Uno/);
  assert.match(html, /<svg/);
  assert.match(html, /<th>Trabajo<\/th>|<th>Predecesoras<\/th>/);
  await tab('Tarea');
});

await check('as late as possible: chosen in the task form, the task slides to the end of the project', async () => {
  await ev(() => window.__novaPlan.ctl.reset());
  await ctlEval((ctl) => {
    ctl.add({ name: 'Larga', duration: 5 * 480 });
    ctl.add({ name: 'Corta', duration: 480 });
  });
  const early = await ev(() => window.__novaPlan.ctl.sched.tasks[1].start);
  await tab('Tarea');
  await cell(1, 'name').click();
  await page.keyboard.press('Shift+F2');
  await dialog().getByRole('tab', { name: 'Avanzado' }).click();
  await dialog().getByLabel('Restricción', { exact: true }).selectOption('alap');
  assert.equal(await dialog().getByLabel('Fecha de la restricción').isDisabled(), true);
  await closeDialog();
  const s = await ev(() => window.__novaPlan.ctl.sched.tasks.map((t) => [t.start, t.finish]));
  assert.equal(s[1][1], s[0][1], 'both finish together');
  assert.ok(s[1][0] > early, 'it starts later than before');
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks[1].constraint.type), 'alap');
});

await check('resource leveling: priority in the form, level from the Resource tab, clear it again', async () => {
  await ev(() => window.__novaPlan.ctl.reset());
  await ctlEval((ctl) => {
    ctl.add({ name: 'Uno', duration: 2 * 480 });
    ctl.add({ name: 'Dos', duration: 2 * 480 });
    ctl.commit({ ...ctl.project, resources: [{ id: 'rl1', name: 'Luis', type: 'work', maxUnits: 1, rate: 10, costPerUse: 0, calendar: null, group: '', email: '', custom: {} }] });
    ctl.assign(ctl.project.tasks[0].id, 'rl1');
    ctl.assign(ctl.project.tasks[1].id, 'rl1');
  });
  await page.waitForFunction(() => window.__novaPlan.ctl.sched.overallocations.length > 0);
  // the second task is less important
  await cell(1, 'name').click();
  await page.keyboard.press('Shift+F2');
  await dialog().getByRole('tab', { name: 'Avanzado' }).click();
  await dialog().getByLabel(/^Prioridad/).fill('200');
  await closeDialog();
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks[1].priority), 200);
  await tab('Recurso');
  await press('Nivelar recursos…');
  assert.match(await dialog().innerText(), /Recursos sobreasignados: 1/);
  await shot('level-dialog');
  await closeDialog();
  await page.waitForFunction(() => window.__novaPlan.ctl.sched.overallocations.length === 0);
  assert.match(await status(), /Nivelación hecha: 1 tareas con retraso/);
  const d = await ev(() => window.__novaPlan.ctl.project.tasks.map((t) => t.levelDelay ?? 0));
  assert.equal(d[0], 0);
  assert.ok(d[1] > 0, 'the less important task is the one delayed');
  const sch = await ev(() => window.__novaPlan.ctl.sched.tasks.map((t) => [t.start, t.finish]));
  assert.ok(sch[1][0] >= sch[0][1]);
  await press('Borrar nivelación');
  await page.waitForFunction(() => window.__novaPlan.ctl.sched.overallocations.length > 0);
  assert.equal(await ev(() => window.__novaPlan.ctl.project.tasks.every((t) => !t.levelDelay)), true);
  await tab('Tarea');
});

await check('project options: scheduling choices and time zone (an unknown zone is refused)', async () => {
  await tab('Proyecto');
  await press('Información del proyecto…');
  await dialog().getByLabel(/La tarea espera a los calendarios/).check();
  await dialog().getByLabel(/Un «día» de una tarea/).check();
  await dialog().getByLabel(/Valor ganado según el reparto/).check();
  await dialog().getByLabel(/Zona horaria/).fill('Marte/Olimpo');
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  assert.match(await dialog().getByRole('alert').innerText(), /zona horaria no existe/);
  await dialog().getByLabel(/Zona horaria/).fill('Europe/Madrid');
  await shot('project-options');
  await closeDialog();
  const p = await ev(() => {
    const q = window.__novaPlan.ctl.project;
    return [q.resourceCalendars, q.taskCalendarDays, q.weightedEarnedValue, q.timeZone];
  });
  assert.deepEqual(p, [true, true, true, 'Europe/Madrid']);
  await tab('Tarea');
});

await check('a cost resource is chosen in the resource sheet and its units are money', async () => {
  await tab('Recurso');
  await press('Recurso nuevo');
  await page.getByRole('table', { name: 'Hoja de recursos' }).waitFor();
  const name = await ev(() => window.__novaPlan.ctl.project.resources[window.__novaPlan.ctl.project.resources.length - 1].name);
  await page.getByLabel(`Tipo, ${name}`).selectOption('cost');
  assert.equal(await ev(() => window.__novaPlan.ctl.project.resources.at(-1).type), 'cost');
  assert.equal(await page.getByLabel(`Unidades máx. (%), ${name}`).isDisabled(), true);
  await ctlEval((ctl) => {
    const r = ctl.project.resources.at(-1);
    ctl.commit({ ...ctl.project, resources: ctl.project.resources.map((x) => (x.id === r.id ? { ...x, rate: 1 } : x)) });
    ctl.assign(ctl.project.tasks[0].id, r.id, 250);
  });
  assert.equal(await ev(() => window.__novaPlan.ctl.sched.tasks[0].cost), 2 * 8 * 10 + 250);
  await tab('Tarea');
  await press('Diagrama de Gantt').catch(() => undefined);
});

await check('reports are exported as HTML (with charts) and CSV, and the extended Project XML carries custom fields', async () => {
  await tab('Proyecto');
  await press('Informes visuales');
  await menu('Costos');
  await page.locator('.pl-reporth').waitFor();
  await press('Exportar');
  const [h] = await Promise.all([page.waitForEvent('download'), menu('Exportar el informe a HTML…')]);
  const hf = path.join(tmp, h.suggestedFilename());
  await h.saveAs(hf);
  assert.match(h.suggestedFilename(), /\.html$/);
  const html = fs.readFileSync(hf, 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok((html.match(/<svg/g) ?? []).length >= 1, 'charts as SVG');
  assert.match(html, /Costos/);
  await press('Exportar');
  const [c] = await Promise.all([page.waitForEvent('download'), menu('Exportar el informe a CSV…')]);
  const cf = path.join(tmp, c.suggestedFilename());
  await c.saveAs(cf);
  const raw = fs.readFileSync(cf, 'utf8');
  assert.equal(raw.charCodeAt(0), 0xfeff);
  assert.match(raw, /Costos/);
  // extended Project XML
  await ctlEval((ctl) => {
    ctl.commit({ ...ctl.project, customFields: [{ id: 'cfx', name: 'Zona obra', target: 'task', type: 'text' }], tasks: ctl.project.tasks.map((t, i) => (i === 0 ? { ...t, custom: { cfx: 'Norte' } } : t)) });
  });
  await press('Exportar');
  const [x] = await Promise.all([page.waitForEvent('download'), menu('Exportar a Project XML con campos extendidos (experimental)…')]);
  const xf = path.join(tmp, 'ext.xml');
  await x.saveAs(xf);
  const xml = fs.readFileSync(xf, 'utf8');
  assert.match(xml, /<Alias>Zona obra<\/Alias>/);
  assert.match(xml, /<Value>Norte<\/Value>/);
  await tab('Tarea');
  await ev(() => window.__novaPlan.ctl.setView('gantt'));
});

await check('a thousand tasks stay responsive', async () => {
  await ev(() => {
    const { ctl } = window.__novaPlan;
    ctl.reset();
    ctl.add({ name: 'x', duration: 480 });
    const tpl = ctl.project.tasks[0];
    const tasks = [];
    for (let i = 0; i < 1000; i++) tasks.push({ ...tpl, id: `p${i}`, name: `Tarea ${i + 1}`, outline: i % 50 === 0 ? 1 : 2, duration: (1 + (i % 5)) * 480, links: i % 50 === 0 || i % 50 === 1 ? [] : [{ task: `p${i - 1}`, type: 'FS', lag: 0 }] });
    ctl.commit({ ...ctl.project, tasks });
  });
  const t0 = Date.now();
  await ev(() => window.__novaPlan.ctl.select(500));
  await page.waitForSelector('.pl-tr.is-active');
  assert.ok(Date.now() - t0 < 3000, `select took ${Date.now() - t0} ms`);
  const t1 = Date.now();
  await ev(() => window.__novaPlan.ctl.setAllCollapsed(true));
  await page.waitForFunction(() => document.querySelectorAll('.pl-tr').length === 20);
  assert.ok(Date.now() - t1 < 3000, 'collapse');
  await ev(() => window.__novaPlan.ctl.setAllCollapsed(false));
  const drawn = await page.locator('.pl-tr').count();
  assert.ok(drawn > 10 && drawn < 120, `only the visible rows are drawn (${drawn})`);
  assert.equal(await ev(() => window.__novaPlan.ctl.visibleRows().length), 1000);
  await page.locator('.pl-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.getByRole('gridcell', { name: 'Nombre de la tarea, fila 1000', exact: true }).waitFor();
  assert.ok((await page.locator('.pl-bar').count()) < 120);
  assert.ok((await page.locator('svg.pl-svg *').count()) < 4000, 'svg stays small');
  // the other views cope with it too
  const t2 = Date.now();
  await ev(() => window.__novaPlan.ctl.setView('network'));
  await page.locator('.pl-netnode').first().waitFor();
  await ev(() => window.__novaPlan.ctl.setView('taskUsage'));
  await page.getByRole('table', { name: 'Uso de tareas' }).waitFor();
  await ev(() => window.__novaPlan.ctl.setView('gantt'));
  assert.ok(Date.now() - t2 < 15000, `views took ${Date.now() - t2} ms`);
});

await shot('final');
await browser.close();

const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of results) console.log(r[0].padEnd(4), r[1], r[2] ? `\n     ${r[2]}` : '');
if (errors.length) console.log('\nconsole errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length || errors.length ? 1 : 0);
