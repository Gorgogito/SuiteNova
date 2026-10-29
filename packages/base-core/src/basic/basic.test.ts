import { beforeAll, describe, expect, it } from 'vitest';
import { BaseDb, loadSql } from '../index';
import { AbortRun, BasicError, BasicSyntaxError, Interpreter, TempVars, createHost, translateCriteria, type DbHostApi, type FormLike, type BVal } from './index';

const NOW = new Date(2025, 0, 15, 10, 30, 45);

function make(sources: string | { name: string; source: string }[], extra: Partial<ConstructorParameters<typeof Interpreter>[0]> = {}) {
  const out: string[] = [];
  const msgs: { prompt: string; buttons: number }[] = [];
  const mods = typeof sources === 'string' ? [{ name: 'Modulo1', source: sources }] : sources;
  const it = new Interpreter({ print: (s) => out.push(s), msgBox: (p, b) => (msgs.push({ prompt: p, buttons: b }), 1), inputBox: (_p, _t, d) => d || 'respuesta', now: () => NOW, ...extra });
  const errors = it.load(mods);
  return { it, out, msgs, errors };
}
const run = (src: string, proc = 'Main') => {
  const r = make(src);
  expect(r.errors.map((e) => `${e.module}:${e.line}: ${e.message}`)).toEqual([]);
  r.it.call(proc);
  return r.out;
};
const val = (src: string, args: BVal[] = []) => make(src).it.call('F', args);
const err = (src: string, proc = 'Main'): BasicError => {
  const r = make(src);
  expect(r.errors).toEqual([]);
  try {
    r.it.call(proc);
  } catch (e) {
    expect(e).toBeInstanceOf(BasicError);
    return e as BasicError;
  }
  throw new Error('no error');
};
const syntax = (src: string): string[] => make(src).errors.map((e) => `${e.line}: ${e.message}`);

describe('Nova Basic: expressions', () => {
  it('arithmetic, precedence and the operators of VBA', () => {
    expect(val('Function F()\nF = 2 + 3 * 4 ^ 2 / 8 - 1\nEnd Function')).toBe(7);
    expect(val('Function F()\nF = -2 ^ 2\nEnd Function')).toBe(-4);
    expect(val('Function F()\nF = 2 ^ 3 ^ 2\nEnd Function')).toBe(64); // left to right
    expect(val('Function F()\nF = 7 \\ 2\nEnd Function')).toBe(3);
    expect(val('Function F()\nF = -7 Mod 3\nEnd Function')).toBe(-1);
    expect(val('Function F()\nF = 7.5 Mod 2\nEnd Function')).toBe(0); // 8 Mod 2: operands are rounded
    expect(val('Function F()\nF = 10 / 4\nEnd Function')).toBe(2.5);
    expect(val('Function F()\nF = &HFF + 1E2\nEnd Function')).toBe(355);
  });

  it('strings: concatenation with & and +, comparison without case, Like', () => {
    expect(val('Function F()\nF = "a" & 1 & True & Null & "z"\nEnd Function')).toBe('a1Verdaderoz');
    expect(val('Function F()\nF = "3" + "4"\nEnd Function')).toBe('34');
    expect(val('Function F()\nF = "3" + 4\nEnd Function')).toBe(7);
    expect(val('Function F()\nF = ("Ana" = "ANA") And ("b" < "C")\nEnd Function')).toBe(true);
    expect(val('Function F()\nF = "abc123" Like "a*#?#"\nEnd Function')).toBe(true);
    expect(val('Function F()\nF = "x" Like "[a-c]"\nEnd Function')).toBe(false);
    expect(val('Function F()\nF = "dime ""hola"""\nEnd Function')).toBe('dime "hola"');
  });

  it('logic: And, Or, Not, Xor, bitwise on numbers, Null propagation', () => {
    expect(val('Function F()\nF = (5 > 3) And Not (2 > 3) Or False\nEnd Function')).toBe(true);
    expect(val('Function F()\nF = 12 And 10\nEnd Function')).toBe(8);
    expect(val('Function F()\nF = 5 Xor 1\nEnd Function')).toBe(4);
    expect(val('Function F()\nF = Not 0\nEnd Function')).toBe(-1);
    expect(val('Function F()\nF = IsNull(Null + 1)\nEnd Function')).toBe(true);
    expect(val('Function F()\nF = IsNull(Null = 1)\nEnd Function')).toBe(true);
    expect(val('Function F()\nF = Null And False\nEnd Function')).toBe(false);
    expect(val('Function F()\nF = IsNull(Null Or False)\nEnd Function')).toBe(true);
    expect(val('Function F()\nF = Nz(Null, "x") & Nz(5, 0)\nEnd Function')).toBe('x5');
  });

  it('dates: literals, arithmetic, DateAdd, DateDiff, Format', () => {
    expect(val('Function F()\nF = Format(#1/31/2024# + 30, "yyyy-mm-dd")\nEnd Function')).toBe('2024-03-01');
    expect(val('Function F()\nF = Format(DateAdd("m", 1, #2024-01-31#), "dd/mm/yyyy")\nEnd Function')).toBe('29/02/2024');
    expect(val('Function F()\nF = DateDiff("d", #2024-01-01#, #2024-03-01#)\nEnd Function')).toBe(60);
    expect(val('Function F()\nF = DateDiff("m", #2024-01-15#, #2024-04-01#)\nEnd Function')).toBe(3);
    expect(val('Function F()\nF = Year(Date) * 100 + Month(Date)\nEnd Function')).toBe(202501);
    expect(val('Function F()\nF = Format(Now, "dd/mm/yyyy hh:nn:ss")\nEnd Function')).toBe('15/01/2025 10:30:45');
    expect(val('Function F()\nF = Format(#2024-03-05#, "dddd, d mmmm")\nEnd Function')).toBe('martes, 5 marzo');
    expect(val('Function F()\nF = Weekday(#2024-03-05#)\nEnd Function')).toBe(3);
    expect(val('Function F()\nF = Format(CDate("05/03/2024"), "yyyy-mm-dd")\nEnd Function')).toBe('2024-03-05'); // day first
    expect(val('Function F()\nF = DateSerial(2024, 2, 30) = #2024-03-01#\nEnd Function')).toBe(true);
    expect(val('Function F()\nF = #2024-03-10# - #2024-03-01#\nEnd Function')).toBe(9);
  });

  it('Format: numbers, percentages, named formats, text', () => {
    expect(val('Function F()\nF = Format(1234.567, "0.00")\nEnd Function')).toBe('1234,57');
    expect(val('Function F()\nF = Format(1234567.891, "#,##0.00")\nEnd Function')).toBe('1.234.567,89');
    expect(val('Function F()\nF = Format(0.256, "0%")\nEnd Function')).toBe('26%');
    expect(val('Function F()\nF = Format(5, "000")\nEnd Function')).toBe('005');
    expect(val('Function F()\nF = Format(0.5, "0.0")\nEnd Function')).toBe('0,5');
    expect(val('Function F()\nF = Format(-3.14159, "0.000")\nEnd Function')).toBe('-3,142');
    expect(val('Function F()\nF = Format(True, "Yes/No")\nEnd Function')).toBe('Sí');
    expect(val('Function F()\nF = Format(12, "Fixed")\nEnd Function')).toBe('12,00');
    expect(val('Function F()\nF = Format(7, "0 ""kg""")\nEnd Function')).toBe('7 kg');
    expect(val('Function F()\nF = Format("abc", ">")\nEnd Function')).toBe('ABC');
  });

  it('standard functions of text and numbers', () => {
    expect(val('Function F()\nF = Left("abcdef", 2) & Right("abcdef", 2) & Mid("abcdef", 3, 2)\nEnd Function')).toBe('abefcd');
    expect(val('Function F()\nF = InStr("Hola mundo", "MUNDO") & "," & InStr(5, "abcabc", "b")\nEnd Function')).toBe('6,5');
    expect(val('Function F()\nF = Replace("a-b-c", "-", "+", , 1) & UCase("x") & LCase("Y") & Trim("  z ") & Len("hola")\nEnd Function')).toBe('a+b-cXyz4');
    expect(val('Function F()\nF = Join(Split("a,b,c", ","), "|") & UBound(Split("a,b,c", ","))\nEnd Function')).toBe('a|b|c2');
    expect(val('Function F()\nF = Round(2.5) & Round(3.5) & Round(2.675, 2) & Int(-2.5) & Fix(-2.5) & Abs(-3) & Sgn(-9)\nEnd Function')).toBe('242.68-3-23-1');
    expect(val('Function F()\nF = CInt(2.5) + CInt(3.5) + CLng("12") + CDbl("1.5")\nEnd Function')).toBe(2 + 4 + 12 + 1.5);
    expect(val('Function F()\nF = Val("12abc") + Val(" 3.5") + Val("x")\nEnd Function')).toBe(15.5);
    expect(val('Function F()\nF = IsNumeric("1,5") And Not IsNumeric("abc") And IsDate("2024-03-05")\nEnd Function')).toBe(true);
    expect(val('Function F()\nF = Chr(65) & Asc("a") & String(3, "x") & Space(2) & "|"\nEnd Function')).toBe('A97xxx  |');
    expect(val('Function F()\nF = TypeName(1) & TypeName("a") & TypeName(1.5) & TypeName(Null) & TypeName(Nothing)\nEnd Function')).toBe('IntegerStringDoubleNullNothing');
    expect(val('Function F()\nF = IIf(1 > 2, "a", "b") & Choose(2, "x", "y", "z") & Switch(False, 1, True, 2)\nEnd Function')).toBe('by2');
  });
});

describe('Nova Basic: variables and types', () => {
  it('declared types coerce what is assigned and detect overflow', () => {
    expect(val('Function F()\nDim i As Integer\ni = 3.5\nF = i\nEnd Function')).toBe(4);
    expect(val('Function F()\nDim s As String\ns = 12\nF = s & "!"\nEnd Function')).toBe('12!');
    expect(val('Function F()\nDim b As Boolean\nb = "True"\nF = b\nEnd Function')).toBe(true);
    expect(err('Sub Main()\nDim i As Integer\ni = 40000\nEnd Sub').number).toBe(6);
    expect(err('Sub Main()\nDim i As Integer\ni = "abc"\nEnd Sub').number).toBe(13);
    expect(val('Function F()\nDim v\nF = IsEmpty(v)\nEnd Function')).toBe(true);
    expect(val('Function F()\nDim n As Long, s As String\nF = n & "[" & s & "]"\nEnd Function')).toBe('0[]');
  });

  it('constants cannot be assigned; Option Explicit catches typos', () => {
    expect(err('Sub Main()\nConst K = 5\nK = 6\nEnd Sub').number).toBe(5);
    expect(err('Option Explicit\nSub Main()\nDim total\ntotl = 1\nEnd Sub').description).toMatch(/Variable no definida: totl/);
    expect(val('Function F()\nx = 5\nF = x + 1\nEnd Function')).toBe(6); // implicit variables without Option Explicit
  });

  it('arrays: bounds, two dimensions, ReDim Preserve, Erase', () => {
    expect(val('Function F()\nDim a(1 To 3) As Integer\na(1) = 5: a(3) = 7\nF = a(1) + a(2) + a(3) & "," & LBound(a) & UBound(a)\nEnd Function')).toBe('12,13');
    expect(val('Function F()\nDim m(2, 3)\nm(1, 2) = 9\nF = m(1, 2) & UBound(m, 1) & UBound(m, 2)\nEnd Function')).toBe('923');
    expect(val('Function F()\nDim a() As Integer\nReDim a(2)\na(2) = 4\nReDim Preserve a(4)\nF = a(2) & UBound(a)\nEnd Function')).toBe('44');
    expect(err('Sub Main()\nDim a(2)\na(3) = 1\nEnd Sub').number).toBe(9);
    expect(val('Function F()\nDim a\na = Array(10, 20, 30)\nF = a(1) + UBound(a)\nEnd Function')).toBe(22);
    expect(val('Function F()\nDim a(2)\na(0) = 1\nErase a\nF = IsEmpty(a(0))\nEnd Function')).toBe(true);
  });

  it('Collection and Dictionary', () => {
    expect(val('Function F()\nDim c As New Collection\nc.Add "a"\nc.Add "b", "k"\nF = c.Count & c(1) & c("k") & c.Item(2)\nEnd Function')).toBe('2abb');
    expect(val('Function F()\nDim c As New Collection, x, s\nc.Add 1\nc.Add 2\nFor Each x In c\ns = s + x\nNext\nF = s\nEnd Function')).toBe(3);
    expect(val('Function F()\nDim d\nSet d = CreateObject("Scripting.Dictionary")\nd.Add "a", 1\nd("b") = 2\nd("a") = d("a") + 10\nF = d.Count & d.Exists("b") & d("a") & d.Exists("z")\nEnd Function')).toBe('2Verdadero11Falso');
    expect(err('Sub Main()\nDim c As New Collection\nc.Add 1, "k"\nc.Add 2, "K"\nEnd Sub').number).toBe(457);
    expect(err('Sub Main()\nDim x\nx = CreateObject("WScript.Shell")\nEnd Sub').number).toBe(429);
  });
});

describe('Nova Basic: control flow', () => {
  it('If in all its forms', () => {
    const src = `Function F(n)
  If n < 0 Then F = "neg" Else F = "pos"
  If n = 0 Then F = "zero": Exit Function
  If n > 100 Then
    F = F & "-grande"
  ElseIf n > 10 Then
    F = F & "-medio"
  Else
    F = F & "-chico"
  End If
End Function`;
    expect([-5, 0, 3, 50, 500].map((n) => val(src, [n]))).toEqual(['neg-chico', 'zero', 'pos-chico', 'pos-medio', 'pos-grande']);
  });

  it('Select Case with values, ranges, Is and text', () => {
    const src = `Function F(x)
  Select Case x
    Case 1, 2
      F = "uno-dos"
    Case 3 To 5
      F = "tres-cinco"
    Case "ana", "luis"
      F = "nombre"
    Case Is >= 100
      F = "cien+"
    Case Else
      F = "otro"
  End Select
End Function`;
    expect([1, 2, 4, 150, 'ANA', 7].map((x) => val(src, [x]))).toEqual(['uno-dos', 'uno-dos', 'tres-cinco', 'cien+', 'nombre', 'otro']);
  });

  it('For, Step, Exit For, nested loops; the loop variable', () => {
    expect(val('Function F()\nDim i, s\nFor i = 1 To 10 Step 3\ns = s & i & ","\nNext i\nF = s\nEnd Function')).toBe('1,4,7,10,');
    expect(val('Function F()\nDim i, s\nFor i = 5 To 1 Step -2\ns = s & i\nNext\nF = s\nEnd Function')).toBe('531');
    expect(val('Function F()\nDim i, j, s\nFor i = 1 To 3\nFor j = 1 To 3\nIf j = 2 Then Exit For\ns = s + i * j\nNext j\nNext i\nF = s\nEnd Function')).toBe(6);
    expect(val('Function F()\nDim i\nFor i = 1 To 0\nF = 1\nNext\nF = F & i\nEnd Function')).toBe('1');
    expect(err('Sub Main()\nDim i\nFor i = 1 To 3 Step 0\nNext\nEnd Sub').number).toBe(5);
  });

  it('Do, Loop While/Until, While/Wend, Exit Do', () => {
    expect(val('Function F()\nDim n\nDo While n < 5\nn = n + 2\nLoop\nF = n\nEnd Function')).toBe(6);
    expect(val('Function F()\nDim n\nDo\nn = n + 1\nLoop Until n >= 3\nF = n\nEnd Function')).toBe(3);
    expect(val('Function F()\nDim n\nDo Until n > 100\nn = n + 1\nIf n = 7 Then Exit Do\nLoop\nF = n\nEnd Function')).toBe(7);
    expect(val('Function F()\nDim n\nn = 10\nWhile n > 0\nn = n - 4\nWend\nF = n\nEnd Function')).toBe(-2);
    expect(val('Function F()\nDim n\nDo\nn = n + 1\nLoop While False\nF = n\nEnd Function')).toBe(1);
  });

  it('GoTo and labels, also out of loops', () => {
    const src = `Function F()
  Dim i, s
  For i = 1 To 10
    s = s + i
    If s > 10 Then GoTo Fin
  Next
Fin:
  F = s & "/" & i
End Function`;
    expect(val(src)).toBe('15/5');
  });

  it('With blocks', () => {
    expect(val('Function F()\nDim d\nSet d = CreateObject("Scripting.Dictionary")\nWith d\n.Add "a", 5\n.Add "b", 6\nF = .Count & .Item("b")\nEnd With\nEnd Function')).toBe('26');
  });
});

describe('Nova Basic: procedures', () => {
  it('Sub and Function, calls with and without parentheses, Call, named arguments, Optional, ParamArray', () => {
    const src = `Dim total As Long
Sub Suma(ByVal n As Long)
  total = total + n
End Sub
Function Saludo(nombre As String, Optional tratamiento As String = "Sr.") As String
  Saludo = tratamiento & " " & nombre
End Function
Function Todos(ParamArray v())
  Dim x, s
  For Each x In v
    s = s & x
  Next
  Todos = s
End Function
Sub Main()
  Suma 5
  Call Suma(10)
  Suma (1)
  Debug.Print total
  Debug.Print Saludo("Ruiz")
  Debug.Print Saludo(tratamiento:="Dra.", nombre:="Pérez")
  Debug.Print Todos("a", "b", 3)
  Debug.Print "x"; "y", "z"
End Sub`;
    expect(run(src)).toEqual(['16', 'Sr. Ruiz', 'Dra. Pérez', 'ab3', 'xy\tz']);
  });

  it('ByRef changes the caller; ByVal does not; arrays are shared', () => {
    const src = `Sub Dobla(ByRef n)
  n = n * 2
End Sub
Sub NoCambia(ByVal n)
  n = 0
End Sub
Sub Llena(a())
  a(1) = "x"
End Sub
Sub Main()
  Dim v, arr(2)
  v = 5
  Dobla v
  Debug.Print v
  NoCambia v
  Debug.Print v
  Dobla 7
  Llena arr
  Debug.Print arr(1)
End Sub`;
    expect(run(src)).toEqual(['10', '10', 'x']);
  });

  it('recursion, and the function name used as the result', () => {
    const src = `Function Fact(n As Long) As Long
  If n <= 1 Then
    Fact = 1
  Else
    Fact = n * Fact(n - 1)
  End If
End Function
Function Fib(n)
  If n < 2 Then Fib = n: Exit Function
  Fib = Fib(n - 1) + Fib(n - 2)
End Function`;
    expect(val(src + '\nFunction F()\nF = Fact(10) & "," & Fib(15)\nEnd Function')).toBe('3628800,610');
  });

  it('procedures of several modules see each other; module variables are shared', () => {
    const r = make([
      { name: 'A', source: 'Public contador As Long\nSub Inc()\ncontador = contador + 1\nEnd Sub' },
      { name: 'B', source: 'Function Main()\nInc\nInc\nMain = contador\nEnd Function' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.it.call('Main')).toBe(2);
    expect(r.it.procedures().map((p) => `${p.module}.${p.name}`)).toEqual(['A.Inc', 'B.Main']);
  });

  it('wrong calls: unknown name, too many or missing arguments', () => {
    expect(err('Sub Main()\nNoExiste 1\nEnd Sub').number).toBe(35);
    expect(err('Sub F(a)\nEnd Sub\nSub Main()\nF 1, 2\nEnd Sub').number).toBe(450);
    expect(err('Sub F(a)\nEnd Sub\nSub Main()\nF\nEnd Sub').number).toBe(449);
    expect(() => make('Sub Main()\nEnd Sub').it.call('Otra')).toThrow(/no definido/);
  });
});

describe('Nova Basic: errors', () => {
  it('On Error Resume Next continues, and Err tells what happened', () => {
    const src = `Sub Main()
  On Error Resume Next
  Dim x
  x = 1 / 0
  Debug.Print "sigue " & Err.Number & ": " & Err.Description
  Err.Clear
  Debug.Print Err.Number
  x = CInt("abc")
  Debug.Print Err.Number
End Sub`;
    expect(run(src)).toEqual(['sigue 11: División por cero', '0', '13']);
  });

  it('On Error GoTo with a handler, Resume Next, Resume label and Exit Sub', () => {
    const src = `Sub Main()
  On Error GoTo Manejador
  Debug.Print "a"
  Dim n
  n = 5 / 0
  Debug.Print "no llega"
Seguir:
  Debug.Print "b"
  Exit Sub
Manejador:
  Debug.Print "error " & Err.Number
  Resume Seguir
End Sub
Sub Main2()
  On Error GoTo H
  Dim n
  n = 1 / 0
  Debug.Print "despues"
  Exit Sub
H:
  Debug.Print "H " & Err.Description
  Resume Next
End Sub`;
    const r = make(src);
    r.it.call('Main');
    r.it.call('Main2');
    expect(r.out).toEqual(['a', 'error 11', 'b', 'H División por cero', 'despues']);
  });

  it('errors go up to the caller\'s handler; Err.Raise makes our own', () => {
    const src = `Sub Interna()
  Err.Raise 1234, , "algo salió mal"
End Sub
Sub Main()
  On Error GoTo H
  Interna
  Debug.Print "no"
  Exit Sub
H:
  Debug.Print Err.Number & " " & Err.Description
End Sub`;
    expect(run(src)).toEqual(['1234 algo salió mal']);
  });

  it('an error nobody handles says where it happened', () => {
    const e = err('Sub Main()\nDim x\nx = 1\nx = x / 0\nEnd Sub');
    expect(e.number).toBe(11);
    expect(e.line).toBe(4);
    expect(e.proc).toBe('Main');
    expect(e.full).toBe('Error 11 en Modulo1, línea 4 (Main): División por cero');
  });

  it('On Error GoTo 0 turns the handler off again', () => {
    const src = `Sub Main()
  On Error Resume Next
  Dim x
  x = 1 / 0
  On Error GoTo 0
  x = 1 / 0
End Sub`;
    expect(err(src).line).toBe(6);
  });
});

describe('Nova Basic: limits and safety', () => {
  it('an endless loop is stopped, and scripts cannot catch that', () => {
    const r = make('Sub Main()\nOn Error Resume Next\nDo\nLoop\nEnd Sub', {});
    const it = new Interpreter({ print: () => undefined, msgBox: () => 1, inputBox: () => null }, { maxSteps: 50_000 });
    it.load([{ name: 'M', source: 'Sub Main()\nOn Error Resume Next\nDo\nLoop\nEnd Sub' }]);
    expect(() => it.call('Main')).toThrow(AbortRun);
    expect(r.errors).toEqual([]);
  });

  it('a time limit stops long loops too', () => {
    const it = new Interpreter({ print: () => undefined, msgBox: () => 1, inputBox: () => null }, { maxMillis: 50, maxSteps: 1e12 });
    it.load([{ name: 'M', source: 'Sub Main()\nDo\nLoop\nEnd Sub' }]);
    expect(() => it.call('Main')).toThrow(/segundos/);
  });

  it('runaway recursion becomes an ordinary error', () => {
    const e = err('Sub R()\nR\nEnd Sub\nSub Main()\nR\nEnd Sub');
    expect(e.number).toBe(28);
  });

  it('there is nothing for files, processes or the network', () => {
    for (const code of ['Shell "calc.exe"', 'Kill "a.txt"', 'Open "a.txt" For Output As #1', 'Dim x\nx = Environ("PATH")', 'Dim x\nx = GetObject("winmgmts:")', 'Application.Quit', 'Dim x\nx = Eval("1+1")']) {
      const r = make(`Sub Main()\n${code}\nEnd Sub`);
      if (r.errors.length) continue; // refused when read
      expect(() => r.it.call('Main')).toThrow(BasicError);
    }
  });

  it('text that looks like JavaScript is only text', () => {
    expect(run('Sub Main()\nDebug.Print "constructor.constructor(""return 1"")()"\nEnd Sub')).toEqual(['constructor.constructor("return 1")()']);
    expect(err('Option Explicit\nSub Main()\nDim x\nx = constructor\nEnd Sub').number).toBe(35); // not a property lookup: an undefined name
    expect(val('Function F()\nF = IsEmpty(constructor) And IsEmpty(__proto__)\nEnd Function')).toBe(true);
  });
});

describe('Nova Basic: syntax errors name the line', () => {
  it('reports unclosed blocks, bad tokens and stray words', () => {
    expect(syntax('Sub Main()\nIf True Then\nDebug.Print 1\nEnd Sub')[0]).toMatch(/^4: .*/);
    expect(syntax('Sub Main()\nx = 1 +\nEnd Sub')[0]).toMatch(/^2: /);
    expect(syntax('Sub Main()\nx = "abc\nEnd Sub')[0]).toMatch(/^2: Falta cerrar las comillas/);
    expect(syntax('Sub Main()\nx = 5 @ 2\nEnd Sub')[0]).toMatch(/^2: Carácter no válido/);
    expect(syntax('Sub Main()\nNext\nEnd Sub')[0]).toMatch(/^2: "next" no corresponde/);
    expect(syntax('x = 1')[0]).toMatch(/^1: Fuera de un procedimiento/);
    expect(syntax('Sub Main()\nFor i = 1 To 3\nEnd Sub')[0]).toMatch(/^3: /);
    expect(syntax('Sub A()\nEnd Sub\nSub A()\nEnd Sub')[0]).toMatch(/ya está definido/);
    expect(syntax('Sub Main()\nDim d As Date\nd = #31/31/2024#\nEnd Sub')[0]).toMatch(/^3: Fecha no válida/);
  });

  it('modules with errors do not stop the others from loading', () => {
    const r = make([
      { name: 'Roto', source: 'Sub A()\nIf\nEnd Sub' },
      { name: 'Bien', source: 'Function Dos()\nDos = 2\nEnd Function' },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toBeInstanceOf(BasicSyntaxError);
    expect(r.errors[0]!.module).toBe('Roto');
    expect(r.it.call('Dos')).toBe(2);
  });

  it('continuation lines, comments, Rem, colons and keywords in any case', () => {
    const src = `' un comentario
Rem otro comentario
sub MAIN()
  DIM x aS integer
  x = 1 + _
      2 ' sumar
  DEBUG.PRINT x: Debug.Print "dos"
END SUB`;
    expect(run(src)).toEqual(['3', 'dos']);
  });
});

describe('Nova Basic: the immediate window', () => {
  it('? prints an expression; statements run against the loaded modules', () => {
    const r = make('Function Doble(n)\nDoble = n * 2\nEnd Function\nPublic g\nSub Poner()\ng = 5\nEnd Sub');
    r.it.immediate('? Doble(21)');
    r.it.immediate('Poner: Debug.Print g + 1');
    r.it.immediate('x = 3: ? x ^ 2');
    expect(r.out).toEqual(['42', '6', '9']);
    expect(() => r.it.immediate('? 1 / 0')).toThrow(/División por cero/);
  });
});

describe('Nova Basic: Access objects', () => {
  let SQL: Awaited<ReturnType<typeof loadSql>>;
  beforeAll(async () => {
    SQL = await loadSql();
  });

  function setup(opts: { forms?: Record<string, FormLike>; me?: FormLike | null } = {}) {
    const db = BaseDb.open(SQL);
    db.execute(`CREATE TABLE Clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT, saldo REAL, activo BOOLEAN, alta DATE);
      INSERT INTO Clientes (nombre, saldo, activo, alta) VALUES ('Ana', 10.5, 1, '2024-03-01'), ('Luis', 3, 0, '2023-12-15'), ('Eva', 7, 1, '2024-01-20');
      CREATE VIEW V_activos AS SELECT nombre, saldo FROM Clientes WHERE activo = 1;`);
    db.clearUndo();
    const calls: string[] = [];
    let refreshes = 0;
    const api: DbHostApi = {
      db,
      form: (n) => opts.forms?.[n] ?? null,
      me: () => opts.me ?? null,
      openForm: (n, w) => void calls.push(`form:${n}:${w ?? ''}`),
      openReport: (n) => void calls.push(`report:${n}`),
      openTable: (n) => void calls.push(`table:${n}`),
      openQuery: (n) => void calls.push(`query:${n}`),
      runMacro: (n) => void calls.push(`macro:${n}`),
      close: (k, n) => void calls.push(`close:${k}:${n ?? ''}`),
      querySql: (n) => (n === 'V_activos' ? 'SELECT nombre, saldo FROM Clientes WHERE activo = 1' : null),
      refresh: () => void refreshes++,
    };
    const host = createHost(api);
    const out: string[] = [];
    const it = new Interpreter({ print: (s) => out.push(s), msgBox: () => 1, inputBox: () => null, now: () => NOW, objects: host.objects, functions: host.functions });
    return { db, it, out, calls, refreshes: () => refreshes, load: (src: string) => (expect(it.load([{ name: 'M', source: src }]).map((e) => e.message)).toEqual([]), it) };
  }

  it('Recordset: read, loop, types, count', () => {
    const { load, out } = setup();
    load(`Sub Main()
  Dim rs, total
  Set rs = CurrentDb.OpenRecordset("SELECT * FROM Clientes ORDER BY id")
  Debug.Print rs.RecordCount
  Do While Not rs.EOF
    total = total + rs!saldo
    Debug.Print rs!nombre & " " & rs.Fields("activo").Value & " " & Format(rs("alta"), "dd/mm/yyyy")
    rs.MoveNext
  Loop
  Debug.Print total & " " & rs.EOF
  rs.Close
End Sub`).call('Main');
    expect(out).toEqual(['3', 'Ana Verdadero 01/03/2024', 'Luis Falso 15/12/2023', 'Eva Verdadero 20/01/2024', '20.5 Verdadero']);
  });

  it('Recordset over a table: AddNew, Edit, Delete, FindFirst, and every change can be undone', () => {
    const { load, db } = setup();
    const it = load(`Sub Main()
  Dim rs
  Set rs = CurrentDb.OpenRecordset("Clientes")
  rs.AddNew
  rs!nombre = "Zoe"
  rs!saldo = 99
  rs!activo = True
  rs!alta = #2025-01-02#
  rs.Update
  rs.FindFirst "[nombre] = 'Luis'"
  If Not rs.NoMatch Then
    rs.Edit
    rs!saldo = rs!saldo + 100
    rs.Update
  End If
  rs.FindFirst "nombre = 'Eva'"
  rs.Delete
  rs.FindFirst "nombre = 'Nadie'"
  Debug.Print rs.NoMatch
  rs.Close
End Sub`);
    it.call('Main');
    expect(db.execute('SELECT nombre, saldo, activo, alta FROM Clientes ORDER BY id').rows).toEqual([['Ana', 10.5, 1, '2024-03-01'], ['Luis', 103, 0, '2023-12-15'], ['Zoe', 99, 1, '2025-01-02']]);
    expect(db.undoLabel).toBeTruthy();
    for (let i = 0; i < 3; i++) db.undo();
    expect(db.count('Clientes')).toBe(3);
    expect(db.execute(`SELECT saldo FROM Clientes WHERE nombre = 'Luis'`).rows).toEqual([[3]]);
  });

  it('Recordsets of queries are read only, and the error says so', () => {
    const { load } = setup();
    const it = load(`Sub Main()
  Dim rs
  Set rs = CurrentDb.OpenRecordset("V_activos")
  rs.Edit
End Sub`);
    expect(() => it.call('Main')).toThrow(/solo lectura/);
    const it2 = load(`Sub Main()
  Dim rs
  Set rs = CurrentDb.OpenRecordset("SELECT * FROM Clientes")
  rs!nombre = "x"
End Sub`);
    expect(() => it2.call('Main')).toThrow(/solo lectura/);
    const it3 = load(`Sub Main()
  Dim rs
  Set rs = CurrentDb.OpenRecordset("Clientes")
  rs!nombre = "x"
End Sub`);
    expect(() => it3.call('Main')).toThrow(/Edit o AddNew/);
    expect(() => load('Sub Main()\nDim rs\nSet rs = CurrentDb.OpenRecordset("NoExiste")\nEnd Sub').call('Main')).toThrow(/no pudo encontrar la tabla/);
    const it4 = load('Sub Main()\nDim rs\nSet rs = CurrentDb.OpenRecordset("Clientes")\nrs.MoveLast\nrs.MoveNext\nDebug.Print rs!nombre\nEnd Sub');
    expect(() => it4.call('Main')).toThrow(/ningún registro actual/);
  });

  it('Execute, RunSQL, RecordsAffected, and a failing statement', () => {
    const { load, db, out, refreshes } = setup();
    const it = load(`Sub Main()
  CurrentDb.Execute "UPDATE Clientes SET saldo = saldo + 1 WHERE activo = 1"
  Debug.Print CurrentDb.RecordsAffected
  DoCmd.RunSQL "DELETE FROM Clientes WHERE saldo < 5"
  Debug.Print DCount("*", "Clientes")
  On Error Resume Next
  CurrentDb.Execute "INSERT INTO NoExiste VALUES (1)"
  Debug.Print Err.Number <> 0
End Sub`);
    it.call('Main');
    expect(out).toEqual(['2', '2', 'Verdadero']);
    expect(db.count('Clientes')).toBe(2);
    expect(refreshes()).toBeGreaterThan(1);
  });

  it('domain functions: DLookup, DCount, DSum, DAvg, DMax, DMin, over tables and saved queries, with Access criteria', () => {
    const { load } = setup();
    const it = load(`Function F()
  F = DLookup("nombre", "Clientes", "[id] = 2") & "|" & DLookup("[saldo]", "Clientes", "nombre = ""Ana""") & "|" & DCount("*", "Clientes", "activo = True") & "|" & DSum("saldo", "Clientes") & "|" & DMax("saldo", "V_activos") & "|" & DMin("alta", "Clientes", "[alta] > #2024-01-01#") & "|" & IsNull(DLookup("nombre", "Clientes", "id = 99")) & "|" & DCount("nombre", "Clientes", "nombre Like ""A*""")
End Function`);
    expect(it.call('F')).toBe('Luis|10.5|2|20.5|10.5|2024-01-20|Verdadero|1');
    expect(() => load('Function F()\nF = DLookup("x", "Nada")\nEnd Function').call('F')).toThrow(/no pudo encontrar/);
  });

  it('criteria written the Access way are translated, and quotes in text are kept apart from identifiers', () => {
    expect(translateCriteria('[Nombre] = "O\'Brien" And [Alta] > #1/31/2024#')).toBe(`"Nombre" = 'O''Brien' And "Alta" > '2024-01-31'`);
    expect(translateCriteria('Activo = True Or Activo = False')).toBe('Activo = 1 Or Activo = 0');
    expect(translateCriteria('[Nombre] Like "A*" & "x"')).toBe(`"Nombre" LIKE 'A%' || 'x'`);
    expect(translateCriteria('[Fecha] Is Null')).toBe('"Fecha" IS NULL');
  });

  it('DoCmd opens and closes objects through the host', () => {
    const { load, calls } = setup();
    load(`Sub Main()
  DoCmd.OpenForm "Clientes", acNormal, , "id = 2"
  DoCmd.OpenReport "Ventas"
  DoCmd.OpenTable "Clientes"
  DoCmd.OpenQuery "V_activos"
  DoCmd.RunMacro "Cierre"
  DoCmd.Close acForm, "Clientes"
  DoCmd.SetWarnings False
End Sub`).call('Main');
    expect(calls).toEqual(['form:Clientes:id = 2', 'report:Ventas', 'table:Clientes', 'query:V_activos', 'macro:Cierre', 'close:form:Clientes']);
  });

  it('Forms!Name!Field, Me and GoToRecord work on the open forms', () => {
    const rec: Record<string, BVal> = { Nombre: 'Ana', Saldo: 5 };
    const moves: string[] = [];
    const form: FormLike = {
      name: 'Clientes',
      table: 'Clientes',
      get: (f) => {
        const k = Object.keys(rec).find((x) => x.toLowerCase() === f.toLowerCase());
        if (!k) throw new Error('sin campo');
        return rec[k];
      },
      set: (f, v) => void (rec[f] = v),
      goto: (w) => void moves.push(w),
      requery: () => void moves.push('requery'),
    };
    const { load, out } = setup({ forms: { Clientes: form }, me: form });
    load(`Sub Main()
  Debug.Print Forms!Clientes!Nombre & " " & Forms("Clientes")("Saldo") & " " & Me!Nombre & " " & Me.Saldo
  Forms!Clientes!Saldo = Forms!Clientes!Saldo * 2
  Me.Nombre = "Eva"
  DoCmd.GoToRecord , , acNext
  DoCmd.GoToRecord acForm, "Clientes", acLast
  Forms!Clientes.Requery
  Debug.Print Me.Nombre & Me!Saldo & " " & Me.Name
End Sub`).call('Main');
    expect(out).toEqual(['Ana 5 Ana 5', 'Eva10 Clientes']);
    expect(moves).toEqual(['next', 'last', 'requery']);
    expect(() => load('Sub Main()\nDebug.Print Forms!Otro!X\nEnd Sub').call('Main')).toThrow(/ábralo primero/);
  });

  it('TempVars are shared by name, and keep their type', () => {
    const { load, out } = setup();
    load(`Sub Main()
  TempVars!limite = 100
  TempVars.Add "otro", "x"
  Debug.Print TempVars!limite + 1 & TempVars("otro") & TempVars.Count & IsNull(TempVars!nada)
  TempVars.Remove "otro"
  Debug.Print TempVars.Count
End Sub`).call('Main');
    expect(out).toEqual(['101x2Verdadero', '1']);
    expect(new TempVars().values.size).toBe(0);
  });

  it('code can drive a whole task: totals per zone written to a table', () => {
    const { load, db } = setup();
    db.execute('CREATE TABLE Resumen (clave TEXT, total REAL)');
    load(`Sub Main()
  Dim rs, d, k
  Set d = CreateObject("Scripting.Dictionary")
  Set rs = CurrentDb.OpenRecordset("SELECT activo, saldo FROM Clientes")
  Do While Not rs.EOF
    k = IIf(rs!activo, "activos", "inactivos")
    d(k) = d(k) + rs!saldo
    rs.MoveNext
  Loop
  rs.Close
  For Each k In d.Keys()
    CurrentDb.Execute "INSERT INTO Resumen VALUES ('" & k & "', " & d(k) & ")"
  Next
End Sub`).call('Main');
    expect(db.execute('SELECT * FROM Resumen ORDER BY clave').rows).toEqual([['activos', 17.5], ['inactivos', 3]]);
  });
});
