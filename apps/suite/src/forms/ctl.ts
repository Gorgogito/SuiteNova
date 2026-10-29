import { newForm, newId, newQuestion, parseResponses, type Answer, type Form, type QType, type Question, type Response } from '@suitenova/forms-core';

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

  commit(next: Doc): void {
    if (next === this.doc) return;
    this.past.push(this.doc);
    if (this.past.length > MAX_UNDO) this.past.shift();
    this.future = [];
    this.doc = next;
    this.dirty = true;
    this.fixSelection();
    this.touch();
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  undo(): void {
    const d = this.past.pop();
    if (!d) return;
    this.future.push(this.doc);
    this.doc = d;
    this.dirty = true;
    this.fixSelection();
    this.touch();
  }
  redo(): void {
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
    this.fileName = name;
    this.filePath = path;
    this.dirty = false;
    this.touch();
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.touch();
  }
  select(id: string | null): void {
    this.selected = id;
    this.touch();
  }

  // ---------- form and questions

  setForm(patch: Partial<Form>): void {
    this.commit({ ...this.doc, form: { ...this.form, ...patch } });
  }
  private setQuestions(qs: Question[]): void {
    this.commit({ ...this.doc, form: { ...this.form, questions: qs } });
  }
  addQuestion(type: QType): Question {
    const q = newQuestion(type);
    const qs = [...this.form.questions];
    const at = this.selectedQuestion ? qs.indexOf(this.selectedQuestion) + 1 : qs.length;
    qs.splice(at, 0, q);
    this.setQuestions(qs);
    this.selected = q.id;
    this.touch();
    return q;
  }
  updateQuestion(id: string, patch: Partial<Question>): void {
    this.setQuestions(this.form.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }
  duplicateQuestion(): void {
    const q = this.selectedQuestion;
    if (!q) return;
    const copy: Question = { ...q, id: newId('q'), options: [...q.options], rows: [...q.rows], correct: [...q.correct], showIf: q.showIf ? { ...q.showIf } : null };
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
    const rest = qs.filter((x) => x !== q).map((x) => (x.showIf?.question === q.id ? { ...x, showIf: null } : x));
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
    // a condition must keep pointing at an earlier question
    const pos = new Map(qs.map((x, k) => [x.id, k]));
    this.setQuestions(qs.map((x, k) => (x.showIf && (pos.get(x.showIf.question) ?? Infinity) >= k ? { ...x, showIf: null } : x)));
  }

  // ---------- responses

  addResponse(answers: Record<string, Answer>): Response {
    const r: Response = { id: newId('r'), at: new Date().toISOString(), answers };
    this.commit({ ...this.doc, responses: [...this.responses, r] });
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
