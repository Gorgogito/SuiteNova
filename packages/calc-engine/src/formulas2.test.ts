import { describe, expect, it } from 'vitest';
import { parseA1 } from './addr';
import { printFormula } from './formula';
import { canonicalFormula, localizeFormula } from './locale';
import { parseFormula } from './parser';
import { CalcError, E, type Scalar } from './values';
import { Workbook } from './workbook';

function book(cells: Record<string, string> = {}) {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  const set = (a: string, t: string, sheet = id) => {
    const p = parseA1(a)!;
    w.setInput(sheet, p.row, p.col, t);
  };
  w.transact(() => {
    for (const [a, t] of Object.entries(cells)) set(a, t);
  });
  const get = (a: string, sheet = id) => {
    const p = parseA1(a)!;
    return w.getValue(sheet, p.row, p.col);
  };
  return { w, id, get, set };
}

function ev(formula: string, cells: Record<string, string> = {}): Scalar {
  return book({ ...cells, Z99: `=${formula}` }).get('Z99');
}
const close = (v: Scalar, expected: number, digits = 9) => {
  expect(typeof v, String(v)).toBe('number');
  expect(Math.abs((v as number) - expected)).toBeLessThan(10 ** -digits * Math.max(1, Math.abs(expected)));
};
const err = (code: string) => CalcError.parse(code)!;

describe('3D references', () => {
  const three = () => {
    const b = book();
    b.w.renameSheet(b.id, 'Hoja1');
    const s2 = b.w.addSheet('Hoja2');
    const s3 = b.w.addSheet('Hoja3');
    b.set('A1', '1');
    b.set('A1', '2', s2.id);
    b.set('A1', '3', s3.id);
    b.set('B1', '10');
    b.set('B1', '20', s2.id);
    b.set('B1', '30', s3.id);
    return { ...b, s2, s3 };
  };
  it('parses and prints Hoja1:Hoja3!A1 and the quoted form', () => {
    expect(printFormula(parseFormula('SUM(Hoja1:Hoja3!A1)'))).toBe('SUM(Hoja1:Hoja3!A1)');
    expect(printFormula(parseFormula("SUM('Mi hoja:Otra hoja'!A1:B2)"))).toBe("SUM('Mi hoja:Otra hoja'!A1:B2)");
    expect(printFormula(parseFormula('SUM(Hoja1:Hoja3!A:A)'))).toBe('SUM(Hoja1:Hoja3!A:A)');
  });
  it('sums, counts and averages over every sheet between the ends', () => {
    const b = three();
    b.set('D1', '=SUM(Hoja1:Hoja3!A1)');
    b.set('D2', '=SUM(Hoja1:Hoja3!A1:B1)');
    b.set('D3', '=AVERAGE(Hoja1:Hoja3!B1)');
    b.set('D4', '=COUNT(Hoja1:Hoja3!A1:B1)');
    b.set('D5', '=MAX(Hoja1:Hoja3!A1:B1)');
    expect([b.get('D1'), b.get('D2'), b.get('D3'), b.get('D4'), b.get('D5')]).toEqual([6, 66, 20, 6, 30]);
  });
  it('follows edits, new sheets in between and sheets removed', () => {
    const b = three();
    b.set('D1', '=SUM(Hoja1:Hoja3!A1)');
    b.set('A1', '5', b.s2.id);
    expect(b.get('D1')).toBe(1 + 5 + 3);
    const mid = b.w.addSheet('Nueva', 2); // between Hoja2 and Hoja3
    b.set('A1', '100', mid.id);
    expect(b.get('D1')).toBe(109);
    b.w.removeSheet(mid.id);
    expect(b.get('D1')).toBe(9);
  });
  it('is #REF! when an end sheet does not exist, and #VALUE! for functions that cannot take it', () => {
    const b = three();
    b.set('D1', '=SUM(Hoja1:Nada!A1)');
    b.set('D2', '=ABS(Hoja1:Hoja3!A1)');
    expect(b.get('D1')).toBe(err('#REF!'));
    expect(b.get('D2')).toBe(err('#VALUE!'));
  });
  it('renames either end', () => {
    const b = three();
    b.set('D1', '=SUM(Hoja1:Hoja3!A1)');
    b.w.renameSheet(b.s3.id, 'Fin');
    expect(b.w.getInputText(b.id, 0, 3)).toBe('=SUM(Hoja1:Fin!A1)');
  });
});

describe('union and intersection operators', () => {
  const cells = { A1: '1', A2: '2', A3: '3', B1: '10', B2: '20', B3: '30', C1: '100', C2: '200', C3: '300' };
  it('unions several references', () => {
    expect(ev('SUM((A1:A3,C1:C3))', cells)).toBe(606);
    expect(ev('COUNT((A1:A3,B1,C3))', cells)).toBe(5);
    expect(ev('LARGE((A1:A3,C1:C3),2)', cells)).toBe(200);
    expect(ev('AREAS((A1:A3,C1:C3,B2))', cells)).toBe(3);
    expect(ev('INDEX((A1:A3,C1:C3),2,1,2)', cells)).toBe(200);
  });
  it('prints and re-parses the union', () => {
    expect(printFormula(parseFormula('SUM((A1:A3,C1:C3))'))).toBe('SUM((A1:A3,C1:C3))');
  });
  it('intersects with a space', () => {
    expect(ev('SUM(A1:C2 B2:C3)', cells)).toBe(20 + 200);
    expect(ev('B1:B3 A2:C2', cells)).toBe(20);
    expect(ev('SUM(A1:A3 C1:C3)', cells)).toBe(err('#NULL!'));
  });
  it('gives #NULL! when nothing is shared', () => {
    expect(ev('A1:A3 C1:C3', cells)).toBe(err('#NULL!'));
  });
  it('works with names', () => {
    const b = book({ ...cells, Z98: '=SUM(Fila2 Colb)' });
    b.w.defineName('Fila2', 'A2:C2');
    b.w.defineName('Colb', 'B1:B3');
    b.w.recalcAll();
    expect(b.get('Z98')).toBe(20);
  });
  it('keeps "1 2" a syntax error and spaces around operators harmless', () => {
    expect(() => parseFormula('1 2')).toThrow();
    expect(ev('A1 + B1 * 2', cells)).toBe(21);
    expect(ev('SUM( A1 : A3 )', cells)).toBe(6);
  });
  it('localises the union with the list separator', () => {
    expect(canonicalFormula('SUMA((A1:A3;C1:C3))', 'es')).toBe('SUM((A1:A3,C1:C3))');
    expect(localizeFormula('SUM((A1:A3,C1:C3))', 'es')).toBe('SUMA((A1:A3;C1:C3))');
  });
});

describe('implicit intersection (@)', () => {
  it('takes the cell on the formula row', () => {
    const b = book({ A1: '10', A2: '20', A3: '30' });
    b.set('B2', '=@A1:A3');
    b.set('B3', '=@A1:A3*2');
    expect(b.get('B2')).toBe(20);
    expect(b.get('B3')).toBe(60);
  });
  it('is #VALUE! when the row is outside the range, and the first element of an array', () => {
    const b = book({ A1: '10', A2: '20' });
    b.set('B5', '=@A1:A2');
    b.set('B6', '=@{7,8,9}');
    expect(b.get('B5')).toBe(err('#VALUE!'));
    expect(b.get('B6')).toBe(7);
  });
  it('prints with the @', () => {
    expect(printFormula(parseFormula('@A1:A3+1'))).toBe('@A1:A3+1');
  });
});

describe('LAMBDA and its helpers', () => {
  it('calls a lambda in place', () => {
    expect(ev('LAMBDA(x,y,x*y+1)(3,4)')).toBe(13);
    expect(ev('LAMBDA(5)()')).toBe(5);
  });
  it('binds a lambda with LET', () => {
    expect(ev('LET(f,LAMBDA(a,a*a),f(7)+f(2))')).toBe(53);
  });
  it('closes over the variables where it was made', () => {
    expect(ev('LET(k,10,f,LAMBDA(a,a+k),LET(k,1000,f(5)))')).toBe(15);
  });
  it('uses a defined name as a function, and recurses', () => {
    const b = book({ Z99: '=Cuadrado(6)', Z98: '=Fact(5)' });
    b.w.defineName('Cuadrado', 'LAMBDA(n,n*n)');
    b.w.defineName('Fact', 'LAMBDA(n,IF(n<=1,1,n*Fact(n-1)))');
    b.w.recalcAll();
    expect(b.get('Z99')).toBe(36);
    expect(b.get('Z98')).toBe(120);
  });
  it('stops a runaway recursion with #CALC!', () => {
    const b = book({ Z99: '=Bucle(1)' });
    b.w.defineName('Bucle', 'LAMBDA(n,Bucle(n+1))');
    b.w.recalcAll();
    expect(b.get('Z99')).toBe(err('#CALC!'));
  });
  it('re-evaluates when the cells the body reads change', () => {
    const b = book({ A1: '2', Z99: '=Mas(1)' });
    b.w.defineName('Mas', 'LAMBDA(n,n+$A$1)');
    b.w.recalcAll();
    expect(b.get('Z99')).toBe(3);
    b.set('A1', '10');
    expect(b.get('Z99')).toBe(11);
  });
  it('is #VALUE! with the wrong number of arguments, #CALC! when a lambda reaches a cell', () => {
    expect(ev('LAMBDA(x,x)(1,2)')).toBe(err('#VALUE!'));
    expect(ev('LAMBDA(x,x)')).toBe(err('#CALC!'));
    expect(ev('SUM(LAMBDA(x,x))')).toBe(err('#CALC!'));
  });
  it('MAP maps one or several arrays', () => {
    const b = book({ A1: '1', A2: '2', A3: '3', B1: '10', B2: '20', B3: '30' });
    b.set('D1', '=MAP(A1:A3,LAMBDA(v,v*v))');
    b.set('E1', '=MAP(A1:A3,B1:B3,LAMBDA(x,y,x+y))');
    expect([b.get('D1'), b.get('D2'), b.get('D3')]).toEqual([1, 4, 9]);
    expect([b.get('E1'), b.get('E2'), b.get('E3')]).toEqual([11, 22, 33]);
  });
  it('REDUCE and SCAN accumulate', () => {
    const cells = { A1: '1', A2: '2', A3: '3', A4: '4' };
    expect(ev('REDUCE(0,A1:A4,LAMBDA(a,v,a+v))', cells)).toBe(10);
    expect(ev('REDUCE(1,A1:A4,LAMBDA(a,v,a*v))', cells)).toBe(24);
    expect(ev('REDUCE(A1:A4,LAMBDA(a,v,a+v))', cells)).toBe(10);
    const b = book({ ...cells, D1: '=SCAN(0,A1:A4,LAMBDA(a,v,a+v))' });
    expect([b.get('D1'), b.get('D2'), b.get('D3'), b.get('D4')]).toEqual([1, 3, 6, 10]);
  });
  it('BYROW, BYCOL and MAKEARRAY', () => {
    const b = book({ A1: '1', B1: '2', A2: '3', B2: '4' });
    b.set('D1', '=BYROW(A1:B2,LAMBDA(r,SUM(r)))');
    b.set('F1', '=BYCOL(A1:B2,LAMBDA(c,MAX(c)))');
    b.set('D5', '=MAKEARRAY(2,3,LAMBDA(r,c,r*10+c))');
    expect([b.get('D1'), b.get('D2')]).toEqual([3, 7]);
    expect([b.get('F1'), b.get('G1')]).toEqual([3, 4]);
    expect([b.get('D5'), b.get('E5'), b.get('F5'), b.get('D6'), b.get('E6'), b.get('F6')]).toEqual([11, 12, 13, 21, 22, 23]);
  });
  it('a lambda that returns an array inside MAP is #CALC!', () => {
    const b = book({ A1: '1', A2: '2', D1: '=MAP(A1:A2,LAMBDA(v,{1,2}))' });
    expect(b.get('D1')).toBe(err('#CALC!'));
  });
  it('round-trips the text of a formula with lambdas', () => {
    const f = 'MAP(A1:A3,LAMBDA(v,v*2))';
    expect(printFormula(parseFormula(f))).toBe(f);
    expect(printFormula(parseFormula('LAMBDA(x,x+1)(3)'))).toBe('LAMBDA(x,x+1)(3)');
  });
});

describe('unknown functions and cube functions', () => {
  it('keeps the text of a formula with an unknown function and gives #NAME?', () => {
    const b = book({ Z99: '=FUNCIONRARA(1,2)+1' });
    expect(b.get('Z99')).toBe(err('#NAME?'));
    expect(b.w.getInputText(b.id, 98, 25)).toBe('=FUNCIONRARA(1,2)+1');
  });
  it('cube functions find no connection', () => {
    expect(ev('CUBEVALUE("ThisWorkbookDataModel","[Measures].[x]")')).toBe(err('#NAME?'));
    expect(ev('CUBEMEMBER("c","[a]")')).toBe(err('#NAME?'));
    expect(ev('CUBESETCOUNT("x")')).toBe(err('#NAME?'));
  });
});

describe('database functions', () => {
  const cells = {
    A1: 'Árbol', B1: 'Altura', C1: 'Edad', D1: 'Rendimiento',
    A2: 'Manzano', B2: '18', C2: '20', D2: '14',
    A3: 'Peral', B3: '12', C3: '12', D3: '10',
    A4: 'Cerezo', B4: '13', C4: '14', D4: '9',
    A5: 'Manzano', B5: '14', C5: '15', D5: '10',
    A6: 'Peral', B6: '9', C6: '8', D6: '8',
    A7: 'Manzano', B7: '8', C7: '9', D7: '6',
    F1: 'Árbol', G1: 'Altura', H1: 'Altura',
    F2: 'Manzano', G2: '>10', H2: '<16',
    F3: 'Peral',
  };
  it('DSUM / DCOUNT / DAVERAGE with AND within a row and OR between rows', () => {
    // apple trees between 10 and 16 in height, or any pear
    expect(ev('DSUM(A1:D7,"Rendimiento",F1:H3)', cells)).toBe(10 + 10 + 8); // Manzano 14 (alt 14), Peral 12, Peral 9
    expect(ev('DCOUNT(A1:D7,"Edad",F1:H3)', cells)).toBe(3);
    expect(ev('DAVERAGE(A1:D7,3,F1:H3)', cells)).toBeCloseTo((15 + 12 + 8) / 3);
    expect(ev('DMAX(A1:D7,"Altura",F1:H3)', cells)).toBe(14);
    expect(ev('DMIN(A1:D7,"Altura",F1:H3)', cells)).toBe(9);
  });
  it('matches text by prefix, and "=" exactly', () => {
    const c = { ...cells, F1: 'Árbol', F2: 'Man', G1: '', G2: '', H1: '', H2: '', F3: '' };
    expect(ev('DCOUNTA(A1:D7,"Árbol",F1:F2)', c)).toBe(3);
    expect(ev('DCOUNTA(A1:D7,"Árbol",F1:F2)', { ...c, F2: '=Man' })).toBe(0);
  });
  it('DGET needs exactly one record', () => {
    expect(ev('DGET(A1:D7,"Edad",F1:F2)', { ...cells, F2: 'Cerezo', F3: '' })).toBe(14);
    expect(ev('DGET(A1:D7,"Edad",F1:F2)', { ...cells, F2: 'Manzano', F3: '' })).toBe(err('#NUM!'));
    expect(ev('DGET(A1:D7,"Edad",F1:F2)', { ...cells, F2: 'Olivo', F3: '' })).toBe(err('#VALUE!'));
  });
  it('statistics over the selection and an unknown field', () => {
    const c = { ...cells, F1: 'Árbol', F2: 'Manzano', F3: '', G1: '', H1: '', G2: '', H2: '' };
    close(ev('DSTDEV(A1:D7,"Rendimiento",F1:F2)', c), Math.sqrt(((14 - 10) ** 2 + 0 + (6 - 10) ** 2) / 2));
    close(ev('DVARP(A1:D7,"Rendimiento",F1:F2)', c), (16 + 0 + 16) / 3);
    expect(ev('DSUM(A1:D7,"Nada",F1:F2)', c)).toBe(err('#VALUE!'));
    expect(ev('DPRODUCT(A1:D7,"Edad",F1:F2)', c)).toBe(20 * 15 * 9);
  });
});

describe('engineering functions', () => {
  it('converts between number bases', () => {
    expect(ev('BIN2DEC("1100100")')).toBe(100);
    expect(ev('BIN2DEC("1111111111")')).toBe(-1);
    expect(ev('DEC2BIN(9,4)')).toBe('1001');
    expect(ev('DEC2BIN(-1)')).toBe('1111111111');
    expect(ev('DEC2HEX(255)')).toBe('FF');
    expect(ev('DEC2HEX(-1)')).toBe('FFFFFFFFFF');
    expect(ev('HEX2DEC("FF")')).toBe(255);
    expect(ev('HEX2DEC("FFFFFFFFFF")')).toBe(-1);
    expect(ev('DEC2OCT(58)')).toBe('72');
    expect(ev('HEX2BIN("F",8)')).toBe('00001111');
    expect(ev('OCT2DEC("7777777777")')).toBe(-1);
    expect(ev('BIN2HEX("11111011")')).toBe('FB');
    expect(ev('DEC2BIN(512)')).toBe(err('#NUM!'));
    expect(ev('BIN2DEC("102")')).toBe(err('#NUM!'));
  });
  it('does bit operations', () => {
    expect(ev('BITAND(1,5)')).toBe(1);
    expect(ev('BITOR(23,10)')).toBe(31);
    expect(ev('BITXOR(5,3)')).toBe(6);
    expect(ev('BITLSHIFT(4,2)')).toBe(16);
    expect(ev('BITRSHIFT(13,2)')).toBe(3);
    expect(ev('BITAND(-1,5)')).toBe(err('#NUM!'));
  });
  it('DELTA, GESTEP, ERF', () => {
    expect(ev('DELTA(5,4)')).toBe(0);
    expect(ev('DELTA(3,3)')).toBe(1);
    expect(ev('GESTEP(5,4)')).toBe(1);
    close(ev('ERF(1)'), 0.8427007929497149, 12);
    close(ev('ERFC(1)'), 0.15729920705028513, 12);
    close(ev('ERF(0.5,1)'), 0.8427007929497149 - 0.5204998778130465, 12);
  });
  it('Bessel functions agree with published values', () => {
    close(ev('BESSELJ(1.9,2)'), 0.329925728, 7);
    close(ev('BESSELI(1.5,1)'), 0.981666428, 7);
    close(ev('BESSELK(1.5,1)'), 0.2773878, 6);
    close(ev('BESSELY(2.5,1)'), 0.145918138, 6);
    close(ev('BESSELJ(0,0)'), 1, 12);
  });
  it('does complex arithmetic', () => {
    expect(ev('COMPLEX(3,4)')).toBe('3+4i');
    expect(ev('COMPLEX(0,1)')).toBe('i');
    expect(ev('COMPLEX(3,-4,"j")')).toBe('3-4j');
    expect(ev('IMABS("5+12i")')).toBe(13);
    expect(ev('IMREAL("6-9i")')).toBe(6);
    expect(ev('IMAGINARY("3+4i")')).toBe(4);
    expect(ev('IMSUM("3+4i","5-3i")')).toBe('8+i');
    expect(ev('IMSUB("13+4i","5+3i")')).toBe('8+i');
    expect(ev('IMPRODUCT("3+4i","5-3i")')).toBe('27+11i');
    expect(ev('IMDIV("-238+240i","10+24i")')).toBe('5+12i');
    expect(ev('IMCONJUGATE("3+4i")')).toBe('3-4i');
    expect(ev('IMPOWER("2+3i",3)')).toBe('-46+9i');
    expect(ev('IMSQRT("1+i")')).toBe('1.09868411346781+0.455089860562227i');
    close(ev('IMARGUMENT("3+4i")'), 0.9272952180016122, 12);
    expect(ev('IMABS("abc")')).toBe(err('#NUM!'));
  });
  it('converts units', () => {
    close(ev('CONVERT(1,"lbm","kg")'), 0.45359237, 9);
    close(ev('CONVERT(68,"F","C")'), 20, 9);
    close(ev('CONVERT(1,"mi","km")'), 1.609344, 9);
    close(ev('CONVERT(100,"C","K")'), 373.15, 9);
    close(ev('CONVERT(1,"hr","mn")'), 60, 9);
    close(ev('CONVERT(1,"gal","l")'), 3.785411784, 9);
    close(ev('CONVERT(1,"kbyte","bit")'), 8000, 9);
    close(ev('CONVERT(2,"in","cm")'), 5.08, 9);
    expect(ev('CONVERT(2.5,"ft","sec")')).toBe(err('#N/A'));
    expect(ev('CONVERT(2.5,"xx","m")')).toBe(err('#N/A'));
  });
});

describe('statistical distributions', () => {
  it('normal', () => {
    close(ev('NORM.S.DIST(1.96,TRUE)'), 0.9750021048517795, 12);
    close(ev('NORM.S.INV(0.975)'), 1.959963984540054, 12);
    close(ev('NORM.DIST(42,40,1.5,TRUE)'), 0.9087887802741321, 12);
    close(ev('NORM.DIST(42,40,1.5,FALSE)'), 0.10934004978399577, 12);
    close(ev('NORM.INV(0.908789,40,1.5)'), 42.00000200956628, 9);
    close(ev('NORMSDIST(0)'), 0.5, 12);
    close(ev('STANDARDIZE(42,40,1.5)'), 1.3333333333333333, 12);
    close(ev('GAUSS(2)'), 0.4772498680518208, 12);
    close(ev('PHI(0.75)'), Math.exp(-0.28125) / Math.sqrt(2 * Math.PI), 12);
    expect(ev('NORM.S.INV(1.2)')).toBe(err('#NUM!'));
    expect(ev('NORM.DIST(1,0,-1,TRUE)')).toBe(err('#NUM!'));
  });
  it('log-normal', () => {
    close(ev('LOGNORM.DIST(4,3.5,1.2,TRUE)'), 0.0390835557, 9);
    close(ev('LOGNORM.DIST(4,3.5,1.2,FALSE)'), 0.0176175, 6);
    close(ev('LOGNORM.INV(0.0390835557,3.5,1.2)'), 4, 8);
  });
  it('Student t', () => {
    close(ev('T.DIST(1.5,10,TRUE)'), 0.9177463, 6);
    close(ev('T.DIST.2T(1.96,60)'), 0.0546, 3);
    close(ev('T.INV.2T(0.05,10)'), 2.228138851986274, 10);
    close(ev('T.INV(0.95,10)'), 1.8124611228107335, 10);
    close(ev('T.INV(0.05,10)'), -1.8124611228107335, 10);
    close(ev('T.DIST.RT(2.228138852,10)'), 0.025, 8);
    close(ev('TDIST(1.959999998,60,2)'), 0.054645, 5);
    close(ev('T.DIST(1,5,FALSE)'), 0.2196797973, 8);
  });
  it('chi-square and F', () => {
    close(ev('CHISQ.INV.RT(0.05,10)'), 18.307038053275146, 9);
    close(ev('CHISQ.DIST.RT(18.307,10)'), 0.0500006, 5);
    close(ev('CHISQ.DIST(0.5,1,TRUE)'), 0.5204998778, 9);
    close(ev('CHISQ.DIST(2,3,FALSE)'), 0.2075537487, 8);
    close(ev('CHISQ.INV(0.93,1)'), 3.2830202, 6);
    close(ev('F.DIST.RT(15.2069,6,4)'), 0.01, 4);
    close(ev('F.INV.RT(0.01,6,4)'), 15.206865, 5);
    close(ev('F.DIST(15.2069,6,4,TRUE)'), 0.99, 4);
    close(ev('F.DIST(2,5,7,FALSE)'), 0.1618, 3);
    close(ev('F.INV(0.01,6,4)'), 0.10930991, 6);
  });
  it('discrete distributions', () => {
    expect(ev('BINOM.DIST(6,10,0.5,FALSE)')).toBeCloseTo(0.205078125, 12);
    expect(ev('BINOM.DIST(6,10,0.5,TRUE)')).toBeCloseTo(0.828125, 12);
    close(ev('BINOM.DIST.RANGE(60,0.75,48)'), 0.084, 2);
    close(ev('BINOM.DIST.RANGE(60,0.75,45,50)'), 0.52360, 4);
    expect(ev('BINOM.INV(6,0.5,0.75)')).toBe(4);
    close(ev('POISSON.DIST(2,5,TRUE)'), 0.12465201948308113, 12);
    close(ev('POISSON.DIST(2,5,FALSE)'), 0.08422433748856833, 12);
    close(ev('NEGBINOM.DIST(10,5,0.25,FALSE)'), 0.0550486604, 8);
    close(ev('NEGBINOM.DIST(10,5,0.25,TRUE)'), 0.3135141, 6);
    close(ev('HYPGEOM.DIST(1,4,8,20,FALSE)'), 0.3632610939, 8);
    close(ev('HYPGEOM.DIST(1,4,8,20,TRUE)'), 0.4654, 3);
    expect(ev('BINOM.DIST(11,10,0.5,TRUE)')).toBe(err('#NUM!'));
  });
  it('continuous distributions', () => {
    close(ev('EXPON.DIST(0.2,10,TRUE)'), 0.8646647167633873, 12);
    close(ev('EXPON.DIST(0.2,10,FALSE)'), 1.353352832366127, 12);
    close(ev('GAMMA.DIST(10.00001131,9,2,FALSE)'), 0.032639, 5);
    close(ev('GAMMA.DIST(10,9,2,TRUE)'), 0.068094, 5);
    close(ev('GAMMA.INV(0.068094,9,2)'), 10.00001119, 5);
    close(ev('GAMMA(5)'), 24, 12);
    close(ev('GAMMA(0.5)'), 1.7724538509055159, 12);
    close(ev('GAMMALN(4)'), 1.791759469228055, 12);
    close(ev('BETA.DIST(2,8,10,TRUE,1,3)'), 0.6854706, 6);
    close(ev('BETA.DIST(2,8,10,FALSE,1,3)'), 1.4837646, 6);
    close(ev('BETA.INV(0.6854705810546875,8,10,1,3)'), 2, 6);
    close(ev('WEIBULL.DIST(105,20,100,TRUE)'), 0.929581, 5);
    close(ev('WEIBULL.DIST(105,20,100,FALSE)'), 0.035589, 5);
    expect(ev('GAMMA(0)')).toBe(err('#NUM!'));
  });
  it('confidence intervals, Fisher and tests', () => {
    close(ev('CONFIDENCE.NORM(0.05,2.5,50)'), 0.692951912, 8);
    close(ev('CONFIDENCE.T(0.05,1,50)'), 0.284196855, 7);
    close(ev('FISHER(0.75)'), 0.972955074527657, 12);
    close(ev('FISHERINV(0.972955)'), 0.75, 6);
    close(ev('T.TEST({3,4,5,8,9,1,2,4,5},{6,19,3,2,14,4,5,17,1},2,1)'), 0.196016, 5);
    close(ev('T.TEST({3,4,5,8,9,1,2,4,5},{6,19,3,2,14,4,5,17,1},2,2)'), 0.2, 1);
    close(ev('F.TEST({6,7,9,15,21},{20,28,31,38,40})'), 0.648318, 5);
    close(ev('Z.TEST({3,6,7,8,6,5,4,2,1,9},4)'), 0.090574, 5);
    close(ev('CHISQ.TEST({58,35;11,25;10,23},{45.35,47.65;17.56,18.44;16.09,16.91})'), 0.0003082, 6);
  });
});

describe('other statistics and math', () => {
  const d = { A1: '4', A2: '5', A3: '8', A4: '7', A5: '11', A6: '4', A7: '3' };
  it('means and deviations', () => {
    close(ev('GEOMEAN(A1:A7)', d), 5.476987, 6);
    close(ev('HARMEAN(A1:A7)', d), 5.028376, 6);
    close(ev('DEVSQ(A1:A7)', d), 48, 9);
    close(ev('AVEDEV({4,5,6,7,5,4,3})'), 1.020408163, 8);
    close(ev('SKEW({3,4,5,2,3,4,5,6,4,7})'), 0.359543071, 7);
    close(ev('KURT({3,4,5,2,3,4,5,6,4,7})'), -0.151799637, 7);
    close(ev('TRIMMEAN({4,5,6,7,2,3,4,5,1,2,3},0.2)'), 3.7778, 3);
  });
  it('the A statistics count text and booleans in ranges', () => {
    const c = { A1: '2', A2: 'x', A3: 'TRUE', A4: '4' };
    expect(ev('AVERAGEA(A1:A4)', c)).toBe((2 + 0 + 1 + 4) / 4);
    expect(ev('MAXA(A1:A4)', c)).toBe(4);
    expect(ev('MINA(A1:A4)', c)).toBe(0);
  });
  it('pairs: covariance, r², standard error', () => {
    const xy = { A1: '1', A2: '2', A3: '3', A4: '4', A5: '5', B1: '2', B2: '4', B3: '5', B4: '4', B5: '5' };
    close(ev('COVARIANCE.P(A1:A5,B1:B5)', xy), 1.2, 9);
    close(ev('COVARIANCE.S(A1:A5,B1:B5)', xy), 1.5, 9);
    close(ev('RSQ(B1:B5,A1:A5)', xy), 0.6, 9);
    close(ev('PEARSON(A1:A5,B1:B5)', xy), Math.sqrt(0.6), 9);
    close(ev('STEYX(B1:B5,A1:A5)', xy), 0.894427191, 8);
  });
  it('LINEST gives the coefficients and statistics', () => {
    const xy = { A1: '1', A2: '2', A3: '3', A4: '4', A5: '5', B1: '2', B2: '4', B3: '5', B4: '4', B5: '5' };
    const b = book({ ...xy, D1: '=LINEST(B1:B5,A1:A5,TRUE,TRUE)' });
    const row = (r: number) => ['D', 'E'].map((c) => b.get(`${c}${r}`));
    close(row(1)[0]!, 0.6, 9);
    close(row(1)[1]!, 2.2, 9);
    close(row(2)[0]!, 0.282842712, 8);
    close(row(2)[1]!, 0.938083152, 8);
    close(row(3)[0]!, 0.6, 9);
    close(row(3)[1]!, 0.894427191, 8);
    close(row(4)[0]!, 4.5, 8);
    expect(row(4)[1]).toBe(3);
    close(row(5)[0]!, 3.6, 8);
    close(row(5)[1]!, 2.4, 8);
  });
  it('LINEST with two variables, TREND, LOGEST and GROWTH', () => {
    // y = 1 + 2·x1 + 3·x2
    const b = book({ A1: '1', B1: '1', C1: '6', A2: '2', B2: '1', C2: '8', A3: '1', B3: '2', C3: '9', A4: '3', B4: '5', C4: '22', D1: '=LINEST(C1:C4,A1:B4)', G1: '=TREND(C1:C4,A1:B4,A1:B2)', J1: '=GROWTH({2;4;8;16},{1;2;3;4},{5})' });
    close(b.get('D1'), 3, 9);
    close(b.get('E1'), 2, 9);
    close(b.get('F1'), 1, 9);
    close(b.get('G1'), 6, 9);
    close(b.get('G2'), 8, 9);
    close(b.get('J1'), 32, 7);
    close(ev('INDEX(LOGEST({2;4;8;16},{1;2;3;4}),1,1)'), 2, 9);
  });
  it('matrices', () => {
    const b = book({ A1: '1', B1: '2', A2: '3', B2: '4', D1: '=MMULT(A1:B2,A1:B2)', G1: '=MINVERSE(A1:B2)', J1: '=MDETERM(A1:B2)', K1: '=MUNIT(2)' });
    expect([b.get('D1'), b.get('E1'), b.get('D2'), b.get('E2')]).toEqual([7, 10, 15, 22]);
    close(b.get('G1'), -2, 9);
    close(b.get('H1'), 1, 9);
    close(b.get('G2'), 1.5, 9);
    close(b.get('H2'), -0.5, 9);
    close(b.get('J1'), -2, 9);
    expect([b.get('K1'), b.get('L1'), b.get('K2'), b.get('L2')]).toEqual([1, 0, 0, 1]);
    expect(ev('MINVERSE({1,2;2,4})')).toBe(err('#NUM!'));
  });
  it('percent rank, probabilities, frequencies, modes', () => {
    const a = '{13,12,11,8,4,3,2,1,1,1}';
    close(ev(`PERCENTRANK.INC(${a},2)`), 0.333, 3);
    close(ev(`PERCENTRANK.INC(${a},8)`), 0.666, 3);
    close(ev(`PERCENTRANK.INC(${a},5)`), 0.583, 3);
    close(ev(`PERCENTRANK.EXC(${a},8)`), 0.636, 3);
    expect(ev(`PERCENTRANK.INC(${a},100)`)).toBe(err('#N/A'));
    close(ev('PROB({0,1,2,3},{0.2,0.3,0.1,0.4},1,2)'), 0.4, 9);
    const b = book({ A1: '79', A2: '85', A3: '78', A4: '85', A5: '50', A6: '81', A7: '95', A8: '88', A9: '97', B1: '70', B2: '79', B3: '89', D1: '=FREQUENCY(A1:A9,B1:B3)', G1: '=MODE.MULT({1;2;2;3;3;4})' });
    expect([b.get('D1'), b.get('D2'), b.get('D3'), b.get('D4')]).toEqual([1, 2, 4, 2]);
    expect([b.get('G1'), b.get('G2')]).toEqual([2, 3]);
  });
  it('combinatorics and conversions', () => {
    expect(ev('COMBIN(8,2)')).toBe(28);
    expect(ev('COMBINA(4,3)')).toBe(20);
    expect(ev('PERMUT(100,3)')).toBe(970200);
    expect(ev('PERMUTATIONA(3,2)')).toBe(9);
    expect(ev('FACTDOUBLE(7)')).toBe(105);
    expect(ev('MULTINOMIAL(2,3,4)')).toBe(1260);
    expect(ev('ROMAN(499)')).toBe('CDXCIX');
    expect(ev('ARABIC("LVII")')).toBe(57);
    expect(ev('BASE(7,2)')).toBe('111');
    expect(ev('BASE(100,16,4)')).toBe('0064');
    expect(ev('DECIMAL("FF",16)')).toBe(255);
    close(ev('SQRTPI(1)'), 1.7724538509, 9);
    close(ev('ACOSH(1.5)'), 0.9624236501, 9);
    close(ev('COT(1)'), 0.6420926159, 9);
    expect(ev('SERIESSUM(2,0,1,{1,2,3})')).toBe(1 + 2 * 2 + 3 * 4);
  });
  it('FORMULATEXT, ISFORMULA, AREAS and HYPERLINK', () => {
    const b = book({ A1: '=1+2', A2: '5', B1: '=FORMULATEXT(A1)', B2: '=ISFORMULA(A1)', B3: '=ISFORMULA(A2)', B4: '=FORMULATEXT(A2)', B5: '=HYPERLINK("https://x.org","Ver")', B6: '=HYPERLINK("https://x.org")' });
    expect([b.get('B1'), b.get('B2'), b.get('B3'), b.get('B4'), b.get('B5'), b.get('B6')]).toEqual(['=1+2', true, false, E.NA, 'Ver', 'https://x.org']);
  });
});
