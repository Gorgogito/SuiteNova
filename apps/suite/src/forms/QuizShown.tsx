/* What whoever answers a quiz is shown: their marks once sent, and each answer checked in practice mode. */
import { MARK_NAMES, checkAnswer, type Answer, type Check, type Question, type ReviewLine } from '@suitenova/forms-core';
import { useContext, useEffect, useState } from 'react';
import { Say } from './Fields';

/** Each answer with how it went, the right one, the comments and the explanation. */
export function QuizReview({ lines }: { lines: ReviewLine[] }) {
  const say = useContext(Say);
  return (
    <div className="fm-card fm-review nv-work" role="region" aria-label={say('Respuestas y comentarios')}>
      <h2>{say('Respuestas y comentarios')}</h2>
      {lines.map((l) => (
        <div key={l.id} className="fm-line">
          <h3>{l.label}</h3>
          {(l.mark !== 'none' || l.points !== null) && (
            <p>
              {l.mark !== 'none' && <span className={`fm-mark is-${l.mark}`}>{say(MARK_NAMES[l.mark])}</span>}
              {l.points !== null && `${l.mark !== 'none' ? ' · ' : ''}${say(l.earned === null ? `Puntos: hasta ${l.points}` : `Puntos: ${l.earned} de ${l.points}`)}`}
            </p>
          )}
          <p>{say(`Tu respuesta: ${l.answer}`)}</p>
          {l.correct && <p>{say(`Respuesta correcta: ${l.correct}`)}</p>}
          {l.feedback.map((f) => (
            <p key={f}>{f}</p>
          ))}
          {l.explanation && <p>{say(`Explicación: ${l.explanation}`)}</p>}
        </div>
      ))}
    </div>
  );
}

/** Practice mode: checks one answer; it can be changed and checked again. */
export function PracticeCheck({ q, value }: { q: Question; value: Answer | undefined }) {
  const say = useContext(Say);
  const [said, setSaid] = useState<{ of: string; check: Check } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const now = JSON.stringify(value ?? null);
  // what was said no longer holds once the answer changes
  const result = said?.of === now ? said.check : null;
  useEffect(() => {
    if (said && said.of !== now) {
      setSaid(null);
      setRevealed(false);
    }
  }, [said, now]);
  const explain = (r: Exclude<Check, { problem: string }>) => r.explanation && <p>{say(`Explicación: ${r.explanation}`)}</p>;
  return (
    <div className="fm-practice">
      <button
        type="button"
        className="fm-btn fm-btn--sec"
        onClick={() => {
          setRevealed(false);
          setSaid({ of: now, check: checkAnswer(q, value) });
        }}
      >
        {say('Comprobar')}
      </button>
      <div role="status">
        {result && 'problem' in result && <p className="fm-err">{say(result.problem)}</p>}
        {result && !('problem' in result) && (
          <div className={`fm-verdict is-${result.right ? 'right' : 'wrong'}`}>
            <p className={`fm-mark is-${result.right ? 'right' : 'wrong'}`}>{say(result.right ? '¡Correcto!' : 'No es correcto. Puedes cambiar la respuesta y volver a comprobar.')}</p>
            {result.feedback.map((f) => (
              <p key={f}>{f}</p>
            ))}
            {result.right ? (
              explain(result)
            ) : revealed ? (
              <>
                <p>{say(`Respuesta correcta: ${result.correct}`)}</p>
                {explain(result)}
              </>
            ) : (
              <button type="button" className="fm-add" onClick={() => setRevealed(true)}>
                {say('Ver la respuesta')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
