import { t } from '@suitenova/core-ui';
import { IMAGE_SIZES, isFiles, isSafeImage, isVisible, newId, numbers, orderOf, score, validateAll, visibleAnswers, type Answer, type Form, type Question, type UploadedFile } from '@suitenova/forms-core';
import { useState } from 'react';
import { ProofTextarea } from '../spell';
import { Equation } from './Equation';
import { FileField, RankField, ScaleField } from './Fields';

type Answers = Record<string, Answer>;

interface FieldProps {
  q: Question;
  value: Answer | undefined;
  error?: string;
  /** Starts the order of shuffled options. */
  seed: string;
  /** What the files of the other questions weigh. */
  othersSize: number;
  onChange: (v: Answer) => void;
  onAddFiles: (add: (now: UploadedFile[]) => UploadedFile[]) => void;
  onReading: (by: 1 | -1) => void;
}

function Field({ q, value, error, seed, othersSize, onChange, onAddFiles, onReading }: FieldProps) {
  const name = `q-${q.id}`;
  const str = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const invalid = error ? { 'aria-invalid': true as const } : {};
  switch (q.type) {
    case 'text':
      return <input className="fm-input" type={q.format === 'email' ? 'email' : q.format === 'url' ? 'url' : 'text'} aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid} />;
    case 'longtext':
      return <ProofTextarea className="fm-input" rows={4} aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid} />;
    case 'number':
      return <input className="fm-input" type="text" inputMode="decimal" aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid} />;
    case 'date':
      return <input className="fm-input" type="date" aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid} />;
    case 'dropdown':
      return (
        <select className="fm-input" aria-label={q.title} value={str} onChange={(e) => onChange(e.target.value)} {...invalid}>
          <option value="">{t('Elige una opción')}</option>
          {orderOf(q, seed).map((o) => (
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
          {orderOf(q, seed).map((o) => (
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
      const list = Array.isArray(value) ? (value as string[]) : [];
      const full = q.maxValue !== null && list.length >= q.maxValue;
      const limit =
        q.min !== null && q.maxValue !== null
          ? q.min === q.maxValue
            ? t('Elige {n} opciones.', { n: q.min })
            : t('Elige de {a} a {b} opciones.', { a: q.min, b: q.maxValue })
          : q.min !== null
            ? t('Elige al menos {n} opciones.', { n: q.min })
            : q.maxValue !== null
              ? t('Elige como máximo {n} opciones.', { n: q.maxValue })
              : '';
      const otherVal = list.find((x) => !q.options.includes(x));
      const toggle = (o: string, on: boolean) => onChange(on ? [...list, o] : list.filter((x) => x !== o));
      return (
        <div role="group" aria-label={q.title}>
          {limit && <p className="fm-muted">{limit}</p>}
          {orderOf(q, seed).map((o) => (
            <label key={o} className="fm-opt">
              <input type="checkbox" checked={list.includes(o)} disabled={full && !list.includes(o)} onChange={(e) => toggle(o, e.target.checked)} /> {o}
            </label>
          ))}
          {q.allowOther && (
            <label className="fm-opt">
              <input type="checkbox" checked={otherVal !== undefined} disabled={full && otherVal === undefined} onChange={(e) => onChange(e.target.checked ? [...list, ' '] : list.filter((x) => q.options.includes(x)))} /> {t('Otro:')}
              <input
                className="fm-input"
                type="text"
                aria-label={t('Otro')}
                value={otherVal?.trim() ?? ''}
                disabled={full && otherVal === undefined}
                onChange={(e) => onChange([...list.filter((x) => q.options.includes(x)), e.target.value || ' '])}
              />
            </label>
          )}
        </div>
      );
    }
    case 'rating':
    case 'nps':
      return <ScaleField q={q} name={name} value={value} onChange={onChange} />;
    case 'ranking':
      return <RankField q={q} seed={seed} value={value} onChange={onChange} />;
    case 'file':
      return <FileField q={q} value={value} othersSize={othersSize} error={error} onAdd={onAddFiles} onChange={onChange} onReading={onReading} />;
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
export function Runner({ form, onSubmit, onAgain, draft, seed }: { form: Form; onSubmit: ((a: Answers) => void) | null; onAgain?: () => void; /** Where a half-filled answer is kept while this is not on screen. */ draft?: { answers: Answers; keep: (change: (now: Answers) => Answers) => void }; /** Starts the order of shuffled options; without it, one of its own. */ seed?: string }) {
  const [own, setOwn] = useState<Answers>({});
  const answers = draft ? draft.answers : own;
  // changes are made from what there is then: a file arrives a moment after it was chosen
  const change = (fn: (now: Answers) => Answers) => (draft ? draft.keep(fn) : setOwn(fn));
  const [ownSeed, setOwnSeed] = useState(() => newId('s'));
  const [reading, setReading] = useState(0);
  const nums = numbers(form);
  const weight = (a: Answer | undefined) => (isFiles(a) ? a.reduce((n, f) => n + f.size, 0) : 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Answers | null>(null);

  const reset = () => {
    change(() => ({}));
    setOwnSeed(newId('s'));
    setErrors({});
    setDone(null);
    onAgain?.();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reading > 0) return;
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
      // only the typed «other» of the checkboxes needs trimming: files and what was put in order stay as they are
      else if (Array.isArray(v) && form.questions.find((q) => q.id === k)?.type === 'multi') clean[k] = (v as string[]).map((x) => x.trim()).filter(Boolean);
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
      <div className="fm-card fm-done nv-work" role="status">
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
      <div className="fm-card fm-head nv-work" style={{ borderTopColor: form.color }}>
        <h1>{form.title}</h1>
        {form.description && <p className="fm-desc">{form.description}</p>}
      </div>
      {form.questions.map((q) => {
        if (!isVisible(form, q, answers)) return null;
        if (q.type === 'title')
          return (
            <div key={q.id} className="fm-card nv-work">
              <h2>{q.title}</h2>
              {q.description && <p className="fm-desc">{q.description}</p>}
              <Equation tex={q.equation} />
              <QImage q={q} />
            </div>
          );
        return (
          <div key={q.id} id={`fm-q-${q.id}`} className="fm-card nv-work">
            <div className="fm-qtitle">
              {nums.get(q.id)}. {q.title}
              {q.required && <span className="fm-req" aria-label={t('obligatoria')}> *</span>}
            </div>
            {q.description && <p className="fm-desc">{q.description}</p>}
            <Equation tex={q.equation} />
            <QImage q={q} />
            <Field
              q={q}
              value={answers[q.id]}
              error={errors[q.id]}
              seed={seed ?? ownSeed}
              othersSize={Object.entries(answers).reduce((n, [id, a]) => (id === q.id ? n : n + weight(a)), 0)}
              onChange={(v) => change((now) => ({ ...now, [q.id]: v }))}
              onAddFiles={(add) => change((now) => ({ ...now, [q.id]: add(isFiles(now[q.id]) ? (now[q.id] as UploadedFile[]) : []) }))}
              onReading={(by) => setReading((n) => n + by)}
            />
            {errors[q.id] && (
              <p className="fm-err" role="alert">
                {t(errors[q.id]!)}
              </p>
            )}
          </div>
        );
      })}
      <div className="fm-card nv-work">
        <button type="submit" className="fm-btn" disabled={reading > 0} style={{ background: form.color, borderColor: form.color }}>
          {onSubmit ? t('Enviar') : t('Enviar (prueba)')}
        </button>
        <button type="button" className="fm-btn fm-btn--sec" onClick={reset}>
          {t('Borrar respuestas')}
        </button>
      </div>
    </form>
  );
}

/** The picture of a question, at the width it was given (never past the card). */
export function QImage({ q }: { q: Question }) {
  const m = q.image;
  if (!m || !isSafeImage(m.src)) return null;
  const px = IMAGE_SIZES.find((z) => z.id === m.size)?.px;
  return <img className="fm-qimg" src={m.src} alt={m.alt} style={px ? { width: px } : undefined} />;
}
