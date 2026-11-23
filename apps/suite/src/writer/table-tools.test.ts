import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { columnWidths, compareCells, distributeColumns, findTable, fitColumns, parseNumber, setTableProps, sortTable, splitLine, tableToText, textToTable } from './table-tools';

const para = (text: string) => nodeTypes.paragraph!.create(null, text ? writerSchema.text(text) : undefined);
const cell = (text: string, w = 100) => nodeTypes.table_cell!.create({ colwidth: [w] }, para(text));
const row = (...texts: string[]) => nodeTypes.table_row!.create(null, texts.map((x) => cell(x)));
const table = (rows: string[][], attrs: Record<string, unknown> = {}) => nodeTypes.table!.create({ borders: true, ...attrs }, rows.map((r) => row(...r)));
const stateOf = (blocks: ReturnType<typeof para>[], select: 'text' | 'all' = 'all'): EditorState => {
  const doc = nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, blocks)]);
  const s = EditorState.create({ schema: writerSchema, doc });
  return s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3, select === 'all' ? s.doc.content.size - 3 : 3)));
};
const run = (s: EditorState, cmd: (st: EditorState, d?: (tr: Transaction) => void) => boolean): EditorState => {
  let out = s;
  expect(cmd(s, (tr) => (out = s.apply(tr)))).toBe(true);
  return out;
};
const grid = (s: EditorState): string[][] => {
  const out: string[][] = [];
  s.doc.firstChild!.forEach((b) => {
    if (b.type.name === 'table') b.forEach((r) => { const x: string[] = []; r.forEach((c) => x.push(c.textContent)); out.push(x); });
  });
  return out;
};
const inCell = (blocks: ReturnType<typeof table>[]) => stateOf(blocks as never, 'text'); // el cursor cae dentro de la primera celda

describe('propiedades de tabla', () => {
  it('cambia alineación, borde y márgenes de la tabla actual; «izquierda» vuelve a null', () => {
    let s = run(inCell([table([['a', 'b']])]), setTableProps({ align: 'center', borderColor: '#ff0000', borderWidth: 2, padding: { x: 8, y: 2 }, headerRow: true }));
    expect(findTable(s)!.node.attrs).toMatchObject({ align: 'center', borderColor: '#ff0000', borderWidth: 2, padding: { x: 8, y: 2 }, headerRow: true });
    s = run(s, setTableProps({ align: 'left' }));
    expect(findTable(s)!.node.attrs.align).toBeNull();
  });
  it('fuera de una tabla no hace nada', () => {
    expect(setTableProps({ borders: false })(stateOf([para('x')], 'text'))).toBe(false);
  });
});

describe('anchos de columna', () => {
  const wide = () => nodeTypes.table!.create({ borders: true }, [nodeTypes.table_row!.create(null, [cell('a', 60), cell('b', 140), cell('c', 100)])]);
  it('distribuye a partes iguales conservando el ancho total', () => {
    const s = run(inCell([wide()]), distributeColumns);
    expect(columnWidths(findTable(s)!.node)).toEqual([100, 100, 100]);
  });
  it('ajusta al ancho de la página con proporciones', () => {
    const s = run(inCell([wide()]), fitColumns(600));
    expect(columnWidths(findTable(s)!.node)).toEqual([120, 280, 200]);
  });
});

describe('ordenar', () => {
  const data = [['Nombre', 'Edad'], ['Luis', '30'], ['ana', '5'], ['Zoe', '1.200,5'], ['Eva', 'n/d']];
  it('texto ascendente y descendente, sin tener en cuenta mayúsculas', () => {
    const s = run(inCell([table(data, { headerRow: true })]), sortTable(0, true, 'text'));
    expect(grid(s).map((r) => r[0])).toEqual(['Nombre', 'ana', 'Eva', 'Luis', 'Zoe']);
    expect(grid(run(s, sortTable(0, false, 'text'))).map((r) => r[0])).toEqual(['Nombre', 'Zoe', 'Luis', 'Eva', 'ana']);
  });
  it('números como números (coma o punto decimal) y los no numéricos al final', () => {
    const s = run(inCell([table(data, { headerRow: true })]), sortTable(1, true, 'number'));
    expect(grid(s).map((r) => r[1])).toEqual(['Edad', '5', '30', '1.200,5', 'n/d']);
  });
  it('sin fila de encabezado, ordena también la primera', () => {
    const s = run(inCell([table([['b'], ['a'], ['c']])]), sortTable(0, true, 'text'));
    expect(grid(s).flat()).toEqual(['a', 'b', 'c']);
  });
  it('se niega con celdas combinadas verticalmente', () => {
    const t = nodeTypes.table!.create({ borders: true }, [nodeTypes.table_row!.create(null, [nodeTypes.table_cell!.create({ rowspan: 2 }, para('x'))]), nodeTypes.table_row!.create()]);
    expect(sortTable(0, true, 'text')(inCell([t]))).toBe(false);
  });
  it('comparación y lectura de números', () => {
    expect(parseNumber('$ 1,234.50')).toBe(1234.5);
    expect(parseNumber('1.234,50')).toBe(1234.5);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('abc')).toBeNull();
    expect(compareCells('a2', 'a10', 'text')).toBeLessThan(0);
  });
});

describe('texto ↔ tabla', () => {
  it('convierte líneas separadas por tabulación en filas y columnas', () => {
    const s = run(stateOf([para('a\tb\tc'), para('d\te')]), textToTable('tab', 600));
    expect(grid(s)).toEqual([['a', 'b', 'c'], ['d', 'e', '']]);
    expect(columnWidths(findTable(s)!.node)).toEqual([200, 200, 200]);
  });
  it('un párrafo por fila cuando el separador es «párrafos»', () => {
    const s = run(stateOf([para('uno'), para('dos, tres')]), textToTable('paragraph', 600));
    expect(grid(s)).toEqual([['uno'], ['dos, tres']]);
  });
  it('separador de punto y coma', () => {
    expect(splitLine('x;y', 'semicolon')).toEqual(['x', 'y']);
    expect(grid(run(stateOf([para('x ; y')]), textToTable('semicolon', 300)))).toEqual([['x', 'y']]);
  });
  it('de tabla a texto: una línea por fila', () => {
    const s = run(inCell([table([['a', 'b'], ['c', 'd']])]), tableToText('semicolon'));
    expect(findTable(s)).toBeNull();
    const out: string[] = [];
    s.doc.firstChild!.forEach((b) => out.push(b.textContent));
    expect(out).toEqual(['a;b', 'c;d']);
  });
  it('no convierte dentro de una tabla', () => {
    expect(textToTable('tab', 300)(inCell([table([['a']])]))).toBe(false);
  });
});
