import { cleanResponse, score } from './logic';
import { QTYPES, isInput, newForm, newId, newQuestion, type Answer, type Form, type QType, type Question, type Response } from './model';

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
    return {
      ...d,
      id,
      title: str(r?.title, '', 500),
      description: str(r?.description, '', 2000),
      required: r?.required === true,
      options: Array.isArray(r?.options) ? strs(r.options) : d.options,
      rows: Array.isArray(r?.rows) ? strs(r.rows) : d.rows,
      allowOther: r?.allowOther === true,
      max: Math.min(10, Math.max(3, Math.round(num(r?.max, 5)!))),
      format: r?.format === 'email' || r?.format === 'url' ? r.format : 'none',
      min: num(r?.min),
      maxValue: num(r?.maxValue),
      integer: r?.integer === true,
      showIf: sf && typeof sf.question === 'string' && ['eq', 'neq', 'contains'].includes(sf.op) ? { question: sf.question, op: sf.op, value: str(sf.value, '', 500) } : null,
      correct: strs(r?.correct),
      points: Math.min(1000, Math.max(0, num(r?.points, 1)!)),
    };
  });
  // conditions must point at an earlier question
  questions.forEach((q, i) => {
    if (q.showIf && !questions.slice(0, i).some((x) => x.id === q.showIf!.question && isInput(x))) q.showIf = null;
  });
  return {
    ...base,
    id: str(raw?.id, '', 60) || base.id,
    title: str(raw?.title, base.title, 300),
    description: str(raw?.description, '', 3000),
    color: typeof raw?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : base.color,
    quiz: raw?.quiz === true,
    showScore: raw?.showScore !== false,
    thanks: str(raw?.thanks, base.thanks, 1000),
    questions,
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
    const c = cleanResponse(form, r);
    if (!c || seen.has(c.response.id)) {
      dropped++;
      continue;
    }
    seen.add(c.response.id);
    responses.push(c.response);
  }
  return { project: { form, responses }, warnings: dropped ? [`Se omitieron ${dropped} respuestas dañadas o repetidas.`] : [] };
}

// ------------------------------------------------------------ response files

export function serializeResponse(form: Form, r: Response): string {
  return JSON.stringify({ format: 'novaforms-response', formId: form.id, id: r.id, at: r.at, answers: r.answers }, null, 1);
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

const show = (a: Answer | undefined): string => (a === null || a === undefined ? '' : Array.isArray(a) ? a.join(' | ') : typeof a === 'object' ? '' : String(a));

export function responsesToCsv(form: Form, responses: Response[]): string {
  const qs = form.questions.filter(isInput);
  const head = ['Id', 'Fecha'];
  if (form.quiz) head.push('Puntuación', 'Puntuación máxima');
  for (const q of qs) {
    if (q.type === 'likert') for (const r of q.rows) head.push(`${q.title} [${r}]`);
    else head.push(q.title || '(sin título)');
  }
  const rows = [head.map(cell).join(';')];
  for (const r of responses) {
    const line: (string | number)[] = [r.id, r.at];
    if (form.quiz) {
      const s = score(form, r.answers);
      line.push(s.earned, s.total);
    }
    for (const q of qs) {
      const a = r.answers[q.id];
      if (q.type === 'likert') for (const row of q.rows) line.push(typeof a === 'object' && a && !Array.isArray(a) ? ((a as Record<string, string>)[row] ?? '') : '');
      else line.push(show(a));
    }
    rows.push(line.map(cell).join(';'));
  }
  return '﻿' + rows.join('\r\n') + '\r\n';
}
