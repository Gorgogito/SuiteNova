import { isActionDesign, sqlParams, type QueryParam, type QueryResult } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { ResultSheet } from './Datasheet';
import { QueryDesigner } from './QueryDesigner';
import type { BaseCtl, Tab } from './ctl';

interface Compiled {
  sql: string;
  params: QueryParam[];
  error: string | null;
}

export function QueryView({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  const version = useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const q = ctl.queries.get(tab.id)!;
  const [result, setResult] = useState<QueryResult | null>(ctl.results.get(tab.id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(tab.name);
  const [msg, setMsg] = useState<string | null>(null);
  const values = q.values ?? {};

  const compiled: Compiled = useMemo(() => {
    if (q.mode === 'sql') return { sql: q.sql, params: sqlParams(q.sql), error: null };
    if (!q.design.tables.length && q.design.kind !== 'union') return { sql: '', params: [], error: null };
    try {
      const c = db.designSql(q.design, { resolveQuery: (n) => ctl.sqlOfQuery(n) }, values);
      return { sql: c.sql, params: c.params, error: null };
    } catch (e) {
      return { sql: '', params: [], error: (e as Error).message };
    }
    // the data can change what a crosstab shows, hence the version
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.design, q.sql, q.mode, version, JSON.stringify(values)]);
  const sql = compiled.sql;
  const action = q.mode === 'design' && isActionDesign(q.design);

  const run = () => {
    setError(null);
    setMsg(null);
    try {
      if (compiled.error) throw new Error(compiled.error);
      if (!sql.trim()) throw new Error(t('Escriba una consulta o elija una tabla.'));
      if (action && !window.confirm(t('Esta consulta modifica datos. ¿Ejecutarla? Podrá deshacerlo con Deshacer (Ctrl+Z).'))) return;
      const r = db.execute(sql, 100_000, values);
      ctl.results.set(tab.id, r);
      setResult(r);
      ctl.touch();
    } catch (e) {
      setResult(null);
      ctl.results.delete(tab.id);
      setError((e as Error).message);
    }
  };

  const update = (patch: Partial<typeof q>) => {
    Object.assign(q, patch, { saved: false });
    ctl.touch();
  };
  const setValue = (key: string, v: string) => {
    q.values = { ...values, [key]: v };
    ctl.touch();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F5') {
      e.preventDefault();
      run();
    }
  };

  return (
    <div className="bs-query" onKeyDown={onKey}>
      <div className="bs-toolbar" role="toolbar" aria-label={t('Consulta')}>
        <div role="group" className="bs-seg" aria-label={t('Vista de la consulta')}>
          <button type="button" aria-pressed={q.mode === 'design'} onClick={() => update({ mode: 'design' })}>
            {t('Diseño')}
          </button>
          <button
            type="button"
            aria-pressed={q.mode === 'sql'}
            onClick={() => {
              if (q.mode === 'design') update({ mode: 'sql', sql: sql || q.sql });
            }}
          >
            SQL
          </button>
        </div>
        <button type="button" className="bs-btn bs-btn--primary" onClick={run}>
          {t('Ejecutar')} (Ctrl+Intro)
        </button>
        <label>
          {t('Nombre')}
          <input aria-label={t('Nombre de la consulta')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          type="button"
          className="bs-btn"
          onClick={() => {
            try {
              if (q.mode === 'design' && q.design.kind !== 'union' && !q.design.tables.length) throw new Error(t('Elija al menos una tabla.'));
              ctl.saveQuery(tab.id, name);
              setMsg(t('Consulta guardada.'));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {t('Guardar consulta')}
        </button>
      </div>
      {q.mode === 'sql' ? (
        <textarea className="bs-sql" aria-label="SQL" spellCheck={false} value={q.sql} placeholder={'SELECT * FROM "Tabla" WHERE …  (parámetros: :nombre)'} onChange={(e) => update({ sql: e.target.value })} />
      ) : (
        <>
          <QueryDesigner ctl={ctl} q={q} update={update} />
          {compiled.error && <p className="bs-hint">{compiled.error}</p>}
          {sql && (
            <pre className="bs-sqlprev" aria-label={t('SQL generado')}>
              {sql}
            </pre>
          )}
        </>
      )}
      {compiled.params.length > 0 && (
        <fieldset className="bs-params">
          <legend>{t('Parámetros')}</legend>
          {compiled.params.map((p) => (
            <label key={p.key}>
              {p.label}
              <input aria-label={t('Valor de {p}', { p: p.label })} value={values[p.key] ?? ''} onChange={(e) => setValue(p.key, e.target.value)} />
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <div className="bs-error" role="alert">
          {error}
        </div>
      )}
      {msg && (
        <div className="bs-ok" role="status">
          {msg}
        </div>
      )}
      <div className="bs-result">
        {result && result.columns.length > 0 && (
          <>
            <div className="bs-count" aria-live="polite">
              {t('{n} registros', { n: result.rows.length })}
              {result.truncated ? ` (${t('limitado')})` : ''} · {result.elapsedMs.toFixed(0)} ms
            </div>
            <ResultSheet result={result} />
          </>
        )}
        {result && result.columns.length === 0 && (
          <div className="bs-ok" role="status">
            {t('Listo. {n} filas afectadas.', { n: result.changes })} {ctl.db!.canUndo ? t('Puede deshacerlo con Deshacer (Ctrl+Z).') : ''}
          </div>
        )}
      </div>
    </div>
  );
}
