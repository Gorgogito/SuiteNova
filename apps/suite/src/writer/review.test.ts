import { defaultSection, makeSection, nodeTypes, plainText, writerSchema } from '@suitenova/writer-core';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { applyChanges, commentRanges, listChanges, protectionPlugin, trackTransaction } from './review';

const USER = { name: 'Ana', initials: 'A' };
const para = (t: string, attrs: Record<string, unknown> = {}) => nodeTypes.paragraph!.create(attrs, t ? writerSchema.text(t) : undefined);
const docOf = (...ps: ReturnType<typeof para>[]) => nodeTypes.doc!.create(null, [makeSection(ps, defaultSection())]);

/** The text of the document with deletions in [..] and insertions in {..}. */
function show(state: EditorState): string {
  let out = '';
  state.doc.descendants((node) => {
    if (node.isText) {
      const del = node.marks.some((m) => m.type.name === 'del');
      const ins = node.marks.some((m) => m.type.name === 'ins');
      out += del ? `[${node.text}]` : ins ? `{${node.text}}` : node.text;
    } else if (node.type.name === 'paragraph') {
      if (out && !out.endsWith('|')) out += '|';
      if (node.attrs.ins) out += '+';
      if (node.attrs.del) out += '-';
    }
    return true;
  });
  return out;
}

const start = (...ps: ReturnType<typeof para>[]) => {
  const state = EditorState.create({ doc: docOf(...ps) });
  return { state };
};
const at = (offsetInFirstParagraph: number) => 3 + offsetInFirstParagraph;

/** A view-less dispatcher that applies tracked transactions to a state. */
function run(state: EditorState, make: (s: EditorState) => ReturnType<EditorState['tr']['setMeta']>): EditorState {
  const tr = make(state);
  return state.apply(trackTransaction(tr, state, USER));
}

describe('control de cambios', () => {
  it('lo escrito queda como inserción y se amplía al seguir escribiendo', () => {
    let { state } = start(para('Hola mundo'));
    const pos = 1 + 1 + 4; // inside the paragraph, after "Hola"
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    state = run(state, (s) => s.tr.insertText(' querido', pos));
    state = run(state, (s) => s.tr.insertText('!', pos + 8));
    expect(show(state)).toBe('Hola{ querido!} mundo');
    const changes = listChanges(state.doc);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('ins');
    expect(changes[0]!.author).toBe('Ana');
  });

  it('lo borrado se conserva tachado y el texto propio insertado se borra de verdad', () => {
    let { state } = start(para('Hola mundo'));
    state = run(state, (s) => s.tr.delete(7, 12)); // "mundo"
    expect(show(state)).toBe('Hola [mundo]');
    state = run(state, (s) => s.tr.insertText('amigo', 12));
    expect(show(state)).toBe('Hola [mundo]{amigo}');
    // deleting what we just inserted removes it for real
    state = run(state, (s) => s.tr.delete(12, 17));
    expect(show(state)).toBe('Hola [mundo]');
  });

  it('reemplazar una selección deja lo viejo borrado y lo nuevo insertado', () => {
    let { state } = start(para('uno dos tres'));
    state = run(state, (s) => s.tr.replaceWith(6, 9, writerSchema.text('2')));
    expect(show(state)).toBe('uno [dos]{2} tres');
  });

  it('Intro marca el párrafo y unir párrafos marca la eliminación del salto', () => {
    let { state } = start(para('AB'));
    const split = (s: EditorState) => s.tr.split(3); // between A and B
    state = run(state, split);
    expect(state.doc.firstChild!.childCount).toBe(2);
    expect(state.doc.firstChild!.firstChild!.attrs.ins?.author).toBe('Ana');
    // backspace at the start of the second paragraph: the break is marked as deleted, nothing is joined yet
    const joinPos = state.doc.firstChild!.firstChild!.nodeSize + 1; // start of the second paragraph's content
    let s2 = start(para('uno'), para('dos')).state;
    const from = 1 + 1 + 3; // end of the first paragraph's text
    s2 = run(s2, (s) => s.tr.delete(from, from + 2));
    expect(s2.doc.firstChild!.childCount).toBe(2);
    expect(s2.doc.firstChild!.firstChild!.attrs.del?.author).toBe('Ana');
    void joinPos;
  });

  it('aceptar y rechazar cada tipo de cambio', () => {
    const base = () => start(para('uno dos tres')).state;
    // insertion
    let s = run(base(), (st) => st.tr.insertText('X', 5));
    const v = (state: EditorState) => ({ state, dispatch: (tr: ReturnType<EditorState['tr']['setMeta']>) => void tr }) as never;
    void v;
    const apply = (state: EditorState, accept: boolean): EditorState => {
      let current = state;
      const view = { get state() { return current; }, dispatch: (tr: never) => { current = current.apply(tr); } } as unknown as EditorView;
      applyChanges(view, listChanges(state.doc), accept);
      return current;
    };
    expect(plainText(apply(s, true).doc)).toBe('unoX dos tres');
    expect(plainText(apply(s, false).doc)).toBe('uno dos tres');
    expect(listChanges(apply(s, true).doc)).toHaveLength(0);
    // deletion
    s = run(base(), (st) => st.tr.delete(6, 9));
    expect(plainText(apply(s, true).doc)).toBe('uno  tres');
    expect(plainText(apply(s, false).doc)).toBe('uno dos tres');
    expect(listChanges(apply(s, false).doc)).toHaveLength(0);
    // paragraph split: rejecting joins the two paragraphs again
    const split = run(base(), (st) => st.tr.split(5));
    expect(split.doc.firstChild!.childCount).toBe(2);
    const rejected = apply(split, false);
    expect(rejected.doc.firstChild!.childCount).toBe(1);
    expect(plainText(rejected.doc)).toBe('uno dos tres');
    const accepted = apply(split, true);
    expect(accepted.doc.firstChild!.childCount).toBe(2);
    expect(listChanges(accepted.doc)).toHaveLength(0);
  });

  it('los cambios de formato y de varios pasos se aplican sin registrar', () => {
    const { state } = start(para('uno'));
    const tr = state.tr.addMark(2, 4, writerSchema.marks.strong!.create());
    const next = state.apply(trackTransaction(tr, state, USER));
    expect(listChanges(next.doc)).toHaveLength(0);
  });
});

describe('comentarios', () => {
  it('encuentra el texto de cada comentario y varios pueden cubrir el mismo texto', () => {
    const c1 = writerSchema.marks.comment!.create({ id: 'a' });
    const c2 = writerSchema.marks.comment!.create({ id: 'b' });
    const d = docOf(
      nodeTypes.paragraph!.create(null, [writerSchema.text('uno ', []), writerSchema.text('dos', [c1, c2]), writerSchema.text(' tres', [c2])]),
    );
    const r = commentRanges(d);
    expect(d.textBetween(r.get('a')!.from, r.get('a')!.to)).toBe('dos');
    expect(d.textBetween(r.get('b')!.from, r.get('b')!.to)).toBe('dos tres');
  });
});

describe('protección de la edición', () => {
  const setup = (mode: 'readOnly' | 'comments' | 'forms') => {
    const control = nodeTypes.content_control!.create({ type: 'text', lock: null }, [writerSchema.text('rellenar')]);
    const locked = nodeTypes.content_control!.create({ type: 'text', lock: 'contentLocked' }, [writerSchema.text('fijo')]);
    const d = docOf(nodeTypes.paragraph!.create(null, [writerSchema.text('texto '), control, writerSchema.text(' y '), locked]));
    return EditorState.create({ doc: d, plugins: [protectionPlugin(() => mode)] });
  };
  it('solo lectura no deja cambiar nada', () => {
    const s = setup('readOnly');
    expect(s.applyTransaction(s.tr.insertText('x', 2)).transactions.length).toBe(0);
  });
  it('solo comentarios deja anclar comentarios y nada más', () => {
    const s = setup('comments');
    expect(s.applyTransaction(s.tr.insertText('x', 2)).transactions.length).toBe(0);
    const ok = s.applyTransaction(s.tr.addMark(2, 5, writerSchema.marks.comment!.create({ id: 'k' })));
    expect(ok.transactions.length).toBe(1);
  });
  it('formularios solo deja escribir dentro de los controles de contenido, y no en los bloqueados', () => {
    const s = setup('forms');
    expect(s.applyTransaction(s.tr.insertText('x', 3)).transactions.length).toBe(0); // in the plain text
    // inside the first control: its content starts after "texto " (6 chars) + paragraph open + control open
    const inside = 1 + 1 + 6 + 1 + 2;
    expect(s.applyTransaction(s.tr.insertText('x', inside)).transactions.length).toBe(1);
    const locked = s.doc.firstChild!.firstChild!.child(3);
    let pos = 0;
    s.doc.descendants((n, p) => {
      if (n === locked) pos = p;
      return true;
    });
    expect(s.applyTransaction(s.tr.insertText('x', pos + 2)).transactions.length).toBe(0);
  });
});

void at;
