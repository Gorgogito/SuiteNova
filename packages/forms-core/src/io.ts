import { uniqueTexts } from './edit';
import { FILE_KINDS, MAX_FILES, SIZE_CHOICES, isFiles } from './files';
import { tidyFlow } from './flow';
import { LANGUAGES } from './i18n';
import { outsideDates } from './session';
import { cleanResponse, keptResponse, score } from './logic';
import { BACKGROUNDS, IMAGE_SIZES, MAX_COMMENT, MAX_CONDITIONS, MAX_FEEDBACK, MAX_TIME_LIMIT, canBeManual, chartsFor, manualGraded, NUMBER_RULES, QTYPES, RATING_SYMBOLS, isInput, isSafeImage, newForm, newId, newQuestion, showIfOf, type Answer, type Condition, type Form, type QType, type Question, type Response } from './model';

export interface Project {
  form: Form;
  responses: Response[];
}

export function serializeProject(p: Project): string {
  return JSON.stringify({ format: 'novaforms', form: p.form, responses: p.responses }, null, 1);
}

const str = (v: unknown, d = '', max = 5000): string => (typeof v === 'string' ? v.slice(0, max) : d);
const num = (v: unknown, d: number | null = null): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown, max = 200): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x: string) => x.slice(0, 500)).slice(0, max) : []);
const TYPES = new Set(QTYPES.map((t) => t.id));

/** Read a Form from untrusted data (a file): every value is checked and repaired. */
/** The comments, explanation and way of marking of a question, if they make sense for it. */
function quizNotes(r: any, options: string[], type: QType): Partial<Question> {
  const out: Partial<Question> = {};
  if (r?.manual === true && canBeManual({ type })) out.manual = true;
  if (chartsFor({ type }).includes(r?.chart)) out.chart = r.chart;
  if (typeof r?.explanation === 'string' && r.explanation !== '') out.explanation = r.explanation.slice(0, MAX_COMMENT);
  if (r?.feedback && typeof r.feedback === 'object' && (type === 'choice' || type === 'dropdown' || type === 'multi')) {
    const kept = options.flatMap((o) => (Object.hasOwn(r.feedback, o) && typeof r.feedback[o] === 'string' && r.feedback[o] !== '' ? [[o, r.feedback[o].slice(0, MAX_FEEDBACK) as string] as const] : []));
    if (kept.length) out.feedback = Object.fromEntries(kept);
  }
  return out;
}

/** A moment written in a file, in one same way; nothing if it is not one. */
const moment = (v: unknown): string | null => (typeof v === 'string' && v.length < 60 && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** The settings about answering and looks that make sense; the rest are left out. */
function settings(raw: any): Partial<Form> {
  const out: Partial<Form> = {};
  for (const key of ['closed', 'noAgain', 'receipt', 'askName'] as const) if (raw?.[key] === true) out[key] = true;
  if (typeof raw?.closedMessage === 'string' && raw.closedMessage.trim()) out.closedMessage = raw.closedMessage.slice(0, 1000);
  for (const key of ['start', 'end'] as const) {
    const when = moment(raw?.[key]);
    if (when) out[key] = when;
  }
  if (Number.isInteger(raw?.timeLimit) && raw.timeLimit >= 1) out.timeLimit = Math.min(MAX_TIME_LIMIT, raw.timeLimit);
  if (BACKGROUNDS.some((b) => b.id === raw?.background)) out.background = raw.background;
  if (isSafeImage(raw?.backgroundImage)) out.backgroundImage = raw.backgroundImage;
  if (LANGUAGES.some((l) => l.id === raw?.language)) out.language = raw.language;
  return out;
}

export function readForm(raw: any): Form {
  const base = newForm();
  const ids = new Set<string>();
  const questions: Question[] = (Array.isArray(raw?.questions) ? raw.questions : []).slice(0, 500).map((r: any): Question => {
    const type: QType = TYPES.has(r?.type) ? r.type : 'text';
    const d = newQuestion(type);
    let id = str(r?.id, '', 60) || newId('q');
    while (ids.has(id)) id = newId('q');
    ids.add(id);
    const sf = r?.showIf;
    const condition = (c: any): Condition[] => (c && typeof c.question === 'string' && ['eq', 'neq', 'contains'].includes(c.op) ? [{ question: c.question, op: c.op, value: str(c.value, '', 500) }] : []);
    const conditions = [...condition(sf), ...(sf && Array.isArray(sf.more) ? sf.more.flatMap(condition) : [])].slice(0, MAX_CONDITIONS);
    const extra: Partial<Question> = {};
    if (typeof r?.equation === 'string' && r.equation.trim()) extra.equation = r.equation.slice(0, 5000);
    if (r?.shuffle === true) extra.shuffle = true;
    if (r?.locked === true) extra.locked = true;
    if ((type === 'choice' || type === 'dropdown') && r?.branch && typeof r.branch === 'object' && !Array.isArray(r.branch)) {
      const entries = Object.entries(r.branch as Record<string, unknown>).flatMap(([option, target]) => (typeof target === 'string' && target ? [[option, target.slice(0, 60)]] : []));
      if (entries.length) extra.branch = Object.fromEntries(entries.slice(0, 200));
    }
    if (type === 'section' && typeof r?.next === 'string' && r.next) extra.next = r.next.slice(0, 60);
    if (type === 'number' && NUMBER_RULES.some((x) => x.id === r?.rule) && r.rule !== 'range') extra.rule = r.rule;
    for (const key of ['lowLabel', 'highLabel'] as const) if ((type === 'rating' || type === 'nps') && typeof r?.[key] === 'string' && r[key].trim()) extra[key] = r[key].slice(0, 100);
    if (type === 'file') {
      extra.maxFiles = Math.min(MAX_FILES, Math.max(1, Math.round(num(r?.maxFiles, 1)!)));
      extra.maxMb = SIZE_CHOICES.includes(r?.maxMb) ? r.maxMb : 10;
      extra.kinds = FILE_KINDS.map((k) => k.id).filter((k) => Array.isArray(r?.kinds) && r.kinds.includes(k));
    }
    // a file written before ratings had signs shows numbers
    delete d.symbol;
    if (type === 'rating' && RATING_SYMBOLS.some((x) => x.id === r?.symbol)) extra.symbol = r.symbol;
    return {
      ...d,
      ...extra,
      id,
      title: str(r?.title, '', 500),
      description: str(r?.description, '', 2000),
      required: r?.required === true,
      // choices and rows are told apart by their text: none may be empty or repeated
      options: Array.isArray(r?.options) ? uniqueTexts(strs(r.options), type === 'likert' ? 'Columna' : type === 'ranking' ? 'Elemento' : 'Opción') : d.options,
      rows: Array.isArray(r?.rows) ? uniqueTexts(strs(r.rows), 'Fila') : d.rows,
      allowOther: r?.allowOther === true,
      max: Math.min(10, Math.max(3, Math.round(num(r?.max, 5)!))),
      format: r?.format === 'email' || r?.format === 'url' ? r.format : 'none',
      min: num(r?.min),
      maxValue: num(r?.maxValue),
      integer: r?.integer === true,
      showIf: showIfOf(conditions, sf?.anyOf === true),
      correct: strs(r?.correct),
      points: Math.min(1000, Math.max(0, num(r?.points, 1)!)),
      ...quizNotes(r, Array.isArray(r?.options) ? uniqueTexts(strs(r.options), 'Opción') : d.options, type),
      ...(isSafeImage(r?.image?.src) ? { image: { src: r.image.src, alt: str(r.image.alt, '', 500), size: IMAGE_SIZES.some((z) => z.id === r.image.size) ? r.image.size : 'medium' } } : {}),
    };
  });
  return {
    ...base,
    ...(raw?.shuffle === true ? { shuffle: true } : {}),
    ...(raw?.progress === true ? { progress: true } : {}),
    ...(raw?.hideNumbers === true ? { hideNumbers: true } : {}),
    ...settings(raw),
    id: str(raw?.id, '', 60) || base.id,
    title: str(raw?.title, base.title, 300),
    description: str(raw?.description, '', 3000),
    color: typeof raw?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : base.color,
    quiz: raw?.quiz === true,
    showScore: raw?.showScore !== false,
    ...(raw?.showAnswers === true ? { showAnswers: true } : {}),
    ...(raw?.practice === true ? { practice: true } : {}),
    thanks: str(raw?.thanks, base.thanks, 1000),
    // conditions must look back and branches forwards
    questions: tidyFlow(questions),
  };
}

export function parseProject(text: string): { project: Project; warnings: string[] } {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un formulario de Nova Forms (JSON no válido).');
  }
  if (!raw || raw.format !== 'novaforms' || !raw.form) throw new Error('El archivo no es un formulario de Nova Forms.');
  const form = readForm(raw.form);
  const responses: Response[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const r of Array.isArray(raw.responses) ? raw.responses : []) {
    const c = keptResponse(form, r);
    if (!c || seen.has(c.id)) {
      dropped++;
      continue;
    }
    seen.add(c.id);
    responses.push(c);
  }
  return { project: { form, responses }, warnings: dropped ? [`Se omitieron ${dropped} respuestas dañadas o repetidas.`] : [] };
}

// ------------------------------------------------------------ response files

export function serializeResponse(form: Form, r: Response): string {
  return JSON.stringify({ format: 'novaforms-response', formId: form.id, id: r.id, at: r.at, ...(r.name ? { name: r.name } : {}), ...(r.seconds ? { seconds: r.seconds } : {}), answers: r.answers }, null, 1);
}

export interface Imported {
  responses: Response[];
  warnings: string[];
}

/**
 * Read response files: one response, a list of them, or a whole .novaforms file. Responses that were already in
 * `existing` (same id) are skipped, and files of another form are refused.
 */
export function parseResponses(text: string, form: Form, existing: Response[] = []): Imported {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un archivo de respuestas (JSON no válido).');
  }
  const warnings: string[] = [];
  let items: any[];
  let formId: unknown;
  if (raw?.format === 'novaforms-response') {
    items = [raw];
    formId = raw.formId;
  } else if (raw?.format === 'novaforms' && Array.isArray(raw.responses)) {
    items = raw.responses;
    formId = raw.form?.id;
  } else if (Array.isArray(raw)) {
    items = raw;
  } else throw new Error('El archivo no contiene respuestas de Nova Forms.');
  if (formId !== undefined && formId !== form.id) throw new Error('Las respuestas pertenecen a otro formulario.');
  const have = new Set(existing.map((r) => r.id));
  const responses: Response[] = [];
  let dup = 0;
  let bad = 0;
  let dropped = 0;
  for (const it of items) {
    const c = cleanResponse(form, it);
    if (!c) {
      bad++;
      continue;
    }
    if (have.has(c.response.id)) {
      dup++;
      continue;
    }
    have.add(c.response.id);
    dropped += c.dropped;
    responses.push(c.response);
  }
  const late = responses.filter((r) => outsideDates(form, r.at)).length;
  if (late) warnings.push(`${late} respuesta(s) tienen fecha fuera del plazo del formulario; se han añadido igualmente.`);
  if (dup) warnings.push(`${dup} respuesta(s) ya estaban y se omitieron.`);
  if (bad) warnings.push(`${bad} respuesta(s) vacías o dañadas se omitieron.`);
  if (dropped) warnings.push(`${dropped} respuesta(s) a preguntas se descartaron por no ser válidas (la pregunta cambió o el dato era erróneo).`);
  return { responses, warnings };
}

// ------------------------------------------------------------ CSV

const cell = (v: string | number): string => {
  let s = String(v);
  // a cell that starts like a formula would be run by a spreadsheet
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A cell of the table: files by their names; what was put in order, from first to last. */
const show = (q: Question, a: Answer | undefined): string =>
  a === null || a === undefined ? '' : isFiles(a) ? a.map((f) => f.name).join(' | ') : Array.isArray(a) ? a.join(q.type === 'ranking' ? ' > ' : ' | ') : typeof a === 'object' ? '' : String(a);

export function responsesToCsv(form: Form, responses: Response[]): string {
  const qs = form.questions.filter(isInput);
  const head = ['Id', 'Fecha'];
  const named = !!form.askName || responses.some((r) => r.name);
  if (named) head.push('Nombre');
  const timed = responses.some((r) => r.seconds !== undefined);
  if (timed) head.push('Duración (s)');
  if (form.quiz) head.push('Puntuación', 'Puntuación máxima');
  const byHand = form.quiz && form.questions.some(manualGraded);
  const remarked = form.quiz && responses.some((r) => r.review?.comment);
  if (byHand) head.push('Puntos por corregir');
  if (remarked) head.push('Comentario general');
  for (const q of qs) {
    if (q.type === 'likert') for (const r of q.rows) head.push(`${q.title} [${r}]`);
    else head.push(q.title || '(sin título)');
  }
  const rows = [head.map(cell).join(';')];
  for (const r of responses) {
    const line: (string | number)[] = [r.id, r.at];
    if (named) line.push(r.name ?? '');
    if (timed) line.push(r.seconds ?? '');
    if (form.quiz) {
      const s = score(form, r.answers, r.review);
      line.push(s.earned, s.total);
      if (byHand) line.push(s.pending ?? 0);
      if (remarked) line.push(r.review?.comment ?? '');
    }
    for (const q of qs) {
      const a = r.answers[q.id];
      if (q.type === 'likert') for (const row of q.rows) line.push(typeof a === 'object' && a && !Array.isArray(a) ? ((a as Record<string, string>)[row] ?? '') : '');
      else line.push(show(q, a));
    }
    rows.push(line.map(cell).join(';'));
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}
