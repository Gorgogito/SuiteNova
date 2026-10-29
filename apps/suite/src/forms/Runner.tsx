import { t } from '@suitenova/core-ui';
import { isVisible, score, validateAll, visibleAnswers, type Answer, type Form, type Question } from '@suitenova/forms-core';
import { useState } from 'react';

type Answers = Record<string, Answer>;

function Field({ q, value, error, onChange }: { q: Question; value: Answer | undefined; error?: string; onChange: (v: Answer) => void }) {
  const name = `q-${q.id}`;
  const str = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const invalid = error ? { 'aria-invalid': true as const } : {};
  switch (q.type) {
    case 'text':
      return <input className="fm-input" type={q.format === 'email' ? 'email' : q.format === 'url' ? 'url' : 'text'} aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid} />;
    case 'longtext':
      return <textarea className="fm-input" rows={4} aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid} />;
    case 'number':
      return <input className="fm-input" type="text" inputMode="decimal" aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid} />;
    case 'date':
      return <input className="fm-input" type="date" aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid} />;
    case 'dropdown':
      return (
        <select className="fm-input" aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid}>
          <option value="">{t('Elige una opción')}</option>
          {q.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'choice': {
      const other = typeof value === 'string' && value !== '' && !q.options.includes(value);
      return (
        <div role="radiogroup" aria-label={q.title}>
          {q.options.map((o) => (
            <label key={o} className="fm-opt">
              <input type="radio" name={name} checked={value === o} onChange={() => onChange(o)} /> {o}
            </label>
          ))}
          {q.allowOther && (
            <label className="fm-opt">
              <input type="radio" name={name} checked={other} onChange={() => onChange(' ')} /> {t('Otro:')}
              <input className="fm-input" type="text" aria-label={t('Otro')} value={other ? String(value).trim() : ''} onChange={(e) => onChange(e.target.value || ' ')} />
            </label>
          )}
        </div>
      );
    }
    case 'multi': {
      const list = Array.isArray(value) ? value : [];
      const otherVal = list.find((x) => !q.options.includes(x));
      const toggle = (o: string, on: boolean) => onChange(on ? [...list, o] : list.filter((x) => x !== o));
      return (
        <div role="group" aria-label={q.title}>
          {q.options.map((o) => (
            <label key={o} className="fm-opt">
              <input type="checkbox" checked={list.includes(o)} onChange={(e) => toggle(o, e.target.checked)} /> {o}
            </label>
          ))}
          {q.allowOther && (
            <label className="fm-opt">
              <input type="checkbox" checked={otherVal !== undefined} onChange={(e) => onChange(e.target.checked ? [...list, ' '] : list.filter((x) => q.options.includes(x)))} /> {t('Otro:')}
              <input
                className="fm-input"
                type="text"
                aria-label={t('Otro')}
                value={otherVal?.trim() ?? ''}
                onChange={(e) => onChange([...list.filter((x) => q.options.includes(x)), e.target.value || ' '])}
              />
            </label>
          )}
        </div>
      );
    }
    case 'rating':
    case 'nps': {
      const lo = q.type === 'nps' ? 0 : 1;
      const hi = q.type === 'nps' ? 10 : q.max;
      return (
        <div>
          <div className="fm-scale" role="radiogroup" aria-label={q.title}>
            {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((n) => (
              <label key={n} className={value === n ? 'is-on' : ''}>
                <input type="radio" name={name} checked={value === n} onChange={() => onChange(n)} />
                {n}
              </label>
            ))}
          </div>
          {q.type === 'nps' && (
            <div className="fm-ends">
              <span>{t('Nada probable')}</span>
              <span>{t('Muy probable')}</span>
            </div>
          )}
        </div>
      );
    }
    case 'likert': {
      const rec = typeof value === 'object' && value && !Array.isArray(value) ? (value as Record<string, string>) : {};
      return (
        <table className="fm-likert">
          <thead>
            <tr>
              <th />
              {q.options.map((o) => (
                <th key={o} scope="col">
                  {o}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.rows.map((r, ri) => (
              <tr key={r}>
                <th scope="row">{r}</th>
                {q.options.map((o) => (
                  <td key={o}>
                    <input type="radio" name={`${name}-${ri}`} aria-label={`${r}: ${o}`} checked={rec[r] === o} onChange={() => onChange({ ...rec, [r]: o })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    default:
      return null;
  }
}

/** Fill in a form. With `onSubmit` the answers are handed over; without it this is only a preview. */
export function Runner({ form, onSubmit, onAgain }: { form: Form; onSubmit: ((a: Answers) => void) | null; onAgain?: () => void }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Answers | null>(null);

  const reset = () => {
    setAnswers({});
    setErrors({});
    setDone(null);
    onAgain?.();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateAll(form, answers);
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = form.questions.find((q) => errs[q.id]);
      if (first) document.getElementById(`fm-q-${first.id}`)?.scrollIntoView({ block: 'center' });
      return;
    }
    // the "other" box starts as a single space until something is typed
    const clean = visibleAnswers(form, answers);
    for (const k of Object.keys(clean)) {
      const v = clean[k];
      if (typeof v === 'string') clean[k] = v.trim();
      else if (Array.isArray(v)) clean[k] = v.map((x) => x.trim()).filter(Boolean);
    }
    for (const q of form.questions) {
      const v = clean[q.id];
      if (q.type === 'number' && typeof v === 'string') clean[q.id] = Number(v.replace(',', '.'));
    }
    onSubmit?.(clean);
    setDone(clean);
  };

  if (done) {
    const s = score(form, done);
    return (
      <div className="fm-card fm-done" role="status">
        <h2>{onSubmit ? t('Respuesta guardada') : t('Así se vería al terminar')}</h2>
        <p>{form.thanks}</p>
        {form.quiz && form.showScore && (
          <p className="fm-score">
            {t('Puntuación')}: {s.earned} / {s.total}
          </p>
        )}
        {!onSubmit && <p>{t('Esto es solo una vista previa: no se ha guardado nada.')}</p>}
        <button type="button" className="fm-btn" onClick={reset}>
          {onSubmit ? t('Rellenar otra respuesta') : t('Volver a probar')}
        </button>
      </div>
    );
  }

  return (
    <form className="fm-run" noValidate onSubmit={submit} aria-label={form.title}>
      <div className="fm-card fm-head" style={{ borderTopColor: form.color }}>
        <h1>{form.title}</h1>
        {form.description && <p className="fm-desc">{form.description}</p>}
      </div>
      {form.questions.map((q, i) => {
        if (!isVisible(form, q, answers)) return null;
        if (q.type === 'title')
          return (
            <div key={q.id} className="fm-card">
              <h2>{q.title}</h2>
              {q.description && <p className="fm-desc">{q.description}</p>}
            </div>
          );
        return (
          <div key={q.id} id={`fm-q-${q.id}`} className="fm-card">
            <div className="fm-qtitle">
              {i + 1}. {q.title}
              {q.required && <span className="fm-req" aria-label={t('obligatoria')}> *</span>}
            </div>
            {q.description && <p className="fm-desc">{q.description}</p>}
            <Field q={q} value={answers[q.id]} error={errors[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
            {errors[q.id] && (
              <p className="fm-err" role="alert">
                {t(errors[q.id]!)}
              </p>
            )}
          </div>
        );
      })}
      <div className="fm-card">
        <button type="submit" className="fm-btn" style={{ background: form.color, borderColor: form.color }}>
          {onSubmit ? t('Enviar') : t('Enviar (prueba)')}
        </button>
        <button type="button" className="fm-btn fm-btn--sec" onClick={reset}>
          {t('Borrar respuestas')}
        </button>
      </div>
    </form>
  );
}
