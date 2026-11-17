import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { newDeck, newId } from '../defaults';
import type { ShapeEl } from '../types';
import { readPptx } from './read';
import { writePptx } from './write';

const TEX = String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`;
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const box = (deck: ReturnType<typeof newDeck>, math: ShapeEl['math']): ShapeEl => {
  const el: ShapeEl = { kind: 'shape', id: newId(), name: 'Ecuación', descr: 'x', isTextBox: true, xfrm: { x: 100, y: 120, w: 240, h: 60 }, math };
  deck.slides[0]!.shapes.push(el);
  return el;
};
const slideXml = async (data: Uint8Array) => (await JSZip.loadAsync(data)).file('ppt/slides/slide1.xml')!.async('string');
const mathOf = async (data: Uint8Array) => (await readPptx(data)).deck.slides[0]!.shapes.find((s): s is ShapeEl => s.kind === 'shape' && !!s.math)!;

describe('pptx equations', () => {
  it('writes an equation as text (a14:m) with the picture as fallback and reads it back', async () => {
    const deck = newDeck();
    deck.assets.eq1 = { id: 'eq1', mime: 'image/png', data: PNG, name: 'ecuacion.png' };
    box(deck, { tex: TEX, display: true, size: 28, fallback: 'eq1' });
    const out = await writePptx(deck);
    const xml = await slideXml(out.data);
    expect(xml).toContain('<mc:Choice Requires="a14">');
    expect(xml).toContain('<a14:m>');
    expect(xml).toContain('<m:oMathPara');
    expect(xml).toContain('<m:f>');
    expect(xml).toContain('<a:rPr lang="es-ES" sz="2800"');
    expect(xml).toContain('<mc:Fallback><p:pic>');
    const back = await mathOf(out.data);
    expect(back.math!.tex).toBe(String.raw`x=\frac{-b\pm \sqrt{b^2-4ac}}{2a}`);
    expect(back.math!.display).toBe(true);
    expect(back.math!.size).toBe(28);
    expect(back.math!.fallback).toBeTruthy();
    expect(back.text).toBeUndefined();
  });

  it('keeps the original OMML (fonts, sizes, bold) while the formula is not edited, and regenerates it when it is', async () => {
    const deck = newDeck();
    box(deck, { tex: 'a+b', display: false, size: 24 });
    const out = await writePptx(deck);
    const zip = await JSZip.loadAsync(out.data);
    const original = '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><a:rPr lang="en-US" sz="3600" b="1"><a:latin typeface="Cambria Math"/></a:rPr><m:t>a+b</m:t></m:r></m:oMath>';
    const xml = (await zip.file('ppt/slides/slide1.xml')!.async('string')).replace(/<m:oMath[\s\S]*<\/m:oMath>/, original);
    zip.file('ppt/slides/slide1.xml', xml);
    const edited = await zip.generateAsync({ type: 'uint8array' });
    const read = await mathOf(edited);
    expect(read.math!.tex).toBe('a+b');
    expect(read.math!.size).toBe(36);
    const again = await slideXml((await writePptx((await readPptx(edited)).deck)).data);
    expect(again).toContain('sz="3600" b="1"');
    expect(again).toMatch(/<m:oMath xmlns:m="[^"]+">/);
    expect(await readPptx((await writePptx((await readPptx(edited)).deck)).data).then((r) => r.warnings)).toEqual([]);
    const deck2 = (await readPptx(edited)).deck;
    (deck2.slides[0]!.shapes.find((s): s is ShapeEl => s.kind === 'shape' && !!s.math)!.math!).tex = 'a-b';
    const changed = await slideXml((await writePptx(deck2)).data);
    expect(changed).not.toContain('b="1"');
    expect(changed).toContain('<m:t xml:space="preserve">-</m:t>');
  });

  it('writes well-formed XML without a fallback picture', async () => {
    const deck = newDeck();
    box(deck, { tex: String.raw`\sum_{i=1}^{n} i`, size: 18 });
    const out = await writePptx(deck);
    const xml = await slideXml(out.data);
    expect(xml).toContain('<mc:Fallback/>');
    expect((await mathOf(out.data)).math!.tex).toContain(String.raw`\sum`);
  });
  it('writes a matrix and reads it back with its rows, and the letters PowerPoint saves as math italic come back plain', async () => {
    const deck = newDeck();
    box(deck, { tex: String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, size: 24 });
    const out = await writePptx(deck);
    expect((await mathOf(out.data)).math!.tex).toBe(String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`);
    const zip = await JSZip.loadAsync(out.data);
    const xml = (await zip.file('ppt/slides/slide1.xml')!.async('string')).replace(/<m:oMath[\s\S]*<\/m:oMath>/, '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><a:rPr lang="es-ES" i="1"/><m:t>𝑥+𝑦</m:t></m:r></m:oMath>');
    zip.file('ppt/slides/slide1.xml', xml);
    expect((await mathOf(await zip.generateAsync({ type: 'uint8array' }))).math!.tex).toBe('x+y');
  });
});
