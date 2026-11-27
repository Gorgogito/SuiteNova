/*
 * The way through a form: its pages (a section starts one), which of them a person goes through according to what they
 * answer, which questions are shown on the way, and the order they are shown in.
 */
import { canDecide, conditionsOf, showIfOf, type Answer, type Condition, type Form, type Question } from './model';
import { norm, shuffled } from './text';

/** Where a section or a choice leads instead of the page that follows: another section, or the end. */
export const END = 'end';

export interface Page {
  /** The section that starts the page; the questions before the first section have none. */
  section: Question | null;
  items: Question[];
}

export function pagesOf(form: Pick<Form, 'questions'>): Page[] {
  const pages: Page[] = [];
  for (const q of form.questions) {
    if (q.type === 'section') pages.push({ section: q, items: [] });
    else {
      if (!pages.length) pages.push({ section: null, items: [] });
      pages[pages.length - 1]!.items.push(q);
    }
  }
  return pages.length ? pages : [{ section: null, items: [] }];
}

/** The text of an answer that conditions compare with. */
function asText(a: Answer | undefined): string[] {
  if (a === null || a === undefined) return [];
  if (Array.isArray(a)) return (a as unknown[]).filter((x): x is string => typeof x === 'string');
  if (typeof a === 'object') return Object.values(a);
  return [String(a)];
}

function met(c: Condition, answers: Record<string, Answer>): boolean {
  const got = asText(answers[c.question]).map(norm);
  const want = norm(c.value);
  if (c.op === 'eq') return got.includes(want);
  if (c.op === 'neq') return !got.includes(want);
  return got.some((g) => g.includes(want));
}

/** Whether the conditions of a question are met, given the questions shown before it. A broken one never hides. */
function passes(form: Form, q: Question, answers: Record<string, Answer>, shown: ReadonlySet<string>): boolean {
  const at = form.questions.indexOf(q);
  const usable = conditionsOf(q).filter((c) => {
    const i = form.questions.findIndex((x) => x.id === c.question);
    return i >= 0 && i < at;
  });
  if (!usable.length) return true;
  // what was not shown has no answer to compare with
  const one = (c: Condition) => shown.has(c.question) && met(c, answers);
  return q.showIf?.anyOf ? usable.some(one) : usable.every(one);
}

/** Where a target leads from page `i`: only forwards; anything else is the page that follows. */
function leads(pages: Page[], i: number, target: string): number {
  if (target === END) return pages.length;
  const j = pages.findIndex((p) => p.section?.id === target);
  return j > i ? j : i + 1;
}

/**
 * The page after page `i` (the number of pages: the end). The last shown question of the page whose chosen option leads
 * somewhere decides; without one, what the section says; without that, the page that follows.
 */
export function pageAfter(pages: Page[], i: number, shown: ReadonlySet<string>, answers: Record<string, Answer>): number {
  let target: string | undefined;
  for (const q of pages[i]!.items) {
    const a = answers[q.id];
    if (shown.has(q.id) && q.branch && typeof a === 'string' && Object.hasOwn(q.branch, a)) target = q.branch[a];
  }
  target ??= pages[i]!.section?.next;
  return target ? leads(pages, i, target) : i + 1;
}

export interface Route {
  /** The pages gone through, in order. */
  pages: number[];
  /** What is shown on them (sections, texts and questions). */
  shown: Set<string>;
}

export function route(form: Form, answers: Record<string, Answer>): Route {
  const pages = pagesOf(form);
  const out: Route = { pages: [], shown: new Set() };
  for (let i = 0; i < pages.length; i = pageAfter(pages, i, out.shown, answers)) {
    out.pages.push(i);
    const p = pages[i]!;
    if (p.section) out.shown.add(p.section.id);
    for (const q of p.items) if (passes(form, q, answers, out.shown)) out.shown.add(q.id);
  }
  return out;
}

/** Whether the form can be shuffled at all: pages keep their order and their questions together. */
export const canShuffle = (form: Pick<Form, 'questions'>): boolean => !form.questions.some((q) => q.type === 'section');

/** Whether a question stays where it is when the others are shuffled. */
export function staysPut(form: Pick<Form, 'questions'>, q: Question): boolean {
  return q.type === 'title' || !!q.locked || !!q.showIf || form.questions.some((x) => conditionsOf(x).some((c) => c.question === q.id));
}

/** The questions in the order a person sees them: texts, locked questions and those tied by a condition keep their place. */
export function displayOrder(form: Pick<Form, 'questions' | 'shuffle'>, seed: string): Question[] {
  if (!form.shuffle || !canShuffle(form)) return form.questions;
  const free = shuffled(
    form.questions.filter((q) => !staysPut(form, q)),
    seed + 'order',
  );
  let next = 0;
  return form.questions.map((q) => (staysPut(form, q) ? q : free[next++]!));
}

/**
 * The questions without what no longer makes sense: conditions that do not look back to a question that can decide, and
 * branches that do not lead forwards to a section there is (or to an option there is not).
 */
export function tidyFlow(questions: Question[]): Question[] {
  const pageOf = new Map<string, number>();
  pagesOf({ questions }).forEach((p, i) => {
    for (const q of [...(p.section ? [p.section] : []), ...p.items]) pageOf.set(q.id, i);
  });
  const sections = new Set(questions.filter((q) => q.type === 'section').map((q) => q.id));
  const forward = (from: Question, target: string) => target === END || (sections.has(target) && pageOf.get(target)! > pageOf.get(from.id)!);
  return questions.map((q, k) => {
    let out = q;
    const conditions = conditionsOf(q);
    const good = conditions.filter((c) => questions.slice(0, k).some((x) => x.id === c.question && canDecide(x)));
    if (good.length !== conditions.length) out = { ...out, showIf: showIfOf(good, q.showIf?.anyOf) };
    if (q.branch) {
      const entries = Object.entries(q.branch).filter(([option, target]) => (q.type === 'choice' || q.type === 'dropdown') && q.options.includes(option) && forward(q, target));
      if (entries.length !== Object.keys(q.branch).length) {
        out = { ...out, branch: Object.fromEntries(entries) };
        if (!entries.length) delete out.branch;
      }
    }
    if (q.next && !(q.type === 'section' && forward(q, q.next))) {
      out = { ...out };
      delete out.next;
    }
    return out;
  });
}
