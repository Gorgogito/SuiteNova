import { styleFor, tint } from '@suitenova/table-core';
import JSZip from 'jszip';
import { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOC_DEFAULTS,
  NO_SHADING,
  computeFieldResults,
  defaultPage,
  defaultSection,
  emptyWriterDoc,
  isStyledTable,
  makeSection,
  nodeTypes,
  optionsOfTable,
  readDocx,
  setCellBorders,
  setCellShading,
  setTableOption,
  setTableStyle,
  styleOfTable,
  tableLooks,
  tableStyleInfo,
  tableStylePlugin,
  writeDocx,
  writerSchema,
  type WriterDoc,
} from './index';

const para = (text: string) => nodeTypes.paragraph!.create(null, text ? writerSchema.text(text) : undefined);
const cell = (text: string, attrs: Record<string, unknown> = {}) => nodeTypes.table_cell!.create({ colwidth: [100], ...attrs }, para(text));
const row = (...cells: PMNode[]) => nodeTypes.table_row!.create(null, cells);
const table = (rows: string[][], attrs: Record<string, unknown> = {}) => nodeTypes.table!.create({ borders: false, ...attrs }, rows.map((r) => row(...r.map((t) => cell(t)))));
const stateWith = (t: PMNode): EditorState => {
  const doc = nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, [t])]);
  const s = EditorState.create({ schema: writerSchema, doc, plugins: [tableStylePlugin()] });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, 4)));
};
const tableOf = (s: EditorState): PMNode => {
  let t: PMNode | null = null;
  s.doc.descendants((n) => {
    if (n.type.name === 'table') t = n;
    return !t;
  });
  return t!;
};
const run = (s: EditorState, cmd: (st: EditorState, d?: (tr: Transaction) => void) => boolean): EditorState => {
  let out = s;
  expect(cmd(s, (tr) => (out = s.apply(tr)))).toBe(true);
  return out;
};
/** The inline style that the plugin puts on each cell, in reading order. */
const decoStyles = (s: EditorState): string[] => {
  const plugin = s.plugins.find((p) => (p as unknown as { key: string }).key.startsWith('nwTableStyle'))!;
  const decos = plugin.props.decorations!.call(plugin, s) as unknown as { find: () => { type: { attrs: { style?: string } } }[] };
  return decos.find().map((d) => d.type.attrs.style ?? '');
};
const select2x2 = (s: EditorState, from: number, to: number): EditorState => {
  const t = tableOf(s);
  let base = 0;
  s.doc.descendants((n, pos) => {
    if (n === t) base = pos;
    return true;
  });
  const cells: number[] = [];
  t.descendants((n, pos) => {
    if (n.type.name === 'table_cell') cells.push(base + 1 + pos);
    return n.type.name === 'table_row';
  });
  return s.apply(s.tr.setSelection(new CellSelection(s.doc.resolve(cells[from]!), s.doc.resolve(cells[to]!))));
};

const A = '#4472c4';

describe('the style of a table node', () => {
  it('a table with no style is plain, or the table grid when it has the old borders flag', () => {
    expect(styleOfTable(table([['a']])).family).toBe('plain');
    const grid = styleOfTable(table([['a']], { borders: true, borderColor: '#ff0000', borderWidth: 2 }));
    expect(grid.family).toBe('basic');
    expect(grid.whole?.borders?.t).toEqual({ style: 'single', width: 2, color: '#ff0000' });
    expect(styleOfTable(table([['a']], { tstyle: 'medium-2' })).id).toBe('medium-2');
    expect(styleOfTable(table([['a']], { tstyle: 'invented' })).family).toBe('plain');
  });
  it('the options default to header row and bands, and to nothing for a table without a style', () => {
    expect(optionsOfTable(table([['a']], { tstyle: 'grid-1' }))).toMatchObject({ firstRow: true, bandRows: true, lastRow: false });
    expect(optionsOfTable(table([['a']], { tstyle: 'grid-1', topts: { firstRow: false, lastRow: true } }))).toMatchObject({ firstRow: false, lastRow: true, bandRows: true });
    expect(optionsOfTable(table([['a']]))).toMatchObject({ firstRow: false, bandRows: false });
  });
  it('only a table with a style, or with borders of its own cells, goes through the style engine', () => {
    expect(isStyledTable(table([['a']]))).toBe(false);
    expect(isStyledTable(table([['a']], { tstyle: 'medium-1' }))).toBe(true);
    const t = nodeTypes.table!.create(null, [row(cell('a', { borders: { t: { style: 'single', width: 1, color: '#000000' } } }))]);
    expect(isStyledTable(t)).toBe(true);
  });
});

describe('how the cells look', () => {
  const t = table([['H1', 'H2'], ['a', 'b'], ['c', 'd'], ['T', 'T']], { tstyle: 'medium-1', topts: { firstRow: true, lastRow: true, firstCol: false, lastCol: false, bandRows: true, bandCols: false } });
  it('header, bands and total row come from the style', () => {
    const fills = [...tableLooks(t).values()].map((l) => l.fill);
    expect(fills).toEqual([A, A, tint(A, 0.4), tint(A, 0.4), tint(A, 0.2), tint(A, 0.2), A, A]);
  });
  it('what the cell has of its own wins, and "no shading" takes the colour away', () => {
    const t2 = nodeTypes.table!.create({ tstyle: 'medium-1', borders: false }, [row(cell('a', { background: '#ff0000' }), cell('b', { background: NO_SHADING })), row(cell('c'), cell('d'))]);
    const looks = [...tableLooks(t2).values()];
    expect(looks[0]!.fill).toBe('#ff0000');
    expect(looks[1]!.fill).toBeNull();
  });
  it('the plugin draws every cell of a styled table with that look, and leaves plain tables alone', () => {
    const s = stateWith(t);
    const styles = decoStyles(s);
    expect(styles).toHaveLength(8);
    expect(styles[0]).toContain(`background-color:${A}`);
    expect(styles[0]).toContain('font-weight:700');
    expect(styles[0]).toContain('color:#ffffff');
    expect(styles[0]).toMatch(/border-bottom:3pt solid #ffffff/);
    expect(decoStyles(stateWith(table([['a', 'b']])))).toEqual([]);
  });
  it('the plugin follows the document: a new style changes the cells at once', () => {
    let s = stateWith(table([['H', 'x'], ['a', 'b']]));
    expect(decoStyles(s)).toEqual([]);
    s = run(s, setTableStyle('dark-1'));
    expect(decoStyles(s).length).toBe(4);
    expect(decoStyles(s)[0]).toContain('background-color:#000000');
    s = run(s, setTableStyle(null));
    expect(decoStyles(s)).toEqual([]);
  });
});

describe('commands', () => {
  it('sets and clears the style of the table of the cursor, and turns off the old borders flag', () => {
    let s = stateWith(table([['a', 'b']], { borders: true }));
    s = run(s, setTableStyle('grid-3'));
    expect(tableOf(s).attrs).toMatchObject({ tstyle: 'grid-3', borders: false });
    expect(tableStyleInfo(s)).toMatchObject({ styleId: 'grid-3', options: { firstRow: true, bandRows: true } });
    s = run(s, setTableStyle(null));
    expect(tableOf(s).attrs).toMatchObject({ tstyle: null, topts: null });
    expect(setTableStyle('nope')(s)).toBe(false);
    expect(setTableStyle('grid-1')(EditorState.create({ schema: writerSchema, doc: nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, [para('x')])]) }))).toBe(false);
  });
  it('turns the options on and off and remembers them', () => {
    let s = stateWith(table([['a', 'b'], ['c', 'd']], { tstyle: 'medium-1' }));
    s = run(s, setTableOption('lastRow', true));
    s = run(s, setTableOption('bandRows', false));
    expect(tableStyleInfo(s)!.options).toMatchObject({ lastRow: true, bandRows: false, firstRow: true });
    // an option on a table with no style gives it the plain style, so the option has something to act on
    const plain = run(stateWith(table([['a']])), setTableOption('firstCol', true));
    expect(tableOf(plain).attrs.tstyle).toBe('plain');
  });
  it('shades the cells of a selection, once each, and lets the style decide again with null', () => {
    let s = select2x2(stateWith(table([['a', 'b'], ['c', 'd']], { tstyle: 'grid-1' })), 0, 3);
    s = run(s, setCellShading('#abcdef'));
    const cells: string[] = [];
    tableOf(s).descendants((n) => (n.type.name === 'table_cell' ? (cells.push(n.attrs.background), false) : true));
    expect(cells).toEqual(['#abcdef', '#abcdef', '#abcdef', '#abcdef']);
    s = select2x2(s, 0, 0);
    s = run(s, setCellShading(NO_SHADING));
    expect(tableOf(s).nodeAt(1)!.attrs.background).toBe(NO_SHADING);
    s = run(s, setCellShading(null));
    expect(tableOf(s).nodeAt(1)!.attrs.background).toBeNull();
  });
  it('draws the outside border of the selected cells on them and on the cells that touch them', () => {
    const line = { style: 'single' as const, width: 2, color: '#ff0000' };
    let s = select2x2(stateWith(table([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']])), 4, 4);
    s = run(s, setCellBorders('outer', line));
    const b = (r: number, c: number) => tableOf(s).child(r).child(c).attrs.borders;
    expect(b(1, 1)).toEqual({ t: line, r: line, b: line, l: line });
    expect(b(0, 1)).toEqual({ b: line });
    expect(b(2, 1)).toEqual({ t: line });
    expect(b(1, 0)).toEqual({ r: line });
    expect(b(1, 2)).toEqual({ l: line });
    expect(b(0, 0)).toBeNull();
    // a table with borders of its own cells is now drawn by the engine
    expect(decoStyles(s).some((x) => x.includes('border-top:2pt solid #ff0000'))).toBe(true);
  });
  it('"no border" is a border that says so: it takes away the line of the style', () => {
    let s = select2x2(stateWith(table([['a', 'b'], ['c', 'd']], { tstyle: 'grid-1' })), 0, 3);
    s = run(s, setCellBorders('none', null));
    const first = tableOf(s).child(0).child(0).attrs.borders;
    expect(first).toEqual({ t: null, b: null, l: null, r: null });
    const styles = decoStyles(s);
    expect(styles.every((x) => !x.includes('border-top'))).toBe(true);
  });
  it('commands do nothing outside a table', () => {
    const s = EditorState.create({ schema: writerSchema, doc: nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, [para('x')])]) });
    expect(setCellShading('#fff')(s)).toBe(false);
    expect(setCellBorders('all', null)(s)).toBe(false);
    expect(setTableOption('firstRow', true)(s)).toBe(false);
    expect(tableStyleInfo(s)).toBeNull();
  });
});

describe('the .docx', () => {
  const docWith = (t: PMNode): WriterDoc => {
    const props = defaultSection(defaultPage());
    return { ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection([t], props)]) };
  };
  const line = { style: 'dashed' as const, width: 1.5, color: '#00aa00' };
  const sample = nodeTypes.table!.create({ tstyle: 'medium-2', borders: false, topts: { firstRow: true, lastRow: true, firstCol: false, lastCol: true, bandRows: false, bandCols: true } }, [
    row(cell('H1', { background: '#112233' }), cell('H2', { borders: { t: line, b: null } })),
    row(cell('a', { background: NO_SHADING }), cell('b')),
  ]);

  it('writes our style as a real Word table style with its conditional parts, and the options as tblLook', async () => {
    const w = await writeDocx(docWith(sample));
    const zip = await JSZip.loadAsync(w.data);
    const styles = await zip.file('word/styles.xml')!.async('string');
    expect(styles).toContain('w:styleId="NovaMedium2"');
    expect(styles).toContain('w:customStyle="1"');
    for (const part of ['firstRow', 'lastRow', 'firstCol', 'lastCol', 'band1Horz', 'band1Vert']) expect(styles).toContain(`<w:tblStylePr w:type="${part}">`);
    const accent2 = styleFor('medium', 2).firstRow!.fill!.replace('#', '').toUpperCase();
    expect(styles).toContain(`w:fill="${accent2}"`);
    const body = await zip.file('word/document.xml')!.async('string');
    expect(body).toContain('<w:tblStyle w:val="NovaMedium2"/>');
    expect(body).not.toContain('TableGrid');
    expect(body).toMatch(/<w:tblLook w:val="[0-9A-F]{4}" w:firstRow="1" w:lastRow="1" w:firstColumn="0" w:lastColumn="1" w:noHBand="1" w:noVBand="0"\/>/);
    expect(body).toContain('<w:tcBorders><w:top w:val="dashed" w:sz="12" w:space="0" w:color="00AA00"/><w:bottom w:val="nil"/></w:tcBorders>');
    expect(body).toContain('w:fill="auto"');
    // only the styles that are used are written
    expect(styles).not.toContain('NovaGrid1');
  });

  it('reads it back: style, options, shading, no-shading and the borders of a cell', async () => {
    const w = await writeDocx(docWith(sample));
    const r = await readDocx(w.data);
    let t: PMNode | null = null;
    r.doc.body.descendants((n) => {
      if (n.type.name === 'table') t = n;
      return !t;
    });
    expect(t!.attrs).toMatchObject({ tstyle: 'medium-2', borders: false, topts: { firstRow: true, lastRow: true, firstCol: false, lastCol: true, bandRows: false, bandCols: true } });
    expect(t!.child(0).child(0).attrs.background).toBe('#112233');
    expect(t!.child(1).child(0).attrs.background).toBe(NO_SHADING);
    expect(t!.child(0).child(1).attrs.borders).toEqual({ t: line, b: null });
    expect(t!.child(1).child(1).attrs.borders).toBeNull();
  });

  it('a table with the old borders flag is still the table grid', async () => {
    const w = await writeDocx(docWith(table([['a']], { borders: true })));
    const zip = await JSZip.loadAsync(w.data);
    expect(await zip.file('word/document.xml')!.async('string')).toContain('<w:tblStyle w:val="TableGrid"/>');
    const r = await readDocx(w.data);
    let t: PMNode | null = null;
    r.doc.body.descendants((n) => {
      if (n.type.name === 'table') t = n;
      return !t;
    });
    expect(t!.attrs).toMatchObject({ borders: true, tstyle: null });
  });
});

describe('formulas in a table', () => {
  const fieldIn = (arg: string, result: string | null = null) => nodeTypes.field!.create({ kind: 'formula', arg, switches: null, result });
  const cellOf = (...content: PMNode[]) => nodeTypes.table_cell!.create({ colwidth: [100] }, nodeTypes.paragraph!.create(null, content));
  const num = (t: string) => cellOf(writerSchema.text(t));
  const ctx = { pageOf: () => null, textWidthPt: 400, sources: [], citeStyle: 'apa' as const, noteLabel: () => null };
  const tableDoc = (t: PMNode) => nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, [t])]);
  const results = (d: PMNode, decimal?: '.' | ',') => {
    const map = computeFieldResults(d, { ...ctx, decimal });
    return [...map.values()];
  };

  it('computes ABOVE, LEFT and cell references from the cell the field is in', () => {
    const t = nodeTypes.table!.create(null, [
      row(num('Cant'), num('Precio'), num('Total')),
      row(num('2'), num('10'), cellOf(fieldIn('B2*A2'))),
      row(num('3'), num('20'), cellOf(fieldIn('B3*A3'))),
      row(cellOf(writerSchema.text('Suma')), cellOf(fieldIn('SUM(ABOVE)')), cellOf(fieldIn('SUM(C2:C3)'))),
    ]);
    expect(results(tableDoc(t))).toEqual(['20', '60', '30', '80']);
  });
  it('reads the result of another formula as the text of its cell, and the Spanish names work', () => {
    const t = nodeTypes.table!.create(null, [row(num('4'), cellOf(fieldIn('SUMA(IZQUIERDA)'))), row(cellOf(fieldIn('A1*2')), cellOf(fieldIn('SUMA(ARRIBA)')))]);
    expect(results(tableDoc(t))).toEqual(['4', '8', '4']);
  });
  it('writes and reads the decimal comma, and a number picture', () => {
    const t = nodeTypes.table!.create(null, [row(num('1,5')), row(num('2,25')), row(cellOf(fieldIn('SUM(ABOVE) \\# "0.00"')))]);
    expect(results(tableDoc(t), ',')).toEqual(['3,75']);
  });
  it('a formula outside a table is a syntax error, and an error inside shows its message', () => {
    const p = nodeTypes.paragraph!.create(null, [fieldIn('1+1')]);
    expect(results(nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, [p])]))).toEqual(['!Error de sintaxis']);
    const t = nodeTypes.table!.create(null, [row(cellOf(fieldIn('1/0')))]);
    expect(results(tableDoc(t))).toEqual(['!División por cero']);
  });
  it('goes to the .docx as a formula field with its result, and comes back the same', async () => {
    const t = nodeTypes.table!.create(null, [row(num('2')), row(num('3')), row(cellOf(fieldIn('SUM(ABOVE) \\# "0.00"', '5.00')))]);
    const props = defaultSection(defaultPage());
    const d = { ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection([t], props)]) };
    const w = await writeDocx(d);
    const xml = await (await JSZip.loadAsync(w.data)).file('word/document.xml')!.async('string');
    expect(xml).toMatch(/=SUM\(ABOVE\) \\# (&quot;|")0\.00(&quot;|")/);
    expect(xml).toContain('5.00');
    const r = await readDocx(w.data);
    const found: PMNode[] = [];
    r.doc.body.descendants((n) => (n.type.name === 'field' ? (found.push(n), false) : true));
    expect(found).toHaveLength(1);
    expect(found[0]!.attrs).toMatchObject({ kind: 'formula', arg: 'SUM(ABOVE) \\# "0.00"', result: '5.00' });
  });
});

describe('alternative text of a table', () => {
  it('goes to the .docx as the title and the description of the table and comes back', async () => {
    const t = table([['a']], { caption: 'Ventas', descr: 'Ventas por trimestre de 2026' });
    const props = defaultSection(defaultPage());
    const d = { ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: nodeTypes.doc!.create(null, [makeSection([t], props)]) };
    const w = await writeDocx(d);
    const xml = await (await JSZip.loadAsync(w.data)).file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:tblCaption w:val="Ventas"/>');
    expect(xml).toContain('<w:tblDescription w:val="Ventas por trimestre de 2026"/>');
    const r = await readDocx(w.data);
    let back: PMNode | null = null;
    r.doc.body.descendants((n) => (n.type.name === 'table' ? ((back = n), false) : true));
    expect(back!.attrs).toMatchObject({ caption: 'Ventas', descr: 'Ventas por trimestre de 2026' });
  });
});
