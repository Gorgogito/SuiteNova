import { calcValue, comboOptions, recordObject, subformData, type BaseDb, type ColumnDef, type FormControl, type FormLayout, type Handler, type Value } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BaseCtl, FormDef, Tab } from './ctl';

type Ctl<T extends FormControl['type']> = Extract<FormControl, { type: T }>;

/** A form with a free layout, in form view: record navigation and the controls where the designer put them. */
export function FormRun({ ctl, tab, def, onDesign }: { ctl: BaseCtl; tab: Tab; def: FormDef & { layout: FormLayout }; onDesign: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const layout = def.layout;
  const exists = db.tableNames().includes(def.table);
  const cols: ColumnDef[] = exists ? db.columns(def.table) : [];
  const names = cols.map((c) => c.name);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const filter = ctl.formFilters.get(tab.id);
  const count = exists ? db.count(def.table, undefined, filter) : 0;
  const i = Math.min(idx, Math.max(0, count - 1));
  const rec = exists && count ? db.browse(def.table, { offset: i, limit: 1, filter }) : null;
  const row = rec?.rows[0] ?? null;
  const rid = row ? Number(row[0]) : null;
  const record = row ? recordObject(names, row.slice(1)) : null;

  const guard = (fn: () => void) => {
    try {
      fn();
      setErr(null);
      ctl.touch();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const run = (h: Handler | undefined) => {
    if (!h) return;
    void ctl.runHandler(h, { form: tab.name }).then((m) => {
      setErr(m.error ?? null);
      ctl.touch();
    });
  };
  const commit = (field: string, text: string, after?: Handler) => {
    if (rid === null) return;
    guard(() => db.updateCell(def.table, rid, field, text));
    if (after) run(after);
  };

  // what macros and procedures can reach: Forms!Name!Field, Me!Field, GoToRecord
  const live = useRef({ record, rid, i, count, names });
  live.current = { record, rid, i, count, names };
  /** The current record as it is in the database now (a handler may run right after a change, before the form is redrawn). */
  const fresh = () => {
    const id = live.current.rid;
    if (id === null) return null;
    const r = db.execute(`SELECT * FROM "${def.table.replace(/"/g, '""')}" WHERE rowid = ${Math.trunc(id)}`);
    return r.rows[0] ? recordObject(r.columns, r.rows[0]) : null;
  };
  useEffect(() => {
    ctl.formHandles.set(tab.name, {
      name: tab.name,
      table: def.table,
      get: (field) => {
        const r = fresh();
        const k = r ? Object.keys(r).find((x) => x.toLowerCase() === field.toLowerCase()) : undefined;
        if (k === undefined) throw new Error(`El formulario "${tab.name}" no tiene el campo "${field}".`);
        return r![k] ?? null;
      },
      set: (field, v) => {
        if (live.current.rid === null) throw new Error('No hay un registro actual.');
        db.updateCell(def.table, live.current.rid, field, v);
        ctl.touch();
      },
      goto: (where) => {
        const { i: cur, count: n } = live.current;
        if (where === 'new') {
          db.insertRow(def.table);
          setIdx(db.count(def.table, undefined, filter) - 1);
        } else setIdx(where === 'first' ? 0 : where === 'last' ? Math.max(0, n - 1) : where === 'next' ? Math.min(n - 1, cur + 1) : Math.max(0, cur - 1));
        ctl.touch();
      },
      requery: () => ctl.touch(),
      record: () => fresh() ?? {},
    });
    return () => void ctl.formHandles.delete(tab.name);
  }, [ctl, tab.name, def.table, db]);

  // form events: when it opens, and whenever the current record changes
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    run(layout.events?.onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastRid = useRef<number | null>(null);
  useEffect(() => {
    if (rid !== lastRid.current) {
      lastRid.current = rid;
      if (rid !== null) run(layout.events?.onCurrent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid]);
  const act = (c: Ctl<'button'>) => {
    switch (c.action) {
      case 'first':
        return setIdx(0);
      case 'previous':
        return setIdx(Math.max(0, i - 1));
      case 'next':
        return setIdx(Math.min(count - 1, i + 1));
      case 'last':
        return setIdx(Math.max(0, count - 1));
      case 'new':
        return guard(() => {
          db.insertRow(def.table);
          setIdx(db.count(def.table) - 1);
        });
      case 'delete':
        if (rid !== null && window.confirm(t('¿Eliminar este registro? Podrá deshacerlo con Ctrl+Z.'))) {
          guard(() => db.deleteRows(def.table, [rid]));
          setIdx(Math.max(0, i - 1));
        }
        return;
      case 'run':
        if (!c.handler) return setErr(t('El botón no tiene macro ni procedimiento asignado.'));
        return run(c.handler);
    }
  };

  const idOf = (c: FormControl) => ('field' in c && c.field && layout.controls.filter((x) => 'field' in x && x.field === c.field).length === 1 ? `f-${c.field}` : `f-${c.id}`);

  const control = (c: FormControl) => {
    const style = { left: c.x, top: c.y, width: c.w, height: c.h };
    if (c.type === 'label')
      return (
        <div key={c.id} className="bs-fc bs-fc-label" style={{ ...style, fontWeight: c.bold ? 700 : undefined, fontSize: c.size }}>
          <label htmlFor={undefined}>{c.text}</label>
        </div>
      );
    if (c.type === 'button')
      return (
        <button key={c.id} type="button" className="bs-fc bs-btn" style={style} onClick={() => act(c)}>
          {c.caption}
        </button>
      );
    if (c.type === 'subform') return <Subform key={c.id} ctl={ctl} c={c} record={record} style={style} onError={setErr} />;
    const col = cols.find((x) => x.name.toLowerCase() === (c.type === 'text' && c.calc ? '' : (c as { field: string }).field.toLowerCase()));
    const v = col && row ? row[names.indexOf(col.name) + 1] : null;
    const disabled = rid === null;
    if (c.type === 'text' && c.calc) {
      const val = record ? calcValue(c.calc, record) : null;
      return <input key={c.id} id={idOf(c)} className="bs-fc" style={style} aria-label={c.name} readOnly value={val === null ? '' : String(val)} />;
    }
    if (!col) return <input key={c.id} className="bs-fc bs-fc-missing" style={style} aria-label={c.name} disabled value="" placeholder={t('(campo no encontrado)')} />;
    const type = col.type.toUpperCase();
    if (c.type === 'check')
      return (
        <label key={c.id} className="bs-fc bs-fc-check" style={style}>
          <input id={idOf(c)} type="checkbox" disabled={disabled} checked={!!Number(v)} onChange={(e) => commit(col.name, e.target.checked ? '1' : '0', c.afterUpdate)} /> {c.caption}
        </label>
      );
    if (c.type === 'combo') return <Combo key={c.id} db={db} id={idOf(c)} c={c} value={v as Value} style={style} disabled={disabled} onPick={(val) => commit(col.name, val, c.afterUpdate)} />;
    const readOnly = c.readOnly;
    return (
      <input
        key={`${c.id}:${rid}:${String(v)}`}
        id={idOf(c)}
        className="bs-fc"
        style={style}
        aria-label={c.name}
        type={type === 'DATE' ? 'date' : 'text'}
        inputMode={type === 'INTEGER' ? 'numeric' : type === 'REAL' ? 'decimal' : undefined}
        readOnly={readOnly}
        disabled={disabled}
        defaultValue={v === null || v === undefined ? '' : String(v)}
        onBlur={(e) => !readOnly && e.target.value !== String(v ?? '') && commit(col.name, e.target.value, c.afterUpdate)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    );
  };

  if (!exists) return <div className="bs-empty">{t('La tabla ya no existe.')}</div>;
  return (
    <div className="bs-form">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Formulario')}>
        <button type="button" className="bs-btn" onClick={onDesign}>
          {t('Vista Diseño')}
        </button>
        <span className="bs-hint">{t('Tabla')}: {def.table}</span>
      </div>
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
        <button type="button" className="bs-btn" onClick={() => act({ type: 'button', action: 'new' } as Ctl<'button'>)}>
          {t('Nuevo registro')}
        </button>
        <button type="button" className="bs-btn" disabled={rid === null} onClick={() => act({ type: 'button', action: 'delete' } as Ctl<'button'>)}>
          {t('Eliminar registro')}
        </button>
      </div>
      {err && (
        <div className="bs-error" role="alert">
          {err}
        </div>
      )}
      <div className="bs-formscroll">
        <div className="bs-formcanvas" role="group" aria-label={tab.name} style={{ width: layout.width, height: layout.height }}>
          {layout.controls.map(control)}
          {!row && <div className="bs-formempty">{t('Esta tabla no tiene registros.')}</div>}
        </div>
      </div>
    </div>
  );
}

function Combo({ db, id, c, value, style, disabled, onPick }: { db: BaseDb; id: string; c: Ctl<'combo'>; value: Value; style: React.CSSProperties; disabled: boolean; onPick: (v: string) => void }) {
  let options: { value: Value; label: string }[] = [];
  let error: string | null = null;
  try {
    options = comboOptions(db, c.source);
  } catch (e) {
    error = (e as Error).message;
  }
  const cur = value === null || value === undefined ? '' : String(value);
  const known = options.some((o) => String(o.value) === cur);
  if (error) return <select className="bs-fc bs-fc-missing" style={style} aria-label={c.name} disabled title={error}><option>{t('(lista no disponible)')}</option></select>;
  return (
    <select id={id} className="bs-fc" style={style} aria-label={c.name} disabled={disabled} value={cur} onChange={(e) => onPick(e.target.value)}>
      <option value="" />
      {!known && cur !== '' && <option value={cur}>{cur}</option>}
      {options.map((o, k) => (
        <option key={k} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Subform({ ctl, c, record, style, onError }: { ctl: BaseCtl; c: Ctl<'subform'>; record: ReturnType<typeof recordObject> | null; style: React.CSSProperties; onError: (m: string | null) => void }) {
  const db = ctl.db!;
  const data = subformData(db, c, record);
  const key = record ? Object.keys(record).find((k) => k.toLowerCase() === c.parentField.toLowerCase()) : undefined;
  const parent = key === undefined ? null : record![key];
  const run = (fn: () => void) => {
    try {
      fn();
      onError(null);
      ctl.touch();
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <div className="bs-fc bs-subform" style={style} role="group" aria-label={c.name}>
      <div className="bs-scroll">
        <table>
          <thead>
            <tr>
              {data.columns.map((n) => (
                <th key={n} scope="col">
                  {n}
                </th>
              ))}
              <th scope="col">
                <span className="bs-sr">{t('Quitar')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={String(r[0])}>
                {data.columns.map((n, k) => (
                  <td key={n}>
                    <input
                      aria-label={`${n} ${String(r[0])}`}
                      defaultValue={r[k + 1] === null || r[k + 1] === undefined ? '' : String(r[k + 1])}
                      key={`${r[0]}:${String(r[k + 1])}`}
                      onBlur={(e) => e.target.value !== String(r[k + 1] ?? '') && run(() => db.updateCell(c.table, Number(r[0]), n, e.target.value))}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                ))}
                <td>
                  <button type="button" className="bs-btn" aria-label={t('Quitar el registro {n}', { n: String(r[0]) })} onClick={() => run(() => db.deleteRows(c.table, [Number(r[0])]))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="bs-btn" disabled={parent === null || parent === undefined} onClick={() => run(() => db.insertRow(c.table, { [c.childField]: parent }))}>
        {t('Agregar registro')}
      </button>
    </div>
  );
}
