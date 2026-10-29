import { describe, expect, it } from 'vitest';
import { ExprError, evalExpr, evalSafe, fieldsOf, hasAggregate, parseExpr, type Row } from './expr';

const row: Row = { Precio: 10, Cantidad: 3, Nombre: 'Ana', Vacio: null, Fecha: '2024-03-15', Texto: '7' };
const ev = (e: string, scope?: Row[]) => evalExpr(e, { row, scope, now: new Date(2025, 0, 2, 10, 30) });

describe('expressions', () => {
  it('arithmetic with precedence, unary minus, power and integer division', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('-2 ^ 2')).toBe(4); // unary binds tighter, as in Access
    expect(ev('2 ^ 3 ^ 2')).toBe(512);
    expect(ev('7 \\ 2')).toBe(3);
    expect(ev('7 % 4')).toBe(3);
    expect(ev('1 / 0')).toBeNull();
    expect(ev('=[Precio] * [Cantidad]')).toBe(30);
    expect(ev('1.5e1 + .5')).toBe(15.5);
  });

  it('fields are case-insensitive, text digits count as numbers, null propagates', () => {
    expect(ev('[precio] + [texto]')).toBe(17);
    expect(ev('[Vacio] + 1')).toBeNull();
    expect(ev('Nz([Vacio], 5) + 1')).toBe(6);
    expect(ev('IsNull([Vacio])')).toBe(true);
    expect(() => ev('[Nada]')).toThrow(/No existe el campo \[Nada\]/);
  });

  it('text: concatenation, quotes, functions', () => {
    expect(ev('[Nombre] & " " & "Ruiz"')).toBe('Ana Ruiz');
    expect(ev(`'it''s'`)).toBe("it's");
    expect(ev('"a" + "b"')).toBe('ab');
    expect(ev('Upper(Left([Nombre], 2)) & Len([Nombre])')).toBe('AN3');
    expect(ev('Mid("abcdef", 2, 3)')).toBe('bcd');
    expect(ev('Right("abcdef", 2)')).toBe('ef');
    expect(ev('Trim("  x ")')).toBe('x');
  });

  it('comparison, logic with null, IIf', () => {
    expect(ev('[Precio] > 5 And [Cantidad] < 5')).toBe(true);
    expect(ev('[Precio] > 50 Or [Cantidad] = 3')).toBe(true);
    expect(ev('Not [Precio] > 5')).toBe(false);
    expect(ev('[Vacio] > 1')).toBeNull();
    expect(ev('[Vacio] > 1 Or True')).toBe(true);
    expect(ev('[Vacio] > 1 And False')).toBe(false);
    expect(ev('"abc" = "ABC"')).toBe(true);
    expect(ev('"a" < "b"')).toBe(true);
    expect(ev('IIf([Precio] >= 10, "caro", "barato")')).toBe('caro');
    expect(ev('Si([Precio] < 10, 1, 2)')).toBe(2);
    expect(ev('[Precio] <> 10')).toBe(false);
    expect(ev('[Precio] != 11')).toBe(true);
  });

  it('numbers: Round, Abs, Int, Sqrt', () => {
    expect(ev('Round(2.675, 2)')).toBe(2.68);
    expect(ev('Round(1234.5)')).toBe(1235);
    expect(ev('Round(1234, -2)')).toBe(1200);
    expect(ev('Abs(-3) + Int(2.9) + Sqrt(16)')).toBe(9);
  });

  it('dates', () => {
    expect(ev('Year([Fecha]) * 100 + Month([Fecha])')).toBe(202403);
    expect(ev('Day([Fecha])')).toBe(15);
    expect(ev('Date()')).toBe('2025-01-02');
    expect(ev('Now()')).toBe('2025-01-02 10:30');
  });

  it('aggregates run over the scope', () => {
    const scope: Row[] = [{ Importe: 10, Zona: 'N' }, { Importe: 5.5, Zona: 'S' }, { Importe: null, Zona: 'N' }, { Importe: 4, Zona: null }];
    expect(ev('Sum([Importe])', scope)).toBe(19.5);
    expect(ev('Count([Importe])', scope)).toBe(3);
    expect(ev('Count()', scope)).toBe(4);
    expect(ev('Avg([Importe])', scope)).toBeCloseTo(6.5);
    expect(ev('Min([Importe]) & "-" & Max([Importe])', scope)).toBe('4-10');
    expect(ev('Sum([Importe] * 2) / Count([Importe])', scope)).toBeCloseTo(13);
    expect(ev('Suma([Importe])', scope)).toBe(19.5);
    expect(ev('Sum([Importe])', [])).toBeNull();
    expect(hasAggregate(parseExpr('1 + Sum([a])'))).toBe(true);
    expect(hasAggregate(parseExpr('[a] + 1'))).toBe(false);
  });

  it('reports what a bad expression got wrong, with the position', () => {
    expect(() => parseExpr('')).toThrow(/vacía/);
    expect(() => parseExpr('1 +')).toThrow(/incompleta/);
    expect(() => parseExpr('(1 + 2')).toThrow(/Se esperaba "\)"/);
    expect(() => parseExpr('[abc')).toThrow(/corchete/);
    expect(() => parseExpr('"abc')).toThrow(/comillas/);
    expect(() => parseExpr('Precio * 2')).toThrow(/entre corchetes/);
    expect(() => parseExpr('Foo(1)')).toThrow(/Función desconocida/);
    expect(() => parseExpr('1 2')).toThrow(/No se esperaba/);
    expect(() => parseExpr('1 # 2')).toThrow(/Carácter no válido/);
    try {
      parseExpr('1 + * 2');
    } catch (e) {
      expect(e).toBeInstanceOf(ExprError);
      expect((e as ExprError).pos).toBe(4);
    }
  });

  it('lists the fields it reads, and evalSafe turns errors into #Error', () => {
    expect(fieldsOf(parseExpr('[a] * 2 + Sum([b]) & IIf([a] > 1, [c], 0)')).sort()).toEqual(['a', 'b', 'c']);
    expect(evalSafe('[Nada] + 1', { row })).toBe('#Error');
    expect(evalSafe('[Precio] +', { row })).toBe('#Error');
  });

  it('is not eval: code-looking text is just text or an error', () => {
    expect(() => parseExpr('constructor.constructor("return 1")()')).toThrow();
    expect(() => parseExpr('process.exit()')).toThrow();
    expect(ev('"process.exit()"')).toBe('process.exit()');
  });
});
