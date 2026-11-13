import { describe, expect, it } from 'vitest';
import { parseA1 } from './addr';
import { CalcError, type Scalar } from './values';
import { Workbook } from './workbook';

function ev(formula: string, cells: Record<string, string> = {}): Scalar {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  w.transact(() => {
    for (const [a, t] of Object.entries({ ...cells, Z99: `=${formula}` })) {
      const p = parseA1(a)!;
      w.setInput(id, p.row, p.col, t);
    }
  });
  const p = parseA1('Z99')!;
  return w.getValue(id, p.row, p.col);
}
const near = (v: Scalar, x: number, d = 1e-4) => {
  expect(typeof v).toBe('number');
  expect(Math.abs((v as number) - x)).toBeLessThan(d);
};
const code = (v: Scalar) => (v instanceof CalcError ? v.code : v);
const D = (y: number, m: number, d: number) => `DATE(${y},${m},${d})`;

describe('financieras con fechas y tasas', () => {
  const cf = { A1: '-10000', A2: '2750', A3: '4250', A4: '3250', A5: '2750', B1: '39448', B2: '39508', B3: '39751', B4: '39859', B5: '39904' };
  it('XNPV y XIRR (ejemplo de Microsoft)', () => {
    near(ev('XNPV(0.09,A1:A5,B1:B5)', cf), 2086.6476, 1e-3);
    near(ev('XIRR(A1:A5,B1:B5)', cf), 0.373362535, 1e-6);
    expect(code(ev('XIRR(A2:A5,B2:B5)', cf))).toBe('#NUM!');
  });
  it('MIRR, EFFECT, NOMINAL, RRI, PDURATION, ISPMT, FVSCHEDULE', () => {
    near(ev('MIRR(A1:A6,0.1,0.12)', { A1: '-120000', A2: '39000', A3: '30000', A4: '21000', A5: '37000', A6: '46000' }), 0.126094, 1e-5);
    near(ev('EFFECT(0.0525,4)'), 0.053543, 1e-6);
    near(ev('NOMINAL(0.053543,4)'), 0.0525, 1e-6);
    near(ev('RRI(96,10000,11000)'), 0.000993, 1e-6);
    near(ev('PDURATION(0.025,2000,2200)'), 3.86, 1e-2);
    near(ev('ISPMT(0.1/12,1,36,8000000)'), -64814.81, 1e-2);
    near(ev('FVSCHEDULE(1,{0.09,0.11,0.1})'), 1.33089, 1e-5);
  });
  it('CUMIPMT y CUMPRINC', () => {
    near(ev('CUMIPMT(0.09/12,360,125000,13,24,0)'), -11135.23, 1e-2);
    near(ev('CUMPRINC(0.09/12,360,125000,13,24,0)'), -934.1071, 1e-3);
    near(ev('CUMIPMT(0.09/12,360,125000,1,1,0)'), -937.5, 1e-3);
    expect(code(ev('CUMIPMT(0.09/12,360,125000,0,1,0)'))).toBe('#NUM!');
  });
  it('depreciación', () => {
    near(ev('DB(1000000,100000,6,1,7)'), 186083.33, 1e-2);
    near(ev('DB(1000000,100000,6,2,7)'), 259639.42, 1e-2);
    near(ev('DB(1000000,100000,6,7,7)'), 15845.1, 1e-2);
    near(ev('DDB(2400,300,3650,1)'), 1.32, 1e-2);
    near(ev('DDB(2400,300,10,1,2)'), 480);
    near(ev('DDB(2400,300,10,10)'), 22.12, 1e-2);
    near(ev('SYD(30000,7500,10,1)'), 4090.91, 1e-2);
    near(ev('SYD(30000,7500,10,10)'), 409.09, 1e-2);
    near(ev('VDB(2400,300,120,6,18)'), 396.31, 1e-2);
    near(ev('VDB(2400,300,3650,0,1)'), 1.32, 1e-2);
  });
  it('DOLLARDE, DOLLARFR y DAYS360', () => {
    near(ev('DOLLARDE(1.02,16)'), 1.125);
    near(ev('DOLLARFR(1.125,16)'), 1.02);
    expect(ev(`DAYS360(${D(2008, 1, 30)},${D(2008, 2, 1)})`)).toBe(1);
    expect(ev(`DAYS360(${D(2008, 1, 1)},${D(2008, 12, 31)})`)).toBe(360);
  });
});

describe('renta fija', () => {
  it('cupones', () => {
    const a = `${D(2011, 1, 25)},${D(2011, 11, 15)},2`;
    expect(ev(`COUPDAYBS(${a},1)`)).toBe(71);
    expect(ev(`COUPDAYS(${a},1)`)).toBe(181);
    expect(ev(`COUPDAYSNC(${a},1)`)).toBe(110);
    expect(ev(`COUPNCD(${a},1)`)).toBe(40678);
    expect(ev(`COUPPCD(${a},1)`)).toBe(40497);
    expect(ev(`COUPNUM(${a},1)`)).toBe(2);
    expect(code(ev(`COUPNUM(${a},9)`))).toBe('#NUM!');
  });
  it('PRICE, YIELD, DURATION y MDURATION', () => {
    near(ev(`PRICE(${D(2008, 2, 15)},${D(2017, 11, 15)},0.0575,0.065,100,2,0)`), 94.63436162, 1e-6);
    near(ev(`YIELD(${D(2008, 2, 15)},${D(2016, 11, 15)},0.0575,95.04287,100,2,0)`), 0.065, 1e-6);
    near(ev(`DURATION(${D(2008, 1, 1)},${D(2016, 1, 1)},0.08,0.09,2,1)`), 5.993775, 1e-5);
    near(ev(`MDURATION(${D(2008, 1, 1)},${D(2016, 1, 1)},0.08,0.09,2,1)`), 5.73567, 1e-4);
  });
  it('valores a descuento, a vencimiento y letras del tesoro', () => {
    near(ev(`DISC(${D(2007, 1, 25)},${D(2007, 6, 15)},97.975,100,1)`), 0.05242, 1e-5);
    near(ev(`PRICEDISC(${D(2008, 2, 16)},${D(2008, 3, 1)},0.0525,100,2)`), 99.79583, 1e-5);
    near(ev(`INTRATE(${D(2008, 2, 15)},${D(2008, 5, 15)},1000000,1014420,2)`), 0.05768, 1e-5);
    near(ev(`RECEIVED(${D(2008, 2, 15)},${D(2008, 5, 15)},1000000,0.0575,2)`), 1014584.654, 1e-2);
    near(ev(`YIELDDISC(${D(2008, 2, 16)},${D(2008, 3, 1)},99.795,100,2)`), 0.052823, 1e-5);
    near(ev(`PRICEMAT(${D(2008, 2, 15)},${D(2008, 4, 13)},${D(2007, 11, 11)},0.061,0.061,0)`), 99.98449888, 1e-6);
    near(ev(`YIELDMAT(${D(2008, 3, 15)},${D(2008, 11, 3)},${D(2007, 11, 8)},0.0625,100.0123,0)`), 0.060954, 1e-5);
    near(ev(`ACCRINTM(${D(2008, 4, 1)},${D(2008, 6, 15)},0.1,1000,3)`), 20.54795, 1e-4);
    near(ev(`TBILLEQ(${D(2008, 3, 31)},${D(2008, 6, 1)},0.0914)`), 0.094151, 1e-5);
    near(ev(`TBILLPRICE(${D(2008, 3, 31)},${D(2008, 6, 1)},0.09)`), 98.45, 1e-6);
    near(ev(`TBILLYIELD(${D(2008, 3, 31)},${D(2008, 6, 1)},98.45)`), 0.091417, 1e-5);
    near(ev(`ACCRINT(${D(2008, 3, 1)},${D(2008, 8, 31)},${D(2008, 5, 1)},0.1,1000,2,0)`), 16.666667, 1e-5);
  });
});

describe('fechas, matemáticas y texto', () => {
  it('días laborables con fin de semana a elección', () => {
    expect(ev(`NETWORKDAYS.INTL(${D(2006, 1, 1)},${D(2006, 1, 31)},1)`)).toBe(22);
    expect(ev(`NETWORKDAYS.INTL(${D(2006, 1, 1)},${D(2006, 1, 31)},"0000011")`)).toBe(22);
    expect(ev(`NETWORKDAYS.INTL(${D(2006, 1, 1)},${D(2006, 1, 31)},11)`)).toBe(26);
    expect(ev(`WORKDAY.INTL(${D(2012, 1, 1)},30,11)`)).toBe(ev(D(2012, 2, 4)));
    expect(code(ev(`NETWORKDAYS.INTL(${D(2006, 1, 1)},${D(2006, 1, 31)},"1111111")`))).toBe('#VALUE!');
  });
  it('AGGREGATE', () => {
    const c = { A1: '1', A2: '=1/0', A3: '3', A4: '4' };
    near(ev('AGGREGATE(9,6,A1:A4)', c), 8);
    expect(code(ev('AGGREGATE(9,4,A1:A4)', c))).toBe('#DIV/0!');
    near(ev('AGGREGATE(14,6,A1:A4,2)', c), 3);
    near(ev('AGGREGATE(4,6,A1:A4)', c), 4);
  });
  it('redondeos y estadística', () => {
    expect(ev('CEILING.PRECISE(-4.3,2)')).toBe(-4);
    expect(ev('FLOOR.PRECISE(-3.2,1)')).toBe(-4);
    near(ev('QUARTILE.EXC({1,2,3,4,5,6,7,8},1)'), 2.25);
    near(ev('RANK.AVG(2,{1,2,2,3})'), 2.5);
    near(ev('PERCENTOF({1,2},{1,2,3,4})'), 0.3);
  });
  it('texto: variantes B, VALUETOTEXT, ARRAYTOTEXT y ENCODEURL', () => {
    expect(ev('LENB("hola")')).toBe(4);
    expect(ev('LEFTB("hola",2)')).toBe('ho');
    expect(ev('VALUETOTEXT("a",1)')).toBe('"a"');
    expect(ev('ARRAYTOTEXT({1,"a";2,"b"})')).toBe('1, a, 2, b');
    expect(ev('ARRAYTOTEXT({1,"a";2,"b"},1)')).toBe('{1,"a";2,"b"}');
    expect(ev('ENCODEURL("a b/ñ(1)")')).toBe('a%20b%2F%C3%B1%281%29');
  });
  it('expresiones regulares', () => {
    expect(ev('REGEXTEST("Hola 123","\\d+")')).toBe(true);
    expect(ev('REGEXTEST("HOLA","hola")')).toBe(false);
    expect(ev('REGEXTEST("HOLA","hola",1)')).toBe(true);
    expect(ev('REGEXEXTRACT("tel 555-1234","\\d+-\\d+")')).toBe('555-1234');
    expect(ev('REGEXREPLACE("a1b22","\\d+","#")')).toBe('a#b#');
    expect(ev('REGEXREPLACE("a1b22","(\\d+)","<$1>",2)')).toBe('a1b<22>');
    expect(code(ev('REGEXEXTRACT("abc","\\d")'))).toBe('#N/A');
  });
  it('matrices: EXPAND, WRAPROWS, WRAPCOLS, TRIMRANGE', () => {
    const w = (f: string) => {
      const b = new Workbook();
      const id = b.sheets[0]!.id;
      b.transact(() => b.setInput(id, 0, 0, `=${f}`));
      return [0, 1, 2].map((r) => [0, 1, 2].map((c) => b.getValue(id, r, c)));
    };
    expect(w('EXPAND({1,2;3,4},3,3,0)')).toEqual([[1, 2, 0], [3, 4, 0], [0, 0, 0]]);
    const wr = w('WRAPROWS({1,2,3,4,5},2)');
    expect(wr[0]!.slice(0, 2)).toEqual([1, 2]);
    expect(wr[2]![0]).toBe(5);
    expect(code(wr[2]![1]!)).toBe('#N/A');
    expect(w('WRAPCOLS({1,2,3,4},2)').slice(0, 2).map((r) => r.slice(0, 2))).toEqual([[1, 3], [2, 4]]);
    expect(ev('ROWS(TRIMRANGE(A1:A6))', { A2: '1', A3: '2' })).toBe(2);
  });
  it('CELL e INFO', () => {
    expect(ev('CELL("address",B3)')).toBe('$B$3');
    expect(ev('CELL("row",B3)')).toBe(3);
    expect(ev('CELL("col",B3)')).toBe(2);
    expect(ev('CELL("type",B3)', { B3: 'hola' })).toBe('l');
    expect(ev('INFO("recalc")')).toBe('Automatic');
  });
});
