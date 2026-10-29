import { describe, expect, it } from 'vitest';
import { canonicalFormula, localizeFormula } from './locale';
import { Workbook } from './workbook';

describe('formula localisation', () => {
  it('translates to Spanish for display', () => {
    expect(localizeFormula('SUM(A1:A3)*1.5', 'es')).toBe('SUMA(A1:A3)*1,5');
    expect(localizeFormula('IF(A1>0,"x, y",FALSE)', 'es')).toBe('SI(A1>0;"x, y";FALSO)');
    expect(localizeFormula('VLOOKUP(A1,Hoja2!A:B,2,FALSE)', 'es')).toBe('BUSCARV(A1;Hoja2!A:B;2;FALSO)');
    expect(localizeFormula('YEAR(TODAY())', 'es')).toBe('AÑO(HOY())');
    expect(localizeFormula('1+', 'es')).toBe('1+');
  });
  it('reads Spanish input back to canonical', () => {
    expect(canonicalFormula('SUMA(A1:A3)*1,5', 'es')).toBe('SUM(A1:A3)*1.5');
    expect(canonicalFormula('SI(A1>0;"x; y";FALSO)', 'es')).toBe('IF(A1>0,"x; y",FALSE)');
    expect(canonicalFormula("BUSCARV(A1;'Mis datos'!A:B;2;VERDADERO)", 'es')).toBe("VLOOKUP(A1,'Mis datos'!A:B,2,TRUE)");
    expect(canonicalFormula('SI.ERROR(A1/0;,5)', 'es')).toBe('IFERROR(A1/0,.5)');
    expect(canonicalFormula('suma(a1;2,25)', 'es')).toBe('SUM(a1,2.25)');
    expect(canonicalFormula('SUM(A1;2)', 'es')).toBe('SUM(A1,2)'); // English names still accepted
  });
  it('round-trips through the engine', () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.setInput(id, 0, 0, '2');
    w.setInput(id, 0, 1, `=${canonicalFormula('SI(A1>1;SUMA(A1;0,5);"no")', 'es')}`);
    expect(w.getValue(id, 0, 1)).toBe(2.5);
    expect(localizeFormula(w.getCell(id, 0, 1)!.formula!.text, 'es')).toBe('SI(A1>1;SUMA(A1;0,5);"no")');
  });
});
