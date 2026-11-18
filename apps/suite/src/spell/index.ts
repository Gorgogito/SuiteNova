export { SPELL_LANGS, addToUserDictionary, loadSpeller, removeFromUserDictionary, userDictionaryWords, type SpellLang } from './load';
export { DocSpellEngine, DocSpellEngine as SpellEngine, type Misspelling } from './engine';
export { misspellingAt, misspellings, setSpell, spellKey, spellPlugin } from './pm';
export { findWords, skipWord } from '@suitenova/spell-core';
