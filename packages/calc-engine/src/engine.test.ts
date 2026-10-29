import { describe, expect, it } from 'vitest';
import { parseA1 } from './addr';
import { printFormula, shiftRefs } from './formula';
import { FormulaSyntaxError, parseFormula } from './parser';
import { CalcError, E, type Scalar } from './values';
import { Workbook } from './workbook';

function book(cells: Record<string, string> = {}): { w: Workbook; id: number; get: (a: string) => Scalar; set: (a: string, t: string) => void } {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  const set = (a: string, t: string) => {
    const p = parseA1(a)!;
    w.setInput(id, p.row, p.col, t);
  };
  w.transact(() => {
    for (const [a, t] of Object.entries(cells)) set(a, t);
  });
  const get = (a: string) => {
    const p = parseA1(a)!;
    return w.getValue(id, p.row, p.col);
  };
  return { w, id, get, set };
}

/** Evaluate one formula in an otherwise empty (or pre-filled) sheet. */
function ev(formula: string, cells: Record<string, string> = {}): Scalar {
  const b = book({ ...cells, Z99: `=${formula}` });
  return b.get('Z99');
}

const err = (code: string) => CalcError.parse(code)!;

describe('parser and printer', () => {
  it('round-trips formulas', () => {
    for (const f of ['1+2*3', '(1+2)*3', '-A1^2', '-(A1^2)', 'SUM(A1:B2,3)', "'My Sheet'!A1+Sheet2!$B$3", 'IF(A1>0,"a""b",FALSE)', '{1,2;3,4}', 'A:A', '1:3', '50%', '2^3^2', 'A1&B1&"x"', 'SUM((A1+B1)*2)']) {
      expect(printFormula(parseFormula(f))).toBe(f);
    }
  });
  it('rejects bad syntax', () => {
    for (const f of ['1+', '(1', 'SUM(1,', '"abc', '1 2', '{1,2;3}']) expect(() => parseFormula(f)).toThrow(FormulaSyntaxError);
  });
  it('accepts a sheet-qualified #REF! as found in real files', () => {
    expect(printFormula(parseFormula("'CPs Escenarios'!#REF!"))).toBe('#REF!');
    expect(printFormula(parseFormula('SUM(Hoja1!#REF!,2)'))).toBe('SUM(#REF!,2)');
  });
  it('distinguishes functions that look like cells', () => {
    expect(parseFormula('LOG10(100)').t).toBe('call');
    expect(parseFormula('LOG10').t).toBe('ref');
  });
  it('shifts relative references only', () => {
    expect(printFormula(shiftRefs(parseFormula('A1+$B$2+C$3+$D4'), 2, 1))).toBe('B3+$B$2+D$3+$D6');
    expect(printFormula(shiftRefs(parseFormula('A1'), -1, 0))).toBe('#REF!');
  });
});

describe('operators', () => {
  it('respects precedence and associativity', () => {
    expect(ev('1+2*3')).toBe(7);
    expect(ev('-2^2')).toBe(4);
    expect(ev('2^3^2')).toBe(64);
    expect(ev('10-4-3')).toBe(3);
    expect(ev('50%*2')).toBe(1);
    expect(ev('2*-3')).toBe(-6);
  });
  it('coerces text and booleans in arithmetic', () => {
    expect(ev('"3"+4')).toBe(7);
    expect(ev('TRUE+1')).toBe(2);
    expect(ev('"a"+1')).toBe(err('#VALUE!'));
    expect(ev('A1+1')).toBe(1);
  });
  it('produces errors', () => {
    expect(ev('1/0')).toBe(err('#DIV/0!'));
    expect(ev('0^0')).toBe(err('#NUM!'));
    expect(ev('(-8)^(1/3)')).toBe(err('#NUM!'));
    expect(ev('1+#N/A')).toBe(E.NA);
    expect(ev('NOSUCHFN(1)')).toBe(err('#NAME?'));
  });
  it('compares with spreadsheet ordering', () => {
    expect(ev('1<2')).toBe(true);
    expect(ev('"a"="A"')).toBe(true);
    expect(ev('"b">"a"')).toBe(true);
    expect(ev('"a">5')).toBe(true); // text > numbers
    expect(ev('TRUE>"z"')).toBe(true); // booleans > text
    expect(ev('1<>1')).toBe(false);
  });
  it('concatenates', () => {
    expect(ev('"a"&1&TRUE')).toBe('a1TRUE');
  });
});

describe('math & stats', () => {
  const data = { A1: '1', A2: '2', A3: '3', A4: 'x', A5: '4' };
  it('aggregates ignoring text in ranges', () => {
    expect(ev('SUM(A1:A5)', data)).toBe(10);
    expect(ev('AVERAGE(A1:A5)', data)).toBe(2.5);
    expect(ev('MIN(A1:A5)', data)).toBe(1);
    expect(ev('MAX(A1:A5)', data)).toBe(4);
    expect(ev('COUNT(A1:A5)', data)).toBe(4);
    expect(ev('COUNTA(A1:A5)', data)).toBe(5);
    expect(ev('MEDIAN(A1:A5)', data)).toBe(2.5);
    expect(ev('PRODUCT(A1:A3)', data)).toBe(6);
  });
  it('treats direct text args strictly', () => {
    expect(ev('SUM("3",2)')).toBe(5);
    expect(ev('SUM("x",2)')).toBe(err('#VALUE!'));
    expect(ev('AVERAGE(A9:A10)')).toBe(err('#DIV/0!'));
  });
  it('propagates range errors', () => {
    expect(ev('SUM(A1:A2)', { A1: '=1/0', A2: '1' })).toBe(err('#DIV/0!'));
  });
  it('rounds half away from zero', () => {
    expect(ev('ROUND(2.5,0)')).toBe(3);
    expect(ev('ROUND(-2.5,0)')).toBe(-3);
    expect(ev('ROUND(1.005,2)')).toBe(1.01);
    expect(ev('ROUND(1234.5678,-2)')).toBe(1200);
    expect(ev('ROUNDUP(1.21,1)')).toBe(1.3);
    expect(ev('ROUNDDOWN(-1.29,1)')).toBe(-1.2);
    expect(ev('TRUNC(-8.9)')).toBe(-8);
    expect(ev('INT(-1.5)')).toBe(-2);
  });
  it('implements MOD with the divisor sign', () => {
    expect(ev('MOD(-3,2)')).toBe(1);
    expect(ev('MOD(3,-2)')).toBe(-1);
    expect(ev('MOD(1,0)')).toBe(err('#DIV/0!'));
  });
  it('does conditional aggregation', () => {
    const t = { A1: 'apple', A2: 'banana', A3: 'apricot', B1: '10', B2: '20', B3: '30' };
    expect(ev('SUMIF(A1:A3,"ap*",B1:B3)', t)).toBe(40);
    expect(ev('COUNTIF(B1:B3,">15")', t)).toBe(2);
    expect(ev('COUNTIF(A1:A3,"<>banana")', t)).toBe(2);
    expect(ev('AVERAGEIF(B1:B3,"<=20")', t)).toBe(15);
    expect(ev('SUMIFS(B1:B3,A1:A3,"a*",B1:B3,">10")', t)).toBe(30);
    expect(ev('COUNTIFS(A1:A3,"a*",B1:B3,"<30")', t)).toBe(1);
    expect(ev('MAXIFS(B1:B3,A1:A3,"a*")', t)).toBe(30);
    expect(ev('SUMIF(A1:A3,"apple",B1)', t)).toBe(10);
  });
  it('computes SUMPRODUCT, LARGE, RANK, statistics', () => {
    const d = { A1: '1', A2: '2', A3: '3', B1: '4', B2: '5', B3: '6' };
    expect(ev('SUMPRODUCT(A1:A3,B1:B3)', d)).toBe(32);
    expect(ev('LARGE(B1:B3,2)', d)).toBe(5);
    expect(ev('SMALL(B1:B3,1)', d)).toBe(4);
    expect(ev('RANK(5,B1:B3)', d)).toBe(2);
    expect(ev('STDEV.S(A1:A3)', d)).toBeCloseTo(1, 10);
    expect(ev('VAR.P(A1:A3)', d)).toBeCloseTo(2 / 3, 10);
    expect(ev('CORREL(A1:A3,B1:B3)', d)).toBeCloseTo(1, 10);
    expect(ev('SLOPE(B1:B3,A1:A3)', d)).toBeCloseTo(1, 10);
    expect(ev('INTERCEPT(B1:B3,A1:A3)', d)).toBeCloseTo(3, 10);
    expect(ev('PERCENTILE(A1:A3,0.5)', d)).toBe(2);
    expect(ev('QUARTILE(A1:A3,1)', d)).toBe(1.5);
  });
});

describe('logical & information', () => {
  it('short-circuits IF / IFERROR', () => {
    expect(ev('IF(TRUE,1,1/0)')).toBe(1);
    expect(ev('IF(FALSE,1)')).toBe(false);
    expect(ev('IFERROR(1/0,"x")')).toBe('x');
    expect(ev('IFERROR(5,"x")')).toBe(5);
    expect(ev('IFNA(NA(),7)')).toBe(7);
    expect(ev('IFNA(1/0,7)')).toBe(err('#DIV/0!'));
  });
  it('supports IFS, SWITCH, CHOOSE', () => {
    expect(ev('IFS(1>2,"a",2>1,"b")')).toBe('b');
    expect(ev('IFS(FALSE,1)')).toBe(E.NA);
    expect(ev('SWITCH(2,1,"one",2,"two","other")')).toBe('two');
    expect(ev('SWITCH(9,1,"one","other")')).toBe('other');
    expect(ev('CHOOSE(2,"a","b","c")')).toBe('b');
  });
  it('handles AND/OR/NOT/XOR', () => {
    expect(ev('AND(TRUE,1,"TRUE")')).toBe(true);
    expect(ev('OR(FALSE,0)')).toBe(false);
    expect(ev('NOT(0)')).toBe(true);
    expect(ev('XOR(TRUE,TRUE,TRUE)')).toBe(true);
  });
  it('reports types', () => {
    expect(ev('ISNUMBER(A1)', { A1: '3' })).toBe(true);
    expect(ev('ISTEXT(A1)', { A1: 'x' })).toBe(true);
    expect(ev('ISBLANK(A1)')).toBe(true);
    expect(ev('ISERROR(1/0)')).toBe(true);
    expect(ev('ISNA(NA())')).toBe(true);
    expect(ev('ISEVEN(4)')).toBe(true);
  });
  it('binds names with LET', () => {
    expect(ev('LET(x,2,y,x*3,x+y)')).toBe(8);
    expect(ev('LET(x,5,LET(x,1,x)+x)')).toBe(6);
  });
});

describe('text', () => {
  it('slices and cases', () => {
    expect(ev('LEFT("hello",2)')).toBe('he');
    expect(ev('RIGHT("hello",3)')).toBe('llo');
    expect(ev('MID("hello",2,3)')).toBe('ell');
    expect(ev('UPPER("aé")')).toBe('AÉ');
    expect(ev('PROPER("hello wORLD")')).toBe('Hello World');
    expect(ev('TRIM("  a   b ")')).toBe('a b');
    expect(ev('LEN(12345)')).toBe(5);
    expect(ev('REPT("ab",3)')).toBe('ababab');
  });
  it('searches and replaces', () => {
    expect(ev('FIND("l","hello")')).toBe(3);
    expect(ev('FIND("L","hello")')).toBe(err('#VALUE!'));
    expect(ev('SEARCH("L*o","hello")')).toBe(3);
    expect(ev('SUBSTITUTE("a-b-c","-","+")')).toBe('a+b+c');
    expect(ev('SUBSTITUTE("a-b-c","-","+",2)')).toBe('a-b+c');
    expect(ev('REPLACE("abcdef",2,3,"X")')).toBe('aXef');
  });
  it('joins', () => {
    expect(ev('CONCAT("a",A1:A2)', { A1: 'x', A2: '1' })).toBe('ax1');
    expect(ev('TEXTJOIN(",",TRUE,A1:A3)', { A1: 'x', A3: 'z' })).toBe('x,z');
    expect(ev('CONCATENATE("a","b",1)')).toBe('ab1');
  });
  it('converts', () => {
    expect(ev('VALUE("12.5")')).toBe(12.5);
    expect(ev('VALUE("abc")')).toBe(err('#VALUE!'));
    expect(ev('CHAR(65)')).toBe('A');
    expect(ev('CODE("A")')).toBe(65);
    expect(ev('TEXTBEFORE("a-b-c","-")')).toBe('a');
    expect(ev('TEXTAFTER("a-b-c","-",2)')).toBe('c');
    expect(ev('TEXT(1234.5,"#,##0.00")')).toBe('1,234.50');
    expect(ev('TEXT(0.256,"0.0%")')).toBe('25.6%');
  });
});

describe('lookup', () => {
  const t = { A1: 'a', A2: 'b', A3: 'c', B1: '10', B2: '20', B3: '30' };
  it('does exact and approximate VLOOKUP/MATCH/INDEX', () => {
    expect(ev('VLOOKUP("b",A1:B3,2,FALSE)', t)).toBe(20);
    expect(ev('VLOOKUP("z",A1:B3,2,FALSE)', t)).toBe(E.NA);
    expect(ev('VLOOKUP(25,B1:B3,1)', t)).toBe(20);
    expect(ev('VLOOKUP(5,B1:B3,1)', t)).toBe(E.NA);
    expect(ev('MATCH("c",A1:A3,0)', t)).toBe(3);
    expect(ev('MATCH(25,B1:B3,1)', t)).toBe(2);
    expect(ev('MATCH("b*",A1:A3,0)', t)).toBe(2);
    expect(ev('INDEX(A1:B3,2,2)', t)).toBe(20);
    expect(ev('INDEX(A1:A3,3)', t)).toBe('c');
    expect(ev('INDEX(A1:B3,4,1)', t)).toBe(E.REF);
    expect(ev('SUM(INDEX(B1:B3,2):INDEX(B1:B3,3))', t)).toBe(50);
    expect(ev('HLOOKUP("b",A1:B2,2,FALSE)', { A1: 'a', B1: 'b', A2: '1', B2: '2' })).toBe(2);
  });
  it('supports XLOOKUP / XMATCH', () => {
    expect(ev('XLOOKUP("b",A1:A3,B1:B3)', t)).toBe(20);
    expect(ev('XLOOKUP("z",A1:A3,B1:B3,"none")', t)).toBe('none');
    expect(ev('XLOOKUP(25,B1:B3,A1:A3,,-1)', t)).toBe('b');
    expect(ev('XLOOKUP(25,B1:B3,A1:A3,,1)', t)).toBe('c');
    expect(ev('XMATCH("c",A1:A3)', t)).toBe(3);
    expect(ev('LOOKUP(25,B1:B3,A1:A3)', t)).toBe('b');
  });
  it('gives positions', () => {
    expect(ev('ROWS(A1:B3)')).toBe(3);
    expect(ev('COLUMNS(A1:B3)')).toBe(2);
    expect(ev('ADDRESS(2,3)')).toBe('$C$2');
    expect(ev('ADDRESS(2,3,4)')).toBe('C2');
    expect(ev('SUM(OFFSET(B1,1,0,2,1))', t)).toBe(50);
    expect(ev('INDIRECT("B2")', t)).toBe(20);
  });
});

describe('date & time', () => {
  it('converts dates and serials', () => {
    expect(ev('DATE(2024,1,31)')).toBe(45322);
    expect(ev('DATE(1900,1,1)')).toBe(1);
    expect(ev('DATE(1900,3,1)')).toBe(61);
    expect(ev('YEAR(45322)')).toBe(2024);
    expect(ev('MONTH(45322)')).toBe(1);
    expect(ev('DAY(45322)')).toBe(31);
    expect(ev('DATE(2024,14,1)')).toBe(ev('DATE(2025,2,1)'));
  });
  it('does month arithmetic', () => {
    expect(ev('EDATE(DATE(2024,1,31),1)')).toBe(ev('DATE(2024,2,29)'));
    expect(ev('EOMONTH(DATE(2024,1,15),0)')).toBe(ev('DATE(2024,1,31)'));
    expect(ev('DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"Y")')).toBe(4);
    expect(ev('DATEDIF(DATE(2020,1,15),DATE(2024,3,10),"M")')).toBe(49);
    expect(ev('DAYS(DATE(2024,3,1),DATE(2024,2,1))')).toBe(29);
  });
  it('knows weekdays', () => {
    expect(ev('WEEKDAY(DATE(2024,1,31))')).toBe(4); // Wednesday
    expect(ev('WEEKDAY(DATE(2024,1,31),2)')).toBe(3);
    expect(ev('NETWORKDAYS(DATE(2024,1,29),DATE(2024,2,2))')).toBe(5);
    expect(ev('WORKDAY(DATE(2024,1,26),1)')).toBe(ev('DATE(2024,1,29)'));
    expect(ev('ISOWEEKNUM(DATE(2024,1,1))')).toBe(1);
  });
  it('handles time', () => {
    expect(ev('TIME(12,0,0)')).toBe(0.5);
    expect(ev('HOUR(0.75)')).toBe(18);
    expect(ev('MINUTE(TIME(1,30,0))')).toBe(30);
  });
  it('uses the injected clock for TODAY/NOW', () => {
    const b = new Workbook();
    b.setClock(() => new Date(2024, 0, 31, 12, 0, 0), () => 0.5);
    const id = b.sheets[0]!.id;
    b.setInput(id, 0, 0, '=TODAY()');
    b.setInput(id, 0, 1, '=NOW()');
    b.setInput(id, 0, 2, '=RAND()');
    expect(b.getValue(id, 0, 0)).toBe(45322);
    expect(b.getValue(id, 0, 1)).toBeCloseTo(45322.5, 6);
    expect(b.getValue(id, 0, 2)).toBe(0.5);
  });
});

describe('financial', () => {
  it('matches Excel reference values', () => {
    expect(ev('PMT(0.05/12,360,200000)')).toBeCloseTo(-1073.6432, 3);
    expect(ev('FV(0.06/12,120,-100)')).toBeCloseTo(16387.9345, 3);
    expect(ev('PV(0.08/12,240,-1000)')).toBeCloseTo(119554.3, 0);
    expect(ev('NPER(0.01,-100,1000)')).toBeCloseTo(10.5886, 3);
    expect(ev('NPV(0.1,-1000,500,600,700)')).toBeCloseTo(433.03, 1);
    expect(ev('IRR(A1:A4)', { A1: '-1000', A2: '300', A3: '400', A4: '500' })).toBeCloseTo(0.0889, 3);
    expect(ev('RATE(60,-1000,50000)')).toBeCloseTo(0.0062, 3);
    expect(ev('IPMT(0.05/12,1,360,200000)')).toBeCloseTo(-833.3333, 3);
    expect(ev('PPMT(0.05/12,1,360,200000)')).toBeCloseTo(-240.3099, 3);
  });
});

describe('dynamic arrays', () => {
  it('broadcasts operators and spills', () => {
    const b = book({ A1: '1', A2: '2', A3: '3', C1: '=A1:A3*2' });
    expect(b.get('C1')).toBe(2);
    expect(b.get('C2')).toBe(4);
    expect(b.get('C3')).toBe(6);
    b.set('A2', '10');
    expect(b.get('C2')).toBe(20);
  });
  it('shrinks and grows spill ranges', () => {
    const b = book({ A1: '=SEQUENCE(3)' });
    expect(b.get('A3')).toBe(3);
    b.set('A1', '=SEQUENCE(2)');
    expect(b.get('A3')).toBe(null);
    b.set('A1', '=SEQUENCE(4)');
    expect(b.get('A4')).toBe(4);
  });
  it('reports #SPILL! when blocked, and recovers when freed', () => {
    const b = book({ A1: '=SEQUENCE(3)', A2: 'x' });
    expect(b.get('A1')).toBe(E.SPILL);
    b.set('A2', '');
    expect(b.get('A1')).toBe(1);
    expect(b.get('A3')).toBe(3);
  });
  it('lets formulas depend on spilled cells', () => {
    const b = book({ A1: '=SEQUENCE(3)', B1: '=SUM(A1:A3)' });
    expect(b.get('B1')).toBe(6);
    b.set('A1', '=SEQUENCE(3,1,10)');
    expect(b.get('B1')).toBe(33);
  });
  it('sorts, filters, uniques, transposes', () => {
    const d = { A1: '3', A2: '1', A3: '2', A4: '1' };
    const b = book({ ...d, C1: '=SORT(A1:A4)', E1: '=UNIQUE(A1:A4)', G1: '=FILTER(A1:A4,A1:A4>1)', I1: '=TRANSPOSE(A1:A3)' });
    expect([b.get('C1'), b.get('C2'), b.get('C3'), b.get('C4')]).toEqual([1, 1, 2, 3]);
    expect([b.get('E1'), b.get('E2'), b.get('E3')]).toEqual([3, 1, 2]);
    expect([b.get('G1'), b.get('G2')]).toEqual([3, 2]);
    expect([b.get('I1'), b.get('J1'), b.get('K1')]).toEqual([3, 1, 2]);
  });
  it('sorts descending and by key columns', () => {
    const b = book({ A1: 'b', B1: '2', A2: 'a', B2: '3', A3: 'c', B3: '1', D1: '=SORT(A1:B3,2,-1)', G1: '=SORTBY(A1:A3,B1:B3)' });
    expect(b.get('D1')).toBe('a');
    expect(b.get('D3')).toBe('c');
    expect(b.get('G1')).toBe('c');
  });
});

describe('workbook recalculation', () => {
  it('updates dependents', () => {
    const b = book({ A1: '1', A2: '=A1+1', A3: '=A2*2', B1: '=SUM(A1:A3)' });
    expect(b.get('B1')).toBe(1 + 2 + 4);
    b.set('A1', '10');
    expect(b.get('A3')).toBe(22);
    expect(b.get('B1')).toBe(10 + 11 + 22);
  });
  it('detects circular references', () => {
    const b = book({ A1: '=B1', B1: '=A1', C1: '=A1+1' });
    expect(b.get('A1')).toBe(E.CIRC);
    expect(b.get('B1')).toBe(E.CIRC);
    expect(b.get('C1')).toBe(E.CIRC);
    b.set('B1', '5');
    expect(b.get('A1')).toBe(5);
    expect(b.get('C1')).toBe(6);
  });
  it('handles long dependency chains without recursion', () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.transact(() => {
      w.setInput(id, 0, 0, '1');
      for (let r = 1; r < 20000; r++) w.setInput(id, r, 0, `=A${r}+1`);
    });
    expect(w.getValue(id, 19999, 0)).toBe(20000);
    w.setInput(id, 0, 0, '5');
    expect(w.getValue(id, 19999, 0)).toBe(20004);
  });
  it('resolves cross-sheet references and survives renames', () => {
    const b = book();
    const s2 = b.w.addSheet('Data');
    b.w.setInput(s2.id, 0, 0, '42');
    b.set('A1', '=Data!A1+1');
    expect(b.get('A1')).toBe(43);
    b.w.renameSheet(s2.id, 'My Data');
    expect(b.w.getInputText(b.id, 0, 0)).toBe("='My Data'!A1+1");
    b.w.setInput(s2.id, 0, 0, '1');
    expect(b.get('A1')).toBe(2);
    b.w.removeSheet(s2.id);
    expect(b.get('A1')).toBe(E.REF);
  });
  it('uses defined names', () => {
    const b = book({ A1: '5', B1: '=Rate*2' });
    expect(b.get('B1')).toBe(E.NAME);
    b.w.defineName('Rate', '=Sheet1!$A$1');
    b.w.renameSheet(b.id, 'Sheet1');
    b.w.defineName('Rate', '=Sheet1!$A$1');
    expect(b.get('B1')).toBe(10);
    b.set('A1', '7');
    expect(b.get('B1')).toBe(14);
  });
  it('keeps volatile formulas fresh', () => {
    const b = book();
    let r = 0.1;
    b.w.setClock(() => new Date(), () => r);
    b.set('A1', '=RAND()');
    b.set('B1', '=A1*10');
    expect(b.get('B1')).toBeCloseTo(1);
    r = 0.5;
    b.set('C1', '1');
    expect(b.get('A1')).toBe(0.5);
    expect(b.get('B1')).toBeCloseTo(5);
  });
  it('rejects bad formulas without touching the cell', () => {
    const b = book({ A1: 'keep' });
    expect(() => b.set('A1', '=1+')).toThrow(FormulaSyntaxError);
    expect(b.get('A1')).toBe('keep');
  });
});

describe('input parsing', () => {
  it('types values like a spreadsheet', () => {
    const b = book({ A1: '12', A2: '1.5e2', A3: 'TRUE', A4: '12%', A5: '2024-01-31', A6: "'123", A7: 'hello', A8: '#N/A', A9: '31/1/2024', A10: '12:30' });
    expect(b.get('A1')).toBe(12);
    expect(b.get('A2')).toBe(150);
    expect(b.get('A3')).toBe(true);
    expect(b.get('A4')).toBe(0.12);
    expect(b.get('A5')).toBe(45322);
    expect(b.get('A6')).toBe('123');
    expect(b.get('A7')).toBe('hello');
    expect(b.get('A8')).toBe(E.NA);
    expect(b.get('A9')).toBe(45322);
    expect(b.get('A10')).toBeCloseTo(0.52083, 4);
    expect(b.w.getStyle(b.id, 3, 0).numFmt).toBe('0%');
    expect(b.w.getStyle(b.id, 4, 0).numFmt).toBe('yyyy-mm-dd');
    expect(b.w.getInputText(b.id, 5, 0)).toBe("'123");
  });
});

describe('undo / redo and structure', () => {
  it('reverts edits through patches', () => {
    const b = book({ A1: '1', B1: '=A1*2' });
    const patch = b.w.setInput(b.id, 0, 0, '5');
    expect(b.get('B1')).toBe(10);
    b.w.applyPatch(patch, true);
    expect(b.get('A1')).toBe(1);
    expect(b.get('B1')).toBe(2);
    b.w.applyPatch(patch, false);
    expect(b.get('B1')).toBe(10);
  });
  it('inserts and deletes rows, rewriting references', () => {
    const b = book({ A1: '1', A2: '2', A3: '3', B1: '=SUM(A1:A3)', B2: '=A3' });
    const sid = b.id;
    const ins = b.w.shiftStructure(sid, 'row', 1, 1); // insert before row 2
    expect(b.w.getInputText(sid, 0, 1)).toBe('=SUM(A1:A4)');
    expect(b.w.getInputText(sid, 2, 1)).toBe('=A4');
    expect(b.get('B1')).toBe(6);
    const del = b.w.shiftStructure(sid, 'row', 3, -1); // delete the old A3
    expect(b.get('B1')).toBe(3);
    expect(b.w.getInputText(sid, 2, 1)).toBe('=#REF!');
    b.w.applyPatch(del, true);
    expect(b.get('B1')).toBe(6);
    b.w.applyPatch(ins, true);
    expect(b.w.getInputText(sid, 0, 1)).toBe('=SUM(A1:A3)');
  });
  it('inserts columns', () => {
    const b = book({ A1: '1', B1: '2', C1: '=A1+B1' });
    b.w.shiftStructure(b.id, 'col', 1, 2);
    expect(b.w.getInputText(b.id, 0, 4)).toBe('=A1+D1');
    expect(b.get('E1')).toBe(3);
  });
  it('clears and formats ranges', () => {
    const b = book({ A1: '1', A2: '2' });
    b.w.formatRange(b.id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { bold: true });
    expect(b.w.getStyle(b.id, 1, 1).bold).toBe(true);
    b.w.clear(b.id, { r1: 0, c1: 0, r2: 1, c2: 0 });
    expect(b.get('A1')).toBe(null);
    expect(b.w.getStyle(b.id, 0, 0).bold).toBe(true);
    b.w.clear(b.id, { r1: 0, c1: 0, r2: 1, c2: 1 }, 'all');
    expect(b.w.getCell(b.id, 0, 0)).toBeUndefined();
  });
});
