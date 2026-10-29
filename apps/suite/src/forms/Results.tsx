import { t } from '@suitenova/core-ui';
import { QTYPES, score, summarize, type Answer, type Form, type QSummary, type Response } from '@suitenova/forms-core';
import { useMemo, useState } from 'react';
import type { FormsCtl } from './ctl';

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
const num = (n: number): string => (Math.round(n * 100) / 100).toLocaleString();

function Bars({ items, label }: { items: { label: string; count: number; pct: number }[]; label: string }) {
  return (
    <ul className="fm-bars" aria-label={label}>
      {items.map((it) => (
        <li key={it.label}>
          <span className="fm-barlabel">{it.label}</span>
          <span className="fm-bar" aria-hidden="true">
            <span style={{ width: `${it.pct}%` }} />
          </span>
          <span className="fm-barnum">
            {it.count} ({num(it.pct)} %)
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ s, n }: { s: QSummary; n: number }) {
  const q = s.question;
  const typeName = QTYPES.find((x) => x.id === q.type)?.name ?? '';
  return (
    <section className="fm-card" aria-label={`${t('Resultados de la pregunta')} ${n}`} data-summary={q.id}>
      <div className="fm-qtitle">
        {n}. {q.title || t('(sin título)')}
      </div>
      <div className="fm-type">
        {t(typeName)} · {s.answered} {s.answered === 1 ? t('respuesta') : t('respuestas')}
      </div>
      {s.answered === 0 && <p className="fm-muted">{t('Nadie ha respondido todavía a esta pregunta.')}</p>}
      {s.answered > 0 && s.kind === 'counts' && (
        <>
          <Bars items={s.items} label={q.title} />
          {s.others.length > 0 && (
            <details>
              <summary>{t('Otras respuestas')}</summary>
              <ul>
                {s.others.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {s.answered > 0 && s.kind === 'rating' && (
        <>
          <p className="fm-big">
            {num(s.average)} / {q.max}
          </p>
          <Bars items={s.items} label={q.title} />
        </>
      )}
      {s.answered > 0 && s.kind === 'nps' && (
        <>
          <p className="fm-big" aria-label={t('Puntuación de recomendación')}>
            {s.score}
          </p>
          <p className="fm-muted">
            {t('Promotores')}: {s.promoters} · {t('Pasivos')}: {s.passives} · {t('Detractores')}: {s.detractors}
          </p>
          <Bars items={s.items} label={q.title} />
        </>
      )}
      {s.answered > 0 && s.kind === 'number' && (
        <dl className="fm-stats">
          <dt>{t('Media')}</dt>
          <dd>{num(s.average)}</dd>
          <dt>{t('Mediana')}</dt>
          <dd>{num(s.median)}</dd>
          <dt>{t('Mínimo')}</dt>
          <dd>{num(s.min)}</dd>
          <dt>{t('Máximo')}</dt>
          <dd>{num(s.max)}</dd>
        </dl>
      )}
      {s.answered > 0 && (s.kind === 'text' || s.kind === 'date') && (
        <ul className="fm-texts">
          {s.values.slice(0, 200).map((v, i) => (
            <li key={i}>{v}</li>
          ))}
          {s.values.length > 200 && <li className="fm-muted">… {s.values.length - 200} {t('más')}</li>}
        </ul>
      )}
      {s.answered > 0 && s.kind === 'likert' && (
        <table className="fm-likert">
          <thead>
            <tr>
              <th />
              {q.options.map((o) => (
                <th key={o} scope="col">
                  {o}
                </th>
              ))}
              <th scope="col">{t('Media')}</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.row}>
                <th scope="row">{r.row}</th>
                {r.counts.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
                <td>{r.average === null ? '—' : num(r.average)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function show(a: Answer | undefined): string {
  if (a === null || a === undefined) return '—';
  if (Array.isArray(a)) return a.join(', ');
  if (typeof a === 'object') return Object.entries(a).map(([k, v]) => `${k}: ${v}`).join('; ');
  return String(a);
}

function Individual({ ctl, form, responses }: { ctl: FormsCtl; form: Form; responses: Response[] }) {
  const [i, setI] = useState(0);
  const idx = Math.min(i, Math.max(0, responses.length - 1));
  const r = responses[idx];
  if (!r) return <p className="fm-empty">{t('Todavía no hay respuestas.')}</p>;
  const s = score(form, r.answers);
  return (
    <div>
      <div className="fm-pager">
        <button type="button" className="fm-btn fm-btn--sec" disabled={idx === 0} onClick={() => setI(idx - 1)} aria-label={t('Respuesta anterior')}>
          ←
        </button>
        <span aria-live="polite">
          {t('Respuesta')} {idx + 1} / {responses.length}
        </span>
        <button type="button" className="fm-btn fm-btn--sec" disabled={idx >= responses.length - 1} onClick={() => setI(idx + 1)} aria-label={t('Respuesta siguiente')}>
          →
        </button>
        <button type="button" className="fm-btn fm-btn--sec" onClick={() => ctl.deleteResponse(r.id)}>
          {t('Eliminar esta respuesta')}
        </button>
      </div>
      <section className="fm-card" aria-label={t('Respuesta individual')}>
        <p className="fm-muted">
          {fmtDate(r.at)}
          {form.quiz ? ` · ${t('Puntuación')}: ${s.earned} / ${s.total}` : ''}
        </p>
        <dl className="fm-indiv">
          {form.questions
            .filter((q) => q.type !== 'title')
            .map((q) => (
              <div key={q.id}>
                <dt>{q.title || t('(sin título)')}</dt>
                <dd>{show(r.answers[q.id])}</dd>
              </div>
            ))}
        </dl>
      </section>
    </div>
  );
}

export function Results({ ctl }: { ctl: FormsCtl }) {
  const [view, setView] = useState<'summary' | 'individual'>('summary');
  const form = ctl.form;
  const rs = ctl.responses;
  const sum = useMemo(() => summarize(form, rs), [form, rs]);
  return (
    <div className="fm-results">
      <div className="fm-top">
        <div className="fm-total" aria-label={t('Número de respuestas')}>
          <span className="fm-big">{sum.total}</span> {sum.total === 1 ? t('respuesta') : t('respuestas')}
          {sum.first && (
            <span className="fm-muted">
              {' '}
              · {fmtDate(sum.first)} – {fmtDate(sum.last!)}
            </span>
          )}
        </div>
        {sum.quiz && (
          <div className="fm-total">
            {t('Puntuación media')}: <b>{num(sum.quiz.average)}</b> / {sum.quiz.max} ({t('mejor')} {sum.quiz.best}, {t('peor')} {sum.quiz.worst})
          </div>
        )}
        <div role="tablist" className="fm-tabs" aria-label={t('Vista de resultados')}>
          <button type="button" role="tab" aria-selected={view === 'summary'} className={view === 'summary' ? 'is-on' : ''} onClick={() => setView('summary')}>
            {t('Resumen')}
          </button>
          <button type="button" role="tab" aria-selected={view === 'individual'} className={view === 'individual' ? 'is-on' : ''} onClick={() => setView('individual')}>
            {t('Individuales')}
          </button>
        </div>
      </div>
      {sum.total === 0 && (
        <p className="fm-empty">
          {t('Todavía no hay respuestas. Rellena el formulario aquí, o comparte la página web exportada y luego usa "Importar respuestas" con los archivos que te devuelvan.')}
        </p>
      )}
      {sum.total > 0 && view === 'summary' && sum.questions.map((s, i) => <Card key={s.question.id} s={s} n={form.questions.indexOf(s.question) + 1 || i + 1} />)}
      {view === 'individual' && <Individual ctl={ctl} form={form} responses={rs} />}
    </div>
  );
}
