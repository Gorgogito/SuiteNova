// End-to-end checks for the review tools of Nova Writer: word count, document properties, accessibility checker, compare documents.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-writer-review.mjs [--shots dir]
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
const info = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Keyborg/.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => {
  if (/^Se marcaron|^Los dos documentos|^Hay cambios sin guardar/.test(d.message())) {
    info.push(d.message());
    d.accept().catch(() => {});
  } else {
    errors.push(`dialog: ${d.message()}`);
    d.dismiss().catch(() => {});
  }
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
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 12).join(' | ')]);
    await shot(`FAIL-${name.replace(/\W+/g, '-')}`);
  }
};
await page.goto(URL, { waitUntil: 'load' });
await page.waitForSelector('.ProseMirror');
await page.waitForTimeout(500);
const ev = (fn, arg) => page.evaluate(fn, arg);
const editor = page.locator('.ProseMirror').first();
const dialog = () => page.getByRole('dialog');
const tab = (name) => page.getByRole('tab', { name, exact: true }).click();
const ok = async () => {
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(500);
};
const cmd = async (label) => {
  const b = page.getByRole('button', { name: label, exact: true }).first();
  if (await b.isVisible().catch(() => false)) await b.click();
  else {
    await page.getByRole('button', { name: 'Documento', exact: true }).first().click();
    await page.getByRole('menuitem', { name: label }).click();
  }
  await page.waitForTimeout(500);
};
const closeDlg = async (name = 'Cerrar') => {
  await dialog().getByRole('button', { name }).click();
  await page.waitForTimeout(600);
};

await editor.click();
await page.keyboard.type('El plazo es de diez días hábiles');
await page.keyboard.press('Enter');
await page.keyboard.type('Segundo párrafo que se va');
await page.keyboard.press('Enter');
await page.keyboard.type('Tercero igual');
await page.waitForTimeout(500);
await tab('Revisar');
await shot('revisar');

await check('contar palabras: totales del documento y de la selección', async () => {
  await cmd('Contar palabras');
  assert.equal((await dialog().getByTestId('wc-Palabras').textContent()).trim(), '14');
  assert.equal((await dialog().getByTestId('wc-Párrafos con texto').textContent()).trim(), '3');
  await shot('recuento');
  await closeDlg();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Shift+Home');
  await tab('Revisar');
  await cmd('Contar palabras');
  assert.ok(await dialog().getByRole('columnheader', { name: 'Selección' }).isVisible());
  await closeDlg();
});

await check('propiedades: se guardan en el .docx y vuelven al leerlo', async () => {
  await cmd('Propiedades…');
  await dialog().getByLabel('Título', { exact: true }).fill('Informe de ventas');
  await dialog().getByLabel('Asunto').fill('Tercer trimestre');
  await dialog().getByLabel('Palabras clave').fill('ventas, 2026');
  await dialog().getByLabel('Categoría').fill('Finanzas');
  await dialog().getByLabel('Descripción').fill('Versión de prueba');
  await shot('propiedades');
  await ok();
  const back = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const d = (await w.docx.readDocx(data)).doc;
    return { title: d.title, subject: d.subject, keywords: d.keywords, category: d.category, description: d.description };
  });
  assert.deepEqual(back, { title: 'Informe de ventas', subject: 'Tercer trimestre', keywords: 'ventas, 2026', category: 'Finanzas', description: 'Versión de prueba' });
});

await check('accesibilidad: sin problemas en un documento correcto', async () => {
  await cmd('Comprobar accesibilidad');
  assert.ok(await dialog().getByTestId('a11y-ok').isVisible());
  await closeDlg();
});

await check('accesibilidad: imagen sin descripción y título que salta de nivel; «Ir» lleva al lugar', async () => {
  await ev(() => {
    const { ctl } = window.__novaWriter;
    const v = ctl.mainView;
    const s = v.state.schema;
    const img = s.nodes.image.create({ src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', alt: '' });
    const h = s.nodes.paragraph.create({ style: 'Heading1' }, s.text('Uno'));
    const h3 = s.nodes.paragraph.create({ style: 'Heading3' }, s.text('Tres'));
    const p = s.nodes.paragraph.create(null, img);
    // al final de la primera sección
    let end = 0;
    v.state.doc.forEach((n, off) => { if (!end) end = off + n.nodeSize - 1; });
    v.dispatch(v.state.tr.insert(end, [h, h3, p]));
  });
  await tab('Revisar');
  await cmd('Comprobar accesibilidad');
  const summary = await dialog().getByTestId('a11y-summary').textContent();
  assert.match(summary, /2 problemas/);
  assert.ok(await dialog().locator('li[data-kind=imageAlt]').isVisible());
  assert.ok(await dialog().locator('li[data-kind=headingSkip]').isVisible());
  await shot('accesibilidad');
  await dialog().locator('li[data-kind=headingSkip]').getByRole('button', { name: 'Ir' }).click();
  await page.waitForTimeout(600);
  const where = await ev(() => window.__novaWriter.ctl.mainView.state.selection.$from.parent.textContent);
  assert.equal(where, 'Tres');
});

await check('comparar: el resultado marca lo borrado y lo añadido con el usuario', async () => {
  // se quita lo insertado en la prueba anterior para que el «original» sea el texto de tres párrafos
  await ev(() => {
    const v = window.__novaWriter.ctl.mainView;
    let from = null;
    let end = 0;
    v.state.doc.firstChild.forEach((n, off) => {
      if (from === null && n.attrs.style === 'Heading1') from = off + 1;
      end = off + n.nodeSize;
    });
    v.dispatch(v.state.tr.delete(from, end));
  });
  const b64 = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    let s = '';
    for (const b of data) s += String.fromCharCode(b);
    return btoa(s);
  });
  const file = `${process.env.TEMP ?? '/tmp'}/nova-compare-original.docx`;
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  // ahora se edita el documento actual: «diez» pasa a «quince» y se borra el segundo párrafo
  await ev(() => {
    const v = window.__novaWriter.ctl.mainView;
    let a = null;
    v.state.doc.descendants((n, pos) => {
      if (n.isText && a === null && n.text.includes('diez')) a = pos + n.text.indexOf('diez');
    });
    v.dispatch(v.state.tr.insertText('quince', a, a + 4));
    let from = null;
    let to = null;
    v.state.doc.descendants((n, pos) => {
      if (n.type.name === 'paragraph' && n.textContent.startsWith('Segundo')) {
        from = pos;
        to = pos + n.nodeSize;
      }
    });
    v.dispatch(v.state.tr.delete(from, to));
  });
  await tab('Revisar');
  await cmd('Comparar…');
  const chooser = page.waitForEvent('filechooser');
  await dialog().getByRole('button', { name: 'Elegir archivo…' }).first().click();
  (await chooser).setFiles(file);
  await page.waitForTimeout(600);
  assert.equal((await dialog().getByTestId('cmp-original').textContent()).trim(), 'nova-compare-original.docx');
  await shot('comparar');
  await dialog().getByRole('button', { name: 'Comparar', exact: true }).click();
  await page.waitForTimeout(1500);
  const r = await ev(() => {
    const out = { ins: [], del: [], authors: new Set() };
    window.__novaWriter.ctl.state.doc.descendants((n) => {
      if (!n.isText) return true;
      for (const m of n.marks) {
        if (m.type.name === 'ins') { out.ins.push(n.text); out.authors.add(m.attrs.author); }
        if (m.type.name === 'del') { out.del.push(n.text); out.authors.add(m.attrs.author); }
      }
      return true;
    });
    return { ins: out.ins, del: out.del, authors: [...out.authors] };
  });
  // el original tenía «diez» y el segundo párrafo; el revisado tiene «quince» y no lo tiene
  assert.ok(r.del.includes('diez') && r.ins.includes('quince'), JSON.stringify(r));
  assert.ok(r.del.includes('Segundo párrafo que se va'), JSON.stringify(r));
  assert.equal(r.authors.length, 1);
  assert.ok(info.some((m) => /^Se marcaron/.test(m)), JSON.stringify(info));
  await shot('comparado');
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
