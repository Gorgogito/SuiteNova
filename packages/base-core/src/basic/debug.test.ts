import { describe, expect, it } from 'vitest';
import { Interpreter } from './index';

const SRC = [
  'Sub Main()', // 1
  '  Dim a As Integer, s As String', // 2
  '  a = 1', // 3
  '  s = "hola"', // 4
  '  Dobla a', // 5
  '  Debug.Print a', // 6
  '  Dim i', // 7
  '  For i = 1 To 3', // 8
  '    a = a + i', // 9
  '  Next i', // 10
  '  Debug.Print a', // 11
  'End Sub', // 12
  'Sub Dobla(ByRef x As Integer)', // 13
  '  x = x * 2', // 14
  '  Triplica x', // 15
  'End Sub', // 16
  'Sub Triplica(ByRef y As Integer)', // 17
  '  y = y * 3', // 18
  'End Sub', // 19
  'Function Doble(n)', // 20
  '  Doble = n * 2', // 21
  'End Function', // 22
  'Sub ConFuncion()', // 23
  '  Dim r', // 24
  '  r = Doble(4)', // 25
  '  Debug.Print r', // 26
  'End Sub', // 27
  'Sub Falla()', // 28
  '  Dim z', // 29
  '  z = 1 / 0', // 30
  'End Sub', // 31
].join('\n');

function make() {
  const out: string[] = [];
  const it = new Interpreter({ print: (s) => out.push(s), msgBox: () => 1, inputBox: () => '' });
  expect(it.load([{ name: 'M', source: SRC }])).toEqual([]);
  return { it, out };
}

describe('Nova Basic: depurador', () => {
  it('sin puntos de interrupción corre hasta el final', () => {
    const { it, out } = make();
    const d = it.debug('Main');
    expect(d.state).toBe('done');
    expect(out).toEqual(['6', '12']);
  });

  it('se detiene en un punto de interrupción, muestra las variables y continúa', () => {
    const { it, out } = make();
    const d = it.debug('Main', [], { breakpoints: ['M:9'] });
    expect(d.state).toBe('paused');
    expect(d.pause).toMatchObject({ module: 'M', line: 9, proc: 'Main', depth: 1 });
    const vars = Object.fromEntries(d.locals().map((v) => [v.name, v.value]));
    expect(vars).toMatchObject({ a: '6', s: '"hola"', i: '1' });
    expect(out).toEqual(['6']);
    d.step('continue');
    expect(d.pause?.line).toBe(9); // segunda vuelta
    expect(d.locals().find((v) => v.name === 'i')?.value).toBe('2');
    d.setBreakpoints([]);
    d.step('continue');
    expect(d.state).toBe('done');
    expect(out).toEqual(['6', '12']);
  });

  it('paso a paso: dentro, sobre y fuera', () => {
    const { it } = make();
    const d = it.debug('Main', [], { stopAtStart: true });
    expect(d.pause?.line).toBe(3);
    d.step('over');
    expect(d.pause?.line).toBe(4);
    d.step('over');
    expect(d.pause?.line).toBe(5);
    d.step('into'); // entra en Dobla
    expect(d.pause).toMatchObject({ line: 14, proc: 'Dobla', depth: 2 });
    d.step('into'); // Triplica x
    expect(d.pause).toMatchObject({ line: 15, depth: 2 });
    d.step('into');
    expect(d.pause).toMatchObject({ line: 18, proc: 'Triplica', depth: 3 });
    expect(d.stack().map((f) => f.proc)).toEqual(['Triplica', 'Dobla', 'Main']);
    expect(d.locals().map((v) => v.name)).toEqual(['y']); // el parámetro ByRef lleva el nombre que le da el procedimiento
    expect(d.locals(1).map((v) => v.name)).toEqual(['x']);
    d.step('out'); // sale de Triplica y de Dobla (no tienen más sentencias): queda en Main
    expect(d.pause).toMatchObject({ proc: 'Main', line: 6, depth: 1 });
    expect(d.locals().find((v) => v.name === 'a')?.value).toBe('6');
  });

  it('«sobre» no entra en los procedimientos que llama', () => {
    const { it } = make();
    const d = it.debug('Main', [], { breakpoints: ['M:5'] });
    expect(d.pause?.line).toBe(5);
    d.step('over');
    expect(d.pause?.line).toBe(6);
    expect(d.locals().find((v) => v.name === 'a')?.value).toBe('6');
  });

  it('una función dentro de una expresión no se detiene (se ejecuta entera)', () => {
    const { it, out } = make();
    const d = it.debug('ConFuncion', [], { breakpoints: ['M:21'] });
    expect(d.state).toBe('done');
    expect(out).toEqual(['8']);
  });

  it('evalúa expresiones y cambia variables mientras está detenido', () => {
    const { it, out } = make();
    const d = it.debug('Main', [], { breakpoints: ['M:6'] });
    expect(d.evaluate('a * 10')).toBe('60');
    expect(d.evaluate('? s & "!"')).toBe('"hola!"');
    d.evaluate('a = 100');
    d.step('continue');
    expect(d.state).toBe('done');
    expect(out[0]).toBe('100');
  });

  it('un error en el programa deja la sesión en error con su línea', () => {
    const { it } = make();
    const d = it.debug('Falla', [], { stopAtStart: true });
    d.step('over');
    d.step('over');
    expect(d.state).toBe('error');
    expect((d.error as { line?: number }).line).toBe(30);
  });

  it('detener termina la ejecución y libera el intérprete', () => {
    const { it, out } = make();
    const d = it.debug('Main', [], { stopAtStart: true });
    d.stop();
    expect(d.state).toBe('done');
    expect(out).toEqual([]);
    expect(it.debug('Main').state).toBe('done'); // se puede volver a depurar
  });
});

describe('Nova Basic: argumentos con nombre', () => {
  it('una palabra clave puede ser el nombre de un argumento (SetRange Start:=1, End:=3)', () => {
    const it = new Interpreter({ print: () => undefined, msgBox: () => 1, inputBox: () => '' });
    const src = ['Sub A()', '  Selection.SetRange Start:=1, End:=3', '  x = Foo(End:=2)', 'End Sub'].join(String.fromCharCode(10));
    expect(it.load([{ name: 'M', source: src }])).toEqual([]);
  });
});
