import { t } from '@suitenova/core-ui';
import { QTYPES, gradable, hasOptions, isInput, type Question } from '@suitenova/forms-core';
import type { FormsCtl } from './ctl';
import { FORM_HEAD } from './ctl';

const typeName = (q: Question) => QTYPES.find((x) => x.id === q.type)?.name ?? q.type;

function ListEditor({ label, items, onChange, min = 1 }: { label: string; items: string[]; onChange: (v: string[]) => void; min?: number }) {
  const set = (i: number, v: string) => onChange(items.map((x, k) => (k === i ? v : x)));
  return (
    <div className="fm-list" role="group" aria-label={label}>
      <div className="fm-sub">{label}</div>
      {items.map((it, i) => (
        <div key={i} className="fm-listrow">
          <input className="fm-input" aria-label={`${label} ${i + 1}`} value={it} onChange={(e) => set(i, e.target.value)} />
          <button type="button" aria-label={`${t('Subir')} ${label} ${i + 1}`} disabled={i === 0} onClick={() => onChange(items.map((x, k) => (k === i - 1 ? items[i]! : k === i ? items[i - 1]! : x)))}>
            ↑
          </button>
          <button type="button" aria-label={`${t('Bajar')} ${label} ${i + 1}`} disabled={i === items.length - 1} onClick={() => onChange(items.map((x, k) => (k === i + 1 ? items[i]! : k === i ? items[i + 1]! : x)))}>
            ↓
          </button>
          <button type="button" aria-label={`${t('Quitar')} ${label} ${i + 1}`} disabled={items.length <= min} onClick={() => onChange(items.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="fm-add" onClick={() => onChange([...items, `${label.replace(/s$/, '')} ${items.length + 1}`])}>
        + {t('Añadir')}
      </button>
    </div>
  );
}

function Editor({ ctl, q }: { ctl: FormsCtl; q: Question }) {
  const up = (patch: Partial<Question>) => ctl.updateQuestion(q.id, patch);
  const i = ctl.form.questions.indexOf(q);
  const earlier = ctl.form.questions.slice(0, i).filter(isInput);
  const src = earlier.find((x) => x.id === q.showIf?.question);
  const numOrNull = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const quiz = ctl.form.quiz && gradable(q);
  return (
    <div className="fm-editor">
      <label className="fm-field">
        <span>{q.type === 'title' ? t('Título') : t('Pregunta')}</span>
        <input className="fm-input" value={q.title} autoFocus onChange={(e) => up({ title: e.target.value })} />
      </label>
      <label className="fm-field">
        <span>{t('Descripción (opcional)')}</span>
        <textarea className="fm-input" rows={2} value={q.description} onChange={(e) => up({ description: e.target.value })} />
      </label>

      {(q.type === 'choice' || q.type === 'multi' || q.type === 'dropdown') && <ListEditor label={t('Opciones')} items={q.options} onChange={(v) => up({ options: v })} />}
      {q.type === 'likert' && (
        <>
          <ListEditor label={t('Filas')} items={q.rows} onChange={(v) => up({ rows: v })} />
          <ListEditor label={t('Columnas')} items={q.options} min={2} onChange={(v) => up({ options: v })} />
        </>
      )}
      {(q.type === 'choice' || q.type === 'multi') && (
        <label className="fm-check">
          <input type="checkbox" checked={q.allowOther} onChange={(e) => up({ allowOther: e.target.checked })} /> {t('Permitir la respuesta "Otro"')}
        </label>
      )}
      {q.type === 'rating' && (
        <label className="fm-field fm-inline">
          <span>{t('Niveles')}</span>
          <select className="fm-input" value={q.max} onChange={(e) => up({ max: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {(q.type === 'text' || q.type === 'longtext') && (
        <div className="fm-row">
          <label className="fm-field fm-inline">
            <span>{t('Formato')}</span>
            <select className="fm-input" value={q.format} onChange={(e) => up({ format: e.target.value as Question['format'] })}>
              <option value="none">{t('Cualquier texto')}</option>
              <option value="email">{t('Correo electrónico')}</option>
              <option value="url">{t('Dirección web')}</option>
            </select>
          </label>
          <label className="fm-field fm-inline">
            <span>{t('Mínimo de caracteres')}</span>
            <input className="fm-input fm-narrow" type="number" min={0} value={q.min ?? ''} onChange={(e) => up({ min: numOrNull(e.target.value) })} />
          </label>
          <label className="fm-field fm-inline">
            <span>{t('Máximo de caracteres')}</span>
            <input className="fm-input fm-narrow" type="number" min={1} value={q.maxValue ?? ''} onChange={(e) => up({ maxValue: numOrNull(e.target.value) })} />
          </label>
        </div>
      )}
      {q.type === 'number' && (
        <div className="fm-row">
          <label className="fm-field fm-inline">
            <span>{t('Valor mínimo')}</span>
            <input className="fm-input fm-narrow" type="number" value={q.min ?? ''} onChange={(e) => up({ min: numOrNull(e.target.value) })} />
          </label>
          <label className="fm-field fm-inline">
            <span>{t('Valor máximo')}</span>
            <input className="fm-input fm-narrow" type="number" value={q.maxValue ?? ''} onChange={(e) => up({ maxValue: numOrNull(e.target.value) })} />
          </label>
          <label className="fm-check">
            <input type="checkbox" checked={q.integer} onChange={(e) => up({ integer: e.target.checked })} /> {t('Solo enteros')}
          </label>
        </div>
      )}

      {isInput(q) && (
        <label className="fm-check">
          <input type="checkbox" checked={q.required} onChange={(e) => up({ required: e.target.checked })} /> {t('Obligatoria')}
        </label>
      )}

      {quiz && (
        <fieldset className="fm-fieldset">
          <legend>{t('Respuesta correcta')}</legend>
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
          {(q.type === 'text' || q.type === 'number') && (
            <label className="fm-field">
              <span>{q.type === 'text' ? t('Respuestas aceptadas (separadas por punto y coma)') : t('Valores aceptados (separados por punto y coma)')}</span>
              <input className="fm-input" value={q.correct.join('; ')} onChange={(e) => up({ correct: e.target.value.split(';').map((x) => x.trim()).filter(Boolean) })} />
            </label>
          )}
          <label className="fm-field fm-inline">
            <span>{t('Puntos')}</span>
            <input className="fm-input fm-narrow" type="number" min={0} value={q.points} onChange={(e) => up({ points: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </fieldset>
      )}

      {isInput(q) && i > 0 && (
        <fieldset className="fm-fieldset">
          <legend>{t('Mostrar solo si…')}</legend>
          {earlier.length === 0 ? (
            <p className="fm-muted">{t('Antes de esta pregunta no hay ninguna otra a la que referirse.')}</p>
          ) : (
            <div className="fm-row">
              <select className="fm-input" aria-label={t('Pregunta de la condición')} value={q.showIf?.question ?? ''} onChange={(e) => up({ showIf: e.target.value ? { question: e.target.value, op: q.showIf?.op ?? 'eq', value: q.showIf?.value ?? '' } : null })}>
                <option value="">{t('Siempre')}</option>
                {earlier.map((x) => (
                  <option key={x.id} value={x.id}>
                    {ctl.form.questions.indexOf(x) + 1}. {x.title || t('(sin título)')}
                  </option>
                ))}
              </select>
              {q.showIf && (
                <>
                  <select className="fm-input fm-narrow" aria-label={t('Operador de la condición')} value={q.showIf.op} onChange={(e) => up({ showIf: { ...q.showIf!, op: e.target.value as 'eq' | 'neq' | 'contains' } })}>
                    <option value="eq">{t('es')}</option>
                    <option value="neq">{t('no es')}</option>
                    <option value="contains">{t('contiene')}</option>
                  </select>
                  {src && src.options.length > 0 && src.type !== 'likert' ? (
                    <select className="fm-input" aria-label={t('Valor de la condición')} value={q.showIf.value} onChange={(e) => up({ showIf: { ...q.showIf!, value: e.target.value } })}>
                      <option value="">{t('Elige un valor')}</option>
                      {src.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="fm-input" aria-label={t('Valor de la condición')} value={q.showIf.value} onChange={(e) => up({ showIf: { ...q.showIf!, value: e.target.value } })} />
                  )}
                </>
              )}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}

export function Designer({ ctl }: { ctl: FormsCtl }) {
  const f = ctl.form;
  const head = ctl.selected === FORM_HEAD;
  return (
    <div className="fm-design" aria-label={t('Preguntas del formulario')}>
      <section className={`fm-card fm-head${head ? ' is-sel' : ''}`} style={{ borderTopColor: f.color }} onClick={() => ctl.select(FORM_HEAD)} aria-label={t('Título y descripción del formulario')}>
        {head ? (
          <div className="fm-editor">
            <label className="fm-field">
              <span>{t('Título del formulario')}</span>
              <input className="fm-input fm-big" value={f.title} onChange={(e) => ctl.setForm({ title: e.target.value })} />
            </label>
            <label className="fm-field">
              <span>{t('Descripción del formulario')}</span>
              <textarea className="fm-input" rows={2} value={f.description} onChange={(e) => ctl.setForm({ description: e.target.value })} />
            </label>
            <label className="fm-field">
              <span>{t('Mensaje de agradecimiento')}</span>
              <input className="fm-input" value={f.thanks} onChange={(e) => ctl.setForm({ thanks: e.target.value })} />
            </label>
          </div>
        ) : (
          <>
            <h1>{f.title || t('Formulario sin título')}</h1>
            {f.description && <p className="fm-desc">{f.description}</p>}
          </>
        )}
      </section>
      {f.questions.length === 0 && <p className="fm-empty">{t('Todavía no hay preguntas. Usa "Añadir pregunta" en la cinta o el botón de abajo.')}</p>}
      {f.questions.map((q, i) => {
        const sel = ctl.selected === q.id;
        return (
          <section key={q.id} className={`fm-card${sel ? ' is-sel' : ''}`} data-q={q.id} onClick={() => !sel && ctl.select(q.id)} aria-label={`${t('Pregunta')} ${i + 1}`}>
            {sel ? (
              <Editor ctl={ctl} q={q} />
            ) : (
              <button type="button" className="fm-summary" onClick={() => ctl.select(q.id)}>
                <span className="fm-qtitle">
                  {i + 1}. {q.title || t('(sin título)')}
                  {q.required && <span className="fm-req"> *</span>}
                </span>
                <span className="fm-type">{t(typeName(q))}{q.showIf ? ` · ${t('condicional')}` : ''}{hasOptions(q) && q.type !== 'likert' ? ` · ${q.options.length} ${t('opciones')}` : ''}</span>
              </button>
            )}
            {sel && <div className="fm-type">{t(typeName(q))}</div>}
          </section>
        );
      })}
      <div className="fm-addrow">
        <label>
          <span className="fm-sr">{t('Tipo de pregunta nueva')}</span>
          <select className="fm-input" id="fm-newtype" aria-label={t('Tipo de pregunta nueva')} defaultValue="choice">
            {QTYPES.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.name)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="fm-btn" onClick={() => ctl.addQuestion((document.getElementById('fm-newtype') as HTMLSelectElement).value as Question['type'])}>
          {t('Añadir pregunta')}
        </button>
      </div>
    </div>
  );
}
