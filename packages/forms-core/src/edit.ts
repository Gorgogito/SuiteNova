/*
 * Changes to the choices of a question. An answer, a right answer and a condition name a choice (or a row of a grid) by
 * its text, so changing that text has to change all of them.
 */
import { norm } from './logic';
import { conditionsOf, showIfOf, type Answer, type Form, type Question, type Response } from './model';

/** `options`: the choices of a question, or the columns of a grid. `rows`: the rows of a grid. */
export type ItemList = 'options' | 'rows';

export interface Doc {
  form: Form;
  responses: Response[];
}

/** The first name of the series («Opción 3») that is not in the list, counting from its next place. */
export function nextName(list: string[], base: string): string {
  const have = new Set(list.map((x) => x.trim()));
  let n = list.length + 1;
  while (have.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** The list without empty or repeated entries: each gets a name of its own, none is lost. */
export function uniqueTexts(list: string[], base: string): string[] {
  const taken = new Set(list.map((x) => x.trim()).filter(Boolean));
  const seen = new Set<string>();
  return list.map((raw, i) => {
    let x = raw;
    if (!x.trim()) {
      let n = i + 1;
      while (taken.has(`${base} ${n}`)) n++;
      x = `${base} ${n}`;
    } else if (seen.has(x.trim())) {
      let n = 2;
      while (taken.has(`${x.trim()} (${n})`)) n++;
      x = `${x.trim()} (${n})`;
    }
    seen.add(x.trim());
    taken.add(x.trim());
    return x;
  });
}

/** The answers of one person after a choice (or a row) of a question changed its text. */
export function renameInAnswers(q: Question, list: ItemList, from: string, to: string, answers: Record<string, Answer>): Record<string, Answer> {
  const a = answers[q.id];
  if (a === undefined || a === null) return answers;
  const swap = (v: string) => (v === from ? to : v);
  let next: Answer = a;
  if (q.type === 'likert') {
    if (typeof a !== 'object' || Array.isArray(a)) return answers;
    const entries = Object.entries(a);
    if (!entries.some(([row, column]) => (list === 'rows' ? row : column) === from)) return answers;
    next = Object.fromEntries(entries.map(([row, column]) => (list === 'rows' ? [swap(row), column] : [row, swap(column)])));
  } else if (list === 'rows' || q.type === 'file') return answers;
  else if (Array.isArray(a)) {
    const texts = a as string[];
    if (!texts.includes(from)) return answers;
    next = [...new Set(texts.map(swap))];
  } else if (a === from) next = to;
  else return answers;
  return { ...answers, [q.id]: next };
}

/**
 * Gives a choice or a row another text, taking with it the answers, the right answer and the conditions that named it.
 * Throws if the text is empty or already in the list.
 */
export function renameItem(doc: Doc, id: string, list: ItemList, index: number, text: string): Doc {
  const q = doc.form.questions.find((x) => x.id === id);
  const from = q?.[list][index];
  if (!q || from === undefined) return doc;
  const to = text.trim();
  if (to === from) return doc;
  if (!to) throw new Error('No puede quedar vacío.');
  if (q[list].some((x, i) => i !== index && x.trim() === to)) throw new Error('Ya hay otro igual en la lista.');
  const only = q[list].filter((x) => norm(x) === norm(from)).length === 1;
  const questions = doc.form.questions.map((x) => {
    if (x.id === id) {
      const out: Question = { ...x, [list]: x[list].map((v, i) => (i === index ? to : v)) };
      if (list === 'options' && x.type !== 'likert') {
        out.correct = x.correct.map((c) => (c === from ? to : c));
        if (x.feedback) out.feedback = Object.fromEntries(Object.entries(x.feedback).map(([option, said]) => [option === from ? to : option, said]));
        if (x.branch) out.branch = Object.fromEntries(Object.entries(x.branch).map(([option, target]) => [option === from ? to : option, target]));
      }
      return out;
    }
    // a condition compares with a choice (never with the name of a row), without minding capitals or accents
    const named = (v: string) => v === from || (only && norm(v) === norm(from));
    const conditions = conditionsOf(x);
    if (list === 'options' && conditions.some((c) => c.question === id && named(c.value))) return { ...x, showIf: showIfOf(conditions.map((c) => (c.question === id && named(c.value) ? { ...c, value: to } : c)), x.showIf?.anyOf) };
    return x;
  });
  const responses = doc.responses.map((r) => {
    const answers = renameInAnswers(q, list, from, to, r.answers);
    return answers === r.answers ? r : { ...r, answers };
  });
  return { form: { ...doc.form, questions }, responses };
}

/**
 * Takes a choice or a row away. What people had answered is kept (the summary counts it apart); the right answer forgets
 * it, and a condition that asked for it is removed, since it could never be met.
 */
export function removeItem(doc: Doc, id: string, list: ItemList, index: number): Doc {
  const q = doc.form.questions.find((x) => x.id === id);
  const gone = q?.[list][index];
  if (!q || gone === undefined) return doc;
  const questions = doc.form.questions.map((x) => {
    if (x.id === id) {
      const out: Question = { ...x, [list]: x[list].filter((_, i) => i !== index) };
      if (list === 'options' && x.type !== 'likert') {
        out.correct = x.correct.filter((c) => c !== gone);
        if (x.feedback && Object.hasOwn(x.feedback, gone)) {
          out.feedback = Object.fromEntries(Object.entries(x.feedback).filter(([option]) => option !== gone));
          if (!Object.keys(out.feedback).length) delete out.feedback;
        }
        if (x.branch && Object.hasOwn(x.branch, gone)) {
          out.branch = Object.fromEntries(Object.entries(x.branch).filter(([option]) => option !== gone));
          if (!Object.keys(out.branch).length) delete out.branch;
        }
      }
      return out;
    }
    const conditions = conditionsOf(x);
    const left = conditions.filter((c) => !(list === 'options' && c.question === id && c.value === gone));
    return left.length === conditions.length ? x : { ...x, showIf: showIfOf(left, x.showIf?.anyOf) };
  });
  return { ...doc, form: { ...doc.form, questions } };
}
