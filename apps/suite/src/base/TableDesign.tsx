import { BOOL_FORMATS, DATE_FORMATS, NUMBER_FORMATS, REF_ACTIONS, TEXT_FORMATS, calcToSql, newColumn, validationTriggers, type ColumnDef, type FieldKind, type FieldMeta, type Lookup, type RefAction, type TableMeta } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useRef, useState, useSyncExternalStore } from 'react';
import { describeReport, withLossConfirm } from './alter';
import type { BaseCtl, Tab } from './ctl';
import { DataMacrosDialog } from './dlg-datamacros';
import { ExprBuilderButton } from './ExprBuilder';
import { IndexesDialog } from './dlg-indexes';

type Row = ColumnDef & { orig?: string; meta?: FieldMeta };

const ACTION_LABEL: Record<RefAction, string> = { 'NO ACTION': 'No hacer nada', RESTRICT: 'Impedir', CASCADE: 'En cascada', 'SET NULL': 'Poner nulo', 'SET DEFAULT': 'Valor predeterminado' };
/** The data types of the design: a stored type, with a special kind over it for long text, hyperlinks and currency. */
const TYPE_CHOICES: [string, string][] = [
  ['TEXT', 'Texto corto'],
  ['TEXT:memo', 'Texto largo'],
  ['TEXT:hyperlink', 'Hipervínculo'],
  ['TEXT:attachment', 'Datos adjuntos'],
  ['CALC', 'Campo calculado'],
  ['INTEGER', 'Número entero'],
  ['REAL', 'Número decimal'],
  ['REAL:currency', 'Moneda'],
  ['BOOLEAN', 'Sí/No'],
  ['DATE', 'Fecha'],
  ['DATETIME', 'Fecha y hora'],
];
const FORMAT_LABEL: Record<string, string> = {
  general: 'General', fixed: 'Fijo', standard: 'Estándar', percent: 'Porcentaje', scientific: 'Científico', currency: 'Moneda',
  iso: 'AAAA-MM-DD (como se guarda)', short: 'Fecha corta', medium: 'Fecha mediana', long: 'Fecha larga', time: 'Hora',
  checkbox: 'Casilla', yesno: 'Sí/No', truefalse: 'Verdadero/Falso', onoff: 'Activado/Desactivado',
  none: 'Sin cambio', upper: 'MAYÚSCULAS', lower: 'minúsculas',
};
const formatsOf = (type: string): readonly string[] => (/^(INTEGER|REAL)$/i.test(type) ? NUMBER_FORMATS : /^DATE/i.test(type) ? DATE_FORMATS : /^BOOLEAN$/i.test(type) ? BOOL_FORMATS : TEXT_FORMATS);
const choiceOf = (r: Row): string => (r.generated ? 'CALC' : r.meta?.kind ? `${r.type}:${r.meta.kind}` : r.type);
const RESULT_TYPES: [string, string][] = [['REAL', 'Número decimal'], ['INTEGER', 'Número entero'], ['TEXT', 'Texto'], ['BOOLEAN', 'Sí/No'], ['DATE', 'Fecha']];

/** Table design view: fields, types and constraints. Saving rebuilds the table keeping its data. */
export function TableDesign({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const draft = (ctl.drafts.get(tab.id) ?? []) as Row[];
  const meta0 = tab.isNew ? { fields: {} } : db.getMeta(tab.name);
  const [rows, setRows] = useState<Row[]>(() => draft.map((c) => ({ ...c, orig: tab.isNew ? undefined : c.name, meta: meta0.fields[c.name] })));
  const [tmeta, setTmeta] = useState({ description: meta0.description ?? '', rule: meta0.rule ?? '', ruleText: meta0.ruleText ?? '' });
  const [ptab, setPtab] = useState<'general' | 'lookup' | 'table'>('general');
  const [idx, setIdx] = useState(false);
  const [dm, setDm] = useState(false);
  const [name, setName] = useState(tab.name);
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const tables = db.tableNames().filter((n) => n !== tab.name);
  const refCols = useRef<Record<string, string[]>>({});

  const set = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setMsg(null);
  };
  const setMeta = (i: number, patch: Partial<FieldMeta>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, meta: { ...r.meta, ...patch } } : r)));
    setMsg(null);
  };
  /** The properties of the table as they are in the design, ready to be saved. */
  const buildMeta = (list: Row[]): TableMeta => ({
    description: tmeta.description,
    rule: tmeta.rule,
    ruleText: tmeta.ruleText,
    // the data macros are edited in their own window and saved at once: saving the design keeps them
    ...(tab.isNew || !db.getMeta(tab.name).dataMacros ? {} : { dataMacros: db.getMeta(tab.name).dataMacros }),
    fields: Object.fromEntries(list.filter((r) => r.meta).map((r) => [r.name.trim(), r.meta!])),
  });
  const colsOf = (table: string): string[] => refCols.current[table] ?? (refCols.current[table] = db.columns(table).map((c) => c.name));

  const save = () => {
    try {
      const pkCount = rows.filter((r) => r.primaryKey).length;
      if (pkCount === 0 && !window.confirm(t('La tabla no tiene clave principal. ¿Guardar de todos modos?'))) return;
      const clean: Row[] = rows.map((r) => ({
        ...r,
        name: r.name.trim(),
        autoIncrement: r.autoIncrement && r.primaryKey && r.type === 'INTEGER' && pkCount === 1,
        references: r.references && r.references.table ? r.references : null,
      }));
      // calculated fields: the Access expression becomes SQL (a field that was renamed follows its new name)
      const renamed = new Map(clean.filter((r) => r.orig && r.orig !== r.name).map((r) => [r.orig!, r.name]));
      const names = clean.map((r) => r.name);
      for (const r of clean) {
        if (!r.generated) continue;
        const text = r.meta?.calc;
        if (text !== undefined) {
          const followed = text.replace(/\[([^\]]+)\]/g, (m, n: string) => (renamed.has(n) ? `[${renamed.get(n)}]` : m));
          if (!followed.trim()) throw new Error(t('El campo calculado «{n}» no tiene expresión.', { n: r.name }));
          r.meta = { ...r.meta, calc: followed };
          r.generated = { ...r.generated, expr: calcToSql(followed, names, r.name) };
        } else if (!r.generated.expr) throw new Error(t('El campo calculado «{n}» no tiene expresión.', { n: r.name }));
      }
      db.validateCalculated(clean);
      const meta = buildMeta(clean);
      validationTriggers(name.trim(), meta); // a rule that cannot be read stops the save before anything changes
      if (tab.isNew) {
        db.createTable(name.trim(), clean.map(({ orig, meta: m, ...c }) => (void orig, void m, c)));
        db.setMeta(name.trim(), meta, false);
        ctl.close(tab.id);
        ctl.touch();
        ctl.openDesign(name.trim());
      } else {
        const report = withLossConfirm((opts) => db.alterTable(tab.name, clean.map(({ meta: m, ...c }) => (void m, c)), opts));
        if (!report) return;
        if (name.trim() !== tab.name) ctl.rename('table', tab.name, name.trim());
        db.setMeta(name.trim(), meta, false);
        ctl.drafts.set(tab.id.replace(`:${tab.name}`, `:${name.trim()}`), clean.map(({ orig, meta: m, ...c }) => (void orig, void m, c)));
        setRows(clean.map((c) => ({ ...c, orig: c.name })));
        ctl.touch();
        setMsg({ ok: true, text: [t('Se guardó la tabla.'), describeReport(report)].filter(Boolean).join(' ') });
        return;
      }
      setMsg({ ok: true, text: t('Se guardó la tabla.') });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const move = (d: number) => {
    const j = sel + d;
    if (j < 0 || j >= rows.length) return;
    setRows((rs) => {
      const c = [...rs];
      [c[sel], c[j]] = [c[j]!, c[sel]!];
      return c;
    });
    setSel(j);
  };

  return (
    <div className="bs-design">
      <div className="bs-toolbar">
        <label>
          {t('Nombre de la tabla')}
          <input aria-label={t('Nombre de la tabla')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="button" className="bs-btn" onClick={() => { setRows((rs) => [...rs, newColumn(ctl.freeName('Campo', rs.map((r) => r.name)))]); setSel(rows.length); }}>
          {t('Agregar campo')}
        </button>
        <button type="button" className="bs-btn" disabled={!rows.length} onClick={() => { setRows((rs) => rs.filter((_, i) => i !== sel)); setSel((s) => Math.max(0, s - 1)); }}>
          {t('Eliminar campo')}
        </button>
        <button type="button" className="bs-btn" onClick={() => move(-1)} disabled={sel === 0}>
          ↑
        </button>
        <button type="button" className="bs-btn" onClick={() => move(1)} disabled={sel >= rows.length - 1}>
          ↓
        </button>
        <button type="button" className="bs-btn" disabled={tab.isNew} title={tab.isNew ? t('Guarda la tabla primero') : undefined} onClick={() => setIdx(true)}>
          {t('Índices…')}
        </button>
        <button type="button" className="bs-btn" disabled={tab.isNew} title={tab.isNew ? t('Guarda la tabla primero') : undefined} onClick={() => setDm(true)}>
          {t('Macros de datos…')}
        </button>
        <button type="button" className="bs-btn bs-btn--primary" onClick={save}>
          {t('Guardar tabla')}
        </button>
      </div>
      {msg && (
        <div className={msg.ok ? 'bs-ok' : 'bs-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </div>
      )}
      <div className="bs-scroll">
        <table className="bs-fields">
          <thead>
            <tr>
              <th scope="col">{t('Nombre del campo')}</th>
              <th scope="col">{t('Tipo de datos')}</th>
              <th scope="col">{t('Clave principal')}</th>
              <th scope="col">{t('Autonumérico')}</th>
              <th scope="col">{t('Requerido')}</th>
              <th scope="col">{t('Único')}</th>
              <th scope="col">{t('Valor predeterminado')}</th>
              <th scope="col">{t('Relación con')}</th>
              <th scope="col">{t('Al eliminar')}</th>
              <th scope="col">{t('Al cambiar la clave')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={i === sel ? 'is-sel' : ''} onClick={() => setSel(i)}>
                <td>
                  <input aria-label={t('Nombre del campo {n}', { n: i + 1 })} value={r.name} onFocus={() => setSel(i)} onChange={(e) => set(i, { name: e.target.value })} />
                </td>
                <td>
                  <select
                    aria-label={t('Tipo de datos {n}', { n: i + 1 })}
                    value={TYPE_CHOICES.some(([v]) => v === choiceOf(r)) ? choiceOf(r) : TYPE_CHOICES.some(([v]) => v === r.type) ? r.type : 'TEXT'}
                    onChange={(e) => {
                      if (e.target.value === 'CALC') {
                        // a calculated field: its value comes from an expression, so nothing else of the field applies
                        set(i, { generated: r.generated ?? { expr: '', stored: false }, primaryKey: false, autoIncrement: false, unique: false, notNull: false, defaultValue: null, references: null, type: r.generated && /^(INTEGER|REAL|TEXT|BOOLEAN|DATE)$/i.test(r.type) ? r.type : 'REAL', meta: { ...r.meta, kind: undefined, format: undefined, calc: r.meta?.calc ?? '' } });
                        return;
                      }
                      const [type, kind] = e.target.value.split(':');
                      set(i, { type: type!, generated: null, meta: { ...r.meta, kind: (kind as FieldKind | undefined) || undefined, format: undefined, calc: undefined } });
                    }}
                  >
                    {TYPE_CHOICES.map(([v, label]) => (
                      <option key={v} value={v}>
                        {t(label)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="checkbox" aria-label={t('Clave principal {n}', { n: i + 1 })} checked={r.primaryKey} disabled={!!r.generated} onChange={(e) => set(i, { primaryKey: e.target.checked, notNull: e.target.checked || r.notNull })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={t('Autonumérico {n}', { n: i + 1 })} checked={r.autoIncrement} disabled={!r.primaryKey || r.type !== 'INTEGER'} onChange={(e) => set(i, { autoIncrement: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={t('Requerido {n}', { n: i + 1 })} checked={r.notNull} disabled={r.primaryKey || !!r.generated} onChange={(e) => set(i, { notNull: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={t('Único {n}', { n: i + 1 })} checked={r.unique} disabled={r.primaryKey || !!r.generated} onChange={(e) => set(i, { unique: e.target.checked })} />
                </td>
                <td>
                  <input aria-label={t('Valor predeterminado {n}', { n: i + 1 })} disabled={!!r.generated} value={r.defaultValue ?? ''} placeholder="0, 'texto', CURRENT_DATE" onChange={(e) => set(i, { defaultValue: e.target.value || null })} />
                </td>
                <td>
                  <select
                    aria-label={t('Tabla relacionada {n}', { n: i + 1 })}
                    disabled={!!r.generated}
                    value={r.references ? `${r.references.table}\u0000${r.references.column}` : ''}
                    onChange={(e) => {
                      const [tb, cl] = e.target.value.split('\u0000');
                      set(i, { references: tb ? { table: tb, column: cl ?? '' } : null });
                    }}
                  >
                    <option value="">{t('(ninguna)')}</option>
                    {tables.flatMap((tb) => colsOf(tb).map((cl) => <option key={`${tb}.${cl}`} value={`${tb}\u0000${cl}`}>{`${tb}.${cl}`}</option>))}
                  </select>
                </td>
                {(['onDelete', 'onUpdate'] as const).map((k) => (
                  <td key={k}>
                    <select
                      aria-label={t(k === 'onDelete' ? 'Al eliminar {n}' : 'Al cambiar la clave {n}', { n: i + 1 })}
                      disabled={!r.references}
                      value={r.references?.[k] ?? 'NO ACTION'}
                      onChange={(e) => set(i, { references: r.references ? { ...r.references, [k]: e.target.value as RefAction } : null })}
                    >
                      {REF_ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {t(ACTION_LABEL[a])}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows[sel] && (
        <section className="bs-fprops" aria-label={t('Propiedades del campo')}>
          <div role="tablist" className="bs-ptabs">
            {([['general', 'General'], ['lookup', 'Búsqueda'], ['table', 'Propiedades de la tabla']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={ptab === k} className={ptab === k ? 'is-on' : ''} onClick={() => setPtab(k)}>
                {t(label)}
              </button>
            ))}
            <span className="bs-pfield">{ptab === 'table' ? name : rows[sel]!.name}</span>
          </div>
          {ptab === 'general' && <FieldGeneral r={rows[sel]!} set={(p) => setMeta(sel, p)} setRow={(p) => set(sel, p)} allFields={rows.map((x) => x.name)} />}
          {ptab === 'lookup' && <FieldLookup r={rows[sel]!} tables={tables} colsOf={colsOf} set={(p) => setMeta(sel, p)} />}
          {ptab === 'table' && (
            <div className="bs-pgrid">
              <label>
                {t('Descripción de la tabla')}
                <input aria-label={t('Descripción de la tabla')} value={tmeta.description} onChange={(e) => setTmeta({ ...tmeta, description: e.target.value })} />
              </label>
              <label>
                {t('Regla de validación de la tabla')}
                <input aria-label={t('Regla de validación de la tabla')} value={tmeta.rule} placeholder="[Fin] >= [Inicio]" onChange={(e) => setTmeta({ ...tmeta, rule: e.target.value })} />
              </label>
              <label>
                {t('Texto de validación de la tabla')}
                <input aria-label={t('Texto de validación de la tabla')} value={tmeta.ruleText} onChange={(e) => setTmeta({ ...tmeta, ruleText: e.target.value })} />
              </label>
            </div>
          )}
        </section>
      )}
      {idx && !tab.isNew && <IndexesDialog ctl={ctl} table={tab.name} onClose={() => setIdx(false)} />}
      {dm && !tab.isNew && <DataMacrosDialog ctl={ctl} table={tab.name} onClose={() => setDm(false)} />}
      <p className="bs-hint">{t('Al guardar, los datos se conservan. Cambiar el tipo convierte los valores; si alguno no se puede convertir queda vacío o como texto, según SQLite.')}</p>
    </div>
  );
}

/** General properties of a field: description, caption, format, decimals, input mask and validation rule. */
function FieldGeneral({ r, set, setRow, allFields }: { r: Row; set: (p: Partial<FieldMeta>) => void; setRow: (p: Partial<Row>) => void; allFields: string[] }) {
  const m = r.meta ?? {};
  const numeric = /^(INTEGER|REAL)$/i.test(r.type);
  const fmts = formatsOf(r.type);
  const format = m.format ?? (m.kind === 'currency' ? 'currency' : fmts[0]!);
  return (
    <div className="bs-pgrid">
      {r.generated && (
        <>
          <label className="bs-wide">
            {t('Expresión del campo calculado')}
            <span className="bs-withfx">
              <input aria-label={t('Expresión del campo calculado')} value={m.calc ?? r.generated.expr} placeholder="[Precio] * [Cantidad]" onChange={(e) => set({ calc: e.target.value })} />
              <ExprBuilderButton fields={allFields.filter((f) => f !== r.name)} value={m.calc ?? r.generated.expr} onApply={(v) => set({ calc: v })} label={t('Generador de expresiones del campo calculado')} />
            </span>
          </label>
          <label>
            {t('Tipo del resultado')}
            <select aria-label={t('Tipo del resultado')} value={r.type} onChange={(e) => setRow({ type: e.target.value, meta: { ...r.meta, format: undefined } })}>
              {RESULT_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {t(l)}
                </option>
              ))}
            </select>
          </label>
          <label className="bs-chk">
            <input type="checkbox" aria-label={t('Guardar el resultado')} checked={r.generated.stored} onChange={(e) => setRow({ generated: { ...r.generated!, stored: e.target.checked } })} /> {t('Guardar el resultado en el archivo')}
          </label>
          <p className="bs-note">{t('El valor sale de la expresión con los demás campos del registro y no se puede escribir. Solo valen funciones que den siempre el mismo resultado: no Fecha(), Ahora() ni números al azar.')}</p>
        </>
      )}
      <label>
        {t('Descripción del campo')}
        <input aria-label={t('Descripción del campo')} value={m.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label>
        {t('Leyenda')}
        <input aria-label={t('Leyenda')} value={m.caption ?? ''} placeholder={r.name} onChange={(e) => set({ caption: e.target.value })} />
      </label>
      <label>
        {t('Formato')}
        <select aria-label={t('Formato')} value={format} onChange={(e) => set({ format: e.target.value === fmts[0] && m.kind !== 'currency' ? undefined : e.target.value })}>
          {fmts.map((f) => (
            <option key={f} value={f}>
              {t(FORMAT_LABEL[f] ?? f)}
            </option>
          ))}
        </select>
      </label>
      {numeric && (
        <label>
          {t('Lugares decimales')}
          <input type="number" min={0} max={10} aria-label={t('Lugares decimales')} value={m.decimals ?? ''} placeholder={t('Automático')} onChange={(e) => set({ decimals: e.target.value === '' ? undefined : Math.max(0, Math.min(10, Number(e.target.value))) })} />
        </label>
      )}
      {numeric && (format === 'currency' || m.kind === 'currency') && (
        <label>
          {t('Código de moneda')}
          <input aria-label={t('Código de moneda')} value={m.currency ?? ''} placeholder="USD, EUR, PEN…" maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
        </label>
      )}
      {!numeric && !/^BOOLEAN$/i.test(r.type) && (
        <label>
          {t('Máscara de entrada')}
          <input aria-label={t('Máscara de entrada')} value={m.inputMask ?? ''} placeholder="(000) 000-0000" onChange={(e) => set({ inputMask: e.target.value })} />
        </label>
      )}
      <label>
        {t('Regla de validación')}
        <input aria-label={t('Regla de validación')} value={m.rule ?? ''} placeholder=">=0 Y <=100" onChange={(e) => set({ rule: e.target.value })} />
      </label>
      <label>
        {t('Texto de validación')}
        <input aria-label={t('Texto de validación')} value={m.ruleText ?? ''} onChange={(e) => set({ ruleText: e.target.value })} />
      </label>
      <p className="bs-note">{t('La regla vale al escribir en la hoja de datos, en formularios, al importar y desde el código. Ejemplos: >=0 Y <=100 · Como "A*" · Es No Nulo · [Fin] >= [Inicio]. Máscara: 0 dígito, 9 dígito opcional, L letra, A letra o dígito, > mayúsculas, < minúsculas, \\ símbolo literal.')}</p>
    </div>
  );
}

/** Lookup of a field: a list of values or the field of another table, shown as a list in the datasheet. */
function FieldLookup({ r, tables, colsOf, set }: { r: Row; tables: string[]; colsOf: (t: string) => string[]; set: (p: Partial<FieldMeta>) => void }) {
  const l = r.meta?.lookup;
  const kind = l?.kind ?? 'none';
  const setLookup = (x: Lookup | undefined) => set({ lookup: x });
  const table = l?.kind === 'table' ? l.table : (tables[0] ?? '');
  const cols = table ? colsOf(table) : [];
  return (
    <div className="bs-pgrid">
      <label>
        {t('Tipo de búsqueda')}
        <select
          aria-label={t('Tipo de búsqueda')}
          value={kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === 'none') setLookup(undefined);
            else if (k === 'list') setLookup({ kind: 'list', items: [] });
            else setLookup({ kind: 'table', table: tables[0] ?? '', valueCol: colsOf(tables[0] ?? '')[0] ?? '', displayCol: colsOf(tables[0] ?? '')[1] ?? colsOf(tables[0] ?? '')[0] ?? '' });
          }}
        >
          <option value="none">{t('Ninguna (cuadro de texto)')}</option>
          <option value="list">{t('Lista de valores')}</option>
          <option value="table" disabled={!tables.length}>{t('Campo de otra tabla')}</option>
        </select>
      </label>
      {l?.kind === 'list' && (
        <label>
          {t('Valores (uno por línea)')}
          <textarea rows={4} aria-label={t('Valores de la lista')} value={l.items.join('\n')} onChange={(e) => setLookup({ ...l, items: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
        </label>
      )}
      {l?.kind === 'table' && (
        <>
          <label>
            {t('Tabla')}
            <select aria-label={t('Tabla de la búsqueda')} value={l.table} onChange={(e) => setLookup({ ...l, table: e.target.value, valueCol: colsOf(e.target.value)[0] ?? '', displayCol: colsOf(e.target.value)[1] ?? colsOf(e.target.value)[0] ?? '' })}>
              {tables.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Campo que se guarda')}
            <select aria-label={t('Campo que se guarda')} value={l.valueCol} onChange={(e) => setLookup({ ...l, valueCol: e.target.value })}>
              {cols.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Campo que se muestra')}
            <select aria-label={t('Campo que se muestra')} value={l.displayCol} onChange={(e) => setLookup({ ...l, displayCol: e.target.value })}>
              {cols.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {l && (
        <label className="bs-check">
          <input type="checkbox" checked={l.limit !== false} onChange={(e) => setLookup({ ...l, limit: e.target.checked ? undefined : false })} /> {t('Limitar a la lista')}
        </label>
      )}
      <p className="bs-note">{t('En la hoja de datos el campo se elige de una lista. La búsqueda no crea una relación: para exigir que el valor exista, usa «Relación con».')}</p>
    </div>
  );
}
