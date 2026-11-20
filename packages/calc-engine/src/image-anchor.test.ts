import { describe, expect, it } from 'vitest';
import { Workbook } from './workbook';
import type { SheetImage } from './objects';

const img = (anchor?: SheetImage['anchor']): SheetImage => ({ id: 'i1', media: 'm', x: 130, y: 45, width: 200, height: 70, anchor });

function book(anchor?: SheetImage['anchor']) {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  w.editObjects(id, (s) => void s.images.push(img(anchor)));
  return { w, id, get: () => w.sheet(id).images[0]! };
}

describe('imágenes que siguen a las celdas', () => {
  it('insertar filas encima mueve la imagen, con cualquier modo menos «no mover»', () => {
    for (const a of [undefined, 'oneCell', 'twoCell'] as const) {
      const b = book(a);
      b.w.shiftStructure(b.id, 'row', 0, 2);
      expect(b.get().y).toBe(45 + 2 * 20);
      expect(b.get().x).toBe(130);
    }
    const b = book('absolute');
    b.w.shiftStructure(b.id, 'row', 0, 2);
    expect(b.get().y).toBe(45);
  });

  it('cambiar el alto de una fila por encima mueve la imagen; si está dentro, solo «mover y ajustar» la estira', () => {
    const above = book('twoCell');
    above.w.editLayout(above.id, (s) => void s.rowHeights.set(0, 50));
    expect(above.get().y).toBe(45 + 30);
    expect(above.get().height).toBe(70);
    for (const [a, h] of [['twoCell', 70 + 30], ['oneCell', 70], ['absolute', 70]] as const) {
      const b = book(a);
      // la imagen va de y=45 a y=115: pasa por las filas 2 a 5 (cada una de 20)
      b.w.editLayout(b.id, (s) => void s.rowHeights.set(3, 50));
      expect(b.get().height).toBe(h);
    }
  });

  it('insertar columnas a la izquierda mueve la imagen y borrarlas la acerca al borde sin pasar de donde estaba la celda', () => {
    const b = book('twoCell');
    b.w.shiftStructure(b.id, 'col', 0, 1);
    expect(b.get().x).toBe(130 + 64);
    b.w.shiftStructure(b.id, 'col', 0, -1);
    expect(b.get().x).toBe(130);
  });

  it('deshacer devuelve la posición y el tamaño', () => {
    const b = book('twoCell');
    const patch = b.w.editLayout(b.id, (s) => void s.rowHeights.set(3, 50));
    expect(b.get().height).toBe(100);
    b.w.applyPatch(patch, true);
    expect(b.get().height).toBe(70);
  });
});
