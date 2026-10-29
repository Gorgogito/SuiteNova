import { defaultFormLayout, escapeHtml, layoutFromLegacy, newReport, renderReport, renderReportLayout, type ReportDef, type ReportLayout } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TableDatasheet } from './Datasheet';
import { FormDesigner } from './FormDesigner';
import { FormRun } from './FormRun';
import { ReportDesigner } from './ReportDesigner';
import type { BaseCtl, Tab } from './ctl';

// ------------------------------------------------------------------------------------------------ form
/** A form: with a free layout it opens in form view and can be designed; older forms (fields in a column) can be converted. */
export function FormView({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const def = ctl.forms.get(tab.id)!;
  const [design, setDesign] = useState(false);
  if (def.layout) {
    const withLayout = def as typeof def & { layout: NonNullable<typeof def.layout> };
    return design ? <FormDesigner ctl={ctl} tab={tab} def={withLayout} onClose={() => setDesign(false)} /> : <FormRun ctl={ctl} tab={tab} def={withLayout} onDesign={() => setDesign(true)} />;
  }
  const convert = () => {
    const db = ctl.db!;
    if (!db.tableNames().includes(def.table)) return;
    const cols = db.columns(def.table).filter((c) => !def.fields || def.fields.includes(c.name));
    ctl.saveForm(tab.id, { ...def, layout: defaultFormLayout(cols, db) });
    setDesign(true);
  };
  return <AutoForm ctl={ctl} tab={tab} onDesign={convert} />;
}

/** The first kind of form: the chosen fields one under the other. */
function AutoForm({ ctl, tab, onDesign }: { ctl: BaseCtl; tab: Tab; onDesign: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const def = ctl.forms.get(tab.id)!;
  const exists = db.tableNames().includes(def.table);
  const cols = exists ? db.columns(def.table) : [];
  const shown = cols.filter((c) => !def.fields || def.fields.includes(c.name));
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const count = exists ? db.count(def.table) : 0;
  const i = Math.min(idx, Math.max(0, count - 1));
  const rec = exists && count ? db.browse(def.table, { offset: i, limit: 1 }) : null;
  const row = rec?.rows[0] ?? null;
  const rid = row ? Number(row[0]) : null;

  const commit = (col: string, text: string) => {
    if (rid === null) return;
    try {
      db.updateCell(def.table, rid, col, text);
      setErr(null);
      ctl.touch();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="bs-form">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Formulario')}>
        <button type="button" className="bs-btn" onClick={onDesign}>
          {t('Vista Diseño')}
        </button>
        <label>
          {t('Tabla')}
          <select aria-label={t('Tabla del formulario')} value={def.table} onChange={(e) => { ctl.saveForm(tab.id, { table: e.target.value, fields: null }); setIdx(0); }}>
            {db.tableNames().map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <details className="bs-fieldpick">
          <summary>{t('Campos')}</summary>
          <div>
            {cols.map((c) => (
              <label key={c.name}>
                <input
                  type="checkbox"
                  checked={!def.fields || def.fields.includes(c.name)}
                  onChange={(e) => {
                    const cur = def.fields ?? cols.map((x) => x.name);
                    const next = e.target.checked ? cols.map((x) => x.name).filter((n) => n === c.name || cur.includes(n)) : cur.filter((n) => n !== c.name);
                    ctl.saveForm(tab.id, { ...def, fields: next.length === cols.length ? null : next });
                  }}
                />{' '}
                {c.name}
              </label>
            ))}
          </div>
        </details>
      </div>
      {!exists ? (
        <div className="bs-empty">{t('La tabla ya no existe.')}</div>
      ) : (
        <>
          <div className="bs-nav" role="toolbar" aria-label={t('Navegación de registros')}>
            <button type="button" className="bs-btn" disabled={i <= 0} onClick={() => setIdx(0)} aria-label={t('Primer registro')}>
              ⏮
            </button>
            <button type="button" className="bs-btn" disabled={i <= 0} onClick={() => setIdx(i - 1)} aria-label={t('Registro anterior')}>
              ◀
            </button>
            <span aria-live="polite">{count ? t('Registro {n} de {total}', { n: i + 1, total: count }) : t('Sin registros')}</span>
            <button type="button" className="bs-btn" disabled={i >= count - 1} onClick={() => setIdx(i + 1)} aria-label={t('Registro siguiente')}>
              ▶
            </button>
            <button type="button" className="bs-btn" disabled={i >= count - 1} onClick={() => setIdx(count - 1)} aria-label={t('Último registro')}>
              ⏭
            </button>
            <button
              type="button"
              className="bs-btn"
              onClick={() => {
                try {
                  db.insertRow(def.table);
                  ctl.touch();
                  setIdx(db.count(def.table) - 1);
                  setErr(null);
                } catch (e) {
                  setErr((e as Error).message);
                }
              }}
            >
              {t('Nuevo registro')}
            </button>
            <button
              type="button"
              className="bs-btn"
              disabled={rid === null}
              onClick={() => {
                if (rid !== null && window.confirm(t('¿Eliminar este registro? Podrá deshacerlo con Ctrl+Z.'))) {
                  db.deleteRows(def.table, [rid]);
                  ctl.touch();
                  setIdx(Math.max(0, i - 1));
                }
              }}
            >
              {t('Eliminar registro')}
            </button>
          </div>
          {err && (
            <div className="bs-error" role="alert">
              {err}
            </div>
          )}
          {row ? (
            <div className="bs-record" key={`${def.table}:${rid}`}>
              {shown.map((c) => {
                const v = row[cols.findIndex((x) => x.name === c.name) + 1];
                const id = `f-${c.name}`;
                const type = c.type.toUpperCase();
                return (
                  <div key={c.name} className="bs-fld">
                    <label htmlFor={id}>{c.name}</label>
                    {type === 'BOOLEAN' ? (
                      <input id={id} type="checkbox" checked={!!Number(v)} onChange={(e) => commit(c.name, e.target.checked ? '1' : '0')} />
                    ) : type === 'DATE' ? (
                      <input id={id} type="date" defaultValue={v === null ? '' : String(v)} onBlur={(e) => e.target.value !== String(v ?? '') && commit(c.name, e.target.value)} />
                    ) : (
                      <input
                        id={id}
                        type={type === 'INTEGER' || type === 'REAL' ? 'text' : 'text'}
                        inputMode={type === 'INTEGER' ? 'numeric' : type === 'REAL' ? 'decimal' : undefined}
                        defaultValue={v === null || v === undefined ? '' : String(v)}
                        onBlur={(e) => e.target.value !== String(v ?? '') && commit(c.name, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bs-empty">{t('Esta tabla no tiene registros.')}</div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ report
export function reportHtml(ctl: BaseCtl, def: ReportDef): string {
  if (def.layout) {
    const { data, truncated } = ctl.reportDataset(def);
    return renderReportLayout(def.layout, data, { title: def.title, fetchSub: (c, parent) => ctl.subreportRows(c, parent) }).replace('</body>', truncated ? `<p style="font:12px sans-serif;color:#a00;text-align:center">${escapeHtml(`Se muestran los primeros ${data.rows.length} registros.`)}</p></body>` : '</body>');
  }
  const db = ctl.db!;
  const r =
    def.source.kind === 'table'
      ? db.execute(`SELECT * FROM "${def.source.name.replace(/"/g, '""')}"`)
      : db.execute(ctl.sqlOfQuery(def.source.name));
  return renderReport(def, r);
}

/** A report: with a free layout it shows the paginated preview and can be designed; quick reports can be converted. */
export function ReportView({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const def = ctl.reports.get(tab.id)!;
  return def.layout ? <LayoutReport ctl={ctl} tab={tab} def={def as ReportDef & { layout: ReportLayout }} /> : <QuickReport ctl={ctl} tab={tab} />;
}

function LayoutReport({ ctl, tab, def }: { ctl: BaseCtl; tab: Tab; def: ReportDef & { layout: ReportLayout } }) {
  const db = ctl.db!;
  const [design, setDesign] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const fields = useMemo(() => {
    try {
      return ctl.reportColumns(def);
    } catch {
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.source.kind, def.source.name, ctl.getVersion()]);
  const result = useMemo(() => {
    if (design) return { html: '', error: null as string | null };
    try {
      return { html: reportHtml(ctl, def), error: null };
    } catch (e) {
      return { html: '', error: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, design, ctl.getVersion()]);
  useEffect(() => {
    if (frame.current && !design) frame.current.srcdoc = result.html || '<!doctype html><body></body>';
  }, [result.html, design]);

  if (design) return <ReportDesigner ctl={ctl} tab={tab} def={def} fields={fields} onClose={() => setDesign(false)} />;
  const queries = db.objects('query');
  return (
    <div className="bs-reportprev">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Informe')}>
        <button type="button" className="bs-btn" onClick={() => setDesign(true)}>
          {t('Vista Diseño')}
        </button>
        <label>
          {t('Origen')}
          <select
            aria-label={t('Origen de datos')}
            value={`${def.source.kind}:${def.source.name}`}
            onChange={(e) => {
              const [kind, ...rest] = e.target.value.split(':');
              ctl.saveReport(tab.id, { ...def, source: { kind: kind as 'table' | 'query', name: rest.join(':') } });
            }}
          >
            {db.tableNames().map((n) => (
              <option key={`t${n}`} value={`table:${n}`}>
                {t('Tabla')}: {n}
              </option>
            ))}
            {queries.map((n) => (
              <option key={`q${n}`} value={`query:${n}`}>
                {t('Consulta')}: {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="bs-btn bs-btn--primary" onClick={() => (frame.current?.contentWindow?.focus(), frame.current?.contentWindow?.print())}>
          {t('Imprimir / guardar como PDF…')}
        </button>
      </div>
      {result.error && (
        <div className="bs-error" role="alert">
          {result.error}
        </div>
      )}
      <iframe ref={frame} className="bs-reportframe" title={t('Vista previa del informe')} sandbox="allow-same-origin allow-modals" />
    </div>
  );
}

function QuickReport({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const def = ctl.forms ? ctl.reports.get(tab.id)! : (null as never);
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);

  let sourceCols: string[] = [];
  try {
    sourceCols = def.source.kind === 'table' ? db.columns(def.source.name).map((c) => c.name) : db.execute(`SELECT * FROM (${ctl.sqlOfQuery(def.source.name).replace(/;\s*$/, '')}) LIMIT 0`).columns;
  } catch {
    sourceCols = [];
  }

  const html = useMemo(() => {
    try {
      setError(null);
      return reportHtml(ctl, def);
    } catch (e) {
      setError((e as Error).message);
      return `<!doctype html><body style="font:14px sans-serif;color:#a00;padding:12px">${escapeHtml((e as Error).message)}</body>`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, ctl.getVersion()]);

  useEffect(() => {
    if (frame.current) frame.current.srcdoc = html;
  }, [html]);

  const set = (patch: Partial<ReportDef>) => ctl.saveReport(tab.id, { ...def, ...patch });
  const queries = db.objects('query');

  const print = () => {
    const f = frame.current;
    f?.contentWindow?.focus();
    f?.contentWindow?.print();
  };

  return (
    <div className="bs-report">
      <aside className="bs-reportcfg" aria-label={t('Opciones del informe')}>
        <label>
          {t('Título')}
          <input aria-label={t('Título del informe')} value={def.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label>
          {t('Origen')}
          <select
            aria-label={t('Origen de datos')}
            value={`${def.source.kind}:${def.source.name}`}
            onChange={(e) => {
              const [kind, ...rest] = e.target.value.split(':');
              const name = rest.join(':');
              const src = { kind: kind as 'table' | 'query', name };
              try {
                const cols = kind === 'table' ? db.columns(name).map((c) => c.name) : db.execute(`SELECT * FROM (${ctl.sqlOfQuery(name).replace(/;\s*$/, '')}) LIMIT 0`).columns;
                ctl.saveReport(tab.id, { ...newReport(src, cols), title: def.title });
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {db.tableNames().map((n) => (
              <option key={`t${n}`} value={`table:${n}`}>
                {t('Tabla')}: {n}
              </option>
            ))}
            {queries.map((n) => (
              <option key={`q${n}`} value={`query:${n}`}>
                {t('Consulta')}: {n}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{t('Columnas')}</legend>
          {sourceCols.map((c) => (
            <label key={c}>
              <input type="checkbox" checked={def.columns.includes(c)} onChange={(e) => set({ columns: sourceCols.filter((x) => (x === c ? e.target.checked : def.columns.includes(x))) })} /> {c}
            </label>
          ))}
        </fieldset>
        <label>
          {t('Agrupar por')}
          <select aria-label={t('Agrupar por')} value={def.groupBy ?? ''} onChange={(e) => set({ groupBy: e.target.value || null })}>
            <option value="">{t('(sin agrupar)')}</option>
            {def.columns.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{t('Totales')}</legend>
          {def.columns.map((c) => (
            <label key={c}>
              <input type="checkbox" checked={def.sums.includes(c)} onChange={(e) => set({ sums: e.target.checked ? [...def.sums, c] : def.sums.filter((x) => x !== c) })} /> {c}
            </label>
          ))}
        </fieldset>
        <label>
          <input type="checkbox" checked={def.landscape} onChange={(e) => set({ landscape: e.target.checked })} /> {t('Horizontal')}
        </label>
        <button type="button" className="bs-btn bs-btn--primary" onClick={print}>
          {t('Imprimir / guardar como PDF…')}
        </button>
        <button
          type="button"
          className="bs-btn"
          onClick={() => {
            const numeric = def.source.kind === 'table' && db.tableNames().includes(def.source.name) ? db.columns(def.source.name).filter((c) => /INT|REAL|NUM|FLOA|DOUB/i.test(c.type)).map((c) => c.name) : [];
            const decimal = def.source.kind === 'table' && db.tableNames().includes(def.source.name) ? db.columns(def.source.name).filter((c) => /REAL|FLOA|DOUB|NUM/i.test(c.type)).map((c) => c.name) : [];
            ctl.saveReport(tab.id, { ...def, layout: layoutFromLegacy(def, numeric, decimal) });
          }}
        >
          {t('Convertir en diseño libre')}
        </button>
        {error && (
          <div className="bs-error" role="alert">
            {error}
          </div>
        )}
      </aside>
      <iframe ref={frame} className="bs-reportframe" title={t('Vista previa del informe')} sandbox="allow-same-origin allow-modals" />
    </div>
  );
}

export { TableDatasheet };
