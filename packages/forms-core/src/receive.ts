/*
 * A response that arrives by itself (over the local network). Whoever sends it is not trusted: the form decides whether
 * it is taken, by the same rules as when it is filled in here, and with the clock of this computer.
 */
import { MAX_RESPONSE_MB, MB, isFiles } from './files';
import { localize } from './i18n';
import { cleanResponse, validateAll } from './logic';
import { MAX_NAME, type Form, type Response } from './model';
import { availability, closedText, tidyAnswers } from './session';

/** The answer for whoever sent it: taken (`duplicate` when it was there already), or why not, in the language of the form. */
export type Reception = { ok: true; response: Response; duplicate: boolean } | { ok: false; message: string };

const OTHER_KB = 1024 * 1024;

/** The most a response to this form can weigh, in bytes: files travel in base64, a third larger. */
export const bodyLimit = (form: Pick<Form, 'questions'>): number => (form.questions.some((q) => q.type === 'file') ? Math.ceil((MAX_RESPONSE_MB * MB * 4) / 3) + OTHER_KB : OTHER_KB);

export function receiveResponse(form: Form, existing: Response[], body: string, now: number): Reception {
  const no = (message: string): Reception => ({ ok: false, message: localize(message, form.language) });
  const unreadable = 'La respuesta no se entiende.';
  const invalid = 'Hay respuestas que no son válidas: puede que el formulario haya cambiado. Recarga la página.';
  let raw: { format?: unknown; formId?: unknown; id?: unknown; name?: unknown; answers?: unknown; timed?: unknown } | null;
  try {
    raw = JSON.parse(body);
  } catch {
    return no(unreadable);
  }
  if (!raw || typeof raw !== 'object' || raw.format !== 'novaforms-response' || typeof raw.id !== 'string' || !/^[\w-]{1,60}$/.test(raw.id)) return no(unreadable);
  if (!raw.answers || typeof raw.answers !== 'object' || Array.isArray(raw.answers)) return no(unreadable);
  if (raw.formId !== form.id) return no('Esta dirección recoge ahora otro formulario. Recarga la página.');
  // sent again because the confirmation did not arrive
  const have = existing.find((r) => r.id === raw.id);
  if (have) return { ok: true, response: have, duplicate: true };
  const state = availability(form, now);
  if (state !== 'open') return { ok: false, message: closedText(form, state).join(' ') };
  // only a form with a time limit can send an unfinished response
  const timed = raw.timed === true && !!form.timeLimit;
  const clean = cleanResponse(form, { answers: raw.answers });
  if (!clean) return no('La respuesta está vacía.');
  if (clean.dropped && !timed) return no(invalid);
  const answers = tidyAnswers(form, clean.response.answers);
  if (!Object.keys(answers).length) return no('La respuesta está vacía.');
  if (!timed && Object.keys(validateAll(form, answers)).length) return no(invalid);
  const weight = Object.values(answers).reduce<number>((n, a) => n + (isFiles(a) ? a.reduce((m, f) => m + f.size, 0) : 0), 0);
  if (weight > MAX_RESPONSE_MB * MB) return no(`Entre todos, los archivos pasan de ${MAX_RESPONSE_MB} MB.`);
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : '';
  if (form.askName && !name && !timed) return no('Escribe tu nombre.');
  return { ok: true, duplicate: false, response: { id: raw.id, at: new Date(now).toISOString(), answers, ...(form.askName && name ? { name } : {}) } };
}

/** The responses of a file (one or several) that say which form they are for: that identifier, or null if it is not such a file. */
export function responseFileFor(text: string): string | null {
  try {
    const raw = JSON.parse(text) as { format?: unknown; formId?: unknown };
    return raw && raw.format === 'novaforms-response' && typeof raw.formId === 'string' && raw.formId ? raw.formId.slice(0, 60) : null;
  } catch {
    return null;
  }
}
