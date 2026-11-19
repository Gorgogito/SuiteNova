import { describe, expect, it } from 'vitest';
import { Interpreter } from './interp';

/** Differences with the VBA of Office that a comparison with real Excel found (scripts/vba-compare). */
function run(code: string, compareText?: boolean): unknown {
  const i = new Interpreter({ print: () => undefined, msgBox: () => 1, inputBox: () => null, ...(compareText === undefined ? {} : { compareText }) }, {});
  const errs = i.load([{ name: 'M', source: code }]);
  if (errs.length) throw new Error(errs[0]!.message);
  return i.call('F', []);
}

describe('compatibilidad con VBA', () => {
  it('Access compara el texto sin distinguir mayúsculas; Word, Excel y los demás, sí', () => {
    const f = 'Function F()\n  F = ("a" = "A") & "|" & StrComp("a", "A") & "|" & InStr("ABC", "b") & "|" & ("abc" Like "A*") & "|" & Replace("AbA", "a", "x")\nEnd Function';
    expect(run(f)).toBe('Verdadero|0|2|Verdadero|xbx');
    expect(run(f, false)).toBe('Falso|1|0|Falso|AbA');
    // an explicit compare argument always wins
    expect(run('Function F()\n  F = InStr(1, "ABC", "b", vbTextCompare)\nEnd Function', false)).toBe(2);
  });

  it('Static conserva su valor entre llamadas', () => {
    expect(run('Function Cuenta()\n  Static n As Integer\n  n = n + 1\n  Cuenta = n\nEnd Function\nFunction F()\n  Cuenta\n  Cuenta\n  F = Cuenta()\nEnd Function')).toBe(3);
  });

  it('Hex, Oct, Filter, IsMissing y los literales &H en Val e IsNumeric', () => {
    expect(run('Function F()\n  F = Hex(255) & "|" & Hex(-1) & "|" & Oct(8) & "|" & Val("&HFF") & "|" & IsNumeric("&H1F") & "|" & Join(Filter(Array("pera", "uva", "piña"), "p"), ",")\nEnd Function')).toBe('FF|FFFF|10|255|Verdadero|pera,piña');
    expect(run('Function G(Optional a)\n  G = IsMissing(a)\nEnd Function\nFunction F()\n  F = G() & "|" & G(1)\nEnd Function')).toBe('Verdadero|Falso');
  });

  it('los números grandes se escriben en notación científica desde 1E+15, y Round respeta los empates reales', () => {
    expect(run('Function F()\n  F = CStr(1E+20) & "|" & CStr(2432902008176640000#) & "|" & CStr(100000000000000#) & "|" & Round(2.345, 2) & "|" & Round(2.5) & "|" & Round(3.5)\nEnd Function')).toBe('1E+20|2.43290200817664E+18|100000000000000|2.35|2|4');
  });

  it('Err.Raise guarda el origen, y Empty se compara con un texto vacío', () => {
    expect(run('Function F()\n  On Error Resume Next\n  Err.Raise 1234, "Origen", "Mi error"\n  F = Err.Number & "|" & Err.Source & "|" & Err.Description\nEnd Function')).toBe('1234|Origen|Mi error');
    expect(run('Function F()\n  Dim v\n  F = (v = "") & "|" & (v + 1)\nEnd Function')).toBe('Verdadero|1');
  });
});
