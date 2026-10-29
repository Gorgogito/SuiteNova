import { gradable, isInput, type Answer, type Form, type Question, type Response } from './model';

/*
 * Rules shared by the editor, the fill-in screen and the standalone HTML. The HTML carries its own copy of these
 * functions (see html.ts); a test runs both on the same inputs.
 */

export const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export const isEmpty = (a: Answer | undefined): boolean => {
  if (a === null || a === undefined) return true;
  if (typeof a === 'string') return a.trim() === '';
  if (Array.isArray(a)) return a.length === 0;
  if (typeof a === 'object') return Object.values(a).every((v) => !v);
  return false;
};

/** Text that a condition compares with: the answer, or the chosen options joined. */
function asText(a: Answer | undefined): string[] {
  if (a === null || a === undefined) return [];
  if (Array.isArray(a)) return a;
  if (typeof a === 'object') return Object.values(a);
  return [String(a)];
}

export function isVisible(form: Form, q: Question, answers: Record<string, Answer>): boolean {
  const c = q.showIf;
  if (!c) return true;
  const src = form.questions.find((x) => x.id === c.question);
  if (!src || form.questions.indexOf(src) >= form.questions.indexOf(q)) return true; // a broken condition never hides
  if (!isVisible(form, src, answers)) return false;
  const got = asText(answers[c.question]).map(norm);
  const want = norm(c.value);
  if (c.op === 'eq') return got.includes(want);
  if (c.op === 'neq') return !got.includes(want);
  return got.some((g) => g.includes(want));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const realDate = (s: string): boolean => {
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const DATE =/^\d{4}-\d{2}-\d{2}$/;

/** An error message for one answer, or null when it is acceptable. */
export function validateAnswer(q: Question, a: Answer | undefined): string | null {
  if (!isInput(q)) return null;
  if (isEmpty(a)) return q.required ? 'Esta pregunta es obligatoria.' : null;
  switch (q.type) {
    case 'text':
    case 'longtext': {
      const s = String(a).trim();
      if (q.format === 'email' && !EMAIL.test(s)) return 'Escribe un correo electrónico válido.';
      if (q.format === 'url' && !URL_RE.test(s)) return 'Escribe una dirección web que empiece por http:// o https://.';
      if (q.min !== null && s.length < q.min) return `Escribe al menos ${q.min} caracteres.`;
      if (q.maxValue !== null && s.length > q.maxValue) return `Escribe como máximo ${q.maxValue} caracteres.`;
      return null;
    }
    case 'number': {
      const n = typeof a === 'number' ? a : Number(String(a).replace(',', '.'));
      if (!Number.isFinite(n)) return 'Escribe un número.';
      if (q.integer && !Number.isInteger(n)) return 'Escribe un número entero.';
      if (q.min !== null && n < q.min) return `El valor mínimo es ${q.min}.`;
      if (q.maxValue !== null && n > q.maxValue) return `El valor máximo es ${q.maxValue}.`;
      return null;
    }
    case 'date':
      return typeof a === 'string' && DATE.test(a) && realDate(a) ? null : 'Escribe una fecha válida.';
    case 'rating': {
      const n = Number(a);
      return Number.isInteger(n) && n >= 1 && n <= q.max ? null : `Elige una puntuación de 1 a ${q.max}.`;
    }
    case 'nps': {
      const n = Number(a);
      return Number.isInteger(n) && n >= 0 && n <= 10 ? null : 'Elige un valor de 0 a 10.';
    }
    case 'choice':
    case 'dropdown':
      if (typeof a !== 'string') return 'Elige una opción.';
      return q.options.includes(a) || (q.allowOther && q.type === 'choice') ? null : 'Elige una de las opciones.';
    case 'multi':
      if (!Array.isArray(a)) return 'Elige una o varias opciones.';
      return a.every((x) => q.options.includes(x) || q.allowOther) ? null : 'Hay una opción que no existe.';
    case 'likert': {
      if (typeof a !== 'object' || Array.isArray(a)) return 'Responde cada fila.';
      const rec = a as Record<string, string>;
      const missing = q.rows.filter((r) => !rec[r]);
      if (q.required && missing.length) return 'Responde todas las filas.';
      if (Object.values(rec).some((v) => v && !q.options.includes(v))) return 'Hay una columna que no existe.';
      return null;
    }
    default:
      return null;
  }
}

/** Errors by question id, ignoring the questions that are hidden by their conditions. */
export function validateAll(form: Form, answers: Record<string, Answer>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of form.questions) {
    if (!isVisible(form, q, answers)) continue;
    const e = validateAnswer(q, answers[q.id]);
    if (e) out[q.id] = e;
  }
  return out;
}

/** Answers without the ones to hidden questions. */
export function visibleAnswers(form: Form, answers: Record<string, Answer>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const q of form.questions) if (isInput(q) && isVisible(form, q, answers) && !isEmpty(answers[q.id])) out[q.id] = answers[q.id]!;
  return out;
}

export interface Score {
  earned: number;
  total: number;
  /** Per question: points earned (graded questions only). */
  byQuestion: Record<string, number>;
}

function isRight(q: Question, a: Answer | undefined): boolean {
  if (isEmpty(a)) return false;
  const right = q.correct.map(norm);
  if (!right.length) return false;
  switch (q.type) {
    case 'choice':
    case 'dropdown':
      return typeof a === 'string' && norm(a) === right[0];
    case 'multi': {
      if (!Array.isArray(a)) return false;
      const got = a.map(norm);
      return got.length === right.length && right.every((r) => got.includes(r));
    }
    case 'text':
      return typeof a === 'string' && right.includes(norm(a));
    case 'number': {
      const n = typeof a === 'number' ? a : Number(String(a).replace(',', '.'));
      return Number.isFinite(n) && right.some((r) => Number(r.replace(',', '.')) === n);
    }
    default:
      return false;
  }
}

export function score(form: Form, answers: Record<string, Answer>): Score {
  const s: Score = { earned: 0, total: 0, byQuestion: {} };
  if (!form.quiz) return s;
  for (const q of form.questions) {
    if (!gradable(q) || !q.correct.length || !isVisible(form, q, answers)) continue;
    s.total += q.points;
    const got = isRight(q, answers[q.id]) ? q.points : 0;
    s.byQuestion[q.id] = got;
    s.earned += got;
  }
  return s;
}

/**
 * Make a response from untrusted data (a file): only known questions, answers of the right shape, nothing that fails
 * validation. Returns null when no answer survives.
 */
export function cleanResponse(form: Form, raw: unknown): { response: Response; dropped: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; at?: unknown; answers?: unknown };
  if (!r.answers || typeof r.answers !== 'object') return null;
  const src = r.answers as Record<string, unknown>;
  const answers: Record<string, Answer> = {};
  let dropped = 0;
  for (const q of form.questions) {
    if (!isInput(q) || !(q.id in src)) continue;
    let v = src[q.id] as Answer;
    if (q.type === 'multi' && typeof v === 'string') v = [v];
    if (q.type === 'number' && typeof v === 'string' && v.trim() !== '') v = Number(v.replace(',', '.'));
    if ((q.type === 'rating' || q.type === 'nps') && typeof v === 'string') v = Number(v);
    if (isEmpty(v)) continue;
    // the "required" rule does not apply when reading what someone sent
    if (validateAnswer({ ...q, required: false }, v)) dropped++;
    else answers[q.id] = v;
  }
  if (!Object.keys(answers).length) return null;
  const at = typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date().toISOString();
  return { response: { id: typeof r.id === 'string' && r.id ? r.id.slice(0, 60) : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, answers }, dropped };
}
