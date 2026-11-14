import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { hyphenateText, insertOptionalHyphens, removeOptionalHyphens, stripOptionalHyphens, syllables } from './hyphenate';

describe('sílabas del español', () => {
  const cases: [string, string][] = [
    ['casa', 'ca-sa'],
    ['ahora', 'a-ho-ra'],
    ['país', 'pa-ís'],
    ['aire', 'ai-re'],
    ['reina', 'rei-na'],
    ['teatro', 'te-a-tro'],
    ['electroencefalografista', 'e-lec-tro-en-ce-fa-lo-gra-fis-ta'],
    ['anticonstitucionalmente', 'an-ti-cons-ti-tu-cio-nal-men-te'],
    ['instrucción', 'ins-truc-ción'],
    ['hermano', 'her-ma-no'],
    ['calle', 'ca-lle'],
    ['perro', 'pe-rro'],
    ['chocolate', 'cho-co-la-te'],
    ['pingüino', 'pin-güi-no'],
    ['queso', 'que-so'],
    ['guitarra', 'gui-ta-rra'],
    ['ayuda', 'a-yu-da'],
    ['muy', 'muy'],
    ['biblioteca', 'bi-blio-te-ca'],
    ['atlántico', 'a-tlán-ti-co'],
    ['abstracto', 'abs-trac-to'],
  ];
  for (const [w, s] of cases) it(w, () => expect(syllables(w).join('-')).toBe(s));
});

describe('guiones opcionales', () => {
  it('solo en palabras largas y sin dejar menos de dos letras a cada lado', () => {
    expect(hyphenateText('Esta casa es muy grande')).toBe('Esta casa es muy gran­de'.replace('gran­de', 'gran­de'));
    expect(hyphenateText('amigo')).toBe('amigo'); // corta
    expect(hyphenateText('esdrújula')).toBe('es­drú­ju­la');
    expect(hyphenateText('a-ma')).toBe('a-ma');
  });
  it('no toca las palabras que ya tienen guion opcional ni las siglas', () => {
    expect(hyphenateText('cons­titución')).toBe('cons­titución');
    expect(hyphenateText('UNESCO')).toBe('UNESCO');
  });
  it('quitar es la operación inversa', () => {
    const s = hyphenateText('biblioteca nacional');
    expect(stripOptionalHyphens(s)).toBe('biblioteca nacional');
  });
});

const para = (t: string, marks: import('prosemirror-model').Mark[] = []) => nodeTypes.paragraph!.create(null, t ? writerSchema.text(t, marks) : undefined);
const stateOf = (...p: ReturnType<typeof para>[]) => EditorState.create({ schema: writerSchema, doc: nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, p)]) });
const run = (s: EditorState, cmd: (st: EditorState, d?: (tr: Transaction) => void) => boolean): EditorState => {
  let out = s;
  expect(cmd(s, (tr) => (out = s.apply(tr)))).toBe(true);
  return out;
};
const texts = (s: EditorState) => {
  const o: string[] = [];
  s.doc.firstChild!.forEach((b) => o.push(b.textContent));
  return o;
};

describe('comandos', () => {
  it('sin selección actúa sobre todo el documento y conserva el formato', () => {
    const bold = writerSchema.marks.strong!.create();
    const s = run(stateOf(para('biblioteca'), para('nacional', [bold])), insertOptionalHyphens);
    expect(texts(s)).toEqual(['bi­blio­te­ca', 'na­cio­nal']);
    expect(s.doc.firstChild!.child(1).firstChild!.marks.map((m) => m.type.name)).toEqual(['strong']);
    expect(texts(run(s, removeOptionalHyphens))).toEqual(['biblioteca', 'nacional']);
  });
  it('con selección solo cambia lo seleccionado', () => {
    let s = stateOf(para('biblioteca'), para('nacional'));
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3, 13)));
    const out = run(s, insertOptionalHyphens);
    expect(texts(out)[1]).toBe('nacional');
    expect(texts(out)[0]).toContain('­');
  });
  it('no hace nada si no hay palabras que dividir', () => {
    expect(insertOptionalHyphens(stateOf(para('sol y mar')))).toBe(false);
    expect(removeOptionalHyphens(stateOf(para('sol')))).toBe(false);
  });
});
