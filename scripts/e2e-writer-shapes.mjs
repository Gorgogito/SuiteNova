// End-to-end checks for the common shape gallery in Nova Writer: insert shapes of several categories from the ribbon,
// draw them from the catalog, and keep them through .docx save and reopen. Needs `pnpm dev` on :1420.
// Usage: node scripts/e2e-writer-shapes.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const URL = process.env.NOVA_URL ?? 'http://localhost:1420/?app=writer';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  errors.push(`dialog: ${d.message()}`);
  d.dismiss().catch(() => {});
});
let step = 0;
const shot = async (name) => {
  if (!shotsDir) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotsDir}/${String(++step).padStart(2, '0')}-${name}.png` });
};
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 12).join(' | ') + ' @ ' + (e.stack.split(String.fromCharCode(10)).find((l) => l.includes('e2e-writer-shapes')) ?? '').trim()]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const editor = page.locator('.ProseMirror').first();
const shapes = () =>
  page.evaluate(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'shape') out.push({ kind: n.attrs.kind, width: n.attrs.width, height: n.attrs.height });
    });
    return out;
  });
const pick = async (kind) => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Formas', exact: true }).click();
  await page.locator(`[data-shape="${kind}"]`).click();
  await page.waitForTimeout(300);
};

await editor.click();
await page.keyboard.type('Texto con formas.');

/** Quita la selección de objetos (cursor al principio del texto): el siguiente clic en una hija elige el grupo, no a la hija. */
const deselect = async () => {
  await page.evaluate(() => { const v = window.__novaWriter.ctl.mainView; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(1)))); });
  await page.waitForTimeout(150);
};

await check('la galería ofrece las 9 categorías del catálogo común', async () => {
  await page.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await page.getByRole('button', { name: 'Formas', exact: true }).click();
  const titles = await page.locator('.ss-title').allInnerTexts();
  assert.deepEqual(titles, ['Líneas', 'Rectángulos', 'Formas básicas', 'Flechas de bloque', 'Formas de ecuación', 'Diagrama de flujo', 'Estrellas y cintas', 'Llamadas', 'Botones de acción']);
  await shot('galeria');
  await page.keyboard.press('Escape');
});

await check('insertar una elipse, una estrella, una flecha y una línea', async () => {
  for (const k of ['ellipse', 'star5', 'rightArrow', 'line']) await pick(k);
  const s = await shapes();
  assert.deepEqual(s.map((x) => x.kind), ['ellipse', 'star5', 'rightArrow', 'line']);
  assert.ok(s[3].height < s[0].height, 'la línea es más baja que una figura cerrada');
  await shot('insertadas');
});

await check('cada forma se dibuja con trazados del catálogo (sin caer en un rectángulo)', async () => {
  const d = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror [data-kind]')].map((el) => ({ kind: el.dataset.kind, d: [...el.querySelectorAll('svg path')].map((p) => p.getAttribute('d')).join('|') })));
  assert.equal(d.length, 4);
  for (const x of d) assert.ok(x.d.length > 10, `${x.kind} sin dibujo`);
  assert.equal(new Set(d.map((x) => x.d)).size, 4, 'las cuatro formas se dibujan distinto');
});

await check('forma de una categoría rara (botón de acción) se inserta y se dibuja', async () => {
  await pick('actionButtonHome');
  const s = await shapes();
  assert.equal(s.at(-1).kind, 'actionButtonHome');
  const n = await page.locator('.ProseMirror [data-kind="actionButtonHome"] svg path').count();
  assert.ok(n >= 2, 'el botón de acción tiene varios trazados');
});

await check('el cuadro de texto sigue disponible y es editable', async () => {
  await page.getByRole('button', { name: 'Cuadro de texto', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.ProseMirror [data-kind="textbox"] .nw-shape-text').last().click();
  await page.keyboard.type('Dentro');
  const t = await page.locator('.ProseMirror [data-kind="textbox"] .nw-shape-text').last().innerText();
  assert.match(t, /Dentro/);
});

await check('todo sobrevive a guardar y volver a leer el .docx', async () => {
  const back = await page.evaluate(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    const out = [];
    d.body.descendants((n) => {
      if (n.type.name === 'shape') out.push(n.attrs.kind);
    });
    return out;
  });
  assert.deepEqual(back, ['ellipse', 'star5', 'rightArrow', 'line', 'actionButtonHome', 'textbox']);
});

await check('puntos de ajuste: el tirador amarillo redondea la forma, también girada, y sobrevive al .docx', async () => {
  const adjOf = () =>
    page.evaluate(() => {
      let a = null;
      window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
        if (n.type.name === 'shape' && n.attrs.kind === 'roundRect') a = n.attrs.adj;
      });
      return a;
    });
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  assert.equal((await shapes()).length, 0, 'documento limpio');
  await pick('roundRect');
  // la forma recién insertada queda seleccionada por el clic en su dibujo
  await page.locator('.ProseMirror [data-kind="roundRect"]').click({ position: { x: 3, y: 40 } });
  await page.waitForTimeout(300);
  const h = page.locator('.ProseMirror [data-kind="roundRect"] .nw-adj');
  assert.equal(await h.count(), 1);
  const drag = async (dx) => {
    const b = await page.locator('.ProseMirror [data-kind="roundRect"] .nw-adj').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  await drag(30);
  const a1 = await adjOf();
  assert.ok(a1 && a1.adj > 16667, 'adj ' + JSON.stringify(a1));
  await shot('ajuste');
  const back = await page.evaluate(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    let a = null;
    d.body.descendants((n) => {
      if (n.type.name === 'shape' && n.attrs.kind === 'roundRect') a = n.attrs.adj;
    });
    return a;
  });
  assert.deepEqual(back, a1);
  // girada 90°: el mismo gesto sigue el borde de la forma, no el de la pantalla
  await page.evaluate(() => {
    const v = window.__novaWriter.ctl.mainView;
    v.state.doc.descendants((n, p) => {
      if (n.type.name === 'shape' && n.attrs.kind === 'roundRect') v.dispatch(v.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, rotation: 90, adj: null }));
    });
  });
  await page.waitForTimeout(300);
  await page.locator('.ProseMirror [data-kind="roundRect"]').click({ position: { x: 3, y: 40 } });
  await page.waitForTimeout(300);
  assert.equal(await adjOf(), null, 'girada y sin tocar: sin ajuste');
  const b = await page.locator('.ProseMirror [data-kind="roundRect"] .nw-adj').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const a2 = await adjOf();
  assert.ok(a2 && a2.adj > 16667, 'girada: adj ' + JSON.stringify(a2));
});

await check('grupos: Ctrl+clic, agrupar sin mover nada, mover/redimensionar/girar, texto de una hija, .docx, desagrupar y deshacer', async () => {
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  await page.keyboard.type('Texto del documento con formas.');
  await pick('rect');
  await pick('ellipse');
  await page.getByRole('button', { name: 'Cuadro de texto', exact: true }).first().click();
  await page.waitForTimeout(300);
  const members = () => page.locator('.ProseMirror .nw-shape:not(.nw-shape-group)');
  const centres = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.ProseMirror .nw-shape:not(.nw-shape-group)')].map((e) => {
        const r = e.getBoundingClientRect();
        const o = document.querySelector('.ProseMirror').getBoundingClientRect();
        return [Math.round(r.left + r.width / 2 - o.left), Math.round(r.top + r.height / 2 - o.top)];
      }),
    );
  const near = (a, b, tol = 2) => a.length === b.length && a.every((c, i) => Math.abs(c[0] - b[i][0]) <= tol && Math.abs(c[1] - b[i][1]) <= tol);
  const tree = () =>
    page.evaluate(() => {
      const out = [];
      const walk = (n, depth) => {
        if (n.type.name === 'shape_group') {
          out.push({ group: true, depth, w: n.attrs.width, h: n.attrs.height, rot: n.attrs.rotation, x: n.attrs.x, y: n.attrs.y, kids: n.childCount });
          n.forEach((c) => walk(c, depth + 1));
        } else if (n.type.name === 'shape') out.push({ kind: n.attrs.kind, depth, x: n.attrs.x, y: n.attrs.y, w: n.attrs.width, h: n.attrs.height });
      };
      window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
        if (n.type.name === 'shape_group' || n.type.name === 'shape') {
          // solo los de más arriba: los de dentro se recorren desde su grupo
          return false;
        }
        return true;
      });
      window.__novaWriter.ctl.mainView.state.doc.descendants((n, pos, parent) => {
        if ((n.type.name === 'shape' || n.type.name === 'shape_group') && parent && parent.type.name !== 'shape_group') {
          walk(n, 0);
          return false;
        }
        return true;
      });
      return out;
    });
  const tabShape = async () => {
    if ((await page.locator('[data-nv-item="writer.shape.group"]').count()) === 0 || !(await page.locator('[data-nv-item="writer.shape.group"]').first().isVisible())) await page.locator('[role=tab]').filter({ hasText: 'Formato de forma' }).click();
  };
  const edge = (kind, modifiers = []) => page.locator(`.ProseMirror [data-kind="${kind}"]`).first().click({ position: { x: 3, y: 20 }, modifiers });

  const before = await centres();
  assert.equal(before.length, 3);
  await edge('rect');
  await edge('ellipse', ['Control']);
  await edge('textbox', ['Control']);
  assert.equal(await page.locator('.ProseMirror .nw-multisel').count(), 3, 'tres formas elegidas');
  await tabShape();
  await page.locator('[data-nv-item="writer.shape.group"]').first().click();
  await page.waitForTimeout(400);
  let t = await tree();
  assert.equal(t.filter((x) => x.group).length, 1, 'un grupo');
  assert.equal(t[0].kids, 3);
  assert.deepEqual(t.slice(1).map((x) => x.kind), ['rect', 'ellipse', 'textbox']);
  assert.ok(near(await centres(), before), `agrupar no mueve las formas: ${JSON.stringify(before)} -> ${JSON.stringify(await centres())}`);
  await shot('agrupado');

  // primer clic en el dibujo de una hija (con otra cosa elegida) = elegir el grupo; el texto de la caja sigue editable
  await deselect();
  await page.locator('.ProseMirror .nw-shape-group [data-kind="rect"]').click({ position: { x: 3, y: 20 } });
  assert.ok(await page.locator('.ProseMirror .nw-shape-group.is-selected').count(), 'el grupo queda seleccionado');
  await page.locator('.ProseMirror .nw-shape-group [data-kind="textbox"] .nw-shape-text').click();
  await page.keyboard.type('Hola');
  assert.match(await page.locator('.ProseMirror .nw-shape-group [data-kind="textbox"]').innerText(), /Hola/);

  // mover con el asa de arrastre, redimensionar con el asa sureste y girar con el asa circular
  await page.locator('.ProseMirror .nw-shape-group [data-kind="rect"]').click({ position: { x: 3, y: 20 } });
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.ProseMirror .nw-shape-group.is-selected > .nw-rot').count(), 1, 'el grupo muestra su asa de giro');
  const g0 = (await tree())[0];
  const grip = await page.locator('.ProseMirror .nw-shape-group > .nw-grip').boundingBox();
  assert.ok(grip, 'el grupo flotante muestra el asa de mover');
  {
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const g1 = (await tree())[0];
    assert.deepEqual([g1.x - g0.x, g1.y - g0.y], [40, 30], 'el grupo se movió');
  }
  const tBefore = await tree();
  const se = await page.locator('.ProseMirror .nw-shape-group > [data-handle="se"]').boundingBox();
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + se.width / 2 + tBefore[0].w, se.y + se.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  t = await tree();
  assert.ok(Math.abs(t[0].w - 2 * tBefore[0].w) <= 2, `ancho ${tBefore[0].w} -> ${t[0].w}`);
  assert.equal(t[0].h, tBefore[0].h, 'el alto no cambia');
  assert.ok(Math.abs(t[1].w - 2 * tBefore[1].w) <= 2, 'las hijas se escalan con el grupo');
  assert.equal(t[1].h, tBefore[1].h);

  const rotH = await page.locator('.ProseMirror .nw-shape-group > .nw-rot').boundingBox();
  const gb = await page.locator('.ProseMirror .nw-shape-group').first().boundingBox();
  await page.mouse.move(rotH.x + rotH.width / 2, rotH.y + rotH.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(gb.x + gb.width / 2 + 150, gb.y + gb.height / 2 + 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  t = await tree();
  assert.equal(t[0].rot, 90, 'el grupo gira 90°');
  await shot('girado');

  // guardar y volver a leer el .docx
  const back = await page.evaluate(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    let g = null;
    d.body.descendants((n) => void (n.type.name === 'shape_group' && !g && (g = { w: n.attrs.width, rot: n.attrs.rotation, kids: n.childCount, text: n.textContent })));
    return g;
  });
  assert.deepEqual([back.w, back.rot, back.kids], [t[0].w, 90, 3]);
  assert.match(back.text, /Hola/);

  // desagrupar: nada se mueve a la vista, aun con el grupo girado
  const girado = await centres();
  await tabShape();
  await page.locator('[data-nv-item="writer.shape.ungroup"]').first().click();
  await page.waitForTimeout(400);
  t = await tree();
  assert.equal(t.filter((x) => x.group).length, 0, 'sin grupos');
  assert.equal(t.length, 3);
  assert.ok(near(await centres(), girado, 3), `desagrupar no mueve las formas: ${JSON.stringify(girado)} -> ${JSON.stringify(await centres())}`);
  await shot('desagrupado');
  // un solo paso de deshacer vuelve a juntarlas
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(300);
  assert.equal((await tree()).filter((x) => x.group).length, 1, 'deshacer devuelve el grupo');
  void members;
});

await check('el cuadro Formato de forma de un grupo cambia giro y tamaño, y no ofrece relleno ni contorno', async () => {
  // el grupo de la prueba anterior volvió con el último «deshacer»
  assert.equal(await page.locator('.ProseMirror .nw-shape-group').count(), 1);
  await deselect();
  await page.locator('.ProseMirror .nw-shape-group [data-kind="rect"]').click({ position: { x: 3, y: 20 } });
  await page.waitForTimeout(200);
  if ((await page.locator('[data-nv-item="writer.shape.format"]').count()) === 0 || !(await page.locator('[data-nv-item="writer.shape.format"]').first().isVisible())) await page.locator('[role=tab]').filter({ hasText: 'Formato de forma' }).click();
  await page.locator('[data-nv-item="writer.shape.format"]').first().click();
  const dlg = page.getByRole('dialog');
  assert.equal(await dlg.getByLabel('Relleno').count(), 0, 'sin relleno propio');
  assert.equal(await dlg.getByLabel('Contorno').count(), 0, 'sin contorno propio');
  const w0 = await page.evaluate(() => {
    let w = 0;
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => void (n.type.name === 'shape_group' && !w && (w = n.attrs.width)));
    return w;
  });
  await dlg.getByLabel('Rotación (grados)').fill('45');
  await dlg.getByLabel('Ancho (px)').fill(String(w0 * 2));
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => {
    let r = null;
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => {
      if (n.type.name === 'shape_group' && !r) r = { w: n.attrs.width, rot: n.attrs.rotation, first: n.child(0).attrs.width };
    });
    return r;
  });
  assert.equal(g.rot, 45);
  assert.equal(g.w, w0 * 2);
  assert.ok(g.first > 0);
});

await check('Seleccionar objetos: el recuadro elige las formas que quedan dentro, Ctrl suma, un clic en vacío deselecciona y Esc sale', async () => {
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('Texto del documento con formas.');
  await page.evaluate(() => {
    const v = window.__novaWriter.ctl.mainView;
    const type = v.state.schema.nodes.shape;
    const mk = (id, x, y, w, h) => type.create({ kind: 'rect', width: w, height: h, fill: '#bcd4f0', stroke: '#2b6cb0', strokeWidth: 1, wrap: 'front', x, y, id });
    let tr = v.state.tr;
    [mk('mA', 20, 70, 100, 60), mk('mB', 170, 130, 80, 80), mk('mC', 520, 70, 100, 60)].forEach((n) => (tr = tr.insert(1, n))); // siempre en la posición 1: en 2 caería dentro de la primera forma
    v.dispatch(tr);
  });
  await page.waitForTimeout(400);
  const ids = () => page.evaluate(() => {
    const v = window.__novaWriter.ctl.mainView;
    const sel = v.state.selection;
    const multi = window.__novaWriter.ctl.mainView.state.plugins.find((p) => p.key.startsWith('shapeSelection'))?.getState(v.state) ?? [];
    const pos = multi.length ? multi : sel.node && sel.node.type.name === 'shape' ? [sel.from] : [];
    return pos.map((p) => v.state.doc.nodeAt(p).attrs.id).sort();
  });
  // las formas se miden justo antes de cada arrastre: al elegir una, la página puede desplazarse unos píxeles
  const shapeRects = async () => {
    const r = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror .nw-shape')].map((e) => { const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, r: q.right, b: q.bottom }; }));
    return r.sort((p, q) => p.l - q.l);
  };
  assert.equal((await shapeRects()).length, 3, 'tres formas');
  const around = async (i, pad = 12) => {
    const q = (await shapeRects())[i];
    return [q.l - pad, q.t - pad, q.r + pad, q.b + pad];
  };
  const drag = async (x1, y1, x2, y2, mod) => {
    if (mod) await page.keyboard.down(mod);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 });
    await page.mouse.move(x2, y2, { steps: 4 });
    await page.mouse.up();
    if (mod) await page.keyboard.up(mod);
    await page.waitForTimeout(250);
  };
  // se activa con el comando de la cinta (Inicio › Edición › Seleccionar objetos)
  await page.getByRole('tab', { name: 'Inicio', exact: true }).click();
  if (!(await page.locator('[data-nv-item="writer.selectObjects"]').count())) await page.getByRole('button', { name: 'Edición', exact: true }).click();
  await page.locator('[data-nv-item="writer.selectObjects"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__novaWriter.ctl.selectObjects), true);
  {
    const [a1, b1] = [await around(0), await around(1)];
    await drag(a1[0], a1[1], b1[2], b1[3]);
  }
  assert.equal((await ids()).length, 2, 'A y B');
  await shot('recuadro');
  {
    const [x1, y1, x2, y2] = await around(2, 6);
    await drag(x1, y1, x2 - 26, y2);
  }
  assert.equal((await ids()).length, 0, 'un recuadro que no encierra por completo no elige nada');
  await drag(...(await around(0)));
  assert.equal((await ids()).length, 1);
  await drag(...(await around(2)), 'Control');
  assert.equal((await ids()).length, 2, 'Ctrl suma');
  {
    const c = (await shapeRects())[2];
    await drag(c.l - 250, c.t + 300, c.l - 249, c.t + 301); // dentro de la página, lejos de las formas
  }
  assert.equal((await ids()).length, 0, 'un clic en vacío deselecciona');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__novaWriter.ctl.selectObjects), false);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
