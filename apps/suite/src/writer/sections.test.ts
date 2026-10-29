import { defaultSection, makeSection, nodeTypes } from '@suitenova/writer-core';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { sectionFixup } from './paginate';

const p = (t: string) => nodeTypes.paragraph!.create(null, t ? nodeTypes.paragraph!.schema.text(t) : undefined);

describe('section structure', () => {
  it('wraps loose blocks after a section into it', () => {
    const doc = nodeTypes.doc!.create(null, [makeSection([p('a')], defaultSection()), p('b'), p('c')]);
    const state = EditorState.create({ doc, plugins: [sectionFixup()] });
    const tr = state.tr.insertText('x', 2);
    const next = state.apply(tr);
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild!.childCount).toBe(3);
  });
  it('wraps loose blocks before the first section', () => {
    const doc = nodeTypes.doc!.create(null, [p('a'), makeSection([p('b')], defaultSection())]);
    const state = EditorState.create({ doc, plugins: [sectionFixup()] });
    const next = state.apply(state.tr.insertText('x', 2));
    expect(next.doc.firstChild!.type.name).toBe('section');
    expect(next.doc.childCount).toBe(2);
  });
});
