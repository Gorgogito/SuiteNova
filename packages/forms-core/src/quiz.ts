/*
 * What a quiz says back: whether each answer is right, the comments and explanations that go with it, and the sheet
 * that returns the marks to each person.
 */
import { route } from './flow';
import { localize } from './i18n';
import { isEmpty, isRight, score, validateAnswer } from './logic';
import { autoGraded, countsPoints, isInput, numbers, type Answer, type Form, type Question, type Response, type Review } from './model';
import { answerText } from './session';

/** `none`: nothing to judge (it does not count, or it is worth nothing and nobody marked it). */
export type Mark = 'right' | 'wrong' | 'partial' | 'pending' | 'none';

export const MARK_NAMES: Record<Exclude<Mark, 'none'>, string> = { right: 'Correcta', wrong: 'Incorrecta', partial: 'En parte', pending: 'Por corregir' };

export interface ReviewLine {
  id: string;
  label: string;
  answer: string;
  mark: Mark;
  /** What the question is worth and what was got; null when it does not count, or `earned` while it is not marked. */
  points: number | null;
  earned: number | null;
  correct: string;
  /** The comments of the chosen options. */
  feedback: string[];
  explanation: string;
  /** What whoever marked it wrote. */
  comment: string;
}

/** The right answer in words: all of them for checkboxes, any of them for texts and numbers. */
export const correctText = (q: Question): string => (autoGraded(q) ? q.correct.join(q.type === 'multi' ? ', ' : ' / ') : '');

export function optionFeedback(q: Question, a: Answer | undefined): string[] {
  if (q.type !== 'choice' && q.type !== 'dropdown' && q.type !== 'multi') return [];
  const chosen = Array.isArray(a) ? (a as string[]) : typeof a === 'string' ? [a] : [];
  return chosen.flatMap((o) => (q.feedback && Object.hasOwn(q.feedback, o) ? [q.type === 'multi' ? `${o}: ${q.feedback[o]}` : q.feedback[o]!] : []));
}

/** Each question a person was shown, with how it went. */
export function reviewLines(form: Form, answers: Record<string, Answer>, review?: Review): ReviewLine[] {
  const { shown } = route(form, answers);
  const s = score(form, answers, review);
  const nums = numbers(form);
  return form.questions
    .filter((q) => isInput(q) && shown.has(q.id))
    .map((q) => {
      const counts = form.quiz && countsPoints(q);
      const earned = counts ? (s.byQuestion[q.id] ?? null) : null;
      let mark: Mark = 'none';
      if (counts) {
        if (earned === null) mark = q.points > 0 ? 'pending' : 'none';
        else if (q.points > 0) mark = earned >= q.points ? 'right' : earned <= 0 ? 'wrong' : 'partial';
        else if (autoGraded(q)) mark = isRight(q, answers[q.id]) ? 'right' : 'wrong';
      }
      return {
        id: q.id,
        label: `${form.hideNumbers ? '' : `${nums.get(q.id)}. `}${q.title}`,
        answer: answerText(q, answers[q.id]),
        mark,
        points: counts ? q.points : null,
        earned,
        correct: form.quiz ? correctText(q) : '',
        feedback: form.quiz ? optionFeedback(q, answers[q.id]) : [],
        explanation: form.quiz ? (q.explanation ?? '') : '',
        comment: review?.comments?.[q.id] ?? '',
      };
    });
}

/** The lines worth showing back to whoever answered: the ones that count or have something to say. */
export const worthShowing = (lines: ReviewLine[]): ReviewLine[] => lines.filter((l) => l.points !== null || l.feedback.length > 0 || l.explanation !== '' || l.comment !== '');

export type Check = { problem: string } | { right: boolean; feedback: string[]; correct: string; explanation: string };

/** Practice mode: how an answer is, before sending anything. */
export function checkAnswer(q: Question, a: Answer | undefined): Check {
  if (isEmpty(a)) return { problem: 'Responde antes de comprobar.' };
  const problem = validateAnswer({ ...q, required: false }, a);
  if (problem) return { problem };
  return { right: isRight(q, a), feedback: optionFeedback(q, a), correct: correctText(q), explanation: q.explanation ?? '' };
}

/** What is said about the points that nobody has marked yet. */
export const pendingText = (pending: number): string => (pending === 1 ? 'Queda 1 punto por corregir a mano.' : `Quedan ${pending} puntos por corregir a mano.`);

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SHEET_CSS = `@page{margin:15mm}body{font:12px 'Segoe UI',Calibri,Arial,sans-serif;color:#000;background:#fff;margin:12px}section{break-after:page}section:last-child{break-after:auto}h1{font-size:19px;margin:0 0 2px}h2{font-size:15px;margin:0}p{margin:3px 0;white-space:pre-wrap;overflow-wrap:anywhere}.when{color:#444}.score{font-size:16px;font-weight:700;margin:8px 0}.q{border-top:1px solid #999;padding:6px 0;break-inside:avoid}.q h3{font-size:13px;margin:0}.mark{font-weight:700}.right{color:#0b6a0b}.wrong{color:#a4262c}.partial,.pending{color:#7a4f01}.note{border-left:3px solid #666;padding-left:8px}`;

/**
 * A page per person with their marks, to print or to give back as a file. `showCorrect` adds the right answers and the
 * explanations; comments always go.
 */
export function feedbackSheetHtml(form: Form, items: { response: Response; number: number }[], { showCorrect, locale }: { showCorrect: boolean; locale?: string }): string {
  const lang = form.language ?? 'es';
  const say = (text: string) => escape(localize(text, lang));
  const p = (text: string, kind = '') => `<p${kind ? ` class="${kind}"` : ''}>${text}</p>`;
  const sheets = items.map(({ response: r, number }) => {
    const s = score(form, r.answers, r.review);
    const lines = reviewLines(form, r.answers, r.review).map((l) => {
      const marked = l.mark === 'none' ? '' : `<span class="mark ${l.mark}">${say(MARK_NAMES[l.mark])}</span>`;
      const worth = l.points === null ? '' : l.earned === null ? say(`Puntos: hasta ${l.points}`) : say(`Puntos: ${l.earned} de ${l.points}`);
      return `<div class="q"><h3>${escape(l.label)}</h3>${marked || worth ? p([marked, worth].filter(Boolean).join(' · ')) : ''}${p(say(`Tu respuesta: ${l.answer}`))}${showCorrect && l.correct ? p(say(`Respuesta correcta: ${l.correct}`)) : ''}${l.feedback.map((f) => p(escape(f), 'note')).join('')}${showCorrect && l.explanation ? p(say(`Explicación: ${l.explanation}`), 'note') : ''}${l.comment ? p(say(`Comentario: ${l.comment}`), 'note') : ''}</div>`;
    });
    const when = new Date(r.at);
    return `<section><h1>${escape(form.title)}</h1><h2>${r.name ? escape(r.name) : say(`Respuesta ${number}`)}</h2>${Number.isNaN(when.getTime()) ? '' : p(say(`Enviado el ${when.toLocaleString(locale ?? lang, { dateStyle: 'long', timeStyle: 'short' })}`), 'when')}${p(say(`Puntuación: ${s.earned} de ${s.total}`), 'score')}${s.pending ? p(say(pendingText(s.pending))) : ''}${r.review?.comment ? p(say(`Comentario general: ${r.review.comment}`), 'note') : ''}${lines.join('')}</section>`;
  });
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(form.title)} – ${say('Hoja de devolución')}</title><style>${SHEET_CSS}</style></head><body>${sheets.join('')}</body></html>`;
}
