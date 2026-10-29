import { describe, expect, it } from 'vitest';
import { parseA1, normRect } from './addr';
import { CFEvaluator, newRuleId, type CFRule } from './cf';
import { columnValues, filterCounts } from './filter';
import { Workbook } from './workbook';

function book(cells: Record<string, string>) {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  w.transact(() => {
    for (const [a, t] of Object.entries(cells)) {
      const p = parseA1(a)!;
      w.setInput(id, p.row, p.col, t);
    }
  });
  return { w, id, sheet: w.sheet(id) };
}
const rect = (a: string, b: string) => {
  const p = parseA1(a)!;
  const q = parseA1(b)!;
  return normRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col });
};
const data = { A1: 'Región', B1: 'Ventas', A2: 'Norte', B2: '10', A3: 'Sur', B3: '25', A4: 'Norte', B4: '40', A5: 'Este', B5: '5', A6: '', B6: '30' };

describe('autofilter', () => {
  it('lists distinct values with counts, blanks included', () => {
    const { w, sheet } = book(data);
    const vals = columnValues(w, sheet, { range: rect('A1', 'B6'), columns: {} }, 0);
    expect(vals.map((v) => [v.key, v.count])).toEqual([['Este', 1], ['Norte', 2], ['Sur', 1], ['', 1]]);
  });

  it('hides rows that do not match and counts what is shown', () => {
    const { w, id, sheet } = book(data);
    w.editLayout(id, (s) => {
      s.autoFilter = { range: rect('A1', 'B6'), columns: { 0: { values: ['Norte'] } } };
    });
    w.reapplyFilter(id);
    expect([...sheet.filterHidden].sort()).toEqual([2, 4, 5]);
    expect(filterCounts(sheet)).toEqual({ shown: 2, total: 5 });
    expect(w.rowHeight(id, 2)).toBe(0);
    expect(w.rowHeight(id, 1)).toBe(20);
  });

  it('supports conditions, AND/OR, and several columns', () => {
    const { w, id, sheet } = book(data);
    const filter = (cols: Record<number, object>) => {
      w.editLayout(id, (s) => {
        s.autoFilter = { range: rect('A1', 'B6'), columns: cols as never };
      });
      w.reapplyFilter(id);
      return [...sheet.filterHidden].sort();
    };
    expect(filter({ 1: { conditions: { list: [{ op: 'gt', value: '20' }], and: true } } })).toEqual([1, 4]);
    expect(filter({ 1: { conditions: { list: [{ op: 'lt', value: '10' }, { op: 'gt', value: '35' }], and: false } } })).toEqual([1, 2, 5]);
    expect(filter({ 0: { conditions: { list: [{ op: 'beginsWith', value: 'no' }], and: true } }, 1: { conditions: { list: [{ op: 'ge', value: '40' }], and: true } } })).toEqual([1, 2, 4, 5]);
    expect(filter({ 0: { conditions: { list: [{ op: 'contains', value: 'r' }], and: true } } })).toEqual([4, 5]);
    expect(filter({ 0: { values: [''] } })).toEqual([1, 2, 3, 4]);
  });

  it('undoes and redoes a filter', () => {
    const { w, id, sheet } = book(data);
    const p1 = w.editLayout(id, (s) => {
      s.autoFilter = { range: rect('A1', 'B6'), columns: { 0: { values: ['Sur'] } } };
    });
    const p2 = w.reapplyFilter(id);
    expect(sheet.filterHidden.size).toBe(4);
    w.applyPatch(p2, true);
    expect(sheet.filterHidden.size).toBe(0);
    w.applyPatch(p1, true);
    expect(sheet.autoFilter).toBeUndefined();
    w.applyPatch(p1, false);
    w.applyPatch(p2, false);
    expect(sheet.filterHidden.size).toBe(4);
  });

  it('makes SUBTOTAL ignore filtered rows but plain SUM does not', () => {
    const { w, id } = book({ ...data, D1: '=SUBTOTAL(9,B2:B6)', D2: '=SUM(B2:B6)', D3: '=SUBTOTAL(103,A2:A6)' });
    expect(w.getValue(id, 0, 3)).toBe(110);
    w.editLayout(id, (s) => {
      s.autoFilter = { range: rect('A1', 'B6'), columns: { 0: { values: ['Norte'] } } };
    });
    w.reapplyFilter(id);
    expect(w.getValue(id, 0, 3)).toBe(50);
    expect(w.getValue(id, 1, 3)).toBe(110);
    expect(w.getValue(id, 2, 3)).toBe(2);
    // rows hidden by hand: 9 counts them, 109 does not
    w.setInput(id, 0, 4, '=SUBTOTAL(9,B2:B6)');
    w.setInput(id, 0, 5, '=SUBTOTAL(109,B2:B6)');
    w.editLayout(id, (s) => s.hiddenRows.add(1));
    expect(w.getValue(id, 0, 4)).toBe(50);
    expect(w.getValue(id, 0, 5)).toBe(40);
  });

  it('follows row insertion and deletion', () => {
    const { w, id, sheet } = book(data);
    w.editLayout(id, (s) => {
      s.autoFilter = { range: rect('A1', 'B6'), columns: { 1: { conditions: { list: [{ op: 'gt', value: '20' }], and: true } } } };
    });
    w.reapplyFilter(id);
    w.shiftStructure(id, 'row', 0, 2);
    expect(sheet.autoFilter!.range).toEqual({ r1: 2, c1: 0, r2: 7, c2: 1 });
    expect([...sheet.filterHidden].sort()).toEqual([3, 6]);
    w.shiftStructure(id, 'col', 0, 1);
    expect(Object.keys(sheet.autoFilter!.columns)).toEqual(['2']);
  });
});

describe('conditional formatting', () => {
  const rule = (over: Partial<CFRule> & Pick<CFRule, 'type'>, ranges = [rect('B2', 'B6')]): CFRule => ({ id: newRuleId(), ranges, priority: 1, ...over }) as CFRule;
  const run = (cells: Record<string, string>, rules: CFRule[]) => {
    const b = book(cells);
    b.sheet.condFormats = rules.map((r, i) => ({ ...r, priority: r.priority || i + 1 }));
    const ev = new CFEvaluator(b.w, b.id);
    return { ...b, at: (a: string) => ev.forCell(parseA1(a)!.row, parseA1(a)!.col) };
  };

  it('applies cell-value rules', () => {
    const { at } = run(data, [rule({ type: 'cellIs', operator: 'greaterThan', formula1: '20', format: { bg: '#ffc7ce', color: '#9c0006' } })]);
    expect(at('B3')?.format).toEqual({ bg: '#ffc7ce', color: '#9c0006' });
    expect(at('B2')).toBeNull();
    expect(at('A3')).toBeNull(); // outside the range
  });

  it('handles between, equal text, and references in the formula', () => {
    const { at } = run({ ...data, D1: '30' }, [
      rule({ type: 'cellIs', operator: 'between', formula1: '10', formula2: '30', format: { bold: true } }),
      rule({ type: 'cellIs', operator: 'equal', formula1: '$D$1', format: { italic: true }, priority: 2 }),
    ]);
    expect(at('B2')?.format).toEqual({ bold: true });
    expect(at('B4')).toBeNull();
    expect(at('B6')?.format).toEqual({ bold: true, italic: true }); // both rules, non-conflicting properties merge
  });

  it('respects priority on conflicts and stop-if-true', () => {
    const { at } = run(data, [
      rule({ type: 'cellIs', operator: 'greaterThan', formula1: '20', format: { bg: '#111111' }, priority: 2 }),
      rule({ type: 'cellIs', operator: 'greaterThan', formula1: '30', format: { bg: '#222222' }, priority: 1 }),
    ]);
    expect(at('B4')?.format?.bg).toBe('#222222'); // 40 matches both; priority 1 wins
    expect(at('B3')?.format?.bg).toBe('#111111');
    const stop = run(data, [
      rule({ type: 'cellIs', operator: 'greaterThan', formula1: '20', format: { bg: '#111111' }, priority: 1, stopIfTrue: true }),
      rule({ type: 'cellIs', operator: 'greaterThan', formula1: '20', format: { bold: true }, priority: 2 }),
    ]);
    expect(stop.at('B3')?.format).toEqual({ bg: '#111111' });
  });

  it('evaluates expressions relative to the first cell of the range', () => {
    const { at } = run(data, [rule({ type: 'expression', formula: '$A2="Norte"', format: { bg: '#abcdef' } }, [rect('A2', 'B6')])]);
    expect(at('A2')?.format?.bg).toBe('#abcdef');
    expect(at('B4')?.format?.bg).toBe('#abcdef');
    expect(at('B3')).toBeNull();
  });

  it('matches text, duplicates, top/bottom, average and blanks', () => {
    const t = run(data, [rule({ type: 'text', mode: 'contains', text: 'OR', format: { bold: true } }, [rect('A2', 'A6')])]);
    expect(t.at('A2')?.format?.bold).toBe(true);
    expect(t.at('A3')).toBeNull();
    const dup = run(data, [rule({ type: 'duplicates', format: { bold: true } }, [rect('A2', 'A6')])]);
    expect([dup.at('A2'), dup.at('A3'), dup.at('A4'), dup.at('A6')].map((x) => !!x)).toEqual([true, false, true, false]);
    const uniq = run(data, [rule({ type: 'duplicates', unique: true, format: { bold: true } }, [rect('A2', 'A6')])]);
    expect([uniq.at('A2'), uniq.at('A3')].map((x) => !!x)).toEqual([false, true]);
    const top = run(data, [rule({ type: 'top', rank: 2, format: { bold: true } })]);
    expect([top.at('B2'), top.at('B3'), top.at('B4'), top.at('B5'), top.at('B6')].map((x) => !!x)).toEqual([false, false, true, false, true]);
    const bottom = run(data, [rule({ type: 'top', rank: 1, bottom: true, format: { bold: true } })]);
    expect(!!bottom.at('B5')).toBe(true);
    const pct = run(data, [rule({ type: 'top', rank: 40, percent: true, format: { bold: true } })]);
    expect([pct.at('B4'), pct.at('B6'), pct.at('B3')].map((x) => !!x)).toEqual([true, true, false]);
    const avg = run(data, [rule({ type: 'average', above: true, format: { bold: true } })]);
    expect([avg.at('B2'), avg.at('B3'), avg.at('B4')].map((x) => !!x)).toEqual([false, true, true]); // mean = 22
    const blank = run(data, [rule({ type: 'blanks', format: { bg: '#ddd' } }, [rect('A2', 'A6')])]);
    expect(!!blank.at('A6')).toBe(true);
    expect(blank.at('A2')).toBeNull();
  });

  it('interpolates colour scales', () => {
    const { at } = run({ B2: '0', B3: '50', B4: '100', B5: '25' }, [
      rule({ type: 'colorScale', stops: [{ cfvo: { type: 'min' }, color: '#000000' }, { cfvo: { type: 'max' }, color: '#ffffff' }] }, [rect('B2', 'B5')]),
    ]);
    expect(at('B2')?.scaleBg).toBe('#000000');
    expect(at('B4')?.scaleBg).toBe('#ffffff');
    expect(at('B3')?.scaleBg).toBe('#808080');
    const three = run({ B2: '0', B3: '50', B4: '100' }, [
      rule({ type: 'colorScale', stops: [{ cfvo: { type: 'min' }, color: '#ff0000' }, { cfvo: { type: 'percentile', value: 50 }, color: '#ffff00' }, { cfvo: { type: 'max' }, color: '#00ff00' }] }, [rect('B2', 'B4')]),
    ]);
    expect(three.at('B3')?.scaleBg).toBe('#ffff00');
    expect(three.at('B2')?.scaleBg).toBe('#ff0000');
  });

  it('computes data bars and icon sets', () => {
    const { at } = run({ B2: '10', B3: '20', B4: '30' }, [rule({ type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' } }, [rect('B2', 'B4')])]);
    expect(at('B2')?.bar?.fraction).toBe(0);
    expect(at('B3')?.bar?.fraction).toBe(0.5);
    expect(at('B4')?.bar).toEqual({ fraction: 1, color: '#638ec6' });
    const icons = run({ B2: '1', B3: '5', B4: '10' }, [
      rule({ type: 'iconSet', set: '3Arrows', thresholds: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 }, { type: 'percent', value: 67 }] }, [rect('B2', 'B4')]),
    ]);
    expect([icons.at('B2')?.icon?.index, icons.at('B3')?.icon?.index, icons.at('B4')?.icon?.index]).toEqual([0, 1, 2]);
    const rev = run({ B2: '1', B4: '10' }, [rule({ type: 'iconSet', set: '3Arrows', reverse: true, showValue: false, thresholds: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 }, { type: 'percent', value: 67 }] }, [rect('B2', 'B4')])]);
    expect(rev.at('B2')?.icon?.index).toBe(2);
    expect(rev.at('B2')?.hideValue).toBe(true);
  });

  it('survives structure changes, renames and undo', () => {
    const { w, id, sheet } = book(data);
    const patch = w.editLayout(id, (s) => {
      s.condFormats.push(rule({ type: 'expression', formula: 'B2>$B$3', format: { bold: true } }, [rect('B2', 'B6')]));
    });
    w.shiftStructure(id, 'row', 0, 1);
    expect(sheet.condFormats[0]!.ranges[0]).toEqual({ r1: 2, c1: 1, r2: 6, c2: 1 });
    expect((sheet.condFormats[0] as { formula: string }).formula).toBe('B3>$B$4');
    w.shiftStructure(id, 'row', 3, -10); // delete everything below row 3 => the range shrinks
    expect(sheet.condFormats[0]!.ranges[0]!.r2).toBe(2);
    w.shiftStructure(id, 'row', 0, -5);
    expect(sheet.condFormats).toHaveLength(0);
    w.applyPatch(patch, true);
    expect(sheet.condFormats).toHaveLength(0);
  });
});
