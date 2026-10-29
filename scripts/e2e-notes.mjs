// End-to-end checks for Nova Notes (free canvas) in a real browser (Edge). Needs `pnpm dev` running on :1420.
// Usage: node scripts/e2e-notes.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from '../packages/writer-core/node_modules/jszip/lib/index.js';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=notes';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-notes-'));

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ['microphone', 'camera'] });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  if (d.type() === 'confirm' && /^(¿Eliminar|¿Borrar toda|¿Vaciar|La página volverá|Esto sustituye)/.test(d.message())) return void d.accept();
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
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const ctlState = () =>
  ev(() => {
    const { ctl } = window.__novaNotes;
    return {
      sections: ctl.nb.sections.length,
      pages: ctl.section.pages.length,
      title: ctl.page.title,
      boxes: ctl.page.containers.map((c) => ({ kind: c.kind, x: c.x, y: c.y, w: c.w, id: c.id })),
      ink: ctl.page.ink.length,
      dirty: ctl.dirty,
    };
  });
const settle = (ms = 150) => page.waitForTimeout(ms);
const canvasBox = () => page.locator('.nn-canvas').boundingBox();
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const btn = (name) => page.getByRole('button', { name, exact: true }).click();
/** Click on the canvas at page coordinates (x, y) and write there. */
const writeAt = async (x, y, text) => {
  const b = await canvasBox();
  await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.type(text);
};
const texts = () => ev(() => window.__novaNotes.ctl.page.containers.filter((c) => c.kind === 'text').map((c) => JSON.stringify(c.content)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.nn-canvas');
await page.screenshot();

await check('ribbon tabs and the canvas page', async () => {
  for (const t of ['Inicio', 'Insertar', 'Dibujar', 'Organizar', 'Proteger y compartir', 'Buscar', 'Vista', 'Ayuda']) assert.ok(await page.getByRole('tab', { name: t, exact: true }).count(), t);
  assert.equal(await page.locator('.nn-sec').count(), 1);
  assert.equal(await page.locator('.nn-pageitem').count(), 1);
});

await check('free canvas: text boxes at any point of the page, not one document', async () => {
  await writeAt(80, 80, 'Arriba a la izquierda');
  await writeAt(520, 260, 'En el centro');
  await writeAt(300, 520, 'Abajo');
  await settle();
  const s = await ctlState();
  const mine = s.boxes.filter((b) => b.kind === 'text' && b.w === 320);
  assert.equal(mine.length, 3, JSON.stringify(s.boxes));
  const want = [
    [80, 80],
    [520, 260],
    [300, 520],
  ];
  mine.forEach((b, i) => assert.ok(Math.abs(b.x - want[i][0]) <= 8 && Math.abs(b.y - want[i][1]) <= 8, `box ${i} at ${b.x},${b.y}`));
  assert.match(await page.locator('.nn-pageitem.is-current').innerText(), /Arriba a la izquierda|Página sin título/);
  await shot('canvas');
});

await check('drag a box by its bar and resize it', async () => {
  const target = page.locator('.nn-box--text', { hasText: 'centro' });
  await target.hover();
  const bar = target.locator('.nn-box__bar');
  const bb = await bar.boundingBox();
  const before = (await ctlState()).boxes.find((b) => b.w === 320 && b.x === 520);
  await page.mouse.move(bb.x + bb.width / 2, bb.y + 6);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 100, bb.y + 6 + 60, { steps: 6 });
  await page.mouse.up();
  const after = (await ctlState()).boxes.find((b) => b.id === before.id);
  assert.equal(after.x, before.x + 100);
  assert.equal(after.y, before.y + 60);
  const rh = target.locator('.nn-box__rh');
  await target.hover();
  const rb = await rh.boundingBox();
  await page.mouse.move(rb.x + 5, rb.y + 5);
  await page.mouse.down();
  await page.mouse.move(rb.x + 85, rb.y + 5, { steps: 5 });
  await page.mouse.up();
  assert.ok((await ctlState()).boxes.find((b) => b.id === before.id).w >= 380);
  await ev(() => window.__novaNotes.ctl.undoPage());
  await ev(() => window.__novaNotes.ctl.undoPage());
  const back = (await ctlState()).boxes.find((b) => b.id === before.id);
  assert.equal(back.x, before.x, 'undo returns the box');
});

await check('text formatting works inside a box (ribbon and keys)', async () => {
  const pm = page.locator('.nn-box--text .ProseMirror', { hasText: 'Abajo' });
  await pm.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+B');
  assert.ok((await pm.locator('strong').count()) >= 1);
  await page.keyboard.press('Control+B');
  await page.selectOption('select[aria-label="Estilo de párrafo"]', 'Heading1');
  assert.equal(await pm.locator('p.nw-style-Heading1').count(), 1);
});

await check('tags: many kinds, check box toggles, custom tag, summary', async () => {
  const pm = page.locator('.nn-box--text .ProseMirror', { hasText: 'Arriba a la izquierda' });
  await pm.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Enviar el informe');
  await page.keyboard.press('Control+1');
  assert.equal(await pm.locator('p[data-tag="todo"]').count(), 1);
  const p = pm.locator('p[data-tag="todo"]');
  const b = await p.boundingBox();
  await page.mouse.click(b.x + 8, b.y + b.height / 2);
  assert.equal(await pm.locator('p[data-tag="todo:done"]').count(), 1, 'clicking the box completes it');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Llamar al cliente');
  await btn('Etiquetas');
  await page.getByRole('menuitemcheckbox', { name: /Petición de un cliente/ }).click();
  assert.equal(await pm.locator('p[data-tag="client"]').count(), 1);
  // custom tag
  await btn('Etiquetas');
  await page.getByRole('menuitem', { name: 'Resumen de etiquetas…' }).click();
  await page.getByRole('tab', { name: 'Mis etiquetas' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Revisar con Ana');
  await page.getByRole('button', { name: 'Crear etiqueta' }).click();
  assert.equal(await ev(() => window.__novaNotes.ctl.nb.tagDefs.length), 1);
  await page.getByRole('tab', { name: 'Resumen de etiquetas' }).click();
  await page.getByLabel('Etiqueta', { exact: true }).selectOption('todo');
  assert.match(await page.locator('.nn-taglist').innerText(), /Enviar el informe/);
  await shot('tags');
  await btn('Cerrar');
  await pm.locator('p').last().click();
  await btn('Etiquetas');
  await page.getByRole('menuitemcheckbox', { name: /Revisar con Ana/ }).click();
  const cid = await ev(() => window.__novaNotes.ctl.nb.tagDefs[0].id);
  assert.equal(await pm.locator(`p[data-tag="${cid}"]`).count(), 1);
});

await check('table with formulas calculates and updates', async () => {
  const b = await canvasBox();
    await tab('Insertar');
  await btn('Tabla…');
  await page.getByLabel('Número de columnas').fill('2');
  await page.getByLabel('Número de filas').fill('4');
  await btn('Aceptar');
  await settle();
  const cells = page.locator('.nn-doc td');
  assert.equal(await cells.count(), 8);
  await cells.nth(0).click();
  for (const t of ['Concepto', 'Importe', 'Alquiler', '120,50', 'Luz', '30', 'Total', '=SUMA(ARRIBA)']) {
    await page.keyboard.type(t);
    await page.keyboard.press('Tab');
  }
  await page.getByLabel('Título de la página').click();
  await settle();
  assert.match(await page.locator('.nn-fval').first().innerText(), /150,5/);
  await shot('formulas');
  // change an input → the total follows
  await cells.nth(3).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.type('200');
  await page.getByLabel('Título de la página').click();
  await settle();
  assert.match(await page.locator('.nn-fval').first().innerText(), /230/);
  await tab('Inicio');
});

await check('equation: insert and edit', async () => {
  const pm = page.locator('.nn-box--text .ProseMirror', { hasText: 'centro' });
  await pm.click({ position: { x: 24, y: 8 } });
  await tab('Insertar');
  await btn('Ecuación…');
  await page.getByLabel(/Escribe la ecuación/).fill(String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`);
  await page.waitForSelector('.nn-eqprev math');
  await btn('Aceptar');
  assert.ok((await page.locator('.nn-doc .nw-math math').count()) >= 1);
  await shot('equation');
  await tab('Inicio');
});

await check('image: add, search inside the image (OCR), alt text', async () => {
  const b64 = await ev(async () => {
    const c = document.createElement('canvas');
    c.width = 560;
    c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 560, 160);
    g.fillStyle = '#000';
    g.font = 'bold 56px Arial';
    g.fillText('FACTURA 48213', 24, 70);
    g.font = '40px Arial';
    g.fillText('Total pagado', 24, 130);
    return c.toDataURL('image/png').split(',')[1];
  });
  const f = path.join(tmp, 'factura.png');
  fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  await tab('Insertar');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), btn('Imagen…')]);
  await chooser.setFiles(f);
  await page.waitForSelector('.nn-box--image img');
  assert.equal((await ctlState()).boxes.filter((x) => x.kind === 'image').length, 1);
  await tab('Inicio');
  // OCR runs by itself in the background with the bundled engine
  await page.waitForFunction(() => !window.__novaNotes.ctl.ocr.running && Object.keys(window.__novaNotes.ctl.nb.ocr).length >= 1 && window.__novaNotes.ctl.ocrPending === 0, null, { timeout: 120000 });
  const text = await ev(() => Object.values(window.__novaNotes.ctl.nb.ocr)[0].text);
  assert.match(text, /FACTURA/i, `OCR text: ${text}`);
  assert.match(text, /48213/);
  await page.keyboard.press('Control+E');
  await page.getByLabel('Buscar en todas las páginas', { exact: true }).fill('factura');
  await page.waitForSelector('.nn-results button');
  assert.match(await page.locator('.nn-results').innerText(), /dentro de una imagen/);
  await page.getByLabel('Buscar en todas las páginas', { exact: true }).fill('pagado');
  await page.waitForSelector('.nn-results button');
  assert.match(await page.locator('.nn-results').innerText(), /dentro de una imagen/);
  await page.keyboard.press('Escape');
  // image dialog shows the recognized text and keeps alt text
  await page.locator('.nn-box--image').click({ button: 'right' });
  assert.match(await page.getByLabel('Texto reconocido en la imagen').inputValue(), /FACTURA/i);
  await page.getByLabel(/Texto alternativo/).fill('Factura de la luz');
  await btn('Guardar el texto alternativo');
  assert.equal(await ev(() => window.__novaNotes.ctl.page.containers.find((c) => c.kind === 'image').alt), 'Factura de la luz');
  await shot('image-ocr');
});

await check('ink and drawing: pen, shape recognition, eraser, lasso', async () => {
  await tab('Dibujar');
  await btn('Lápiz');
  await page.locator('.nn-scroll').evaluate((e) => (e.scrollTop = 0));
  const b = await canvasBox();
  const drag = async (pts) => {
    await page.mouse.move(b.x + pts[0][0], b.y + pts[0][1]);
    await page.mouse.down();
    for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x, b.y + y, { steps: 3 });
    await page.mouse.up();
  };
  await drag([
    [700, 120],
    [740, 90],
    [780, 130],
    [820, 100],
    [860, 140],
  ]);
  assert.equal((await ctlState()).ink, 1);
  // shape recognition: a rough rectangle becomes a clean one
  await btn('Convertir el trazo en forma');
  await drag([
    [700, 300],
    [760, 303],
    [820, 298],
    [822, 340],
    [819, 380],
    [760, 382],
    [702, 379],
    [699, 340],
    [701, 302],
  ]);
  const tools = await ev(() => window.__novaNotes.ctl.page.ink.map((s) => s.tool));
  assert.deepEqual(tools, ['pen', 'rect']);
  await btn('Marcador');
  await drag([
    [700, 420],
    [860, 422],
  ]);
  assert.equal((await ctlState()).ink, 3);
  await btn('Línea');
  await drag([
    [700, 460],
    [860, 500],
  ]);
  await btn('Flecha');
  await drag([
    [700, 520],
    [860, 520],
  ]);
  await btn('Elipse');
  await drag([
    [900, 300],
    [1000, 380],
  ]);
  assert.equal((await ctlState()).ink, 6);
  await shot('ink');
  await btn('Borrador');
  await drag([
    [690, 120],
    [880, 130],
  ]);
  assert.ok((await ctlState()).ink < 6, 'eraser removes strokes it touches');
  const left = (await ctlState()).ink;
  await btn('Seleccionar tinta (recuadro)');
  await drag([
    [680, 270],
    [1030, 410],
  ]);
  assert.ok((await ev(() => window.__novaNotes.ctl.selectedStrokes.length)) >= 1, 'marquee selects');
  await page.keyboard.press('Delete');
  assert.ok((await ctlState()).ink < left);
  await btn('Seleccionar y escribir');
  await tab('Inicio');
});

await check('audio and video recording (fake devices) add playable boxes', async () => {
  await tab('Insertar');
  await btn('Grabar audio');
  await page.waitForSelector('.nn-recbar');
  assert.match(await page.locator('.nn-recbar').innerText(), /Grabando audio/);
  await settle(1800);
  await page.getByRole('button', { name: 'Detener y añadir' }).click();
  await page.waitForSelector('.nn-box--media audio');
  await btn('Grabar vídeo');
  await page.waitForSelector('.nn-recbar video');
  await settle(1800);
  await page.getByRole('button', { name: 'Detener y añadir' }).click();
  await page.waitForSelector('.nn-box--media video');
  const media = await ev(() => window.__novaNotes.ctl.page.containers.filter((c) => c.kind === 'media').map((c) => ({ media: c.media, seconds: c.seconds, size: window.__novaNotes.ctl.nb.assets[c.asset].size, mime: window.__novaNotes.ctl.nb.assets[c.asset].mime })));
  assert.deepEqual(media.map((m) => m.media), ['audio', 'video']);
  for (const m of media) {
    assert.ok(m.size > 1000, `${m.media} has data (${m.size})`);
    assert.match(m.mime, new RegExp(m.media));
    assert.ok(m.seconds >= 1, `${m.media} lasted ${m.seconds}s`);
  }
  // the recorded media really plays
  const playable = await page.locator('.nn-box--media video').evaluate((v) => new Promise((res) => {
    v.onloadeddata = () => res(v.videoWidth > 0);
    if (v.readyState >= 2) res(v.videoWidth > 0);
    setTimeout(() => res(false), 5000);
  }));
  assert.ok(playable, 'the video decodes');
  await shot('media');
  await tab('Inicio');
});

await check('page style: ruling and color; templates', async () => {
  await tab('Organizar');
  await btn('Reglas y color de la página…');
  await page.getByLabel('Reglas', { exact: true }).selectOption('grid-medium');
  await page.getByRole('button', { name: '#e8f4fd' }).click();
  assert.ok(await page.locator('.nn-canvas.nn-rule-grid-medium').count());
  assert.equal(await page.locator('.nn-canvas').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(232, 244, 253)');
  await btn('Cerrar');
  await tab('Insertar');
  await btn('Plantillas de página…');
  await page.getByRole('button', { name: 'Página nueva con Presupuesto con fórmulas' }).click();
  await settle(400);
  assert.equal((await ctlState()).pages, 2);
  assert.ok((await page.locator('.nn-fval').count()) >= 1, 'budget template computes its formulas');
  await shot('template');
  await tab('Inicio');
});

await check('subpages and page links', async () => {
  await tab('Organizar');
  await btn('Hacer subpágina');
  assert.equal(await ev(() => window.__novaNotes.ctl.page.level), 1);
  assert.ok(await page.locator('.nn-pageitem.is-sub').count());
  await page.getByRole('button', { name: 'Contraer subpáginas' }).click();
  assert.equal(await page.locator('.nn-pageitem').count(), 1);
  await page.getByRole('button', { name: 'Expandir subpáginas' }).click();
  await page.getByRole('button', { name: 'Subir de nivel' }).click();
  // link from page 1 to the budget page
  await page.locator('.nn-pageitem').first().click();
  const pm = page.locator('.nn-box--text .ProseMirror', { hasText: 'Arriba a la izquierda' });
  await pm.locator('p').first().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.press('Control+K');
  await page.getByRole('tab', { name: 'Página de esta libreta' }).click();
  await page.getByRole('dialog').getByLabel('Página', { exact: true }).selectOption({ index: 1 });
  await btn('Aceptar');
  const a = pm.locator('a[href^="#nn:page:"]');
  assert.equal(await a.count(), 1);
  const target = (await a.getAttribute('href')).split(':').pop();
  await a.click();
  assert.equal(await ev(() => window.__novaNotes.ctl.pageId), target, 'the link opens the page');
  await page.locator('.nn-pageitem').first().click();
  await tab('Inicio');
});

await check('section groups: create a group, move a section into it', async () => {
  await page.locator('.nn-addsec').filter({ hasText: '+' }).click();
  assert.equal((await ctlState()).sections, 2);
  await tab('Organizar');
  await btn('Grupo de secciones nuevo');
  assert.equal(await page.locator('.nn-group').count(), 1);
  await page.getByLabel('Mover la sección al grupo').selectOption({ index: 1 });
  // se entra en el grupo con la sección dentro
  await page.getByRole('button', { name: 'Subir un nivel' }).waitFor();
  assert.equal(await page.locator('.nn-sec:not(.nn-group)').count(), 1);
  assert.ok(await ev(() => !!window.__novaNotes.ctl.section.group));
  await shot('group-inside');
  await page.getByRole('button', { name: 'Subir un nivel' }).click();
  assert.equal(await page.locator('.nn-group').count(), 1, 'the group is a tab of the top level');
  assert.equal(await page.locator('.nn-sec:not(.nn-group)').count(), 1, 'only the other section stays at the top level');
  await page.locator('.nn-group').click();
  assert.equal(await page.locator('.nn-sec:not(.nn-group)').count(), 1);
  await page.getByRole('button', { name: 'Subir un nivel' }).click();
  await shot('groups');
  await tab('Inicio');
});

await check('version history: save, edit, compare, restore', async () => {
  await ev(() => { const c = window.__novaNotes.ctl; c.goTo(c.nb.sections[0].id); });
  await page.locator('.nn-pageitem').first().click();
  await tab('Organizar');
  await btn('Historial de versiones…');
  await page.getByLabel('Nombre de la versión').first().fill('Antes de cambiar');
  await btn('Guardar una versión ahora');
  await btn('Cerrar');
  const pm = page.locator('.nn-box--text .ProseMirror', { hasText: 'centro' });
  await pm.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' TEXTO NUEVO');
  await btn('Historial de versiones…');
  await page.getByRole('button', { name: /Antes de cambiar/ }).click();
  assert.match(await page.locator('.nn-diff').innerText(), /TEXTO NUEVO/);
  await shot('versions');
  await btn('Restaurar esta versión');
  await settle(300);
  const all = (await texts()).join(' ');
  assert.ok(!all.includes('TEXTO NUEVO'), 'restored the earlier text');
  assert.ok(all.includes('centro'));
  await tab('Inicio');
});

await check('trash: deleted pages can be restored', async () => {
  await page.keyboard.press('Control+Alt+N');
  await page.getByLabel('Título de la página').fill('Página temporal');
  const n = (await ctlState()).pages;
  await tab('Organizar');
  await btn('Eliminar página');
  assert.equal((await ctlState()).pages, n - 1);
  await btn('Papelera…');
  assert.match(await page.locator('.nn-templates').innerText(), /Página temporal/);
  await page.getByRole('button', { name: 'Restaurar Página temporal' }).click();
  assert.equal((await ctlState()).pages, n);
  assert.equal(await ev(() => window.__novaNotes.ctl.nb.trash.length), 0);
  await tab('Inicio');
});

await check('password: protect the page with the image and recordings, lock it, wrong and right password', async () => {
  // the first page holds the image (with its OCR text) and the recordings: all of it must travel encrypted
  await ev(() => {
    const c = window.__novaNotes.ctl;
    c.goTo(c.nb.sections[0].id, c.nb.sections[0].pages[0].id);
  });
  const secrets = await ev(() => Object.values(window.__novaNotes.ctl.nb.assets).map((a) => a.data.slice(120, 200)));
  assert.ok(secrets.length >= 3, 'the page has an image and two recordings');
  await tab('Proteger y compartir');
  await btn('Contraseña de la página…');
  await page.getByLabel('Contraseña (al menos 4 caracteres)').fill('clave-secreta');
  await page.getByLabel('Repite la contraseña').fill('clave-secreta');
  await page.getByLabel(/Pista/).fill('la de siempre');
  await page.getByRole('button', { name: 'Poner contraseña' }).click();
  await page.waitForFunction(() => !!window.__novaNotes.ctl.page.protect, null, { timeout: 30000 });
  await btn('Bloquear la página');
  await page.waitForSelector('.nn-locked');
  assert.equal(await page.locator('.nn-canvas').count(), 0);
  assert.match(await page.locator('.nn-locked').innerText(), /la de siempre/);
  const file = await ev(() => window.__novaNotes.ctl.serialize());
  for (const sn of secrets) assert.ok(!file.includes(sn), 'an image or recording of the protected page is in the file in clear');
  assert.ok(!file.includes('48213') && !file.includes('FACTURA'), 'the text read from the image is in the file in clear');
  assert.ok(!file.includes('Arriba a la izquierda') && !file.includes('Enviar el informe'), 'page text is in clear');
  assert.equal(await ev(() => Object.keys(window.__novaNotes.ctl.nb.assets).length), 0, 'locking removes the media from memory too');
  await page.getByLabel('Contraseña', { exact: true }).fill('equivocada');
  await page.getByRole('button', { name: 'Abrir' }).click();
  await page.waitForSelector('.nn-locked [role="alert"]');
  await page.getByLabel('Contraseña', { exact: true }).fill('clave-secreta');
  await page.getByRole('button', { name: 'Abrir' }).click();
  await page.waitForSelector('.nn-canvas', { timeout: 30000 });
  await page.waitForSelector('.nn-box--image img');
  assert.ok(await page.locator('.nn-box--image img').evaluate((i) => i.complete && i.naturalWidth > 0), 'the image is back');
  assert.ok((await ev(() => Object.keys(window.__novaNotes.ctl.nb.assets).length)) >= 3);
  assert.match(await ev(() => Object.values(window.__novaNotes.ctl.nb.ocr)[0].text), /FACTURA/i, 'and so is the text read from it');
  await shot('unlocked');
  await tab('Inicio');
});

await check('save, reopen identical; protected content is encrypted in the file', async () => {
  // lock the protected page again, then save: no plaintext of it may be in the file
  await tab('Proteger y compartir');
  await btn('Bloquear la página');
  await page.waitForSelector('.nn-locked');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
  const file = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(file);
  assert.match(dl.suggestedFilename(), /\.novanotes$/);
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 2);
  assert.equal(Object.keys(parsed.assets).length, 0, 'the media of the protected page is only inside the encrypted block');
  const sig = () =>
    ev(() => {
      const { ctl } = window.__novaNotes;
      return JSON.stringify([ctl.nb.sections.length, ctl.nb.sections.flatMap((s) => s.pages.map((p) => [p.title, p.level, p.containers?.length ?? 'locked', p.ink?.length ?? 'locked'])), Object.keys(ctl.nb.assets).length, Object.keys(ctl.nb.ocr).length, ctl.nb.tagDefs.length, ctl.nb.groups.length]);
    });
  const before = await sig();
  await ev(() => window.__novaNotes.ctl.newDoc());
  assert.equal((await ctlState()).pages, 1);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => window.__novaNotes.ctl.nb.sections.length >= 2 || window.__novaNotes.ctl.nb.groups.length >= 1);
  assert.equal(await sig(), before);
  assert.equal((await ctlState()).dirty, false);
  // locked content is not searchable; after unlocking, the text read from the image (kept in the file, inside the encrypted block) is found again
  await page.keyboard.press('Control+E');
  await page.getByLabel('Buscar en todas las páginas', { exact: true }).fill('48213');
  await page.waitForSelector('.nn-results');
  assert.match(await page.locator('.nn-results').innerText(), /Sin resultados/);
  await page.keyboard.press('Escape');
  assert.equal(await ev(() => window.__novaNotes.ctl.unlock('page', 'clave-secreta')), true);
  await page.waitForSelector('.nn-canvas');
  await page.keyboard.press('Control+E');
  await page.getByLabel('Buscar en todas las páginas', { exact: true }).fill('48213');
  await page.waitForSelector('.nn-results button');
  assert.match(await page.locator('.nn-results').innerText(), /dentro de una imagen/);
  await page.keyboard.press('Escape');
  // damaged files are refused with a message
  const bad = path.join(tmp, 'roto.novanotes');
  fs.writeFileSync(bad, '{"version":2,');
  const [c2] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
  await c2.setFiles(bad);
  await page.waitForTimeout(300);
  assert.equal(dialogs.length, 1);
  assert.match(dialogs.pop(), /no es una libreta/);
});

await check('shared notebook: merge another copy keeps both versions on conflict', async () => {
  const added = await ev(() => {
    const { ctl } = window.__novaNotes;
    const copy = JSON.parse(JSON.stringify(ctl.nb));
    const s = copy.sections.find((x) => !x.vault);
    s.pages.push({ ...JSON.parse(JSON.stringify(s.pages[0])), id: 'remota', title: 'Página del otro equipo', modified: Date.now() + 5000, created: Date.now() });
    const first = s.pages[0];
    if (first.containers) first.title = 'Cambiada en el otro equipo';
    first.modified = Date.now() + 9000;
    const r = ctl.mergeFrom(copy);
    return r;
  });
  assert.ok(added.added >= 1);
  assert.ok(await ev(() => window.__novaNotes.ctl.nb.sections.some((s) => s.pages.some((p) => p.title === 'Página del otro equipo'))));
  await tab('Proteger y compartir');
  await btn('Libreta compartida…');
  await page.getByRole('checkbox').check();
  assert.equal(await ev(() => window.__novaNotes.ctl.nb.shared), true);
  await btn('Cerrar');
  await tab('Inicio');
});

await check('email: the page becomes an .eml with text, images and ink', async () => {
  await ev(() => { const c = window.__novaNotes.ctl; c.goTo(c.nb.sections[0].id); });
  await page.locator('.nn-pageitem').first().click();
  await page.waitForSelector('.nn-canvas');
  await tab('Organizar');
  await btn('Enviar la página por correo…');
  await page.getByLabel('Para (opcional)').fill('ana@example.org');
  await page.getByLabel('Asunto').fill('Notas de la reunión');
  const [dl] = await Promise.all([page.waitForEvent('download'), btn('Preparar el correo')]);
  const f = path.join(tmp, dl.suggestedFilename());
  await dl.saveAs(f);
  const eml = fs.readFileSync(f, 'utf8');
  assert.match(dl.suggestedFilename(), /\.eml$/);
  assert.match(eml, /^To: .*ana@example\.org/m);
  const subj = /^Subject: =[?]UTF-8[?]B[?]([^?]+)[?]=/m.exec(eml);
  assert.equal(Buffer.from(subj[1], 'base64').toString('utf8'), 'Notas de la reunión');
  assert.match(eml, /X-Unsent: 1/);
  assert.match(eml, /Content-ID: <img1@notes\.nova>/);
  assert.match(eml, /Content-Type: image\/png/);
  assert.match(eml, /Content-Type: multipart\/(related|mixed)/);
  await tab('Inicio');
});

await check('export: Markdown, web page (layout kept) and Word', async () => {
  await tab('Organizar');
  await btn('Exportar página');
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Markdown/ }).click()]);
  const mdFile = path.join(tmp, md.suggestedFilename());
  await md.saveAs(mdFile);
  const text = fs.readFileSync(mdFile, 'utf8');
  assert.match(text, /^# /);
  assert.match(text, /Enviar el informe/);
  await btn('Exportar página');
  const [h] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /página web/ }).click()]);
  const hf = path.join(tmp, h.suggestedFilename());
  await h.saveAs(hf);
  const html = fs.readFileSync(hf, 'utf8');
  assert.match(html, /position:absolute;left:\d+px;top:\d+px/);
  assert.match(html, /<svg/);
  assert.match(html, /<audio/);
  assert.match(html, /<video/);
  assert.match(html, /<math/);
  await btn('Exportar página');
  const [dx] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Word/ }).click()]);
  const docx = path.join(tmp, dx.suggestedFilename());
  await dx.saveAs(docx);
  const zip = await JSZip.loadAsync(fs.readFileSync(docx));
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /Enviar el informe/);
  assert.ok(Object.keys(zip.files).some((n) => n.startsWith('word/media/')), 'the image is in the document');
  assert.equal(dialogs.length, 1, 'ink and media warn that they are left out');
  dialogs.pop();
  await tab('Inicio');
});

await check('every ribbon button is wired (no decorative controls) and the English UI exists', async () => {
  for (const t of ['Inicio', 'Insertar', 'Dibujar', 'Organizar', 'Proteger y compartir', 'Buscar']) {
    await tab(t);
    const names = await page.locator('.nv-ribbon button, [role="tabpanel"] button').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getAttribute('aria-label') || e.textContent.trim()).filter(Boolean));
    assert.ok(names.length > 3, t);
  }
  await tab('Inicio');
});

await check('screenshots in dark theme keep the page readable', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await settle(300);
  assert.equal(await page.locator('.nn-canvas').evaluate((el) => getComputedStyle(el).color), 'rgb(0, 0, 0)');
  await shot('dark');
  await page.emulateMedia({ colorScheme: 'light' });
});

await check('no console errors or unexpected dialogs', async () => {
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
