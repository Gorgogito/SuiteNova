import { describe, expect, it } from 'vitest';
import { BasicError, Interpreter, type BVal } from './index';

type Src = { name: string; source: string; kind?: 'module' | 'class' };
const mod = (source: string, name = 'Modulo1'): Src => ({ name, source });
const cls = (name: string, source: string): Src => ({ name, source, kind: 'class' });
function make(mods: Src[], fields: Record<string, BVal> = {}) {
  const out: string[] = [];
  const it = new Interpreter({
    print: (s) => out.push(s),
    msgBox: () => 1,
    inputBox: () => '',
    functions: {
      __campo: (a) => {
        const k = String(a[0]).toLowerCase();
        if (!(k in fields)) throw new BasicError(2465, `No se encuentra el campo [${a[0]}]`);
        return fields[k];
      },
      novaeval: (a) => {
        if (String(a[0]).includes('Sum')) return 99;
        throw new Error('no');
      },
    },
  });
  const errors = it.load(mods);
  return { it, out, errors };
}
const run = (mods: Src[], proc = 'Main') => {
  const r = make(mods);
  expect(r.errors.map((e) => `${e.module}:${e.line}: ${e.message}`)).toEqual([]);
  r.it.call(proc);
  return r.out;
};

describe('Nova Basic: events of objects', () => {
  const contador = cls(
    'Contador',
    `Public Event Cambio(ByVal nuevo As Long, ByVal viejo As Long)
Public Event Listo()
Private n As Long
Public Sub Sube()
  Dim v As Long
  v = n
  n = n + 1
  RaiseEvent Cambio(n, v)
  If n = 2 Then RaiseEvent Listo
End Sub`,
  );
  it('RaiseEvent calls the procedures of the objects that listen with WithEvents', () => {
    const out = run([
      contador,
      cls(
        'Oyente',
        `Private WithEvents c As Contador
Private Sub Class_Initialize()
  Set c = New Contador
End Sub
Private Sub c_Cambio(ByVal nuevo As Long, ByVal viejo As Long)
  Debug.Print "cambio " & viejo & "->" & nuevo
End Sub
Private Sub c_Listo()
  Debug.Print "listo"
End Sub
Public Sub Empuja()
  c.Sube
End Sub
Public Sub Suelta()
  Set c = Nothing
End Sub`,
      ),
      mod(`Sub Main()
  Dim o As New Oyente
  o.Empuja
  o.Empuja
  o.Suelta
End Sub`),
    ]);
    expect(out).toEqual(['cambio 0->1', 'cambio 1->2', 'listo']);
  });
  it('two listeners hear the same event; reassigning the variable moves the wiring', () => {
    const out = run([
      contador,
      cls('A', `Public WithEvents c As Contador\nPrivate Sub c_Cambio(ByVal nuevo As Long, ByVal viejo As Long)\n  Debug.Print "A " & nuevo\nEnd Sub`),
      cls('B', `Public WithEvents c As Contador\nPrivate Sub c_Cambio(ByVal nuevo As Long, ByVal viejo As Long)\n  Debug.Print "B " & nuevo\nEnd Sub`),
      mod(`Sub Main()
  Dim a As New A, b As New B, x As New Contador, y As New Contador
  Set a.c = x
  Set b.c = x
  x.Sube
  Set a.c = y
  x.Sube
  y.Sube
End Sub`),
    ]);
    expect(out).toEqual(['A 1', 'B 1', 'B 2', 'A 1']);
  });
  it('an event that is not declared, or RaiseEvent outside a class, is an error', () => {
    const r = make([cls('X', `Public Sub Dispara()\n  RaiseEvent Nada\nEnd Sub`), mod(`Sub Main()\n  Dim x As New X\n  x.Dispara\nEnd Sub\nSub Fuera()\n  RaiseEvent Algo\nEnd Sub`)]);
    expect(r.errors).toEqual([]);
    expect(() => r.it.call('Main')).toThrow(/no está declarado/);
    expect(() => r.it.call('Fuera')).toThrow(/dentro de un módulo de clase/);
  });
});

describe('Nova Basic: Implements', () => {
  const forma = cls('IForma', `Public Function Area() As Double\nEnd Function\nPublic Property Get Nombre() As String\nEnd Property\nPublic Sub Dibuja()\nEnd Sub`);
  const cuadrado = cls(
    'Cuadrado',
    `Implements IForma
Public Lado As Double
Private Function IForma_Area() As Double
  IForma_Area = Lado * Lado
End Function
Private Property Get IForma_Nombre() As String
  IForma_Nombre = "cuadrado"
End Property
Private Sub IForma_Dibuja()
  Debug.Print "[]" & Lado
End Sub`,
  );
  const circulo = cls(
    'Circulo',
    `Implements IForma
Public R As Double
Public Function IForma_Area() As Double
  IForma_Area = 3 * R * R
End Function
Public Property Get IForma_Nombre() As String
  IForma_Nombre = "circulo"
End Property
Public Sub IForma_Dibuja()
  Debug.Print "()" & R
End Sub`,
  );
  it('different classes answer to the same interface', () => {
    const out = run([
      forma,
      cuadrado,
      circulo,
      mod(`Function Describe(f As IForma) As String
  Describe = f.Nombre & ":" & f.Area()
  f.Dibuja
End Function
Sub Main()
  Dim c As New Cuadrado, o As New Circulo
  c.Lado = 3
  o.R = 2
  Debug.Print Describe(c)
  Debug.Print Describe(o)
  Dim f As IForma
  Set f = c
  Debug.Print TypeOf f Is Cuadrado
  Debug.Print TypeOf f Is IForma
  Debug.Print TypeOf f Is Circulo
  Debug.Print TypeOf c Is IForma
End Sub`),
    ]);
    expect(out).toEqual(['[]3', 'cuadrado:9', '()2', 'circulo:12', 'Verdadero', 'Verdadero', 'Falso', 'Verdadero']);
  });
  it('a class that does not implement every member is refused when read', () => {
    const r = make([forma, cls('Cojo', `Implements IForma\nPublic Function IForma_Area() As Double\nEnd Function`)]);
    expect(r.errors.map((e) => e.message).join('|')).toMatch(/Cojo implementa IForma pero le falta IForma_Nombre/);
    const r2 = make([cls('Sin', `Implements Fantasma`)]);
    expect(r2.errors.map((e) => e.message).join('|')).toMatch(/no existe la clase "Fantasma"/);
  });
});

describe('Nova Basic: Class_Terminate', () => {
  const rastro = cls('Rastro', `Public Nombre As String\nPrivate Sub Class_Initialize()\n  Debug.Print "nace"\nEnd Sub\nPrivate Sub Class_Terminate()\n  Debug.Print "muere " & Nombre\nEnd Sub`);
  it('runs when the last variable lets go of the object', () => {
    const out = run([
      rastro,
      mod(`Sub Main()
  Dim a As New Rastro
  a.Nombre = "a"
  Dim b As Rastro
  Set b = a
  Set a = Nothing
  Debug.Print "a suelto"
  Set b = Nothing
  Debug.Print "b suelto"
End Sub`),
    ]);
    expect(out).toEqual(['nace', 'a suelto', 'muere a', 'b suelto']);
  });
  it('runs when the procedure that owns the variable ends, once per object', () => {
    const out = run([
      rastro,
      mod(`Sub Uno()
  Dim x As New Rastro
  x.Nombre = "uno"
  Debug.Print "en Uno"
End Sub
Sub Main()
  Uno
  Debug.Print "despues"
  Dim y As New Rastro
  y.Nombre = "y"
End Sub`),
    ]);
    expect(out).toEqual(['nace', 'en Uno', 'muere uno', 'despues', 'nace', 'muere y']);
  });
  it('a returned object stays alive; an object held by a field dies with its owner', () => {
    const out = run([
      rastro,
      cls('Dueno', `Public Hijo As Rastro\nPrivate Sub Class_Initialize()\n  Set Hijo = New Rastro\n  Hijo.Nombre = "hijo"\nEnd Sub\nPrivate Sub Class_Terminate()\n  Debug.Print "dueno muere"\nEnd Sub`),
      mod(`Function Crea() As Rastro
  Dim t As New Rastro
  t.Nombre = "creado"
  Set Crea = t
End Function
Sub Main()
  Dim r As Rastro
  Set r = Crea()
  Debug.Print "recibido " & r.Nombre
  Set r = Nothing
  Dim d As New Dueno
  Debug.Print "fin"
  Set d = Nothing
  Debug.Print "adios"
End Sub`),
    ]);
    expect(out).toEqual(['nace', 'recibido creado', 'muere creado', 'nace', 'fin', 'dueno muere', 'muere hijo', 'adios']);
  });
  it('objects put in a collection are not terminated mid-run, only when the interpreter is discarded', () => {
    const r = make([rastro, mod(`Sub Main()\n  Dim c As New Collection\n  Dim x As New Rastro\n  x.Nombre = "guardado"\n  c.Add x\nEnd Sub`)]);
    r.it.call('Main');
    expect(r.out).toEqual(['nace']);
    r.it.dispose();
    expect(r.out).toEqual(['nace', 'muere guardado']);
  });
  it('a global variable keeps its object between runs', () => {
    const r = make([rastro, mod(`Public g As New Rastro\nSub Poner()\n  g.Nombre = "global"\nEnd Sub\nSub Ver()\n  Debug.Print g.Nombre\nEnd Sub`)]);
    r.it.call('Poner');
    r.it.call('Ver');
    expect(r.out).toEqual(['nace', 'global']);
    r.it.dispose();
    expect(r.out.at(-1)).toBe('muere global');
  });
});

describe('Nova Basic: Eval and Run', () => {
  const val = (src: string, fields: Record<string, BVal> = {}) => make([mod(src)], fields).it.call('F');
  it('evaluates expressions with Nova Basic functions and the variables of the caller', () => {
    expect(val(`Function F()\n  F = Eval("2 + 3 * 4")\nEnd Function`)).toBe(14);
    expect(val(`Function F()\n  Dim x As Long\n  x = 5\n  F = Eval("x * 2 + Len(""abc"")")\nEnd Function`)).toBe(13);
    expect(val(`Function Doble(n)\n  Doble = n * 2\nEnd Function\nFunction F()\n  F = Eval("Doble(21)")\nEnd Function`)).toBe(42);
    expect(val(`Function F()\n  F = Eval("Format(#1/31/2024#, ""yyyy"")")\nEnd Function`)).toBe('2024');
  });
  it('fields of the current record are written [Field]', () => {
    expect(val(`Function F()\n  F = Eval("[saldo] * 2 & "" euros""")\nEnd Function`, { saldo: 21 })).toBe('42 euros');
    expect(() => val(`Function F()\n  F = Eval("[nada]")\nEnd Function`, { saldo: 1 })).toThrow(/nada/);
    // a bracket inside a text is only text
    expect(val(`Function F()\n  F = Eval("""[x]""")\nEnd Function`)).toBe('[x]');
  });
  it('runs statements too, in the variables of the caller', () => {
    const out = run([mod(`Sub Main()\n  Dim x As Long\n  x = 1\n  Eval "x = x + 41: Debug.Print x"\n  Debug.Print x\nEnd Sub`)]);
    expect(out).toEqual(['42', '42']);
  });
  it('what Nova Basic does not know falls back to the expression language of Nova Base', () => {
    expect(val(`Function F()\n  F = Eval("Sum([saldo])")\nEnd Function`, { saldo: 1 })).toBe(99);
  });
  it('rejects several statements smuggled into an expression, and bad text', () => {
    expect(() => val(`Function F()\n  F = Eval("1 + 1" & vbCrLf & "Kill ""x""")\nEnd Function`)).toThrow();
    expect(() => val(`Function F()\n  F = Eval("2 +")\nEnd Function`)).toThrow(/Eval/);
  });
  it('Run calls a procedure by name with arguments', () => {
    expect(val(`Function Suma(a, b)\n  Suma = a + b\nEnd Function\nFunction F()\n  F = Run("suma", 2, 3)\nEnd Function`)).toBe(5);
    expect(() => val(`Function F()\n  F = Run("noexiste")\nEnd Function`)).toThrow(/no definido/);
  });
});
