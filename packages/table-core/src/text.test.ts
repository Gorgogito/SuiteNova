import { describe, expect, it } from 'vitest';
import { compareCells, detectSeparator, formatNumber, gridFromRows, isNumericColumn, parseDate, parseNumber, rowsToHtml, rowsToText, sortRows, splitLine, textToRows, type Grid } from './index';

describe('numbers in text', () => {
  it('reads them with a comma or a point, with marks, signs, parentheses, text around and percent', () => {
    expect(parseNumber('1234')).toBe(1234);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('3,5')).toBe(3.5);
    expect(parseNumber('3.5')).toBe(3.5);
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber('1,234,567')).toBe(1234567);
    expect(parseNumber('-12,5')).toBe(-12.5);
    expect(parseNumber('(12)')).toBe(-12);
    expect(parseNumber('$ 1 200')).toBe(1200);
    expect(parseNumber('S/ 45,90')).toBe(45.9);
    expect(parseNumber('12 kg')).toBe(12);
    expect(parseNumber('50 %')).toBe(0.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('12abc34')).toBeNull();
  });
  it('the decimal mark can be given', () => {
    expect(parseNumber('1,234', ',')).toBe(1.234);
    expect(parseNumber('1,234', '.')).toBe(1234);
    expect(parseNumber('1.234', ',')).toBe(1234);
  });
  it('writes them with a picture', () => {
    expect(formatNumber(1234.5, '#,##0.00')).toBe('1,234.50');
    expect(formatNumber(1234.5, '#,##0.00', ',', '.')).toBe('1.234,50');
    expect(formatNumber(0.256, '0%')).toBe('26%');
    expect(formatNumber(5, '0.00')).toBe('5.00');
    expect(formatNumber(1234, '$#,##0')).toBe('$1,234');
    expect(formatNumber(-5, '0.0')).toBe('-5.0');
    expect(formatNumber(3.14159, '0.##')).toBe('3.14');
    expect(formatNumber(3, '0.##')).toBe('3');
    expect(formatNumber(7, '000')).toBe('007');
    expect(formatNumber(1234.567, '0')).toBe('1235');
    expect(formatNumber(-5, '0;(0)')).toBe('(5)');
    expect(formatNumber(12, '"Total: "0')).toBe('Total: 12');
    expect(formatNumber(0, '0.00')).toBe('0.00');
  });
});

describe('text and table', () => {
  it('splits a line with quotes', () => {
    expect(splitLine('a,b,c', 'comma')).toEqual(['a', 'b', 'c']);
    expect(splitLine('"a,b",c', 'comma')).toEqual(['a,b', 'c']);
    expect(splitLine('"di ""hola""",x', 'comma')).toEqual(['di "hola"', 'x']);
    expect(splitLine('a;b;', 'semicolon')).toEqual(['a', 'b', '']);
    expect(splitLine('a\tb', 'tab')).toEqual(['a', 'b']);
    expect(splitLine('a,b', 'paragraph')).toEqual(['a,b']);
  });
  it('finds the separator', () => {
    expect(detectSeparator('a\tb\nc\td')).toBe('tab');
    expect(detectSeparator('a;b\nc;d')).toBe('semicolon');
    expect(detectSeparator('a,b\nc,d')).toBe('comma');
    expect(detectSeparator('hola\nadiós')).toBe('paragraph');
    expect(detectSeparator('a,b\nsolo una')).toBe('paragraph');
  });
  it('makes a rectangular table of rows, dropping empty lines at the end', () => {
    expect(textToRows('a,b,c\nd,e\n\n', 'comma')).toEqual([['a', 'b', 'c'], ['d', 'e', '']]);
    expect(textToRows('uno\ndos', 'paragraph')).toEqual([['uno'], ['dos']]);
    expect(textToRows('x;y\nz;w')).toEqual([['x', 'y'], ['z', 'w']]);
  });
  it('writes a table as text and as HTML, quoting and escaping', () => {
    const rows = [['a', 'b,c'], ['d"e', '<f>']];
    expect(rowsToText(rows, 'tab')).toBe('a\tb,c\nd"e\t<f>');
    expect(rowsToText(rows, 'comma')).toBe('a,"b,c"\n"d""e",<f>');
    expect(textToRows(rowsToText(rows, 'comma'), 'comma')).toEqual(rows);
    const html = rowsToHtml(rows, { header: true });
    expect(html).toContain('<th');
    expect(html).toContain('&lt;f&gt;');
    expect(html).not.toContain('<f>');
  });
  it('knows a column of numbers', () => {
    expect(isNumericColumn(['1', '2,5', '', '3'])).toBe(true);
    expect(isNumericColumn(['a', 'b', '1'])).toBe(false);
    expect(isNumericColumn([])).toBe(false);
  });
});

describe('sorting', () => {
  const rows = (g: Grid<string>, col = 0) => g.rows.map((r) => r.cells[col]!.content);
  const make = (data: string[][]) => gridFromRows(data, (t) => t);
  const text = (c: string) => c;
  it('orders numbers as numbers, ascending and descending, with the header on top and empties last', () => {
    const g = make([['n'], ['10'], ['9'], [''], ['100'], ['abc']]);
    expect(rows(sortRows(g, 0, true, 'number', text, true)!)).toEqual(['n', '9', '10', '100', 'abc', '']);
    expect(rows(sortRows(g, 0, false, 'number', text, true)!)).toEqual(['n', '100', '10', '9', 'abc', '']);
    expect(rows(sortRows(g, 0, true, 'text', text, true)!)).toEqual(['n', '9', '10', '100', 'abc', '']);
  });
  it('orders text by the collation of the language (accents and case do not split)', () => {
    const g = make([['b'], ['Álvaro'], ['a'], ['Beta'], ['álamo']]);
    expect(rows(sortRows(g, 0, true, 'text', text)!)).toEqual(['a', 'álamo', 'Álvaro', 'b', 'Beta']);
  });
  it('orders dates', () => {
    const g = make([['12/03/2026'], ['01/12/2025'], ['2026-01-05'], ['nada']]);
    expect(rows(sortRows(g, 0, true, 'date', text)!)).toEqual(['01/12/2025', '2026-01-05', '12/03/2026', 'nada']);
    expect(parseDate('31/02/2026')).not.toBeNull();
    expect(parseDate('32/01/2026')).toBeNull();
    expect(parseDate('5/3/26')).toBe(Date.UTC(2026, 2, 5));
  });
  it('is stable, keeps whole rows together and refuses what would break a merged cell', () => {
    const g = make([['b', 'x'], ['a', 'y'], ['b', 'z']]);
    const s = sortRows(g, 0, true, 'text', text)!;
    expect(s.rows.map((r) => r.cells.map((c) => c.content).join())).toEqual(['a,y', 'b,x', 'b,z']);
    const m = make([['a', 'x'], ['b', 'y']]);
    m.rows[0]!.cells[1]!.rs = 2;
    m.rows[1]!.cells[1]!.cover = true;
    m.rows[1]!.cells[1]!.vm = true;
    expect(sortRows(m, 0, true, 'text', text)).toBeNull();
    expect(sortRows(g, 5, true, 'text', text)).toBeNull();
  });
  it('compares empties last whatever the mode', () => {
    expect(compareCells('', 'a', 'text')).toBe(1);
    expect(compareCells('a', '', 'number')).toBe(-1);
    expect(compareCells('', '', 'date')).toBe(0);
  });
});
