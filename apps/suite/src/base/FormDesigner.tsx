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
  validateFormSettings,
  validateLayout,
  tabOrder,
  type ColumnDef,
  type CondRule,
  type ControlType,
  type FormAction,
  type FormControl,
  type FormLayout,
  type Handler,
} from '@suitenova/base-core';
import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { DesignCanvas, pushHistory, type CanvasItem } from './DesignCanvas';
import { ExprBuilderButton } from './ExprBuilder';
import { Dlg } from './dlg-sheet';
import { MacroStepsEditor } from './MacroStepsEditor';
import type { BaseCtl, FormDef, Tab } from './ctl';

const TYPE_LABEL: Record<ControlType, string> = { label: 'Etiqueta', text: 'Cuadro de texto', check: 'Casilla', combo: 'Lista desplegable', list: 'Cuadro de lista', option: 'Grupo de opciones', button: 'Botón', subform: 'Subformulario', tabs: 'Pestañas', image: 'Imagen', hyperlink: 'Hipervínculo', line: 'Línea', rect: 'Rectángulo', attachment: 'Datos adjuntos' };
const ACTION_LABEL: Record<FormAction, string> = { new: 'Registro nuevo', delete: 'Eliminar registro', first: 'Primer registro', previous: 'Registro anterior', next: 'Registro siguiente', last: 'Último registro', run: 'Ejecutar macro o procedimiento' };

/** Handler as one string for a select: `macro:Name`, `proc:Name` or `embedded:`. */
const hv = (h?: Handler) => (h ? `${h.kind}:${h.kind === 'embedded' ? '' : h.name}` : '');
const parseH = (v: string): Handler | undefined => {
  const i = v.indexOf(':');
  return v ? { kind: v.slice(0, i) as Handler['kind'], name: v.slice(i + 1) } : undefined;
};

function HandlerSelect({ ctl, label, value, onChange }: { ctl: BaseCtl; label: string; value?: Handler; onChange: (h: Handler | undefined) => void }) {
  const macros = ctl.db!.objects('macro');
  const procs = ctl.procedureNames();
  const cur = hv(value);
  const known = !value || value.kind === 'embedded' || macros.includes(value.name) || procs.includes(value.name);
  const [editing, setEditing] = useState(false);
  return (
    <label>
      {label}
      <select aria-label={label} value={cur} onChange={(e) => onChange(e.target.value === 'embedded:' ? (value?.kind === 'embedded' ? value : { kind: 'embedded', name: '', macro: { steps: [] } }) : parseH(e.target.value))}>
        <option value="">{t('(ninguno)')}</option>
        <option value="embedded:">{t('(macro incrustada)')}</option>
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
      {value?.kind === 'embedded' && (
        <>
          <button type="button" className="bs-btn" aria-label={t('Editar la macro incrustada de {label}', { label })} onClick={() => setEditing(true)}>
            {t('Editar la macro incrustada…')} {value.macro?.steps.length ? `(${value.macro.steps.length})` : ''}
          </button>
          {editing && (
            <Dlg title={`${t('Macro incrustada')}: ${label}`} onClose={() => setEditing(false)} actions={<Button appearance="primary" onClick={() => setEditing(false)}>{t('Cerrar')}</Button>}>
              <MacroStepsEditor ctl={ctl} def={value.macro ?? { steps: [] }} onChange={(m) => onChange({ ...value, macro: m })} />
            </Dlg>
          )}
        </>
      )}
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
  const warnings = useMemo(() => [...validateLayout(layout, db, def.table), ...validateFormSettings(layout, db, def.table)], [layout, db, def.table, ctl.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const swapTab = (id: string, delta: -1 | 1) => {
    const order = tabOrder(layout);
    const i = order.findIndex((c) => c.id === id);
    const other = order[i + delta];
    if (!other) return;
    commit({ ...layout, controls: layout.controls.map((c) => (c.id === id ? other : c.id === other.id ? order[i]! : c)) });
  };

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
      case 'list':
        return <span className="bs-cv-field">☰ {c.field || t('(sin campo)')}</span>;
      case 'option':
        return (
          <span className="bs-cv-opt">
            <b>{c.caption}</b>
            {c.options.slice(0, 4).map((o) => (
              <span key={o.value}>◯ {o.label}</span>
            ))}
          </span>
        );
      case 'image':
        return c.src ? <img src={c.src} alt={c.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: c.mode === 'stretch' ? 'fill' : c.mode === 'clip' ? 'none' : 'contain' }} /> : <span className="bs-cv-field">🖼 {t('(sin imagen)')}</span>;
      case 'line':
        return <span style={{ display: 'block', borderTop: `${c.thickness ?? 1}px solid ${c.color || '#808080'}`, marginTop: Math.max(0, c.h / 2 - 1) }} />;
      case 'rect':
        return <span style={{ display: 'block', width: '100%', height: '100%', background: c.fill || 'transparent', border: `1px solid ${c.border || '#808080'}`, boxSizing: 'border-box' }} />;
      case 'hyperlink':
        return <span className="bs-link">{c.text}</span>;
      case 'tabs':
        return (
          <span className="bs-cv-tabs">
            {c.pages.map((p, k) => (
              <i key={k}>{p}</i>
            ))}
          </span>
        );
      case 'attachment':
        return <span className="bs-cv-field">📎 {c.caption || t('Datos adjuntos')} [{c.field || t('(sin campo)')}]</span>;
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
              <label>
                {t('Título')}
                <input aria-label={t('Título del formulario')} value={layout.caption ?? ''} onChange={(e) => commit({ ...layout, caption: e.target.value || undefined })} />
              </label>
              <label>
                {t('Vista predeterminada')}
                <select aria-label={t('Vista del formulario')} value={layout.view ?? 'single'} onChange={(e) => commit({ ...layout, view: e.target.value === 'single' ? undefined : (e.target.value as FormLayout['view']) })}>
                  <option value="single">{t('Un registro')}</option>
                  <option value="continuous">{t('Formularios continuos')}</option>
                  <option value="datasheet">{t('Hoja de datos')}</option>
                  <option value="split">{t('Formulario dividido')}</option>
                </select>
              </label>
              <label>
                {t('Color de fondo')}
                <input type="color" aria-label={t('Color de fondo del formulario')} value={layout.background || '#ffffff'} onChange={(e) => commit({ ...layout, background: e.target.value })} />
              </label>
              {([['allowEdits', 'Permitir modificaciones'], ['allowAdditions', 'Permitir agregar'], ['allowDeletions', 'Permitir eliminar'], ['navButtons', 'Botones de desplazamiento']] as const).map(([k, label]) => (
                <label key={k} className="bs-row">
                  <input type="checkbox" checked={layout[k] !== false} onChange={(e) => commit({ ...layout, [k]: e.target.checked ? undefined : false })} /> {t(label)}
                </label>
              ))}
              <HandlerSelect ctl={ctl} label={t('Antes de actualizar')} value={layout.events?.beforeUpdate} onChange={(h) => commit({ ...layout, events: { ...layout.events, beforeUpdate: h } })} />
              <HandlerSelect ctl={ctl} label={t('Al cerrar')} value={layout.events?.onClose} onChange={(h) => commit({ ...layout, events: { ...layout.events, onClose: h } })} />
              <HandlerSelect ctl={ctl} label={t('Al temporizador')} value={layout.events?.onTimer} onChange={(h) => commit({ ...layout, events: { ...layout.events, onTimer: h }, ...(h && !layout.timerInterval ? { timerInterval: 1000 } : {}) })} />
              {layout.events?.onTimer && (
                <label>
                  {t('Intervalo del temporizador (ms)')}
                  <input type="number" min={250} step={250} aria-label={t('Intervalo del temporizador')} value={layout.timerInterval ?? 1000} onChange={(e) => commit({ ...layout, timerInterval: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
              )}
              <fieldset className="bs-relcfg">
                <legend>{t('Datos del formulario')}</legend>
                <label>
                  {t('Filtro')}
                  <input aria-label={t('Filtro del formulario')} value={layout.filter ?? ''} placeholder='[Estado] = "Abierto"' onChange={(e) => commit({ ...layout, filter: e.target.value || undefined })} />
                </label>
                {(layout.orderBy ?? []).map((o, k) => (
                  <div key={o.field} className="bs-grouprow">
                    <strong>{o.field}</strong>
                    <label className="bs-chk">
                      <input type="checkbox" aria-label={t('Orden descendente de {f}', { f: o.field })} checked={!!o.desc} onChange={(e) => commit({ ...layout, orderBy: (layout.orderBy ?? []).map((x, j) => (j === k ? { ...x, desc: e.target.checked } : x)) })} /> {t('Descendente')}
                    </label>
                    <button type="button" className="bs-btn" aria-label={t('Quitar el orden por {f}', { f: o.field })} onClick={() => commit({ ...layout, orderBy: (layout.orderBy ?? []).filter((_, j) => j !== k) || undefined })}>
                      ×
                    </button>
                  </div>
                ))}
                <select aria-label={t('Agregar orden del formulario')} value="" onChange={(e) => e.target.value && commit({ ...layout, orderBy: [...(layout.orderBy ?? []), { field: e.target.value }] })}>
                  <option value="">{t('Ordenar por…')}</option>
                  {cols.filter((c) => !(layout.orderBy ?? []).some((o) => o.field === c.name)).map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
              </fieldset>
              <fieldset className="bs-relcfg">
                <legend>{t('Teclas de acceso')}</legend>
                {(layout.keys ?? []).map((k, j) => (
                  <div key={j} className="bs-keyrow" role="group" aria-label={t('Tecla {n}', { n: j + 1 })}>
                    <input aria-label={t('Atajo {n}', { n: j + 1 })} value={k.key} placeholder="Ctrl+S" onChange={(e) => commit({ ...layout, keys: (layout.keys ?? []).map((x, i) => (i === j ? { ...x, key: e.target.value } : x)) })} />
                    <HandlerSelect ctl={ctl} label={t('Ejecutar {n}', { n: j + 1 })} value={k.handler.name ? k.handler : undefined} onChange={(h) => commit({ ...layout, keys: (layout.keys ?? []).map((x, i) => (i === j ? { ...x, handler: h ?? { kind: 'macro', name: '' } } : x)) })} />
                    <button type="button" className="bs-btn" aria-label={t('Quitar la tecla {n}', { n: j + 1 })} onClick={() => commit({ ...layout, keys: (layout.keys ?? []).filter((_, i) => i !== j) })}>
                      ×
                    </button>
                  </div>
                ))}
                <button type="button" className="bs-btn" onClick={() => commit({ ...layout, keys: [...(layout.keys ?? []), { key: 'F5', handler: { kind: 'macro', name: '' } }] })}>
                  {t('Agregar tecla')}
                </button>
              </fieldset>
              <fieldset className="bs-relcfg">
                <legend>{t('Orden de tabulación')}</legend>
                <ol className="bs-taborder" aria-label={t('Orden de tabulación')}>
                  {tabOrder(layout).map((c) => (
                    <li key={c.id}>
                      <button type="button" className="bs-linkbtn" onClick={() => setSel(c.id)}>
                        {c.name}
                      </button>
                      <button type="button" className="bs-btn" aria-label={t('Subir {n}', { n: c.name })} onClick={() => swapTab(c.id, -1)}>
                        ↑
                      </button>
                      <button type="button" className="bs-btn" aria-label={t('Bajar {n}', { n: c.name })} onClick={() => swapTab(c.id, 1)}>
                        ↓
                      </button>
                    </li>
                  ))}
                </ol>
              </fieldset>
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
                    <ExprBuilderButton fields={cols.map((c) => c.name)} value={(control.calc ?? '').replace(/^=/, '')} onApply={(v) => patch({ calc: v ? `=${v}` : undefined, readOnly: v ? true : control.readOnly })} label={t('Generador del cuadro calculado')} />
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={!!control.readOnly} onChange={(e) => patch({ readOnly: e.target.checked })} /> {t('Solo lectura')}
                  </label>
                  <HandlerSelect ctl={ctl} label={t('Después de actualizar')} value={control.afterUpdate} onChange={(h) => patch({ afterUpdate: h })} />
                </>
              )}
              {control.type === 'attachment' && (
                <>
                  {fieldSelect(control)}
                  <label>
                    {t('Título')}
                    <input aria-label={t('Título del botón de adjuntos')} value={control.caption ?? ''} onChange={(e) => patch({ caption: e.target.value })} />
                  </label>
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
              {(control.type === 'combo' || control.type === 'list') && (
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
                  {control.type === 'combo' && (
                    <label className="bs-row">
                      <input type="checkbox" checked={!!control.limitToList} onChange={(e) => patch({ limitToList: e.target.checked })} /> {t('Limitar a la lista')}
                    </label>
                  )}
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
              {control.type === 'option' && (
                <>
                  {fieldSelect(control)}
                  <label>
                    {t('Título del grupo')}
                    <input aria-label={t('Título del grupo')} value={control.caption ?? ''} onChange={(e) => patch({ caption: e.target.value })} />
                  </label>
                  <label>
                    {t('Opciones (una por línea: etiqueta=valor)')}
                    <textarea
                      aria-label={t('Opciones del grupo')}
                      rows={4}
                      value={control.options.map((o) => `${o.label}=${o.value}`).join('\n')}
                      onChange={(e) =>
                        patch({
                          options: e.target.value.split('\n').map((l) => {
                            const i = l.lastIndexOf('=');
                            return i < 0 ? { label: l, value: l } : { label: l.slice(0, i), value: l.slice(i + 1) };
                          }),
                        })
                      }
                    />
                  </label>
                  <HandlerSelect ctl={ctl} label={t('Después de actualizar')} value={control.afterUpdate} onChange={(h) => patch({ afterUpdate: h })} />
                </>
              )}
              {control.type === 'image' && (
                <>
                  <label>
                    {t('Imagen')}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                      aria-label={t('Elegir imagen')}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.size > 1_500_000) return void (ctl.notice = t('La imagen pesa más de 1,5 MB; use una más pequeña.'), ctl.touch());
                        const rd = new FileReader();
                        rd.onload = () => patch({ src: String(rd.result), alt: control.alt || f.name.replace(/\.[^.]+$/, '') });
                        rd.readAsDataURL(f);
                      }}
                    />
                  </label>
                  <label>
                    {t('Ajuste')}
                    <select aria-label={t('Ajuste de la imagen')} value={control.mode} onChange={(e) => patch({ mode: e.target.value })}>
                      <option value="fit">{t('Ajustar sin deformar')}</option>
                      <option value="stretch">{t('Estirar')}</option>
                      <option value="clip">{t('Tamaño real (recortar)')}</option>
                    </select>
                  </label>
                  <label>
                    {t('Texto alternativo')}
                    <input aria-label={t('Texto alternativo de la imagen')} value={control.alt ?? ''} onChange={(e) => patch({ alt: e.target.value })} />
                  </label>
                </>
              )}
              {control.type === 'line' && (
                <>
                  <label>
                    {t('Color')}
                    <input type="color" aria-label={t('Color de la línea')} value={control.color || '#808080'} onChange={(e) => patch({ color: e.target.value })} />
                  </label>
                  <label>
                    {t('Grosor')}
                    <input type="number" min={1} max={12} aria-label={t('Grosor de la línea')} value={control.thickness ?? 1} onChange={(e) => patch({ thickness: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />
                  </label>
                </>
              )}
              {control.type === 'rect' && (
                <>
                  <label>
                    {t('Relleno')}
                    <input type="color" aria-label={t('Relleno del rectángulo')} value={control.fill || '#ffffff'} onChange={(e) => patch({ fill: e.target.value })} />
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={!control.fill} onChange={(e) => patch({ fill: e.target.checked ? '' : '#f3f2f1' })} /> {t('Sin relleno')}
                  </label>
                  <label>
                    {t('Borde')}
                    <input type="color" aria-label={t('Borde del rectángulo')} value={control.border || '#808080'} onChange={(e) => patch({ border: e.target.value })} />
                  </label>
                </>
              )}
              {control.type === 'hyperlink' && (
                <>
                  <label>
                    {t('Texto')}
                    <input aria-label={t('Texto del vínculo')} value={control.text} onChange={(e) => patch({ text: e.target.value })} />
                  </label>
                  <label>
                    {t('Dirección')}
                    <input aria-label={t('Dirección del vínculo')} value={control.url ?? ''} onChange={(e) => patch({ url: e.target.value || undefined })} />
                  </label>
                  <label>
                    {t('o tomarla del campo')}
                    <select aria-label={t('Campo con la dirección')} value={control.field ?? ''} onChange={(e) => patch({ field: e.target.value || undefined })}>
                      <option value="" />
                      {cols.map((x) => (
                        <option key={x.name}>{x.name}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {control.type === 'tabs' && (
                <label>
                  {t('Páginas (una por línea)')}
                  <textarea aria-label={t('Páginas de las pestañas')} rows={4} value={control.pages.join('\n')} onChange={(e) => patch({ pages: e.target.value.split('\n') })} />
                </label>
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
                  {(control.extraLinks ?? []).map((l, k) => (
                    <div key={k} className="bs-keyrow" role="group" aria-label={t('Enlace adicional {n}', { n: k + 1 })}>
                      <select aria-label={t('Campo secundario del enlace {n}', { n: k + 1 })} value={l.child} onChange={(e) => patch({ extraLinks: (control.extraLinks ?? []).map((x, j) => (j === k ? { ...x, child: e.target.value } : x)) })}>
                        <option value="" />
                        {(tables.includes(control.table) ? db.columns(control.table) : []).map((x) => (
                          <option key={x.name}>{x.name}</option>
                        ))}
                      </select>
                      <select aria-label={t('Campo principal del enlace {n}', { n: k + 1 })} value={l.parent} onChange={(e) => patch({ extraLinks: (control.extraLinks ?? []).map((x, j) => (j === k ? { ...x, parent: e.target.value } : x)) })}>
                        <option value="" />
                        {cols.map((x) => (
                          <option key={x.name}>{x.name}</option>
                        ))}
                      </select>
                      <button type="button" className="bs-btn" aria-label={t('Quitar el enlace {n}', { n: k + 1 })} onClick={() => patch({ extraLinks: (control.extraLinks ?? []).filter((_, j) => j !== k) })}>
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" className="bs-btn" onClick={() => patch({ extraLinks: [...(control.extraLinks ?? []), { child: '', parent: '' }] })}>
                    {t('Agregar enlace')}
                  </button>
                  <fieldset>
                    <legend>{t('Segundo nivel')}</legend>
                    <label>
                      {t('Tabla del segundo nivel')}
                      <select aria-label={t('Tabla del segundo nivel')} value={control.nested?.table ?? ''} onChange={(e) => patch({ nested: e.target.value ? { table: e.target.value, childField: '', parentField: control.nested?.parentField ?? '' } : undefined })}>
                        <option value="" />
                        {tables.map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                    {control.nested && (
                      <>
                        <label>
                          {t('Campo vinculado del segundo nivel')}
                          <select aria-label={t('Campo secundario del segundo nivel')} value={control.nested.childField} onChange={(e) => patch({ nested: { ...control.nested!, childField: e.target.value } })}>
                            <option value="" />
                            {(tables.includes(control.nested.table) ? db.columns(control.nested.table) : []).map((x) => (
                              <option key={x.name}>{x.name}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t('Campo del subformulario que lo enlaza')}
                          <select aria-label={t('Campo principal del segundo nivel')} value={control.nested.parentField} onChange={(e) => patch({ nested: { ...control.nested!, parentField: e.target.value } })}>
                            <option value="" />
                            {(tables.includes(control.table) ? db.columns(control.table) : []).map((x) => (
                              <option key={x.name}>{x.name}</option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </fieldset>
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
              <label className="bs-row">
                <input type="checkbox" checked={control.visible !== false} onChange={(e) => patch({ visible: e.target.checked ? undefined : false })} /> {t('Visible')}
              </label>
              <label>
                {t('Texto de ayuda')}
                <input aria-label={t('Texto de ayuda del control')} value={control.tip ?? ''} onChange={(e) => patch({ tip: e.target.value || undefined })} />
              </label>
              {layout.controls.some((x) => x.type === 'tabs' && x.id !== control.id) && (
                <label>
                  {t('Pertenece a la pestaña')}
                  <select
                    aria-label={t('Pestaña del control')}
                    value={control.tab ? `${control.tab.id}:${control.tab.page}` : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      patch({ tab: v ? { id: v.slice(0, v.lastIndexOf(':')), page: Number(v.slice(v.lastIndexOf(':') + 1)) } : undefined });
                    }}
                  >
                    <option value="">{t('(ninguna)')}</option>
                    {layout.controls.flatMap((x) => (x.type === 'tabs' && x.id !== control.id ? x.pages.map((p, k) => <option key={`${x.id}:${k}`} value={`${x.id}:${k}`}>{`${x.name} · ${p}`}</option>) : []))}
                  </select>
                </label>
              )}
              <fieldset className="bs-relcfg">
                <legend>{t('Comportamiento')}</legend>
                <label className="bs-chk">
                  <input type="checkbox" aria-label={t('Bloqueado')} checked={!!control.locked} onChange={(e) => patch({ locked: e.target.checked || undefined })} /> {t('Bloqueado (se ve pero no se cambia)')}
                </label>
                <label className="bs-chk">
                  <input type="checkbox" aria-label={t('Habilitado')} checked={control.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked ? undefined : false })} /> {t('Habilitado')}
                </label>
                <label className="bs-chk">
                  <input type="checkbox" aria-label={t('Punto de tabulación')} checked={control.tabStop !== false} onChange={(e) => patch({ tabStop: e.target.checked ? undefined : false })} /> {t('Punto de tabulación')}
                </label>
                {(control.type === 'text' || control.type === 'check' || control.type === 'combo' || control.type === 'list' || control.type === 'option') && !(control.type === 'text' && control.calc) && (
                  <label>
                    {t('Valor predeterminado')}
                    <input aria-label={t('Valor predeterminado')} value={control.defaultValue ?? ''} placeholder="=Date()" onChange={(e) => patch({ defaultValue: e.target.value || undefined })} />
                  </label>
                )}
                {control.type === 'text' && (
                  <label className="bs-chk">
                    <input type="checkbox" aria-label={t('Varias líneas')} checked={!!control.multiline} onChange={(e) => patch({ multiline: e.target.checked || undefined })} /> {t('Varias líneas')}
                  </label>
                )}
              </fieldset>
              <fieldset className="bs-relcfg">
                <legend>{t('Eventos del control')}</legend>
                {(
                  [
                    ['click', 'Evento clic'],
                    ['dblClick', 'Evento doble clic'],
                    ['gotFocus', 'Evento foco recibido'],
                    ['lostFocus', 'Evento foco perdido'],
                    ['change', 'Evento cambio'],
                  ] as const
                ).map(([k, label]) => (
                  <HandlerSelect key={k} ctl={ctl} label={t(label)} value={control.on?.[k]} onChange={(h) => patch({ on: { ...control.on, [k]: h } })} />
                ))}
              </fieldset>
              <fieldset className="bs-relcfg">
                <legend>{t('Formato condicional')}</legend>
                {(control.cond ?? []).map((r, k) => {
                  const set = (p: Partial<CondRule>) => patch({ cond: (control.cond ?? []).map((x, j) => (j === k ? { ...x, ...p } : x)) });
                  return (
                    <div key={k} className="bs-cond" role="group" aria-label={t('Regla {n}', { n: k + 1 })}>
                      <input aria-label={t('Condición de la regla {n}', { n: k + 1 })} value={r.expr} placeholder='[Saldo] < 0' onChange={(e) => set({ expr: e.target.value })} />
                      <label>
                        {t('Fondo')}
                        <input type="color" aria-label={t('Fondo de la regla {n}', { n: k + 1 })} value={r.bg || '#ffffff'} onChange={(e) => set({ bg: e.target.value })} />
                      </label>
                      <label>
                        {t('Texto')}
                        <input type="color" aria-label={t('Color del texto de la regla {n}', { n: k + 1 })} value={r.color || '#000000'} onChange={(e) => set({ color: e.target.value })} />
                      </label>
                      <label className="bs-row">
                        <input type="checkbox" checked={!!r.bold} onChange={(e) => set({ bold: e.target.checked })} /> {t('Negrita')}
                      </label>
                      <label className="bs-row">
                        <input type="checkbox" checked={!!r.disable} onChange={(e) => set({ disable: e.target.checked })} /> {t('Deshabilitar')}
                      </label>
                      <label className="bs-row">
                        <input type="checkbox" checked={!!r.hide} onChange={(e) => set({ hide: e.target.checked })} /> {t('Ocultar')}
                      </label>
                      <button type="button" className="bs-btn" aria-label={t('Quitar la regla {n}', { n: k + 1 })} onClick={() => patch({ cond: (control.cond ?? []).filter((_, j) => j !== k) })}>
                        ×
                      </button>
                    </div>
                  );
                })}
                <button type="button" className="bs-btn" onClick={() => patch({ cond: [...(control.cond ?? []), { expr: '', bg: '#fde7e9' }] })}>
                  {t('Agregar regla')}
                </button>
              </fieldset>
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
