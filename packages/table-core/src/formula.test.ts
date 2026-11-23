import { describe, expect, it } from 'vitest';
import { FORMULA_FUNCTIONS, cellName, colName, evalFormula, formatGeneral, splitFormula, type FormulaContext } from './index';

/** A table of text. The cell that holds the formula is given by row and col. */
const table = (data: string[][], row: number, col: number, decimal?: '.' | ','): FormulaContext => ({
  row,
  col,
  rows: data.length,
  cols: Math.max(...data.map((r) => r.length)),
  text: (r, c) => data[r]?.[c] ?? '',
  decimal,
});

const SALES = [
  ['Producto', 'Cant', 'Precio'],
  ['A', '2', '10'],
  ['B', '3', '20'],
  ['C', '5', '30'],
  ['Total', '', ''],
];
const at = (r: number, c: number) => table(SALES, r, c);
const ev = (f: string, r = 4, c = 1) => evalFormula(f, at(r, c));

describe('names of cells', () => {
  it('turns positions into names and back', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(cellName(0, 0)).toBe('A1');
    expect(cellName(9, 27)).toBe('AB10');
  });
});

describe('the direction words', () => {
  it('sums the numbers above, skipping the text of the header', () => {
    expect(ev('=SUM(ABOVE)')).toMatchObject({ value: 10, text: '10' });
    expect(ev('=SUM(ABOVE)', 4, 2).value).toBe(60);
  });
  it('stops at the first empty cell', () => {
    const t = table([['1'], ['2'], [''], ['4'], ['']], 4, 0);
    expect(evalFormula('=SUM(ABOVE)', t).value).toBe(4);
  });
  it('left, right and below', () => {
    const t = table([['1', '2', '', '4', '5']], 0, 2);
    expect(evalFormula('=SUM(LEFT)', t).value).toBe(3);
    expect(evalFormula('=SUM(RIGHT)', t).value).toBe(9);
    expect(evalFormula('=SUM(BELOW)', table([[''], ['3'], ['4']], 0, 0)).value).toBe(7);
  });
  it('the Spanish words and names work the same', () => {
    expect(ev('=SUMA(ARRIBA)').value).toBe(10);
    expect(ev('=PROMEDIO(ARRIBA)').value).toBeCloseTo(10 / 3);
    expect(evalFormula('=SUMA(IZQUIERDA)', table([['1', '2', '']], 0, 2)).value).toBe(3);
    expect(ev('=CONTAR(ARRIBA)').value).toBe(3);
  });
});

describe('references and ranges', () => {
  it('cells and ranges', () => {
    expect(ev('=B2*C2').value).toBe(20);
    expect(ev('=SUM(B2:B4)').value).toBe(10);
    expect(ev('=AVERAGE(C2:C4)').value).toBe(20);
    expect(ev('=MAX(B2:C4)').value).toBe(30);
    expect(ev('=MIN(B2:B4)').value).toBe(2);
    expect(ev('=PRODUCT(B2:B3)').value).toBe(6);
    expect(ev('=COUNT(A2:C4)').value).toBe(6);
    expect(ev('=sum(b2:b4)').value).toBe(10);
  });
  it('a text or empty cell in arithmetic is zero and out of range is an error', () => {
    expect(ev('=A2+1').value).toBe(1);
    expect(ev('=B5+1').value).toBe(1);
    expect(ev('=Z99')).toMatchObject({ value: null, error: '!Referencia no válida' });
  });
});

describe('arithmetic and functions', () => {
  it('operators with their priority, parentheses, percent, power and sign', () => {
    expect(ev('=1+2*3').value).toBe(7);
    expect(ev('=(1+2)*3').value).toBe(9);
    expect(ev('=10/4').value).toBe(2.5);
    expect(ev('=2^3').value).toBe(8);
    expect(ev('=50%*200').value).toBe(100);
    expect(ev('=-3+5').value).toBe(2);
    expect(ev('=7-2-1').value).toBe(4);
  });
  it('rounding, integer part, modulus, absolute value and sign', () => {
    expect(ev('=ROUND(10/3,2)').value).toBe(3.33);
    expect(ev('=ROUND(2.5)').value).toBe(3);
    expect(ev('=ROUND(-2.5)').value).toBe(-3);
    expect(ev('=ROUND(1234.5;-2)').value).toBe(1200);
    expect(ev('=INT(-2.5)').value).toBe(-3);
    expect(ev('=MOD(10,3)').value).toBe(1);
    expect(ev('=MOD(-1,3)').value).toBe(2);
    expect(ev('=ABS(-4)').value).toBe(4);
    expect(ev('=SIGN(-4)').value).toBe(-1);
    expect(evalFormula('=REDONDEAR(2,567;1)', table(SALES, 4, 1, ',')).value).toBe(2.6);
  });
  it('comparisons and logic', () => {
    expect(ev('=IF(B2>1,100,200)').value).toBe(100);
    expect(ev('=SI(B2>5;1;0)').value).toBe(0);
    expect(ev('=AND(1,1,0)').value).toBe(0);
    expect(ev('=OR(0,0,1)').value).toBe(1);
    expect(ev('=NOT(0)').value).toBe(1);
    expect(ev('=1<>2').value).toBe(1);
    expect(ev('=3>=3').value).toBe(1);
    expect(ev('=TRUE+1').value).toBe(2);
  });
});

describe('number pictures', () => {
  it('applies the picture after the formula', () => {
    expect(ev('=SUM(ABOVE) \\# "0.00"').text).toBe('10.00');
    expect(ev('=SUM(C2:C4) \\# "$#,##0.00"').text).toBe('$60.00');
    expect(ev('=B2/B4 \\# 0%').text).toBe('40%');
    expect(ev('=SUM(ABOVE)').text).toBe('10');
    expect(splitFormula('=SUM(ABOVE) \\# "0.0"')).toEqual({ expr: 'SUM(ABOVE)', picture: '0.0' });
    expect(splitFormula('=1+1')).toEqual({ expr: '1+1' });
  });
  it('writes up to ten significant digits and no trailing zeros', () => {
    expect(formatGeneral(1 / 3)).toBe('0.3333333333');
    expect(formatGeneral(0.1 + 0.2)).toBe('0.3');
    expect(formatGeneral(1234.5, ',')).toBe('1234,5');
  });
});

describe('numbers with a decimal comma', () => {
  const data = [['1,5'], ['2,25'], ['']];
  it('reads and writes with the comma', () => {
    const t = table(data, 2, 0, ',');
    expect(evalFormula('=SUM(ABOVE)', t)).toMatchObject({ value: 3.75, text: '3,75' });
    expect(evalFormula('=A1*2', t).text).toBe('3');
    expect(evalFormula('=SUM(ABOVE) \\# "0.00"', t).text).toBe('3,75');
    expect(evalFormula('=1,5+1', t).value).toBe(2.5);
  });
});

describe('errors', () => {
  it('say what happened and start with «!» like Word', () => {
    expect(ev('=1/0')).toMatchObject({ value: null, text: '!División por cero', error: '!División por cero' });
    expect(ev('=AVERAGE(B5:C5)').error).toBe('!División por cero');
    expect(ev('=SUM(').error).toBe('!Error de sintaxis');
    expect(ev('=1+').error).toBe('!Error de sintaxis');
    expect(ev('=NOPE(1)').error).toBe('!Error de sintaxis');
    expect(ev('=').error).toBe('!Error de sintaxis');
    expect(ev('=3 $ 4').error).toBe('!Error de sintaxis');
    expect(ev('=1 2').error).toBe('!Error de sintaxis');
    expect(ev('=MOD(1,0)').error).toBe('!División por cero');
    expect(ev('=ROUND()').error).toBe('!Faltan argumentos');
    expect(ev('=(-8)^0.5').error).toBe('!Resultado no válido');
  });
});

describe('the list of functions', () => {
  it('has the English and the Spanish name of each one, and every one evaluates', () => {
    expect(FORMULA_FUNCTIONS.length).toBeGreaterThanOrEqual(15);
    for (const f of FORMULA_FUNCTIONS) {
      const args = f.args === 'ABOVE' ? 'B2:B4' : f.args === 'x' ? '4' : f.args === 'x, n' ? '4,1' : f.args === 'x, y' ? '7,3' : f.args === 'prueba, si, no' ? '1,2,3' : f.args === 'a, b' ? '1,1' : '1';
      expect(ev(`=${f.en}(${args})`).error, f.en).toBeUndefined();
      expect(ev(`=${f.es}(${args})`).error, f.es).toBeUndefined();
    }
  });
});
