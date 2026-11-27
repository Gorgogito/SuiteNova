import { MAX_FILES, MAX_RESPONSE_MB, MB, fileProblem, readFileItem } from './files';
import { gradable, isInput, type Answer, type Form, type Question, type Response, type UploadedFile } from './model';

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
  if (Array.isArray(a)) return (a as unknown[]).filter((x): x is string => typeof x === 'string');
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

/** A number made from a text (FNV-1a), to start the order of a shuffled list. */
const hash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/** The list in an order of its own for each seed: the same seed gives the same order. */
export function shuffled<T>(list: T[], seed: string): T[] {
  let a = hash(seed);
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

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

/** The response with these answers: its identifier and date, or new ones if what came is not usable. */
function asResponse(r: { id?: unknown; at?: unknown }, answers: Record<string, Answer>): Response {
  const at = typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? r.at : new Date().toISOString();
  return { id: typeof r.id === 'string' && r.id ? r.id.slice(0, 60) : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, answers };
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
  return Object.keys(answers).length ? asResponse(r, answers) : null;
}
