import { parseA1, type Rect } from '@suitenova/calc-engine';
import { describe, expect, it } from 'vitest';
import { MacroRecorder } from '../macros/recorder';
import { CalcDoc } from './doc';
import { CalcRecorder } from './recorder';

const rect = (a: string): Rect => {
  const [x, y] = a.split(':') as [string, string?];
  const p = parseA1(x)!;
  const q = parseA1(y ?? x)!;
  return { r1: p.row, c1: p.col, r2: q.row, c2: q.col };
};
const fresh = () => {
  const d = new CalcDoc();
  d.locale = 'en';
  d.contentEnabled = true;
  return d;
};
const type = (d: CalcDoc, at: string, text: string, move: 'down' | 'right' | 'none' = 'down') => {
  const p = parseA1(at)!;
  d.selectCell(p.row, p.col);
  d.beginEdit({ text, mode: 'enter' });
  d.commitEdit(move);
};

/** Records what `act` does in a workbook and returns the macro. */
function record(act: (d: CalcDoc) => void, name = 'Grabada') {
  const d = fresh();
  const rec = new MacroRecorder(name);
  const r = new CalcRecorder(rec, d);
  act(d);
  r.stop();
  return { d, code: rec.code(), rec };
}

/** Plays a macro in a new workbook. */
function replay(code: string) {
  const d = fresh();
  d.wb.macros = [{ name: 'Modulo1', code }];
  const res = d.macros.run('Grabada');
  return { d, res };
}

/** What a workbook holds: the typed text and the style of every used cell. */
function snapshot(d: CalcDoc) {
  const out: Record<string, unknown> = {};
  const used = d.wb.usedRange(d.activeSheetId);
  if (!used) return out;
  for (let r = used.r1; r <= used.r2; r++)
    for (let c = used.c1; c <= used.c2; c++) {
      const text = d.wb.getInputText(d.activeSheetId, r, c);
      const style = d.wb.getStyle(d.activeSheetId, r, c);
      if (text !== '' || Object.keys(style).length) out[`${r},${c}`] = { text, style };
    }
  return out;
}

const same = (code: string, d: CalcDoc) => {
  const { d: b, res } = replay(code);
  expect(res.error ?? '').toBe('');
  expect(snapshot(b)).toEqual(snapshot(d));
};

describe('grabadora de macros de Calc', () => {
  it('lo escrito en las celdas, con números, texto y fórmulas', () => {
    const { d, code } = record((d) => {
      type(d, 'A1', 'Producto');
      type(d, 'B1', '10');
      type(d, 'B2', '20');
      type(d, 'B3', '=SUM(B1:B2)');
    });
    expect(code).toContain('Range("A1").Value = "Producto"');
    expect(code).toContain('Range("B1").Value = "10"');
    expect(code).toContain('Range("B3").Formula = "=SUM(B1:B2)"');
    same(code, d);
  });

  it('el formato de una selección: negrita, color, relleno, formato de número y alineación', () => {
    const { d, code } = record((d) => {
      type(d, 'A1', '1234', 'none');
      d.selectRange(rect('A1:B2'));
      d.toggleStyle('bold');
      d.applyStyle({ color: '#ff0000' });
      d.applyStyle({ bg: '#ffff00' });
      d.applyStyle({ numFmt: '#,##0.00' });
      d.applyStyle({ hAlign: 'center' });
      d.applyStyle({ fontSize: 14 });
    });
    expect(code).toContain('Range("A1:B2").Select');
    expect(code).toContain('Selection.Font.Bold = True');
    expect(code).toContain('Selection.Font.Color = RGB(255, 0, 0)');
    expect(code).toContain('Selection.Interior.Color = RGB(255, 255, 0)');
    expect(code).toContain('Selection.NumberFormat = "#,##0.00"');
    expect(code).toContain('Selection.HorizontalAlignment = xlCenter');
    expect(code).toContain('Selection.Font.Size = 14');
    expect(code.match(/\.Select/g)).toHaveLength(1); // la selección no cambia entre un formato y otro
    same(code, d);
  });

  it('la selección se escribe solo cuando una acción la necesita', () => {
    const { code } = record((d) => {
      d.selectCell(5, 5);
      d.selectCell(0, 0);
      d.selectCell(2, 2);
      d.toggleStyle('italic');
    });
    expect(code.match(/\.Select/g)).toHaveLength(1);
    expect(code).toContain('Range("C3").Select');
  });

  it('combinar, borrar, insertar y quitar filas', () => {
    const { d, code } = record((d) => {
      type(d, 'A1', 'x', 'none');
      type(d, 'A2', 'y', 'none');
      d.selectRange(rect('A1:B1'));
      d.merge(false);
      d.selectCell(0, 0);
      d.insertRows();
      d.selectCell(2, 0);
      d.clearContents();
    });
    expect(code).toContain('Selection.Merge');
    expect(code).toContain('Selection.EntireRow.Insert');
    expect(code).toContain('Selection.ClearContents');
    same(code, d);
  });

  it('lo que no se puede escribir como código queda como comentario', () => {
    const { code } = record((d) => {
      type(d, 'A1', '3', 'none');
      type(d, 'A2', '1', 'none');
      d.selectRange(rect('A1:A2'));
      d.sortRange(rect('A1:A2'), 0, true, false);
    });
    expect(code).toMatch(/' \(Nova no puede grabar: /);
  });

  it('una macro que corre no se graba a sí misma', () => {
    const d = fresh();
    d.wb.macros = [{ name: 'Modulo1', code: 'Sub Otra()\n  Range("A1").Value = 5\n  Range("A1").Font.Bold = True\nEnd Sub' }];
    const rec = new MacroRecorder('Grabada');
    const r = new CalcRecorder(rec, d);
    d.macros.run('Otra');
    r.stop();
    expect(rec.code()).not.toContain('Bold');
    expect(rec.isEmpty).toBe(true);
  });

  it('en pausa no se graba; al terminar el documento queda como estaba', () => {
    const d = fresh();
    const original = d.applyStyle;
    const rec = new MacroRecorder('Grabada');
    const r = new CalcRecorder(rec, d);
    rec.paused = true;
    d.applyStyle({ bold: true });
    rec.paused = false;
    d.applyStyle({ italic: true });
    r.stop();
    expect(rec.code()).toContain('Italic = True');
    expect(rec.code()).not.toContain('Bold');
    expect(d.applyStyle).toBe(original);
  });

  it('una hoja nueva y volver a otra', () => {
    const { d, code } = record((d) => {
      type(d, 'A1', 'a', 'none');
      d.addSheet();
      type(d, 'A1', 'b', 'none');
    });
    expect(code).toContain('Worksheets.Add');
    const { d: b, res } = replay(code);
    expect(res.error ?? '').toBe('');
    expect(b.wb.sheets.length).toBe(d.wb.sheets.length);
  });
});
