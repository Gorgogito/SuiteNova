import { describe, expect, it } from 'vitest';
import { fromWordDate, toWordDate } from './shared';

describe('dates of comments and tracked changes, as Word keeps them', () => {
  it('Word writes the local wall-clock time with a Z: going to the file and back gives the same instant', () => {
    const iso = '2026-11-20T16:05:09Z';
    expect(fromWordDate(toWordDate(iso))).toBe(iso);
    const local = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    expect(toWordDate(iso)).toBe(`${local.getFullYear()}-${p(local.getMonth() + 1)}-${p(local.getDate())}T${p(local.getHours())}:${p(local.getMinutes())}:${p(local.getSeconds())}Z`);
  });
  it('a date written by Word is read as local time (its Z is not a time zone)', () => {
    const d = new Date(fromWordDate('2026-11-20T11:05:00Z'));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 20, 11, 5]);
  });
  it('milliseconds are dropped and anything that is not a date is left alone or becomes now', () => {
    expect(fromWordDate(toWordDate('2026-11-20T16:05:09.123Z'))).toBe('2026-11-20T16:05:09Z');
    expect(fromWordDate('')).toBe('');
    expect(fromWordDate('ayer')).toBe('ayer');
    expect(toWordDate('ayer')).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
});
