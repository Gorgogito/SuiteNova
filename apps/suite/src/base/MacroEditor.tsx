import { basic } from '@suitenova/base-core';

type MacroDef = basic.MacroDef;
import { t } from '@suitenova/core-ui';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { BaseCtl, Tab } from './ctl';

type Step = basic.MacroStep;
type ArgSpec = basic.ArgSpec;

/** The editor of a macro: a list of steps, each an action with its arguments and an optional condition. */
export function MacroEditor({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const def = ctl.macros.get(tab.id) ?? { steps: [] };
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState<basic.MacroActionId>('MessageBox');

  const names = {
    form: db.objects('form'),
    report: db.objects('report'),
    table: db.tableNames(),
    query: db.objects('query'),
    macro: db.objects('macro'),
    proc: ctl.procedureNames(),
  };
  const warnings = useMemo(
    () => basic.validateMacro(def, { forms: names.form, reports: names.report, tables: names.table, queries: names.query, macros: names.macro, procs: ctl.procedureNames() }, tab.name),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def, ctl.getVersion()],
  );

  const save = (steps: Step[]) => ctl.saveMacro(tab.id, { ...def, steps } satisfies MacroDef);
  const patchStep = (i: number, p: Partial<Step>) => save(def.steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const setArg = (i: number, name: string, v: string) => patchStep(i, { args: { ...def.steps[i]!.args, [name]: v } });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= def.steps.length) return;
    const c = [...def.steps];
    [c[i], c[j]] = [c[j]!, c[i]!];
    save(c);
  };

  const run = async () => {
    const r = await ctl.runHandler({ kind: 'macro', name: tab.name });
    setResult(r.error ? { ok: false, text: r.error } : { ok: true, text: t('La macro terminó correctamente.') });
  };

  const widget = (s: Step, i: number, a: ArgSpec) => {
    const v = s.args[a.name] ?? '';
    const label = `${a.label} ${i + 1}`;
    const list = a.kind === 'form' || a.kind === 'report' || a.kind === 'table' || a.kind === 'query' || a.kind === 'macro' || a.kind === 'proc' ? names[a.kind] : null;
    if (list) {
      return (
        <select aria-label={label} value={v} onChange={(e) => setArg(i, a.name, e.target.value)}>
          <option value="" />
          {a.kind === 'proc' && v && !list.includes(v.replace(/\(.*$/, '').trim()) && <option value={v}>{v}</option>}
          {a.kind !== 'proc' && v && !list.includes(v) && <option value={v}>{`${v} ${t('(no existe)')}`}</option>}
          {list.map((n) => (
            <option key={n} value={a.kind === 'proc' ? n : n}>
              {n}
            </option>
          ))}
        </select>
      );
    }
    if (a.kind === 'choice') {
      return (
        <select aria-label={label} value={v} onChange={(e) => setArg(i, a.name, e.target.value)}>
          <option value="">{a.optional ? t('(predeterminado)') : ''}</option>
          {a.choices!.map((c) => (
            <option key={c.value} value={c.value}>
              {t(c.label)}
            </option>
          ))}
        </select>
      );
    }
    return <input aria-label={label} value={v} onChange={(e) => setArg(i, a.name, e.target.value)} />;
  };

  return (
    <div className="bs-macro">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Macro')}>
        <button type="button" className="bs-btn bs-btn--primary" onClick={() => void run()}>
          {t('Ejecutar macro')}
        </button>
        <span className="bs-sep" aria-hidden="true" />
        <label>
          {t('Acción')}
          <select aria-label={t('Acción nueva')} value={adding} onChange={(e) => setAdding(e.target.value as basic.MacroActionId)}>
            {basic.MACRO_ACTIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {t(a.label)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="bs-btn" onClick={() => save([...def.steps, basic.newStep(adding)])}>
          {t('Agregar paso')}
        </button>
      </div>
      {!ctl.contentEnabled && <p className="bs-hint">{t('El contenido activo está deshabilitado en este archivo: habilítelo para ejecutar macros.')}</p>}
      {result && (
        <div className={result.ok ? 'bs-ok' : 'bs-error'} role={result.ok ? 'status' : 'alert'}>
          {result.text}
        </div>
      )}
      <ol className="bs-steps" aria-label={t('Pasos de la macro')}>
        {def.steps.length === 0 && <li className="bs-empty">{t('La macro no tiene pasos. Elija una acción y pulse "Agregar paso".')}</li>}
        {def.steps.map((s, i) => {
          const spec = basic.actionSpec(s.action);
          return (
            <li key={i} className={`bs-step${s.disabled ? ' is-off' : ''}`}>
              <div className="bs-steprow">
                <strong>{i + 1}.</strong>
                <select
                  aria-label={t('Acción del paso {n}', { n: i + 1 })}
                  value={s.action}
                  onChange={(e) => patchStep(i, { action: e.target.value as basic.MacroActionId, args: {} })}
                >
                  {basic.MACRO_ACTIONS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {t(a.label)}
                    </option>
                  ))}
                </select>
                {spec?.writes && <span title={t('Cambia datos')}>✎</span>}
                <label className="bs-row">
                  <input type="checkbox" aria-label={t('Paso {n} activo', { n: i + 1 })} checked={!s.disabled} onChange={(e) => patchStep(i, { disabled: !e.target.checked })} /> {t('Activo')}
                </label>
                <span className="bs-grow" />
                <button type="button" className="bs-btn" aria-label={t('Subir el paso {n}', { n: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="bs-btn" aria-label={t('Bajar el paso {n}', { n: i + 1 })} disabled={i === def.steps.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="bs-btn" aria-label={t('Duplicar el paso {n}', { n: i + 1 })} onClick={() => save([...def.steps.slice(0, i + 1), { ...s, args: { ...s.args } }, ...def.steps.slice(i + 1)])}>
                  ⧉
                </button>
                <button type="button" className="bs-btn" aria-label={t('Quitar el paso {n}', { n: i + 1 })} onClick={() => save(def.steps.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
              <div className="bs-stepargs">
                <label>
                  {t('Condición')}
                  <input aria-label={t('Condición del paso {n}', { n: i + 1 })} value={s.condition ?? ''} placeholder="[Saldo] > 0 And [Activo]" onChange={(e) => patchStep(i, { condition: e.target.value })} />
                </label>
                {spec?.args.map((a) => (
                  <label key={a.name}>
                    {t(a.label)}
                    {widget(s, i, a)}
                    {a.hint && <span className="bs-hint">{t(a.hint)}</span>}
                  </label>
                ))}
                <label>
                  {t('Comentario')}
                  <input aria-label={t('Comentario del paso {n}', { n: i + 1 })} value={s.comment ?? ''} onChange={(e) => patchStep(i, { comment: e.target.value })} />
                </label>
              </div>
            </li>
          );
        })}
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
