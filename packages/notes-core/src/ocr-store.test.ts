import { describe, expect, it } from 'vitest';
import { newNotebook, parseNotebook, serializeNotebook } from './index';

const words = (t: string) => ({ text: t, lang: 'spa+eng', at: 5, size: [300, 100] as [number, number], confidence: 88, lines: [[10, 10, 200, 20, [['Factura', 10, 10, 90, 20, 90], ['número', 110, 10, 100, 20, 86]]]] as never });

describe('el texto reconocido de las imágenes en el cuaderno', () => {
  it('un cuaderno anterior, que solo guardaba el texto, se sigue abriendo', () => {
    const nb = newNotebook('Viejo');
    const raw = JSON.parse(JSON.stringify(nb));
    raw.ocr = { a1: { text: 'Texto de antes', lang: 'spa', at: 1 }, a2: { text: 'del pdf', lang: 'pdf', at: 2 } };
    const back = parseNotebook(JSON.stringify(raw));
    expect(back.ocr.a1).toEqual({ text: 'Texto de antes', lang: 'spa', at: 1 });
    expect(back.ocr.a2!.lang).toBe('pdf');
  });

  it('el texto con las palabras y sus cajas ida y vuelta, también cifrado y serializado', async () => {
    const nb = newNotebook('Nuevo');
    nb.ocr.a1 = words('Factura número');
    const back = parseNotebook(await serializeNotebook(nb));
    expect(back.ocr.a1!.text).toBe('Factura número');
    expect(back.ocr.a1!.lines![0]![4].map((w) => w[0])).toEqual(['Factura', 'número']);
    expect(back.ocr.a1!.size).toEqual([300, 100]);
    expect(back.ocr.a1!.confidence).toBe(88);
  });

  it('lo dañado se descarta sin estropear el resto del cuaderno', () => {
    const nb = newNotebook('Roto');
    const raw = JSON.parse(JSON.stringify(nb));
    raw.ocr = { ok: words('bien'), mal: 'basura', sinTexto: { lang: 'spa' }, medio: { ...words('medio'), lines: [5, [1, 2, 3, 4, [['x', 'y', 1, 1, 1, 1]]]] } };
    const back = parseNotebook(JSON.stringify(raw));
    expect(Object.keys(back.ocr).sort()).toEqual(['medio', 'ok']);
    expect(back.ocr.medio!.text).toBe('medio');
    expect(back.ocr.medio!.lines ?? []).toEqual([]);
  });
});
