import type { SpellLang } from '@suitenova/spell-core';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { DocSpellEngine, Misspelling } from './engine';
import { getReviewOptions } from './options';
import { reviewDoc, type Issue } from './review';

interface SpellState {
  engine: DocSpellEngine | null;
  lang: SpellLang;
  on: boolean;
  deco: DecorationSet;
  issues: Issue[];
}

export const spellKey = new PluginKey<SpellState>('nw-spell');

const CLASS: Record<Issue['kind'], string> = { spelling: 'nw-misspelled', grammar: 'nw-grammar', punctuation: 'nw-grammar', style: 'nw-style' };

/**
 * Subraya mientras se escribe: ortografía (rojo) y gramática, puntuación y estilo (azul). El motor llega de forma asíncrona (el diccionario
 * es grande), y `setSpell(view, ...)` activa o desactiva la revisión o cambia el idioma.
 */
export function spellPlugin(): Plugin {
  const build = (doc: PMNode, engine: DocSpellEngine | null, lang: SpellLang, on: boolean): Pick<SpellState, 'issues' | 'deco'> => {
    // sin diccionario todavía no se subraya nada (ni siquiera la gramática: aparecería a medias)
    if (!engine || !on) return { issues: [], deco: DecorationSet.empty };
    const issues = reviewDoc(doc, { engine, lang, options: getReviewOptions() });
    return {
      issues,
      deco: DecorationSet.create(
        doc,
        issues.map((i) => Decoration.inline(i.from, i.to, { class: CLASS[i.kind], 'data-word': i.text, 'data-rule': i.rule })),
      ),
    };
  };
  return new Plugin<SpellState>({
    key: spellKey,
    state: {
      init: (_c, state): SpellState => ({ engine: null, lang: 'es', on: true, ...build(state.doc, null, 'es', true) }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(spellKey) as { engine?: DocSpellEngine | null; on?: boolean; lang?: SpellLang } | undefined;
        if (meta) {
          const engine = meta.engine !== undefined ? meta.engine : value.engine;
          const on = meta.on !== undefined ? meta.on : value.on;
          const lang = meta.lang ?? value.lang;
          return { engine, on, lang, ...build(state.doc, engine, lang, on) };
        }
        if (tr.docChanged && value.engine && value.on) return { ...value, ...build(state.doc, value.engine, value.lang, value.on) };
        return value;
      },
    },
    props: {
      decorations: (state) => spellKey.getState(state)?.deco,
    },
  });
}

export function setSpell(view: EditorView, patch: { engine?: DocSpellEngine | null; on?: boolean; lang?: SpellLang }): void {
  view.dispatch(view.state.tr.setMeta(spellKey, patch).setMeta('addToHistory', false));
}

/** Los problemas del documento ahora (ortografía, gramática, puntuación y estilo), en orden. */
export function issuesOf(view: EditorView): Issue[] {
  return spellKey.getState(view.state)?.issues ?? [];
}

export function issueAt(view: EditorView, pos: number): Issue | null {
  return issuesOf(view).find((m) => pos >= m.from && pos <= m.to) ?? null;
}

/** Las palabras mal escritas del documento ahora, en orden. */
export function misspellings(view: EditorView): Misspelling[] {
  return issuesOf(view)
    .filter((i) => i.kind === 'spelling')
    .map((i) => ({ from: i.from, to: i.to, word: i.text }));
}

export function misspellingAt(view: EditorView, pos: number): Misspelling | null {
  return misspellings(view).find((m) => pos >= m.from && pos <= m.to) ?? null;
}
