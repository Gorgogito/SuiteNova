import { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOC_DEFAULTS,
  ENVELOPE_SIZES,
  LABEL_SHEETS,
  compareValues,
  defaultSection,
  emptyWriterDoc,
  envelopeSection,
  fieldText,
  makeSection,
  mergeDataFromRows,
  mergeDocument,
  mergeLabels,
  nodeTypes,
  parseCondition,
  parseDelimited,
  plainText,
  readDocx,
  writeDocx,
  writerSchema,
  type MailMergeData,
} from './index';

const t = (text: string) => writerSchema.text(text);
const field = (kind: string, arg: string | null, switches: string | null = null) => nodeTypes.field!.create({ kind, arg, switches });
const p = (...c: (PMNode | string)[]) => nodeTypes.paragraph!.create(null, c.map((x) => (typeof x === 'string' ? t(x) : x)));
const body = (...blocks: PMNode[]) => nodeTypes.doc!.create(null, [makeSection(blocks, defaultSection())]);
const data: MailMergeData = {
  kind: 'letters',
  fields: ['Nombre', 'Ciudad', 'Edad'],
  records: [
    ['Ana', 'Madrid', '30'],
    ['Luis', 'Lima', '17'],
    ['Eva', '', '45'],
  ],
  source: 'test.csv',
};
const texts = (d: PMNode) => {
  const out: string[] = [];
  d.forEach((s) => out.push(plainText(s)));
  return out;
};

describe('data sources', () => {
  it('reads CSV with quotes, a guessed delimiter and a BOM', () => {
    const r = parseDelimited('﻿Nombre;Nota\r\n"Pérez; Ana";"dice ""hola"""\r\nLuis;\r\n');
    expect(r.fields).toEqual(['Nombre', 'Nota']);
    expect(r.records).toEqual([
      ['Pérez; Ana', 'dice "hola"'],
      ['Luis', ''],
    ]);
  });
  it('keeps line breaks inside quoted cells', () => {
    expect(parseDelimited('a,b\n"x\ny",2').records).toEqual([['x\ny', '2']]);
  });
  it('builds a data source from spreadsheet rows', () => {
    const d = mergeDataFromRows([['A', ''], ['1', '2'], ['', ''], ['3']], 'x.xlsx');
    expect(d.fields).toEqual(['A', 'Columna2']);
    expect(d.records).toEqual([['1', '2'], ['3', '']]);
  });
});

describe('rules', () => {
  it('parses conditions', () => {
    expect(parseCondition('Ciudad = "Nueva York" "sí" "no"')).toMatchObject({ field: 'Ciudad', op: '=', value: 'Nueva York', rest: '"sí" "no"' });
    expect(parseCondition('Edad >= 18')).toMatchObject({ field: 'Edad', op: '>=', value: '18' });
    expect(parseCondition('nada')).toBeNull();
  });
  it('compares numbers as numbers and text without case', () => {
    expect(compareValues('9', '<', '10')).toBe(true);
    expect(compareValues('Madrid', '=', 'madrid')).toBe(true);
    expect(compareValues('a', '<>', 'b')).toBe(true);
  });
  it('adds before/after text only when the field has a value', () => {
    expect(fieldText('Ana', '\\b "Sra. " \\f ","')).toBe('Sra. Ana,');
    expect(fieldText('', '\\b "Sra. "')).toBe('');
  });
});

describe('merging', () => {
  it('makes one copy per record, each starting a page', () => {
    const r = mergeDocument(body(p('Hola ', field('mergefield', 'Nombre'), ' de ', field('mergefield', 'ciudad'))), data);
    expect(r.count).toBe(3);
    expect(texts(r.body)).toEqual(['Hola Ana de Madrid', 'Hola Luis de Lima', 'Hola Eva de ']);
    const ids = new Set<string>();
    r.body.forEach((s) => ids.add(s.attrs.id));
    expect(ids.size).toBe(3);
  });
  it('merges only a range of records', () => {
    const r = mergeDocument(body(p(field('mergefield', 'Nombre'))), data, 1, 1);
    expect(texts(r.body)).toEqual(['Luis']);
  });
  it('evaluates IF with the then and else text', () => {
    const r = mergeDocument(body(p(field('merge-rule', 'IF', 'Edad >= 18 "adulto" "menor"'))), data);
    expect(texts(r.body)).toEqual(['adulto', 'menor', 'adulto']);
  });
  it('skips records with SKIPIF', () => {
    const r = mergeDocument(body(p(field('merge-rule', 'SKIPIF', 'Ciudad = "Lima"'), field('mergefield', 'Nombre'))), data);
    expect(r.count).toBe(2);
    expect(texts(r.body)).toEqual(['Ana', 'Eva']);
  });
  it('NEXT puts two records in one copy', () => {
    const r = mergeDocument(body(p(field('mergefield', 'Nombre')), p(field('merge-rule', 'NEXT')), p(field('mergefield', 'Nombre'))), data);
    expect(texts(r.body)).toEqual(['Ana\n\nLuis', 'Eva\n\n']);
  });
  it('merges inside text boxes and tables', () => {
    const box = nodeTypes.shape!.create({ kind: 'textbox' }, [p(field('mergefield', 'Nombre'))]);
    const r = mergeDocument(body(p(box)), data, 0, 0);
    expect(texts(r.body)).toEqual(['\nAna']);
  });
  it('the result goes through .docx', async () => {
    const r = mergeDocument(body(p('Para ', field('mergefield', 'Nombre'))), data);
    const w = await writeDocx({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: r.body });
    const back = await readDocx(w.data);
    expect(texts(back.doc.body)).toEqual(['Para Ana', 'Para Luis', 'Para Eva']);
  });
});

describe('envelopes and labels', () => {
  it('builds an envelope section with the size of the envelope', () => {
    const size = ENVELOPE_SIZES[0]!;
    const s = envelopeSection(size, 'Remite\nCalle 1', 'Para\nCalle 2');
    expect(s.attrs.page.width).toBeCloseTo(size.width, 1);
    expect(s.attrs.page.height).toBeCloseTo(size.height, 1);
    expect(plainText(s)).toContain('Calle 2');
  });
  it('fills a label sheet with one record per label', () => {
    const sheet = LABEL_SHEETS[0]!;
    const big: MailMergeData = { ...data, records: Array.from({ length: 25 }, (_v, i) => [`N${i}`, 'X', '1']) };
    const d = mergeLabels([p(field('mergefield', 'Nombre'))], big, sheet);
    expect(d.childCount).toBe(2);
    const all = plainText(d);
    expect(all).toContain('N0');
    expect(all).toContain('N24');
    expect(d.firstChild!.firstChild!.childCount).toBe(sheet.rows);
  });
});
