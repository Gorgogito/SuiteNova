import { t } from '@suitenova/core-ui';
import { printPage } from '../mail/print';
import { IMAGE_SIZES, isFiles, isSafeImage, newId, numbers, orderOf, score, validateAll, type Answer, type Form, type Question, type UploadedFile, displayOrder, isInput, pageAfter, pagesOf, route, MAX_NAME, availability, closedText, localize, receiptHtml, tidyAnswers, timedAnswers } from '@suitenova/forms-core';
import { useContext, useEffect, useRef, useState } from 'react';
import { ProofTextarea } from '../spell';
import { Equation } from './Equation';
import { FileField, RankField, Say, ScaleField } from './Fields';

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
  const say = useContext(Say);
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
          <option value="">{say('Elige una opción')}</option>
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
              <input type="radio" name={name} checked={other} onChange={() => onChange(' ')} /> {say('Otro:')}
              <input className="fm-input" type="text" aria-label={say('Otro')} value={other ? String(value).trim() : ''} onChange={(e) => onChange(e.target.value || ' ')} />
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
          ? say(q.min === q.maxValue ? `Elige ${q.min} opciones.` : `Elige de ${q.min} a ${q.maxValue} opciones.`)
          : q.min !== null
            ? say(`Elige al menos ${q.min} opciones.`)
            : q.maxValue !== null
              ? say(`Elige como máximo ${q.maxValue} opciones.`)
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
              <input type="checkbox" checked={otherVal !== undefined} disabled={full && otherVal === undefined} onChange={(e) => onChange(e.target.checked ? [...list, ' '] : list.filter((x) => q.options.includes(x)))} /> {say('Otro:')}
              <input
                className="fm-input"
                type="text"
                aria-label={say('Otro')}
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
        <div className="fm-wide">
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
        </div>
      );
    }
    default:
      return null;
  }
}

/** Where a half-filled answer is kept while this is not on screen. */
export interface Draft {
  answers: Answers;
  keep: (change: (now: Answers) => Answers) => void;
  page: number;
  keepPage: (page: number) => void;
  name: string;
  keepName: (name: string) => void;
  /** When the person started, with a time limit. */
  started: number | null;
  keepStarted: (at: number | null) => void;
}

interface Done {
  answers: Answers;
  name: string;
  at: string;
  /** The time ran out. */
  timed: boolean;
}

/** `12:05` for the seconds that are left. */
const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Fill in a form, as whoever answers sees it and in the language of the form. With `onSubmit` the answers are handed
 * over; without it this is only a preview, which also shows a form that is not taking answers.
 */
export function Runner({ form, onSubmit, draft, seed }: { form: Form; onSubmit: ((a: Answers, name: string) => void) | null; draft?: Draft; /** Starts the order of shuffled options; without it, one of its own. */ seed?: string }) {
  const say = (text: string) => localize(text, form.language);
  const [own, setOwn] = useState<Answers>({});
  const answers = draft ? draft.answers : own;
  // changes are made from what there is then: a file arrives a moment after it was chosen
  const change = (fn: (now: Answers) => Answers) => (draft ? draft.keep(fn) : setOwn(fn));
  const [ownSeed, setOwnSeed] = useState(() => newId('s'));
  const [reading, setReading] = useState(0);
  const [ownPage, setOwnPage] = useState(0);
  const setPage = draft ? draft.keepPage : setOwnPage;
  const [ownName, setOwnName] = useState('');
  const name = draft ? draft.name : ownName;
  const setName = draft ? draft.keepName : setOwnName;
  const [ownStarted, setOwnStarted] = useState<number | null>(null);
  const started = draft ? draft.started : ownStarted;
  const setStarted = draft ? draft.keepStarted : setOwnStarted;
  const [now, setNow] = useState(() => Date.now());
  const order = displayOrder(form, seed ?? ownSeed);
  const nums = numbers({ questions: order });
  const pages = pagesOf(form);
  const way = route(form, answers);
  const asked = draft ? draft.page : ownPage;
  // a change of mind can take the page one is on out of the way: back to the last one that is still on it
  const page = way.pages.includes(asked) ? asked : (way.pages.filter((p) => p < asked).pop() ?? 0);
  const next = pageAfter(pages, page, way.shown, answers);
  const last = next >= pages.length;
  const before = way.pages[way.pages.indexOf(page) - 1];
  const pageOf = new Map(pages.flatMap((p, i) => [...(p.section ? [p.section] : []), ...p.items].map((q) => [q.id, i] as const)));
  const top = useRef<HTMLFormElement>(null);
  // after turning the page, the focus goes to its beginning
  const turned = useRef(false);
  useEffect(() => {
    if (!turned.current) return;
    turned.current = false;
    const first = top.current?.querySelector<HTMLElement>('[data-page] h2, [data-page] input, [data-page] select, [data-page] textarea, [data-page] button');
    top.current?.scrollIntoView({ block: 'start' });
    first?.focus({ preventScroll: true });
  });
  const go = (to: number) => {
    turned.current = true;
    setPage(to);
  };
  const weight = (a: Answer | undefined) => (isFiles(a) ? a.reduce((n, f) => n + f.size, 0) : 0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Done | null>(null);
  const state = availability(form, now);
  const limit = form.timeLimit;
  const running = !!limit && started !== null && !done;
  const left = running ? Math.max(0, Math.ceil((started! + limit! * 60_000 - now) / 1000)) : null;
  // the clock: for the time that is left, and for a form that opens or closes while it is on screen
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), running ? 500 : 15_000);
    return () => clearInterval(id);
  }, [running]);
  // the time ran out: what was answered rightly is kept, and nothing can be changed any more
  useEffect(() => {
    if (left !== 0) return;
    if (onSubmit && availability(form, Date.now()) !== 'open') return setNow(Date.now());
    const kept = timedAnswers(form, answers);
    if (Object.keys(kept).length) onSubmit?.(kept, name);
    else {
      // nothing to keep: the next try starts from the beginning
      reset();
      setStarted(null);
    }
    setDone({ answers: kept, name: name.trim(), at: new Date().toISOString(), timed: true });
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    change(() => ({}));
    setName('');
    setPage(0);
    setErrors({});
  };
  const again = () => {
    reset();
    setStarted(null);
    setOwnSeed(newId('s'));
    setNow(Date.now());
    setDone(null);
  };
  const nameless = (): boolean => !!form.askName && !name.trim();
  /** On to the next page, once this one is right. */
  const forward = () => {
    if (reading > 0) return;
    const here: Record<string, string> = Object.fromEntries(Object.entries(validateAll(form, answers)).filter(([id]) => pageOf.get(id) === page));
    if (page === 0 && nameless()) here.__name = 'Escribe tu nombre.';
    setErrors(here);
    const wrong = here.__name ? 'fm-who' : order.find((q) => here[q.id])?.id;
    if (wrong) document.getElementById(wrong === 'fm-who' ? wrong : `fm-q-${wrong}`)?.scrollIntoView({ block: 'center' });
    else go(next);
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reading > 0) return;
    // it may have closed while it was being answered
    if (onSubmit && availability(form, Date.now()) !== 'open') return setNow(Date.now());
    if (!last) return forward();
    const errs = validateAll(form, answers);
    if (nameless()) errs.__name = 'Escribe tu nombre.';
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = errs.__name ? undefined : order.find((q) => errs[q.id]);
      setPage(first ? pageOf.get(first.id)! : 0);
      setTimeout(() => document.getElementById(first ? `fm-q-${first.id}` : 'fm-who')?.scrollIntoView({ block: 'center' }), 0);
      return;
    }
    const clean = tidyAnswers(form, answers);
    onSubmit?.(clean, name);
    setDone({ answers: clean, name: name.trim(), at: new Date().toISOString(), timed: false });
  };

  const head = (
    <div className="fm-card fm-head nv-work" style={{ borderTopColor: form.color }}>
      <h1>{form.title}</h1>
      {form.description && <p className="fm-desc">{form.description}</p>}
    </div>
  );

  if (done) {
    const s = score(form, done.answers);
    const saved = !done.timed || Object.keys(done.answers).length > 0;
    return (
      <div className="fm-card fm-done nv-work" role="status">
        <h2>{say(done.timed ? 'Se acabó el tiempo.' : onSubmit ? 'Respuesta guardada' : 'Así se vería al terminar')}</h2>
        {done.timed && <p>{say(saved ? 'Se envió lo que habías respondido.' : 'No habías respondido nada.')}</p>}
        {saved && <p>{say(form.thanks)}</p>}
        {saved && form.quiz && form.showScore && (
          <p className="fm-score">
            {say('Puntuación')}: {s.earned} / {s.total}
          </p>
        )}
        {!onSubmit && <p>{say('Esto es solo una vista previa: no se ha guardado nada.')}</p>}
        {saved && form.receipt && (
          <button type="button" className="fm-btn fm-btn--sec" onClick={() => printPage(receiptHtml(form, done.answers, done.name || undefined, done.at))}>
            {say('Imprimir o guardar mis respuestas')}
          </button>
        )}
        {(!onSubmit || !form.noAgain) && (
          <button type="button" className="fm-btn" onClick={again}>
            {say(onSubmit ? 'Rellenar otra respuesta' : 'Volver a probar')}
          </button>
        )}
      </div>
    );
  }

  // a form that is not taking answers shows nothing else to whoever answers it
  if (onSubmit && state !== 'open')
    return (
      <div className="fm-run">
        {head}
        <div className="fm-card fm-notice nv-work" role="status">
          {closedText(form, state).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="fm-muted">{t('Quien responda verá esto. Puedes cambiarlo en Diseño › Ajustes del formulario.')}</p>
        </div>
      </div>
    );

  if (limit && started === null)
    return (
      <div className="fm-run">
        {head}
        <div className="fm-card nv-work">
          <p>{say(limit === 1 ? 'Este formulario tiene un tiempo límite de 1 minuto.' : `Este formulario tiene un tiempo límite de ${limit} minutos.`)}</p>
          <p>{say('El tiempo empieza al pulsar «Empezar».')}</p>
          <button
            type="button"
            className="fm-btn"
            style={{ background: form.color, borderColor: form.color }}
            onClick={() => {
              setNow(Date.now());
              setStarted(Date.now());
            }}
          >
            {say('Empezar')}
          </button>
        </div>
      </div>
    );

  return (
    <Say.Provider value={say}>
      <form
        className="fm-run"
        noValidate
        onSubmit={submit}
        aria-label={form.title}
        ref={top}
        // Enter in a box of a page that is not the last goes on
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !last && !e.defaultPrevented && e.target instanceof HTMLInputElement && e.target.type !== 'file') {
            e.preventDefault();
            forward();
          }
        }}
      >
        {!onSubmit && state !== 'open' && (
          <div className="fm-card fm-notice nv-work" role="note">
            {t('Ahora mismo no admite respuestas: así se vería al responderlo cuando las admita.')}
          </div>
        )}
        {head}
        {left !== null && (
          <div className="fm-card fm-timer nv-work" role="timer" aria-live="off">
            {say(`Tiempo restante: ${clock(left)}`)}
          </div>
        )}
        {form.progress && pages.length > 1 && (
          <div className="fm-progress">
            <span role="status">{say(`Página ${page + 1} de ${pages.length}`)}</span>
            <progress max={pages.length} value={page + 1} aria-label={say('Progreso')} />
          </div>
        )}
        {form.askName && page === 0 && (
          <div id="fm-who" className="fm-card nv-work">
            <label className="fm-field">
              <span className="fm-qtitle">
                {say('Tu nombre')}
                <span className="fm-req" aria-label={say('obligatoria')}> *</span>
              </span>
              <input className="fm-input" type="text" autoComplete="name" maxLength={MAX_NAME} value={name} aria-invalid={errors.__name ? true : undefined} onChange={(e) => setName(e.target.value)} />
            </label>
            {errors.__name && (
              <p className="fm-err" role="alert">
                {say(errors.__name)}
              </p>
            )}
          </div>
        )}
        {order.map((q) => {
          if (pageOf.get(q.id) !== page || !way.shown.has(q.id)) return null;
          // a section that says nothing only starts a page: there is nothing to show
          if (q.type === 'section' && !q.title.trim() && !q.description.trim() && !q.equation && !q.image) return null;
          if (!isInput(q))
            return (
              <div key={q.id} className={`fm-card nv-work${q.type === 'section' ? ' fm-section' : ''}`} data-page>
                <h2 tabIndex={-1}>{q.title}</h2>
                {q.description && <p className="fm-desc">{q.description}</p>}
                <Equation tex={q.equation} />
                <QImage q={q} />
              </div>
            );
          return (
            <div key={q.id} id={`fm-q-${q.id}`} className="fm-card nv-work" data-page>
              <div className="fm-qtitle">
                {form.hideNumbers ? '' : `${nums.get(q.id)}. `}
                {q.title}
                {q.required && <span className="fm-req" aria-label={say('obligatoria')}> *</span>}
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
                onChange={(v) => change((then) => ({ ...then, [q.id]: v }))}
                onAddFiles={(add) => change((then) => ({ ...then, [q.id]: add(isFiles(then[q.id]) ? (then[q.id] as UploadedFile[]) : []) }))}
                onReading={(by) => setReading((n) => n + by)}
              />
              {errors[q.id] && (
                <p className="fm-err" role="alert">
                  {say(errors[q.id]!)}
                </p>
              )}
            </div>
          );
        })}
        <div className="fm-card nv-work">
          {before !== undefined && (
            <button type="button" className="fm-btn fm-btn--sec" onClick={() => (setErrors({}), go(before))}>
              {say('Atrás')}
            </button>
          )}
          {last ? (
            <button key="send" type="submit" className="fm-btn" disabled={reading > 0} style={{ background: form.color, borderColor: form.color }}>
              {say(onSubmit ? 'Enviar' : 'Enviar (prueba)')}
            </button>
          ) : (
            <button key="next" type="button" className="fm-btn" disabled={reading > 0} style={{ background: form.color, borderColor: form.color }} onClick={forward}>
              {say('Siguiente')}
            </button>
          )}
          <button type="button" className="fm-btn fm-btn--sec" onClick={reset}>
            {say('Borrar respuestas')}
          </button>
        </div>
      </form>
    </Say.Provider>
  );
}

/** The picture of a question, at the width it was given (never past the card). */
export function QImage({ q }: { q: Question }) {
  const m = q.image;
  if (!m || !isSafeImage(m.src)) return null;
  const px = IMAGE_SIZES.find((z) => z.id === m.size)?.px;
  return <img className="fm-qimg" src={m.src} alt={m.alt} style={px ? { width: px } : undefined} />;
}
