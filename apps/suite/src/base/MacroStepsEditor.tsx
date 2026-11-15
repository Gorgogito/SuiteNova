import { basic } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useMemo, useState } from 'react';
import type { BaseCtl } from './ctl';

type MacroDef = basic.MacroDef;
type Step = basic.MacroStep;
type ArgSpec = basic.ArgSpec;
type ActionId = basic.MacroActionId;

const GROUPS: { id: NonNullable<basic.ActionSpec['group']>; label: string }[] = [
  { id: 'control', label: 'Control de flujo' },
  { id: 'forms', label: 'Formularios' },
  { id: 'objects', label: 'Objetos' },
  { id: 'data', label: 'Datos' },
  { id: 'variables', label: 'Variables' },
];

interface Names {
  form: string[];
  report: string[];
  table: string[];
  query: string[];
  macro: string[];
  proc: string[];
}

function ActionOptions() {
  return (
    <>
      {GROUPS.map((g) => (
        <optgroup key={g.id} label={t(g.label)}>
          {basic.MACRO_ACTIONS.filter((a) => (a.group ?? 'control') === g.id).map((a) => (
            <option key={a.id} value={a.id}>
              {t(a.label)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/** A box with an action to choose and a button that adds it to a list of steps. */
function AddStep({ label, button, onAdd }: { label: string; button: string; onAdd: (a: ActionId) => void }) {
  const [adding, setAdding] = useState<ActionId>('MessageBox');
  return (
    <span className="bs-addstep">
      <select aria-label={label} value={adding} onChange={(e) => setAdding(e.target.value as ActionId)}>
        <ActionOptions />
      </select>
      <button type="button" className="bs-btn" aria-label={button} onClick={() => onAdd(adding)}>
        {t('Agregar')}
      </button>
    </span>
  );
}

/** The editor of the steps of a macro: nested blocks (If, Group, Submacro, record loops), the same for saved, embedded and data macros. */
export function MacroStepsEditor({ ctl, def, onChange, selfName, data }: { ctl: BaseCtl; def: MacroDef; onChange: (def: MacroDef) => void; selfName?: string; data?: boolean }) {
  const db = ctl.db!;
  const names: Names = { form: db.objects('form'), report: db.objects('report'), table: db.tableNames(), query: db.objects('query'), macro: db.objects('macro'), proc: ctl.procedureNames() };
  const subs = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const m of db.objects('macro')) {
      const d = db.getObject<MacroDef>('macro', m);
      out[m.toLowerCase()] = (d?.steps ?? []).filter((s) => s.action === 'Submacro').map((s) => (s.args.name ?? '').trim().toLowerCase());
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl.getVersion()]);
  const warnings = useMemo(
    () => basic.validateMacro(def, { forms: names.form, reports: names.report, tables: names.table, queries: names.query, macros: names.macro, procs: names.proc, subs }, selfName, { data }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def, ctl.getVersion()],
  );
  const setSteps = (steps: Step[]) => onChange({ ...def, steps });
  return (
    <div className="bs-macrosteps">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Pasos')}>
        <label>
          {t('Acción')}
          <RootAdd onAdd={(a) => setSteps([...def.steps, basic.newStep(a)])} />
        </label>
      </div>
      <ol className="bs-steps" aria-label={t('Pasos de la macro')}>
        {def.steps.length === 0 && <li className="bs-empty">{t('La macro no tiene pasos. Elija una acción y pulse "Agregar paso".')}</li>}
        <StepList steps={def.steps} onSteps={setSteps} path="" names={names} />
      </ol>
      {warnings.length > 0 && (
        <div className="bs-warn" role="status" aria-label={t('Avisos de la macro')}>
          <strong>{t('Avisos')}</strong>
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RootAdd({ onAdd }: { onAdd: (a: ActionId) => void }) {
  const [adding, setAdding] = useState<ActionId>('MessageBox');
  return (
    <>
      <select aria-label={t('Acción nueva')} value={adding} onChange={(e) => setAdding(e.target.value as ActionId)}>
        <ActionOptions />
      </select>
      <button type="button" className="bs-btn" onClick={() => onAdd(adding)}>
        {t('Agregar paso')}
      </button>
    </>
  );
}

function StepList({ steps, onSteps, path, names }: { steps: Step[]; onSteps: (s: Step[]) => void; path: string; names: Names }) {
  const patchStep = (i: number, p: Partial<Step>) => onSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const c = [...steps];
    [c[i], c[j]] = [c[j]!, c[i]!];
    onSteps(c);
  };
  return (
    <>
      {steps.map((s, i) => {
        const n = `${path}${i + 1}`;
        const spec = basic.actionSpec(s.action);
        const setArg = (name: string, v: string) => patchStep(i, { args: { ...s.args, [name]: v } });
        const widget = (a: ArgSpec) => {
          const v = s.args[a.name] ?? '';
          const label = `${a.label} ${n}`;
          const list = a.kind === 'form' || a.kind === 'report' || a.kind === 'table' || a.kind === 'query' || a.kind === 'proc' ? names[a.kind] : null;
          if (list) {
            return (
              <select aria-label={label} value={v} onChange={(e) => setArg(a.name, e.target.value)}>
                <option value="" />
                {a.kind === 'proc' && v && !list.includes(v.replace(/\(.*$/, '').trim()) && <option value={v}>{v}</option>}
                {a.kind !== 'proc' && v && !list.includes(v) && <option value={v}>{`${v} ${t('(no existe)')}`}</option>}
                {list.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            );
          }
          if (a.kind === 'macro') {
            // a macro, or Macro.Submacro, or .Submacro: written, with the macros as suggestions
            const id = `dl-${n}-${a.name}`;
            return (
              <>
                <input aria-label={label} list={id} value={v} onChange={(e) => setArg(a.name, e.target.value)} />
                <datalist id={id}>
                  {names.macro.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
              </>
            );
          }
          if (a.kind === 'choice') {
            return (
              <select aria-label={label} value={v} onChange={(e) => setArg(a.name, e.target.value)}>
                <option value="">{a.optional ? t('(predeterminado)') : ''}</option>
                {a.choices!.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(c.label)}
                  </option>
                ))}
              </select>
            );
          }
          return <input aria-label={label} value={v} onChange={(e) => setArg(a.name, e.target.value)} />;
        };
        const inner = (list: Step[] | undefined, set: (s: Step[]) => void, sub: string, addLabel: string) => (
          <div className="bs-stepchildren">
            <ol className="bs-steps" aria-label={`${t('Pasos dentro del paso')} ${n}${sub}`}>
              <StepList steps={list ?? []} onSteps={set} path={`${n}${sub ? `${sub}.` : '.'}`} names={names} />
            </ol>
            <AddStep label={`${t('Nueva acción dentro del paso')} ${n}${sub}`} button={addLabel} onAdd={(a) => set([...(list ?? []), basic.newStep(a)])} />
          </div>
        );
        return (
          <li key={i} className={`bs-step${s.disabled ? ' is-off' : ''}${spec?.block ? ' is-block' : ''}`}>
            <div className="bs-steprow">
              <strong>{n}.</strong>
              <select aria-label={t('Acción del paso {n}', { n })} value={s.action} onChange={(e) => patchStep(i, { ...basic.newStep(e.target.value as ActionId), condition: s.condition, comment: s.comment, disabled: s.disabled })}>
                <ActionOptions />
              </select>
              {spec?.writes && <span title={t('Cambia datos')}>✎</span>}
              <label className="bs-chk">
                <input type="checkbox" aria-label={t('Paso {n} activo', { n })} checked={!s.disabled} onChange={(e) => patchStep(i, { disabled: !e.target.checked })} /> {t('Activo')}
              </label>
              <span className="bs-grow" />
              <button type="button" className="bs-btn" aria-label={t('Subir el paso {n}', { n })} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="bs-btn" aria-label={t('Bajar el paso {n}', { n })} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="bs-btn" aria-label={t('Duplicar el paso {n}', { n })} onClick={() => onSteps([...steps.slice(0, i + 1), JSON.parse(JSON.stringify(s)) as Step, ...steps.slice(i + 1)])}>
                ⧉
              </button>
              <button type="button" className="bs-btn" aria-label={t('Quitar el paso {n}', { n })} onClick={() => onSteps(steps.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
            <div className="bs-stepargs">
              <label>
                {s.action === 'If' ? t('Si (condición)') : t('Condición')}
                <input aria-label={t('Condición del paso {n}', { n })} value={s.condition ?? ''} placeholder="[Saldo] > 0 And [Activo]" onChange={(e) => patchStep(i, { condition: e.target.value })} />
              </label>
              {spec?.args.map((a) => (
                <label key={a.name}>
                  {t(a.label)}
                  {widget(a)}
                  {a.hint && <span className="bs-hint">{t(a.hint)}</span>}
                </label>
              ))}
              <label>
                {t('Comentario')}
                <input aria-label={t('Comentario del paso {n}', { n })} value={s.comment ?? ''} onChange={(e) => patchStep(i, { comment: e.target.value })} />
              </label>
            </div>
            {spec?.block && inner(s.children, (c) => patchStep(i, { children: c }), '', t('Agregar dentro del paso {n}', { n }))}
            {s.action === 'If' && (
              <>
                {(s.elseIfs ?? []).map((b, k) => (
                  <div key={k} className="bs-elseif" role="group" aria-label={t('Si no, si {k} del paso {n}', { k: k + 1, n })}>
                    <label>
                      {t('Si no, si (condición)')}
                      <input aria-label={t('Condición del Si no, si {k} del paso {n}', { k: k + 1, n })} value={b.condition} placeholder="[Saldo] < 0" onChange={(e) => patchStep(i, { elseIfs: (s.elseIfs ?? []).map((x, j) => (j === k ? { ...x, condition: e.target.value } : x)) })} />
                    </label>
                    <button type="button" className="bs-btn" aria-label={t('Quitar el Si no, si {k} del paso {n}', { k: k + 1, n })} onClick={() => patchStep(i, { elseIfs: (s.elseIfs ?? []).filter((_, j) => j !== k) })}>
                      ×
                    </button>
                    {inner(b.steps, (st) => patchStep(i, { elseIfs: (s.elseIfs ?? []).map((x, j) => (j === k ? { ...x, steps: st } : x)) }), `.${k + 1}e`, t('Agregar dentro del Si no, si {k} del paso {n}', { k: k + 1, n }))}
                  </div>
                ))}
                <button type="button" className="bs-btn" aria-label={t('Agregar Si no, si al paso {n}', { n })} onClick={() => patchStep(i, { elseIfs: [...(s.elseIfs ?? []), { condition: '', steps: [] }] })}>
                  {t('Agregar Si no, si')}
                </button>
              </>
            )}
            {(s.action === 'If' || s.action === 'LookupRecord') &&
              (s.elseSteps ? (
                <div className="bs-else" role="group" aria-label={t('Si no del paso {n}', { n })}>
                  <strong>{t('Si no')}</strong>
                  <button type="button" className="bs-btn" aria-label={t('Quitar el Si no del paso {n}', { n })} onClick={() => patchStep(i, { elseSteps: undefined })}>
                    ×
                  </button>
                  {inner(s.elseSteps, (st) => patchStep(i, { elseSteps: st }), 'e', t('Agregar dentro del Si no del paso {n}', { n }))}
                </div>
              ) : (
                <button type="button" className="bs-btn" aria-label={t('Agregar Si no al paso {n}', { n })} onClick={() => patchStep(i, { elseSteps: [] })}>
                  {t('Agregar Si no')}
                </button>
              ))}
          </li>
        );
      })}
    </>
  );
}
