import { QUERY_KINDS, TOTAL_OPS, type DesignField, type QueryDesign, type QueryKind, type TotalOp, JOIN_OPS, type JoinOp } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import type { BaseCtl, QueryState } from './ctl';
import { ExprBuilderButton } from './ExprBuilder';

const KIND_LABEL: Record<QueryKind, string> = {
  select: 'Selección',
  crosstab: 'Referencias cruzadas',
  union: 'Unión',
  append: 'Anexar (acción)',
  update: 'Actualizar (acción)',
  delete: 'Eliminar (acción)',
  maketable: 'Crear tabla (acción)',
};
const TOTAL_LABEL: Record<TotalOp, string> = {
  group: 'Agrupar por',
  sum: 'Suma',
  avg: 'Promedio',
  count: 'Cuenta',
  min: 'Mín',
  max: 'Máx',
  first: 'Primero',
  last: 'Último',
  where: 'Donde',
  expr: 'Expresión',
};
const ROLE_LABEL = { '': '(no usar)', row: 'Encabezado de fila', column: 'Encabezado de columna', value: 'Valor' } as const;

const setAt = <T,>(arr: T[], i: number, v: T): T[] => {
  const c = [...arr];
  c[i] = v;
  return c.filter((j) => (j as { left?: string; right?: string }).left || (j as { right?: string }).right);
};

/** The design grid of a query: tables, joins, fields with sort, totals, criteria rows and the options of each kind of query. */
export function QueryDesigner({ ctl, q, update, selfName }: { ctl: BaseCtl; q: QueryState; update: (patch: Partial<QueryState>) => void; selfName?: string }) {
  const db = ctl.db!;
  const d = q.design;
  const kind: QueryKind = d.kind ?? 'select';
  const allTables = db.tableNames();
  const setDesign = (patch: Partial<QueryDesign>) => update({ design: { ...d, ...patch } });
  const setField = (i: number, patch: Partial<DesignField>) => setDesign({ fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const totalsOn = d.fields.some((f) => f.total);
  const usesTables = kind !== 'union';
  const extraRows = Math.max(0, ...d.fields.map((f) => f.more?.length ?? 0));
  /** The table a name of the query stands for (a table used twice has an alias). */
  const real = (n: string) => d.tableAlias?.[n] ?? n;
  /** The columns of a table of the query, or of the saved query used as a table. */
  const colsOf = (tb: string): string[] => (d.querySources?.includes(tb) ? ctl.queryColumns(tb) : db.columns(real(tb)).map((c) => c.name));
  const colOptions = d.tables.flatMap((tb) => colsOf(tb).map((c) => `"${tb}"."${c}"`));
  const aliases = d.tables.filter((n) => d.tableAlias?.[n]);
  const addCopy = (tb: string) => {
    let i = 1;
    while (d.tables.includes(`${tb}_${i}`) || allTables.includes(`${tb}_${i}`)) i++;
    const alias = `${tb}_${i}`;
    setDesign({ tables: [...d.tables, alias], tableAlias: { ...d.tableAlias, [alias]: tb }, fields: [...d.fields, ...db.columns(tb).map((c) => ({ table: alias, name: c.name, show: false, sort: null, criteria: '' }) as DesignField)] });
  };
  const removeCopy = (alias: string) => {
    const { [alias]: _gone, ...rest } = d.tableAlias ?? {};
    void _gone;
    setDesign({
      tables: d.tables.filter((x) => x !== alias),
      tableAlias: Object.keys(rest).length ? rest : undefined,
      fields: d.fields.filter((f) => f.table !== alias),
      joins: (d.joins ?? []).filter((j) => !j.left.startsWith(`"${alias}".`) && !j.right.startsWith(`"${alias}".`)),
    });
  };
  const joins = d.joins ?? [];

  const toggleTable = (tb: string, on: boolean, isQuery = false) => {
    const tables = on ? [...d.tables, tb] : d.tables.filter((x) => x !== tb);
    let fields = d.fields;
    let newJoins = tables.length > 1 ? [...joins] : [];
    const sources = isQuery ? (on ? [...(d.querySources ?? []), tb] : (d.querySources ?? []).filter((x) => x !== tb)) : d.querySources;
    if (on) {
      const cols = isQuery ? ctl.queryColumns(tb) : db.columns(tb).map((c) => c.name);
      fields = [...fields, ...cols.map((c) => ({ table: tb, name: c, show: true, sort: null, criteria: '' }) as DesignField)];
      // the relationships already defined between the tables become joins
      for (const r of isQuery ? [] : db.relations()) {
        if (r.childCols.length !== 1) continue;
        const touchesNew = r.child === tb || r.parent === tb;
        if (touchesNew && tables.includes(r.child) && tables.includes(r.parent) && r.child !== r.parent) {
          const left = `"${r.child}"."${r.childCols[0]}"`;
          const right = `"${r.parent}"."${r.parentCols[0]}"`;
          if (!newJoins.some((j) => j.left === left && j.right === right)) newJoins.push({ left, right });
        }
      }
    } else {
      fields = fields.filter((f) => f.table !== tb);
      newJoins = newJoins.filter((j) => !j.left.startsWith(`"${tb}".`) && !j.right.startsWith(`"${tb}".`));
    }
    setDesign({ tables, fields, joins: newJoins, querySources: sources?.length ? sources : undefined });
  };

  const addField = (value: string) => {
    if (!value) return;
    const [table, name] = value.split('\u0000');
    setDesign({ fields: [...d.fields, { table: table!, name: name!, show: true, sort: null, criteria: '' }] });
  };
  const addCalc = () => {
    const used = d.fields.map((f) => f.name);
    setDesign({ fields: [...d.fields, { table: '', name: ctl.freeName('Expr', used), show: true, sort: null, criteria: '', expr: '' }] });
  };
  const toggleTotals = () => setDesign({ fields: d.fields.map((f) => ({ ...f, total: totalsOn ? undefined : f.table ? 'group' : 'expr' })) });

  const addCriteriaRow = () => setDesign({ fields: d.fields.map((f) => ({ ...f, more: [...(f.more ?? []), ...Array(extraRows + 1 - (f.more?.length ?? 0)).fill('')] })) });
  const addUnion = () => setDesign({ union: { all: d.union?.all ?? false, sources: [...(d.union?.sources ?? []), { kind: 'table', name: allTables[0] ?? '' }] } });
  const savedQueries = db.objects('query');

  const showAlias = totalsOn || d.fields.some((f) => f.alias || !f.table);

  return (
    <div className="bs-designer">
      <fieldset>
        <legend>{t('Tipo de consulta')}</legend>
        <select aria-label={t('Tipo de consulta')} value={kind} onChange={(e) => setDesign({ kind: e.target.value as QueryKind })}>
          {QUERY_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(KIND_LABEL[k])}
            </option>
          ))}
        </select>
        {kind === 'crosstab' && (
          <label>
            {t('Calcular con')}
            <select aria-label={t('Función de la referencia cruzada')} value={d.crosstabFn ?? 'sum'} onChange={(e) => setDesign({ crosstabFn: e.target.value as QueryDesign['crosstabFn'] })}>
              {(['sum', 'count', 'avg', 'min', 'max'] as const).map((f) => (
                <option key={f} value={f}>
                  {t(TOTAL_LABEL[f])}
                </option>
              ))}
            </select>
          </label>
        )}
        {(kind === 'append' || kind === 'maketable') && (
          <label>
            {kind === 'append' ? t('Tabla de destino') : t('Nombre de la tabla nueva')}
            {kind === 'append' ? (
              <select aria-label={t('Tabla de destino')} value={d.target ?? ''} onChange={(e) => setDesign({ target: e.target.value })}>
                <option value="" />
                {allTables.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            ) : (
              <input aria-label={t('Nombre de la tabla nueva')} value={d.target ?? ''} onChange={(e) => setDesign({ target: e.target.value })} />
            )}
          </label>
        )}
      </fieldset>

      {kind === 'union' && (
        <fieldset>
          <legend>{t('Orígenes de la unión')}</legend>
          {(d.union?.sources ?? []).map((s, i) => (
            <div key={i} className="bs-join">
              <select aria-label={t('Tipo de origen {n}', { n: i + 1 })} value={s.kind} onChange={(e) => setDesign({ union: { all: !!d.union?.all, sources: d.union!.sources.map((x, j) => (j === i ? { kind: e.target.value as 'table' | 'query', name: (e.target.value === 'table' ? allTables : savedQueries)[0] ?? '' } : x)) } })}>
                <option value="table">{t('Tabla')}</option>
                <option value="query">{t('Consulta')}</option>
              </select>
              <select aria-label={t('Origen {n}', { n: i + 1 })} value={s.name} onChange={(e) => setDesign({ union: { all: !!d.union?.all, sources: d.union!.sources.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } })}>
                {(s.kind === 'table' ? allTables : savedQueries).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <button type="button" className="bs-btn" aria-label={t('Quitar origen {n}', { n: i + 1 })} onClick={() => setDesign({ union: { all: !!d.union?.all, sources: d.union!.sources.filter((_, j) => j !== i) } })}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="bs-btn" onClick={addUnion}>
            {t('Agregar origen')}
          </button>
          <label>
            <input type="checkbox" checked={!!d.union?.all} onChange={(e) => setDesign({ union: { sources: d.union?.sources ?? [], all: e.target.checked } })} /> {t('Conservar duplicados (UNION ALL)')}
          </label>
          <p className="bs-hint">{t('Todos los orígenes deben tener el mismo número de campos, en el mismo orden.')}</p>
        </fieldset>
      )}

      {usesTables && (
        <fieldset>
          <legend>{t('Tablas')}</legend>
          {allTables.length === 0 && <span>{t('No hay tablas.')}</span>}
          {allTables.map((tb) => (
            <label key={tb}>
              <input type="checkbox" checked={d.tables.includes(tb)} onChange={(e) => toggleTable(tb, e.target.checked)} /> {tb}
            </label>
          ))}
          {savedQueries.filter((n) => n !== selfName).map((n) => (
            <label key={`q:${n}`}>
              <input type="checkbox" aria-label={`${t('Consulta como origen')} ${n}`} checked={!!d.querySources?.includes(n)} disabled={allTables.includes(n)} onChange={(e) => toggleTable(n, e.target.checked, true)} /> {n} <small>({t('consulta')})</small>
            </label>
          ))}
          {aliases.map((a) => (
            <label key={a}>
              <input type="checkbox" checked onChange={() => removeCopy(a)} aria-label={`${t('Copia de tabla')} ${a}`} /> {a} <small>({t('copia de {tb}', { tb: real(a) })})</small>
            </label>
          ))}
          {d.tables.some((n) => !d.tableAlias?.[n]) && (
            <label>
              {t('Usar otra vez la tabla')}
              <select
                aria-label={t('Tabla que se usa otra vez')}
                value=""
                onChange={(e) => {
                  if (e.target.value) addCopy(e.target.value);
                }}
              >
                <option value="" />
                {d.tables.filter((n) => !d.tableAlias?.[n]).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          {(kind === 'select' || kind === 'append' || kind === 'maketable') && (
            <label>
              <input type="checkbox" checked={!!d.distinct} onChange={(e) => setDesign({ distinct: e.target.checked })} /> {t('Valores únicos')}
            </label>
          )}
          {kind === 'select' && (
            <label>
              {t('Límite')}
              <input type="number" min={0} step={d.limitPercent ? 'any' : 1} aria-label={t('Límite de registros')} value={d.limit ?? ''} onChange={(e) => setDesign({ limit: e.target.value ? Number(e.target.value) : null })} />
            </label>
          )}
          {kind === 'select' && (
            <label>
              <input type="checkbox" aria-label={t('Límite en porcentaje')} checked={!!d.limitPercent} disabled={!d.limit} onChange={(e) => setDesign({ limitPercent: e.target.checked || undefined })} /> {t('Por ciento')}
            </label>
          )}
          {kind === 'select' && (
            <label>
              <input type="checkbox" checked={totalsOn} disabled={!d.fields.length} onChange={toggleTotals} /> {t('Totales')}
            </label>
          )}
        </fieldset>
      )}

      {usesTables && d.tables.length > 1 && (
        <fieldset>
          <legend>{t('Combinaciones')}</legend>
          {[...joins, { left: '', right: '' }].map((j, i) => (
            <div key={i} className="bs-join">
              <select aria-label={t('Combinar {n} izquierda', { n: i + 1 })} value={j.left} onChange={(e) => setDesign({ joins: setAt(joins, i, { ...j, left: e.target.value }) })}>
                <option value="" />
                {colOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select aria-label={t('Operador de combinación {n}', { n: i + 1 })} value={j.op ?? '='} onChange={(e) => setDesign({ joins: setAt(joins, i, { ...j, op: e.target.value === '=' ? undefined : (e.target.value as JoinOp) }) })}>
                {JOIN_OPS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <select aria-label={t('Combinar {n} derecha', { n: i + 1 })} value={j.right} onChange={(e) => setDesign({ joins: setAt(joins, i, { ...j, right: e.target.value }) })}>
                <option value="" />
                {colOptions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select aria-label={t('Tipo de combinación {n}', { n: i + 1 })} value={j.type ?? 'inner'} onChange={(e) => setDesign({ joins: setAt(joins, i, { ...j, type: e.target.value as 'inner' | 'left' | 'right' }) })}>
                <option value="inner">{t('Solo los que coinciden')}</option>
                <option value="left">{t('Todos los de la izquierda')}</option>
                <option value="right">{t('Todos los de la derecha')}</option>
              </select>
            </div>
          ))}
        </fieldset>
      )}

      {usesTables && d.tables.length > 0 && (
        <div className="bs-toolbar" role="toolbar" aria-label={t('Campos de la consulta')}>
          <label>
            {t('Agregar campo')}
            <select aria-label={t('Agregar campo')} value="" onChange={(e) => addField(e.target.value)}>
              <option value="" />
              {d.tables.flatMap((tb) => colsOf(tb).map((c) => <option key={`${tb}.${c}`} value={`${tb}\u0000${c}`}>{`${tb}.${c}`}</option>))}
            </select>
          </label>
          <button type="button" className="bs-btn" onClick={addCalc}>
            {t('Agregar campo calculado')}
          </button>
          <button type="button" className="bs-btn" onClick={addCriteriaRow} disabled={!d.fields.length}>
            {t('Agregar fila de criterios')}
          </button>
        </div>
      )}

      {usesTables && d.fields.length > 0 && (
        <div className="bs-scroll">
          <table className="bs-fields">
            <thead>
              <tr>
                <th scope="col">{t('Tabla')}</th>
                <th scope="col">{t('Campo')}</th>
                {showAlias && <th scope="col">{t('Alias')}</th>}
                <th scope="col">{t('Mostrar')}</th>
                <th scope="col">{t('Orden')}</th>
                {totalsOn && <th scope="col">{t('Total')}</th>}
                {kind === 'crosstab' && <th scope="col">{t('Referencia cruzada')}</th>}
                {kind === 'update' && <th scope="col">{t('Actualizar a')}</th>}
                {kind === 'append' && <th scope="col">{t('Anexar a')}</th>}
                <th scope="col">{t('Criterios')}</th>
                <th scope="col">{t('O')}</th>
                {Array.from({ length: extraRows }, (_, k) => (
                  <th key={k} scope="col">
                    {t('O')} {k + 3}
                  </th>
                ))}
                <th scope="col">
                  <span className="bs-sr">{t('Quitar')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.fields.map((f, i) => (
                <tr key={`${f.table}.${f.name}.${i}`}>
                  <td>{f.table}</td>
                  <td>
                    {f.table ? (
                      f.name
                    ) : (
                      <>
                        <input aria-label={t('Nombre del campo calculado {n}', { n: i + 1 })} value={f.name} onChange={(e) => setField(i, { name: e.target.value })} />
                        <input aria-label={t('Expresión de {f}', { f: f.name })} value={f.expr ?? ''} placeholder="Precio * [IVA]" onChange={(e) => setField(i, { expr: e.target.value })} />
                        <ExprBuilderButton dialect="sql" fieldText={(x) => x.split('.').map((y) => `"${y}"`).join('.')} fields={d.tables.flatMap((tb) => colsOf(tb).map((c) => `${tb}.${c}`))} value={f.expr ?? ''} onApply={(v) => setField(i, { expr: v })} label={t('Generador de expresiones de {f}', { f: f.name })} />
                      </>
                    )}
                  </td>
                  {showAlias && (
                    <td>
                      <input aria-label={t('Alias de {f}', { f: f.name })} value={f.alias ?? ''} onChange={(e) => setField(i, { alias: e.target.value })} />
                    </td>
                  )}
                  <td>
                    <input type="checkbox" aria-label={t('Mostrar {f}', { f: f.name })} checked={f.show} onChange={(e) => setField(i, { show: e.target.checked })} />
                  </td>
                  <td>
                    <select aria-label={t('Orden de {f}', { f: f.name })} value={f.sort ?? ''} onChange={(e) => setField(i, { sort: (e.target.value || null) as DesignField['sort'] })}>
                      <option value="">{t('(sin orden)')}</option>
                      <option value="asc">{t('Ascendente')}</option>
                      <option value="desc">{t('Descendente')}</option>
                    </select>
                  </td>
                  {totalsOn && (
                    <td>
                      <select aria-label={t('Total de {f}', { f: f.name })} value={f.total ?? 'group'} onChange={(e) => setField(i, { total: e.target.value as TotalOp })}>
                        {TOTAL_OPS.map((op) => (
                          <option key={op} value={op}>
                            {t(TOTAL_LABEL[op])}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {kind === 'crosstab' && (
                    <td>
                      <select aria-label={t('Referencia cruzada de {f}', { f: f.name })} value={f.role ?? ''} onChange={(e) => setField(i, { role: (e.target.value || undefined) as DesignField['role'] })}>
                        {(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) => (
                          <option key={r} value={r}>
                            {t(ROLE_LABEL[r])}
                          </option>
                        ))}
                      </select>
                    </td>
                  )}
                  {(kind === 'update' || kind === 'append') && (
                    <td>
                      <input aria-label={kind === 'update' ? t('Actualizar {f} a', { f: f.name }) : t('Anexar {f} a', { f: f.name })} value={f.set ?? ''} placeholder={kind === 'update' ? '"texto", 5, =Campo*2, [Parámetro]' : f.name} onChange={(e) => setField(i, { set: e.target.value })} />
                    </td>
                  )}
                  <td>
                    <input aria-label={t('Criterios de {f}', { f: f.name })} value={f.criteria} placeholder=">5, Like &quot;A*&quot;, Between 1 And 9, [Parámetro]" onChange={(e) => setField(i, { criteria: e.target.value })} />
                  </td>
                  <td>
                    <input aria-label={t('O de {f}', { f: f.name })} value={f.or ?? ''} onChange={(e) => setField(i, { or: e.target.value })} />
                  </td>
                  {Array.from({ length: extraRows }, (_, k) => (
                    <td key={k}>
                      <input
                        aria-label={t('O {n} de {f}', { n: k + 3, f: f.name })}
                        value={f.more?.[k] ?? ''}
                        onChange={(e) => {
                          const more = [...(f.more ?? [])];
                          while (more.length <= k) more.push('');
                          more[k] = e.target.value;
                          setField(i, { more });
                        }}
                      />
                    </td>
                  ))}
                  <td>
                    <button type="button" className="bs-btn" aria-label={t('Quitar {f}', { f: f.name })} onClick={() => setDesign({ fields: d.fields.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {usesTables && d.fields.length > 0 && <p className="bs-hint">{t('Las condiciones de una misma fila se combinan con Y; las filas (Criterios, O, O 3…) se combinan con O.')}</p>}
    </div>
  );
}
