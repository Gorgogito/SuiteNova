import { Workbook, parseA1 } from '@suitenova/calc-engine';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readXlsx, writeXlsx } from './index';

function sample() {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  const put = (a: string, t: string) => {
    const p = parseA1(a)!;
    w.setInput(id, p.row, p.col, t);
  };
  for (const [a, t] of Object.entries({ A1: 'Región', B1: 'Ventas', A2: 'Norte', B2: '10', A3: 'Sur', B3: '25', A4: 'Norte', B4: '40', A5: 'Este', B5: '5' })) put(a, t);
  return { w, id };
}

describe('autofilter', () => {
  it('round-trips criteria and hidden rows', async () => {
    const { w, id } = sample();
    w.editLayout(id, (s) => {
      s.autoFilter = {
        range: { r1: 0, c1: 0, r2: 4, c2: 1 },
        columns: { 0: { values: ['Norte', ''] }, 1: { conditions: { list: [{ op: 'gt', value: '5' }, { op: 'contains', value: 'x' }], and: false } } },
      };
    });
    w.reapplyFilter(id);
    const bytes = await writeXlsx(w);
    const xml = await (await JSZip.loadAsync(bytes)).file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('<autoFilter ref="A1:B5">');
    expect(xml).toContain('<filters blank="1"><filter val="Norte"/></filters>');
    expect(xml).toContain('<customFilter operator="greaterThan" val="5"/><customFilter operator="equal" val="*x*"/>');
    expect(xml.indexOf('<autoFilter')).toBeLessThan(xml.indexOf('<pageMargins'));
    expect(xml.indexOf('<sheetData>')).toBeLessThan(xml.indexOf('<autoFilter'));
    const { workbook: r } = await readXlsx(bytes);
    const s = r.sheets[0]!;
    expect(s.autoFilter).toEqual(w.sheets[0]!.autoFilter);
    expect([...s.filterHidden].sort()).toEqual([...w.sheets[0]!.filterHidden].sort());
    expect(s.hiddenRows.size).toBe(0); // filtered rows are not mistaken for rows hidden by hand
  });

  it('maps text operators to Excel wildcards and back', async () => {
    const { w, id } = sample();
    const ops = ['contains', 'notContains', 'beginsWith', 'endsWith', 'eq', 'ne', 'ge', 'le', 'lt'] as const;
    w.editLayout(id, (s) => {
      s.autoFilter = { range: { r1: 0, c1: 0, r2: 4, c2: 1 }, columns: Object.fromEntries(ops.map((op, i) => [i % 2, { conditions: { list: [{ op, value: 'ab' }], and: true } }])) as never };
    });
    // one filter per column is enough to inspect the mapping; check each operator separately
    for (const op of ops) {
      w.editLayout(id, (s) => {
        s.autoFilter = { range: { r1: 0, c1: 0, r2: 4, c2: 1 }, columns: { 0: { conditions: { list: [{ op, value: 'ab' }], and: true } } } };
      });
      const { workbook } = await readXlsx(await writeXlsx(w));
      expect(workbook.sheets[0]!.autoFilter!.columns[0], op).toEqual({ conditions: { list: [{ op, value: 'ab' }], and: true } });
    }
  });

  it('warns about filters it cannot represent', async () => {
    const { w, id } = sample();
    w.editLayout(id, (s) => {
      s.autoFilter = { range: { r1: 0, c1: 0, r2: 4, c2: 1 }, columns: { 0: { values: ['Norte'] } } };
    });
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    zip.file('xl/worksheets/sheet1.xml', xml.replace(/<filterColumn[\s\S]*<\/filterColumn>/, '<filterColumn colId="1"><top10 val="3"/></filterColumn><filterColumn colId="0"><filters><dateGroupItem year="2024" dateTimeGrouping="year"/></filters></filterColumn>'));
    const { workbook, warnings } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    expect(workbook.sheets[0]!.autoFilter).toBeDefined();
    expect(Object.keys(workbook.sheets[0]!.autoFilter!.columns)).toEqual([]);
    expect(warnings.join(' ')).toMatch(/filtros no soportados/);
  });

  it('survives a structure change before saving', async () => {
    const { w, id } = sample();
    w.editLayout(id, (s) => {
      s.autoFilter = { range: { r1: 0, c1: 0, r2: 4, c2: 1 }, columns: { 1: { conditions: { list: [{ op: 'gt', value: '20' }], and: true } } } };
    });
    w.reapplyFilter(id);
    w.shiftStructure(id, 'row', 0, 2);
    const { workbook } = await readXlsx(await writeXlsx(w));
    expect(workbook.sheets[0]!.autoFilter!.range).toEqual({ r1: 2, c1: 0, r2: 6, c2: 1 });
    expect([...workbook.sheets[0]!.filterHidden].sort()).toEqual([3, 6]);
  });
});

describe('conditional formatting', () => {
  it('round-trips every rule type', async () => {
    const { w, id } = sample();
    const rg = [{ r1: 1, c1: 1, r2: 4, c2: 1 }];
    const rules = [
      { type: 'cellIs', operator: 'between', formula1: '5', formula2: '30', format: { bg: '#ffc7ce', color: '#9c0006', bold: true } },
      { type: 'expression', formula: '$B2>$B$3', format: { italic: true, underline: true } },
      { type: 'text', mode: 'contains', text: 'or', format: { strike: true } },
      { type: 'text', mode: 'beginsWith', text: 'N' },
      { type: 'duplicates', unique: true, format: { bg: '#ffeb9c' } },
      { type: 'top', rank: 3, percent: true, bottom: true, format: { bold: true } },
      { type: 'average', above: false, equal: true, format: { bold: true } },
      { type: 'blanks', not: true, format: { bold: true } },
      { type: 'errors', format: { bold: true } },
      { type: 'colorScale', stops: [{ cfvo: { type: 'min' }, color: '#ff0000' }, { cfvo: { type: 'percentile', value: 50 }, color: '#ffff00' }, { cfvo: { type: 'max' }, color: '#00ff00' }] },
      { type: 'dataBar', color: '#638ec6', min: { type: 'num', value: 0 }, max: { type: 'max' }, showValue: false },
      { type: 'iconSet', set: '3TrafficLights', thresholds: [{ type: 'percent', value: 0 }, { type: 'num', value: 10 }, { type: 'formula', value: '$B$2' }], reverse: true },
      { type: 'iconSet', set: '5Arrows', thresholds: [0, 20, 40, 60, 80].map((v) => ({ type: 'percent' as const, value: v })) },
    ];
    w.editLayout(id, (s) => {
      rules.forEach((r, i) => s.condFormats.push({ ...r, id: 'r' + i, ranges: rg, priority: i + 1, ...(i === 0 ? { stopIfTrue: true } : {}) } as never));
    });
    const bytes = await writeXlsx(w);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('xl/styles.xml')!.async('string')).toContain('<dxfs count="');
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('<conditionalFormatting sqref="B2:B5">');
    expect(xml).toContain('NOT(ISERROR(SEARCH(&quot;or&quot;,B2)))');
    expect(xml.indexOf('</mergeCells>') < 0 || xml.indexOf('<conditionalFormatting') > xml.indexOf('</mergeCells>')).toBe(true);
    const { workbook: r, warnings } = await readXlsx(bytes);
    expect(warnings).toEqual([]);
    const back = r.sheets[0]!.condFormats;
    expect(back).toHaveLength(rules.length);
    back.forEach((b, i) => {
      for (const [k, v] of Object.entries(rules[i]!)) expect(b[k as keyof typeof b], `rule ${i} ${k}`).toEqual(v);
      expect(b.ranges).toEqual(rg);
      expect(b.priority).toBe(i + 1);
    });
    expect(back[0]!.stopIfTrue).toBe(true);
  });

  it('resolves theme colours in differential formats and warns about unknown icon sets', async () => {
    const { w, id } = sample();
    w.editLayout(id, (s) => {
      s.condFormats.push({ id: 'a', ranges: [{ r1: 1, c1: 1, r2: 3, c2: 1 }], priority: 1, type: 'cellIs', operator: 'lessThan', formula1: '0.3', format: { bold: true } });
      s.condFormats.push({ id: 'b', ranges: [{ r1: 1, c1: 2, r2: 1, c2: 2 }], priority: 2, type: 'iconSet', set: '3Arrows', thresholds: [{ type: 'percent', value: 0 }] });
    });
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const styles = await zip.file('xl/styles.xml')!.async('string');
    zip.file('xl/styles.xml', styles.replace(/<dxfs[\s\S]*<\/dxfs>/, '<dxfs count="1"><dxf><font><b/><color theme="5"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs>'));
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    zip.file('xl/worksheets/sheet1.xml', sheet.replace('iconSet="3Arrows"', 'iconSet="4Rating"'));
    const { workbook, warnings } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    const rules = workbook.sheets[0]!.condFormats;
    expect(rules).toHaveLength(1);
    expect(rules[0]!.format).toEqual({ bold: true, color: '#ed7d31', bg: '#ffc7ce' }); // theme accent2 of the default Office theme
    expect(warnings.join(' ')).toMatch(/4Rating/);
  });

  it('writes rules that were adjusted by structure changes', async () => {
    const { w, id } = sample();
    w.editLayout(id, (s) => s.condFormats.push({ id: 'x', ranges: [{ r1: 1, c1: 1, r2: 4, c2: 1 }], priority: 1, type: 'expression', formula: 'B2>B$1', format: { bold: true } }));
    w.shiftStructure(id, 'row', 0, 1);
    const { workbook } = await readXlsx(await writeXlsx(w));
    const r = workbook.sheets[0]!.condFormats[0]! as { ranges: unknown; formula: string };
    expect(r.ranges).toEqual([{ r1: 2, c1: 1, r2: 5, c2: 1 }]);
    expect(r.formula).toBe('B3>B$2');
  });
});
