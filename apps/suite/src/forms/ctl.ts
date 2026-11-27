import { isEmpty, newForm, newId, newQuestion, parseResponses, removeItem, renameInAnswers, renameItem, type Answer, type Form, type ItemList, type QType, type Question, type Response, conditionsOf, showIfOf, tidyFlow } from '@suitenova/forms-core';

export type Mode = 'design' | 'preview' | 'fill' | 'results';
export interface Doc {
  form: Form;
  responses: Response[];
}
const MAX_UNDO = 100;
/** Selection id that stands for the form's own title and description. */
export const FORM_HEAD = '__form__';

export class FormsCtl {
  doc: Doc = { form: newForm(), responses: [] };
  mode: Mode = 'design';
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
    this.seed = newId('s');
    this.selected = FORM_HEAD;
    this.mode = 'design';
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
    this.load({ form: newForm(), responses: [] }, null, null);
  }
  markSaved(name: string, path: string | null): void {
    this.typing = null;
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }

  setMode(m: Mode): void {
    this.typing = null;
    this.mode = m;
    this.touch();
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
    const copy: Question = { ...q, id: newId('q'), options: [...q.options], rows: [...q.rows], correct: [...q.correct], showIf: showIfOf(conditionsOf(q), q.showIf?.anyOf), ...(q.branch ? { branch: { ...q.branch } } : {}) };
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
    return Object.values(this.draft).some((a) => !isEmpty(a));
  }
  /**
   * Keeps a response that someone filled in here. It is not a change of the design: undoing never takes it away, so it
   * is also added to what the undo would go back to.
   */
  addResponse(answers: Record<string, Answer>): Response {
    const r: Response = { id: newId('r'), at: new Date().toISOString(), answers };
    const keep = (d: Doc): Doc => ({ ...d, responses: [...d.responses, r] });
    this.past = this.past.map(keep);
    this.future = this.future.map(keep);
    this.doc = keep(this.doc);
    this.draft = {};
    this.draftPage = 0;
    this.seed = newId('s');
    this.typing = null;
    this.dirty = true;
    this.touch();
    return r;
  }
  deleteResponse(id: string): void {
    this.commit({ ...this.doc, responses: this.responses.filter((r) => r.id !== id) });
  }
  clearResponses(): void {
    if (this.responses.length) this.commit({ ...this.doc, responses: [] });
  }
  /** Add responses from file text. Returns a message for the user. */
  importResponses(text: string): { added: number; warnings: string[] } {
    const r = parseResponses(text, this.form, this.responses);
    if (r.responses.length) this.commit({ ...this.doc, responses: [...this.responses, ...r.responses] });
    return { added: r.responses.length, warnings: r.warnings };
  }
}
