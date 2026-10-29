import { describe, expect, it } from 'vitest';
import { serialFromYMD } from './dates';
import { formatValue, generalText, isDateFormat } from './format';
import { E } from './values';

const f = (v: number | string | boolean | null, code?: string, loc: 'en' | 'es' = 'en') => formatValue(v, code, loc).text;

describe('General', () => {
  it('prints numbers compactly', () => {
    expect(generalText(1)).toBe('1');
    expect(generalText(0.1 + 0.2)).toBe('0.3');
    expect(generalText(1 / 3)).toBe('0.333333333');
    expect(generalText(123456789012)).toBe('1.23457E+11');
    expect(generalText(0.000001234)).toBe('0.000001234');
    expect(generalText(1e-10)).toBe('1E-10');
    expect(generalText(-12.5)).toBe('-12.5');
    expect(f(1.5, undefined, 'es')).toBe('1,5');
  });
  it('prints non-numbers', () => {
    expect(f('abc')).toBe('abc');
    expect(f(true)).toBe('TRUE');
    expect(f(null)).toBe('');
    expect(formatValue(E.DIV0, '0.00').text).toBe('#DIV/0!');
  });
});

describe('numeric formats', () => {
  it.each([
    [1234.567, '0', '1235'],
    [1234.567, '0.00', '1234.57'],
    [0.5, '0.00', '0.50'],
    [0.5, '#.##', '.5'],
    [2, '#.##', '2.'],
    [1234.5, '#,##0.00', '1,234.50'],
    [1234567.891, '#,##0', '1,234,568'],
    [5, '000', '005'],
    [5, '0.0#', '5.0'],
    [5.25, '0.0#', '5.25'],
    [0.256, '0%', '26%'],
    [0.256, '0.0%', '25.6%'],
    [-1234.5, '#,##0.00', '-1,234.50'],
    [1234.5, '$#,##0.00', '$1,234.50'],
    [12, '"Qty: "0', 'Qty: 12'],
    [12, '0" units"', '12 units'],
    [1500000, '0.0,,"M"', '1.5M'],
    [12345, '0.00E+00', '1.23E+04'],
    [0.00012, '0.00E+00', '1.20E-04'],
    [1234.5, '#,##0.0;(#,##0.0)', '1,234.5'],
    [-1234.5, '#,##0.0;(#,##0.0)', '(1,234.5)'],
    [0, '0;-0;"zero"', 'zero'],
    [7, '00-00', '00-07'],
    [1234567, '#-###-###', '1-234-567'],
  ])('%s with %s', (v, code, expected) => {
    expect(f(v, code)).toBe(expected);
  });

  it('applies the text section and colours', () => {
    expect(f('abc', '0;0;0;"text: "@')).toBe('text: abc');
    expect(formatValue(-5, '0;[Red]-0').color).toBe('#ff0000');
  });
  it('respects the Spanish locale separators', () => {
    expect(f(1234.5, '#,##0.00', 'es')).toBe('1.234,50');
  });
  it('supports conditions', () => {
    expect(f(150, '[>100]"big";"small"')).toBe('big');
    expect(f(50, '[>100]"big";"small"')).toBe('small');
  });
});

describe('date and time formats', () => {
  const d = serialFromYMD(2024, 1, 5);
  it('formats dates', () => {
    expect(f(d, 'yyyy-mm-dd')).toBe('2024-01-05');
    expect(f(d, 'dd/mm/yyyy')).toBe('05/01/2024');
    expect(f(d, 'd/m/yy')).toBe('5/1/24');
    expect(f(d, 'mmm d, yyyy')).toBe('Jan 5, 2024');
    expect(f(d, 'dddd, mmmm d')).toBe('Friday, January 5');
    expect(f(d, 'dddd d "de" mmmm', 'es')).toBe('viernes 5 de enero');
  });
  it('formats times and disambiguates minutes from months', () => {
    expect(f(0.75, 'hh:mm')).toBe('18:00');
    expect(f(0.75, 'h:mm AM/PM')).toBe('6:00 PM');
    expect(f(0.5 + 1 / 1440 + 5 / 86400, 'hh:mm:ss')).toBe('12:01:05');
    expect(f(d + 0.5, 'yyyy-mm-dd hh:mm')).toBe('2024-01-05 12:00');
    expect(f(1.5, '[h]:mm')).toBe('36:00');
  });
  it('detects date formats', () => {
    expect(isDateFormat('yyyy-mm-dd')).toBe(true);
    expect(isDateFormat('#,##0.00')).toBe(false);
    expect(isDateFormat('General')).toBe(false);
    expect(isDateFormat('0.0%')).toBe(false);
  });
});
