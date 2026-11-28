import { MAX_FILES, MAX_RESPONSE_MB, MB, fileProblem, readFileItem } from './files';
import { route } from './flow';
import { MAX_COMMENT, MAX_NAME, autoGraded, countsPoints, isInput, type Answer, type Form, type Question, type Response, type Review, type UploadedFile } from './model';
import { norm, shuffled } from './text';

/*
 * Rules shared by the editor, the fill-in screen and the standalone HTML. The HTML carries its own copy of these
 * functions (see html.ts); a test runs both on the same inputs.
 */

export { norm, shuffled } from './text';

export const isEmpty = (a: Answer | undefined): boolean => {
  if (a === null || a === undefined) return true;
  if (typeof a === 'string') return a.trim() === '';
  if (Array.isArray(a)) return a.length === 0;
  if (typeof a === 'object') return Object.values(a).every((v) => !v);
  return false;
};

/** Whether a question is shown: its page is gone through and its conditions are met. */
export const isVisible = (form: Form, q: Question, answers: Record<string, Answer>): boolean =>
  // the question as given, which may be a changed one, in its place of the form
  route(form.questions.includes(q) ? form : { ...form, questions: form.questions.map((x) => (x.id === q.id ? q : x)) }, answers).shown.has(q.id);

/** The options of a question in the order a person sees them. */
export const orderOf = (q: Question, seed: string): string[] => (q.shuffle ? shuffled(q.options, seed + q.id) : q.options);

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
      switch (q.rule ?? 'range') {
        case 'gt':
          return q.min !== null && n <= q.min ? `Escribe un número mayor que ${q.min}.` : null;
        case 'lt':
          return q.maxValue !== null && n >= q.maxValue ? `Escribe un número menor que ${q.maxValue}.` : null;
        case 'ne':
          return q.min !== null && n === q.min ? `El número no puede ser ${q.min}.` : null;
        case 'outside':
          return q.min !== null && q.maxValue !== null && n >= q.min && n <= q.maxValue ? `Escribe un número menor que ${q.min} o mayor que ${q.maxValue}.` : null;
        default:
          if (q.min !== null && n < q.min) return `El valor mínimo es ${q.min}.`;
          if (q.maxValue !== null && n > q.maxValue) return `El valor máximo es ${q.maxValue}.`;
          return null;
      }
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
      if (!(a as unknown[]).every((x) => typeof x === 'string' && (q.options.includes(x) || q.allowOther))) return 'Hay una opción que no existe.';
      if (q.min !== null && a.length < q.min) return `Elige al menos ${q.min} opciones.`;
      if (q.maxValue !== null && a.length > q.maxValue) return `Elige como máximo ${q.maxValue} opciones.`;
      return null;
    case 'ranking': {
      if (!Array.isArray(a) || !(a as unknown[]).every((x) => typeof x === 'string' && q.options.includes(x))) return 'Hay un elemento que no existe.';
      return a.length === q.options.length && new Set(a as string[]).size === a.length ? null : 'Ordena todos los elementos.';
    }
    case 'file': {
      if (!Array.isArray(a) || !(a as unknown[]).every((x) => typeof x === 'object' && x !== null)) return 'Adjunta un archivo.';
      const list = a as UploadedFile[];
      const max = Math.min(MAX_FILES, q.maxFiles ?? 1);
      if (list.length > max) return `Puedes adjuntar como máximo ${max} archivo(s).`;
      for (const f of list) {
        const problem = fileProblem(q, f.name, f.size);
        if (problem) return problem;
      }
      return list.reduce((n, f) => n + f.size, 0) > MAX_RESPONSE_MB * MB ? `Entre todos, los archivos pasan de ${MAX_RESPONSE_MB} MB.` : null;
    }
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
  const { shown } = route(form, answers);
  for (const q of form.questions) {
    if (!shown.has(q.id)) continue;
    const e = validateAnswer(q, answers[q.id]);
    if (e) out[q.id] = e;
  }
  return out;
}

/** Answers without the ones to hidden questions. */
export function visibleAnswers(form: Form, answers: Record<string, Answer>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  const { shown } = route(form, answers);
  for (const q of form.questions) if (isInput(q) && shown.has(q.id) && !isEmpty(answers[q.id])) out[q.id] = answers[q.id]!;
  return out;
}

export interface Score {
  earned: number;
  total: number;
  /** Per question: points earned (the ones already marked). */
  byQuestion: Record<string, number>;
  /** Points that are given by hand and nobody has given yet. */
  pending?: number;
}

/** Sums of halves and tenths without the tail that binary numbers leave. */
const round = (n: number): number => Math.round(n * 100) / 100;

export function isRight(q: Question, a: Answer | undefined): boolean {
  if (isEmpty(a)) return false;
  const right = q.correct.map(norm);
  if (!right.length) return false;
  switch (q.type) {
    case 'choice':
    case 'dropdown':
      return typeof a === 'string' && norm(a) === right[0];
    case 'multi': {
      if (!Array.isArray(a)) return false;
      const got = (a as string[]).map(norm);
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

export function score(form: Form, answers: Record<string, Answer>, review?: Review): Score {
  const s: Score = { earned: 0, total: 0, byQuestion: {} };
  if (!form.quiz) return s;
  const { shown } = route(form, answers);
  for (const q of form.questions) {
    if (!countsPoints(q) || !shown.has(q.id)) continue;
    s.total = round(s.total + q.points);
    const given = review?.points && Object.hasOwn(review.points, q.id) ? review.points[q.id] : undefined;
    let got: number;
    if (given !== undefined) got = Math.min(q.points, Math.max(0, given));
    else if (autoGraded(q)) got = isRight(q, answers[q.id]) ? q.points : 0;
    // by hand: nothing to look at is worth nothing
    else if (isEmpty(answers[q.id])) got = 0;
    else {
      if (q.points) s.pending = round((s.pending ?? 0) + q.points);
      continue;
    }
    s.byQuestion[q.id] = got;
    s.earned = round(s.earned + got);
  }
  return s;
}

/** The corrections of a response as read from the file of the form: only what makes sense for it. */
export function readReview(form: Form, raw: unknown): Review | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { points?: unknown; comments?: unknown; comment?: unknown; done?: unknown };
  const ids = new Set(form.questions.filter(isInput).map((q) => q.id));
  const entries = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v as Record<string, unknown>).filter(([id]) => ids.has(id)) : []);
  const points = entries(r.points).flatMap(([id, n]) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? [[id, Math.min(1000, n)] as const] : []));
  const comments = entries(r.comments).flatMap(([id, c]) => (typeof c === 'string' && c !== '' ? [[id, c.slice(0, MAX_COMMENT)] as const] : []));
  const out: Review = {
    ...(points.length ? { points: Object.fromEntries(points) } : {}),
    ...(comments.length ? { comments: Object.fromEntries(comments) } : {}),
    ...(typeof r.comment === 'string' && r.comment !== '' ? { comment: r.comment.slice(0, MAX_COMMENT * 2) } : {}),
    ...(r.done === true ? { done: true } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** The response with these answers: its identifier and date, or new ones if what came is not usable. */
function asResponse(r: { id?: unknown; at?: unknown; name?: unknown }, answers: Record<string, Answer>): Response {
  const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_NAME) : '';
  const at = typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date().toISOString();
  return { id: typeof r.id === 'string' && r.id ? r.id.slice(0, 60) : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, answers, ...(name ? { name } : {}) };
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
    if (q.type === 'file') v = shaped(q, v);
    if (q.type === 'number' && typeof v === 'string' && v.trim() !== '') v = Number(v.replace(',', '.'));
    if ((q.type === 'rating' || q.type === 'nps') && typeof v === 'string') v = Number(v);
    if (isEmpty(v)) continue;
    // the "required" rule does not apply when reading what someone sent
    if (validateAnswer({ ...q, required: false }, v)) dropped++;
    else answers[q.id] = v;
  }
  if (!Object.keys(answers).length) return null;
  return { response: asResponse(r, answers), dropped };
}

const MAX_ANSWER = 20_000;
const text = (v: unknown): string | null => (typeof v === 'string' ? v.slice(0, MAX_ANSWER) : null);
const number = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** An answer with the shape its question asks for, whether or not today's rules would accept it. */
function shaped(q: Question, v: unknown): Answer {
  switch (q.type) {
    case 'number':
    case 'rating':
    case 'nps':
      return number(v);
    case 'multi':
    case 'ranking':
      return (Array.isArray(v) ? v : [v]).flatMap((x) => text(x) ?? []).slice(0, 200);
    case 'file':
      return Array.isArray(v) ? v.slice(0, MAX_FILES).flatMap((x) => readFileItem(x) ?? []) : null;
    case 'likert':
      return v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 200).flatMap(([row, column]) => (typeof column === 'string' ? [[row, column.slice(0, MAX_ANSWER)]] : [])))
        : null;
    default:
      return text(v);
  }
}

/**
 * A response of the file of the form itself. What was collected is kept even if the question changed afterwards (a choice
 * taken away, other limits): saving and opening again must not take anything away. Null when no answer survives.
 */
export function keptResponse(form: Form, raw: unknown): Response | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { id?: unknown; at?: unknown; answers?: unknown };
  if (!r.answers || typeof r.answers !== 'object') return null;
  const src = r.answers as Record<string, unknown>;
  const answers: Record<string, Answer> = {};
  for (const q of form.questions) {
    if (!isInput(q) || !Object.hasOwn(src, q.id)) continue;
    const v = shaped(q, src[q.id]);
    if (!isEmpty(v)) answers[q.id] = v;
  }
  if (!Object.keys(answers).length) return null;
  const review = readReview(form, (raw as { review?: unknown }).review);
  return { ...asResponse(r, answers), ...(review ? { review } : {}) };
}
