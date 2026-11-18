import { parseAttachments, calcValue, comboOptions, condLook, formFilterSql, formSorts, keyMatches, nestedData, newRecordDefaults, recordObject, subformData, type BaseDb, type ColumnDef, type FormControl, type FormLayout, type Handler, type SortKey, type Value } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BaseCtl, FormDef, Tab } from './ctl';
import { AttachmentsDialog } from './dlg-attach';
import { ProofMemo } from '../spell';

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
  const [bump, setBump] = useState(0);
  const [view, setView] = useState<'single' | 'continuous' | 'datasheet' | 'split'>(def.layout.view ?? 'single');
  const [userFilter, setUserFilter] = useState('');
  const [filterText, setFilterText] = useState('');
  const [userSort, setUserSort] = useState<SortKey | null>(null);
  const [lastField, setLastField] = useState<string | null>(null);
  const [attachDlg, setAttachDlg] = useState<{ rid: number; field: string } | null>(null);
  const [pages, setPages] = useState<Record<string, number>>({});
  const editable = layout.allowEdits !== false;
  const canAdd = layout.allowAdditions !== false;
  const canDelete = layout.allowDeletions !== false;
  let filter: string | undefined;
  let filterErr: string | null = null;
  try {
    filter = formFilterSql(layout, userFilter, ctl.formFilters.get(tab.id));
  } catch (e) {
    filterErr = (e as Error).message;
  }
  const sorts = formSorts(layout, userSort).filter((k) => names.some((n) => n === k.col));
  const count = exists ? db.count(def.table, undefined, filter) : 0;
  const i = Math.min(idx, Math.max(0, count - 1));
  const rec = exists && count ? db.browse(def.table, { offset: i, limit: 1, filter, sorts }) : null;
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
  // what macros and procedures can reach: Forms!Name!Field, Me!Field, GoToRecord
  const live = useRef({ record, rid, i, count, names });
  live.current = { record, rid, i, count, names };
  /** Save a change of a control. The form's "before update" event may refuse it: then the change is taken back. */
  const commit = async (recId: number | null, field: string, text: string, after?: Handler) => {
    if (recId === null || !editable) return;
    try {
      db.updateCell(def.table, recId, field, text);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    const before = layout.events?.beforeUpdate;
    if (before) {
      live.current = { ...live.current, rid: recId };
      const m = await ctl.runHandler(before, { form: tab.name });
      if (m.error || m.cancel) {
        db.cancelLast();
        setErr(m.error ?? t('El cambio se canceló.'));
        setBump((n) => n + 1);
        ctl.touch();
        return;
      }
    }
    setErr(null);
    ctl.touch();
    if (after) run(after);
  };

  /** The current record as it is in the database now (a handler may run right after a change, before the form is redrawn). */
  const fresh = () => {
    const id = live.current.rid;
    if (id === null) return null;
    const r = db.execute(`SELECT * FROM "${def.table.replace(/"/g, '""')}" WHERE rowid = ${Math.trunc(id)}`);
    return r.rows[0] ? recordObject(r.columns, r.rows[0]) : null;
  };
  // closing the tab (not just switching to the design view) fires the "on close" event
  useEffect(
    () => () => {
      const h = layout.events?.onClose;
      if (h && !ctl.tabs.some((x) => x.id === tab.id)) void ctl.runHandler(h, { form: tab.name });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // shortcuts of the form
  useEffect(() => {
    const keys = layout.keys ?? [];
    if (!keys.length) return;
    const onKey = (e: KeyboardEvent) => {
      const k = keys.find((x) => keyMatches(x.key, e));
      if (!k) return;
      e.preventDefault();
      run(k.handler);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.keys]);
  // timer of the form
  useEffect(() => {
    const h = layout.events?.onTimer;
    const ms = layout.timerInterval ?? 0;
    if (!h || ms < 250) return;
    const id = window.setInterval(() => run(h), ms);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.events?.onTimer, layout.timerInterval]);
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
          db.insertRow(def.table, newRecordDefaults(layout, cols));
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
        if (!canAdd) return setErr(t('El formulario no permite agregar registros.'));
        return guard(() => {
          db.insertRow(def.table, newRecordDefaults(layout, cols));
          setIdx(db.count(def.table, undefined, filter) - 1);
        });
      case 'delete':
        if (!canDelete) return setErr(t('El formulario no permite eliminar registros.'));
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

  const openUrl = (raw: string) => {
    const s = raw.trim();
    if (!s) return;
    const full = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
    if (!/^(https?|mailto|tel):/i.test(full)) return setErr(t('Solo se abren direcciones http, https, mailto y tel.'));
    window.open(full, '_blank', 'noopener');
  };

  type Rc = { row: unknown[] | null; rid: number | null; record: ReturnType<typeof recordObject> | null; k: number };
  /** Controls with events of their own are wrapped by an element that does not draw anything (it only listens). */
  const control = (c: FormControl, rc: Rc) => {
    const el = controlRaw(c, rc);
    const on = c.on;
    if (!el || !on || !Object.values(on).some(Boolean)) return el;
    return (
      <span key={`${c.id}:${rc.k}:ev`} style={{ display: 'contents' }} onClick={on.click ? () => run(on.click) : undefined} onDoubleClick={on.dblClick ? () => run(on.dblClick) : undefined} onFocus={on.gotFocus ? () => run(on.gotFocus) : undefined} onBlur={on.lostFocus ? () => run(on.lostFocus) : undefined} onInput={on.change ? () => run(on.change) : undefined}>
        {el}
      </span>
    );
  };
  const controlRaw = (c: FormControl, rc: Rc) => {
    const look = condLook(c, rc.record);
    if (look.hide || c.visible === false) return null;
    const dis = !!look.disable || c.enabled === false;
    const ti = c.tabStop === false ? { tabIndex: -1 } : {};
    if (c.tab && (pages[c.tab.id] ?? 0) !== c.tab.page) return null;
    const style: React.CSSProperties = { left: c.x, top: c.y, width: c.w, height: c.h, ...(look.bg ? { background: look.bg } : {}), ...(look.color ? { color: look.color } : {}), ...(look.bold ? { fontWeight: 700 } : {}) };
    const key = `${c.id}:${rc.k}`;
    const tip = c.tip;
    const { row, rid, record } = rc;
    const single = view === 'single';
    if (c.type === 'label')
      return (
        <div key={key} className="bs-fc bs-fc-label" style={{ ...style, fontWeight: c.bold || look.bold ? 700 : undefined, fontSize: c.size }} title={tip}>
          <label htmlFor={undefined}>{c.text}</label>
        </div>
      );
    if (c.type === 'button')
      return (
        <button key={key} type="button" className="bs-fc bs-btn" style={style} title={tip} disabled={dis} {...ti} onClick={() => act(c)}>
          {c.caption}
        </button>
      );
    if (c.type === 'subform') return <Subform key={key} ctl={ctl} c={c} record={record} style={style} onError={setErr} />;
    if (c.type === 'image')
      return c.src ? <img key={key} className="bs-fc bs-fc-img" style={{ ...style, objectFit: c.mode === 'stretch' ? 'fill' : c.mode === 'clip' ? 'none' : 'contain', objectPosition: 'left top' }} src={c.src} alt={c.alt ?? c.name} title={tip} /> : null;
    if (c.type === 'line') return <div key={key} className="bs-fc" role="separator" style={{ ...style, height: c.thickness ?? 1, top: c.y + Math.max(0, c.h / 2 - 1), background: c.color || '#808080' }} />;
    if (c.type === 'rect') return <div key={key} className="bs-fc" aria-hidden="true" style={{ ...style, background: look.bg ?? (c.fill || 'transparent'), border: `1px solid ${c.border || '#808080'}`, boxSizing: 'border-box' }} />;
    if (c.type === 'attachment') {
      const k = Object.keys(record ?? {}).find((x) => x.toLowerCase() === c.field.toLowerCase());
      const n = k && record ? parseAttachments(record[k]).length : 0;
      return (
        <button key={key} type="button" className="bs-fc bs-btn" style={style} title={tip} aria-label={c.name} disabled={rid === null || dis} {...ti} onClick={() => rid !== null && setAttachDlg({ rid, field: c.field })}>
          📎 {c.caption || t('Datos adjuntos')}
          {n ? ` (${n})` : ''}
        </button>
      );
    }
    if (c.type === 'tabs')
      return (
        <div key={key} className="bs-fc bs-ftabs" style={{ ...style, background: undefined }} role="group" aria-label={c.name}>
          <div role="tablist" className="bs-tabbar">
            {c.pages.map((p, n) => (
              <button key={n} type="button" role="tab" aria-selected={(pages[c.id] ?? 0) === n} className={(pages[c.id] ?? 0) === n ? 'is-on' : ''} onClick={() => setPages({ ...pages, [c.id]: n })}>
                {p}
              </button>
            ))}
          </div>
        </div>
      );
    if (c.type === 'hyperlink') {
      const k2 = c.field ? Object.keys(record ?? {}).find((x) => x.toLowerCase() === c.field!.toLowerCase()) : undefined;
      const addr = c.field ? (k2 && record ? String(record[k2] ?? '') : '') : (c.url ?? '');
      return (
        <div key={key} className="bs-fc bs-fc-label" style={style} title={tip ?? addr}>
          <a href="#" role="link" className="bs-link" aria-label={c.name} onClick={(e) => (e.preventDefault(), openUrl(addr))}>
            {c.text}
          </a>
        </div>
      );
    }
    const col = cols.find((x) => x.name.toLowerCase() === (c.type === 'text' && c.calc ? '' : (c as { field: string }).field.toLowerCase()));
    const v = col && row ? row[names.indexOf(col.name) + 1] : null;
    const disabled = rid === null || !editable || dis || !!c.locked;
    if (c.type === 'text' && c.calc) {
      const val = record ? calcValue(c.calc, record) : null;
      return <input key={key} id={single ? idOf(c) : undefined} className="bs-fc" style={style} title={tip} aria-label={c.name} readOnly value={val === null ? '' : String(val)} />;
    }
    if (!col) return <input key={key} className="bs-fc bs-fc-missing" style={style} aria-label={c.name} disabled value="" placeholder={t('(campo no encontrado)')} />;
    const type = col.type.toUpperCase();
    const cur = v === null || v === undefined ? '' : String(v);
    if (c.type === 'check')
      return (
        <label key={key} className="bs-fc bs-fc-check" style={style} title={tip}>
          <input id={single ? idOf(c) : undefined} type="checkbox" disabled={disabled} {...ti} checked={!!Number(v)} onChange={(e) => void commit(rid, col.name, e.target.checked ? '1' : '0', c.afterUpdate)} /> {c.caption}
        </label>
      );
    if (c.type === 'combo') return <Combo key={`${key}:${bump}`} tabStop={c.tabStop !== false} db={db} id={single ? idOf(c) : undefined} c={c} value={v as Value} style={style} disabled={disabled} onPick={(val) => void commit(rid, col.name, val, c.afterUpdate)} />;
    if (c.type === 'list') {
      let options: { value: Value; label: string }[] = [];
      try {
        options = comboOptions(db, c.source);
      } catch {
        options = [];
      }
      return (
        <select key={`${key}:${bump}`} id={single ? idOf(c) : undefined} className="bs-fc bs-fc-list" style={style} title={tip} aria-label={c.name} size={Math.max(2, Math.floor(c.h / 20))} disabled={disabled} {...ti} value={cur} onChange={(e) => void commit(rid, col.name, e.target.value, c.afterUpdate)}>
          {cur !== '' && !options.some((o) => String(o.value) === cur) && <option value={cur}>{cur}</option>}
          {options.map((o, n) => (
            <option key={n} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    if (c.type === 'option')
      return (
        <fieldset key={`${key}:${bump}`} className="bs-fc bs-fc-opt" style={style} title={tip} role="radiogroup" aria-label={c.name} disabled={disabled}>
          {c.caption && <legend>{c.caption}</legend>}
          {c.options.map((o, n) => (
            <label key={n} className="bs-check">
              <input type="radio" name={key} checked={cur === o.value} onChange={() => void commit(rid, col.name, o.value, c.afterUpdate)} /> {o.label}
            </label>
          ))}
        </fieldset>
      );
    const readOnly = c.readOnly || !editable || dis || !!c.locked;
    if (c.type === 'text' && c.multiline)
      return (
        <ProofMemo
          key={`${key}:${rid}:${cur}:${bump}`}
          id={single ? idOf(c) : undefined}
          className="bs-fc bs-fc-memo"
          style={style}
          title={tip}
          aria-label={c.name}
          data-field={col.name}
          readOnly={readOnly}
          disabled={rid === null || dis}
          {...ti}
          initial={cur}
          onBlur={(e) => !readOnly && e.target.value !== cur && void commit(rid, col.name, e.target.value, c.afterUpdate)}
        />
      );
    return (
      <input
        key={`${key}:${rid}:${cur}:${bump}`}
        data-field={col.name}
        {...ti}
        id={single ? idOf(c) : undefined}
        className="bs-fc"
        style={style}
        title={tip}
        aria-label={c.name}
        type={type === 'DATE' ? 'date' : 'text'}
        inputMode={type === 'INTEGER' ? 'numeric' : type === 'REAL' ? 'decimal' : undefined}
        readOnly={readOnly}
        disabled={rid === null || dis}
        defaultValue={cur}
        onBlur={(e) => !readOnly && e.target.value !== cur && void commit(rid, col.name, e.target.value, c.afterUpdate)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    );
  };

  // the records drawn: the current one, or (continuous view) all of them one under the other
  const CONT_MAX = 200;
  const cont = view === 'continuous';
  const shown: Rc[] = cont
    ? (exists && count ? db.browse(def.table, { offset: 0, limit: CONT_MAX, filter, sorts }).rows : []).map((r, k) => ({ row: r, rid: Number(r[0]), record: recordObject(names, r.slice(1)), k }))
    : [{ row, rid, record, k: 0 }];

  if (!exists) return <div className="bs-empty">{t('La tabla ya no existe.')}</div>;
  return (
    <div className="bs-form">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Formulario')}>
        <button type="button" className="bs-btn" onClick={onDesign}>
          {t('Vista Diseño')}
        </button>
        <label>
          {t('Vista')}
          <select aria-label={t('Vista de registros')} value={view} onChange={(e) => setView(e.target.value as typeof view)}>
            <option value="single">{t('Un registro')}</option>
            <option value="continuous">{t('Formularios continuos')}</option>
            <option value="datasheet">{t('Hoja de datos')}</option>
            <option value="split">{t('Formulario dividido')}</option>
          </select>
        </label>
        {layout.caption && <strong>{layout.caption}</strong>}
        <span className="bs-hint">{t('Tabla')}: {def.table}</span>
      </div>
      <div className="bs-formfilter" role="toolbar" aria-label={t('Filtro y orden')}>
        <label>
          {t('Filtro')}
          <input aria-label={t('Filtro de los registros')} value={filterText} placeholder='[Saldo] > 0 Y [Zona] = "Sur"' onChange={(e) => setFilterText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setUserFilter(filterText), setIdx(0))} />
        </label>
        <button type="button" className="bs-btn" onClick={() => (setUserFilter(filterText), setIdx(0))}>
          {t('Aplicar filtro')}
        </button>
        <button type="button" className="bs-btn" disabled={!lastField || rid === null} onClick={() => lastField && record && (setFilterText(selectionFilter(lastField, record)), setUserFilter(selectionFilter(lastField, record)), setIdx(0))}>
          {t('Filtrar por selección')}
        </button>
        <button type="button" className="bs-btn" disabled={!userFilter && !filterText} onClick={() => (setFilterText(''), setUserFilter(''), setIdx(0))}>
          {t('Quitar filtro')}
        </button>
        <label>
          {t('Ordenar por')}
          <select aria-label={t('Ordenar los registros por')} value={userSort?.col ?? ''} onChange={(e) => setUserSort(e.target.value ? { col: e.target.value, desc: userSort?.desc ?? false } : null)}>
            <option value="" />
            {names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button type="button" className="bs-btn" disabled={!userSort} aria-pressed={!!userSort && !userSort.desc} onClick={() => userSort && setUserSort({ ...userSort, desc: false })}>
          {t('Ascendente')}
        </button>
        <button type="button" className="bs-btn" disabled={!userSort} aria-pressed={!!userSort?.desc} onClick={() => userSort && setUserSort({ ...userSort, desc: true })}>
          {t('Descendente')}
        </button>
      </div>
      {layout.navButtons !== false && (
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
          <button type="button" className="bs-btn" disabled={!canAdd} onClick={() => act({ type: 'button', action: 'new' } as Ctl<'button'>)}>
            {t('Nuevo registro')}
          </button>
          <button type="button" className="bs-btn" disabled={rid === null || !canDelete} onClick={() => act({ type: 'button', action: 'delete' } as Ctl<'button'>)}>
            {t('Eliminar registro')}
          </button>
        </div>
      )}
      {(err || filterErr) && (
        <div className="bs-error" role="alert">
          {err ?? filterErr}
        </div>
      )}
      {attachDlg && <AttachmentsDialog ctl={ctl} table={def.table} rid={attachDlg.rid} column={attachDlg.field} onClose={() => setAttachDlg(null)} onChanged={() => setBump((n) => n + 1)} />}
      <div className="bs-formscroll" onFocusCapture={(e) => setLastField((e.target as HTMLElement).dataset.field ?? lastField)}>
        {view !== 'datasheet' && shown.map((rc) => (
          <div
            key={rc.k}
            className={`bs-formcanvas${cont ? ' bs-formrec' : ''}${cont && rc.k === i ? ' is-current' : ''}`}
            role="group"
            aria-label={cont ? `${tab.name} ${rc.k + 1}` : tab.name}
            aria-current={cont && rc.k === i ? 'true' : undefined}
            style={{ width: layout.width, height: layout.height, background: layout.background }}
            onFocusCapture={cont ? () => rc.k !== i && setIdx(rc.k) : undefined}
            onMouseDownCapture={cont ? () => rc.k !== i && setIdx(rc.k) : undefined}
          >
            {layout.controls.map((c) => control(c, rc))}
          </div>
        ))}
        {view === 'datasheet' || view === 'split' ? (
          <FormSheet db={db} table={def.table} columns={sheetColumns(layout, names)} filter={filter} sorts={sorts} current={i} editable={editable} bump={bump} onSelect={setIdx} onCommit={(r, f, v) => void commit(r, f, v)} split={view === 'split'} />
        ) : null}
        {!row && view !== 'datasheet' && <div className="bs-formempty">{t('Esta tabla no tiene registros.')}</div>}
        {cont && count > CONT_MAX && <p className="bs-hint">{t('Se muestran los primeros {n} registros; use la vista de un registro para el resto.', { n: CONT_MAX })}</p>}
      </div>
    </div>
  );
}

function Combo({ db, id, c, value, style, disabled, onPick, tabStop = true }: { db: BaseDb; tabStop?: boolean; id?: string; c: Ctl<'combo'>; value: Value; style: React.CSSProperties; disabled: boolean; onPick: (v: string) => void }) {
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
    <select id={id} className="bs-fc" style={style} aria-label={c.name} disabled={disabled} tabIndex={tabStop ? undefined : -1} value={cur} onChange={(e) => onPick(e.target.value)}>
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
  const [open, setOpen] = useState<Set<number>>(new Set());
  const addValues = (): Record<string, Value> | null => {
    const vals: Record<string, Value> = {};
    for (const l of [{ child: c.childField, parent: c.parentField }, ...(c.extraLinks ?? [])]) {
      const k = record ? Object.keys(record).find((x) => x.toLowerCase() === l.parent.toLowerCase()) : undefined;
      const v = k === undefined ? null : record![k];
      if (v === null || v === undefined) return null;
      vals[l.child] = v;
    }
    return vals;
  };
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
              {c.nested && (
                <th scope="col">
                  <span className="bs-sr">{t('Segundo nivel')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.flatMap((r) => [
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
                {c.nested && (
                  <td>
                    <button type="button" className="bs-btn" aria-expanded={open.has(Number(r[0]))} aria-label={t('Segundo nivel del registro {n}', { n: String(r[0]) })} onClick={() => setOpen((o) => { const n = new Set(o); n.has(Number(r[0])) ? n.delete(Number(r[0])) : n.add(Number(r[0])); return n; })}>
                      {open.has(Number(r[0])) ? '▾' : '▸'}
                    </button>
                  </td>
                )}
              </tr>,
              ...(c.nested && open.has(Number(r[0])) ? [<NestedRows key={`${r[0]}:n`} ctl={ctl} c={c} subRow={recordObject(data.columns, r.slice(1))} span={data.columns.length + 2} onError={onError} />] : []),
            ])}
          </tbody>
        </table>
      </div>
      <button type="button" className="bs-btn" disabled={parent === null || parent === undefined || addValues() === null} onClick={() => run(() => db.insertRow(c.table, addValues() ?? {}))}>
        {t('Agregar registro')}
      </button>
    </div>
  );
}

/** `[Campo] = valor` for the value the record has now (what "filter by selection" uses). */
function selectionFilter(field: string, record: Record<string, Value>): string {
  const k = Object.keys(record).find((x) => x.toLowerCase() === field.toLowerCase());
  const v = k === undefined ? null : record[k];
  if (v === null || v === undefined || v === '') return `[${field}] Is Null`;
  if (typeof v === 'number') return `[${field}] = ${v}`;
  return `[${field}] = "${String(v).replace(/"/g, '""')}"`;
}

/** The columns a datasheet of the form shows: the fields of its bound controls in order, or all of them. */
function sheetColumns(layout: FormLayout, all: string[]): string[] {
  const out: string[] = [];
  for (const c of layout.controls) {
    const f = c.type === 'hyperlink' ? undefined : (c as { field?: string }).field;
    const n = f ? all.find((x) => x.toLowerCase() === f.toLowerCase()) : undefined;
    if (n && !out.includes(n)) out.push(n);
  }
  return out.length ? out : all;
}

/** The records of a form as a grid (datasheet view, or the lower half of a split form). */
function FormSheet({ db, table, columns, filter, sorts, current, editable, bump, onSelect, onCommit, split }: { db: BaseDb; table: string; columns: string[]; filter?: string; sorts: SortKey[]; current: number; editable: boolean; bump: number; onSelect: (k: number) => void; onCommit: (rid: number, field: string, v: string) => void; split: boolean }) {
  const all = db.columns(table).map((c) => c.name);
  const r = db.browse(table, { offset: 0, limit: 500, filter, sorts });
  return (
    <div className={`bs-fsheet${split ? ' is-split' : ''}`} role="group" aria-label={t('Hoja de datos del formulario')}>
      <table>
        <thead>
          <tr>
            {columns.map((n) => (
              <th key={n} scope="col">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {r.rows.map((row, k) => (
            <tr key={String(row[0])} className={k === current ? 'is-current' : undefined} aria-current={k === current ? 'true' : undefined} onMouseDownCapture={() => k !== current && onSelect(k)}>
              {columns.map((n) => {
                const v = row[all.indexOf(n) + 1];
                const cur = v === null || v === undefined || v instanceof Uint8Array ? '' : String(v);
                return (
                  <td key={n}>
                    <input
                      aria-label={`${n} ${k + 1}`}
                      key={`${row[0]}:${cur}:${bump}`}
                      defaultValue={cur}
                      readOnly={!editable}
                      onFocus={() => k !== current && onSelect(k)}
                      onBlur={(e) => editable && e.target.value !== cur && onCommit(Number(row[0]), n, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The second level of a subform: the rows linked to one row of the subform, editable. */
function NestedRows({ ctl, c, subRow, span, onError }: { ctl: BaseCtl; c: Ctl<'subform'>; subRow: ReturnType<typeof recordObject>; span: number; onError: (m: string | null) => void }) {
  const db = ctl.db!;
  const n = c.nested!;
  const data = nestedData(db, c, subRow);
  const k = Object.keys(subRow).find((x) => x.toLowerCase() === n.parentField.toLowerCase());
  const link = k === undefined ? null : subRow[k];
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
    <tr className="bs-nested">
      <td colSpan={span}>
        <table aria-label={t('Segundo nivel de {t}', { t: n.table })}>
          <thead>
            <tr>
              {data.columns.map((x) => (
                <th key={x} scope="col">
                  {x}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={String(r[0])}>
                {data.columns.map((x, j) => (
                  <td key={x}>
                    <input aria-label={`${n.table} ${x} ${String(r[0])}`} key={`${r[0]}:${String(r[j + 1])}`} defaultValue={r[j + 1] === null || r[j + 1] === undefined ? '' : String(r[j + 1])} onBlur={(e) => e.target.value !== String(r[j + 1] ?? '') && run(() => db.updateCell(n.table, Number(r[0]), x, e.target.value))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                  </td>
                ))}
                <td>
                  <button type="button" className="bs-btn" aria-label={t('Quitar el registro {n}', { n: `${n.table} ${String(r[0])}` })} onClick={() => run(() => db.deleteRows(n.table, [Number(r[0])]))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="bs-btn" disabled={link === null || link === undefined} onClick={() => run(() => db.insertRow(n.table, { [n.childField]: link }))}>
          {t('Agregar a {t}', { t: n.table })}
        </button>
      </td>
    </tr>
  );
}
