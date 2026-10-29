import { parseA1, type Rect, type Scalar } from '@suitenova/calc-engine';
import { describe, expect, it } from 'vitest';
import { chart3dSvg } from './chart3d';
import { CHART_PRESETS } from './chartPresets';
import { CalcDoc } from './doc';
import { headerFooterParts, layoutPrint, printHtml } from './print';

const rect = (a: string): Rect => {
  const [x, y] = a.split(':') as [string, string?];
  const p = parseA1(x)!;
  const q = parseA1(y ?? x)!;
  return { r1: p.row, c1: p.col, r2: q.row, c2: q.col };
};
const doc = (cells: Record<string, string> = {}) => {
  const d = new CalcDoc();
  d.locale = 'en';
  for (const [a, t] of Object.entries(cells)) {
    const p = parseA1(a)!;
    d.wb.setInput(d.activeSheetId, p.row, p.col, t);
  }
  return d;
};
const val = (d: CalcDoc, a: string): Scalar => {
  const p = parseA1(a)!;
  return d.wb.getValue(d.activeSheetId, p.row, p.col);
};

describe('macros', () => {
  const withCode = (code: string, cells: Record<string, string> = {}) => {
    const d = doc(cells);
    d.contentEnabled = true;
    d.wb.macros = [{ name: 'Modulo1', code }];
    return d;
  };
  it('Range / Cells write and read the sheet, and the whole run is one undo step', () => {
    const d = withCode(
      [
        'Sub Llenar()',
        '  Dim i As Long',
        '  For i = 1 To 5',
        '    Cells(i, 1).Value = i * i',
        '  Next i',
        '  Range("B1").Formula = "=SUM(A1:A5)"',
        '  Range("C1").Value = Application.WorksheetFunction.Sum(Range("A1:A5"))',
        'End Sub',
      ].join('\n'),
    );
    const r = d.macros.run('Llenar');
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(val(d, 'A3')).toBe(9);
    expect(val(d, 'B1')).toBe(55);
    expect(val(d, 'C1')).toBe(55);
    d.undo();
    expect(val(d, 'A3')).toBeNull();
    expect(val(d, 'B1')).toBeNull();
  });
  it('formats cells and moves around the sheet', () => {
    const d = withCode('Sub F()\n  Range("A1:A2").Font.Bold = True\n  Range("A1").Interior.Color = RGB(255, 0, 0)\n  Range("A1").Value = Range("A1").Row + Range("B3").Column\nEnd Sub');
    expect(d.macros.run('F').ok).toBe(true);
    expect(d.wb.getStyle(d.activeSheetId, 1, 0).bold).toBe(true);
    expect(d.wb.getStyle(d.activeSheetId, 0, 0).bg).toBe('#ff0000');
    expect(val(d, 'A1')).toBe(3);
  });
  it('an error stops the run, reports the line and keeps what was done before', () => {
    const d = withCode('Sub M()\n  Range("A1").Value = 1\n  Dim x\n  x = 1 / 0\n  Range("A2").Value = 2\nEnd Sub');
    const r = d.macros.run('M');
    expect(r.ok).toBe(false);
    expect(r.at).toMatchObject({ module: 'Modulo1', line: 4 });
    expect(val(d, 'A1')).toBe(1);
    expect(val(d, 'A2')).toBeNull();
  });
  it('syntax errors are reported without running anything', () => {
    const d = withCode('Sub M()\n  Range("A1").Value = \nEnd Sub');
    const r = d.macros.run('M');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sintaxis/i);
    expect(d.macros.load()[0]!.line).toBe(2);
  });
  it('is refused while the file content is not enabled', () => {
    const d = withCode('Sub M()\n  Range("A1").Value = 1\nEnd Sub');
    d.contentEnabled = false;
    const r = d.macros.run('M');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/deshabilitado/);
    expect(val(d, 'A1')).toBeNull();
  });
  it('a function of the module can be used from a cell (read only)', () => {
    const d = withCode('Function Doble(x)\n  Doble = x * 2\nEnd Function\nFunction Malo()\n  Range("A9").Value = 1\n  Malo = 1\nEnd Function', { A1: '21' });
    d.wb.setInput(d.activeSheetId, 0, 1, '=Doble(A1)');
    expect(d.macros.console.join('|'), 'console').toBe('');
    expect(val(d, 'B1')).toBe(42);
    d.wb.setInput(d.activeSheetId, 0, 2, '=Malo()');
    expect(typeof val(d, 'C1')).not.toBe('number');
    expect(val(d, 'A9')).toBeNull();
  });
  it('the immediate window evaluates and prints', () => {
    const d = withCode('Sub M()\nEnd Sub', { A1: '7' });
    expect(d.macros.immediate('Debug.Print Range("A1").Value * 3').ok).toBe(true);
    expect(d.macros.console.join('\n')).toContain('21');
  });
  it('Worksheet_Change fires for edits made by the user', () => {
    const d = withCode('Sub Worksheet_Change(ByVal Target As Range)\n  Range("B1").Value = Target.Value + 1\nEnd Sub');
    d.selectCell(0, 0);
    d.beginEdit({ text: '10', mode: 'enter' });
    d.commitEdit();
    expect(val(d, 'B1')).toBe(11);
  });
});

describe('printing', () => {
  const big = () => {
    const d = doc();
    for (let r = 0; r < 120; r++) d.wb.setInput(d.activeSheetId, r, 0, String(r));
    return d;
  };
  it('splits a long sheet into pages and numbers them', () => {
    const d = big();
    const l = layoutPrint(d, 'sheet');
    expect(l.pages.length).toBeGreaterThan(1);
    expect(l.pages.map((p) => p.number)).toEqual(l.pages.map((_, i) => i + 1));
  });
  it('fit to one page wide and tall gives a single page', () => {
    const d = big();
    d.x.setPage({ fitWidth: 1, fitHeight: 1 });
    expect(layoutPrint(d, 'sheet').pages).toHaveLength(1);
  });
  it('honours the print area, title rows and manual breaks', () => {
    const d = big();
    d.selectRange(rect('A1:A30'));
    d.x.setPrintArea();
    d.x.setPrintTitles({ r1: 0, r2: 0 }, undefined);
    d.x.setPage({ fitWidth: undefined, fitHeight: undefined, scale: 100 } as never);
    d.selectCell(10, 0);
    d.x.togglePageBreaks();
    const l = layoutPrint(d, 'sheet');
    expect(l.pages[0]!.rows.at(-1)).toBe(9);
    expect(l.pages[1]!.rows[0]).toBe(0); // the title row repeats
    expect(l.pages[1]!.rows[1]).toBe(10);
    expect(l.pages.flatMap((p) => p.rows).includes(40)).toBe(false);
  });
  it('an empty sheet says why nothing prints', () => {
    const l = layoutPrint(doc(), 'sheet');
    expect(l.pages).toHaveLength(0);
    expect(l.empty).toBeTruthy();
  });
  it('the HTML has one block per page with the cells', () => {
    const d = doc({ A1: 'Hola', B2: '=1+2' });
    const { html, layout } = printHtml(d, 'sheet');
    expect(layout.pages).toHaveLength(1);
    expect(html).toContain('Hola');
    expect(html.match(/class="page"/g)).toHaveLength(1);
    expect(html).toContain('@page{size:A4 portrait');
  });
  it('escapes text so cells cannot inject markup', () => {
    const d = doc({ A1: '<img src=x onerror=alert(1)>' });
    expect(printHtml(d, 'sheet').html).not.toContain('<img src=x');
  });
  it('header and footer codes', () => {
    const ctx = { page: 2, pages: 5, file: 'f.xlsx', sheet: 'Hoja1', now: new Date(2026, 0, 5, 14, 30), locale: 'en' as const };
    expect(headerFooterParts('&LIzq&CPág. &P de &N&R&A', ctx)).toEqual({ left: 'Izq', center: 'Pág. 2 de 5', right: 'Hoja1' });
    expect(headerFooterParts(undefined, ctx)).toEqual({ left: '', center: '', right: '' });
  });
});

describe('3D charts and presets', () => {
  const base = {
    threeD: { rotX: 15, rotY: 20, perspective: 30, rightAngle: true, depth: 100 },
    categories: ['A', 'B', 'C'],
    series: [
      { name: 'S1', values: [1, 2, 3], color: '#1f77b4' },
      { name: 'S2', values: [3, 1, 2], color: '#ff7f0e' },
    ],
    legend: true,
    width: 480,
    height: 320,
    text: '#222',
    grid: '#ccc',
    bg: '#fff',
  };
  for (const type of ['column', 'bar', 'line', 'area', 'pie', 'surface'] as const) {
    it(`draws ${type} as a well formed svg`, () => {
      const svg = chart3dSvg({ ...base, type } as never);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      expect((svg.match(/<(path|polygon)/g) ?? []).length).toBeGreaterThan(3);
    });
  }
  it('survives empty and null data', () => {
    const svg = chart3dSvg({ ...base, type: 'column', categories: [], series: [{ name: 'x', values: [], color: '#000' }] } as never);
    expect(svg).not.toMatch(/NaN/);
    const nul = chart3dSvg({ ...base, type: 'surface', series: [{ name: 'x', values: [null, 1, null], color: '#000' }] } as never);
    expect(nul).not.toMatch(/NaN/);
  });
  it('rotation changes the picture', () => {
    const a = chart3dSvg({ ...base, type: 'column' } as never);
    const b = chart3dSvg({ ...base, type: 'column', threeD: { ...base.threeD, rotY: 70 } } as never);
    expect(a).not.toBe(b);
  });
  it('every preset has a unique id and a name', () => {
    const ids = CHART_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CHART_PRESETS.every((p) => p.label)).toBe(true);
  });
});
