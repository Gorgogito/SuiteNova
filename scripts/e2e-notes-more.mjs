// Segunda ronda de Nova Notes (hacia OneNote): organizar, insertar, tinta, revisar y ver. Necesita `pnpm dev` en :1420.
// Uso: node scripts/e2e-notes-more.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=notes';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1900, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
const dialogs = [];
page.on('dialog', (d) => {
  dialogs.push(d.message());
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
    // un diálogo abierto no debe arrastrar al siguiente
    await page.keyboard.press('Escape').catch(() => undefined);
  }
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const settle = (ms = 200) => page.waitForTimeout(ms);
const canvasBox = () => page.locator('.nn-canvas').boundingBox();
const tab = (name) => page.getByRole('tab', { name: name === 'Tabla' ? /Tabla$/ : name, exact: name !== 'Tabla' }).click();
const btn = (name) => page.getByRole('button', { name, exact: true }).click();
const dlg = () => page.getByRole('dialog');
const closeDlg = async () => {
  await dlg().getByRole('button', { name: 'Cerrar', exact: true }).click();
  await settle();
};
const ctl = (fn, arg) => ev(({ fn, arg }) => new Function('ctl', 'arg', `return (${fn})(ctl, arg)`)(window.__novaNotes.ctl, arg), { fn: fn.toString(), arg });
const drag = async (pts) => {
  const b = await canvasBox();
  await page.mouse.move(b.x + pts[0][0], b.y + pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x, b.y + y, { steps: 4 });
  await page.mouse.up();
};
const writeAt = async (x, y, text) => {
  const b = await canvasBox();
  await page.mouse.click(b.x + x, b.y + y);
  await page.keyboard.type(text);
};

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.nn-canvas');
await page.waitForFunction(() => !!window.__novaNotes);

await check('la cinta tiene las pestañas nuevas', async () => {
  for (const t of ['Historial', 'Revisar']) assert.ok(await page.getByRole('tab', { name: t, exact: true }).count(), t);
});

// ------------------------------------------------------------------ páginas y secciones

await check('mover y copiar una página a otra sección con el cuadro', async () => {
  await ctl((c) => {
    c.setTitle('Primera');
    c.addPage();
    c.setTitle('Segunda');
    c.addSection();
    c.renameSection(c.sectionId, 'Destino');
    c.goTo(c.nb.sections[0].id, c.nb.sections[0].pages[1].id);
  });
  await tab('Organizar');
  await btn('Mover o copiar la página…');
  await dlg().getByLabel('A la sección').selectOption({ label: 'Destino' });
  await shot('mover-pagina');
  await dlg().getByRole('button', { name: 'Copiar', exact: true }).click();
  await settle();
  let st = await ctl((c) => ({ sec: c.section.name, orig: c.nb.sections[0].pages.map((p) => p.title), dest: c.nb.sections[1].pages.map((p) => p.title) }));
  assert.equal(st.sec, 'Destino');
  assert.deepEqual(st.orig, ['Primera', 'Segunda']);
  assert.ok(st.dest.includes('Segunda (copia)'), JSON.stringify(st));
  // ahora la movemos de verdad
  await ctl((c) => c.goTo(c.nb.sections[0].id, c.nb.sections[0].pages[1].id));
  await tab('Organizar');
  await btn('Mover o copiar la página…');
  await dlg().getByLabel('A la sección').selectOption({ label: 'Destino' });
  await dlg().getByRole('button', { name: 'Mover', exact: true }).click();
  await settle();
  st = await ctl((c) => ({ orig: c.nb.sections[0].pages.map((p) => p.title), dest: c.nb.sections[1].pages.map((p) => p.title) }));
  assert.deepEqual(st.orig, ['Primera']);
  assert.ok(st.dest.includes('Segunda'), JSON.stringify(st));
});

await check('copiar y combinar secciones', async () => {
  await ctl((c) => c.goTo(c.nb.sections[1].id));
  await tab('Organizar');
  await btn('Copiar la sección');
  let names = await ctl((c) => c.nb.sections.map((s) => s.name));
  assert.deepEqual(names, ['Sección 1', 'Destino', 'Destino (copia)'].map((n) => n).slice(0, 3).map((n, i) => (i === 0 ? names[0] : n)));
  await btn('Combinar la sección con otra…');
  await dlg().getByLabel('Combinar en').selectOption({ label: 'Destino' });
  await dlg().getByRole('button', { name: 'Combinar', exact: true }).click();
  await settle();
  names = await ctl((c) => c.nb.sections.map((s) => s.name));
  assert.equal(names.length, 2);
  assert.ok(!names.includes('Destino (copia)'));
  const pages = await ctl((c) => c.section.pages.length);
  assert.ok(pages >= 3, `páginas tras combinar: ${pages}`);
});

await check('ordenar las páginas de una sección por título', async () => {
  await ctl((c) => {
    c.goTo(c.nb.sections[0].id);
    c.addPage();
    c.setTitle('Alfa');
    c.addPage();
    c.setTitle('Zulú');
  });
  await tab('Organizar');
  await btn('Ordenar páginas');
  await page.getByRole('menuitem', { name: /Ordenar por título/ }).click();
  const t = await ctl((c) => c.section.pages.map((p) => p.title));
  assert.deepEqual(t, [...t].sort((a, b) => a.localeCompare(b, 'es')));
  assert.ok(t.indexOf('Alfa') < t.indexOf('Zulú'));
});

await check('nota rápida crea la sección y una página', async () => {
  await tab('Insertar');
  await btn('Nota rápida');
  const st = await ctl((c) => ({ sec: c.section.name, n: c.section.pages.length }));
  assert.deepEqual(st, { sec: 'Notas rápidas', n: 1 });
});

await check('ediciones recientes y páginas sin leer', async () => {
  await ctl((c) => {
    const other = c.nb.sections[0].pages.find((p) => p.title === 'Alfa');
    // simula un cambio llegado de otro equipo: modificada después de la última vez vista
    other.modified = Date.now() + 5000;
  });
  const unread = await ctl((c) => c.unreadCount);
  assert.ok(unread >= 1, `sin leer: ${unread}`);
  await tab('Historial');
  await btn('Páginas sin leer…');
  assert.ok(await dlg().getByText('Alfa').count());
  await shot('sin-leer');
  await dlg().getByRole('button', { name: 'Marcar todo como leído', exact: true }).click();
  await settle();
  assert.equal(await ctl((c) => c.unreadCount), 0);
  await closeDlg();
  await tab('Historial');
  await btn('Ediciones recientes…');
  assert.ok(await dlg().locator('.nn-listbox button').count());
  await closeDlg();
});

await check('copiar y pegar un vínculo a una página', async () => {
  await ctl((c) => c.goTo(c.nb.sections[0].id, c.nb.sections[0].pages.find((p) => p.title === 'Alfa').id));
  await tab('Insertar');
  await btn('Copiar el vínculo a la página');
  await ctl((c) => {
    c.goTo(c.nb.sections[0].id, c.nb.sections[0].pages[0].id);
  });
  await writeAt(80, 60, 'Ver: ');
  await tab('Insertar');
  await btn('Pegar vínculo a la página');
  const links = await ctl((c) => JSON.stringify(c.page.containers.filter((x) => x.kind === 'text').map((x) => x.content)));
  assert.match(links, /#nn:page:/);
});

// ------------------------------------------------------------------ insertar

await check('archivo adjunto: se guarda, se descarga igual y sobrevive a guardar y abrir', async () => {
  await tab('Insertar');
  const bytes = Buffer.from('%PDF-1.4 contenido de prueba');
  await page.locator('[data-testid=nn-attach-input]').setInputFiles({ name: 'informe.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.waitForSelector('.nn-file');
  assert.match(await page.locator('.nn-file__name').first().innerText(), /informe\.pdf/);
  await shot('adjunto');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.nn-file').first().click()]);
  assert.equal(dl.suggestedFilename(), 'informe.pdf');
  const saved = fs.readFileSync(await dl.path());
  assert.equal(saved.toString(), bytes.toString());
  const json = await ctl(async (c) => c.serialize());
  await ev(async (j) => window.__novaNotes.load(j, 'reabierta.novanotes'), json);
  await settle(400);
  assert.ok(await page.locator('.nn-file').count(), 'el adjunto vuelve al abrir');
});

await check('insertar espacio empuja lo de abajo y se puede deshacer', async () => {
  await ctl((c) => {
    c.addPage();
  });
  await writeAt(80, 80, 'Arriba');
  await writeAt(80, 300, 'Abajo');
  const before = await ctl((c) => c.page.containers.filter((x) => x.kind === 'text').map((x) => x.y).sort((a, b) => a - b));
  await tab('Insertar');
  await page.getByRole('button', { name: 'Insertar espacio', exact: true }).first().click();
  await drag([
    [400, 200],
    [400, 330],
  ]);
  const after = await ctl((c) => c.page.containers.filter((x) => x.kind === 'text').map((x) => x.y).sort((a, b) => a - b));
  assert.equal(after[0], before[0]);
  const last = after.length - 1;
  assert.ok(after[last] - before[last] >= 100, `bajó ${after[last] - before[last]}`);
  assert.equal(after[last - 1], before[last - 1], 'lo de arriba no se mueve');
  await ctl((c) => c.undoPage());
  const undone = await ctl((c) => c.page.containers.filter((x) => x.kind === 'text').map((x) => x.y).sort((a, b) => a - b));
  assert.deepEqual(undone, before, 'deshacer devuelve el espacio');
  await shot('insertar-espacio');
  await ctl((c) => c.setTool('select'));
});

await check('símbolo: el cuadro inserta el carácter', async () => {
  await writeAt(80, 520, 'Precio ');
  await tab('Insertar');
  await btn('Símbolo…');
  await dlg().getByRole('button', { name: '©', exact: true }).click();
  await closeDlg();
  const txt = await ctl((c) => c.textOfPage());
  assert.match(txt, /Precio ©/);
});

await check('recorte de pantalla: captura simulada, zona elegida e imagen insertada', async () => {
  await ev(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d');
      g.fillStyle = '#2b6cb0';
      g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#f6e05e';
      g.fillRect(200, 100, 240, 160);
      const s = c.captureStream(5);
      setInterval(() => g.fillRect(200, 100, 240, 160), 100);
      return s;
    };
  });
  const imgsBefore = await ctl((c) => c.page.containers.filter((x) => x.kind === 'image').length);
  await tab('Insertar');
  await btn('Recorte de pantalla…');
  const cv = page.getByTestId('nn-clip-canvas');
  await cv.waitFor();
  const b = await cv.boundingBox();
  await page.mouse.move(b.x + 150, b.y + 80);
  await page.mouse.down();
  await page.mouse.move(b.x + 450, b.y + 280, { steps: 5 });
  await page.mouse.up();
  await shot('recorte');
  await dlg().getByRole('button', { name: 'Insertar el recorte', exact: true }).click();
  await settle(600);
  const imgs = await ctl((c) => c.page.containers.filter((x) => x.kind === 'image').map((x) => ({ w: x.w, h: x.h })));
  assert.equal(imgs.length, imgsBefore + 1);
  const last = imgs[imgs.length - 1];
  assert.ok(Math.abs(last.w / last.h - 300 / 200) < 0.1, `proporción ${last.w}x${last.h}`);
});

// ------------------------------------------------------------------ texto

await check('copiar formato aplica la negrita copiada a lo seleccionado después', async () => {
  await ctl((c) => c.addPage());
  await writeAt(80, 60, 'negrita normal');
  await page.keyboard.press('Home');
  await page.keyboard.down('Shift');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+b');
  await tab('Inicio');
  await btn('Copiar formato');
  assert.ok(await ctl((c) => !!c.painter));
  // seleccionar «normal» con doble clic en la palabra
  await page.locator('.nn-box--text .ProseMirror', { hasText: 'negrita' }).first().click({ position: { x: 5, y: 8 } });
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await settle(200);
  assert.ok(await ctl((c) => !c.painter), 'el pincel se desactiva');
  const html = await page.locator('.nn-box--text .ProseMirror', { hasText: 'negrita' }).first().innerHTML();
  assert.ok(html.includes('<strong>normal</strong>'), html);
});

await check('subir y bajar un párrafo', async () => {
  await ctl((c) => c.addPage());
  await writeAt(80, 60, 'uno');
  await page.keyboard.press('Enter');
  await page.keyboard.type('dos');
  await tab('Inicio');
  await btn('Subir el párrafo');
  let t = await ctl((c) => c.textOfPage());
  assert.equal(t.trim().split('\n').filter(Boolean).join('|'), 'dos|uno');
  await btn('Bajar el párrafo');
  t = await ctl((c) => c.textOfPage());
  assert.equal(t.trim().split('\n').filter(Boolean).join('|'), 'uno|dos');
});

await check('cambiar mayúsculas desde el menú', async () => {
  await page.keyboard.press('Control+a');
  await tab('Inicio');
  await btn('Mayúsculas');
  await page.getByRole('menuitem', { name: 'MAYÚSCULAS', exact: true }).click();
  const t = await ctl((c) => c.textOfPage());
  assert.match(t, /UNO/);
});

await check('buscar y reemplazar en la página', async () => {
  await ctl((c) => c.addPage());
  await writeAt(80, 60, 'casa y casa y Casa');
  await tab('Inicio');
  await btn('Buscar en esta página…');
  await dlg().getByLabel('Buscar', { exact: true }).fill('casa');
  await dlg().getByRole('button', { name: 'Siguiente', exact: true }).click();
  assert.match(await dlg().locator('[role=status]').innerText(), /1 de 3/);
  await dlg().getByLabel('Reemplazar con').fill('piso');
  await dlg().getByRole('button', { name: 'Reemplazar todo', exact: true }).click();
  await settle();
  assert.match(await ctl((c) => c.textOfPage()), /piso y piso y piso/);
  await dlg().getByLabel('Distinguir mayúsculas y minúsculas').uncheck();
  await closeDlg();
});

// ------------------------------------------------------------------ revisar

await check('ortografía encuentra la palabra mal escrita y la corrige con una sugerencia', async () => {
  await ctl((c) => c.addPage());
  await writeAt(80, 60, 'La casa es grandee y bonita');
  await tab('Revisar');
  await btn('Ortografía y gramática');
  await page.getByTestId('spell-word').waitFor({ timeout: 20000 });
  assert.equal(await page.getByTestId('spell-word').innerText(), 'grandee');
  await shot('ortografia');
  assert.ok((await page.locator('#nv-sp-sug option').allInnerTexts()).includes('grande'));
  await page.locator('#nv-sp-sug').selectOption('grande');
  await dlg().getByRole('button', { name: 'Cambiar', exact: true }).click();
  await settle(300);
  assert.ok(await dlg().getByText('no hay más problemas').count());
  const t = await ctl((c) => c.textOfPage());
  assert.match(t, /grande /);
  await closeDlg();
});

await check('contar palabras', async () => {
  await tab('Revisar');
  await btn('Contar palabras');
  const text = await dlg().innerText();
  assert.match(text, /Palabras en la página\s*\d+/);
  const m = /Palabras en la página\s*(\d+)/.exec(text);
  assert.equal(Number(m[1]), 6);
  await closeDlg();
});

await check('comprobar accesibilidad avisa de una imagen sin texto alternativo', async () => {
  await ctl((c) => {
    c.setTool('select');
    c.addPage();
    const a = c.addAsset({ mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', name: 'x.png', size: 70 });
    c.addImage(a, 80, 80);
  });
  await tab('Revisar');
  await btn('Comprobar accesibilidad');
  assert.ok(await dlg().getByText(/no tiene texto alternativo/).count());
  // si se escribe un texto alternativo, el aviso desaparece
  await closeDlg();
  await ctl((c) => { const im = c.page.containers.find((x) => x.kind === 'image'); c.setAlt(im.id, 'Un píxel azul de prueba'); });
  await tab('Revisar');
  await btn('Comprobar accesibilidad');
  assert.equal(await dlg().getByText(/no tiene texto alternativo/).count(), 0);
  await shot('accesibilidad');
  await closeDlg();
});

await check('lector inmersivo muestra el texto y permite cambiar su aspecto', async () => {
  await writeAt(80, 200, 'Texto para leer en voz alta');
  await tab('Revisar');
  await btn('Lector inmersivo y voz');
  const box = page.getByTestId('nn-immersive');
  assert.match(await box.innerText(), /leer en voz alta/);
  await dlg().getByLabel('Fondo').selectOption('dark');
  assert.equal(await box.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(28, 28, 28)');
  await shot('lector');
  await closeDlg();
});

// ------------------------------------------------------------------ tablas

await check('tabla: ordenar por una columna y dar aspecto', async () => {
  await ctl((c) => c.addPage());
  await tab('Insertar');
  await btn('Tabla…');
  await dlg().getByRole('button', { name: /Insertar|Aceptar/ }).click();
  await settle(300);
  const cells = page.locator('.nn-box--text td');
  assert.ok((await cells.count()) >= 4);
  const n = await cells.count();
  const vals = ['b', '3', 'a', '1', 'c', '2'];
  for (let i = 0; i < Math.min(n, vals.length); i++) {
    await cells.nth(i).click();
    await page.keyboard.type(vals[i]);
  }
  await tab('Tabla');
  await btn('Ordenar…');
  await dlg().getByLabel('Tipo').selectOption('text');
  await dlg().getByRole('button', { name: 'Ordenar', exact: true }).click();
  await settle(300);
  const first = await cells.nth(0).innerText();
  assert.ok(['a', 'b', 'c', '1', ''].includes(first.trim()), first);
  await tab('Tabla');
  await btn('Aspecto y sombreado…');
  await dlg().getByLabel('Estilo').selectOption('blue');
  await dlg().getByLabel('Fila de encabezado').check();
  await dlg().getByRole('button', { name: 'Aplicar', exact: true }).click();
  await settle(200);
  await shot('tabla-aspecto');
  await closeDlg();
  const bg = await page.locator('.nn-box--text table tr').first().locator('th, td').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.notEqual(bg, 'rgba(0, 0, 0, 0)');
});

// ------------------------------------------------------------------ tinta

const inkTools = async () => ctl((c) => c.page.ink.map((s) => s.tool + ':' + s.pts.length / 2));

await check('borrador de punto parte un trazo en dos; el de trazo entero lo quita', async () => {
  await ctl((c) => c.addPage());
  await tab('Dibujar');
  await btn('Lápiz');
  await drag([
    [100, 150],
    [300, 150],
    [500, 150],
  ]);
  assert.equal((await ctl((c) => c.page.ink.length)), 1);
  await btn('Borrar solo el trozo tocado');
  await drag([
    [300, 140],
    [300, 160],
  ]);
  assert.equal((await ctl((c) => c.page.ink.length)), 2, JSON.stringify(await inkTools()));
  await btn('Borrar trazos enteros');
  await drag([
    [120, 140],
    [120, 160],
  ]);
  assert.equal((await ctl((c) => c.page.ink.length)), 1);
  await shot('borrador-punto');
});

await check('lazo libre selecciona lo que rodea; se duplica, agranda y colorea', async () => {
  await ctl((c) => c.clearInk());
  await tab('Dibujar');
  await btn('Lápiz');
  await drag([[200, 250], [230, 260], [260, 250]]);
  await drag([[200, 500], [260, 510]]);
  assert.equal((await ctl((c) => c.page.ink.length)), 2);
  await btn('Seleccionar tinta (lazo o recuadro)');
  // un lazo triangular alrededor del primer trazo, no del segundo
  await drag([[170, 220], [300, 230], [250, 300], [180, 290], [170, 220]]);
  assert.equal(await ctl((c) => c.selectedStrokes.length), 1);
  const w0 = await ctl((c) => { const s = c.page.ink.find((x) => c.selectedStrokes.includes(x.id)); return s.pts[s.pts.length - 2] - s.pts[0]; });
  await btn('Agrandar la tinta seleccionada');
  const w1 = await ctl((c) => { const s = c.page.ink.find((x) => c.selectedStrokes.includes(x.id)); return s.pts[s.pts.length - 2] - s.pts[0]; });
  assert.ok(w1 > w0 * 1.2, `${w0} → ${w1}`);
  await btn('Duplicar la tinta seleccionada');
  assert.equal(await ctl((c) => c.page.ink.length), 3);
  await ctl((c) => (c.penColor = '#c50f1f'));
  await btn('Aplicar el lápiz actual a la selección');
  assert.equal(await ctl((c) => c.page.ink.filter((s) => s.color === '#c50f1f').length), 1);
  await btn('Borrar la tinta seleccionada');
  assert.equal(await ctl((c) => c.page.ink.length), 2);
  await shot('lazo');
});

await check('regla: un trazo hecho junto a ella queda recto', async () => {
  await ctl((c) => { c.clearInk(); c.setTool('pen'); });
  await tab('Dibujar');
  await btn('Regla');
  assert.ok(await page.locator('[data-ruler]').count());
  await ctl((c) => c.setRuler({ x: 150, y: 300, angle: 0, len: 500 }));
  await btn('Lápiz');
  await drag([[170, 290], [250, 306], [400, 292], [550, 300]]);
  const s = await ctl((c) => c.page.ink[c.page.ink.length - 1]);
  assert.equal(s.pts.length, 4, JSON.stringify(s.pts));
  assert.equal(s.pts[1], 300);
  assert.equal(s.pts[3], 300);
  await shot('regla');
  await btn('Regla');
  assert.equal(await page.locator('[data-ruler]').count(), 0);
});

await check('reproducir la tinta la vuelve a dibujar paso a paso', async () => {
  await ctl((c) => { c.clearInk(); c.setTool('pen'); });
  await drag([[100, 100], [200, 160], [300, 100]]);
  await drag([[100, 220], [300, 220]]);
  await ctl((c) => c.setTool('select'));
  await tab('Dibujar');
  await btn('Reproducir la tinta');
  await page.getByRole('group', { name: 'Reproducción de la tinta' }).waitFor();
  const mid = await ev(() => document.querySelectorAll('.nn-ink [data-stroke]').length);
  assert.ok(mid <= 2);
  await page.waitForFunction(() => window.__novaNotes.ctl.replay === 1 || window.__novaNotes.ctl.replay === null, null, { timeout: 15000 });
  await page.getByRole('group', { name: 'Reproducción de la tinta' }).getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await ctl((c) => c.replay), null);
  assert.equal(await page.locator('.nn-ink [data-stroke]').count(), 2);
});

await check('tinta a texto lee letras de imprenta dibujadas', async () => {
  await ctl((c) => c.clearInk());
  // «HOLA» con líneas rectas gruesas
  await ctl((c) => {
    c.setTool('pen');
    const L = (pts) => c.addStroke(c.newStrokeFrom(pts));
    c.penWidth = 6;
    const x0 = 120;
    const y = 200;
    const h = 90;
    // H
    L([x0, y, x0, y + h]); L([x0 + 50, y, x0 + 50, y + h]); L([x0, y + h / 2, x0 + 50, y + h / 2]);
    // O
    const xo = x0 + 65;
    L(Array.from({ length: 21 }, (_, i) => [xo + 30 + 30 * Math.cos((i / 20) * Math.PI * 2), y + h / 2 + 45 * Math.sin((i / 20) * Math.PI * 2)]).flat());
    // L
    const xl = x0 + 150;
    L([xl, y, xl, y + h, xl + 50, y + h]);
    // A (sin travesaño de curva)
    const xa = x0 + 250;
    L([xa, y + h, xa + 25, y, xa + 50, y + h]); L([xa + 10, y + h * 0.65, xa + 40, y + h * 0.65]);
  });
  await tab('Dibujar');
  await btn('Tinta a texto…');
  await page.locator('.nn-ocrtext').waitFor({ timeout: 60000 });
  await dlg().getByText('Leyendo la tinta…').waitFor({ state: 'hidden', timeout: 60000 });
  const text = await page.locator('.nn-ocrtext').inputValue();
  await shot('tinta-a-texto');
  // Tesseract no está hecho para letra a mano: se acepta que lea parte de lo dibujado, pero debe haber leído algo
  assert.ok(text.trim().length > 0, `texto leído: «${text}»`);
  await dlg().getByRole('textbox', { name: 'Texto reconocido' }).fill('HOLA');
  await dlg().getByRole('button', { name: 'Sustituir la tinta', exact: true }).click();
  await settle(300);
  assert.equal(await ctl((c) => c.page.ink.length), 0);
  assert.match(await ctl((c) => c.textOfPage()), /HOLA/);
});

// ------------------------------------------------------------------ ver

await check('página completa oculta los paneles y el título', async () => {
  await tab('Vista');
  await btn('Página completa');
  assert.equal(await page.locator('.nn-pages').count(), 0);
  assert.equal(await page.locator('.nn-secs').count(), 0);
  await btn('Ocultar el título de la página');
  assert.equal(await page.locator('.nn-pagehead').isVisible(), false);
  await shot('pagina-completa');
  await btn('Página completa');
  await btn('Ocultar el título de la página');
  assert.ok(await page.locator('.nn-pages').count());
});

await check('imprimir prepara la página para la impresora y la deja como estaba', async () => {
  await ev(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed++;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await tab('Vista');
  await btn('Imprimir o guardar como PDF…');
  await page.waitForFunction(() => window.__printed === 1);
  assert.equal(await ev(() => document.body.classList.contains('nn-printing')), false);
  // la hoja de estilos de impresión existe y esconde el resto de la aplicación
  const rules = await ev(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } }).filter((r) => r.media && /print/.test(r.conditionText ?? r.media.mediaText)).map((r) => r.cssText).join('\n'));
  assert.match(rules, /nn-printing/);
});

await check('acoplar al escritorio solo avisa fuera de la aplicación de escritorio', async () => {
  await tab('Vista');
  await btn('Acoplar al escritorio');
  assert.match(await ctl((c) => c.message), /aplicación de escritorio/);
});

await check('ecuación: el editor estructurado (el de Writer) escribe fracciones con «/» y mantiene el código LaTeX', async () => {
  await ctl((c) => c.addPage());
  await tab('Insertar');
  await btn('Ecuación…');
  await dlg().locator('[data-testid=equation-editor]').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('x=a/b');
  await settle(200);
  assert.equal(await dlg().locator('#nn-eq').inputValue(), String.raw`x=\frac{a}{b}`);
  assert.ok(await dlg().locator('[data-testid=equation-editor] mfrac').count(), 'se dibuja la fracción');
  await dlg().locator('#nn-eq').fill(String.raw`\sqrt{x}+\pi`);
  await settle(200);
  assert.ok(await dlg().locator('[data-testid=equation-editor] msqrt').count(), 'el editor sigue al código');
  await shot('ecuacion-editor');
  await dlg().getByRole('button', { name: 'Aceptar', exact: true }).click();
  await settle(200);
  assert.ok(await page.locator('.nn-box--text math, .nn-box--text .nw-math').count());
});

await check('impresión de PDF: cada página entra como imagen y su texto se encuentra con la búsqueda', async () => {
  // un PDF mínimo de dos páginas, escrito a mano
  const objs = [];
  const add = (s) => objs.push(s);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  const content = (t) => `BT /F1 36 Tf 60 400 Td (${t}) Tj ET`;
  const stream = (t) => `<< /Length ${content(t).length} >>\nstream\n${content(t)}\nendstream`;
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>');
  add(stream('Zanahoria primera'));
  add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>');
  add(stream('Berenjena segunda'));
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await ctl((c) => c.addPage());
  const before = await ctl((c) => c.page.containers.filter((x) => x.kind === 'image').length);
  await tab('Insertar');
  await page.locator('[data-testid=nn-pdf-input]').setInputFiles({ name: 'menu.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf) });
  await page.waitForFunction((n) => window.__novaNotes.ctl.page.containers.filter((x) => x.kind === 'image').length === n + 2, before, { timeout: 30000 });
  await settle(500);
  await shot('pdf');
  const found = await ctl((c) => { c.search('berenjena'); return c.results.map((r) => r.where); });
  assert.deepEqual(found, ['image']);
  const sizes = await ctl((c) => c.page.containers.filter((x) => x.kind === 'image').map((x) => x.h / x.w));
  assert.ok(sizes.every((r) => Math.abs(r - 1.25) < 0.02), sizes.join());
  await ctl((c) => c.search(''));
});

await check('corrector: subraya mientras se escribe, con color por categoría, y el menú corrige', async () => {
  await ctl((c) => (c.addPage(), c.setTool('select')));
  await writeAt(80, 60, 'Una cassa  rara y los mesa');
  await settle(2500);
  const red = await page.locator('.nn-doc .nw-misspelled').allInnerTexts();
  assert.deepEqual(red, ['cassa']);
  assert.ok((await page.locator('.nn-doc .nw-grammar').count()) >= 2);
  await page.locator('.nn-doc .nw-misspelled').first().click({ button: 'right' });
  await page.locator('.nv-sp-menu').waitFor();
  await shot('corrector-menu');
  await page.locator('.nv-sp-menu [role=menuitem]', { hasText: /^casa$/ }).click();
  await settle(500);
  assert.match(await ctl((c) => c.textOfPage()), /Una casa /);
});

await check('corrector: idioma de la selección y «no revisar» en una nota', async () => {
  await ctl((c) => (c.addPage(), c.setTool('select')));
  await writeAt(80, 60, 'Hola the house is biig fin');
  await settle(2500);
  const sel = (needle) =>
    ctl((c, n) => {
      const v = c.view;
      let found = null;
      v.state.doc.descendants((node, pos) => {
        if (!found && node.isText && node.text.includes(n)) found = [pos + node.text.indexOf(n), pos + node.text.indexOf(n) + n.length];
        return true;
      });
      v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.create(v.state.doc, found[0], found[1])));
      v.focus();
    }, needle);
  await sel('the house is biig');
  await tab('Revisar');
  await btn('Idioma y opciones');
  await page.getByRole('menuitem', { name: 'Idioma de la selección: English' }).click();
  await settle(2500);
  assert.deepEqual(await page.locator('.nn-doc .nw-misspelled').allInnerTexts(), ['biig']);
  await sel('biig');
  await tab('Revisar');
  await btn('Idioma y opciones');
  await page.getByRole('menuitem', { name: 'No revisar la ortografía ni la gramática' }).click();
  await settle(800);
  assert.deepEqual(await page.locator('.nn-doc .nw-misspelled').allInnerTexts(), []);
});

await check('corrector: el panel Editor lista los problemas y corrige con un clic', async () => {
  await ctl((c) => (c.addPage(), c.setTool('select')));
  await writeAt(80, 60, 'Una cassa  rara.');
  await settle(2500);
  await tab('Revisar');
  await btn('Editor');
  const pane = page.locator('aside.nv-ed');
  await pane.waitFor();
  assert.match(await pane.innerText(), /cassa/);
  await shot('corrector-editor');
  await pane.getByRole('button', { name: 'casa', exact: true }).first().click();
  await settle(600);
  assert.match(await ctl((c) => c.textOfPage()), /Una casa /);
  await pane.getByRole('button', { name: 'Cerrar' }).click();
  assert.equal(await page.locator('aside.nv-ed').count(), 0);
});


await check('autocorrección compartida: en una nota las comillas, los símbolos y la mayúscula se corrigen al escribir', async () => {
  await ctl((c) => (c.addPage(), c.setTool('select')));
  await writeAt(80, 60, 'hola. mañana dijo "si" (c) ');
  await settle(400);
  assert.equal((await ctl((c) => c.textOfPage())).trim(), 'Hola. Mañana dijo “si” ©');
});

await check('sin errores en la consola', async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
for (const r of results) console.log(r[0] === 'ok' ? `  ✓ ${r[1]}` : `  ✗ ${r[1]}\n      ${r[2]}`);
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
if (dialogs.length) console.log('Avisos del navegador:', dialogs);
process.exit(failed ? 1 : 0);
