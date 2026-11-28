import { getLocale } from '@suitenova/core-ui';
import { isEmpty, newForm, newId, newQuestion, parseResponses, removeItem, renameInAnswers, renameItem, type Answer, type Form, type ItemList, type QType, type Question, type Response, conditionsOf, showIfOf, tidyFlow, MAX_NAME, type Review, sortResponses, validSeconds, type ResultFilter, type SortKey } from '@suitenova/forms-core';

export type Mode = 'design' | 'preview' | 'fill' | 'results';
export interface Doc {
  form: Form;
  responses: Response[];
}
const MAX_UNDO = 100;
/** Selection id that stands for the form's own title and description. */
export const FORM_HEAD = '__form__';

/** A new form speaks the language of the program to whoever answers it. */
const blankForm = (): Form => (getLocale().startsWith('en') ? { ...newForm(), language: 'en' } : newForm());

export type ResultsView = 'summary' | 'table' | 'individual' | 'grade';

export class FormsCtl {
  doc: Doc = { form: blankForm(), responses: [] };
  mode: Mode = 'design';
  /** What is looked at among the results, which responses, in what order and which one by itself. */
  resultsView: ResultsView = 'summary';
  filter: ResultFilter = {};
  sort: { key: SortKey; descending: boolean } | null = null;
  shownResponse: string | null = null;
  selected: string | null = FORM_HEAD;
  fileName: string | null = null;
  filePath: string | null = null;
  dirty = false;
  message = '';
  /** The answer being filled in: it stays while looking at the design or the results. */
  draft: Record<string, Answer> = {};
  /** Starts the order of the shuffled options of the answer being filled in: another one for each answer. */
  seed = newId('s');
  /** The page the answer being filled in is on. */
  draftPage = 0;
  /** Who says they are answering, and when they started (with a time limit). */
  draftName = '';
  draftStarted: number | null = null;
  /** Since when the questions are in front of whoever is answering: how long it takes. */
  draftOpened: number | null = null;
  /** How the preview shows the form. */
  device: 'desktop' | 'phone' = 'desktop';
  /** The box being typed in: its letters count as one change. */
  private typing: string | null = null;
  private past: Doc[] = [];
  private future: Doc[] = [];
  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = (): number => this.version;
  touch(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get form(): Form {
    return this.doc.form;
  }
  get responses(): Response[] {
    return this.doc.responses;
  }
  get docTitle(): string {
    return `${this.fileName ?? this.form.title}${this.dirty ? ' •' : ''}`;
  }
  get selectedQuestion(): Question | null {
    return this.form.questions.find((q) => q.id === this.selected) ?? null;
  }
  /** A new form nobody has touched takes the language of the program, which is known a moment after starting. */
  followLanguage(locale: string): void {
    if (this.dirty || this.fileName || this.past.length || this.future.length) return;
    const language = locale.startsWith('en') ? ('en' as const) : undefined;
    if (this.form.language === language) return;
    this.doc = { ...this.doc, form: { ...this.form, language } };
    this.touch();
  }
  say(msg: string): void {
    this.message = msg;
    this.touch();
  }

  // ---------- history

  /** Applies a change that can be undone. Changes with the same `typing` name, one after another, are one. */
  commit(next: Doc, typing?: string): void {
    if (next === this.doc) return;
    if (!typing || typing !== this.typing) {
      this.past.push(this.doc);
      if (this.past.length > MAX_UNDO) this.past.shift();
    }
    this.typing = typing ?? null;
    this.future = [];
    this.doc = next;
    this.dirty = true;
    this.fixSelection();
    this.touch();
  }
  /** What is typed from now on is another change. */
  endTyping(): void {
    this.typing = null;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  undo(): void {
    this.typing = null;
    const d = this.past.pop();
    if (!d) return;
    this.future.push(this.doc);
    this.doc = d;
    this.dirty = true;
    this.fixSelection();
    this.touch();
  }
  redo(): void {
    this.typing = null;
    const d = this.future.pop();
    if (!d) return;
    this.past.push(this.doc);
    this.doc = d;
    this.dirty = true;
    this.fixSelection();
    this.touch();
  }
  private fixSelection(): void {
    if (this.selected && this.selected !== FORM_HEAD && !this.form.questions.some((q) => q.id === this.selected)) this.selected = FORM_HEAD;
  }

  load(doc: Doc, name: string | null, path: string | null): void {
    this.doc = doc;
    this.past = [];
    this.future = [];
    this.typing = null;
    this.draft = {};
    this.draftPage = 0;
    this.draftName = '';
    this.draftStarted = null;
    this.draftOpened = null;
    this.seed = newId('s');
    this.selected = FORM_HEAD;
    this.mode = 'design';
    this.resultsView = 'summary';
    this.filter = {};
    this.sort = null;
    this.shownResponse = null;
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.message = '';
    this.touch();
  }
  /** A form brought from elsewhere: it has no file yet, so it counts as unsaved. */
  loadImported(doc: Doc): void {
    this.load(doc, null, null);
    this.dirty = true;
    this.mode = doc.responses.length ? 'results' : 'design';
    this.touch();
  }
  reset(): void {
    this.load({ form: blankForm(), responses: [] }, null, null);
  }
  /** `whole`: false when something changed while it was being written, so there is still something to save. */
  markSaved(name: string, path: string | null, whole = true): void {
    this.typing = null;
    this.fileName = name;
    this.filePath = path;
    this.dirty = !whole;
    this.touch();
  }

  setMode(m: Mode): void {
    this.typing = null;
    this.mode = m;
    this.touch();
  }
  setFilter(patch: ResultFilter): void {
    this.filter = { ...this.filter, ...patch };
    this.touch();
  }
  clearFilter(): void {
    this.filter = {};
    this.touch();
  }
  setSort(sort: { key: SortKey; descending: boolean } | null): void {
    this.sort = sort;
    this.touch();
  }
  /** The responses in the order chosen (without one, as they arrived). */
  ordered(list: Response[]): Response[] {
    return this.sort ? sortResponses(this.form, list, this.sort.key, this.sort.descending) : list;
  }
  /** Looks at one response by itself. */
  showResponse(id: string): void {
    this.shownResponse = id;
    this.resultsView = 'individual';
    this.touch();
  }
  setResultsView(view: ResultsView): void {
    this.typing = null;
    this.resultsView = view;
    this.touch();
  }

  // ---------- marking: it changes a response and can be undone

  private setReview(id: string, change: (now: Review) => Review, typing?: string): void {
    const responses = this.responses.map((r) => {
      if (r.id !== id) return r;
      const next = change(r.review ?? {});
      // nothing empty is kept
      for (const key of ['points', 'comments'] as const) if (next[key] && !Object.keys(next[key]!).length) delete next[key];
      if (!next.comment) delete next.comment;
      if (!next.done) delete next.done;
      const { review: _before, ...bare } = r;
      return Object.keys(next).length ? { ...bare, review: next } : bare;
    });
    this.commit({ ...this.doc, responses }, typing);
  }
  setPoints(id: string, question: string, points: number | undefined): void {
    this.setReview(id, (now) => {
      const all = { ...now.points };
      if (points === undefined) delete all[question];
      else all[question] = points;
      return { ...now, points: all };
    });
  }
  setComment(id: string, question: string, text: string): void {
    this.setReview(
      id,
      (now) => {
        const all = { ...now.comments, [question]: text };
        if (!text) delete all[question];
        return { ...now, comments: all };
      },
      `comment:${id}:${question}`,
    );
  }
  setGeneralComment(id: string, comment: string): void {
    this.setReview(id, (now) => ({ ...now, comment }), `comment:${id}`);
  }
  setReviewed(id: string, done: boolean): void {
    this.setReview(id, (now) => ({ ...now, done }));
  }

  select(id: string | null): void {
    this.typing = null;
    this.selected = id;
    this.touch();
  }

  // ---------- form and questions

  setForm(patch: Partial<Form>, typing = false): void {
    this.commit({ ...this.doc, form: { ...this.form, ...patch } }, typing ? `form:${Object.keys(patch).join()}` : undefined);
  }
  private setQuestions(qs: Question[]): void {
    this.commit({ ...this.doc, form: { ...this.form, questions: qs } });
  }
  addQuestion(type: QType): Question {
    const q = newQuestion(type);
    const qs = [...this.form.questions];
    const at = this.selectedQuestion ? qs.indexOf(this.selectedQuestion) + 1 : qs.length;
    qs.splice(at, 0, q);
    // with the first section, what comes before it becomes a section too: every question is in one
    if (type === 'section' && at > 0 && !this.form.questions.some((x) => x.type === 'section')) qs.unshift(newQuestion('section'));
    this.setQuestions(qs);
    this.selected = q.id;
    this.touch();
    return q;
  }
  updateQuestion(id: string, patch: Partial<Question>, typing = false): void {
    this.commit({ ...this.doc, form: { ...this.form, questions: this.form.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) } }, typing ? `${id}:${Object.keys(patch).join()}` : undefined);
  }
  /** Gives a choice or a row another text. Returns why it was refused, or null. */
  renameItem(id: string, list: ItemList, index: number, text: string): string | null {
    const q = this.form.questions.find((x) => x.id === id);
    const from = q?.[list][index];
    try {
      const next = renameItem(this.doc, id, list, index, text);
      if (next !== this.doc) {
        this.draft = renameInAnswers(q!, list, from!, text.trim(), this.draft);
        this.commit(next);
      }
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }
  removeItem(id: string, list: ItemList, index: number): void {
    const next = removeItem(this.doc, id, list, index);
    if (next !== this.doc) this.commit(next);
  }
  duplicateQuestion(): void {
    const q = this.selectedQuestion;
    if (!q) return;
    const copy: Question = { ...q, id: newId('q'), options: [...q.options], rows: [...q.rows], correct: [...q.correct], showIf: showIfOf(conditionsOf(q), q.showIf?.anyOf), ...(q.branch ? { branch: { ...q.branch } } : {}), ...(q.feedback ? { feedback: { ...q.feedback } } : {}) };
    const qs = [...this.form.questions];
    qs.splice(qs.indexOf(q) + 1, 0, copy);
    this.setQuestions(qs);
    this.selected = copy.id;
    this.touch();
  }
  deleteQuestion(): void {
    const q = this.selectedQuestion;
    if (!q) return;
    const qs = this.form.questions;
    const i = qs.indexOf(q);
    // answers to this question go away from the saved responses too; conditions that used it are removed
    // conditions that used it go, and so do the branches that led to it
    const rest = tidyFlow(qs.filter((x) => x !== q));
    const responses = this.responses.map((r) => {
      if (!(q.id in r.answers)) return r;
      const answers = { ...r.answers };
      delete answers[q.id];
      // its marks go with it
      if (r.review?.points || r.review?.comments) {
        const without = <T,>(o: Record<string, T> | undefined) => o && Object.fromEntries(Object.entries(o).filter(([id]) => id !== q.id));
        return { ...r, answers, review: { ...r.review, points: without(r.review.points), comments: without(r.review.comments) } };
      }
      return { ...r, answers };
    });
    this.commit({ form: { ...this.form, questions: rest }, responses });
    this.selected = rest[Math.min(i, rest.length - 1)]?.id ?? FORM_HEAD;
    this.touch();
  }
  get canMove(): (dir: -1 | 1) => boolean {
    return (dir) => {
      const q = this.selectedQuestion;
      if (!q) return false;
      const i = this.form.questions.indexOf(q);
      const j = i + dir;
      return j >= 0 && j < this.form.questions.length;
    };
  }
  moveQuestion(dir: -1 | 1): void {
    const q = this.selectedQuestion;
    if (!q || !this.canMove(dir)) return;
    const qs = [...this.form.questions];
    const i = qs.indexOf(q);
    [qs[i], qs[i + dir]] = [qs[i + dir]!, qs[i]!];
    // conditions must keep looking back, and branches forwards
    this.setQuestions(tidyFlow(qs));
  }

  // ---------- responses

  setDraftPage(page: number): void {
    this.draftPage = page;
    this.touch();
  }
  setDraft(answers: Record<string, Answer>): void {
    this.draft = answers;
    this.touch();
  }
  get hasDraft(): boolean {
    return !!this.draftName.trim() || Object.values(this.draft).some((a) => !isEmpty(a));
  }
  setDraftName(name: string): void {
    this.draftName = name;
    this.touch();
  }
  setDraftOpened(at: number | null): void {
    // nothing on screen depends on it
    this.draftOpened = at;
  }
  setDraftStarted(at: number | null): void {
    this.draftStarted = at;
    this.touch();
  }
  setDevice(device: 'desktop' | 'phone'): void {
    this.device = device;
    this.touch();
  }
  /**
   * Keeps a response that someone filled in here. It is not a change of the design: undoing never takes it away, so it
   * is also added to what the undo would go back to.
   */
  addResponse(answers: Record<string, Answer>, name = '', seconds?: number): Response {
    const who = name.trim().slice(0, MAX_NAME);
    const r: Response = { id: newId('r'), at: new Date().toISOString(), answers, ...(who ? { name: who } : {}), ...(validSeconds(seconds) ? { seconds } : {}) };
    this.keep(r);
    this.draft = {};
    this.draftPage = 0;
    this.draftName = '';
    this.draftStarted = null;
    this.draftOpened = null;
    this.seed = newId('s');
    this.touch();
    return r;
  }
  /** A response that arrived by itself: like the ones filled in here, but without touching what is being filled in. */
  addReceived(r: Response): void {
    this.keep(r);
    this.touch();
  }
  private keep(r: Response): void {
    const add = (d: Doc): Doc => ({ ...d, responses: [...d.responses, r] });
    this.past = this.past.map(add);
    this.future = this.future.map(add);
    this.doc = add(this.doc);
    this.typing = null;
    this.dirty = true;
  }
  deleteResponse(id: string): void {
    this.commit({ ...this.doc, responses: this.responses.filter((r) => r.id !== id) });
  }
  clearResponses(): void {
    if (this.responses.length) this.commit({ ...this.doc, responses: [] });
  }
  /** The responses of several files at once, as one change; a file that cannot be read is told and left out. */
  importMany(texts: string[]): { added: number; warnings: string[] } {
    let responses = this.responses;
    const warnings: string[] = [];
    for (const text of texts) {
      try {
        const r = parseResponses(text, this.form, responses);
        responses = [...responses, ...r.responses];
        warnings.push(...r.warnings);
      } catch (e) {
        warnings.push((e as Error).message);
      }
    }
    const added = responses.length - this.responses.length;
    if (added) this.commit({ ...this.doc, responses });
    return { added, warnings };
  }
  /** Add responses from file text. Returns a message for the user. */
  importResponses(text: string): { added: number; warnings: string[] } {
    const r = parseResponses(text, this.form, this.responses);
    if (r.responses.length) this.commit({ ...this.doc, responses: [...this.responses, ...r.responses] });
    return { added: r.responses.length, warnings: r.warnings };
  }
}
