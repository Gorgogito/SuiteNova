import { t } from '@suitenova/core-ui';
import { FILE_KINDS, IMAGE_SIZES, MAX_FILES, MAX_IMAGE_BYTES, NUMBER_RULES, QTYPES, RATING_SYMBOLS, SIZE_CHOICES, gradable, hasOptions, isInput, isSafeImage, nextName, numbers, type ImageSize, type ItemList, type NumberRule, type Question, type RatingSymbol } from '@suitenova/forms-core';
import { useState } from 'react';
import { DraftInput } from './DraftInput';
import { Equation, EquationField } from './Equation';
import { Branching, Conditions, LockField, SectionNext, sectionNumbers } from './Flow';
import { QImage } from './Runner';
import type { FormsCtl } from './ctl';
import { FORM_HEAD } from './ctl';
import { ProofTextarea } from '../spell';

const typeName = (q: Question) => QTYPES.find((x) => x.id === q.type)?.name ?? q.type;

/** The choices, rows or columns of a question: each keeps its answers when its text changes or it moves. */
function ListEditor({ ctl, q, list, label, one, min = 1 }: { ctl: FormsCtl; q: Question; list: ItemList; label: string; one: string; min?: number }) {
  const items = q[list];
  const move = (i: number, by: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    ctl.updateQuestion(q.id, { [list]: next });
  };
  return (
    <div className="fm-list" role="group" aria-label={label}>
      <div className="fm-sub">{label}</div>
      {items.map((it, i) => (
        <div key={i} className="fm-listrow">
          <DraftInput
            className="fm-input"
            aria-label={`${label} ${i + 1}`}
            value={it}
            onCommit={(text) => {
              const refused = ctl.renameItem(q.id, list, i, text);
              return refused && t(refused);
            }}
          />
          <button type="button" aria-label={`${t('Subir')} ${label} ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" aria-label={`${t('Bajar')} ${label} ${i + 1}`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          <button type="button" aria-label={`${t('Quitar')} ${label} ${i + 1}`} disabled={items.length <= min} onClick={() => ctl.removeItem(q.id, list, i)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="fm-add" onClick={() => ctl.updateQuestion(q.id, { [list]: [...items, nextName(items, one)] })}>
        + {t('Añadir')}
      </button>
    </div>
  );
}

/** Pick, size, describe and remove the picture of a question. */
function PictureField({ q, up }: { q: Question; up: (patch: Partial<Question>, typing?: boolean) => void }) {
  const [err, setErr] = useState('');
  const m = q.image;
  return (
    <>
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label={t('Elegir imagen')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > MAX_IMAGE_BYTES) return setErr(t('La imagen pesa más de 1,5 MB; use una más pequeña.'));
          const rd = new FileReader();
          rd.onload = () => {
            const src = String(rd.result);
            if (!isSafeImage(src)) return setErr(t('Solo se admiten imágenes PNG, JPEG, GIF o WebP.'));
            setErr('');
            up({ image: { src, alt: m?.alt || f.name.replace(/\.[^.]+$/, ''), size: m?.size ?? 'medium' } });
          };
          rd.readAsDataURL(f);
        }}
      />
      {err && (
        <p className="fm-err" role="alert">
          {err}
        </p>
      )}
      {m && (
        <>
          <QImage q={q} />
          <label className="fm-field fm-inline">
            <span>{t('Tamaño')}</span>
            <select className="fm-input" aria-label={t('Tamaño de la imagen')} value={m.size} onChange={(e) => up({ image: { ...m, size: e.target.value as ImageSize } })}>
              {IMAGE_SIZES.map((z) => (
                <option key={z.id} value={z.id}>
                  {t(z.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="fm-field">
            <span>{t('Texto alternativo')}</span>
            <input className="fm-input" aria-label={t('Texto alternativo de la imagen')} value={m.alt} onChange={(e) => up({ image: { ...m, alt: e.target.value } }, true)} />
          </label>
          <button type="button" className="fm-btn" onClick={() => up({ image: undefined })}>
            {t('Quitar la imagen')}
          </button>
        </>
      )}
    </>
  );
}

function Editor({ ctl, q }: { ctl: FormsCtl; q: Question }) {
  const up = (patch: Partial<Question>, typing?: boolean) => ctl.updateQuestion(q.id, patch, typing);
  const rule = q.rule ?? 'range';
  /** A box for one of the two limits of a number or of the checkboxes. */
  const limit = (key: 'min' | 'maxValue', label: string, least?: number) => (
    <label className="fm-field fm-inline">
      <span>{label}</span>
      <input className="fm-input fm-narrow" type="number" min={least} aria-label={label} value={q[key] ?? ''} onChange={(e) => up({ [key]: numOrNull(e.target.value) }, true)} />
    </label>
  );
  const numOrNull = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const quiz = ctl.form.quiz && gradable(q);
  return (
    <div className="fm-editor">
      <label className="fm-field">
        <span>{q.type === 'title' ? t('Título') : q.type === 'section' ? t('Título de la sección') : t('Pregunta')}</span>
        <input className="fm-input" value={q.title} autoFocus onChange={(e) => up({ title: e.target.value }, true)} />
      </label>
      <label className="fm-field">
        <span>{t('Descripción (opcional)')}</span>
        <ProofTextarea className="fm-input" rows={2} value={q.description} onChange={(e) => up({ description: e.target.value }, true)} />
      </label>

      <EquationField tex={q.equation} onChange={(equation) => up({ equation })} />

      <div className="fm-field" role="group" aria-label={t('Imagen de la pregunta')}>
        <span>{t('Imagen (opcional)')}</span>
        <PictureField q={q} up={up} />
      </div>

      {(q.type === 'choice' || q.type === 'multi' || q.type === 'dropdown') && <ListEditor ctl={ctl} q={q} list="options" label={t('Opciones')} one={t('Opción')} />}
      {q.type === 'likert' && (
        <>
          <ListEditor ctl={ctl} q={q} list="rows" label={t('Filas')} one={t('Fila')} />
          <ListEditor ctl={ctl} q={q} list="options" label={t('Columnas')} one={t('Columna')} min={2} />
        </>
      )}
      {q.type === 'ranking' && <ListEditor ctl={ctl} q={q} list="options" label={t('Elementos')} one={t('Elemento')} min={2} />}
      {(q.type === 'choice' || q.type === 'multi') && (
        <label className="fm-check">
          <input type="checkbox" checked={q.allowOther} onChange={(e) => up({ allowOther: e.target.checked })} /> {t('Permitir la respuesta "Otro"')}
        </label>
      )}
      {(q.type === 'choice' || q.type === 'multi' || q.type === 'dropdown' || q.type === 'ranking') && (
        <label className="fm-check">
          <input type="checkbox" checked={!!q.shuffle} onChange={(e) => up({ shuffle: e.target.checked || undefined })} /> {q.type === 'ranking' ? t('Empezar con los elementos desordenados') : t('Barajar las opciones')}
        </label>
      )}
      {q.type === 'multi' && (
        <div className="fm-row">
          {limit('min', t('Mínimo de opciones'), 1)}
          {limit('maxValue', t('Máximo de opciones'), 1)}
        </div>
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
      {q.type === 'rating' && (
        <label className="fm-field fm-inline">
          <span>{t('Símbolo')}</span>
          <select className="fm-input" aria-label={t('Símbolo')} value={q.symbol ?? 'number'} onChange={(e) => up({ symbol: e.target.value as RatingSymbol })}>
            {RATING_SYMBOLS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.on ? `${s.on} ` : ''}
                {t(s.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      {(q.type === 'rating' || q.type === 'nps') && (
        <div className="fm-row">
          {(['lowLabel', 'highLabel'] as const).map((key) => {
            const label = key === 'lowLabel' ? t('Etiqueta del extremo bajo') : t('Etiqueta del extremo alto');
            return (
              <label key={key} className="fm-field">
                <span>{label}</span>
                <input className="fm-input" aria-label={label} maxLength={100} value={q[key] ?? ''} placeholder={q.type === 'nps' ? (key === 'lowLabel' ? t('Nada probable') : t('Muy probable')) : ''} onChange={(e) => up({ [key]: e.target.value || undefined }, true)} />
              </label>
            );
          })}
        </div>
      )}
      {q.type === 'file' && (
        <>
          <div className="fm-row">
            <label className="fm-field fm-inline">
              <span>{t('Número de archivos')}</span>
              <select className="fm-input fm-narrow" aria-label={t('Número de archivos')} value={q.maxFiles ?? 1} onChange={(e) => up({ maxFiles: Number(e.target.value) })}>
                {Array.from({ length: MAX_FILES }, (_, k) => (
                  <option key={k + 1} value={k + 1}>
                    {k + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="fm-field fm-inline">
              <span>{t('Tamaño máximo de cada uno')}</span>
              <select className="fm-input fm-narrow" aria-label={t('Tamaño máximo de cada uno')} value={q.maxMb ?? 10} onChange={(e) => up({ maxMb: Number(e.target.value) })}>
                {SIZE_CHOICES.map((mb) => (
                  <option key={mb} value={mb}>
                    {mb} MB
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="fm-fieldset">
            <legend>{t('Tipos admitidos (sin marcar ninguno: cualquiera menos programas)')}</legend>
            <div className="fm-row">
              {FILE_KINDS.map((k) => (
                <label key={k.id} className="fm-check">
                  <input type="checkbox" checked={!!q.kinds?.includes(k.id)} onChange={(e) => up({ kinds: e.target.checked ? [...(q.kinds ?? []), k.id] : (q.kinds ?? []).filter((x) => x !== k.id) })} /> {t(k.name)}
                </label>
              ))}
            </div>
          </fieldset>
        </>
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
            <input className="fm-input fm-narrow" type="number" min={0} value={q.min ?? ''} onChange={(e) => up({ min: numOrNull(e.target.value) }, true)} />
          </label>
          <label className="fm-field fm-inline">
            <span>{t('Máximo de caracteres')}</span>
            <input className="fm-input fm-narrow" type="number" min={1} value={q.maxValue ?? ''} onChange={(e) => up({ maxValue: numOrNull(e.target.value) }, true)} />
          </label>
        </div>
      )}
      {q.type === 'number' && (
        <div className="fm-row">
          <label className="fm-field fm-inline">
            <span>{t('Restricción')}</span>
            <select className="fm-input" aria-label={t('Restricción')} value={rule} onChange={(e) => up({ rule: e.target.value === 'range' ? undefined : (e.target.value as NumberRule) })}>
              {NUMBER_RULES.map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.name)}
                </option>
              ))}
            </select>
          </label>
          {rule === 'range' && limit('min', t('Valor mínimo'))}
          {rule === 'range' && limit('maxValue', t('Valor máximo'))}
          {rule === 'gt' && limit('min', t('Mayor que'))}
          {rule === 'lt' && limit('maxValue', t('Menor que'))}
          {rule === 'ne' && limit('min', t('Distinto de'))}
          {rule === 'outside' && limit('min', t('Fuera de: desde'))}
          {rule === 'outside' && limit('maxValue', t('hasta'))}
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
              <DraftInput
                className="fm-input"
                aria-label={q.type === 'text' ? t('Respuestas aceptadas (separadas por punto y coma)') : t('Valores aceptados (separados por punto y coma)')}
                value={q.correct.join('; ')}
                onCommit={(text) => {
                  up({ correct: text.split(';').map((x) => x.trim()).filter(Boolean) });
                  return null;
                }}
              />
            </label>
          )}
          <label className="fm-field fm-inline">
            <span>{t('Puntos')}</span>
            <input className="fm-input fm-narrow" type="number" min={0} value={q.points} onChange={(e) => up({ points: Math.max(0, Number(e.target.value) || 0) }, true)} />
          </label>
        </fieldset>
      )}

      <Branching form={ctl.form} q={q} up={up} />
      {q.type === 'section' ? <SectionNext form={ctl.form} q={q} up={up} /> : <Conditions form={ctl.form} q={q} up={up} />}
      <LockField form={ctl.form} q={q} up={up} />
    </div>
  );
}

export function Designer({ ctl }: { ctl: FormsCtl }) {
  const f = ctl.form;
  const head = ctl.selected === FORM_HEAD;
  const nums = numbers(f);
  const sections = sectionNumbers(f);
  let texts = 0;
  return (
    // leaving a box ends what was being typed in it: the next letters are another change
    <div className="fm-design" aria-label={t('Preguntas del formulario')} onBlur={() => ctl.endTyping()}>
      <section className={`nv-work fm-card fm-head${head ? ' is-sel' : ''}`} style={{ borderTopColor: f.color }} onClick={() => ctl.select(FORM_HEAD)} aria-label={t('Título y descripción del formulario')}>
        {head ? (
          <div className="fm-editor">
            <label className="fm-field">
              <span>{t('Título del formulario')}</span>
              <input className="fm-input fm-big" value={f.title} onChange={(e) => ctl.setForm({ title: e.target.value }, true)} />
            </label>
            <label className="fm-field">
              <span>{t('Descripción del formulario')}</span>
              <ProofTextarea className="fm-input" rows={2} value={f.description} onChange={(e) => ctl.setForm({ description: e.target.value }, true)} />
            </label>
            <label className="fm-field">
              <span>{t('Mensaje de agradecimiento')}</span>
              <input className="fm-input" value={f.thanks} onChange={(e) => ctl.setForm({ thanks: e.target.value }, true)} />
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
      {f.questions.map((q) => {
        const sel = ctl.selected === q.id;
        const n = nums.get(q.id);
        const section = sections.get(q.id);
        const name = n ? `${t('Pregunta')} ${n}` : section ? `${t('Sección')} ${section}` : `${t('Título o texto')} ${++texts}`;
        return (
          <section key={q.id} className={`nv-work fm-card${sel ? ' is-sel' : ''}${section ? ' fm-section' : ''}`} data-q={q.id} onClick={() => !sel && ctl.select(q.id)} aria-label={name}>
            {section && (
              <div className="fm-sectionname">
                {t('Sección {n} de {m}', { n: section, m: sections.size })}
              </div>
            )}
            {sel ? (
              <Editor ctl={ctl} q={q} />
            ) : (
              <button type="button" className="fm-summary" onClick={() => ctl.select(q.id)}>
                <span className="fm-qtitle">
                  {n ? `${n}. ` : ''}
                  {q.title || t('(sin título)')}
                  {q.required && <span className="fm-req"> *</span>}
                </span>
                <Equation tex={q.equation} />
                {q.image && <QImage q={q} />}
                <span className="fm-type">{t(typeName(q))}{q.showIf ? ` · ${t('condicional')}` : ''}{q.branch || q.next ? ` · ${t('ramifica')}` : ''}{hasOptions(q) && q.type !== 'likert' ? ` · ${q.options.length} ${q.type === 'ranking' ? t('elementos') : t('opciones')}` : ''}</span>
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
