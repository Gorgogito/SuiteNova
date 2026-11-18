import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { DocSpellEngine, type Misspelling } from './engine';

export const spellKey = new PluginKey<{ engine: DocSpellEngine | null; on: boolean; deco: DecorationSet; list: Misspelling[] }>('nw-spell');

/**
 * Underlines misspelled words while typing. The engine arrives asynchronously (the dictionary is large), and
 * `setSpell(view, ...)` turns checking on/off or changes the language.
 */
export function spellPlugin(): Plugin {
  const build = (doc: import('prosemirror-model').Node, engine: DocSpellEngine | null, on: boolean) => {
    if (!engine || !on) return { list: [] as Misspelling[], deco: DecorationSet.empty };
    const list = engine.inDoc(doc);
    return { list, deco: DecorationSet.create(doc, list.map((m) => Decoration.inline(m.from, m.to, { class: 'nw-misspelled', 'data-word': m.word }))) };
  };
  return new Plugin({
    key: spellKey,
    state: {
      init: (_c, state) => ({ engine: null as DocSpellEngine | null, on: true, ...build(state.doc, null, true) }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(spellKey) as { engine?: DocSpellEngine | null; on?: boolean } | undefined;
        if (meta) {
          const engine = meta.engine !== undefined ? meta.engine : value.engine;
          const on = meta.on !== undefined ? meta.on : value.on;
          return { engine, on, ...build(state.doc, engine, on) };
        }
        if (tr.docChanged && value.engine && value.on) return { ...value, ...build(state.doc, value.engine, value.on) };
        return value;
      },
    },
    props: {
      decorations: (state) => spellKey.getState(state)?.deco,
    },
  });
}

export function setSpell(view: EditorView, patch: { engine?: DocSpellEngine | null; on?: boolean }): void {
  view.dispatch(view.state.tr.setMeta(spellKey, patch).setMeta('addToHistory', false));
}

/** The misspelled words of the document now, in order. */
export function misspellings(view: EditorView): Misspelling[] {
  return spellKey.getState(view.state)?.list ?? [];
}

export function misspellingAt(view: EditorView, pos: number): Misspelling | null {
  return misspellings(view).find((m) => pos >= m.from && pos <= m.to) ?? null;
}
