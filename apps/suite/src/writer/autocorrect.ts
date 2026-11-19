/**
 * Autocorrección al escribir (como la de Word): comillas inteligentes, símbolos y fracciones, rayas, mayúscula inicial,
 * dos mayúsculas iniciales, vínculos automáticos y listas automáticas. La lógica es pura y se prueba sola; el plugin
 * de ProseMirror solo la aplica cuando se completa una palabra.
 */
import { InputRule, inputRules, wrappingInputRule } from 'prosemirror-inputrules';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { closeHistory } from 'prosemirror-history';
import { Plugin, type EditorState, type Transaction } from 'prosemirror-state';
import { markTypes, nodeTypes } from '@suitenova/writer-core';
import { AUTOCORRECT_KEY, DEFAULT_AUTOCORRECT, FRACTIONS, SYMBOLS, autoLangOf, correctWord, findMarkup, loadAutoCorrectFrom, ruleLineKind, saveAutoCorrectTo, smartQuote, startsSentence, type AutoCorrectOptions, type Correction, type RuleKind } from '@suitenova/spell-core';

export { AUTOCORRECT_KEY, DEFAULT_AUTOCORRECT, FRACTIONS, SYMBOLS, correctWord, smartQuote, startsSentence, type AutoCorrectOptions, type Correction };

/** Símbolos que se cambian al instante (los demás esperan a que se complete la palabra). */
const IMMEDIATE = ['(c)', '(r)', '(tm)', '(e)', '...', '-->', '<--', '==>', '<==', '<=>'];

export function loadAutoCorrect(): AutoCorrectOptions {
  try {
    return loadAutoCorrectFrom(localStorage);
  } catch {
    return loadAutoCorrectFrom(null);
  }
}

export function saveAutoCorrect(o: AutoCorrectOptions): void {
  try {
    saveAutoCorrectTo(localStorage, o);
  } catch {
    /* sin almacenamiento */
  }
}

// ---------------------------------------------------------------------------------------------- plugin
/** Dónde empieza la palabra que acaba en `pos` dentro de su párrafo (sin espacios dentro). */
function wordBefore(state: EditorState, pos: number): { from: number; word: string; before: string } | null {
  const $p = state.doc.resolve(pos);
  if (!$p.parent.isTextblock) return null;
  const text = $p.parent.textBetween(0, $p.parentOffset, undefined, '\u0001');
  let i = text.length;
  while (i > 0 && !/[\s \u0001]/.test(text[i - 1]!)) i--;
  const word = text.slice(i);
  if (!word) return null;
  return { from: pos - word.length, word, before: text.slice(0, i).replace(/\u0001/g, ' ') };
}

/** Las opciones con la lista y las excepciones del idioma que pide el texto (`null`, `off` o el mismo idioma: las de siempre). */
function optionsFor(base: AutoCorrectOptions, tag: string | null | undefined): AutoCorrectOptions {
  if (!tag || tag === 'off') return base;
  const lang = autoLangOf(tag);
  if (lang === base.lang) return base;
  try {
    const l = loadAutoCorrectFrom(localStorage, lang);
    return { ...base, lang, exceptions: l.exceptions, custom: l.custom };
  } catch {
    return base;
  }
}

/** `*negrita*` y `_cursiva_`: al escribir el marcador de cierre, los marcadores desaparecen y el texto de en medio toma el formato. */
function applyMarkup(view: EditorView, from: number, text: string): boolean {
  const state = view.state;
  const $from = state.doc.resolve(from);
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '') + text;
  const m = findMarkup(before);
  if (!m) return false;
  const mark = m.kind === 'bold' ? markTypes.strong : markTypes.em;
  if (!mark) return false;
  const base = $from.start();
  const openPos = base + m.open;
  const tr = closeHistory(state.tr);
  tr.addMark(openPos + 1, from, mark.create());
  tr.delete(openPos, openPos + 1);
  const end = tr.mapping.map(from);
  tr.setSelection(TextSelection.create(tr.doc, end));
  tr.removeStoredMark(mark);
  view.dispatch(tr.scrollIntoView());
  return true;
}

const RULE_LOOK: Record<RuleKind, { style: string; width: number }> = {
  thin: { style: 'single', width: 0.75 },
  thick: { style: 'single', width: 2.25 },
  double: { style: 'double', width: 0.75 },
  dotted: { style: 'dotted', width: 0.75 },
  wavy: { style: 'wave', width: 0.75 },
  triple: { style: 'triple', width: 0.75 },
};

/** Intro en un párrafo que solo trae `---`, `___`, `===`, `***`, `~~~` o `###`: el texto se quita, el párrafo toma el borde inferior y debajo queda un párrafo nuevo. */
export function ruleLineCommand(getOptions: () => AutoCorrectOptions): (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean {
  return (state, dispatch) => {
    if (!getOptions().borders) return false;
    const { $from, empty } = state.selection;
    if (!empty || !$from.parent.isTextblock || $from.parent.type !== nodeTypes.paragraph || $from.parentOffset !== $from.parent.content.size) return false;
    const kind = ruleLineKind($from.parent.textContent);
    if (!kind || $from.parent.childCount !== 1 || !$from.parent.firstChild?.isText) return false;
    if (dispatch) {
      const look = RULE_LOOK[kind];
      const start = $from.start();
      const end = $from.end();
      const tr = closeHistory(state.tr);
      tr.delete(start, end);
      tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, border: { sides: 'bottom', style: look.style, width: look.width, color: '#000000', space: 1 } });
      const after = tr.mapping.map($from.after());
      tr.insert(after, nodeTypes.paragraph!.create({ ...$from.parent.attrs, border: null }));
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Completa la palabra anterior al carácter escrito, o pone la comilla tipográfica. `getLang` da el idioma del texto de una posición (la lista y las excepciones son las de ese idioma). */
export function autoCorrectPlugin(getOptions: () => AutoCorrectOptions, getLang?: (view: EditorView, pos: number) => string | null | undefined): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        const o = optionsFor(getOptions(), getLang?.(view, from));
        const state = view.state;
        if (state.selection.$from.parent.type.spec.code) return false;
        const $from = state.doc.resolve(from);
        if (!$from.parent.isTextblock) return false;
        // comillas tipográficas
        if (o.smartQuotes && (text === '"' || text === "'")) {
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\u0001');
          const q = smartQuote(text, before.endsWith('\u0001') ? ' ' : before);
          view.dispatch(closeHistory(state.tr).insertText(q, from, to));
          return true;
        }
        // *negrita* y _cursiva_
        if (o.markup && (text === '*' || text === '_') && from === to && applyMarkup(view, from, text)) return true;
        // símbolos que se sustituyen en cuanto se escribe su última tecla: (c) (r) (tm) (e) ... --> <-- ==> <== <=>
        if (o.symbols && text.length === 1 && from === to) {
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '') + text;
          for (const key of IMMEDIATE) {
            if (before.endsWith(key)) {
              const start = from - (key.length - 1);
              const tr = closeHistory(state.tr);
              tr.replaceWith(start, from, state.schema.text(SYMBOLS[key]!, state.doc.resolve(from).marks()));
              view.dispatch(tr.scrollIntoView());
              return true;
            }
          }
        }
        // palabra completada por un espacio o un signo de puntuación
        if (text.length !== 1 || !/[\s.,;:!?)\]]/.test(text) || from !== to) return false;
        const w = wordBefore(state, from);
        if (!w) return false;
        // «a.» «i)» «B.» al empezar un párrafo son marcadores de lista, no una palabra que capitalizar
        if ((text === '.' || text === ')') && w.before.trim() === '' && /^([a-zA-Z]|[ivxlcdmIVXLCDM]{1,4}|\d+)$/.test(w.word)) return false;
        // un punto o una coma dentro de «...» / «3.5» no cierran palabra: solo espacios y signos tras letras o símbolos
        if (/[.,;:!?)\]]/.test(text) && /^[.,;:!?)\]\d]+$/.test(w.word)) return false;
        const fix = correctWord(w.word, w.before, o);
        if (!fix || (fix.text === w.word && !fix.href && !fix.sup)) return false;
        const tr: Transaction = closeHistory(state.tr);
        const marks = state.doc.resolve(from).marks();
        const mapped = fix.href ? [...marks.filter((m) => m.type !== markTypes.link), markTypes.link!.create({ href: fix.href })] : marks;
        tr.replaceWith(w.from, from, state.schema.text(fix.text, mapped));
        tr.insertText(text, tr.mapping.map(from));
        // lo que se escribe después de un vínculo no hereda el vínculo
        if (fix.href) tr.removeStoredMark(markTypes.link!);
        // ordinales en inglés: las letras en superíndice
        if (fix.sup && markTypes.superscript) tr.addMark(w.from + fix.sup[0], w.from + fix.sup[1], markTypes.superscript.create());
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}

/** Listas automáticas: «1. », «a. », «A. », «i. », «I. » y «- » al empezar un párrafo (con las opciones activadas). */
export function autoListRules(getOptions: () => AutoCorrectOptions): ReturnType<typeof inputRules> {
  type Inner = { match: RegExp; handler: (s: EditorState, m: RegExpMatchArray, a: number, b: number) => Transaction | null };
  const gate = (rule: InputRule) => {
    const r = rule as unknown as Inner;
    return new InputRule(r.match, (state, match, start, end) => (getOptions().autoLists ? r.handler(state, match, start, end) : null));
  };
  const ord = nodeTypes.ordered_list!;
  const letter = (re: RegExp, format: string) => gate(wrappingInputRule(re, ord, () => ({ start: 1, format })));
  return inputRules({
    rules: [
      gate(wrappingInputRule(/^\s*([-+*•])\s$/, nodeTypes.bullet_list!)),
      gate(wrappingInputRule(/^(\d+)[.)]\s$/, ord, (m) => ({ start: Number(m[1]), format: 'decimal' }), (m, node) => node.childCount + (node.attrs.start as number) === Number(m[1]))),
      letter(/^a[.)]\s$/, 'lowerLetter'),
      letter(/^A[.)]\s$/, 'upperLetter'),
      letter(/^i[.)]\s$/, 'lowerRoman'),
      letter(/^I[.)]\s$/, 'upperRoman'),
    ],
  });
}
