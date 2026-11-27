/*
 * What happens around answering: whether the form takes answers now, what is kept when the time runs out, how the answers
 * are written down for the person who gave them, and the background of the page.
 */
import { isFiles } from './files';
import { localize, type Lang } from './i18n';
import { isEmpty, validateAnswer, visibleAnswers } from './logic';
import { isInput, isSafeImage, numbers, type Answer, type Form, type Question } from './model';
import { route } from './flow';

export type Availability = 'open' | 'closed' | 'notYet';

/** Whether the form takes answers at a moment: not closed by hand, not before its start nor from its end on. */
export function availability(form: Pick<Form, 'closed' | 'start' | 'end'>, now: number): Availability {
  if (form.closed) return 'closed';
  if (form.start && now < Date.parse(form.start)) return 'notYet';
  if (form.end && now >= Date.parse(form.end)) return 'closed';
  return 'open';
}

/** What to say to someone who finds the form not taking answers. */
export function closedText(form: Form, state: Exclude<Availability, 'open'>, locale?: string): string[] {
  const lang = form.language;
  if (state === 'notYet') {
    const when = new Date(form.start!).toLocaleString(locale ?? lang ?? 'es', { dateStyle: 'long', timeStyle: 'short' });
    return [localize('Este formulario todavía no admite respuestas.', lang), localize(`Empieza el ${when}.`, lang)];
  }
  return [form.closedMessage?.trim() ? form.closedMessage : localize('Este formulario ya no admite respuestas.', lang)];
}

/** Whether a response says it was given when the form did not take answers (by its dates). */
export const outsideDates = (form: Pick<Form, 'start' | 'end'>, at: string): boolean => (!!form.start && Date.parse(at) < Date.parse(form.start)) || (!!form.end && Date.parse(at) >= Date.parse(form.end));

/** The answers as they are saved: only what is shown, texts without spare spaces and numbers as numbers. */
export function tidyAnswers(form: Form, answers: Record<string, Answer>): Record<string, Answer> {
  const out = visibleAnswers(form, answers);
  for (const q of form.questions) {
    let v = out[q.id];
    if (typeof v === 'string') v = v.trim();
    // only the typed «other» of the checkboxes needs trimming: files and what was put in order stay as they are
    else if (Array.isArray(v) && q.type === 'multi') v = (v as string[]).map((x) => x.trim()).filter(Boolean);
    if (q.type === 'number' && typeof v === 'string' && v !== '') v = Number(v.replace(',', '.'));
    if (v !== undefined) out[q.id] = v;
  }
  return out;
}

/** What is kept when the time runs out: what had been answered rightly. Nothing is required any more. */
export function timedAnswers(form: Form, answers: Record<string, Answer>): Record<string, Answer> {
  const tidy = tidyAnswers(form, answers);
  const out: Record<string, Answer> = {};
  for (const q of form.questions) {
    const v = tidy[q.id];
    if (v !== undefined && !isEmpty(v) && !validateAnswer({ ...q, required: false }, v)) out[q.id] = v;
  }
  return out;
}

/** One answer in words. */
export function answerText(q: Question, a: Answer | undefined): string {
  if (a === undefined || a === null || isEmpty(a)) return '—';
  if (isFiles(a)) return a.map((f) => f.name).join(', ');
  if (Array.isArray(a)) return q.type === 'ranking' ? (a as string[]).map((x, i) => `${i + 1}. ${x}`).join('  ') : (a as string[]).join(', ');
  if (typeof a === 'object') return Object.entries(a).map(([row, column]) => `${row}: ${column}`).join('; ');
  return String(a);
}

/** The questions a person was shown, each with what they answered. */
export function answerLines(form: Form, answers: Record<string, Answer>, name?: string): { label: string; text: string }[] {
  const { shown } = route(form, answers);
  const nums = numbers(form);
  const lines = form.questions.filter((q) => isInput(q) && shown.has(q.id)).map((q) => ({ label: `${form.hideNumbers ? '' : `${nums.get(q.id)}. `}${q.title}`, text: answerText(q, answers[q.id]) }));
  return name ? [{ label: localize('Nombre', form.language), text: name }, ...lines] : lines;
}

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A page with a person's answers, to print them or keep them as a PDF. */
export function receiptHtml(form: Form, answers: Record<string, Answer>, name: string | undefined, at: string, locale?: string): string {
  const lang: Lang = form.language ?? 'es';
  const when = new Date(at).toLocaleString(locale ?? lang, { dateStyle: 'long', timeStyle: 'short' });
  const rows = answerLines(form, answers, name)
    .map((l) => `<dt>${escape(l.label)}</dt><dd>${escape(l.text)}</dd>`)
    .join('');
  const css = `@page{margin:15mm}body{font:12px 'Segoe UI',Calibri,Arial,sans-serif;color:#000;background:#fff;margin:12px}h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;margin:0}p{margin:2px 0 12px}dt{font-weight:700;margin-top:10px}dd{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${css}</style></head><body><h1>${escape(form.title)}</h1><h2>${escape(localize('Mis respuestas', lang))}</h2><p>${escape(localize(`Enviado el ${when}`, lang))}</p><dl>${rows}</dl></body></html>`;
}

/**
 * The background of the form as a CSS value over `base`, or null for the plain one. A picture is only used if it is a
 * safe one (a `data:` URL of base64, which cannot break out of the style).
 */
export function pageBackground(form: Pick<Form, 'background' | 'backgroundImage' | 'color'>, base: string): string | null {
  const color = /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : '#0f6cbd';
  if (form.background === 'tint') return `color-mix(in srgb, ${color} 16%, ${base})`;
  if (form.background === 'gradient') return `linear-gradient(160deg, color-mix(in srgb, ${color} 55%, ${base}), ${base} 75%) fixed, ${base}`;
  if (form.background === 'image' && isSafeImage(form.backgroundImage)) return `url("${form.backgroundImage}") center / cover fixed, ${base}`;
  return null;
}
