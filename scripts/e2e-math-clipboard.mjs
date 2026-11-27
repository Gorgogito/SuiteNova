// End-to-end checks for equations on the system clipboard: Writer → Notes → Slides → Calc and back, and HTML that comes from Word.
// One browser, one real clipboard. Needs `pnpm dev` on :1420. Usage: node scripts/e2e-math-clipboard.mjs [--shots dir]
import { chromium } from '../apps/suite/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BASE = process.env.NOVA_BASE ?? 'http://localhost:1420/';
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const results = [];
const errors = [];
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Keyborg|404/.test(m.text()) && errors.push(m.text()));
  page.on('dialog', (d) => {
    errors.push(`dialog: ${d.message()}`);
    d.dismiss().catch(() => {});
  });
  page.setDefaultTimeout(10000);
};
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n').filter(Boolean).slice(0, 6).join(' | ')]);
  }
};
const shot = (page, n) => (shotsDir ? page.screenshot({ path: `${shotsDir}/${n}.png` }) : Promise.resolve());
const clipboard = (page) =>
  page.evaluate(async () => {
    const out = { html: '', text: '' };
    for (const it of await navigator.clipboard.read()) {
      if (it.types.includes('text/html')) out.html = await (await it.getType('text/html')).text();
      if (it.types.includes('text/plain')) out.text = await (await it.getType('text/plain')).text();
    }
    return out;
  });

const TEX = String.raw`x=\frac{-b\pm \sqrt{b^2-4ac}}{2a}`;
const LINEAR = 'x=(-b±√(b^2-4ac))/(2a)';

// ----------------------------------------------------------------------------------------------------------------- Writer
const writer = await ctx.newPage();
watch(writer);
await writer.goto(`${BASE}?app=writer`, { waitUntil: 'load' });
await writer.waitForSelector('.ProseMirror');
await writer.waitForTimeout(500);
await writer.evaluate(() => window.__novaWriter.ctl.newDoc());
await writer.waitForTimeout(700);
const wmaths = () =>
  writer.evaluate(() => {
    const out = [];
    window.__novaWriter.ctl.mainView.state.doc.descendants((n) => void (n.type.name === 'math' && out.push({ tex: n.attrs.tex, display: n.attrs.display })));
    return out;
  });

await check('Writer: Ctrl+C con una ecuación pone en el portapapeles la ecuación de Word (OMML), el MathML y el texto lineal', async () => {
  await writer.locator('.ProseMirror').click();
  await writer.keyboard.type('Sea ');
  await writer.evaluate((tex) => {
    const v = window.__novaWriter.ctl.mainView;
    v.dispatch(v.state.tr.replaceSelectionWith(v.state.schema.nodes.math.create({ tex, display: false })));
  }, TEX);
  await writer.keyboard.press('Control+a');
  await writer.keyboard.press('Control+c');
  await writer.waitForTimeout(300);
  const c = await clipboard(writer);
  assert.ok(c.html.includes('<!--[if gte msEquation 12]>'), 'comentario de ecuación de Word');
  assert.ok(c.html.includes('http://schemas.microsoft.com/office/2004/12/omml'), 'espacio de nombres que Word entiende');
  assert.ok(c.html.includes('<m:rad>'), 'OMML con la raíz');
  // la lectura asíncrona del portapapeles pasa el HTML por el analizador de Chromium (`<![if …]>` pasa a ser un comentario): el original se comprueba con Word
  assert.ok(/<!\[if !msEquation\]>|\[if !msEquation\]/.test(c.html), 'respaldo para quien no la entiende');
  assert.ok(c.html.includes('<math'), 'MathML');
  assert.ok(c.html.includes('Sea'), 'el texto de alrededor también va');
  assert.ok(c.text.includes(LINEAR), `texto lineal: ${c.text}`);
});

// ----------------------------------------------------------------------------------------------------------------- Notes
const notes = await ctx.newPage();
watch(notes);
await notes.goto(`${BASE}?app=notes`, { waitUntil: 'load' });
await notes.waitForSelector('.nn-canvas');
await notes.waitForTimeout(600);
await check('Notes: Ctrl+V pega la ecuación de Writer como ecuación (con su código)', async () => {
  await notes.evaluate(() => window.__novaNotes.ctl.addTextBoxFree());
  await notes.waitForSelector('.nn-box__text .ProseMirror');
  await notes.locator('.nn-box__text .ProseMirror').first().click();
  await notes.keyboard.press('Control+v');
  await notes.waitForTimeout(500);
  const got = await notes.evaluate(() => {
    const out = [];
    window.__novaNotes.ctl.view.state.doc.descendants((n) => void (n.type.name === 'math' && out.push({ tex: n.attrs.tex, display: n.attrs.display })));
    return { out, text: window.__novaNotes.ctl.view.state.doc.textContent };
  });
  assert.equal(got.out.length, 1, 'una ecuación');
  assert.equal(got.out[0].tex, TEX);
  assert.ok(got.text.includes('Sea'));
  assert.ok(await notes.locator('.nn-box__text .nw-math math').count(), 'dibujada como MathML');
  await shot(notes, 'notes-pegada');
});
await check('Notes: copiar desde Notes también deja la ecuación de Word', async () => {
  await notes.locator('.nn-box__text .ProseMirror').first().click();
  await notes.keyboard.press('Control+a');
  await notes.keyboard.press('Control+c');
  await notes.waitForTimeout(300);
  const c = await clipboard(notes);
  assert.ok(c.html.includes('gte msEquation 12') && c.html.includes('<m:rad>'));
  assert.ok(c.text.includes(LINEAR));
});
await check('Notes: Insertar › Ecuación… usa el editor estructurado y deja el código LaTeX sincronizado', async () => {
  await notes.locator('.nn-box__text .ProseMirror').first().click();
  await notes.keyboard.press('Control+End');
  await notes.getByRole('tab', { name: 'Insertar', exact: true }).click();
  await notes.getByRole('button', { name: 'Ecuación…', exact: true }).click();
  const dlg = notes.getByRole('dialog');
  await dlg.locator('[data-testid=equation-editor]').waitFor();
  await dlg.locator('[data-testid=equation-editor]').click();
  await notes.keyboard.type('a^2+b^2=c^2');
  await notes.waitForTimeout(250);
  assert.equal(await dlg.locator('#nn-eq').inputValue(), 'a^2+b^2=c^2');
  await dlg.getByRole('button', { name: 'Aceptar' }).click();
  await notes.waitForTimeout(400);
  const n = await notes.evaluate(() => (JSON.stringify(window.__novaNotes.ctl.page.containers).match(/"tex":"a\^2\+b\^2=c\^2"/g) ?? []).length);
  assert.equal(n, 1);
});

// ----------------------------------------------------------------------------------------------------------------- Slides
// vuelve a copiar la de Writer, para pegarla en Slides y en Calc
await writer.bringToFront();
await writer.locator('.ProseMirror').click();
await writer.keyboard.press('Control+a');
await writer.keyboard.press('Control+c');
await writer.waitForTimeout(300);

const slides = await ctx.newPage();
watch(slides);
await slides.goto(`${BASE}?app=slides`, { waitUntil: 'networkidle' });
await slides.waitForSelector('.sl-surface');
await check('Slides: Ctrl+V pega la ecuación de Writer como cuadro de ecuación (no como imagen ni como texto)', async () => {
  await slides.evaluate(() => {
    const c = window.__novaSlides.ctl;
    c.newDoc();
    c.newSlide();
    c.goTo(1);
  });
  await slides.locator('.sl-surface').first().click({ position: { x: 20, y: 20 } });
  await slides.keyboard.press('Control+V');
  await slides.waitForTimeout(800);
  const el = await slides.evaluate(() => {
    const e = window.__novaSlides.ctl.slide.shapes.find((x) => x.kind === 'shape' && x.math);
    return e && { tex: e.math.tex, size: e.math.size, fallback: !!e.math.fallback, text: !!e.text };
  });
  assert.ok(el, 'hay un cuadro de ecuación');
  assert.equal(el.tex, TEX);
  assert.ok(el.fallback, 'con su imagen de respaldo');
  await shot(slides, 'slides-pegada');
});
await check('Slides: copiar la ecuación elegida la deja en el portapapeles como ecuación de Word y en texto lineal', async () => {
  await slides.evaluate(() => {
    const c = window.__novaSlides.ctl;
    const e = c.slide.shapes.find((x) => x.kind === 'shape' && x.math);
    c.select([e.id]);
    c.copy();
  });
  await slides.waitForTimeout(400);
  const c = await clipboard(slides);
  assert.ok(c.html.includes('gte msEquation 12') && c.html.includes('<m:rad>'), 'OMML');
  assert.equal(c.text, LINEAR);
});

// ------------------------------------------------------------------------------------------------------------------- Calc
const calc = await ctx.newPage();
watch(calc);
await calc.goto(`${BASE}?app=calc`, { waitUntil: 'load' });
await calc.waitForSelector('.calc-grid__scroller');
await calc.waitForTimeout(500);
const cshapes = () => calc.evaluate(() => window.__novaCalc.doc.sheet.shapes.map((s) => ({ id: s.id, tex: s.math?.tex, fallback: !!s.math?.fallback })));
await check('Calc: Ctrl+V pega la ecuación de Slides como cuadro de ecuación en la hoja', async () => {
  await calc.mouse.click(300, 400);
  await calc.locator('.calc-grid').focus();
  await calc.keyboard.press('Control+V');
  await calc.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 1);
  const s = (await cshapes())[0];
  assert.equal(s.tex, TEX);
  assert.ok(s.fallback, 'imagen de respaldo');
  await shot(calc, 'calc-pegada');
});
await check('Calc: Ctrl+C con la ecuación elegida la copia como ecuación y Ctrl+X la quita de la hoja', async () => {
  const id = (await cshapes())[0].id;
  await calc.evaluate((i) => window.__novaCalc.doc.x.selectObject('shape', i), id);
  await calc.locator('.calc-grid').focus();
  await calc.keyboard.press('Control+C');
  await calc.waitForTimeout(300);
  const c = await clipboard(calc);
  assert.ok(c.html.includes('gte msEquation 12'));
  assert.equal(c.text, LINEAR);
  await calc.keyboard.press('Control+X');
  await calc.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 0);
  await calc.keyboard.press('Control+V');
  await calc.waitForFunction(() => window.__novaCalc.doc.sheet.shapes.length === 1);
});

// ------------------------------------------------------------------------------------------------------------------- Mail
// los programas de correo no dibujan ecuaciones: la del mensaje se envía en formato lineal
const mail = await ctx.newPage();
watch(mail);
await mail.goto(`${BASE}?app=mail`, { waitUntil: 'load' });
await mail.waitForSelector('#root *');
await mail.waitForTimeout(600);
await check('Mail: pegar una ecuación en el cuerpo de un correo deja su formato lineal', async () => {
  await mail.evaluate(() => window.__novaMail.ctl.newMessage());
  const body = mail.getByLabel('Cuerpo del mensaje');
  await body.waitFor();
  await body.click();
  await mail.keyboard.press('Control+v');
  await mail.waitForTimeout(300);
  await mail.waitForTimeout(200);
  assert.equal(await mail.evaluate(() => window.__novaMail.ctl.compose.body.trim()), LINEAR);
});

// ----------------------------------------------------------------------------------------------------- HTML que viene de Word
const WORD =
  `<html xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"><body><!--StartFragment--><p>Antes <!--[if gte msEquation 12]><m:oMathPara><m:oMath><i style='mso-bidi-font-style:normal'><span style='font-size:12.0pt;font-family:"Cambria Math",serif'>` +
  `<m:r>x</m:r><m:r>=</m:r></span></i><m:f><m:fPr><span style='font-style:italic'><m:ctrlPr></m:ctrlPr></span></m:fPr><m:num><i><span style='font-size:12.0pt'><m:r>a</m:r></span></i></m:num>` +
  `<m:den><i><span style='font-size:12.0pt'><m:r>b</m:r></span></i></m:den></m:f></m:oMath></m:oMathPara><![endif]--><![if !msEquation]><span style='font-size:12.0pt'>` +
  `<![if !vml]><img width=39 height=36 src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" v:shapes="_x0000_i1025"><![endif]></span><![endif]> después</p><!--EndFragment--></body></html>`;
const pasteHtml = (page, selector, html) =>
  page.evaluate(
    ([sel, h]) => {
      const dt = new DataTransfer();
      dt.setData('text/html', h);
      dt.setData('text/plain', 'x=a/b');
      document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    [selector, html],
  );
await check('Writer: el HTML de Word con una ecuación se pega como ecuación (no como la imagen de respaldo)', async () => {
  await writer.bringToFront();
  await writer.evaluate(() => window.__novaWriter.ctl.newDoc());
  await writer.waitForTimeout(500);
  await writer.locator('.ProseMirror').click();
  await pasteHtml(writer, '.ProseMirror', WORD);
  await writer.waitForTimeout(500);
  const m = await wmaths();
  assert.equal(m.length, 1);
  assert.equal(m[0].tex, String.raw`x=\frac{a}{b}`);
  const text = await writer.evaluate(() => window.__novaWriter.ctl.mainView.state.doc.textContent);
  assert.ok(text.includes('Antes') && text.includes('después'));
  assert.equal(await writer.locator('.ProseMirror img').count(), 0, 'sin la imagen de respaldo');
});
await check('Notes: lo mismo con el HTML de Word', async () => {
  await notes.bringToFront();
  await notes.evaluate(() => window.__novaNotes.ctl.addTextBoxFree());
  await notes.waitForTimeout(300);
  await notes.locator('.nn-box__text .ProseMirror').last().click();
  await pasteHtml(notes, '.nn-box__text .ProseMirror:focus', WORD);
  await notes.waitForTimeout(500);
  const n = await notes.evaluate(() => {
    let k = 0;
    window.__novaNotes.ctl.view.state.doc.descendants((x) => void (x.type.name === 'math' && x.attrs.tex === String.raw`x=\frac{a}{b}` && k++));
    return k;
  });
  assert.ok(n >= 1);
});
await check('Slides: ecuación pegada desde Word (HTML) → cuadro de ecuación', async () => {
  await slides.bringToFront();
  await slides.evaluate(() => window.__novaSlides.ctl.select([]));
  await slides.evaluate((h) => {
    const dt = new DataTransfer();
    dt.setData('text/html', h);
    dt.setData('text/plain', 'x=a/b');
    document.querySelector('.sl-surface').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, WORD);
  await slides.waitForTimeout(800);
  const texs = await slides.evaluate(() => window.__novaSlides.ctl.slide.shapes.filter((x) => x.kind === 'shape' && x.math).map((x) => x.math.tex));
  assert.ok(texs.includes(String.raw`x=\frac{a}{b}`), texs.join(' | '));
});

// deja en el portapapeles una ecuación en bloque y otra en línea de Writer, para probar con Word real (COM)
await writer.bringToFront();
await writer.evaluate(() => window.__novaWriter.ctl.newDoc());
await writer.waitForTimeout(500);
await writer.locator('.ProseMirror').click();
await writer.keyboard.type('Antes ');
await writer.evaluate((tex) => {
  const v = window.__novaWriter.ctl.mainView;
  v.dispatch(v.state.tr.replaceSelectionWith(v.state.schema.nodes.math.create({ tex, display: false })));
}, TEX);
await writer.keyboard.type(' y después ');
await writer.evaluate(() => {
  const v = window.__novaWriter.ctl.mainView;
  v.dispatch(v.state.tr.replaceSelectionWith(v.state.schema.nodes.math.create({ tex: String.raw`\sum_{i=1}^{n} i^2`, display: true })));
});
// el HTML tal como lo escribe la página (la lectura asíncrona del portapapeles lo reescribe): es lo que ve Word
await writer.evaluate(() => document.addEventListener('copy', (e) => void (window.__rawCopy = e.clipboardData.getData('text/html'))));
await writer.keyboard.press('Control+a');
await writer.keyboard.press('Control+c');
await writer.waitForTimeout(400);
if (shotsDir) fs.writeFileSync(`${shotsDir}/clipboard-raw.html`, await writer.evaluate(() => window.__rawCopy ?? ''));

check.errors = errors;
if (errors.length) results.push(['FAIL', 'sin errores de consola ni diálogos', errors.slice(0, 4).join(' | ')]);
let fail = 0;
for (const [s, name, why] of results) {
  console.log(`${s === 'ok' ? 'ok ' : 'FAIL'} ${name}${why ? `\n     ${why}` : ''}`);
  if (s !== 'ok') fail++;
}
await browser.close();
process.exit(fail ? 1 : 0);
