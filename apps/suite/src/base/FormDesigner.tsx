import {
  FORM_ACTIONS,
  addControl,
  bringToFront,
  controlForColumn,
  newControl,
  normalizeBox,
  removeControl,
  sendToBack,
  updateControl,
  validateLayout,
  type ColumnDef,
  type ControlType,
  type FormAction,
  type FormControl,
  type FormLayout,
  type Handler,
} from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { DesignCanvas, pushHistory, type CanvasItem } from './DesignCanvas';
import type { BaseCtl, FormDef, Tab } from './ctl';

const TYPE_LABEL: Record<ControlType, string> = { label: 'Etiqueta', text: 'Cuadro de texto', check: 'Casilla', combo: 'Lista desplegable', button: 'Botón', subform: 'Subformulario' };
const ACTION_LABEL: Record<FormAction, string> = { new: 'Registro nuevo', delete: 'Eliminar registro', first: 'Primer registro', previous: 'Registro anterior', next: 'Registro siguiente', last: 'Último registro', run: 'Ejecutar macro o procedimiento' };

/** Handler as one string for a select: `macro:Name` or `proc:Name`. */
const hv = (h?: Handler) => (h ? `${h.kind}:${h.name}` : '');
const parseH = (v: string): Handler | undefined => {
  const i = v.indexOf(':');
  return v ? { kind: v.slice(0, i) as Handler['kind'], name: v.slice(i + 1) } : undefined;
};

function HandlerSelect({ ctl, label, value, onChange }: { ctl: BaseCtl; label: string; value?: Handler; onChange: (h: Handler | undefined) => void }) {
  const macros = ctl.db!.objects('macro');
  const procs = ctl.procedureNames();
  const cur = hv(value);
  const known = !value || macros.includes(value.name) || procs.includes(value.name);
  return (
    <label>
      {label}
      <select aria-label={label} value={cur} onChange={(e) => onChange(parseH(e.target.value))}>
        <option value="">{t('(ninguno)')}</option>
        {!known && <option value={cur}>{`${value!.name} ${t('(no existe)')}`}</option>}
        {macros.length > 0 && (
          <optgroup label={t('Macros')}>
            {macros.map((m) => (
              <option key={m} value={`macro:${m}`}>
                {m}
              </option>
            ))}
          </optgroup>
        )}
        {procs.length > 0 && (
          <optgroup label={t('Procedimientos')}>
            {procs.map((p) => (
              <option key={p} value={`proc:${p}`}>
                {p}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </label>
  );
}

/** Form design view: drag controls onto the form, size them, bind them to fields and set their properties. */
export function FormDesigner({ ctl, tab, def, onClose }: { ctl: BaseCtl; tab: Tab; def: FormDef & { layout: FormLayout }; onClose: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const layout = def.layout;
  const [sel, setSel] = useState<string | null>(null);
  const [past, setPast] = useState<FormLayout[]>([]);
  const [future, setFuture] = useState<FormLayout[]>([]);
  const exists = db.tableNames().includes(def.table);
  const cols: ColumnDef[] = exists ? db.columns(def.table) : [];
  const tables = db.tableNames();
  const control = layout.controls.find((c) => c.id === sel) ?? null;
  const warnings = useMemo(() => validateLayout(layout, db, def.table), [layout, db, def.table, ctl.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: FormLayout, record = true) => {
    if (next === layout) return;
    if (record) {
      setPast((p) => pushHistory(p, layout));
      setFuture([]);
    }
    ctl.saveForm(tab.id, { ...def, layout: next });
  };
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([layout, ...future]);
    ctl.saveForm(tab.id, { ...def, layout: prev });
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast(pushHistory(past, layout));
    ctl.saveForm(tab.id, { ...def, layout: next });
  };

  const add = (type: ControlType) => {
    const c = newControl(layout, type);
    commit(addControl(layout, c));
    setSel(c.id);
  };
  /** A label and a control for a field, like dragging it from the field list in Access. */
  const addField = (col: ColumnDef) => {
    let l = layout;
    const bottom = l.controls.reduce((m, c) => Math.max(m, c.y + c.h), 0);
    const y = l.controls.length ? bottom + 8 : 16;
    const label = newControl(l, 'label', { text: col.name, w: 136 }, { x: 16, y });
    l = addControl(l, label);
    const body = controlForColumn(col, db);
    const c = newControl(l, body.type, { ...body, w: 288 }, { x: 160, y });
    l = addControl(l, c);
    commit(l);
    setSel(c.id);
  };
  const patch = (p: object) => control && commit(updateControl(layout, control.id, p));
  const remove = (id: string) => {
    commit(removeControl(layout, id));
    setSel(null);
  };

  const items: CanvasItem[] = layout.controls.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, label: `${t(TYPE_LABEL[c.type])} ${c.name}` }));
  const preview = (it: CanvasItem) => {
    const c = layout.controls.find((x) => x.id === it.id)!;
    switch (c.type) {
      case 'label':
        return <span style={{ fontWeight: c.bold ? 700 : undefined, fontSize: c.size }}>{c.text}</span>;
      case 'button':
        return <span className="bs-cv-btn">{c.caption}</span>;
      case 'check':
        return <span>☐ {c.caption || c.field}</span>;
      case 'combo':
        return <span className="bs-cv-field">{c.field || t('(sin campo)')} ▾</span>;
      case 'subform':
        return <span className="bs-cv-sub">▦ {c.table || t('(sin tabla)')}</span>;
      default:
        return <span className="bs-cv-field">{c.calc ? c.calc : c.field || t('(sin campo)')}</span>;
    }
  };

  const num = (label: string, key: 'x' | 'y' | 'w' | 'h') => (
    <label key={key}>
      {label}
      <input
        type="number"
        aria-label={label}
        value={control![key]}
        onChange={(e) => {
          const b = normalizeBox({ x: control!.x, y: control!.y, w: control!.w, h: control!.h, [key]: Number(e.target.value) || 0 }, { grid: 0 });
          patch(b);
        }}
      />
    </label>
  );

  const fieldSelect = (c: Extract<FormControl, { field: string }>) => (
    <label>
      {t('Campo')}
      <select aria-label={t('Campo del control')} value={c.field} onChange={(e) => patch({ field: e.target.value })}>
        <option value="" />
        {c.field && !cols.some((x) => x.name === c.field) && <option value={c.field}>{`${c.field} ${t('(no existe)')}`}</option>}
        {cols.map((x) => (
          <option key={x.name}>{x.name}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="bs-fdesign">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Diseño del formulario')}>
        <button type="button" className="bs-btn" onClick={onClose}>
          {t('Vista Formulario')}
        </button>
        <button type="button" className="bs-btn" disabled={!past.length} onClick={undo}>
          {t('Deshacer el diseño')}
        </button>
        <button type="button" className="bs-btn" disabled={!future.length} onClick={redo}>
          {t('Rehacer el diseño')}
        </button>
        <span className="bs-sep" aria-hidden="true" />
        {(Object.keys(TYPE_LABEL) as ControlType[]).map((k) => (
          <button key={k} type="button" className="bs-btn" onClick={() => add(k)}>
            {t(TYPE_LABEL[k])}
          </button>
        ))}
        <span className="bs-sep" aria-hidden="true" />
        <button type="button" className="bs-btn" disabled={!control} onClick={() => control && commit(bringToFront(layout, control.id))}>
          {t('Traer al frente')}
        </button>
        <button type="button" className="bs-btn" disabled={!control} onClick={() => control && commit(sendToBack(layout, control.id))}>
          {t('Enviar al fondo')}
        </button>
        <button type="button" className="bs-btn" disabled={!control} onClick={() => control && remove(control.id)}>
          {t('Eliminar control')}
        </button>
        <label>
          {t('Tabla')}
          <select
            aria-label={t('Tabla del formulario')}
            value={def.table}
            onChange={(e) => {
              if (layout.controls.length && !window.confirm(t('Cambiar la tabla deja sin campo a los controles que no existan en la nueva. ¿Continuar?'))) return;
              ctl.saveForm(tab.id, { ...def, table: e.target.value });
            }}
          >
            {tables.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="bs-fdbody">
        <aside className="bs-fields-pane" aria-label={t('Campos de la tabla')}>
          <h3>{t('Campos de la tabla')}</h3>
          <p className="bs-hint">{t('Pulse un campo para agregarlo con su etiqueta.')}</p>
          <ul>
            {cols.map((c) => (
              <li key={c.name}>
                <button type="button" onClick={() => addField(c)}>
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="bs-fdscroll">
          <div className="bs-fdcanvas" style={{ width: layout.width, height: layout.height }}>
            <DesignCanvas ariaLabel={t('Superficie del formulario')} width={layout.width} height={layout.height} items={items} selected={sel} onSelect={setSel} onChange={(id, box) => commit(updateControl(layout, id, box))} onDelete={remove} render={preview} />
          </div>
        </div>
        <aside className="bs-props" aria-label={t('Propiedades')}>
          <h3>{t('Propiedades')}</h3>
          {!control && (
            <fieldset className="bs-relcfg">
              <legend>{t('Formulario')}</legend>
              <HandlerSelect ctl={ctl} label={t('Al abrir')} value={layout.events?.onOpen} onChange={(h) => commit({ ...layout, events: { ...layout.events, onOpen: h } })} />
              <HandlerSelect ctl={ctl} label={t('Al cambiar de registro')} value={layout.events?.onCurrent} onChange={(h) => commit({ ...layout, events: { ...layout.events, onCurrent: h } })} />
              <p className="bs-hint">{t('Seleccione un control para ver sus propiedades.')}</p>
            </fieldset>
          )}
          {control && (
            <fieldset className="bs-relcfg">
              <legend>
                {t(TYPE_LABEL[control.type])}: {control.name}
              </legend>
              <label>
                {t('Nombre')}
                <input aria-label={t('Nombre del control')} value={control.name} onChange={(e) => patch({ name: e.target.value })} />
              </label>
              <div className="bs-propgrid">
                {num(t('Izquierda'), 'x')}
                {num(t('Arriba'), 'y')}
                {num(t('Ancho'), 'w')}
                {num(t('Alto'), 'h')}
              </div>
              {control.type === 'label' && (
                <>
                  <label>
                    {t('Texto')}
                    <input aria-label={t('Texto de la etiqueta')} value={control.text} onChange={(e) => patch({ text: e.target.value })} />
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={!!control.bold} onChange={(e) => patch({ bold: e.target.checked })} /> {t('Negrita')}
                  </label>
                </>
              )}
              {control.type === 'text' && (
                <>
                  {fieldSelect(control)}
                  <label>
                    {t('Expresión calculada')}
                    <input aria-label={t('Expresión calculada')} value={control.calc ?? ''} placeholder="=[Precio] * [Cantidad]" onChange={(e) => patch({ calc: e.target.value || undefined, readOnly: e.target.value ? true : control.readOnly })} />
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={!!control.readOnly} onChange={(e) => patch({ readOnly: e.target.checked })} /> {t('Solo lectura')}
                  </label>
                  <HandlerSelect ctl={ctl} label={t('Después de actualizar')} value={control.afterUpdate} onChange={(h) => patch({ afterUpdate: h })} />
                </>
              )}
              {control.type === 'check' && (
                <>
                  {fieldSelect(control)}
                  <label>
                    {t('Título')}
                    <input aria-label={t('Título de la casilla')} value={control.caption ?? ''} onChange={(e) => patch({ caption: e.target.value })} />
                  </label>
                  <HandlerSelect ctl={ctl} label={t('Después de actualizar')} value={control.afterUpdate} onChange={(h) => patch({ afterUpdate: h })} />
                </>
              )}
              {control.type === 'combo' && (
                <>
                  {fieldSelect(control)}
                  <label>
                    {t('Origen de la lista')}
                    <select
                      aria-label={t('Origen de la lista')}
                      value={control.source.kind}
                      onChange={(e) =>
                        patch({ source: e.target.value === 'values' ? { kind: 'values', values: ['Opción 1', 'Opción 2'] } : { kind: 'table', table: tables[0] ?? '', valueField: '', displayField: '' } })
                      }
                    >
                      <option value="values">{t('Lista de valores')}</option>
                      <option value="table">{t('Tabla')}</option>
                    </select>
                  </label>
                  {control.source.kind === 'values' ? (
                    <label>
                      {t('Valores (uno por línea)')}
                      <textarea aria-label={t('Valores de la lista')} rows={4} value={control.source.values.join('\n')} onChange={(e) => patch({ source: { kind: 'values', values: e.target.value.split('\n') } })} />
                    </label>
                  ) : (
                    <>
                      <label>
                        {t('Tabla de la lista')}
                        <select aria-label={t('Tabla de la lista')} value={control.source.table} onChange={(e) => patch({ source: { kind: 'table', table: e.target.value, valueField: '', displayField: '' } })}>
                          {tables.map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      {(['valueField', 'displayField'] as const).map((k) => {
                        const src = control.source as Extract<FormControl & { type: 'combo' }, { type: 'combo' }>['source'] & { kind: 'table' };
                        const tc = tables.includes(src.table) ? db.columns(src.table).map((x) => x.name) : [];
                        return (
                          <label key={k}>
                            {k === 'valueField' ? t('Campo que se guarda') : t('Campo que se muestra')}
                            <select aria-label={k === 'valueField' ? t('Campo que se guarda') : t('Campo que se muestra')} value={src[k]} onChange={(e) => patch({ source: { ...src, [k]: e.target.value } })}>
                              <option value="" />
                              {tc.map((n) => (
                                <option key={n}>{n}</option>
                              ))}
                            </select>
                          </label>
                        );
                      })}
                    </>
                  )}
                  <label className="bs-row">
                    <input type="checkbox" checked={!!control.limitToList} onChange={(e) => patch({ limitToList: e.target.checked })} /> {t('Limitar a la lista')}
                  </label>
                  <HandlerSelect ctl={ctl} label={t('Después de actualizar')} value={control.afterUpdate} onChange={(h) => patch({ afterUpdate: h })} />
                </>
              )}
              {control.type === 'button' && (
                <>
                  <label>
                    {t('Título')}
                    <input aria-label={t('Título del botón')} value={control.caption} onChange={(e) => patch({ caption: e.target.value })} />
                  </label>
                  <label>
                    {t('Acción')}
                    <select aria-label={t('Acción del botón')} value={control.action} onChange={(e) => patch({ action: e.target.value })}>
                      {FORM_ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {t(ACTION_LABEL[a])}
                        </option>
                      ))}
                    </select>
                  </label>
                  {control.action === 'run' && <HandlerSelect ctl={ctl} label={t('Al hacer clic')} value={control.handler} onChange={(h) => patch({ handler: h })} />}
                </>
              )}
              {control.type === 'subform' && (
                <>
                  <label>
                    {t('Tabla del subformulario')}
                    <select aria-label={t('Tabla del subformulario')} value={control.table} onChange={(e) => patch({ table: e.target.value, childField: '', columns: undefined })}>
                      <option value="" />
                      {tables.map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Campo vinculado (secundario)')}
                    <select aria-label={t('Campo vinculado secundario')} value={control.childField} onChange={(e) => patch({ childField: e.target.value })}>
                      <option value="" />
                      {(tables.includes(control.table) ? db.columns(control.table) : []).map((x) => (
                        <option key={x.name}>{x.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t('Campo vinculado (principal)')}
                    <select aria-label={t('Campo vinculado principal')} value={control.parentField} onChange={(e) => patch({ parentField: e.target.value })}>
                      <option value="" />
                      {cols.map((x) => (
                        <option key={x.name}>{x.name}</option>
                      ))}
                    </select>
                  </label>
                  <fieldset>
                    <legend>{t('Columnas que se muestran')}</legend>
                    {(tables.includes(control.table) ? db.columns(control.table) : []).map((x) => {
                      const all = db.columns(control.table).map((y) => y.name);
                      const cur = control.columns ?? all;
                      return (
                        <label key={x.name} className="bs-row">
                          <input
                            type="checkbox"
                            checked={cur.includes(x.name)}
                            onChange={(e) => {
                              const next = all.filter((n) => (n === x.name ? e.target.checked : cur.includes(n)));
                              patch({ columns: next.length === all.length ? undefined : next });
                            }}
                          />{' '}
                          {x.name}
                        </label>
                      );
                    })}
                  </fieldset>
                </>
              )}
            </fieldset>
          )}
          {warnings.length > 0 && (
            <div className="bs-warn" role="status" aria-label={t('Avisos del diseño')}>
              <strong>{t('Avisos')}</strong>
              <ul>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
      <p className="bs-hint">{t('Arrastre los controles; con el teclado, las flechas los mueven (Mayús+flechas cambian el tamaño, Alt+flechas mueven de 1 en 1, Supr elimina).')}</p>
    </div>
  );
}
