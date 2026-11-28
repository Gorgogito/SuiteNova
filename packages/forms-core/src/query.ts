/*
 * Looking through the responses: finding, filtering and putting them in order, and the table of them that goes to a
 * spreadsheet.
 */
import { isFiles } from './files';
import { score } from './logic';
import { countsPoints, isInput, manualGraded, numbers, type Answer, type Form, type Question, type Response } from './model';
import { answerText } from './session';
import { norm } from './text';

/** `12:05`, or `1:02:03` from an hour on. */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}

export interface ResultFilter {
  /** Anywhere in the name, the answers or the comments, without minding capitals or accents. */
  text?: string;
  /** Only the ones that answered this question with `value`. */
  question?: string;
  value?: string;
  /** Days (`2026-06-01`), both included, in the time of this computer. */
  from?: string;
  to?: string;
}

/** The value that stands for an answer that is not one of the options. */
export const OTHER_ANSWER = '\u0000other';

export const filterable = (q: Question): boolean => ['choice', 'dropdown', 'multi', 'rating', 'nps'].includes(q.type);

/** What can be filtered by in a question; `other` only if somebody answered something else. */
export function filterValues(q: Question, responses: Response[]): string[] {
  if (q.type === 'rating') return Array.from({ length: q.max }, (_, i) => String(i + 1));
  if (q.type === 'nps') return Array.from({ length: 11 }, (_, i) => String(i));
  if (!filterable(q)) return [];
  const other = responses.some((r) => chosen(r.answers[q.id]).some((v) => !q.options.includes(v)));
  return other ? [...q.options, OTHER_ANSWER] : q.options;
}

const chosen = (a: Answer | undefined): string[] => (a === undefined || a === null || a === '' ? [] : Array.isArray(a) ? (a as string[]) : [String(a)]);

/** The day of a moment in the time of this computer. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const isFiltering = (f: ResultFilter): boolean => !!(f.text?.trim() || (f.question && f.value !== undefined && f.value !== '') || f.from || f.to);

export function filterResponses(form: Form, responses: Response[], f: ResultFilter): Response[] {
  if (!isFiltering(f)) return responses;
  const wanted = norm(f.text ?? '');
  const q = f.question && f.value !== undefined && f.value !== '' ? form.questions.find((x) => x.id === f.question && filterable(x)) : undefined;
  return responses.filter((r) => {
    if (f.from || f.to) {
      const day = localDay(r.at);
      if (!day || (f.from && day < f.from) || (f.to && day > f.to)) return false;
    }
    if (q) {
      const got = chosen(r.answers[q.id]);
      if (!(f.value === OTHER_ANSWER ? got.some((v) => !q.options.includes(v)) : got.includes(f.value!))) return false;
    }
    if (!wanted) return true;
    const said = [r.name ?? '', ...form.questions.filter((x) => isInput(x) && r.answers[x.id] !== undefined).map((x) => answerText(x, r.answers[x.id])), ...Object.values(r.review?.comments ?? {}), r.review?.comment ?? ''];
    return said.some((s) => norm(s).includes(wanted));
  });
}

/** `q:<id>` orders by the answer to a question. */
export type SortKey = 'date' | 'name' | 'score' | 'time' | `q:${string}`;

/** In order; the ones with nothing to compare go last whichever the direction, and ties keep their order. */
export function sortResponses(form: Form, responses: Response[], key: SortKey, descending = false): Response[] {
  const q = key.startsWith('q:') ? form.questions.find((x) => x.id === key.slice(2)) : undefined;
  const value = (r: Response): number | string | undefined => {
    if (key === 'date') return Date.parse(r.at) || undefined;
    if (key === 'name') return r.name || undefined;
    if (key === 'score') return score(form, r.answers, r.review).earned;
    if (key === 'time') return r.seconds;
    if (!q) return undefined;
    const a = r.answers[q.id];
    if (a === undefined || a === null || a === '') return undefined;
    if (q.type === 'number' || q.type === 'rating' || q.type === 'nps') return Number(a);
    return answerText(q, a);
  };
  return responses
    .map((r, i) => ({ r, i, v: value(r) }))
    .sort((a, b) => {
      if (a.v === undefined || b.v === undefined) return a.v === b.v ? a.i - b.i : a.v === undefined ? 1 : -1;
      const by = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { sensitivity: 'base', numeric: true });
      return (descending ? -by : by) || a.i - b.i;
    })
    .map((x) => x.r);
}

export type TableValue = string | number | Date | null;

/** Every response as a row: dates and numbers as such, so that a spreadsheet can work with them. */
export function responseTable(form: Form, responses: Response[]): { head: string[]; rows: TableValue[][] } {
  const qs = form.questions.filter(isInput);
  const named = !!form.askName || responses.some((r) => r.name);
  const timed = responses.some((r) => r.seconds !== undefined);
  const byHand = form.quiz && form.questions.some(manualGraded);
  const remarked = form.quiz && responses.some((r) => r.review?.comment);
  const nums = numbers(form);
  const head = ['Id', 'Fecha', ...(named ? ['Nombre'] : []), ...(timed ? ['Duración (s)'] : []), ...(form.quiz ? ['Puntuación', 'Puntuación máxima'] : []), ...(byHand ? ['Puntos por corregir'] : []), ...(remarked ? ['Comentario general'] : [])];
  // with points by question when someone gave them by hand
  const marked = form.quiz ? qs.filter((q) => countsPoints(q) && responses.some((r) => r.review?.points?.[q.id] !== undefined || r.review?.comments?.[q.id])) : [];
  for (const q of qs) {
    const title = q.title || `(sin título ${nums.get(q.id)})`;
    if (q.type === 'likert') for (const row of q.rows) head.push(`${title} [${row}]`);
    else head.push(title);
    if (marked.includes(q)) head.push(`Puntos: ${title}`, `Comentario: ${title}`);
  }
  const rows = responses.map((r) => {
    const at = new Date(r.at);
    const s = form.quiz ? score(form, r.answers, r.review) : null;
    const row: TableValue[] = [r.id, Number.isNaN(at.getTime()) ? r.at : at, ...(named ? [r.name ?? null] : []), ...(timed ? [r.seconds ?? null] : []), ...(s ? [s.earned, s.total] : []), ...(byHand ? [s?.pending ?? 0] : []), ...(remarked ? [r.review?.comment ?? null] : [])];
    for (const q of qs) {
      const a = r.answers[q.id];
      if (q.type === 'likert') for (const line of q.rows) row.push(typeof a === 'object' && a && !Array.isArray(a) ? ((a as Record<string, string>)[line] ?? null) : null);
      else if (a === undefined || a === null || a === '') row.push(null);
      else if (isFiles(a)) row.push(a.map((f) => f.name).join(' | '));
      else if (Array.isArray(a)) row.push((a as string[]).join(q.type === 'ranking' ? ' > ' : ' | '));
      else if (q.type === 'number' || q.type === 'rating' || q.type === 'nps') row.push(Number(a));
      else if (q.type === 'date') {
        const [y, m, d] = String(a).split('-').map(Number);
        row.push(y && m && d ? new Date(y, m - 1, d) : String(a));
      } else row.push(answerText(q, a));
      if (marked.includes(q)) row.push(s?.byQuestion[q.id] ?? null, r.review?.comments?.[q.id] ?? null);
    }
    return row;
  });
  return { head, rows };
}
