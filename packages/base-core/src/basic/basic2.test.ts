import { describe, expect, it } from 'vitest';
import { BasicError, Interpreter, type BVal, type Vfs } from './index';

const NOW = new Date(2025, 0, 15, 10, 30, 45);

function memVfs(init: Record<string, string> = {}): Vfs & { files: Map<string, string> } {
  const files = new Map(Object.entries(init));
  const key = (p: string) => [...files.keys()].find((k) => k.toLowerCase() === p.toLowerCase());
  return {
    files,
    read: (p) => (key(p) !== undefined ? files.get(key(p)!)! : null),
    write: (p, t) => void files.set(key(p) ?? p, t),
    remove: (p) => void files.delete(key(p) ?? p),
    list: () => [...files.keys()],
  };
}
function make(mods: { name: string; source: string; kind?: 'module' | 'class' }[], vfs?: Vfs) {
  const out: string[] = [];
  const it = new Interpreter({ print: (s) => out.push(s), msgBox: () => 1, inputBox: () => '', now: () => NOW, vfs });
  const errors = it.load(mods);
  return { it, out, errors };
}
const mod = (source: string, name = 'Modulo1') => ({ name, source });
const cls = (name: string, source: string) => ({ name, source, kind: 'class' as const });
const run = (mods: { name: string; source: string; kind?: 'module' | 'class' }[], proc = 'Main', vfs?: Vfs) => {
  const r = make(mods, vfs);
  expect(r.errors.map((e) => `${e.module}:${e.line}: ${e.message}`)).toEqual([]);
  r.it.call(proc);
  return r.out;
};
const val = (mods: { name: string; source: string; kind?: 'module' | 'class' }[], args: BVal[] = []) => make(mods).it.call('F', args);

describe('Nova Basic: Type and Enum', () => {
  it('a Type groups fields; assigning it copies it', () => {
    const out = run([
      mod(`Type Persona
  Nombre As String
  Edad As Integer
  Notas(1 To 3) As Double
End Type
Sub Main()
  Dim a As Persona, b As Persona
  a.Nombre = "Ana"
  a.Edad = 30
  a.Notas(2) = 7.5
  b = a
  b.Nombre = "Beto"
  b.Notas(2) = 1
  Debug.Print a.Nombre & " " & a.Edad & " " & a.Notas(2)
  Debug.Print b.Nombre & " " & b.Edad & " " & b.Notas(2)
  Debug.Print TypeName(a)
End Sub`),
    ]);
    expect(out).toEqual(['Ana 30 7.5', 'Beto 30 1', 'Persona']);
  });
  it('fields are typed, arrays of Type work, and ByVal passes a copy', () => {
    const out = run([
      mod(`Private Type Punto
  X As Long
  Y As Long
End Type
Sub Mueve(ByVal p As Punto)
  p.X = 99
End Sub
Sub MueveRef(p As Punto)
  p.X = 5
End Sub
Sub Main()
  Dim ps(1 To 2) As Punto
  ps(1).X = 3
  ps(2).Y = 4
  Mueve ps(1)
  Debug.Print ps(1).X & "," & ps(2).Y
  Dim q As Punto
  MueveRef q
  Debug.Print q.X
  q.X = 2.6
  Debug.Print q.X
  With q
    .Y = 8
  End With
  Debug.Print q.Y
End Sub`),
    ]);
    expect(out).toEqual(['3,4', '5', '3', '8']);
  });
  it('an unknown field is an error', () => {
    const r = make([mod(`Type T\n A As Long\nEnd Type\nSub Main()\n Dim t As T\n t.Zzz = 1\nEnd Sub`)]);
    expect(() => r.it.call('Main')).toThrow(BasicError);
  });
  it('Enum gives names to numbers, with automatic and explicit values', () => {
    const out = run([
      mod(`Enum Color
  Rojo
  Verde = 5
  Azul
End Enum
Public Enum Nivel
  Bajo = 10
  Alto = Bajo * 2
End Enum
Sub Main()
  Dim c As Color
  Debug.Print Rojo & " " & Verde & " " & Azul & " " & Color.Azul & " " & Alto
  c = Color.Verde
  If c = Verde Then Debug.Print "ok"
  Select Case c
    Case Rojo: Debug.Print "r"
    Case Verde: Debug.Print "v"
  End Select
End Sub`),
    ]);
    expect(out).toEqual(['0 5 6 6 20', 'ok', 'v']);
  });
});

describe('Nova Basic: class modules and Property', () => {
  const persona = cls(
    'Persona',
    `Private mNombre As String
Public Edad As Integer
Private Sub Class_Initialize()
  mNombre = "sin nombre"
  Edad = 1
End Sub
Public Property Get Nombre() As String
  Nombre = mNombre
End Property
Public Property Let Nombre(v As String)
  If Len(v) = 0 Then Err.Raise 1001, , "Nombre vacío"
  mNombre = v
End Property
Public Function Saluda(Optional ByVal otro As String = "mundo") As String
  Saluda = "Hola " & otro & ", soy " & Nombre & " (" & Me.Edad & ")"
End Function
Public Sub Cumple()
  Edad = Edad + 1
End Sub
Private Sub Secreto()
End Sub`,
  );
  it('New creates objects with their own state, properties and methods', () => {
    const out = run([
      persona,
      mod(`Sub Main()
  Dim a As New Persona
  Dim b As Persona
  Set b = New Persona
  a.Nombre = "Ana"
  b.Nombre = "Beto"
  a.Cumple
  a.Cumple
  Debug.Print a.Nombre & " " & a.Edad & " | " & b.Nombre & " " & b.Edad
  Debug.Print a.Saluda
  Debug.Print b.Saluda("Luis")
  Debug.Print TypeName(a)
  Dim c As Persona
  Debug.Print (c Is Nothing)
  Set c = a
  c.Nombre = "Cris"
  Debug.Print a.Nombre
End Sub`),
    ]);
    expect(out).toEqual(['Ana 3 | Beto 1', 'Hola mundo, soy Ana (3)', 'Hola Luis, soy Beto (1)', 'Persona', 'Verdadero', 'Cris']);
  });
  it('Class_Initialize runs once per object, Let can refuse a value, private members stay private', () => {
    const r = make([persona, mod(`Sub Main()\n Dim p As New Persona\n p.Nombre = ""\nEnd Sub\nSub Otro()\n Dim p As New Persona\n p.Secreto\nEnd Sub\nSub Tercero()\n Dim p As New Persona\n Debug.Print p.mNombre\nEnd Sub`)]);
    expect(r.errors).toEqual([]);
    expect(() => r.it.call('Main')).toThrow(/Nombre vacío/);
    expect(() => r.it.call('Otro')).toThrow(/no admite/);
    expect(() => r.it.call('Tercero')).toThrow(/no admite/);
  });
  it('classes can hold other objects and collections', () => {
    const out = run([
      cls('Pila', `Private items As Collection\nPrivate Sub Class_Initialize()\n  Set items = New Collection\nEnd Sub\nPublic Sub Push(v)\n  items.Add v\nEnd Sub\nPublic Function Pop()\n  Pop = items(items.Count)\n  items.Remove items.Count\nEnd Function\nPublic Property Get Count() As Long\n  Count = items.Count\nEnd Property`),
      mod(`Sub Main()\n  Dim p As New Pila\n  p.Push 1\n  p.Push 2\n  p.Push 3\n  Debug.Print p.Pop() & " " & p.Count\nEnd Sub`),
    ]);
    expect(out).toEqual(['3 2']);
  });
  it('a standard module can have Property Get and Property Let too', () => {
    const out = run([mod(`Private v As Long\nProperty Get Valor() As Long\n  Valor = v * 2\nEnd Property\nProperty Let Valor(x As Long)\n  v = x\nEnd Property\nSub Main()\n  Valor = 21\n  Debug.Print Valor\nEnd Sub`)]);
    expect(out).toEqual(['42']);
  });
  it('a class cannot use a missing class name', () => {
    const r = make([mod(`Sub Main()\n Dim x As New Nada\nEnd Sub`)]);
    expect(() => r.it.call('Main')).toThrow();
  });
});

describe('Nova Basic: files (kept inside the database)', () => {
  it('Open For Output, Print #, Close, then Input and Line Input read it back', () => {
    const vfs = memVfs();
    const out = run(
      [
        mod(`Sub Main()
  Dim f As Integer, linea As String, a, b
  f = FreeFile
  Open "datos.txt" For Output As #f
  Print #f, "uno"
  Print #f, "dos", "tres"
  Print #f, "sin salto";
  Print #f, " continuacion"
  Write #f, "x", 42, True
  Close #f
  Open "datos.txt" For Input As #1
  Do While Not EOF(1)
    Line Input #1, linea
    Debug.Print "[" & linea & "]"
  Loop
  Close #1
  Open "datos.txt" For Input As #2
  Line Input #2, linea
  Line Input #2, linea
  Line Input #2, linea
  Input #2, a, b
  Debug.Print a & "|" & b
  Close
End Sub`),
      ],
      'Main',
      vfs,
    );
    expect(out).toEqual(['[uno]', '[dos\ttres]', '[sin salto continuacion]', '["x",42,#TRUE#]', 'x|42']);
  });
  it('Input # reads fields, quoted text and numbers', () => {
    const vfs = memVfs({ 'v.csv': '"Ana, B",30,#TRUE#\nLuis,2.5,#NULL#\n' });
    const out = run(
      [mod(`Sub Main()\n Dim n, e, ok\n Open "v.csv" For Input As #1\n Do Until EOF(1)\n  Input #1, n, e, ok\n  Debug.Print n & "/" & e & "/" & IsNull(ok)\n Loop\n Close #1\nEnd Sub`)],
      'Main',
      vfs,
    );
    expect(out).toEqual(['Ana, B/30/Falso', 'Luis/2.5/Verdadero']);
  });
  it('Append adds to the end; Kill, FileCopy, FileLen and Dir work on the same store', () => {
    const vfs = memVfs({ 'a.txt': 'hola\n' });
    const out = run(
      [
        mod(`Sub Main()
  Open "a.txt" For Append As #1
  Print #1, "mundo"
  Close #1
  FileCopy "a.txt", "b.txt"
  Debug.Print FileLen("b.txt")
  Dim f As String
  f = Dir("*.txt")
  Do While f <> ""
    Debug.Print f
    f = Dir()
  Loop
  Kill "a.txt"
  Debug.Print Dir("a.txt") = ""
End Sub`),
      ],
      'Main',
      vfs,
    );
    expect(out).toEqual(['11', 'a.txt', 'b.txt', 'Verdadero']);
    expect(vfs.files.get('b.txt')).toBe('hola\nmundo\n');
    expect(vfs.files.has('a.txt')).toBe(false);
  });
  it('a file left open is saved when the run ends; errors name the problem', () => {
    const vfs = memVfs();
    run([mod(`Sub Main()\n Open "z.txt" For Output As #1\n Print #1, "pendiente"\nEnd Sub`)], 'Main', vfs);
    expect(vfs.files.get('z.txt')).toBe('pendiente\n');
    const r = make([mod(`Sub A()\n Open "nada.txt" For Input As #1\nEnd Sub\nSub B()\n Print #3, "x"\nEnd Sub\nSub C()\n Open "q.txt" For Output As #1\n Open "r.txt" For Output As #1\nEnd Sub\nSub D()\n Line Input #1, x\nEnd Sub`)], vfs);
    expect(() => r.it.call('A')).toThrow(/No se encuentra/);
    expect(() => r.it.call('B')).toThrow(/número de archivo/);
    expect(() => r.it.call('C')).toThrow(/ya está abierto/);
    expect(() => r.it.call('D')).toThrow(/número de archivo/);
  });
  it('without a store the file statements say so', () => {
    const r = make([mod(`Sub Main()\n Open "a" For Output As #1\nEnd Sub`)]);
    expect(() => r.it.call('Main')).toThrow(/no tiene archivos/);
  });
  it('a variable called open or print is still a variable, and #1/31/2024# is still a date', () => {
    const out = run([mod(`Sub Main()\n Dim open As Long, print As Long\n open = 1\n print = open + 1\n Debug.Print print\n Debug.Print Format(#1/31/2024#, "yyyy-mm-dd")\nEnd Sub`)]);
    expect(out).toEqual(['2', '2024-01-31']);
  });
});

describe('Nova Basic: still the same for ordinary code', () => {
  it('functions, recursion and arrays are untouched', () => {
    expect(val([mod(`Function F(n)\n If n <= 1 Then\n F = 1\n Else\n F = n * F(n - 1)\n End If\nEnd Function`)], [5])).toBe(120);
  });
});
