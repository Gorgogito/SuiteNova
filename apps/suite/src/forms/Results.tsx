/* The results: the figures and charts of each question, a table of the responses, one response at a time and the marking. */
import { t } from '@suitenova/core-ui';
import { CHART_KINDS, OTHER_ANSWER, QTYPES, answerText, chartsFor, durationText, filterResponses, filterValues, filterable, isFiles, isFiltering, isInput, numbers, score, summarize, summaryHtml, type Answer, type ChartKind, type Form, type QSummary, type Question, type Response, type SortKey, type UploadedFile } from '@suitenova/forms-core';
import { useMemo, useState } from 'react';
import { saveBytes } from '../fileio';
import { safeFileName } from '../mail/attachments';
import { printPage } from '../mail/print';
import type { FormsCtl, ResultsView } from './ctl';
import { Equation } from './Equation';
import { FileLine } from './FileLine';
import { Grading } from './Grading';
import { PRINT_COLORS, QuestionChart, questionSvg } from './QuestionChart';
import { saveUploads } from './uploads';

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
const num = (n: number): string => (Math.round(n * 100) / 100).toLocaleString();
/** Rows of the table shown at once. */
const PER_PAGE = 50;

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

function Card({ ctl, s, n, numberOf }: { ctl: FormsCtl; s: QSummary; n: number; /** The number each summarised response has in the whole list. */ numberOf: (i: number) => number }) {
  const q = s.question;
  const typeName = QTYPES.find((x) => x.id === q.type)?.name ?? '';
  const kinds = chartsFor(q);
  const chart = q.chart && kinds.includes(q.chart) ? q.chart : undefined;
  return (
    <section className="fm-card nv-work" aria-label={`${t('Resultados de la pregunta')} ${n}`} data-summary={q.id}>
      <div className="fm-qtitle">
        {n}. {q.title || t('(sin título)')}
      </div>
      <div className="fm-type">
        {t(typeName)} · {s.answered} {s.answered === 1 ? t('respuesta') : t('respuestas')}
      </div>
      <Equation tex={q.equation} />
      {s.answered === 0 && <p className="fm-muted">{t('Nadie ha respondido todavía a esta pregunta.')}</p>}
      {s.answered > 0 && kinds.length > 0 && (
        <label className="fm-field fm-inline">
          <span>{t('Gráfico')}</span>
          <select className="fm-input fm-narrow" aria-label={t('Gráfico de la pregunta {n}', { n })} value={chart ?? ''} onChange={(e) => ctl.updateQuestion(q.id, { chart: (e.target.value || undefined) as ChartKind | undefined })}>
            <option value="">{t('Barras')}</option>
            {CHART_KINDS.filter((k) => kinds.includes(k.id)).map((k) => (
              <option key={k.id} value={k.id}>
                {t(k.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      {s.answered > 0 && chart && <QuestionChart s={s} kind={chart} language={ctl.form.language ?? 'es'} />}
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
      {s.answered > 0 && s.kind === 'ranking' && (
        <div className="fm-wide">
          <table className="fm-likert" aria-label={t('Clasificación')}>
            <thead>
              <tr>
                <th scope="col">{t('Elemento')}</th>
                <th scope="col">{t('Puesto medio')}</th>
                <th scope="col">{t('Veces en primer lugar')}</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((it) => (
                <tr key={it.label}>
                  <th scope="row">{it.label}</th>
                  <td>{it.average === null ? '—' : num(it.average)}</td>
                  <td>{it.first}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.answered > 0 && s.kind === 'files' && (
        <>
          <ul className="fm-items" aria-label={t('Archivos recibidos')}>
            {s.files.slice(0, 200).map((f, i) => (
              <FileLine key={i} file={f.file} who={`${t('Respuesta')} ${numberOf(f.response - 1)}`} />
            ))}
            {s.files.length > 200 && <li className="fm-muted">… {s.files.length - 200} {t('más')}</li>}
          </ul>
          {s.files.length > 1 && (
            <button type="button" className="fm-btn fm-btn--sec" onClick={() => void saveUploads(s.files.map((f) => ({ ...f, response: numberOf(f.response - 1) })), q.title || t('Archivos'), t('Carpeta donde guardar los archivos')).catch((e) => window.alert((e as Error).message))}>
              {t('Guardar todos los archivos')}
            </button>
          )}
        </>
      )}
      {s.answered > 0 && s.kind === 'likert' && (
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
        </div>
      )}
    </section>
  );
}

/** Finding and ordering the responses that are looked at. */
function FilterBar({ ctl, shown, withSort }: { ctl: FormsCtl; shown: number; withSort: boolean }) {
  const { form, responses, filter, sort } = ctl;
  const questions = form.questions.filter(filterable);
  const q = questions.find((x) => x.id === filter.question);
  const nums = numbers(form);
  const named = responses.some((r) => r.name);
  const timed = responses.some((r) => r.seconds !== undefined);
  const orders: [string, string][] = [
    ['', t('Orden de llegada')],
    ['date|desc', t('Fecha: las más recientes primero')],
    ['date|asc', t('Fecha: las más antiguas primero')],
    ...(named ? ([['name|asc', t('Nombre: de la A a la Z')], ['name|desc', t('Nombre: de la Z a la A')]] as [string, string][]) : []),
    ...(form.quiz ? ([['score|desc', t('Puntuación: de mayor a menor')], ['score|asc', t('Puntuación: de menor a mayor')]] as [string, string][]) : []),
    ...(timed ? ([['time|asc', t('Duración: las más rápidas primero')], ['time|desc', t('Duración: las más lentas primero')]] as [string, string][]) : []),
  ];
  const current = sort ? `${sort.key}|${sort.descending ? 'desc' : 'asc'}` : '';
  // a column of the table can order by a question
  if (current && !orders.some(([v]) => v === current)) orders.push([current, t('Por una columna de la tabla')]);
  return (
    <div className="fm-card fm-filters nv-work" role="search" aria-label={t('Buscar y filtrar')}>
      <div className="fm-row">
        <input className="fm-input fm-search" type="search" aria-label={t('Buscar en las respuestas')} placeholder={t('Buscar en las respuestas')} value={filter.text ?? ''} onChange={(e) => ctl.setFilter({ text: e.target.value })} />
        {withSort && (
          <label className="fm-field fm-inline">
            <span>{t('Ordenar')}</span>
            <select
              className="fm-input"
              aria-label={t('Ordenar las respuestas')}
              value={current}
              onChange={(e) => {
                const [key, way] = e.target.value.split('|');
                ctl.setSort(key ? { key: key as SortKey, descending: way === 'desc' } : null);
              }}
            >
              {orders.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="fm-row">
        {questions.length > 0 && (
          <label className="fm-field fm-inline">
            <span>{t('Respondieron')}</span>
            <select className="fm-input" aria-label={t('Filtrar por pregunta')} value={q?.id ?? ''} onChange={(e) => ctl.setFilter({ question: e.target.value || undefined, value: undefined })}>
              <option value="">{t('Cualquier cosa')}</option>
              {questions.map((x) => (
                <option key={x.id} value={x.id}>
                  {nums.get(x.id)}. {x.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {q && (
          <select className="fm-input" aria-label={t('Con la respuesta')} value={filter.value ?? ''} onChange={(e) => ctl.setFilter({ value: e.target.value || undefined })}>
            <option value="">{t('Elige una respuesta')}</option>
            {filterValues(q, responses).map((v) => (
              <option key={v} value={v}>
                {v === OTHER_ANSWER ? t('Otras respuestas') : v}
              </option>
            ))}
          </select>
        )}
        {(['from', 'to'] as const).map((key) => (
          <label key={key} className="fm-field fm-inline">
            <span>{key === 'from' ? t('Desde') : t('Hasta')}</span>
            <input className="fm-input" type="date" aria-label={key === 'from' ? t('Desde el día') : t('Hasta el día')} value={filter[key] ?? ''} onChange={(e) => ctl.setFilter({ [key]: e.target.value || undefined })} />
          </label>
        ))}
        {isFiltering(filter) && (
          <button type="button" className="fm-add" onClick={() => ctl.clearFilter()}>
            {t('Quitar el filtro')}
          </button>
        )}
      </div>
      {isFiltering(filter) && (
        <p className="fm-muted" role="status">
          {t('Se muestran {n} de {total} respuestas.', { n: shown, total: responses.length })}
        </p>
      )}
    </div>
  );
}

/** Printing the summary and keeping it as a page to share. */
function ShareBar({ form, shown, total }: { form: Form; shown: Response[]; total: number }) {
  const [texts, setTexts] = useState(false);
  const page = () => {
    const language = form.language ?? 'es';
    const charts: Record<string, string> = {};
    for (const s of summarize(form, shown).questions) {
      if (!s.question.chart) continue;
      const svg = questionSvg(s, s.question.chart, PRINT_COLORS, language, language === 'en' ? 'Other answers' : 'Otras respuestas');
      if (svg) charts[s.question.id] = svg;
    }
    return summaryHtml(form, shown, { texts, charts, ...(shown.length !== total ? { of: total } : {}) });
  };
  return (
    <div className="fm-card fm-share nv-work" role="group" aria-label={t('Compartir el resumen')}>
      <div className="fm-row">
        <button type="button" className="fm-btn fm-btn--sec" onClick={() => printPage(page())}>
          {t('Imprimir el resumen')}
        </button>
        <button type="button" className="fm-btn fm-btn--sec" onClick={() => void saveBytes(`${safeFileName(`${form.title} - ${t('resumen')}`)}.html`, new TextEncoder().encode(page()), [{ name: 'Página web', extensions: ['html'] }]).catch((e) => window.alert(String(e)))}>
          {t('Guardar como página…')}
        </button>
        <label className="fm-check">
          <input type="checkbox" checked={texts} onChange={(e) => setTexts(e.target.checked)} /> {t('Incluir las respuestas escritas')}
        </label>
      </div>
      <p className="fm-muted">{t('El resumen no lleva nombres ni archivos. Lo que la gente escribió puede identificarla: revísalo antes de compartirlo.')}</p>
    </div>
  );
}

function ResponseTable({ ctl, list, numberOf }: { ctl: FormsCtl; list: Response[]; numberOf: Map<string, number> }) {
  const { form, sort } = ctl;
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const at = Math.min(page, pages - 1);
  const named = ctl.responses.some((r) => r.name);
  const timed = ctl.responses.some((r) => r.seconds !== undefined);
  const nums = numbers(form);
  const qs = form.questions.filter(isInput);
  const head = (key: SortKey, label: string) => {
    const on = sort?.key === key;
    return (
      <th key={key} scope="col" aria-sort={on ? (sort!.descending ? 'descending' : 'ascending') : undefined}>
        <button type="button" onClick={() => ctl.setSort({ key, descending: on ? !sort!.descending : false })}>
          {label}
          {on && <span aria-hidden="true">{sort!.descending ? ' ↓' : ' ↑'}</span>}
        </button>
      </th>
    );
  };
  const cut = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);
  return (
    <div className="fm-card nv-work">
      <div className="fm-wide">
        <table className="fm-table" aria-label={t('Tabla de respuestas')}>
          <thead>
            <tr>
              <th scope="col">{t('N.º')}</th>
              {named && head('name', t('Nombre'))}
              {head('date', t('Fecha'))}
              {timed && head('time', t('Duración'))}
              {form.quiz && head('score', t('Puntuación'))}
              {qs.map((q) => head(`q:${q.id}`, `${nums.get(q.id)}. ${q.title}`))}
            </tr>
          </thead>
          <tbody>
            {list.slice(at * PER_PAGE, (at + 1) * PER_PAGE).map((r) => {
              const n = numberOf.get(r.id)!;
              const s = form.quiz ? score(form, r.answers, r.review) : null;
              return (
                <tr key={r.id}>
                  <th scope="row">
                    <button type="button" aria-label={t('Ver la respuesta {n}', { n })} onClick={() => ctl.showResponse(r.id)}>
                      {n}
                    </button>
                  </th>
                  {named && <td>{r.name ?? ''}</td>}
                  <td>{fmtDate(r.at)}</td>
                  {timed && <td>{r.seconds === undefined ? '' : durationText(r.seconds)}</td>}
                  {s && (
                    <td>
                      {s.earned} / {s.total}
                    </td>
                  )}
                  {qs.map((q) => (
                    <td key={q.id}>{r.answers[q.id] === undefined ? '' : cut(answerText(q, r.answers[q.id]))}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="fm-pager">
          <button type="button" className="fm-btn fm-btn--sec" disabled={at === 0} aria-label={t('Filas anteriores')} onClick={() => setPage(at - 1)}>
            ←
          </button>
          <span aria-live="polite">{t('Filas {from} a {to} de {total}', { from: at * PER_PAGE + 1, to: Math.min(list.length, (at + 1) * PER_PAGE), total: list.length })}</span>
          <button type="button" className="fm-btn fm-btn--sec" disabled={at >= pages - 1} aria-label={t('Filas siguientes')} onClick={() => setPage(at + 1)}>
            →
          </button>
        </div>
      )}
    </div>
  );
}

function show(q: Question, a: Answer | undefined): string {
  if (a === null || a === undefined) return '—';
  if (Array.isArray(a)) return q.type === 'ranking' ? (a as string[]).map((x, i) => `${i + 1}. ${x}`).join('  ') : (a as string[]).join(', ');
  if (typeof a === 'object') return Object.entries(a).map(([k, v]) => `${k}: ${v}`).join('; ');
  return String(a);
}

function Individual({ ctl, form, list, numberOf }: { ctl: FormsCtl; form: Form; list: Response[]; numberOf: Map<string, number> }) {
  // the one being looked at, and where it was if it goes away
  const [last, setLast] = useState(0);
  const found = list.findIndex((r) => r.id === ctl.shownResponse);
  const idx = found >= 0 ? found : Math.min(last, Math.max(0, list.length - 1));
  const r = list[idx];
  if (!r) return <p className="fm-empty">{ctl.responses.length ? t('Ninguna respuesta pasa el filtro.') : t('Todavía no hay respuestas.')}</p>;
  const s = score(form, r.answers, r.review);
  const go = (to: number) => {
    setLast(to);
    ctl.showResponse(list[to]!.id);
  };
  const n = numberOf.get(r.id)!;
  return (
    <div>
      <div className="fm-pager">
        <button type="button" className="fm-btn fm-btn--sec" disabled={idx === 0} onClick={() => go(idx - 1)} aria-label={t('Respuesta anterior')}>
          ←
        </button>
        <span aria-live="polite">
          {t('Respuesta')} {idx + 1} / {list.length}
          {n !== idx + 1 && <span className="fm-muted"> ({t('n.º {n}', { n })})</span>}
        </span>
        <button type="button" className="fm-btn fm-btn--sec" disabled={idx >= list.length - 1} onClick={() => go(idx + 1)} aria-label={t('Respuesta siguiente')}>
          →
        </button>
        <button
          type="button"
          className="fm-btn fm-btn--sec"
          onClick={() => {
            setLast(idx);
            ctl.deleteResponse(r.id);
          }}
        >
          {t('Eliminar esta respuesta')}
        </button>
      </div>
      <section className="fm-card nv-work" aria-label={t('Respuesta individual')}>
        <p className="fm-muted">
          {r.name ? `${r.name} · ` : ''}
          {fmtDate(r.at)}
          {r.seconds !== undefined ? ` · ${t('Tardó {time}', { time: durationText(r.seconds) })}` : ''}
          {form.quiz ? ` · ${t('Puntuación')}: ${s.earned} / ${s.total}` : ''}
          {s.pending ? ` · ${t('{n} puntos por corregir', { n: s.pending })}` : ''}
        </p>
        <dl className="fm-indiv">
          {form.questions.filter(isInput).map((q) => (
            <div key={q.id}>
              <dt>{q.title || t('(sin título)')}</dt>
              <dd>
                {isFiles(r.answers[q.id]) ? (
                  <ul className="fm-items">
                    {(r.answers[q.id] as UploadedFile[]).map((f, i) => (
                      <FileLine key={i} file={f} />
                    ))}
                  </ul>
                ) : (
                  show(q, r.answers[q.id])
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

export function Results({ ctl }: { ctl: FormsCtl }) {
  const form = ctl.form;
  const rs = ctl.responses;
  const view: ResultsView = ctl.resultsView === 'grade' && !form.quiz ? 'summary' : ctl.resultsView;
  const { filter, sort } = ctl;
  const shown = useMemo(() => filterResponses(form, rs, filter), [form, rs, filter]);
  const ordered = useMemo(() => ctl.ordered(shown), [ctl, shown, sort, form]); // eslint-disable-line react-hooks/exhaustive-deps
  const numberOf = useMemo(() => new Map(rs.map((r, i) => [r.id, i + 1])), [rs]);
  const sum = useMemo(() => summarize(form, shown), [form, shown]);
  const nums = numbers(form);
  const tabs: [ResultsView, string][] = [['summary', t('Resumen')], ['table', t('Tabla')], ['individual', t('Individuales')], ...(form.quiz ? ([['grade', t('Corregir')]] as [ResultsView, string][]) : [])];
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
        {sum.time && (
          <div className="fm-total">
            {t('Tiempo medio para responder')}: <b>{durationText(sum.time.average)}</b>
            <span className="fm-muted">
              {' '}
              ({t('mediana {time}', { time: durationText(sum.time.median) })}
              {sum.time.count < sum.total ? `; ${t('{n} de {total} lo dicen', { n: sum.time.count, total: sum.total })}` : ''})
            </span>
          </div>
        )}
        {sum.quiz && (
          <div className="fm-total">
            {t('Puntuación media')}: <b>{num(sum.quiz.average)}</b>
            {sum.quiz.varies ? ` · ${t('{p} % de lo que cada persona podía sacar', { p: num(sum.quiz.percent) })}` : ` / ${sum.quiz.max}`} ({t('mejor')} {sum.quiz.best}, {t('peor')} {sum.quiz.worst})
            {sum.quiz.varies && <span className="fm-muted"> · {t('El máximo cambia según las preguntas que se vieron (hasta {n}).', { n: sum.quiz.max })}</span>}
            {sum.quiz.pending > 0 && <span className="fm-muted"> · {sum.quiz.pending === 1 ? t('1 respuesta por corregir') : t('{n} respuestas por corregir', { n: sum.quiz.pending })}</span>}
          </div>
        )}
        <div role="tablist" className="fm-tabs" aria-label={t('Vista de resultados')}>
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'is-on' : ''} onClick={() => ctl.setResultsView(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {rs.length === 0 && (
        <p className="fm-empty">
          {t('Todavía no hay respuestas. Rellena el formulario aquí, o comparte la página web exportada y luego usa "Importar respuestas" con los archivos que te devuelvan.')}
        </p>
      )}
      {rs.length > 0 && view !== 'grade' && <FilterBar ctl={ctl} shown={shown.length} withSort={view !== 'summary'} />}
      {rs.length > 0 && shown.length === 0 && view !== 'grade' && view !== 'individual' && <p className="fm-empty">{t('Ninguna respuesta pasa el filtro.')}</p>}
      {shown.length > 0 && view === 'summary' && (
        <>
          <ShareBar form={form} shown={shown} total={rs.length} />
          {sum.questions.map((s) => (
            <Card key={s.question.id} ctl={ctl} s={s} n={nums.get(s.question.id)!} numberOf={(i) => numberOf.get(shown[i]!.id)!} />
          ))}
        </>
      )}
      {shown.length > 0 && view === 'table' && <ResponseTable ctl={ctl} list={ordered} numberOf={numberOf} />}
      {view === 'individual' && <Individual ctl={ctl} form={form} list={ordered} numberOf={numberOf} />}
      {view === 'grade' && <Grading ctl={ctl} />}
    </div>
  );
}
