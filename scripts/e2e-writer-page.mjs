// End-to-end checks for page options in Nova Writer: page colour, page borders, line numbers, hyphenation, column breaks, cover pages.
// Needs `pnpm dev` on :1420.  Usage: node scripts/e2e-writer-page.mjs [--shots dir]
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
  d.dismiss();
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
const menu = async (group, item) => {
  await page.getByRole('button', { name: group }).first().click();
  await page.getByRole('menuitem', { name: item }).click();
  await page.waitForTimeout(400);
};
const ok = async () => {
  await dialog().getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForTimeout(500);
};
const section0 = () => ev(() => { let r; window.__novaWriter.ctl.state.doc.forEach((n) => { if (!r) r = n.attrs; }); return r; });
const roundTrip = () =>
  ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const back = await w.docx.readDocx(data);
    return { color: back.doc.pageColor, hyph: back.doc.autoHyphenate, sec: back.doc.body.firstChild.attrs };
  });

await editor.click();
for (let i = 1; i <= 6; i++) {
  await page.keyboard.type(`Línea de prueba número ${i}`);
  await page.keyboard.press('Enter');
}
await page.keyboard.type('Última');
await page.waitForTimeout(500);
await tab('Diseño');

await check('color de página: el papel se pinta y se guarda en .docx', async () => {
  await page.getByRole('button', { name: 'Color de página' }).click();
  await page.getByRole('button', { name: '#fff2cc' }).first().click().catch(async () => {
    // la paleta puede no tener ese tono: se toma el primero
    await page.locator('.nv-swatches button').nth(5).click();
  });
  await page.waitForTimeout(400);
  const col = await ev(() => window.__novaWriter.ctl.pageColor);
  assert.ok(col, 'sin color');
  const bg = await page.locator('.nw-page').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.notEqual(bg, 'rgb(255, 255, 255)');
  await shot('color-de-pagina');
  assert.equal((await roundTrip()).color, col);
  await page.getByRole('button', { name: 'Color de página' }).click();
  await page.getByRole('button', { name: 'Sin color de página' }).click();
  await page.waitForTimeout(300);
  assert.equal(await ev(() => window.__novaWriter.ctl.pageColor), null);
  assert.equal(await page.locator('.nw-page').first().evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
});

await check('bordes de página: diálogo, dibujo en cada página y .docx', async () => {
  await page.getByRole('button', { name: /^Bordes de página/ }).click();
  await page.waitForTimeout(300);
  await dialog().getByLabel('Dibujar un borde alrededor de la página').check();
  await dialog().locator('#pb-style').selectOption('double');
  await dialog().locator('#pb-color').fill('#cc0000');
  await dialog().locator('#pb-width').fill('2');
  await dialog().locator('#pb-off').fill('20');
  await shot('bordes-dialogo');
  await ok();
  const attrs = await section0();
  assert.deepEqual(attrs.borders, { style: 'double', color: '#cc0000', width: 2, offset: 20, from: 'page' });
  const info = await page.locator('.nw-page-border').first().evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopStyle, s.borderTopColor, el.getBoundingClientRect().width < el.parentElement.getBoundingClientRect().width]; });
  assert.deepEqual(info, ['double', 'rgb(204, 0, 0)', true]);
  await shot('bordes');
  assert.deepEqual((await roundTrip()).sec.borders, attrs.borders);
});

await check('números de línea: se numera cada línea, reinicia por página y se puede suprimir en un párrafo', async () => {
  await page.getByRole('button', { name: /^Números de línea/ }).click();
  await page.getByRole('menuitem', { name: /Reiniciar en cada página/ }).click();
  await page.waitForTimeout(700);
  await shot('numeros-de-linea');
  const nums = await page.locator('.nw-ln').allInnerTexts();
  assert.deepEqual(nums, ['1', '2', '3', '4', '5', '6', '7']);
  // los números están a la izquierda del texto y alineados con la línea
  const geo = await ev(() => {
    const n = document.querySelector('.nw-ln').getBoundingClientRect();
    const p = document.querySelector('.ProseMirror p.nw-p').getBoundingClientRect();
    return { right: n.right <= p.left + 1, dy: Math.abs((n.top + n.height / 2) - (p.top + p.height / 2)) };
  });
  assert.equal(geo.right, true);
  assert.ok(geo.dy < 8, `desajuste vertical ${geo.dy}`);
  // suprimir en el párrafo del cursor
  await editor.click();
  await page.keyboard.press('Control+Home');
  await page.getByRole('button', { name: /^Números de línea/ }).click();
  await page.getByRole('menuitem', { name: /Suprimir en el párrafo actual/ }).click();
  await page.waitForTimeout(600);
  assert.deepEqual(await page.locator('.nw-ln').allInnerTexts(), ['1', '2', '3', '4', '5', '6']);
  assert.equal((await roundTrip()).sec.lineNumbers.restart, 'newPage');
  // opciones: contar de 2 en 2, empezar en 1
  await page.getByRole('button', { name: /^Números de línea/ }).click();
  await page.getByRole('menuitem', { name: /Opciones de números de línea/ }).click();
  await page.waitForTimeout(300);
  await dialog().locator('#ln-by').fill('2');
  await ok();
  assert.deepEqual(await page.locator('.nw-ln').allInnerTexts(), ['2', '4', '6']);
  await page.getByRole('button', { name: /^Números de línea/ }).click();
  await page.getByRole('menuitem', { name: /^Ninguno/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.nw-ln').count(), 0);
});

await check('división automática: se activa, se aplica al editor y se guarda en .docx', async () => {
  await page.getByRole('button', { name: /^División silábica/ }).click();
  await page.getByRole('menuitem', { name: /^Automática/ }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.ProseMirror.nw-hyphens').count(), 1);
  assert.equal(await page.locator('.ProseMirror').first().getAttribute('lang'), 'es');
  const cs = await page.locator('.ProseMirror p.nw-p').first().evaluate((el) => getComputedStyle(el).hyphens);
  assert.equal(cs, 'auto');
  assert.equal((await roundTrip()).hyph, true);
  // ¿divide de verdad? (depende del diccionario del navegador: se informa, no se exige)
  const splits = await ev(() => {
    const d = document.createElement('div');
    d.lang = 'es';
    d.style.cssText = 'position:fixed;left:0;top:0;width:70px;font:16px sans-serif;hyphens:auto;overflow-wrap:normal';
    d.textContent = 'electroencefalografista anticonstitucionalmente';
    document.body.appendChild(d);
    const h = d.getBoundingClientRect().height;
    d.remove();
    return h > 16 * 1.5 * 3;
  });
  console.log(`      (información) el navegador ${splits ? 'SÍ' : 'NO'} divide palabras con hyphens:auto en español`);
  await page.getByRole('button', { name: /^División silábica/ }).click();
  await page.getByRole('menuitem', { name: /^Sin guiones/ }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.ProseMirror.nw-hyphens').count(), 0);
});

await check('el guion opcional se inserta y sobrevive al .docx', async () => {
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.getByRole('button', { name: /^División silábica/ }).click();
  await page.getByRole('menuitem', { name: /Insertar guion opcional/ }).click();
  await page.waitForTimeout(300);
  const out = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const back = await w.docx.readDocx(data);
    let last = '';
    back.doc.body.firstChild.forEach((n) => { last = n.textContent; });
    return last;
  });
  assert.ok(out.endsWith('­'), JSON.stringify(out));
});

await check('dividir palabras ahora: pone guiones opcionales y la palabra larga ya se parte en una columna estrecha', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await page.waitForTimeout(500);
  await editor.click();
  await page.keyboard.type('electroencefalografistaanticonstitucionalmente');
  await tab('Diseño');
  await page.getByRole('button', { name: /^Columnas/ }).click();
  await page.getByRole('menuitem', { name: /^Tres/ }).click().catch(async () => {
    await page.getByRole('menuitem', { name: /3/ }).first().click();
  });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^División silábica/ }).click();
  await page.getByRole('menuitem', { name: /^Dividir palabras ahora/ }).click();
  await page.waitForTimeout(600);
  const txt = await ev(() => window.__novaWriter.ctl.state.doc.textContent);
  assert.ok(txt.includes('­') && txt.replace(/­/g, '') === 'electroencefalografistaanticonstitucionalmente', JSON.stringify(txt));
  // la palabra se parte justo detrás de un guion opcional (y no en mitad de una sílaba)
  const breaks = await page.locator('.ProseMirror p.nw-p').first().evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out = [];
    let prev = null;
    let last = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.length; i++) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        const rect = r.getClientRects()[0];
        if (rect && rect.width > 0) {
          if (prev !== null && rect.top > prev + 4) out.push(last);
          prev = rect.top;
        }
        last = node.data[i];
      }
    }
    return out;
  });
  assert.ok(breaks.length >= 1, 'la palabra no se parte en varias líneas');
  assert.ok(breaks.every((c) => c === '­'), JSON.stringify(breaks));
  await shot('guiones-opcionales');
  await page.getByRole('button', { name: /^División silábica/ }).click();
  await page.getByRole('menuitem', { name: /^Quitar los guiones opcionales/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await ev(() => window.__novaWriter.ctl.state.doc.textContent), 'electroencefalografistaanticonstitucionalmente');
});

await check('salto de columna: el párrafo pasa a la columna siguiente', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await page.waitForTimeout(500);
  await editor.click();
  await page.keyboard.type('Primero');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Segundo');
  await tab('Diseño');
  await page.getByRole('button', { name: /^Columnas/ }).click();
  await page.getByRole('menuitem', { name: /^Dos/ }).click().catch(async () => {
    await page.getByRole('menuitem', { name: /2/ }).first().click();
  });
  await page.waitForTimeout(600);
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.getByRole('button', { name: /^Saltos/ }).first().click();
  await page.getByRole('menuitem', { name: /^Columna/ }).click();
  await page.waitForTimeout(600);
  await shot('salto-de-columna');
  const xs = await page.locator('.ProseMirror p.nw-p').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  assert.ok(xs[1] > xs[0] + 100, JSON.stringify(xs));
  assert.equal(await page.locator('.ProseMirror p[data-col-break]').count(), 1);
});

await check('portadas: se inserta al principio, se sustituye y se quita', async () => {
  await ev(() => window.__novaWriter.ctl.newDoc());
  await page.waitForTimeout(500);
  await editor.click();
  await page.keyboard.type('Cuerpo del documento');
  await tab('Insertar');
  await menu('Portada', /Portada: Banda/);
  await shot('portada');
  const first = () => ev(() => { const s = window.__novaWriter.ctl.state.doc.firstChild; return [s.child(0).attrs.style, s.child(0).textContent, s.childCount, s.child(4).type.name]; });
  assert.deepEqual(await first(), ['CoverTitle', 'Título del documento', 6, 'page_break']);
  assert.ok((await ev(() => window.__novaWriter.ctl.pageSpecs.length)) >= 2, 'el cuerpo debe quedar en otra página');
  await page.getByRole('button', { name: /^Portada/ }).first().click();
  await page.getByRole('menuitem', { name: /Portada: Clásica/ }).click();
  await page.waitForTimeout(500);
  assert.equal((await first())[2], 6); // la anterior se sustituye
  const rt = await ev(async () => {
    const w = window.__novaWriter;
    const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc());
    const back = await w.docx.readDocx(data);
    return back.doc.body.firstChild.child(0).attrs.style;
  });
  assert.equal(rt, 'CoverTitle');
  await page.getByRole('button', { name: /^Portada/ }).first().click();
  await page.getByRole('menuitem', { name: /Quitar la portada/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await ev(() => window.__novaWriter.ctl.state.doc.firstChild.childCount), 1);
});

await check('sin errores de consola', async () => {
  assert.deepEqual(errors, []);
});

for (const r of results) console.log(r[0] === 'ok' ? '  ✔' : '  ✘', r[1], r[2] ? `\n      ${r[2]}` : '');
await browser.close();
if (results.some((r) => r[0] !== 'ok')) process.exit(1);
