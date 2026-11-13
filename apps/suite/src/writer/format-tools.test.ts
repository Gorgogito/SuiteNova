import { writerSchema, nodeTypes } from '@suitenova/writer-core';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { applyFormat, captureFormat, changeCase, convertCase } from './format-tools';

const mk = (name: string, attrs?: Record<string, unknown>) => writerSchema.marks[name]!.create(attrs);
const para = (text: string, attrs: Record<string, unknown> = {}, marks: ReturnType<typeof mk>[] = []) => nodeTypes.paragraph!.create(attrs, text ? writerSchema.text(text, marks) : undefined);
const stateOf = (blocks: ReturnType<typeof para>[], from?: number, to?: number): EditorState => {
  const doc = nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, blocks)]);
  const s = EditorState.create({ schema: writerSchema, doc });
  return from === undefined ? s : s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to ?? from)));
};
const run = (s: EditorState, cmd: (st: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean): EditorState => {
  let out = s;
  cmd(s, (tr) => (out = s.apply(tr)));
  return out;
};
const text = (s: EditorState, i = 0) => s.doc.firstChild!.child(i).textContent;

describe('cambiar mayúsculas y minúsculas', () => {
  const c = () => ({ sentenceStart: true, wordStart: true });
  it('modos sobre un texto', () => {
    expect(convertCase('hOLA mUNDO', 'lower', c())).toBe('hola mundo');
    expect(convertCase('hola mundo', 'upper', c())).toBe('HOLA MUNDO');
    expect(convertCase('hOLA mUNDO. eSTO ES', 'title', c())).toBe('Hola Mundo. Esto Es');
    expect(convertCase('hOLA mUNDO. eSTO ES. ¿qUÉ tal? bien', 'sentence', c())).toBe('Hola mundo. Esto es. ¿Qué tal? Bien');
    expect(convertCase('Hola Mundo', 'toggle', c())).toBe('hOLA mUNDO');
    expect(convertCase('ñandú ÁRBOL', 'upper', c())).toBe('ÑANDÚ ÁRBOL');
  });
  it('sobre la selección, conservando el formato y sin tocar lo demás', () => {
    // «hola mundo cruel» con «mundo» en negrita
    const doc = nodeTypes.paragraph!.create(null, [writerSchema.text('hola '), writerSchema.text('mundo', [mk('strong')]), writerSchema.text(' cruel')]);
    const s0 = stateOf([doc as never], 2, 12); // «hola mundo»
    const s = run(s0, changeCase('upper'));
    expect(text(s)).toBe('HOLA MUNDO cruel');
    const bold = s.doc.firstChild!.child(0).child(1);
    expect(bold.text).toBe('MUNDO');
    expect(bold.marks.some((m) => m.type.name === 'strong')).toBe(true);
  });
  it('sin selección actúa sobre la palabra del cursor', () => {
    const s = run(stateOf([para('uno dos tres')], 7), changeCase('title'));
    expect(text(s)).toBe('uno Dos tres');
  });
  it('cada párrafo empieza una oración nueva', () => {
    const s = run(stateOf([para('primero. segundo'), para('tercero')], 2, 27), changeCase('sentence'));
    expect(text(s, 0)).toBe('Primero. Segundo');
    expect(text(s, 1)).toBe('Tercero');
  });
});

describe('copiar formato', () => {
  it('captura las marcas de formato y los atributos de párrafo, y los aplica a otra selección', () => {
    const src = para('origen', { align: 'center', indentLeft: 36, lineHeight: 1.5 }, [mk('strong'), mk('color', { value: '#ff0000' }), mk('fontSize', { value: 16 }), mk('underline', { style: 'double', color: null })]);
    const dst = para('destino plano');
    const s0 = stateOf([src, dst]);
    const fmt = captureFormat(s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, 2, 4))));
    expect(fmt.marks.map((m) => m.type.name).sort()).toEqual(['color', 'fontSize', 'strong', 'underline']);
    expect(fmt.para).toMatchObject({ align: 'center', indentLeft: 36, lineHeight: 1.5 });
    const target = stateOf([src, dst], 10, 17); // «destino»
    const out = run(target, applyFormat(fmt, true));
    const d = out.doc.firstChild!.child(1);
    expect(d.attrs).toMatchObject({ align: 'center', indentLeft: 36, lineHeight: 1.5 });
    const marks = d.firstChild!.marks;
    expect(marks.map((m) => m.type.name).sort()).toEqual(['color', 'fontSize', 'strong', 'underline']);
    expect(marks.find((m) => m.type.name === 'underline')!.attrs.style).toBe('double');
  });
  it('quita el formato propio que el origen no tiene', () => {
    const plain = para('simple');
    const rich = para('rico', {}, [mk('em'), mk('highlight', { value: '#ffff00' })]);
    const s0 = stateOf([plain, rich]);
    const fmt = captureFormat(s0.apply(s0.tr.setSelection(TextSelection.create(s0.doc, 2, 4))));
    expect(fmt.marks).toEqual([]);
    const out = run(stateOf([plain, rich], 10, 13), applyFormat(fmt, false));
    expect(out.doc.firstChild!.child(1).firstChild!.marks).toEqual([]);
  });
});
