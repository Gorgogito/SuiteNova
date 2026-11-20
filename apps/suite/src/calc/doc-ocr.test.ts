import { parseA1 } from '@suitenova/calc-engine';
import { describe, expect, it } from 'vitest';
import { CalcDoc } from './doc';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function book() {
  const d = new CalcDoc();
  d.locale = 'en';
  d.wb.setInput(d.activeSheetId, 0, 0, 'Total del mes');
  const id = d.x.insertImage('image/png', PNG, 100, 50, 'factura.png');
  const key = d.sheet.images.find((i) => i.id === id)!.media;
  d.wb.media.get(key)!.ocr = { text: 'Factura 4821\nTotal a pagar 350', lang: 'spa', at: 1 };
  d.x.selectedImage = null;
  d.selectCell(0, 0);
  return { d, id };
}

describe('the text of pictures (OCR) in Calc', () => {
  it('Find goes through the cells and then the picture whose read text matches, and only when asked', () => {
    const { d, id } = book();
    expect(d.findNext('a pagar')).toBe(false);
    expect(d.findNext('A PAGAR', { pictures: true })).toBe(true);
    expect(d.x.selectedImage).toBe(id);
    // «total» is in the cell and in the picture: next goes to the picture, and then back round to the cell
    d.selectCell(0, 0);
    expect(d.findNext('total', { pictures: true })).toBe(true);
    expect(d.x.selectedImage).toBe(id);
    expect(d.findNext('total', { pictures: true })).toBe(true);
    expect(d.x.selectedImage).toBeNull();
    expect(d.sel.active).toMatchObject({ row: 0, col: 0 });
    // replacing never touches a picture
    expect(d.replaceAll('Total', 'X', { pictures: true })).toBe(1);
    expect((d.wb.media.get(d.sheet.images[0]!.media)!.ocr as { text: string }).text).toContain('Total a pagar');
  });

  it('puts a table read from a picture in the sheet from the active cell, numbers as numbers, in one undo step', () => {
    const { d } = book();
    const at = parseA1('C3')!;
    d.selectCell(at.row, at.col);
    const n = d.insertTable([['Producto', 'Unidades', 'Precio'], ['Lápiz', '12', '3.5'], ['Cuaderno', '4', '']]);
    expect(n).toBe(8);
    const v = (a: string) => d.wb.getValue(d.activeSheetId, parseA1(a)!.row, parseA1(a)!.col);
    expect(v('C3')).toBe('Producto');
    expect(v('D4')).toBe(12);
    expect(v('E4')).toBe(3.5);
    expect(v('E5')).toBeNull();
    expect(d.sel.ranges[0]).toMatchObject({ r1: 2, c1: 2, r2: 4, c2: 4 });
    d.undo();
    expect(v('C3')).toBeNull();
    expect(v('D4')).toBeNull();
  });
});
