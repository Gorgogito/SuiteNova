import {
  DEFAULT_3D,
  Workbook,
  newPivot,
  newSparklineGroup,
  newValidation,
  parseA1,
  type ChartDef,
  type Rect,
  type Scalar,
} from '@suitenova/calc-engine';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { readXlsx, writeXlsx } from './index';

const rect = (a: string): Rect => {
  const [x, y] = a.split(':') as [string, string?];
  const p = parseA1(x)!;
  const q = parseA1(y ?? x)!;
  return { r1: p.row, c1: p.col, r2: q.row, c2: q.col };
};

async function roundTrip(w: Workbook, custom?: string) {
  const bytes = await writeXlsx(w, { customJson: custom });
  await assertPackage(bytes);
  const r = await readXlsx(bytes);
  r.workbook.recalcAll();
  return { ...r, bytes };
}

/** Every part is well-formed XML, has a content type, and every internal relationship points at a part that exists. */
async function assertPackage(bytes: Uint8Array): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const ct = await zip.file('[Content_Types].xml')!.async('string');
  const overrides = new Set([...ct.matchAll(/PartName="([^"]+)"/g)].map((m) => m[1]!));
  const defaults = new Set([...ct.matchAll(/Default Extension="([^"]+)"/g)].map((m) => m[1]!.toLowerCase()));
  for (const n of names) {
    if (n === '[Content_Types].xml') continue;
    const ext = n.split('.').pop()!.toLowerCase();
    expect(overrides.has(`/${n}`) || defaults.has(ext), `no content type for ${n}`).toBe(true);
    if (/\.(xml|rels)$/.test(n)) {
      const text = await zip.file(n)!.async('string');
      const ok = XMLValidator.validate(text);
      expect(ok === true, `${n} is not well-formed: ${JSON.stringify(ok)}`).toBe(true);
    }
  }
  for (const o of overrides) expect(names.includes(o.slice(1)), `override for a missing part ${o}`).toBe(true);
  for (const n of names.filter((x) => x.endsWith('.rels'))) {
    const dir = n.replace(/_rels\/[^/]+$/, '');
    const text = await zip.file(n)!.async('string');
    for (const m of text.matchAll(/<Relationship [^>]*>/g)) {
      if (/TargetMode="External"/.test(m[0])) continue;
      const target = /Target="([^"]+)"/.exec(m[0])![1]!;
      const parts = (target.startsWith('/') ? target.slice(1) : dir + target).split('/');
      const out: string[] = [];
      for (const seg of parts) {
        if (seg === '..') out.pop();
        else if (seg !== '.' && seg !== '') out.push(seg);
      }
      expect(names.includes(out.join('/')), `${n}: missing target ${target}`).toBe(true);
    }
  }
}

function book(cells: Record<string, string> = {}) {
  const w = new Workbook();
  const id = w.sheets[0]!.id;
  w.renameSheet(id, 'Datos');
  w.transact(() => {
    for (const [a, t] of Object.entries(cells)) {
      const p = parseA1(a)!;
      w.setInput(id, p.row, p.col, t);
    }
  });
  const get = (a: string, sheet = id): Scalar => {
    const p = parseA1(a)!;
    return w.getValue(sheet, p.row, p.col);
  };
  return { w, id, get };
}

describe('data validation', () => {
  it('keeps every kind of rule and its messages', async () => {
    const { w, id } = book({ D1: 'a', D2: 'b' });
    w.editObjects(id, (s) => {
      s.validations.push(
        { ...newValidation('v1', [rect('A1:A5')]), type: 'whole', op: 'between', formula1: '1', formula2: '10', errorStyle: 'warning', errorTitle: 'Ojo', errorMessage: 'Entre 1 y 10', inputTitle: 'Dato', inputMessage: 'Escribe un número' },
        { ...newValidation('v2', [rect('B1:B2'), rect('B5')]), type: 'list', formula1: '"Sí,No,Tal vez"', showDropdown: false, allowBlank: false },
        { ...newValidation('v3', [rect('C1')]), type: 'list', formula1: '$D$1:$D$2' },
        { ...newValidation('v4', [rect('E1:E3')]), type: 'decimal', op: 'greaterThan', formula1: '0.5', formula2: undefined, showError: false },
        { ...newValidation('v5', [rect('F1')]), type: 'custom', formula1: 'COUNTIF($F:$F,F1)=1', formula2: undefined },
        { ...newValidation('v6', [rect('G1')]), type: 'date', op: 'greaterThanOrEqual', formula1: 'DATE(2024,1,1)', formula2: undefined },
        { ...newValidation('v7', [rect('H1')]), type: 'textLength', op: 'lessThanOrEqual', formula1: '5', formula2: undefined },
      );
    });
    const { workbook } = await roundTrip(w);
    const v = workbook.sheets[0]!.validations;
    expect(v).toHaveLength(7);
    expect(v[0]).toMatchObject({ type: 'whole', op: 'between', formula1: '1', formula2: '10', errorStyle: 'warning', errorTitle: 'Ojo', errorMessage: 'Entre 1 y 10', inputTitle: 'Dato', inputMessage: 'Escribe un número', showInput: true, showError: true, allowBlank: true });
    expect(v[0]!.ranges).toEqual([rect('A1:A5')]);
    expect(v[1]).toMatchObject({ type: 'list', formula1: '"Sí,No,Tal vez"', showDropdown: false, allowBlank: false });
    expect(v[1]!.ranges).toEqual([rect('B1:B2'), rect('B5')]);
    expect(v[2]).toMatchObject({ type: 'list', formula1: '$D$1:$D$2', showDropdown: true });
    expect(v[3]).toMatchObject({ type: 'decimal', op: 'greaterThan', formula1: '0.5', showError: false });
    expect(v[4]).toMatchObject({ type: 'custom', formula1: 'COUNTIF($F:$F,F1)=1' });
    expect(v[5]).toMatchObject({ type: 'date', op: 'greaterThanOrEqual', formula1: 'DATE(2024,1,1)' });
    expect(v[6]).toMatchObject({ type: 'textLength', op: 'lessThanOrEqual', formula1: '5' });
  });

  it('reads a rule from the Excel 2010 extension (list pointing at another sheet)', async () => {
    const { w } = book();
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    const ext =
      '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:dataValidations xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="1">' +
      '<x14:dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"><x14:formula1><xm:f>Otra!$A$1:$A$3</xm:f></x14:formula1><xm:sqref>B2:B9</xm:sqref></x14:dataValidation></x14:dataValidations></ext></extLst>';
    zip.file('xl/worksheets/sheet1.xml', sheet.replace('</worksheet>', `${ext}</worksheet>`));
    const { workbook, warnings } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    const v = workbook.sheets[0]!.validations[0]!;
    expect(v).toMatchObject({ type: 'list', formula1: 'Otra!$A$1:$A$3', allowBlank: true });
    expect(v.ranges).toEqual([rect('B2:B9')]);
    expect(warnings.join(' ')).not.toMatch(/extensiones/);
  });
});

describe('hyperlinks, comments, pictures', () => {
  it('keeps external and internal links with their tooltips', async () => {
    const { w, id } = book({ A1: 'web', A2: 'otra hoja', A3: 'mail' });
    w.addSheet('Resumen');
    w.editObjects(id, (s) => {
      s.hyperlinks.push({ rect: rect('A1'), url: 'https://example.org/a?b=1&c=2', tooltip: 'Abrir' }, { rect: rect('A2'), location: 'Resumen!B3' }, { rect: rect('A3'), url: 'mailto:ana@example.org' });
    });
    const { workbook, bytes } = await roundTrip(w);
    const h = workbook.sheets[0]!.hyperlinks;
    expect(h).toEqual([
      { rect: rect('A1'), url: 'https://example.org/a?b=1&c=2', tooltip: 'Abrir' },
      { rect: rect('A2'), location: 'Resumen!B3' },
      { rect: rect('A3'), url: 'mailto:ana@example.org' },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    const rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string');
    expect(rels).toContain('TargetMode="External"');
  });

  it('keeps notes and writes the drawing Excel needs to show them', async () => {
    const { w, id } = book({ A1: '1' });
    w.editObjects(id, (s) => {
      s.comments.push({ row: 0, col: 0, author: 'Ana', text: 'Revisar & confirmar\nsegunda línea' }, { row: 4, col: 2, author: 'Luis', text: 'otra', visible: true });
    });
    const { workbook, bytes } = await roundTrip(w);
    expect(workbook.sheets[0]!.comments).toEqual([
      { row: 0, col: 0, author: 'Ana', text: 'Revisar & confirmar\nsegunda línea' },
      { row: 4, col: 2, author: 'Luis', text: 'otra' },
    ]);
    const zip = await JSZip.loadAsync(bytes);
    const vml = await zip.file('xl/drawings/vmlDrawing1.vml')!.async('string');
    expect(vml).toContain('<x:Row>4</x:Row>');
    expect(vml).toContain('ObjectType="Note"');
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<legacyDrawing');
  });

  it('turns a conversation of threaded comments into a note with the replies', async () => {
    const { w, id } = book();
    w.editObjects(id, (s) => {
      s.comments.push({ row: 1, col: 1, author: 'Ana', text: '[Comentario encadenado] texto de relleno' });
    });
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    zip.file('xl/threadedComments/threadedComment1.xml', '<?xml version="1.0"?><ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><threadedComment ref="B2" dT="2024-01-01T10:00:00.00" personId="{P1}" id="{C1}"><text>¿Está bien este dato?</text></threadedComment><threadedComment ref="B2" dT="2024-01-01T11:00:00.00" personId="{P2}" id="{C2}" parentId="{C1}"><text>Sí, confirmado</text></threadedComment></ThreadedComments>');
    zip.file('xl/persons/person.xml', '<?xml version="1.0"?><personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Ana" id="{P1}" userId="ana" providerId="None"/><person displayName="Luis" id="{P2}" userId="luis" providerId="None"/></personList>');
    const rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string');
    zip.file('xl/worksheets/_rels/sheet1.xml.rels', rels.replace('</Relationships>', '<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/></Relationships>'));
    const wbRels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    zip.file('xl/_rels/workbook.xml.rels', wbRels.replace('</Relationships>', '<Relationship Id="rId98" Type="http://schemas.microsoft.com/office/2017/10/relationships/person" Target="persons/person.xml"/></Relationships>'));
    const { workbook, warnings } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    expect(workbook.sheets[0]!.comments[0]).toMatchObject({ author: 'Ana', text: '¿Está bien este dato?\n↳ Luis: Sí, confirmado' });
    expect(warnings.join(' ')).toMatch(/encadenados/);
  });

  it('stores a picture once and puts it back where it was', async () => {
    const { w, id } = book();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const key = w.addMedia('image/png', png);
    w.editObjects(id, (s) => {
      s.images.push({ id: 'i1', media: key, x: 40, y: 60, width: 200, height: 100, name: 'Logo', alt: 'Logotipo' }, { id: 'i2', media: key, x: 300, y: 60, width: 100, height: 50 });
    });
    const { workbook, bytes } = await roundTrip(w);
    const imgs = workbook.sheets[0]!.images;
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toMatchObject({ x: 40, y: 60, width: 200, height: 100, name: 'Logo', alt: 'Logotipo' });
    expect(imgs[0]!.media).toBe(imgs[1]!.media);
    expect([...workbook.media.get(imgs[0]!.media)!.data]).toEqual([...png]);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).filter((n) => n.startsWith('xl/media/'))).toEqual(['xl/media/image1.png']);
  });
});

describe('tables', () => {
  it('round-trips a table with totals, calculated column, style and structured references', async () => {
    const { w, id, get } = book({ A1: 'Region', B1: 'Ventas', C1: 'Costo', A2: 'Norte', B2: '10', C2: '4', A3: 'Sur', B3: '20', C3: '5' });
    w.createTable(id, rect('A1:C3'), { id: 't1', name: 'Datos1', style: 'TableStyleLight9' });
    w.setInput(id, 0, 3, 'Margen');
    w.resizeTable(id, 't1', rect('A1:D3'));
    w.setCalculatedColumn(id, 't1', 3, '[@Ventas]-[@Costo]');
    w.setTableTotals(id, 't1', true);
    w.setTableColumnTotal(id, 't1', 1, 'sum');
    w.setInput(id, 6, 0, '=SUM(Datos1[Ventas])+COUNTA(Datos1[#All])');
    const { workbook, bytes } = await roundTrip(w);
    const sheet = workbook.sheets[0]!;
    const t = sheet.tables[0]!;
    expect(t).toMatchObject({ name: 'Datos1', style: 'TableStyleLight9', header: true, totals: true, rowStripes: true });
    expect(t.ref).toEqual(rect('A1:D4'));
    expect(t.columns.map((c) => c.name)).toEqual(['Region', 'Ventas', 'Costo', 'Margen']);
    expect(t.columns[1]!.total).toBe('sum');
    expect(t.columns[3]!.calc).toBe('Datos1[[#This Row],[Ventas]]-Datos1[[#This Row],[Costo]]');
    expect(workbook.getInputText(sheet.id, 1, 3)).toBe('=Datos1[@Ventas]-Datos1[@Costo]');
    expect(workbook.getValue(sheet.id, 1, 3)).toBe(6);
    expect(workbook.getValue(sheet.id, 3, 1)).toBe(30);
    expect(workbook.getValue(sheet.id, 6, 0)).toBe(30 + 14);
    void get;
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/tables/table1.xml')!.async('string');
    expect(xml).toContain('totalsRowCount="1"');
    expect(xml).toContain('totalsRowFunction="sum"');
    expect(xml).toContain('[#This Row]');
    // the cell formulas are stored in the form Excel writes
    const sx = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sx).toContain('Datos1[[#This Row],[Ventas]]');
    expect(sx).toContain('SUBTOTAL(109,Datos1[Ventas])');
  });

  it('keeps the filter of a table', async () => {
    const { w, id } = book({ A1: 'K', B1: 'V', A2: 'x', B2: '1', A3: 'y', B3: '2', A4: 'x', B4: '3' });
    w.createTable(id, rect('A1:B4'), { id: 't1' });
    w.editObjects(id, (s) => {
      s.tables[0]!.filter = { range: rect('A1:B4'), columns: { 0: { values: ['x'] } } };
    });
    w.reapplyFilter(id);
    const { workbook } = await roundTrip(w);
    const t = workbook.sheets[0]!.tables[0]!;
    expect(t.filter?.columns[0]).toEqual({ values: ['x'] });
  });
});

describe('sparklines, print settings and local names', () => {
  it('round-trips sparkline groups', async () => {
    const { w, id } = book({ A1: '1', B1: '3', C1: '2', A2: '4', B2: '1', C2: '5' });
    const g = { ...newSparklineGroup('g1', 'column'), color: '#112233', showHigh: true, showNegative: true, lineWeight: 2, minType: 'custom' as const, min: -5, emptyAs: 'zero' as const, items: [{ row: 0, col: 4, source: 'Datos!A1:C1' }, { row: 1, col: 4, source: 'Datos!A2:C2' }] };
    w.editObjects(id, (s) => {
      s.sparklines.push(g, { ...newSparklineGroup('g2', 'winloss'), items: [{ row: 2, col: 4, source: 'Datos!A1:C1' }] });
    });
    const { workbook } = await roundTrip(w);
    const out = workbook.sheets[0]!.sparklines;
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: 'column', color: '#112233', showHigh: true, showNegative: true, lineWeight: 2, minType: 'custom', min: -5, emptyAs: 'zero' });
    expect(out[0]!.items).toEqual(g.items);
    expect(out[1]!.type).toBe('winloss');
  });

  it('round-trips print areas, titles, breaks, page setup and names local to a sheet', async () => {
    const { w, id } = book({ A1: '1' });
    const s2 = w.addSheet('Otra hoja');
    w.defineName('Tasa', '0.21');
    w.defineName('Tasa', '0.5', id);
    w.defineName('Solo', "'Otra hoja'!$A$1", s2.id);
    w.editObjects(id, (s) => {
      s.print.areas = [rect('A1:C10'), rect('E1:F4')];
      s.print.titleRows = { r1: 0, r2: 1 };
      s.print.titleCols = { c1: 0, c2: 0 };
      s.print.rowBreaks = [4, 9];
      s.print.colBreaks = [2];
      s.print.page = { ...s.print.page, orientation: 'landscape', paper: 'Letter', fitWidth: 1, fitHeight: 0, gridlines: true, centerH: true, header: '&LInforme', footer: '&CPágina &P de &N', margins: { top: 2, right: 1, bottom: 2, left: 1 } };
    });
    const { workbook } = await roundTrip(w);
    const a = workbook.sheets[0]!;
    expect(a.print.areas).toEqual([rect('A1:C10'), rect('E1:F4')]);
    expect(a.print.titleRows).toEqual({ r1: 0, r2: 1 });
    expect(a.print.titleCols).toEqual({ c1: 0, c2: 0 });
    expect(a.print.rowBreaks).toEqual([4, 9]);
    expect(a.print.colBreaks).toEqual([2]);
    expect(a.print.page).toMatchObject({ orientation: 'landscape', paper: 'Letter', fitWidth: 1, fitHeight: 0, gridlines: true, centerH: true, header: '&LInforme', footer: '&CPágina &P de &N' });
    expect(a.print.page.margins.top).toBeCloseTo(2, 1);
    expect(a.print.page.margins.left).toBeCloseTo(1, 1);
    expect(workbook.names.get('tasa')!.text).toBe('0.21');
    expect(a.names.get('tasa')!.text).toBe('0.5');
    expect(workbook.sheets[1]!.names.get('solo')!.text).toBe("'Otra hoja'!$A$1");
  });
});

describe('formulas in files', () => {
  it('keeps 3D references, unions, intersections and @', async () => {
    const { w, id, get } = book({ A1: '1', A2: '2', A3: '3' });
    w.addSheet('Hoja2');
    w.setInput(w.sheets[1]!.id, 0, 0, '5');
    w.setInput(id, 0, 2, '=SUM(Datos:Hoja2!A1)');
    w.setInput(id, 1, 2, '=SUM((A1:A2,A3))');
    w.setInput(id, 2, 2, '=SUM(A1:A3 A2:A3)');
    w.setInput(id, 1, 3, '=@A1:A3');
    const { workbook, bytes } = await roundTrip(w);
    const s = workbook.sheets[0]!;
    expect([0, 1, 2].map((r) => workbook.getInputText(s.id, r, 2))).toEqual(['=SUM(Datos:Hoja2!A1)', '=SUM((A1:A2,A3))', '=SUM(A1:A3 A2:A3)']);
    expect(workbook.getInputText(s.id, 1, 3)).toBe('=@A1:A3');
    expect([0, 1, 2].map((r) => workbook.getValue(s.id, r, 2))).toEqual([6, 6, 5]);
    expect(workbook.getValue(s.id, 1, 3)).toBe(2);
    const zip = await JSZip.loadAsync(bytes);
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('_xlfn.SINGLE(A1:A3)');
    void get;
  });

  it('prefixes LAMBDA, its variables, and the newer functions as Excel does', async () => {
    const { w, id } = book({ A1: '1', A2: '2' });
    w.setInput(id, 0, 2, '=MAP(A1:A2,LAMBDA(x,x*2))');
    w.setInput(id, 3, 2, '=NORM.S.DIST(1,TRUE)+BITAND(5,3)');
    w.defineName('Doble', 'LAMBDA(n,n*2)');
    const { workbook, bytes } = await roundTrip(w);
    const zip = await JSZip.loadAsync(bytes);
    const sx = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sx).toContain('_xlfn.MAP(A1:A2,_xlfn.LAMBDA(_xlpm.x,_xlpm.x*2))');
    expect(sx).toContain('_xlfn.NORM.S.DIST(1,TRUE)+_xlfn.BITAND(5,3)');
    const wbx = await zip.file('xl/workbook.xml')!.async('string');
    expect(wbx).toContain('_xlfn.LAMBDA(_xlpm.n,_xlpm.n*2)');
    const s = workbook.sheets[0]!;
    expect(workbook.getInputText(s.id, 0, 2)).toBe('=MAP(A1:A2,LAMBDA(x,x*2))');
    expect(workbook.getValue(s.id, 1, 2)).toBe(4);
    expect(workbook.names.get('doble')!.text).toBe('LAMBDA(n,n*2)');
  });

  it('keeps a formula with an unknown function as text and shows #NAME?', async () => {
    const { w, id } = book();
    w.setInput(id, 0, 0, '=FUNCIONDESCONOCIDA(1,2)+1');
    const { workbook } = await roundTrip(w);
    expect(workbook.getInputText(workbook.sheets[0]!.id, 0, 0)).toBe('=FUNCIONDESCONOCIDA(1,2)+1');
    expect(String(workbook.getValue(workbook.sheets[0]!.id, 0, 0))).toBe('#NAME?');
  });
});

describe('shapes and text boxes', () => {
  const shapes = () => [
    { id: 's1', kind: 'rect', x: 40, y: 30, width: 120, height: 60, fill: '#ff0000', line: { color: '#00ff00', width: 2.5 }, text: 'Hola\nmundo', textColor: '#ffffff', fontSize: 14, bold: true, italic: true, hAlign: 'right', vAlign: 'top', name: 'Caja', alt: 'Una caja' },
    { id: 's2', kind: 'ellipse', x: 200, y: 30, width: 80, height: 80, fill: null, line: null },
    { id: 's3', kind: 'textBox', x: 40, y: 150, width: 200, height: 40, text: 'Nota & <importante>' },
    { id: 's4', kind: 'rightArrow', x: 300, y: 150, width: 90, height: 50 },
    { id: 's5', kind: 'line', x: 40, y: 220, width: 150, height: 40, line: { color: '#123456', width: 3 }, flip: true },
    { id: 's6', kind: 'roundRect', x: 220, y: 220, width: 90, height: 50, text: 'ok' },
  ];

  it('round-trips every kind with its fill, outline, text and position', async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.editObjects(id, (s) => void s.shapes.push(...(shapes() as never[])));
    const r = await roundTrip(w);
    const back = r.workbook.sheets[0]!.shapes;
    expect(back).toHaveLength(6);
    const by = (k: string) => back.find((x) => x.kind === k)!;
    expect(by('rect')).toMatchObject({ fill: '#ff0000', line: { color: '#00ff00', width: 2.5 }, text: 'Hola\nmundo', textColor: '#ffffff', fontSize: 14, bold: true, italic: true, hAlign: 'right', vAlign: 'top', name: 'Caja', alt: 'Una caja' });
    expect(by('ellipse')).toMatchObject({ fill: null, line: null });
    expect(by('textBox').text).toBe('Nota & <importante>');
    expect(by('line')).toMatchObject({ flip: true, line: { color: '#123456', width: 3 } });
    expect(by('rightArrow').kind).toBe('rightArrow');
    // posición y tamaño dentro de un píxel
    for (const o of shapes()) {
      const b = back.find((x) => x.kind === o.kind)!;
      expect(Math.abs(b.x - o.x), o.kind).toBeLessThan(2);
      expect(Math.abs(b.y - o.y), o.kind).toBeLessThan(2);
      expect(Math.abs(b.width - o.width), o.kind).toBeLessThan(2);
      expect(Math.abs(b.height - o.height), o.kind).toBeLessThan(2);
    }
    const xml = await JSZip.loadAsync(r.bytes).then((z) => z.file('xl/drawings/drawing1.xml')!.async('string'));
    expect(xml).toContain('<xdr:cxnSp');
    expect(xml).toContain('txBox="1"');
    expect(xml).toContain('prst="roundRect"');
    expect(r.warnings).toEqual([]);
  });

  it('reads a shape the way Excel writes it (theme style, no explicit fill) and warns about presets it cannot draw', async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.editObjects(id, (s) => void s.shapes.push({ id: 'a', kind: 'rect', x: 10, y: 10, width: 50, height: 50 } as never));
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const path = 'xl/drawings/drawing1.xml';
    let xml = await zip.file(path)!.async('string');
    // sin relleno ni línea propios + estilo del tema, como los inserta Excel; y una geometría que no existe
    xml = xml.replace(/<xdr:spPr>.*?<\/xdr:spPr>/s, '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="476250" cy="476250"/></a:xfrm><a:prstGeom prst="noSuchShape"><a:avLst/></a:prstGeom></xdr:spPr><xdr:style/>').replace('<xdr:cNvSpPr/>', '<xdr:cNvSpPr/>');
    zip.file(path, xml);
    const { workbook, warnings } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    const s = workbook.sheets[0]!.shapes[0]!;
    expect(s.kind).toBe('rect');
    expect(s.fill).toBe('#4472c4');
    expect(warnings.join(' ')).toMatch(/geometría/);
  });

  it('keeps any DrawingML preset by its name (stars, callouts, flow chart…) and writes it back', async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.editObjects(id, (sh) => void sh.shapes.push({ id: 'a', kind: 'star5', x: 10, y: 10, width: 80, height: 80 } as never, { id: 'b', kind: 'wedgeRectCallout', x: 120, y: 10, width: 100, height: 60 } as never, { id: 'c', kind: 'bentConnector3', x: 10, y: 120, width: 100, height: 40 } as never));
    const r = await readXlsx(await writeXlsx(w));
    expect(r.workbook.sheets[0]!.shapes.map((x) => x.kind)).toEqual(['star5', 'wedgeRectCallout', 'bentConnector3']);
    expect(r.warnings.join(' ')).not.toMatch(/geometría/);
  });

  it('writes and reads groups of shapes (xdr:grpSp) with the children where they were', async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.editObjects(id, (sh) => void sh.shapes.push(
      { id: 'a', kind: 'rect', x: 20, y: 30, width: 100, height: 60, group: 'g1' } as never,
      { id: 'solo', kind: 'ellipse', x: 300, y: 30, width: 50, height: 50 } as never,
      { id: 'b', kind: 'star5', x: 160, y: 90, width: 80, height: 80, rotation: 30, group: 'g1' } as never,
      { id: 'alone', kind: 'rect', x: 10, y: 200, width: 40, height: 40, group: 'g2' } as never,
    ));
    const bytes = await writeXlsx(w);
    const r = await readXlsx(bytes);
    const shapes = r.workbook.sheets[0]!.shapes;
    expect(shapes).toHaveLength(4);
    const grouped = shapes.filter((x) => x.group);
    expect(grouped.map((x) => x.kind).sort()).toEqual(['rect', 'star5']);
    expect(new Set(grouped.map((x) => x.group)).size).toBe(1);
    const rect = shapes.find((x) => x.kind === 'rect' && x.group)!;
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([20, 30, 100, 60]);
    const star = shapes.find((x) => x.kind === 'star5')!;
    expect([star.x, star.y, star.width, star.height, star.rotation]).toEqual([160, 90, 80, 80, 30]);
    // la forma suelta y la de un grupo de uno solo salen sin grupo
    expect(shapes.filter((x) => !x.group)).toHaveLength(2);
  });

  it('writes and reads the rotation of a shape', async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.editObjects(id, (sh) => void sh.shapes.push({ id: 'a', kind: 'rect', x: 10, y: 10, width: 100, height: 60, rotation: 45 } as never, { id: 'b', kind: 'rect', x: 10, y: 90, width: 100, height: 60 } as never));
    const r = await readXlsx(await writeXlsx(w));
    const [a, b] = r.workbook.sheets[0]!.shapes;
    expect(a!.rotation).toBe(45);
    expect(b!.rotation).toBeUndefined();
  });

  it('writes and reads the adjust values of a shape (the yellow handles)', async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    w.editObjects(id, (sh) => void sh.shapes.push({ id: 'a', kind: 'roundRect', x: 10, y: 10, width: 100, height: 60, adj: { adj: 40000 } } as never, { id: 'b', kind: 'roundRect', x: 10, y: 90, width: 100, height: 60 } as never));
    const bytes = await writeXlsx(w);
    const r = await readXlsx(bytes);
    const [a, b] = r.workbook.sheets[0]!.shapes;
    expect(a!.adj).toEqual({ adj: 40000 });
    expect(b!.adj).toBeUndefined();
  });
});

describe('charts', () => {
  const sample = () => {
    const { w, id } = book({ A1: 'Mes', B1: 'Ventas', C1: 'Margen', D1: 'Precio', A2: 'Ene', B2: '10', C2: '0.1', D2: '5', A3: 'Feb', B3: '20', C3: '0.3', D3: '6', A4: 'Mar', B4: '15', C4: '0.2', D4: '7' });
    return { w, id };
  };
  const base: Omit<ChartDef, 'type' | 'series'> = { id: 'c1', legend: true, x: 100, y: 100, width: 400, height: 250 };
  const ser = (col: string, extra: object = {}) => ({ nameRef: `Datos!$${col}$1`, categories: 'Datos!$A$2:$A$4', values: `Datos!$${col}$2:$${col}$4`, ...extra });
  const through = async (def: ChartDef) => {
    const { w, id } = sample();
    w.editCharts(id, (c) => c.push(def));
    const r = await roundTrip(w);
    return { chart: r.workbook.sheets[0]!.charts[0]!, bytes: r.bytes, warnings: r.warnings };
  };

  it('Excel 2016 charts (waterfall, funnel, histogram, box and whisker) go through chartex parts', async () => {
    const cases: ChartDef[] = [
      { ...base, type: 'waterfall', title: 'Puente', legend: true, waterfall: { totals: [0, 2], connectors: true }, series: [ser('B')] },
      { ...base, type: 'funnel', legend: false, series: [ser('B')] },
      { ...base, type: 'histogram', legend: false, histogram: { binWidth: 5, underflow: 10, overflow: 20, closed: 'left' }, series: [{ values: 'Datos!$B$2:$B$4' }] },
      { ...base, type: 'histogram', legend: false, histogram: { binCount: 4 }, series: [{ values: 'Datos!$B$2:$B$4' }] },
      { ...base, type: 'boxwhisker', legend: false, boxwhisker: { inclusive: true, mean: false, outliers: false, inner: true }, series: [ser('B')] },
    ];
    for (const def of cases) {
      const { chart, bytes } = await through(def);
      expect(chart.type, def.type).toBe(def.type);
      expect(chart.series[0]!.values).toBe(def.series[0]!.values);
      if (def.waterfall) expect(chart.waterfall).toEqual(def.waterfall);
      if (def.histogram) expect(chart.histogram).toEqual(def.histogram);
      if (def.boxwhisker) expect(chart.boxwhisker).toEqual(def.boxwhisker);
      if (def.title) expect(chart.title).toBe(def.title);
      const zip = await JSZip.loadAsync(bytes);
      const names = Object.keys(zip.files);
      expect(names.some((n) => /^xl\/charts\/chartEx\d+\.xml$/.test(n)), def.type).toBe(true);
      expect(names.some((n) => /^xl\/charts\/chart\d+\.xml$/.test(n))).toBe(false);
      const drawing = await zip.file('xl/drawings/drawing1.xml')!.async('string');
      expect(drawing).toContain('<mc:AlternateContent');
      expect(drawing).toContain('Requires="cx1"');
      const ct = await zip.file('[Content_Types].xml')!.async('string');
      expect(ct).toContain('application/vnd.ms-office.chartex+xml');
      const rels = await zip.file('xl/drawings/_rels/drawing1.xml.rels')!.async('string');
      expect(rels).toContain('http://schemas.microsoft.com/office/2014/relationships/chartEx');
    }
    const { bytes } = await through(cases[0]!);
    const ex = await JSZip.loadAsync(bytes).then((z) => z.file('xl/charts/chartEx1.xml')!.async('string'));
    expect(ex).toContain('<cx:series layoutId="waterfall"');
    expect(ex).toContain('<cx:subtotals><cx:idx val="0"/><cx:idx val="2"/></cx:subtotals>');
    expect(ex.indexOf('<cx:chartData>')).toBeLessThan(ex.indexOf('<cx:chart>'));
    const hist = await through(cases[2]!).then((r) => JSZip.loadAsync(r.bytes)).then((z) => z.file('xl/charts/chartEx1.xml')!.async('string'));
    expect(hist).toContain('layoutId="clusteredColumn"');
    expect(hist).toContain('<cx:binning intervalClosed="l" underflow="10" overflow="20"><cx:binSize val="5"/></cx:binning>');
  });

  it('trendlines and error bars: written in the schema order and read back', async () => {
    const def: ChartDef = {
      ...base,
      type: 'column',
      series: [
        ser('B', {
          trendlines: [{ type: 'poly', order: 3, forward: 2, dispEq: true, dispR2: true, color: '#ff0000', name: 'Mi curva' }, { type: 'movingAvg', period: 3 }],
          errY: { kind: 'percent', value: 8, direction: 'plus', noCap: true },
        }),
        ser('C', { errY: { kind: 'custom', plus: 'Datos!$D$2:$D$4', minus: '1,2,3', direction: 'both' } }),
      ],
    };
    const { chart, bytes } = await through(def);
    const s0 = chart.series[0]!;
    expect(s0.trendlines).toEqual([
      { type: 'poly', order: 3, forward: 2, dispEq: true, dispR2: true, color: '#ff0000', name: 'Mi curva' },
      { type: 'movingAvg', period: 3 },
    ]);
    expect(s0.errY).toEqual({ kind: 'percent', value: 8, direction: 'plus', noCap: true });
    expect(chart.series[1]!.errY).toMatchObject({ kind: 'custom', direction: 'both', plus: 'Datos!$D$2:$D$4', minus: '1,2,3' });
    const xml = await JSZip.loadAsync(bytes).then((z) => z.file('xl/charts/chart1.xml')!.async('string'));
    // el esquema pide: ... dLbls, trendline*, errBars, cat, val
    const ser0 = /<c:ser>.*?<\/c:ser>/s.exec(xml)![0];
    expect(ser0.indexOf('<c:trendline>')).toBeLessThan(ser0.indexOf('<c:errBars>'));
    expect(ser0.indexOf('<c:errBars>')).toBeLessThan(ser0.indexOf('<c:cat>'));
    expect(ser0).toContain('<c:trendlineType val="poly"/><c:order val="3"/>');
    expect(ser0).toContain('<c:errValType val="percentage"/>');
    expect(ser0).not.toContain('<c:errDir');
  });

  it('scatter charts keep X and Y error bars; stacked charts drop the analysis', async () => {
    const { chart, bytes } = await through({
      ...base,
      type: 'scatter',
      series: [{ categories: 'Datos!$B$2:$B$4', values: 'Datos!$D$2:$D$4', errX: { kind: 'fixed', value: 2, direction: 'both' }, errY: { kind: 'stderr', direction: 'minus' }, trendlines: [{ type: 'linear', intercept: 0 }] }],
    });
    const s = chart.series[0]!;
    expect(s.errX).toMatchObject({ kind: 'fixed', value: 2 });
    expect(s.errY).toMatchObject({ kind: 'stderr', direction: 'minus' });
    expect(s.trendlines).toEqual([{ type: 'linear', intercept: 0 }]);
    const xml = await JSZip.loadAsync(bytes).then((z) => z.file('xl/charts/chart1.xml')!.async('string'));
    expect(xml).toContain('<c:errDir val="x"/>');
    expect(xml).toContain('<c:errDir val="y"/>');
    const stacked = await through({ ...base, type: 'column', stacked: true, series: [ser('B', { trendlines: [{ type: 'linear' }] })] });
    expect(stacked.chart.series[0]!.trendlines).toBeUndefined();
  });

  it('combined column and line on a secondary axis, with axis titles, limits and a log scale', async () => {
    const def: ChartDef = {
      ...base,
      type: 'column',
      title: 'Ventas y margen',
      series: [ser('B', { color: '#3366cc' }), ser('C', { type: 'line', secondary: true, color: '#cc3333' })],
      axisX: { title: 'Mes' },
      axisY: { title: 'Ventas', min: 0, max: 50 },
      axisY2: { title: 'Margen', min: 0, max: 1, format: '0%' },
    };
    const { chart, bytes } = await through(def);
    expect(chart.type).toBe('column');
    expect(chart.series).toHaveLength(2);
    expect(chart.series[0]).toMatchObject({ type: 'column', color: '#3366cc' });
    expect(chart.series[1]).toMatchObject({ type: 'line', secondary: true, color: '#cc3333' });
    expect(chart.axisX?.title).toBe('Mes');
    expect(chart.axisY).toMatchObject({ title: 'Ventas', min: 0, max: 50 });
    expect(chart.axisY2).toMatchObject({ title: 'Margen', min: 0, max: 1, format: '0%' });
    const xml = await JSZip.loadAsync(bytes).then((z) => z.file('xl/charts/chart1.xml')!.async('string'));
    expect(xml).toContain('<c:barChart>');
    expect(xml).toContain('<c:lineChart>');
    expect(xml.match(/<c:valAx>/g)).toHaveLength(2);
  });

  it('log scale and reversed axes', async () => {
    const { chart } = await through({ ...base, type: 'line', series: [ser('B')], axisY: { log: true, reverse: false } });
    expect(chart.axisY?.log).toBe(true);
  });

  it('percent stacked columns', async () => {
    const { chart } = await through({ ...base, type: 'column', stacked: true, percent: true, series: [ser('B'), ser('D')] });
    expect(chart).toMatchObject({ type: 'column', stacked: true, percent: true });
  });

  it('radar (plain, with markers, filled)', async () => {
    for (const radar of [{}, { markers: true }, { filled: true }]) {
      const { chart } = await through({ ...base, type: 'radar', series: [ser('B'), ser('D')], radar });
      expect(chart.type).toBe('radar');
      expect(!!chart.radar?.filled).toBe(!!(radar as { filled?: boolean }).filled);
      expect(!!chart.radar?.markers).toBe(!!(radar as { markers?: boolean }).markers);
      expect(chart.series).toHaveLength(2);
    }
  });

  it('stock charts in every flavour', async () => {
    const mk = async (kind: 'hlc' | 'ohlc' | 'vhlc' | 'vohlc', n: number) => {
      const cols = ['B', 'C', 'D', 'B', 'C'].slice(0, n);
      return through({ ...base, type: 'stock', stock: { kind }, series: cols.map((c) => ser(c)) });
    };
    for (const [kind, n] of [['hlc', 3], ['ohlc', 4], ['vhlc', 4], ['vohlc', 5]] as const) {
      const { chart, bytes } = await mk(kind, n);
      expect(chart.type, kind).toBe('stock');
      expect(chart.stock?.kind, kind).toBe(kind);
      expect(chart.series, kind).toHaveLength(n);
      const xml = await JSZip.loadAsync(bytes).then((z) => z.file('xl/charts/chart1.xml')!.async('string'));
      expect(xml.includes('<c:stockChart>'), kind).toBe(true);
      expect(xml.includes('<c:upDownBars>'), kind).toBe(kind === 'ohlc' || kind === 'vohlc');
      expect(xml.includes('<c:barChart>'), kind).toBe(kind === 'vhlc' || kind === 'vohlc');
    }
  });

  it('surface charts: 3-D, wireframe and contour', async () => {
    const d3 = { ...DEFAULT_3D, rotX: 30, rotY: 40, perspective: 20, rightAngle: false, depth: 80 };
    const a = await through({ ...base, type: 'surface', threeD: d3, surface: {}, series: [ser('B'), ser('C'), ser('D')] });
    expect(a.chart.type).toBe('surface');
    expect(a.chart.threeD).toMatchObject({ rotX: 30, rotY: 40, depth: 80, rightAngle: false });
    expect(a.chart.surface?.wireframe).toBeFalsy();
    const b = await through({ ...base, type: 'surface', threeD: d3, surface: { wireframe: true }, series: [ser('B'), ser('C')] });
    expect(b.chart.surface?.wireframe).toBe(true);
    const c = await through({ ...base, type: 'surface', threeD: d3, surface: { contour: true }, series: [ser('B'), ser('C')] });
    expect(c.chart.surface?.contour).toBe(true);
    const xml = await JSZip.loadAsync(a.bytes).then((z) => z.file('xl/charts/chart1.xml')!.async('string'));
    expect(xml).toContain('<c:surface3DChart>');
    expect(xml).toContain('<c:serAx>');
  });

  it('3-D column, line, area and pie', async () => {
    const d3 = { ...DEFAULT_3D, rotX: 20, rotY: 30, depth: 150, rightAngle: true };
    for (const type of ['column', 'bar', 'line', 'area'] as const) {
      const { chart } = await through({ ...base, type, threeD: d3, series: [ser('B'), ser('D')] });
      expect(chart.type).toBe(type);
      expect(chart.threeD).toMatchObject({ rotX: 20, rotY: 30, depth: 150, rightAngle: true });
    }
    const pie = await through({ ...base, type: 'pie', threeD: d3, series: [ser('B')] });
    expect(pie.chart.type).toBe('pie');
    expect(pie.chart.threeD).toBeTruthy();
    const deep = await through({ ...base, type: 'column', threeD: { ...d3, seriesDepth: true }, series: [ser('B'), ser('D')] });
    expect(deep.chart.threeD?.seriesDepth).toBe(true);
  });

  it('doughnut and the old types still work', async () => {
    expect((await through({ ...base, type: 'doughnut', series: [ser('B')] })).chart.type).toBe('doughnut');
    expect((await through({ ...base, type: 'scatter', series: [{ values: 'Datos!$B$2:$B$4', categories: 'Datos!$D$2:$D$4' }] })).chart.type).toBe('scatter');
  });

  it('combines a column with a scatter series and an area with a line', async () => {
    const a = await through({ ...base, type: 'area', series: [ser('B'), ser('D', { type: 'line' })] });
    expect(a.chart.series.map((s) => s.type)).toEqual(['area', 'line']);
  });

  it('reads a chart from a hand-written Excel-style part with scheme colours and a secondary axis', async () => {
    const { w, id } = sample();
    w.editCharts(id, (c) => c.push({ ...base, type: 'column', series: [ser('B')] }));
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const xml =
      '<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>' +
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Datos!$B$1</c:f></c:strRef></c:tx><c:spPr><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></c:spPr><c:cat><c:strRef><c:f>Datos!$A$2:$A$4</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Datos!$B$2:$B$4</c:f></c:numRef></c:val></c:ser><c:axId val="10"/><c:axId val="20"/></c:barChart>' +
      '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:strRef><c:f>Datos!$C$1</c:f></c:strRef></c:tx><c:cat><c:strRef><c:f>Datos!$A$2:$A$4</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Datos!$C$2:$C$4</c:f></c:numRef></c:val><c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="30"/><c:axId val="40"/></c:lineChart>' +
      '<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="20"/></c:catAx><c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="10"/></c:valAx>' +
      '<c:catAx><c:axId val="30"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:crossAx val="40"/></c:catAx><c:valAx><c:axId val="40"/><c:scaling><c:orientation val="minMax"/><c:max val="1"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="r"/><c:crossAx val="30"/><c:crosses val="max"/></c:valAx>' +
      '</c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>';
    zip.file('xl/charts/chart1.xml', xml);
    const { workbook } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    const c = workbook.sheets[0]!.charts[0]!;
    expect(c.series[0]).toMatchObject({ type: 'column', color: '#ed7d31' });
    expect(c.series[1]).toMatchObject({ type: 'line', secondary: true });
    expect(c.axisY2).toMatchObject({ min: 0, max: 1 });
    expect(c.legend).toBe(true);
  });
});

describe('the suite\'s own data', () => {
  it('stores and returns the custom part', async () => {
    const { w } = book({ A1: '1' });
    const payload = JSON.stringify({ macros: [{ name: 'Modulo1', code: 'Sub A()\n  x = "]]>"\nEnd Sub' }] });
    const { custom } = await roundTrip(w, payload);
    expect(custom).toBe(payload);
    const none = await readXlsx(await writeXlsx(w));
    expect(none.custom).toBeUndefined();
  });
});

void XMLParser;

describe('pivot tables, slicers and macros travel in the suite part', () => {
  it('come back with every option, and the pivot output is plain values for other programs', async () => {
    const { w, id } = book({ A1: 'Region', B1: 'Ventas', A2: 'Norte', B2: '10', A3: 'Sur', B3: '20', A4: 'Norte', B4: '5' });
    const out = w.addSheet('TD');
    w.addPivot(out.id, { ...newPivot('p1', 'MiTabla', { sheet: 'Datos', ref: 'A1:B4' }, 1, 1), rows: ['Region'], values: [{ field: 'Ventas', agg: 'sum', name: 'Total ventas' }], layout: 'tabular', sort: { Region: 'desc' } });
    w.editObjects(out.id, (s) => {
      s.slicers.push({ id: 's1', name: 'Segmentación1', caption: 'Region', target: { kind: 'pivot', id: 'p1' }, field: 'Region', selected: null, x: 300, y: 20, width: 150, height: 180, columns: 1 });
    });
    w.macros = [{ name: 'Modulo1', code: 'Sub Hola()\n  MsgBox "hola"\nEnd Sub' }];
    void id;
    const { workbook, bytes } = await roundTrip(w);
    const sheet = workbook.sheets[1]!;
    expect(sheet.pivots).toHaveLength(1);
    expect(sheet.pivots[0]).toMatchObject({ name: 'MiTabla', layout: 'tabular', sort: { Region: 'desc' }, values: [{ field: 'Ventas', agg: 'sum', name: 'Total ventas' }], size: { rows: 4, cols: 2 } });
    expect(sheet.slicers[0]).toMatchObject({ name: 'Segmentación1', x: 300, width: 150 });
    expect(workbook.macros).toEqual([{ name: 'Modulo1', code: 'Sub Hola()\n  MsgBox "hola"\nEnd Sub' }]);
    // the cells of the output are in the sheet as values
    expect(workbook.getValue(sheet.id, 2, 1)).toBe('Sur');
    expect(workbook.getValue(sheet.id, 2, 2)).toBe(20);
    expect(workbook.pivotAt(sheet.id, 2, 1)?.name).toBe('MiTabla');
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).some((n) => /pivot/i.test(n))).toBe(false);
  });
});
