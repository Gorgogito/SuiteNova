import { E, Workbook, parseA1, type Scalar } from '@suitenova/calc-engine';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readXlsx, stripXlfn, toFileFormula, writeXlsx } from './index';

const at = (w: Workbook, sheet: number, a: string) => {
  const p = parseA1(a)!;
  return w.getValue(w.sheets[sheet]!.id, p.row, p.col);
};
const set = (w: Workbook, a: string, t: string, sheet = 0) => {
  const p = parseA1(a)!;
  w.setInput(w.sheets[sheet]!.id, p.row, p.col, t);
};

async function roundTrip(w: Workbook): Promise<Workbook> {
  const bytes = await writeXlsx(w);
  const { workbook } = await readXlsx(bytes);
  return workbook;
}

describe('formula prefixes', () => {
  it('adds and strips _xlfn prefixes', () => {
    expect(toFileFormula('XLOOKUP(A1,B:B,C:C)+SUM(1)')).toBe('_xlfn.XLOOKUP(A1,B:B,C:C)+SUM(1)');
    expect(toFileFormula('FILTER(A1:A9,A1:A9>1)')).toBe('_xlfn._xlws.FILTER(A1:A9,A1:A9>1)');
    expect(toFileFormula('LET(x,1,x+1)')).toBe('_xlfn.LET(_xlpm.x,1,_xlpm.x+1)');
    expect(stripXlfn('_xlfn.LET(_xlpm.x,1,_xlpm.x+_xlfn._xlws.SORT(A1))')).toBe('LET(x,1,x+SORT(A1))');
  });
});

describe('round trip', () => {
  it('keeps values, formulas and types', async () => {
    const w = new Workbook();
    set(w, 'A1', 'hello');
    set(w, 'A2', '42.5');
    set(w, 'A3', 'TRUE');
    set(w, 'A4', '#N/A');
    set(w, 'A5', '2024-01-31');
    set(w, 'B1', '=A2*2');
    set(w, 'B2', '=A1&" world"');
    set(w, 'B3', '=1/0');
    set(w, 'B4', '=IFS(A2>40,"big",TRUE,"small")');
    set(w, 'C1', '=XLOOKUP("x",D1:D2,E1:E2,"none")');
    const r = await roundTrip(w);
    expect(at(r, 0, 'A1')).toBe('hello');
    expect(at(r, 0, 'A2')).toBe(42.5);
    expect(at(r, 0, 'A3')).toBe(true);
    expect(at(r, 0, 'A4')).toBe(E.NA);
    expect(at(r, 0, 'A5')).toBe(45322);
    expect(r.getStyle(r.sheets[0]!.id, 4, 0).numFmt).toBe('yyyy-mm-dd');
    expect(r.getInputText(r.sheets[0]!.id, 0, 1)).toBe('=A2*2');
    expect(at(r, 0, 'B1')).toBe(85);
    expect(at(r, 0, 'B2')).toBe('hello world');
    expect(at(r, 0, 'B3')).toBe(E.DIV0);
    expect(at(r, 0, 'B4')).toBe('big');
    expect(r.getInputText(r.sheets[0]!.id, 0, 2)).toBe('=XLOOKUP("x",D1:D2,E1:E2,"none")');
    // and the reloaded book is live
    set(r, 'A2', '1');
    expect(at(r, 0, 'B1')).toBe(2);
  });

  it('keeps several sheets, cross-sheet formulas, and names', async () => {
    const w = new Workbook();
    w.renameSheet(w.sheets[0]!.id, 'Resumen');
    const s2 = w.addSheet('Datos de ventas');
    w.setInput(s2.id, 0, 0, '10');
    w.setInput(s2.id, 1, 0, '20');
    set(w, 'A1', "=SUM('Datos de ventas'!A1:A2)");
    w.defineName('Total', "='Datos de ventas'!$A$1");
    set(w, 'A2', '=Total*3');
    const r = await roundTrip(w);
    expect(r.sheets.map((s) => s.name)).toEqual(['Resumen', 'Datos de ventas']);
    expect(at(r, 0, 'A1')).toBe(30);
    expect(at(r, 0, 'A2')).toBe(30);
    r.setInput(r.sheets[1]!.id, 0, 0, '1');
    expect(at(r, 0, 'A1')).toBe(21);
    expect(at(r, 0, 'A2')).toBe(3);
  });

  it('keeps styles, merges, widths, heights, freeze panes', async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    set(w, 'A1', 'Title');
    set(w, 'B2', '1234.5');
    w.formatRange(id, { r1: 0, c1: 0, r2: 0, c2: 3 }, { bold: true, color: '#ff0000', bg: '#ffff00', hAlign: 'center', fontSize: 14, fontName: 'Arial' });
    w.formatRange(id, { r1: 1, c1: 1, r2: 1, c2: 1 }, { numFmt: '#,##0.00', italic: true, wrap: true, top: { style: 'thin', color: '#000000' }, bottom: { style: 'double' } });
    w.editLayout(id, (s) => {
      s.merges.push({ r1: 0, c1: 0, r2: 0, c2: 3 });
      s.colWidths.set(0, 120);
      s.colWidths.set(1, 120);
      s.rowHeights.set(0, 40);
      s.hiddenCols.add(5);
      s.hiddenRows.add(3);
      s.freeze = { rows: 1, cols: 1 };
      s.showGrid = false;
      s.tabColor = '#00aa00';
    });
    const r = await roundTrip(w);
    const rid = r.sheets[0]!.id;
    const a1 = r.getStyle(rid, 0, 0);
    expect(a1).toMatchObject({ bold: true, color: '#ff0000', bg: '#ffff00', hAlign: 'center', fontSize: 14, fontName: 'Arial' });
    const b2 = r.getStyle(rid, 1, 1);
    expect(b2).toMatchObject({ numFmt: '#,##0.00', italic: true, wrap: true });
    expect(b2.top?.style).toBe('thin');
    expect(b2.bottom?.style).toBe('double');
    const s = r.sheets[0]!;
    expect(s.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 3 }]);
    expect(s.colWidths.get(0)).toBe(120);
    expect(s.colWidths.get(1)).toBe(120);
    expect(s.rowHeights.get(0)).toBe(40);
    expect(s.hiddenCols.has(5)).toBe(true);
    expect(s.hiddenRows.has(3)).toBe(true);
    expect(s.freeze).toEqual({ rows: 1, cols: 1 });
    expect(s.showGrid).toBe(false);
    expect(s.tabColor).toBe('#00aa00');
  });

  it('round-trips dynamic arrays', async () => {
    const w = new Workbook();
    set(w, 'A1', '=SEQUENCE(3)');
    set(w, 'C1', '=SUM(A1:A3)');
    const bytes = await writeXlsx(w);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(xml).toContain('<f t="array" ref="A1:A3">_xlfn.SEQUENCE(3)</f>');
    expect(xml).toContain('cm="1"');
    expect(zip.file('xl/metadata.xml')).not.toBeNull();
    const { workbook: r } = await readXlsx(bytes);
    expect(at(r, 0, 'A3')).toBe(3);
    expect(r.spillExtent(r.sheets[0]!.id, 0, 0)).toEqual({ rows: 3, cols: 1 });
    r.recalcAll();
    expect(at(r, 0, 'C1')).toBe(6);
    set(r, 'A1', '=SEQUENCE(2)');
    expect(at(r, 0, 'A3')).toBe(null);
    expect(at(r, 0, 'C1')).toBe(3);
  });

  it('survives special characters and large sheets', async () => {
    const w = new Workbook();
    set(w, 'A1', 'a & b < c > "d" éñ \u{1F600}');
    set(w, 'A2', '  padded  ');
    const id = w.sheets[0]!.id;
    w.transact(() => {
      for (let r = 2; r < 5000; r++) {
        w.setValue(id, r, 0, r);
        w.setInput(id, r, 1, `=A${r + 1}*2`);
      }
    });
    const r = await roundTrip(w);
    expect(at(r, 0, 'A1')).toBe('a & b < c > "d" éñ \u{1F600}');
    expect(at(r, 0, 'A2')).toBe('  padded  ');
    expect(at(r, 0, 'B5000')).toBe(9998);
  });
});

/** Build a minimal file the way Excel writes it (shared strings, shared formulas, theme colours, styles). */
async function excelStyleFile(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="0"/><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/><sheet name="Otra" sheetId="2" state="hidden" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Ventas!$A$1:$C$5</definedName><definedName name="Tasa">Ventas!$C$1</definedName></definedNames></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="x/styles" Target="styles.xml"/><Relationship Id="rId4" Type="x/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId5" Type="x/theme" Target="theme/theme1.xml"/></Relationships>',
  );
  zip.file(
    'xl/theme/theme1.xml',
    '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="x"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme></a:themeElements></a:theme>',
  );
  zip.file(
    'xl/sharedStrings.xml',
    '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3"><si><t>Producto</t></si><si><r><t>Rich </t></r><r><rPr><b/></rPr><t xml:space="preserve">text</t></r></si><si><t>Total</t></si></sst>',
  );
  zip.file(
    'xl/styles.xml',
    '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0&quot; kg&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/></font><font><b/><sz val="11"/><color theme="4"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor theme="5" tint="0.79998"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>',
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="20.7109375" customWidth="1"/></cols><sheetData>' +
      '<row r="1"><c r="A1" t="s" s="2"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" s="4"><v>0.07</v></c></row>' +
      '<row r="2" ht="30" customHeight="1"><c r="A2" s="1"><v>2.5</v></c><c r="B2"><f t="shared" ref="B2:B4" si="0">A2*Tasa</f><v>0.175</v></c><c r="D2" s="3"><v>45322</v></c></row>' +
      '<row r="3"><c r="A3"><v>4</v></c><c r="B3"><f t="shared" si="0"/><v>0.28</v></c><c r="E3" t="b"><v>1</v></c><c r="F3" t="e"><v>#DIV/0!</v></c></row>' +
      '<row r="4"><c r="A4"><v>8</v></c><c r="B4"><f t="shared" si="0"/><v>0.56</v></c><c r="C4" t="str"><f>_xlfn.CONCAT("a","b")</f><v>ab</v></c><c r="D4"><f>_xlfn.IFS(A4&gt;5,"x",TRUE,"y")</f><v>x</v></c></row>' +
      '<row r="5"><c r="A5" t="s"><v>2</v></c><c r="B5"><f>SUM(B2:B4)</f><v>1.015</v></c><c r="G5" t="inlineStr"><is><t>inline</t></is></c></row>' +
      '</sheetData><mergeCells count="1"><mergeCell ref="A6:C6"/></mergeCells><conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>TRUE</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="A2"><cfRule type="timePeriod" priority="2" timePeriod="today"/></conditionalFormatting></worksheet>',
  );
  zip.file('xl/worksheets/sheet2.xml', '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array' });
}

describe('reading Excel-style files', () => {
  it('reads shared strings, shared formulas, themes, styles, names', async () => {
    const { workbook: w, warnings } = await readXlsx(await excelStyleFile());
    expect(w.sheets.map((s) => s.name)).toEqual(['Ventas', 'Otra']);
    expect(at(w, 0, 'A1')).toBe('Producto');
    expect(at(w, 0, 'B1')).toBe('Rich text');
    expect(at(w, 0, 'A5')).toBe('Total');
    expect(at(w, 0, 'G5')).toBe('inline');
    expect(at(w, 0, 'E3')).toBe(true);
    expect(at(w, 0, 'F3')).toBe(E.DIV0);
    const id = w.sheets[0]!.id;
    expect(w.getInputText(id, 1, 1)).toBe('=A2*Tasa');
    expect(w.getInputText(id, 2, 1)).toBe('=A3*Tasa');
    expect(w.getInputText(id, 3, 1)).toBe('=A4*Tasa');
    expect(w.getInputText(id, 3, 2)).toBe('=CONCAT("a","b")');
    expect(w.getInputText(id, 3, 3)).toBe('=IFS(A4>5,"x",TRUE,"y")');
    // styles
    expect(w.getStyle(id, 1, 0).numFmt).toBe('0.0" kg"');
    const head = w.getStyle(id, 0, 0);
    expect(head.bold).toBe(true);
    expect(head.color).toBe('#4f81bd'); // theme accent1
    expect(head.bg).toMatch(/^#f/); // accent2 lightened by the tint
    expect(w.getStyle(id, 1, 3).numFmt).toBe('m/d/yyyy');
    expect(w.getStyle(id, 0, 2).numFmt).toBe('0.00%');
    // layout
    const s = w.sheets[0]!;
    expect(s.colWidths.get(0)).toBe(150);
    expect(s.rowHeights.get(1)).toBe(40);
    expect(s.freeze).toEqual({ rows: 1, cols: 0 });
    expect(s.merges).toEqual([{ r1: 5, c1: 0, r2: 5, c2: 2 }]);
    expect(at(w, 1, 'A1')).toBe(7);
    // names: the print area is skipped, the user name is kept
    expect([...w.names.keys()]).toEqual(['tasa']);
    expect(warnings.some((m) => m.includes('formato condicional') && m.includes('timePeriod'))).toBe(true);
    expect(w.sheets[0]!.condFormats).toHaveLength(1);
    expect(w.sheets[0]!.condFormats[0]).toMatchObject({ type: 'expression', formula: 'TRUE', ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }] });
  });

  it('recalculates consistently with the cached values', async () => {
    const { workbook: w } = await readXlsx(await excelStyleFile());
    const before: Scalar[] = ['B2', 'B3', 'B4', 'B5', 'C4', 'D4'].map((a) => at(w, 0, a));
    w.recalcAll();
    const after = ['B2', 'B3', 'B4', 'B5', 'C4', 'D4'].map((a) => at(w, 0, a));
    expect(after.slice(0, 3).map((v) => Number(v).toFixed(3))).toEqual(before.slice(0, 3).map((v) => Number(v).toFixed(3)));
    expect(after[3]).toBeCloseTo(1.015, 10);
    expect(after[4]).toBe('ab');
    expect(after[5]).toBe('x');
  });

  it('rejects things that are not workbooks', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    await expect(readXlsx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/libro de Excel/);
  });
});

describe('charts', () => {
  const sample = async () => {
    const w = new Workbook();
    const id = w.sheets[0]!.id;
    const put = (a: string, t: string) => {
      const p = parseA1(a)!;
      w.setInput(id, p.row, p.col, t);
    };
    for (const [a, t] of Object.entries({ A1: 'Mes', B1: 'Ventas', C1: 'Gastos', A2: 'Ene', B2: '10', C2: '4', A3: 'Feb', B3: '12', C3: '5', A4: 'Mar', B4: '9', C4: '6' })) put(a, t);
    w.editCharts(id, (cs) =>
      cs.push({
        id: 'c1',
        type: 'column',
        title: 'Ventas & gastos <2024>',
        legend: true,
        stacked: true,
        x: 300,
        y: 40,
        width: 480,
        height: 288,
        series: [
          { values: 'Hoja1!$B$2:$B$4', nameRef: 'Hoja1!$B$1', categories: 'Hoja1!$A$2:$A$4' },
          { values: 'Hoja1!$C$2:$C$4', nameRef: 'Hoja1!$C$1', categories: 'Hoja1!$A$2:$A$4' },
        ],
      }),
    );
    return w;
  };

  it('writes chart, drawing and relationship parts', async () => {
    const bytes = await writeXlsx(await sample());
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file('xl/charts/chart1.xml')).not.toBeNull();
    expect(zip.file('xl/drawings/drawing1.xml')).not.toBeNull();
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toContain('<drawing r:id="rId1"/>');
    const rels = await zip.file('xl/worksheets/_rels/sheet1.xml.rels')!.async('string');
    expect(rels).toContain('../drawings/drawing1.xml');
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    expect(ct).toContain('drawingml.chart+xml');
    const chart = await zip.file('xl/charts/chart1.xml')!.async('string');
    expect(chart).toContain('<c:grouping val="stacked"/>');
    expect(chart).toContain('<c:f>Hoja1!$B$2:$B$4</c:f>');
    expect(chart).toContain('Ventas &amp; gastos &lt;2024&gt;');
    expect(chart).toContain('<c:v>Ene</c:v>');
  });

  it('round-trips every chart kind', async () => {
    for (const type of ['column', 'bar', 'line', 'area', 'pie', 'scatter'] as const) {
      const w = await sample();
      const id = w.sheets[0]!.id;
      w.editCharts(id, (cs) => {
        cs[0]!.type = type;
        cs[0]!.stacked = type === 'column';
        cs[0]!.smooth = type === 'line' ? true : undefined;
      });
      const r = await roundTrip(w);
      const c = r.sheets[0]!.charts[0]!;
      expect(c.type, type).toBe(type);
      expect(c.title).toBe('Ventas & gastos <2024>');
      expect(c.legend).toBe(true);
      expect(c.series).toHaveLength(2);
      expect(c.series[0]).toMatchObject({ values: 'Hoja1!$B$2:$B$4', nameRef: 'Hoja1!$B$1', categories: 'Hoja1!$A$2:$A$4' });
      expect(c.stacked).toBe(type === 'column' ? true : undefined);
      expect(c.smooth).toBe(type === 'line' ? true : undefined);
      expect(Math.abs(c.x - 300)).toBeLessThan(2);
      expect(Math.abs(c.width - 480)).toBeLessThan(2);
      expect(Math.abs(c.height - 288)).toBeLessThan(2);
    }
  });

  it('reads an Excel-style chart with namespaced prefixes and warns about pictures', async () => {
    const w = await sample();
    const bytes = await writeXlsx(w);
    const zip = await JSZip.loadAsync(bytes);
    // add a picture anchor next to the chart, as Excel files often have
    const drawing = await zip.file('xl/drawings/drawing1.xml')!.async('string');
    zip.file('xl/drawings/drawing1.xml', drawing.replace('</xdr:wsDr>', '<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="100" cy="100"/><xdr:pic/><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>'));
    const { workbook, warnings } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    expect(workbook.sheets[0]!.charts).toHaveLength(1);
    expect(warnings.join(' ')).toMatch(/imagen/);
  });

  it('skips charts it cannot represent, with a warning', async () => {
    const w = await sample();
    const zip = await JSZip.loadAsync(await writeXlsx(w));
    const chart = await zip.file('xl/charts/chart1.xml')!.async('string');
    zip.file('xl/charts/chart1.xml', chart.replace(/c:barChart/g, 'c:bubbleChart'));
    const { workbook, warnings } = await readXlsx(await zip.generateAsync({ type: 'uint8array' }));
    expect(workbook.sheets[0]!.charts).toHaveLength(0);
    expect(warnings.join(' ')).toMatch(/no se importó/);
  });

  it('survives a structure change before saving', async () => {
    const w = await sample();
    w.shiftStructure(w.sheets[0]!.id, 'row', 0, 1);
    const r = await roundTrip(w);
    expect(r.sheets[0]!.charts[0]!.series[0]!.values).toBe('Hoja1!$B$3:$B$5');
  });
});
