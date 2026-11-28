import { t } from '@suitenova/core-ui';
import { MAX_COMMENT, MAX_FEEDBACK, canBeManual, gradable, manualGraded, type Form, type Question } from '@suitenova/forms-core';
import { useState } from 'react';
import { ProofTextarea } from '../spell';
import { DraftInput } from './DraftInput';

/** Whether a question has anything to set in a quiz. */
export const quizzable = (q: Question): boolean => gradable(q) || canBeManual(q);

/** How a question of a quiz is marked, and what is said about it. */
export function QuizFields({ form, q, up }: { form: Form; q: Question; up: (patch: Partial<Question>, typing?: boolean) => void }) {
  const byHand = manualGraded(q);
  const options = q.type === 'choice' || q.type === 'multi' || q.type === 'dropdown';
  const [commenting, setCommenting] = useState(!!q.feedback);
  const accepted = q.type === 'text' ? t('Respuestas aceptadas (separadas por punto y coma)') : t('Valores aceptados (separados por punto y coma)');
  const comment = (option: string, text: string) => {
    const feedback = Object.fromEntries(Object.entries({ ...q.feedback, [option]: text.slice(0, MAX_FEEDBACK) }).filter(([, said]) => said !== ''));
    up({ feedback: Object.keys(feedback).length ? feedback : undefined }, true);
  };
  return (
    <fieldset className="fm-fieldset">
      <legend>{gradable(q) ? t('Respuesta correcta') : t('Puntuación')}</legend>
      {canBeManual(q) && (
        <label className="fm-check">
          <input type="checkbox" checked={byHand} onChange={(e) => up({ manual: e.target.checked || undefined })} /> {gradable(q) ? t('Corregir a mano') : t('Puntúa (se corrige a mano)')}
        </label>
      )}
      {(q.type === 'choice' || q.type === 'dropdown') &&
        q.options.map((o) => (
          <label key={o} className="fm-check">
            <input type="radio" name={`ok-${q.id}`} checked={q.correct[0] === o} onChange={() => up({ correct: [o] })} /> {o}
          </label>
        ))}
      {q.type === 'multi' &&
        q.options.map((o) => (
          <label key={o} className="fm-check">
            <input type="checkbox" checked={q.correct.includes(o)} onChange={(e) => up({ correct: e.target.checked ? [...q.correct, o] : q.correct.filter((x) => x !== o) })} /> {o}
          </label>
        ))}
      {(q.type === 'text' || q.type === 'number') && !byHand && (
        <label className="fm-field">
          <span>{accepted}</span>
          <DraftInput
            className="fm-input"
            aria-label={accepted}
            value={q.correct.join('; ')}
            onCommit={(text) => {
              up({ correct: text.split(';').map((x) => x.trim()).filter(Boolean) });
              return null;
            }}
          />
        </label>
      )}
      {(gradable(q) || byHand) && (
        <label className="fm-field fm-inline">
          <span>{t('Puntos')}</span>
          <input className="fm-input fm-narrow" type="number" min={0} value={q.points} onChange={(e) => up({ points: Math.min(1000, Math.max(0, Number(e.target.value) || 0)) }, true)} />
        </label>
      )}
      {gradable(q) && !byHand && q.correct.length === 0 && <p className="fm-muted">{t('Sin respuesta correcta no puntúa.')}</p>}
      {options && (
        <>
          <button type="button" className="fm-add" aria-expanded={commenting} onClick={() => setCommenting(!commenting)}>
            {t('Comentarios para quien elija cada opción')}
          </button>
          {commenting &&
            q.options.map((o) => (
              <label key={o} className="fm-field">
                <span>{o}</span>
                <input className="fm-input" aria-label={t('Comentario para «{option}»', { option: o })} maxLength={MAX_FEEDBACK} value={q.feedback?.[o] ?? ''} onChange={(e) => comment(o, e.target.value)} />
              </label>
            ))}
        </>
      )}
      <label className="fm-field">
        <span>{t('Explicación (se ve con la respuesta)')}</span>
        <ProofTextarea className="fm-input" rows={2} aria-label={t('Explicación (se ve con la respuesta)')} maxLength={MAX_COMMENT} value={q.explanation ?? ''} onChange={(e) => up({ explanation: e.target.value || undefined }, true)} />
      </label>
      {!form.showAnswers && !form.practice && (q.explanation || q.feedback) && (
        <p className="fm-muted" role="note">
          {t('Quien responde verá los comentarios y las explicaciones si activas «Mostrar las respuestas al terminar» o «Modo práctica» (pestaña Diseño). También salen en las hojas de devolución.')}
        </p>
      )}
    </fieldset>
  );
}
