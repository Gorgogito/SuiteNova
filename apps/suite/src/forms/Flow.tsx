/* The parts of the designer about the way through the form: when a question shows, where things lead and what is shuffled. */
import { t } from '@suitenova/core-ui';
import { END, MAX_CONDITIONS, canDecide, canShuffle, conditionsOf, numbers, pagesOf, showIfOf, staysPut, type Condition, type Form, type Question } from '@suitenova/forms-core';

type Up = (patch: Partial<Question>, typing?: boolean) => void;

/** The number each section has, by its id. */
export const sectionNumbers = (form: Pick<Form, 'questions'>): Map<string, number> => new Map(form.questions.filter((q) => q.type === 'section').map((q, i) => [q.id, i + 1]));

/** Where something on the page of `q` can lead: the sections that come later, or the end. */
function targetsAfter(form: Form, q: Question): { value: string; label: string }[] {
  const pages = pagesOf(form);
  const at = pages.findIndex((p) => p.section === q || p.items.includes(q));
  const nums = sectionNumbers(form);
  return [
    ...pages.slice(at + 1).map((p) => ({ value: p.section!.id, label: `${t('Ir a la sección')} ${nums.get(p.section!.id)}${p.section!.title ? `: ${p.section!.title}` : ''}` })),
    { value: END, label: t('Terminar el formulario') },
  ];
}

function TargetSelect({ form, q, label, value, onChange }: { form: Form; q: Question; label: string; value: string | undefined; onChange: (target: string | undefined) => void }) {
  return (
    <select className="fm-input" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{t('Continuar con la siguiente')}</option>
      {targetsAfter(form, q).map((x) => (
        <option key={x.value} value={x.value}>
          {x.label}
        </option>
      ))}
    </select>
  );
}

/** Where a section leads when it is finished. */
export function SectionNext({ form, q, up }: { form: Form; q: Question; up: Up }) {
  return (
    <label className="fm-field">
      <span>{t('Al terminar esta sección')}</span>
      <TargetSelect form={form} q={q} label={t('Al terminar esta sección')} value={q.next} onChange={(next) => up({ next })} />
    </label>
  );
}

/** Where each option of a single choice leads, when the form has pages. */
export function Branching({ form, q, up }: { form: Form; q: Question; up: Up }) {
  if ((q.type !== 'choice' && q.type !== 'dropdown') || canShuffle(form)) return null;
  const set = (option: string, target: string | undefined) => {
    const next = Object.fromEntries(Object.entries(q.branch ?? {}).filter(([o]) => o !== option));
    if (target) next[option] = target;
    up({ branch: Object.keys(next).length ? next : undefined });
  };
  return (
    <fieldset className="fm-fieldset">
      <legend>{t('Ramificación: adónde lleva cada opción')}</legend>
      {q.options.map((o) => (
        <label key={o} className="fm-branch">
          <span>{o}</span>
          <TargetSelect form={form} q={q} label={t('Adónde lleva «{option}»', { option: o })} value={q.branch && Object.hasOwn(q.branch, o) ? q.branch[o] : undefined} onChange={(target) => set(o, target)} />
        </label>
      ))}
    </fieldset>
  );
}

/** The conditions for a question to be shown. */
export function Conditions({ form, q, up }: { form: Form; q: Question; up: Up }) {
  const i = form.questions.indexOf(q);
  if (i <= 0) return null;
  const earlier = form.questions.slice(0, i).filter(canDecide);
  const nums = numbers(form);
  const list = conditionsOf(q);
  const anyOf = !!q.showIf?.anyOf;
  const save = (next: Condition[], any = anyOf, typing = false) => up({ showIf: showIfOf(next, any) }, typing);
  const set = (k: number, patch: Partial<Condition>, typing = false) =>
    save(
      list.map((c, j) => (j === k ? { ...c, ...patch } : c)),
      anyOf,
      typing,
    );
  // the names of the boxes of the second condition on say which one they are
  const named = (text: string, k: number) => (k ? `${text} ${k + 1}` : text);
  const rows: (Condition | undefined)[] = list.length ? list : [undefined];
  return (
    <fieldset className="fm-fieldset">
      <legend>{t('Mostrar solo si…')}</legend>
      {earlier.length === 0 ? (
        <p className="fm-muted">{t('Antes de esta pregunta no hay ninguna otra a la que referirse.')}</p>
      ) : (
        <>
          {list.length > 1 && (
            <select className="fm-input" aria-label={t('Cuántas condiciones se deben cumplir')} value={anyOf ? 'any' : 'all'} onChange={(e) => save(list, e.target.value === 'any')}>
              <option value="all">{t('Se cumplen todas estas condiciones')}</option>
              <option value="any">{t('Se cumple alguna de estas condiciones')}</option>
            </select>
          )}
          {rows.map((c, k) => {
            const src = earlier.find((x) => x.id === c?.question);
            return (
              <div key={k} className="fm-cond">
                <select
                  className="fm-input"
                  aria-label={named(t('Pregunta de la condición'), k)}
                  value={c?.question ?? ''}
                  onChange={(e) => {
                    if (!e.target.value) save([]);
                    else if (c) set(k, { question: e.target.value, value: '' });
                    else save([{ question: e.target.value, op: 'eq', value: '' }]);
                  }}
                >
                  {list.length <= 1 && <option value="">{t('Siempre')}</option>}
                  {earlier.map((x) => (
                    <option key={x.id} value={x.id}>
                      {nums.get(x.id)}. {x.title || t('(sin título)')}
                    </option>
                  ))}
                </select>
                {c && (
                  <>
                    <select className="fm-input fm-narrow" aria-label={named(t('Operador de la condición'), k)} value={c.op} onChange={(e) => set(k, { op: e.target.value as Condition['op'] })}>
                      <option value="eq">{t('es')}</option>
                      <option value="neq">{t('no es')}</option>
                      <option value="contains">{t('contiene')}</option>
                    </select>
                    {src && src.options.length > 0 && src.type !== 'likert' ? (
                      <select className="fm-input" aria-label={named(t('Valor de la condición'), k)} value={c.value} onChange={(e) => set(k, { value: e.target.value })}>
                        <option value="">{t('Elige un valor')}</option>
                        {src.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input className="fm-input" aria-label={named(t('Valor de la condición'), k)} value={c.value} onChange={(e) => set(k, { value: e.target.value }, true)} />
                    )}
                    {list.length > 1 && (
                      <button type="button" className="fm-add" aria-label={t('Quitar la condición {n}', { n: k + 1 })} onClick={() => save(list.filter((_, j) => j !== k))}>
                        ✕
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {list.length > 0 && list.length < MAX_CONDITIONS && (
            <button type="button" className="fm-add" onClick={() => save([...list, { question: list[list.length - 1]!.question, op: 'eq', value: '' }])}>
              + {t('Añadir condición')}
            </button>
          )}
        </>
      )}
    </fieldset>
  );
}

/** With shuffled questions: whether this one keeps its place. */
export function LockField({ form, q, up }: { form: Form; q: Question; up: Up }) {
  if (!form.shuffle || !canShuffle(form) || q.type === 'title') return null;
  // what a condition ties together cannot move
  const tied = !q.locked && staysPut(form, q);
  return (
    <label className="fm-check">
      <input type="checkbox" checked={!!q.locked || tied} disabled={tied} onChange={(e) => up({ locked: e.target.checked || undefined })} /> {t('No cambiar de sitio al barajar')}
      {tied && <span className="fm-muted">{t('(depende de una condición, o decide otra pregunta)')}</span>}
    </label>
  );
}
