import nspell from 'nspell';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { SpellEngine, type Misspelling } from './spell-core';

export type SpellLang = 'es' | 'en';
export const SPELL_LANGS: { id: SpellLang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
];

const FILES: Record<SpellLang, { aff: URL; dic: URL }> = {
  es: { aff: new URL('../../node_modules/dictionary-es/index.aff', import.meta.url), dic: new URL('../../node_modules/dictionary-es/index.dic', import.meta.url) },
  en: { aff: new URL('../../node_modules/dictionary-en/index.aff', import.meta.url), dic: new URL('../../node_modules/dictionary-en/index.dic', import.meta.url) },
};

const USER_KEY = 'nova.writer.userDictionary';

function loadUserWords(): string[] {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((w): w is string => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

function saveUserWords(words: string[]): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(words));
  } catch {
    /* no storage: the word is only added for this session */
  }
}

const engines = new Map<SpellLang, Promise<SpellEngine>>();

/** Load (once) the dictionary of a language. The parsing takes a moment, so it is done off the typing path. */
export function loadSpeller(lang: SpellLang): Promise<SpellEngine> {
  let p = engines.get(lang);
  if (!p) {
    p = (async () => {
      const [aff, dic] = await Promise.all([fetch(FILES[lang].aff).then((r) => r.text()), fetch(FILES[lang].dic).then((r) => r.text())]);
      await new Promise((r) => setTimeout(r, 0));
      const engine = new SpellEngine(nspell(aff, dic), loadUserWords());
      return engine;
    })();
    engines.set(lang, p);
    p.catch(() => engines.delete(lang));
  }
  return p;
}

/** Words added to the personal dictionary (shared by every document and language). */
export function addToUserDictionary(engine: SpellEngine, word: string): void {
  engine.add(word);
  const list = loadUserWords();
  if (!list.some((w) => w.toLowerCase() === word.toLowerCase())) saveUserWords([...list, word]);
}

export function userDictionaryWords(): string[] {
  return loadUserWords();
}

export function removeFromUserDictionary(word: string): void {
  saveUserWords(loadUserWords().filter((w) => w !== word));
}

export const spellKey = new PluginKey<{ engine: SpellEngine | null; on: boolean; deco: DecorationSet; list: Misspelling[] }>('nw-spell');

/**
 * Underlines misspelled words while typing. The engine arrives asynchronously (the dictionary is large), and
 * `setSpell(view, ...)` turns checking on/off or changes the language.
 */
export function spellPlugin(): Plugin {
  const build = (doc: import('prosemirror-model').Node, engine: SpellEngine | null, on: boolean) => {
    if (!engine || !on) return { list: [] as Misspelling[], deco: DecorationSet.empty };
    const list = engine.inDoc(doc);
    return { list, deco: DecorationSet.create(doc, list.map((m) => Decoration.inline(m.from, m.to, { class: 'nw-misspelled', 'data-word': m.word }))) };
  };
  return new Plugin({
    key: spellKey,
    state: {
      init: (_c, state) => ({ engine: null as SpellEngine | null, on: true, ...build(state.doc, null, true) }),
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(spellKey) as { engine?: SpellEngine | null; on?: boolean } | undefined;
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

export function setSpell(view: EditorView, patch: { engine?: SpellEngine | null; on?: boolean }): void {
  view.dispatch(view.state.tr.setMeta(spellKey, patch).setMeta('addToHistory', false));
}

/** The misspelled words of the document now, in order. */
export function misspellings(view: EditorView): Misspelling[] {
  return spellKey.getState(view.state)?.list ?? [];
}

export function misspellingAt(view: EditorView, pos: number): Misspelling | null {
  return misspellings(view).find((m) => pos >= m.from && pos <= m.to) ?? null;
}
