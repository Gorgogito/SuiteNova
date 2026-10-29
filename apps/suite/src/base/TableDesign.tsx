import { FIELD_TYPES, REF_ACTIONS, newColumn, type ColumnDef, type RefAction } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useRef, useState, useSyncExternalStore } from 'react';
import { describeReport, withLossConfirm } from './alter';
import type { BaseCtl, Tab } from './ctl';

type Row = ColumnDef & { orig?: string };

const ACTION_LABEL: Record<RefAction, string> = { 'NO ACTION': 'No hacer nada', RESTRICT: 'Impedir', CASCADE: 'En cascada', 'SET NULL': 'Poner nulo', 'SET DEFAULT': 'Valor predeterminado' };
const TYPE_LABELS: Record<string, string> = { TEXT: 'Texto', INTEGER: 'Número entero', REAL: 'Número decimal', BOOLEAN: 'Sí/No', DATE: 'Fecha', DATETIME: 'Fecha y hora' };

/** Table design view: fields, types and constraints. Saving rebuilds the table keeping its data. */
export function TableDesign({ ctl, tab }: { ctl: BaseCtl; tab: Tab }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const draft = (ctl.drafts.get(tab.id) ?? []) as Row[];
  const [rows, setRows] = useState<Row[]>(() => draft.map((c) => ({ ...c, orig: tab.isNew ? undefined : c.name })));
  const [name, setName] = useState(tab.name);
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const tables = db.tableNames().filter((n) => n !== tab.name);
  const refCols = useRef<Record<string, string[]>>({});

  const set = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setMsg(null);
  };
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
      if (tab.isNew) {
        db.createTable(name.trim(), clean.map(({ orig, ...c }) => (void orig, c)));
        ctl.close(tab.id);
        ctl.touch();
        ctl.openDesign(name.trim());
      } else {
        const report = withLossConfirm((opts) => db.alterTable(tab.name, clean, opts));
        if (!report) return;
        if (name.trim() !== tab.name) ctl.rename('table', tab.name, name.trim());
        ctl.drafts.set(tab.id.replace(`:${tab.name}`, `:${name.trim()}`), clean.map(({ orig, ...c }) => (void orig, c)));
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
                  <select aria-label={t('Tipo de datos {n}', { n: i + 1 })} value={FIELD_TYPES.includes(r.type as never) ? r.type : 'TEXT'} onChange={(e) => set(i, { type: e.target.value })}>
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {t(TYPE_LABELS[ft]!)}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="checkbox" aria-label={t('Clave principal {n}', { n: i + 1 })} checked={r.primaryKey} onChange={(e) => set(i, { primaryKey: e.target.checked, notNull: e.target.checked || r.notNull })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={t('Autonumérico {n}', { n: i + 1 })} checked={r.autoIncrement} disabled={!r.primaryKey || r.type !== 'INTEGER'} onChange={(e) => set(i, { autoIncrement: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={t('Requerido {n}', { n: i + 1 })} checked={r.notNull} disabled={r.primaryKey} onChange={(e) => set(i, { notNull: e.target.checked })} />
                </td>
                <td>
                  <input type="checkbox" aria-label={t('Único {n}', { n: i + 1 })} checked={r.unique} disabled={r.primaryKey} onChange={(e) => set(i, { unique: e.target.checked })} />
                </td>
                <td>
                  <input aria-label={t('Valor predeterminado {n}', { n: i + 1 })} value={r.defaultValue ?? ''} placeholder="0, 'texto', CURRENT_DATE" onChange={(e) => set(i, { defaultValue: e.target.value || null })} />
                </td>
                <td>
                  <select
                    aria-label={t('Tabla relacionada {n}', { n: i + 1 })}
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
      <p className="bs-hint">{t('Al guardar, los datos se conservan. Cambiar el tipo convierte los valores; si alguno no se puede convertir queda vacío o como texto, según SQLite.')}</p>
    </div>
  );
}
