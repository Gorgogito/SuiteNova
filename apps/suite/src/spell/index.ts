export { SPELL_LANGS, addToUserDictionary, loadSpeller, removeFromUserDictionary, userDictionaryWords, type SpellLang } from './load';
export { DocSpellEngine, DocSpellEngine as SpellEngine, type Misspelling } from './engine';
export { issueAt, issuesOf, misspellingAt, misspellings, setSpell, spellKey, spellPlugin } from './pm';
export { KIND_LABEL, applyFix, fixesOf, reviewDoc, type Issue, type IssueKind, type ReviewCtx, type ReviewFix } from './review';
export { getReviewOptions, ignoreOnce, onReviewOptions, resetIgnored, setReviewOptions } from './options';
export { findWords, skipWord, skipWordWith, type ReviewOptions } from '@suitenova/spell-core';
export { DictionaryDialog, EditorPane, ReviewDialog, ReviewMenu, ReviewOptionsDialog, goToIssue, useReview, type LocatedIssue, type ReviewHost } from './ui';
export { ignoreWord } from './load';
export { notifyReview } from './options';
