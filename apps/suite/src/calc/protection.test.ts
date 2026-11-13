import { parseA1, type Scalar } from '@suitenova/calc-engine';
import { describe, expect, it } from 'vitest';
import { CalcDoc } from './doc';

function setup(cells: Record<string, string> = {}) {
  const d = new CalcDoc();
  d.locale = 'en';
  const id = d.activeSheetId;
  const at = (a: string) => parseA1(a)!;
  const sel = (a: string, b?: string) => {
    const p = at(a);
    const q = b ? at(b) : p;
    d.selectRange({ r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) }, { row: p.row, col: p.col });
  };
  const type = (a: string, t: string) => {
    sel(a);
    d.beginEdit({ text: t });
    return d.commitEdit();
  };
  for (const [a, t] of Object.entries(cells)) type(a, t);
  const get = (a: string): Scalar => d.wb.getValue(id, at(a).row, at(a).col);
  return { d, id, sel, type, get };
}

describe('protección de hoja', () => {
  it('no deja escribir en celdas bloqueadas, sí en las desbloqueadas', () => {
    const { d, sel, type, get } = setup({ A1: '1', B1: '2' });
    sel('B1');
    d.applyStyle({ locked: false });
    d.prot.protectSheet(d.activeSheetId, undefined, null);
    type('A1', '99');
    expect(get('A1')).toBe(1);
    expect(d.notice).toContain('protegida');
    type('B1', '7');
    expect(get('B1')).toBe(7);
  });

  it('bloquea borrar, pegar, rellenar y dar formato según lo permitido', () => {
    const { d, sel, get } = setup({ A1: '5', A2: '6' });
    d.prot.protectSheet(d.activeSheetId, undefined, null);
    sel('A1');
    d.clearContents();
    expect(get('A1')).toBe(5);
    sel('A1', 'A2');
    d.fillDown();
    expect(get('A2')).toBe(6);
    d.applyStyle({ bold: true });
    expect(d.wb.getStyle(d.activeSheetId, 0, 0).bold).toBeUndefined();
    d.prot.protectSheet(d.activeSheetId, { selectLocked: true, selectUnlocked: true, formatCells: true }, null);
    d.applyStyle({ bold: true });
    expect(d.wb.getStyle(d.activeSheetId, 0, 0).bold).toBe(true);
  });

  it('insertar y eliminar filas, ordenar y gráficos dependen de la configuración', () => {
    const { d, sel } = setup({ A1: '3', A2: '1', A3: '2' });
    d.prot.protectSheet(d.activeSheetId, undefined, null);
    sel('A2');
    d.insertRows();
    expect(d.wb.getValue(d.activeSheetId, 2, 0)).toBe(2);
    d.sortRange({ r1: 0, c1: 0, r2: 3, c2: 0 }, 0, true, false);
    expect(d.wb.getValue(d.activeSheetId, 0, 0)).toBe(3);
    expect(d.insertChart('column')).toContain('protegida'); // el texto es el motivo del fallo; null significa que se creó
    expect(d.sheet.charts.length).toBe(0);
    d.prot.unprotectSheet(d.activeSheetId, '');
    d.insertRows();
    expect(d.wb.getValue(d.activeSheetId, 2, 0)).toBe(1);
  });

  it('la contraseña hace falta para desproteger', () => {
    const { d } = setup({ A1: '1' });
    const id = d.activeSheetId;
    d.prot.protectSheet(id, undefined, 'clave');
    expect(d.prot.unprotectSheet(id, 'mala')).toBe(false);
    expect(d.prot.isProtected()).toBe(true);
    expect(d.prot.unprotectSheet(id, 'clave')).toBe(true);
    expect(d.prot.isProtected()).toBe(false);
  });

  it('una fórmula en una celda oculta no se muestra en la barra de fórmulas', () => {
    const { d, sel, id } = setup({ A1: '2', B1: '=A1*3' });
    sel('B1');
    d.applyStyle({ hidden: true });
    expect(d.editText(id, 0, 1)).toBe('=A1*3');
    d.prot.protectSheet(id, undefined, null);
    expect(d.editText(id, 0, 1)).toBe('');
  });

  it('reemplazar todo respeta las celdas bloqueadas', () => {
    const { d, sel, get } = setup({ A1: 'foo', A2: 'foo' });
    sel('A2');
    d.applyStyle({ locked: false });
    d.prot.protectSheet(d.activeSheetId, undefined, null);
    expect(d.replaceAll('foo', 'bar')).toBe(1);
    expect(get('A1')).toBe('foo');
    expect(get('A2')).toBe('bar');
  });
});

describe('protección del libro', () => {
  it('con la estructura protegida no se añaden, borran ni renombran hojas', () => {
    const { d } = setup();
    d.prot.protectWorkbook('libro');
    d.addSheet();
    expect(d.wb.sheets.length).toBe(1);
    expect(d.renameSheet(d.activeSheetId, 'Otra')).toContain('protegida');
    d.deleteSheet(d.activeSheetId);
    expect(d.wb.sheets.length).toBe(1);
    expect(d.prot.unprotectWorkbook('x')).toBe(false);
    expect(d.prot.unprotectWorkbook('libro')).toBe(true);
    d.addSheet();
    expect(d.wb.sheets.length).toBe(2);
  });
});
