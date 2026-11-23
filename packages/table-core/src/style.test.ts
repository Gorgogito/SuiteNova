import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, OFFICE_PALETTE, STYLE_FAMILIES, gridFromRows, gridLooks, lookOf, mergeCells, readableOn, shade, styleById, styleCatalog, styleFor, tint, type StyleOptions } from './index';

const size = { rows: 5, cols: 4 };
const opts = (o: Partial<StyleOptions> = {}): StyleOptions => ({ ...DEFAULT_OPTIONS, ...o });
const A = OFFICE_PALETTE.accents[0]!;

describe('colours', () => {
  it('tints and shades like a theme', () => {
    // the colours PowerPoint draws for Medium Style 2 - Accent 1: the whole table is 20 % of the accent, the bands 40 %
    expect(tint('#4472c4', 0.2)).toBe('#e9ebf5');
    expect(tint('#4472c4', 0.4)).toBe('#cfd5ea');
    expect(tint('#000000', 0.2)).toBe('#e7e7e7');
    expect(tint('#ffffff', 0.5)).toBe('#ffffff');
    expect(shade('#ffffff', 0.5)).toBe('#bcbcbc');
    expect(shade('#4472c4', 1)).toBe('#4472c4');
    expect(readableOn('#ffffff')).toBe('#000000');
    expect(readableOn('#1f3864')).toBe('#ffffff');
  });
});

describe('the catalogue', () => {
  it('has every family, the ones with colour in six accents, and unique ids that find themselves', () => {
    const cat = styleCatalog();
    expect(cat.map((c) => c.family)).toEqual(STYLE_FAMILIES.map((f) => f.id));
    const all = cat.flatMap((c) => c.styles);
    expect(all).toHaveLength(2 + 5 * 6);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) expect(styleById(s.id)).toEqual(s);
    expect(styleById('nope')).toBeUndefined();
    expect(styleById(undefined)).toBeUndefined();
    expect(styleFor('medium', 9).accent).toBe(6);
    expect(styleFor('grid', 2).name).toBe('Cuadrícula – Énfasis 2');
  });
  it('a different palette gives different colours', () => {
    const p = { ...OFFICE_PALETTE, accents: ['#ff0000', ...OFFICE_PALETTE.accents.slice(1)] };
    expect(styleFor('grid', 1, p).firstRow?.fill).toBe('#ff0000');
    expect(styleFor('grid', 1).firstRow?.fill).toBe(A);
  });
});

describe('how a cell looks', () => {
  const medium = styleFor('medium', 1);
  it('the header row, the bands and the body come from the style and its options', () => {
    const head = lookOf(medium, opts(), { r: 0, c: 1 }, size);
    expect(head).toMatchObject({ fill: A, color: '#ffffff', bold: true });
    expect(lookOf(medium, opts(), { r: 1, c: 1 }, size).fill).toBe(tint(A, 0.4));
    expect(lookOf(medium, opts(), { r: 2, c: 1 }, size).fill).toBe(tint(A, 0.2));
    expect(lookOf(medium, opts(), { r: 3, c: 1 }, size).fill).toBe(tint(A, 0.4));
    expect(lookOf(medium, opts({ bandRows: false }), { r: 1, c: 1 }, size).fill).toBe(tint(A, 0.2));
    expect(lookOf(medium, opts({ firstRow: false }), { r: 0, c: 1 }, size).fill).toBe(tint(A, 0.4));
  });
  it('the total row and the first and last columns when they are on', () => {
    expect(lookOf(medium, opts({ lastRow: true }), { r: 4, c: 1 }, size)).toMatchObject({ fill: A, bold: true });
    expect(lookOf(medium, opts(), { r: 4, c: 1 }, size).bold).toBe(false);
    expect(lookOf(medium, opts({ firstCol: true }), { r: 2, c: 0 }, size)).toMatchObject({ fill: A, bold: true, color: '#ffffff' });
    expect(lookOf(medium, opts({ lastCol: true }), { r: 2, c: 3 }, size).fill).toBe(A);
    expect(lookOf(medium, opts({ firstCol: true }), { r: 2, c: 1 }, size).bold).toBe(false);
  });
  it('column bands skip the first and last columns when those are on', () => {
    const o = opts({ bandRows: false, bandCols: true, firstCol: true });
    expect(lookOf(medium, o, { r: 2, c: 1 }, size).fill).toBe(tint(A, 0.4));
    expect(lookOf(medium, o, { r: 2, c: 2 }, size).fill).toBe(tint(A, 0.2));
    expect(lookOf(medium, o, { r: 2, c: 3 }, size).fill).toBe(tint(A, 0.4));
  });
  it('the plain style and no style have no fill, no text colour and no borders', () => {
    for (const s of [styleFor('plain'), undefined]) {
      const l = lookOf(s, opts(), { r: 1, c: 1 }, size);
      expect(l).toEqual({ fill: null, color: null, bold: false, borders: {} });
    }
  });
  it('the table grid draws every border; outer edges and inner ones', () => {
    const l = lookOf(styleFor('basic'), opts(), { r: 0, c: 0 }, size);
    expect(Object.keys(l.borders).sort()).toEqual(['b', 'l', 'r', 't']);
    const inner = lookOf(styleFor('basic'), opts(), { r: 2, c: 2 }, size);
    expect(inner.borders.t).toEqual(inner.borders.b);
  });
  it('a border the header asks for wins over the whole table, and is the same seen from both cells of the edge', () => {
    const above = lookOf(medium, opts(), { r: 0, c: 1 }, size);
    const below = lookOf(medium, opts(), { r: 1, c: 1 }, size);
    expect(above.borders.b).toMatchObject({ width: 3, color: '#ffffff' });
    expect(below.borders.t).toEqual(above.borders.b);
    // the same for the total row
    const o = opts({ lastRow: true });
    expect(lookOf(medium, o, { r: 3, c: 1 }, size).borders.b).toEqual(lookOf(medium, o, { r: 4, c: 1 }, size).borders.t);
    expect(lookOf(medium, o, { r: 4, c: 1 }, size).borders.t?.width).toBe(3);
  });
  it('the light style only draws horizontal lines; a merged cell takes the edges of its extent', () => {
    const light = styleFor('light', 2);
    const l = lookOf(light, opts(), { r: 2, c: 1, rs: 2, cs: 2 }, size);
    expect(l.borders.l).toBeUndefined();
    expect(l.borders.t).toBeDefined();
    expect(l.borders.b).toBeDefined();
    const bottom = lookOf(light, opts(), { r: 3, c: 0, rs: 2 }, size);
    expect(bottom.borders.b?.width).toBe(1);
  });
});

describe('what the cell has of its own wins', () => {
  const grid = styleFor('grid', 3);
  it('its fill, its text alignment and its margins', () => {
    const l = lookOf(grid, opts(), { r: 0, c: 0 }, size, { fill: '#123456', align: 'right', valign: 'middle', margins: { t: 1, r: 2, b: 3, l: 4 } });
    expect(l).toMatchObject({ fill: '#123456', align: 'right', valign: 'middle', margins: { t: 1, r: 2, b: 3, l: 4 } });
  });
  it('a null fill takes the fill of the style away, and a null border takes that border away', () => {
    expect(lookOf(grid, opts(), { r: 0, c: 0 }, size, { fill: null }).fill).toBeNull();
    const l = lookOf(grid, opts(), { r: 1, c: 1 }, size, { borders: { t: null, b: { style: 'double', width: 2, color: '#ff0000' } } });
    expect(l.borders.t).toBeUndefined();
    expect(l.borders.b).toEqual({ style: 'double', width: 2, color: '#ff0000' });
    expect(l.borders.l).toBeDefined();
  });
  it('a border with style none is no border', () => {
    expect(lookOf(grid, opts(), { r: 1, c: 1 }, size, { borders: { l: { style: 'none', width: 1, color: '#000' } } }).borders.l).toBeUndefined();
  });
});

describe('the look of a whole grid', () => {
  it('gives null where a merged cell covers and uses the span of the ones that merge', () => {
    let g = gridFromRows([['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']], (t) => t);
    g = mergeCells(g, { r1: 1, c1: 0, r2: 2, c2: 1 }, () => '');
    const looks = gridLooks(g, styleFor('grid', 1), DEFAULT_OPTIONS);
    expect(looks[0]![0]!.fill).toBe(A);
    expect(looks[1]![1]).toBeNull();
    expect(looks[2]![0]).toBeNull();
    expect(looks[1]![0]).not.toBeNull();
    expect(looks[2]![2]).not.toBeNull();
  });
});
