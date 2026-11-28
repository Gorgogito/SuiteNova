/*
 * Marking a quiz: person by person or question by question, with points and comments given by hand, and the sheets that
 * return the marks.
 */
import { t } from '@suitenova/core-ui';
import { MARK_NAMES, MAX_COMMENT, countsPoints, feedbackSheetHtml, isFiles, isInput, numbers, reviewLines, route, score, type Response, type ReviewLine, type UploadedFile } from '@suitenova/forms-core';
import { useState } from 'react';
import { saveBytes } from '../fileio';
import { safeFileName } from '../mail/attachments';
import { printPage } from '../mail/print';
import { ProofTextarea } from '../spell';
import type { FormsCtl } from './ctl';
import { DraftInput } from './DraftInput';
import { FileLine } from './FileLine';

const who = (r: Response, n: number): string => r.name || `${t('Respuesta')} ${n}`;
/** People shown at once when marking by question: each has its own boxes. */
const PER_PAGE = 25;

/** The points and the comment of one answer of one person. */
function Marks({ ctl, r, line, person }: { ctl: FormsCtl; r: Response; line: ReviewLine; person: string }) {
  const given = r.review?.points?.[line.id];
  const about = `${line.label} — ${person}`;
  return (
    <div className="fm-marks">
      {line.points !== null && (
        <div className="fm-row">
          <label className="fm-field fm-inline">
            <span>{t('Puntos (de {max})', { max: line.points })}</span>
            <DraftInput
              key={`${r.id}-${line.id}`}
              className="fm-input fm-narrow"
              inputMode="decimal"
              aria-label={t('Puntos de {about}', { about })}
              placeholder={line.earned === null ? t('sin poner') : String(line.earned)}
              value={given === undefined ? '' : String(given)}
              onCommit={(text) => {
                if (!text.trim()) {
                  ctl.setPoints(r.id, line.id, undefined);
                  return null;
                }
                const n = Number(text.trim().replace(',', '.'));
                if (!Number.isFinite(n) || n < 0 || n > line.points!) return t('Escribe un número de 0 a {max}.', { max: line.points! });
                ctl.setPoints(r.id, line.id, n);
                return null;
              }}
            />
          </label>
          <button type="button" className="fm-add" aria-label={t('Todos los puntos a {about}', { about })} onClick={() => ctl.setPoints(r.id, line.id, line.points!)}>
            {t('Todos')}
          </button>
          <button type="button" className="fm-add" aria-label={t('Cero puntos a {about}', { about })} onClick={() => ctl.setPoints(r.id, line.id, 0)}>
            {t('Cero')}
          </button>
          {given !== undefined && (
            <button type="button" className="fm-add" aria-label={t('Quitar los puntos puestos a {about}', { about })} onClick={() => ctl.setPoints(r.id, line.id, undefined)}>
              {t('Quitar')}
            </button>
          )}
        </div>
      )}
      <label className="fm-field">
        <span>{t('Comentario')}</span>
        <ProofTextarea className="fm-input" rows={1} aria-label={t('Comentario sobre {about}', { about })} maxLength={MAX_COMMENT} value={r.review?.comments?.[line.id] ?? ''} onChange={(e) => ctl.setComment(r.id, line.id, e.target.value)} />
      </label>
    </div>
  );
}

/** What was answered and how it stands. */
function Given({ r, line }: { r: Response; line: ReviewLine }) {
  const a = r.answers[line.id];
  return (
    <>
      {isFiles(a) ? (
        <ul className="fm-items">
          {(a as UploadedFile[]).map((f, i) => (
            <FileLine key={i} file={f} />
          ))}
        </ul>
      ) : (
        <p className="fm-answer">{line.answer}</p>
      )}
      <p className="fm-muted">
        {line.mark !== 'none' && <span className={`fm-mark is-${line.mark}`}>{t(MARK_NAMES[line.mark])}</span>}
        {line.points !== null && line.earned !== null && ` · ${line.earned} / ${line.points}`}
        {line.correct && ` · ${t('Respuesta correcta')}: ${line.correct}`}
      </p>
    </>
  );
}

export function Grading({ ctl }: { ctl: FormsCtl }) {
  const form = ctl.form;
  const responses = ctl.responses;
  const [by, setBy] = useState<'person' | 'question'>('person');
  const [chosen, setChosen] = useState('');
  const [question, setQuestion] = useState('');
  const [showCorrect, setShowCorrect] = useState(true);
  const [page, setPage] = useState(0);
  const index = Math.max(0, responses.findIndex((r) => r.id === chosen));
  const r = responses[index];
  if (!r) return <p className="fm-empty">{t('Todavía no hay respuestas.')}</p>;
  const nums = numbers(form);
  // the ones that give points first
  const questions = form.questions.filter(isInput).sort((a, b) => Number(countsPoints(b)) - Number(countsPoints(a)));
  const q = questions.find((x) => x.id === question) ?? questions[0];
  const sheets = (which: Response[]) => feedbackSheetHtml(form, which.map((x) => ({ response: x, number: responses.indexOf(x) + 1 })), { showCorrect });
  const save = (html: string, name: string) => void saveBytes(`${safeFileName(name)}.html`, new TextEncoder().encode(html), [{ name: 'Página web', extensions: ['html'] }]).catch((e) => window.alert(String(e)));
  const todo = responses.filter((x) => !x.review?.done).length;
  const next = responses.slice(index + 1).concat(responses.slice(0, index)).find((x) => !x.review?.done);
  // marking by question: only whoever was shown it
  const rows = by === 'question' && q ? responses.flatMap((x, i) => (route(form, x.answers).shown.has(q.id) ? [{ x, n: i + 1 }] : [])) : [];
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const at = Math.min(page, pages - 1);

  return (
    <div className="fm-grading">
      <div className="fm-card nv-work">
        <div className="fm-row">
          <div className="fm-devices" role="group" aria-label={t('Corregir')}>
            {(['person', 'question'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={by === v} onClick={() => setBy(v)}>
                {v === 'person' ? t('Por persona') : t('Por pregunta')}
              </button>
            ))}
          </div>
          <span className="fm-muted" role="status">
            {todo === 0 ? t('Todas revisadas.') : t('Sin revisar: {n} de {total}.', { n: todo, total: responses.length })}
          </span>
        </div>
        <div className="fm-row">
          <label className="fm-check">
            <input type="checkbox" checked={showCorrect} onChange={(e) => setShowCorrect(e.target.checked)} /> {t('Incluir las respuestas correctas en las hojas')}
          </label>
          <button type="button" className="fm-btn fm-btn--sec" onClick={() => printPage(sheets(responses))}>
            {t('Imprimir todas las hojas')}
          </button>
          <button type="button" className="fm-btn fm-btn--sec" onClick={() => save(sheets(responses), `${form.title} - ${t('devoluciones')}`)}>
            {t('Guardar todas las hojas…')}
          </button>
        </div>
      </div>

      {by === 'person' ? (
        <>
          <div className="fm-pager">
            <button type="button" className="fm-btn fm-btn--sec" disabled={index === 0} aria-label={t('Persona anterior')} onClick={() => setChosen(responses[index - 1]!.id)}>
              ←
            </button>
            <select className="fm-input" aria-label={t('Respuesta que se corrige')} value={r.id} onChange={(e) => setChosen(e.target.value)}>
              {responses.map((x, i) => {
                const s = score(form, x.answers, x.review);
                return (
                  <option key={x.id} value={x.id}>
                    {`${i + 1}. ${who(x, i + 1)} — ${s.earned} / ${s.total}${s.pending ? ` · ${t('por corregir')}` : ''}${x.review?.done ? ' ✓' : ''}`}
                  </option>
                );
              })}
            </select>
            <button type="button" className="fm-btn fm-btn--sec" disabled={index >= responses.length - 1} aria-label={t('Persona siguiente')} onClick={() => setChosen(responses[index + 1]!.id)}>
              →
            </button>
            <button type="button" className="fm-btn fm-btn--sec" disabled={!next} onClick={() => setChosen(next!.id)}>
              {t('Siguiente sin revisar')}
            </button>
          </div>
          {(() => {
            const s = score(form, r.answers, r.review);
            const person = who(r, index + 1);
            return (
              <>
                <p className="fm-total" role="status">
                  {t('Puntuación')}: <b>{s.earned}</b> / {s.total}
                  {s.pending ? ` · ${t('{n} puntos por corregir', { n: s.pending })}` : ''}
                </p>
                {reviewLines(form, r.answers, r.review).map((line) => (
                  <section key={`${r.id}-${line.id}`} className="fm-card nv-work" aria-label={t('Corrección de {question}', { question: line.label })}>
                    <div className="fm-qtitle">{line.label}</div>
                    <Given r={r} line={line} />
                    <Marks ctl={ctl} r={r} line={line} person={person} />
                  </section>
                ))}
                <section className="fm-card nv-work" aria-label={t('Cierre de la corrección')}>
                  <label className="fm-field">
                    <span>{t('Comentario general')}</span>
                    <ProofTextarea className="fm-input" rows={2} aria-label={t('Comentario general')} maxLength={MAX_COMMENT * 2} value={r.review?.comment ?? ''} onChange={(e) => ctl.setGeneralComment(r.id, e.target.value)} />
                  </label>
                  <div className="fm-row">
                    <label className="fm-check">
                      <input type="checkbox" checked={!!r.review?.done} onChange={(e) => ctl.setReviewed(r.id, e.target.checked)} /> {t('Revisada')}
                    </label>
                    <button type="button" className="fm-btn fm-btn--sec" onClick={() => printPage(sheets([r]))}>
                      {t('Imprimir su hoja')}
                    </button>
                    <button type="button" className="fm-btn fm-btn--sec" onClick={() => save(sheets([r]), `${form.title} - ${person}`)}>
                      {t('Guardar su hoja…')}
                    </button>
                  </div>
                </section>
              </>
            );
          })()}
        </>
      ) : (
        q && (
          <>
            <label className="fm-field">
              <span>{t('Pregunta que se corrige')}</span>
              <select className="fm-input" aria-label={t('Pregunta que se corrige')} value={q.id} onChange={(e) => (setQuestion(e.target.value), setPage(0))}>
                {questions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {`${nums.get(x.id)}. ${x.title || t('(sin título)')}${countsPoints(x) ? '' : ` (${t('no puntúa')})`}`}
                  </option>
                ))}
              </select>
            </label>
            {pages > 1 && (
              <div className="fm-pager">
                <button type="button" className="fm-btn fm-btn--sec" disabled={at === 0} aria-label={t('Personas anteriores')} onClick={() => setPage(at - 1)}>
                  ←
                </button>
                <span aria-live="polite">{t('Personas {from} a {to} de {total}', { from: at * PER_PAGE + 1, to: Math.min(rows.length, (at + 1) * PER_PAGE), total: rows.length })}</span>
                <button type="button" className="fm-btn fm-btn--sec" disabled={at >= pages - 1} aria-label={t('Personas siguientes')} onClick={() => setPage(at + 1)}>
                  →
                </button>
              </div>
            )}
            {rows.slice(at * PER_PAGE, (at + 1) * PER_PAGE).map(({ x, n }) => {
              const line = reviewLines(form, x.answers, x.review).find((l) => l.id === q.id)!;
              return (
                <section key={`${x.id}-${q.id}`} className="fm-card nv-work" aria-label={who(x, n)}>
                  <div className="fm-qtitle">{who(x, n)}</div>
                  <Given r={x} line={line} />
                  <Marks ctl={ctl} r={x} line={line} person={who(x, n)} />
                </section>
              );
            })}
          </>
        )
      )}
    </div>
  );
}
