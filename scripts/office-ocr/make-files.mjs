// Makes a .docx, a .pptx and an .xlsx whose pictures carry the text read from them (OCR), with the real Tesseract engine, for the checks against the
// real Word, PowerPoint and Excel (`check-office.ps1`). Needs `pnpm dev` on :1420.  Usage: node scripts/office-ocr/make-files.mjs <folder>
import { chromium } from '../../apps/suite/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'scripts/office-ocr/out');
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-gpu'] });
const open = async (app, ready) => {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  page.setDefaultTimeout(180000);
  await page.goto(`http://localhost:1420/?app=${app}`, { waitUntil: 'load' });
  await page.waitForFunction(ready, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  return page;
};
const drawPng = (page) =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 700; c.height = 220;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 700, 220);
    g.fillStyle = '#000'; g.textBaseline = 'top'; g.font = '48px Arial';
    g.fillText('Factura número 4821', 30, 30);
    g.fillText('Total a pagar 350 euros', 30, 120);
    return c.toDataURL('image/png');
  });
const save = (name, b64) => fs.writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));

// Writer
{
  const page = await open('writer', () => !!window.__novaWriter);
  const uri = await drawPng(page);
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Texto del documento antes de la imagen.');
  await page.evaluate((src) => {
    const v = window.__novaWriter.ctl.mainView;
    let pos = null;
    v.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph' && pos === null) pos = p + 1; });
    v.dispatch(v.state.tr.insert(pos, v.state.schema.nodes.image.create({ src, alt: 'Una factura', width: 350, height: 110 })));
  }, uri);
  await page.waitForFunction(() => { let k = 0; window.__novaWriter.ctl.mainState.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.ocr) k++; }); return k > 0; }, null, { timeout: 120000 });
  const b64 = await page.evaluate(async () => { const w = window.__novaWriter; const { data } = await w.docx.writeDocx(w.ctl.toWriterDoc()); let s = ''; for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000)); return btoa(s); });
  save('ocr.docx', b64);
  await page.close();
}
// Slides
{
  const page = await open('slides', () => !!window.__novaSlides);
  const uri = await drawPng(page);
  await page.evaluate((b64) => window.__novaSlides.ctl.emit('files', [new File([Uint8Array.from(atob(b64), (x) => x.charCodeAt(0))], 'factura.png', { type: 'image/png' })]), uri.split(',')[1]);
  await page.waitForFunction(() => { const d = window.__novaSlides.ctl.realDeck; return Object.values(d.assets).some((a) => a.ocr); }, null, { timeout: 120000 });
  const b64 = await page.evaluate(async () => { const data = await window.__novaSlides.write(); let s = ''; for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.slice(i, i + 0x8000)); return btoa(s); });
  save('ocr.pptx', b64);
  await page.close();
}
// Calc
{
  const page = await open('calc', () => !!window.__novaCalc);
  const uri = await drawPng(page);
  await page.evaluate(async (uri) => {
    const d = window.__novaCalc.doc;
    d.selectCell(0, 0);
    d.wb.setInput(d.activeSheetId, 0, 0, 'Total del mes');
    const bytes = Uint8Array.from(atob(uri.split(',')[1]), (x) => x.charCodeAt(0));
    d.selectCell(2, 1);
    d.x.insertImage('image/png', bytes, 350, 110, 'factura');
  }, uri);
  await page.waitForFunction(() => { const d = window.__novaCalc.doc; return [...d.wb.media.values()].some((m) => m.ocr); }, null, { timeout: 120000 });
  const b64 = await page.evaluate(async () => { const { writeXlsx } = await import('/@fs/D:/ProjectsIA/SuiteNova/packages/xlsx-io/src/index.ts'); const data = await writeXlsx(window.__novaCalc.doc.wb); let s = ''; for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000)); return btoa(s); });
  save('ocr.xlsx', b64);
  await page.close();
}
await browser.close();
console.log('listo:', fs.readdirSync(dir).join(', '), 'en', dir);
