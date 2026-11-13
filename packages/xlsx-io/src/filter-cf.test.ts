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
    zip.file('xl/worksheets/sheet1.xml', xml.replace(/<filterColumn[\s\S]*<\/filterColumn>/, '<filterColumn colId="1"><dynamicFilter type="inventado"/></filterColumn><filterColumn colId="0"><filters><dateGroupItem year="2024" month="1" day="2" hour="3" dateTimeGrouping="hour"/></filters></filterColumn>'));
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
    zip.file('xl/worksheets/sheet1.xml', sheet.replace('iconSet="3Arrows"', 'iconSet="9Inventado"'));
    const { workbook, warnings } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    const rules = workbook.sheets[0]!.condFormats;
    expect(rules).toHaveLength(1);
    expect(rules[0]!.format).toEqual({ bold: true, color: '#ed7d31', bg: '#ffc7ce' }); // theme accent2 of the default Office theme
    expect(warnings.join(' ')).toMatch(/9Inventado/);
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

describe('formato condicional y autofiltro ampliados', () => {
  it('ida y vuelta de fechas, desviación estándar, 20 conjuntos de iconos y barras con negativos', async () => {
    const { w, id } = sample();
    const rg = [{ r1: 1, c1: 1, r2: 4, c2: 1 }];
    const rules = [
      { type: 'timePeriod', period: 'last7Days', format: { bold: true } },
      { type: 'timePeriod', period: 'thisWeek', format: { italic: true } },
      { type: 'average', above: true, stdDev: 2, format: { bold: true } },
      { type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' }, negativeColor: '#cc0000', axis: 'middle', solid: true },
      { type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' }, axis: 'none' },
      { type: 'dataBar', color: '#638ec6', min: { type: 'min' }, max: { type: 'max' } },
      ...(['3ArrowsGray', '3TrafficLights2', '3Signs', '3Symbols2', '3Stars', '3Triangles', '4ArrowsGray', '4RedToBlack', '4Rating', '4TrafficLights', '5ArrowsGray', '5Rating', '5Quarters', '5Boxes'] as const).map((set) => ({
        type: 'iconSet',
        set,
        thresholds: Array.from({ length: Number(set[0]) }, (_x, i) => ({ type: 'percent' as const, value: Math.round((i * 100) / Number(set[0])) })),
      })),
    ];
    w.editLayout(id, (s) => {
      rules.forEach((r, i) => s.condFormats.push({ ...r, id: 'r' + i, ranges: rg, priority: i + 1 } as never));
    });
    const bytes = await writeXlsx(w);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('type="timePeriod"');
    expect(xml).toContain('timePeriod="last7Days"');
    expect(xml).toContain('stdDev="2"');
    // la extensión de Excel 2010 solo se escribe para las barras que la necesitan
    expect((xml.match(/<x14:cfRule type="dataBar"/g) ?? []).length).toBe(2);
    expect(xml).toContain('axisPosition="middle"');
    expect(xml).toContain('gradient="0"');
    expect(xml).toContain('<x14:negativeFillColor rgb="FFCC0000"/>');
    const { workbook: r, warnings } = await readXlsx(bytes);
    expect(warnings).toEqual([]);
    const back = r.sheets[0]!.condFormats;
    expect(back).toHaveLength(rules.length);
    back.forEach((b, i) => {
      for (const [k, v] of Object.entries(rules[i]!)) expect(b[k as keyof typeof b], `rule ${i} ${k}`).toEqual(v);
    });
    expect((back[5] as { negativeColor?: string }).negativeColor).toBeUndefined();
  });

  it('bordes y formato de número dentro de la regla', async () => {
    const { w, id } = sample();
    w.editLayout(id, (s) => {
      s.condFormats.push({
        id: 'a',
        ranges: [{ r1: 1, c1: 1, r2: 4, c2: 1 }],
        priority: 1,
        type: 'cellIs',
        operator: 'greaterThan',
        formula1: '20',
        format: { bold: true, numFmt: '0.00" kg"', top: { style: 'thin', color: '#ff0000' }, bottom: { style: 'double' }, left: { style: 'thick', color: '#00ff00' } },
      });
    });
    const bytes = await writeXlsx(w);
    const zip = await JSZip.loadAsync(bytes);
    const styles = await zip.file('xl/styles.xml')!.async('string');
    expect(/<dxf>.*<numFmt numFmtId="\d+" formatCode="0.00&quot; kg&quot;"\/>.*<border><left style="thick">/s.test(styles)).toBe(true);
    const { workbook: r } = await readXlsx(bytes);
    expect(r.sheets[0]!.condFormats[0]!.format).toEqual({ bold: true, numFmt: '0.00" kg"', top: { style: 'thin', color: '#ff0000' }, bottom: { style: 'double' }, left: { style: 'thick', color: '#00ff00' } });
  });

  it('autofiltro: diez mejores, dinámicos, por color y agrupaciones de fecha', async () => {
    const { w, id } = sample();
    const cases: Record<string, object> = {
      top: { top: { n: 3 } },
      topPct: { top: { n: 20, percent: true, bottom: true } },
      avg: { dynamic: 'aboveAverage' },
      month: { dynamic: 'thisMonth' },
      q: { dynamic: { quarter: 2 } },
      m: { dynamic: { month: 11 } },
      cell: { color: { kind: 'cell', color: '#ffff00' } },
      font: { color: { kind: 'font', color: '#00aa00' } },
      none: { color: { kind: 'cell', color: null } },
      dates: { dates: [{ year: 2024, month: 5, day: 2 }, { year: 2023 }, { year: 2024, month: 6 }] },
    };
    for (const [name, f] of Object.entries(cases)) {
      w.editLayout(id, (s) => {
        s.autoFilter = { range: { r1: 0, c1: 0, r2: 4, c2: 1 }, columns: { 1: f as never } };
      });
      const { workbook } = await readXlsx(await writeXlsx(w));
      expect(workbook.sheets[0]!.autoFilter!.columns[1], name).toEqual(f);
    }
    w.editLayout(id, (s) => {
      s.autoFilter = { range: { r1: 0, c1: 0, r2: 4, c2: 1 }, columns: { 1: cases.top as never } };
    });
    const xml = await (await JSZip.loadAsync(await writeXlsx(w))).file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('<top10 val="3"/>');
  });
});
