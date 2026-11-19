/**
 * Autocorrección al escribir en el texto de una diapositiva: comillas, símbolos, mayúscula inicial, reemplazos, ordinales con superíndice y
 * `*negrita*`/`_cursiva_`. La lógica es la de `spell-core`; aquí solo se aplica sobre el texto con formato de las diapositivas (marca `run`).
 * Sin vínculos ni listas automáticas ni líneas de borde, que las diapositivas no tienen.
 */
import { slidesSchema, type RunProps } from '@suitenova/slides-core';
import { SYMBOLS, autoLangOf, correctWord, findMarkup, loadAutoCorrectFrom, smartQuote, type AutoCorrectOptions } from '@suitenova/spell-core';
import { closeHistory } from 'prosemirror-history';
import { Plugin, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { getAutoCorrect } from '../../spell';
import { slidesLang, slidesMarkInfo } from '../spell';

const IMMEDIATE = ['(c)', '(r)', '(tm)', '(e)', '...', '-->', '<--', '==>', '<==', '<=>'];
const runType = slidesSchema.marks.run!;

/** Cambia las propiedades del tramo [a, b) tal como están en cada trozo de texto. */
function mapRun(tr: Transaction, a: number, b: number, fn: (r: RunProps) => RunProps): void {
  const spans: { a: number; b: number; r: RunProps }[] = [];
  tr.doc.nodesBetween(a, b, (n, pos) => {
    if (n.isText) spans.push({ a: Math.max(a, pos), b: Math.min(b, pos + n.nodeSize), r: (n.marks.find((m) => m.type === runType)?.attrs.r as RunProps | undefined) ?? {} });
  });
  for (const s of spans) {
    const next = fn(s.r);
    tr.removeMark(s.a, s.b, runType);
    if (Object.keys(next).length) tr.addMark(s.a, s.b, runType.create({ r: next }));
  }
}

/** Las opciones con la lista y las excepciones del idioma del texto (el del tramo, o el de la presentación). */
function optionsFor(base: AutoCorrectOptions, tag: string | null | undefined): AutoCorrectOptions {
  const lang = autoLangOf(tag ?? slidesLang());
  if (lang === base.lang) return base;
  try {
    const l = loadAutoCorrectFrom(localStorage, lang);
    return { ...base, lang, exceptions: l.exceptions, custom: l.custom };
  } catch {
    return base;
  }
}

export function slidesAutoCorrectPlugin(getOptions: () => AutoCorrectOptions = getAutoCorrect): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view: EditorView, from, to, text) {
        const state = view.state;
        const $from = state.doc.resolve(from);
        if (!$from.parent.isTextblock) return false;
        const prev = from > $from.start() ? state.doc.nodeAt(from - 1) : null;
        const o = optionsFor(getOptions(), prev?.isText ? slidesMarkInfo(prev).lang : null);
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\u0001');
        if (o.smartQuotes && (text === '"' || text === "'")) {
          view.dispatch(closeHistory(state.tr).insertText(smartQuote(text, before.endsWith('\u0001') ? ' ' : before), from, to));
          return true;
        }
        if (from !== to) return false;
        // *negrita* y _cursiva_
        if (o.markup && (text === '*' || text === '_')) {
          const m = findMarkup(before + text);
          if (m) {
            const open = $from.start() + m.open;
            const tr = closeHistory(state.tr);
            mapRun(tr, open + 1, from, (r) => (m.kind === 'bold' ? { ...r, b: true } : { ...r, i: true }));
            tr.delete(open, open + 1);
            tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from)));
            tr.setStoredMarks([]);
            view.dispatch(tr.scrollIntoView());
            return true;
          }
        }
        // símbolos al instante
        if (o.symbols && text.length === 1) {
          const line = before.replace(/\u0001/g, '') + text;
          for (const key of IMMEDIATE) {
            if (line.endsWith(key)) {
              const start = from - (key.length - 1);
              view.dispatch(closeHistory(state.tr).replaceWith(start, from, state.schema.text(SYMBOLS[key]!, state.doc.resolve(from).marks())).scrollIntoView());
              return true;
            }
          }
        }
        // palabra completada por un espacio o un signo
        if (text.length !== 1 || !/[\s.,;:!?)\]]/.test(text)) return false;
        let i = before.length;
        while (i > 0 && !/[\s \u0001]/.test(before[i - 1]!)) i--;
        const word = before.slice(i);
        if (!word) return false;
        if (/[.,;:!?)\]]/.test(text) && /^[.,;:!?)\]\d]+$/.test(word)) return false;
        // «a.» «1.» al empezar un párrafo son marcadores de lista
        if ((text === '.' || text === ')') && before.slice(0, i).trim() === '' && /^([a-zA-Z]|[ivxlcdmIVXLCDM]{1,4}|\d+)$/.test(word)) return false;
        const fix = correctWord(word, before.slice(0, i).replace(/\u0001/g, ' '), { ...o, autoLinks: false });
        if (!fix || (fix.text === word && !fix.sup)) return false;
        const start = from - word.length;
        const tr = closeHistory(state.tr);
        tr.replaceWith(start, from, state.schema.text(fix.text, state.doc.resolve(from).marks()));
        tr.insertText(text, tr.mapping.map(from));
        if (fix.sup) mapRun(tr, start + fix.sup[0], start + fix.sup[1], (r) => ({ ...r, baseline: 30 }));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}
