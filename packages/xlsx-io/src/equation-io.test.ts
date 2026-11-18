import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { Workbook, type SheetMath } from '@suitenova/calc-engine';
import { readXlsx, writeXlsx } from './index';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const TEX = String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`;

function book(math: SheetMath, withPicture = false) {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  const fallback = withPicture ? w.addMedia('image/png', PNG) : undefined;
  w.editObjects(id, (s) => void s.shapes.push({ id: 'eq1', kind: 'textBox', x: 40, y: 30, width: 220, height: 60, fill: null, line: null, name: 'Ecuación', math: { ...math, ...(fallback ? { fallback } : {}) } }));
  return w;
}
const drawing = async (bytes: Uint8Array) => (await JSZip.loadAsync(bytes)).file('xl/drawings/drawing1.xml')!.async('string');
const back = async (bytes: Uint8Array) => (await readXlsx(bytes)).workbook.sheets[0]!.shapes;

describe('xlsx equations', () => {
  it('writes an equation as a text box with a14:m and the picture as fallback, and reads it back', async () => {
    const bytes = await writeXlsx(book({ tex: TEX, display: true, size: 20 }, true));
    const xml = await drawing(bytes);
    expect(xml).toContain('<mc:Choice');
    expect(xml).toContain('Requires="a14"');
    expect(xml).toContain('<a14:m>');
    expect(xml).toContain('<m:oMathPara');
    expect(xml).toContain('<m:f>');
    expect(xml).toContain('sz="2000"');
    expect(xml).toContain('<xdr:pic>');
    const shapes = await back(bytes);
    expect(shapes).toHaveLength(1);
    expect(shapes[0]!.math!.tex).toBe(String.raw`x=\frac{-b\pm \sqrt{b^2-4ac}}{2a}`);
    expect(shapes[0]!.math!.display).toBe(true);
    expect(shapes[0]!.math!.size).toBe(20);
    expect(shapes[0]!.math!.fallback).toBeTruthy();
    expect(shapes[0]!.text).toBeUndefined();
    expect(Math.abs(shapes[0]!.width - 220)).toBeLessThan(2);
  });

  it('writes without a picture when there is none', async () => {
    const bytes = await writeXlsx(book({ tex: String.raw`\sum_{i=1}^{n} i`, size: 14 }));
    const xml = await drawing(bytes);
    expect(xml).not.toContain('<xdr:pic>');
    expect((await back(bytes))[0]!.math!.tex).toContain(String.raw`\sum`);
  });

  it('keeps the original OMML while formula and size are not edited and regenerates it when they are', async () => {
    const first = await writeXlsx(book({ tex: 'a+b', size: 14 }));
    const zip = await JSZip.loadAsync(first);
    const original = '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><a:rPr lang="en-US" sz="3600" b="1"><a:latin typeface="Cambria Math"/></a:rPr><m:t>𝑎+𝑏</m:t></m:r></m:oMath>';
    zip.file('xl/drawings/drawing1.xml', (await zip.file('xl/drawings/drawing1.xml')!.async('string')).replace(/<m:oMath[\s\S]*<\/m:oMath>/, original));
    const edited = await zip.generateAsync({ type: 'uint8array' });
    const w = (await readXlsx(edited)).workbook;
    const m = w.sheets[0]!.shapes[0]!.math!;
    expect(m.tex).toBe('a+b');
    expect(m.size).toBe(36);
    const again = await drawing(await writeXlsx(w));
    expect(again).toContain('sz="3600" b="1"');
    expect(again).toMatch(/<m:oMath xmlns:m="[^"]+">/);
    w.editObjects(w.sheets[0]!.id, (s) => void (s.shapes[0]!.math = { ...m, tex: 'a-b' }));
    const changed = await drawing(await writeXlsx(w));
    expect(changed).not.toContain('b="1"');
    expect(changed).toContain('<m:t xml:space="preserve">-</m:t>');
  });
});
