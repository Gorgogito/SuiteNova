import {
  BAND_NAMES,
  FORMATS,
  LABEL_PRESETS,
  PAPERS,
  REPORT_CONTROL_TYPES,
  addGroup,
  addReportControl,
  bandOf,
  columnWidth,
  contentWidth,
  setColumns,
  newReportControl,
  normalizeBox,
  orderedBands,
  removeGroup,
  removeReportControl,
  setBandHeight,
  updateReportControl,
  validateReportLayout,
  type Band,
  type Format,
  type ReportControl,
  type PageBandMode,
  type ReportCondRule,
  type ReportControlType,
  type ReportDef,
  type ReportLayout,
} from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { DesignCanvas, pushHistory, type CanvasItem } from './DesignCanvas';
import { ExprBuilderButton } from './ExprBuilder';
import type { BaseCtl, Tab } from './ctl';

const TYPE_LABEL: Record<ReportControlType, string> = { label: 'Etiqueta', field: 'Campo', calc: 'Campo calculado', line: 'Línea', rect: 'Rectángulo', pageNumber: 'Número de página', chart: 'Gráfico', subreport: 'Subinforme', image: 'Imagen' };
const FORMAT_LABEL: Record<Format, string> = { '': 'Automático', int: 'Entero', dec1: '1 decimal', dec2: '2 decimales', dec3: '3 decimales', percent: 'Porcentaje', date: 'Fecha', datetime: 'Fecha y hora' };
const TEXTUAL = new Set<ReportControlType>(['label', 'field', 'calc', 'pageNumber']);

const MODES: [PageBandMode, string][] = [
  ['all', 'En todas las páginas'],
  ['notFirst', 'No con el encabezado del informe'],
  ['notLast', 'No con el pie del informe'],
  ['notFirstLast', 'No con el encabezado ni el pie del informe'],
];

/** A text box plus a button that hands the typed expression over (it must start with `=`). */
function ExprAdd({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (expr: string) => void }) {
  const [v, setV] = useState('');
  const go = () => {
    const x = v.trim();
    if (!x) return;
    onAdd(x.startsWith('=') ? x : `=${x}`);
    setV('');
  };
  return (
    <div className="bs-grouprow">
      <input aria-label={label} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
      <button type="button" className="bs-btn" aria-label={`${label}: ${'OK'}`} disabled={!v.trim()} onClick={go}>
        +
      </button>
    </div>
  );
}

/** Report design view: bands with controls placed freely, groups, page setup, charts, subreports and labels. */
export function ReportDesigner({ ctl, tab, def, fields, onClose }: { ctl: BaseCtl; tab: Tab; def: ReportDef & { layout: ReportLayout }; fields: string[]; onClose: () => void }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const layout = def.layout;
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [activeBand, setActiveBand] = useState<string | null>(null);
  const [past, setPast] = useState<ReportLayout[]>([]);
  const [future, setFuture] = useState<ReportLayout[]>([]);
  const bands = orderedBands(layout);
  const control = layout.controls.find((c) => c.id === sel) ?? null;
  const tables = db.tableNames();
  const W = contentWidth(layout);
  const warnings = useMemo(() => validateReportLayout(layout, fields), [layout, fields]);
  const bandName = (b: Band) => `${t(BAND_NAMES[b.kind])}${b.kind === 'groupHeader' || b.kind === 'groupFooter' ? ` (${layout.groups[b.level ?? 0]?.field ?? ''})` : ''}`;
  const target = bands.find((b) => b.id === activeBand) ?? bandOf(layout, 'detail') ?? bands[0]!;

  const commit = (next: ReportLayout, record = true) => {
    if (next === layout) return;
    if (record) {
      setPast((p) => pushHistory(p, layout));
      setFuture([]);
    }
    ctl.saveReport(tab.id, { ...def, layout: next });
  };
  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([layout, ...future]);
    ctl.saveReport(tab.id, { ...def, layout: prev });
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setPast(pushHistory(past, layout));
    ctl.saveReport(tab.id, { ...def, layout: next });
  };

  const add = (type: ReportControlType, init: Record<string, unknown> = {}) => {
    const used = layout.controls.filter((c) => c.band === target.id);
    const x = used.length ? Math.min(W - 40, used.reduce((m, c) => Math.max(m, c.x + c.w), 0) + 8) : 0;
    const c = newReportControl(layout, target, type, init, { x: type === 'line' ? 0 : x, y: 2 });
    const wide = type === 'line' ? { w: W } : {};
    const placed = { ...c, ...wide, ...(c.x + c.w > W ? { x: Math.max(0, W - c.w) } : {}) } as ReportControl;
    commit(addReportControl(layout, placed));
    setSel(placed.id);
  };
  const patch = (p: object) => control && commit(updateReportControl(layout, control.id, p));
  const remove = (id: string) => {
    commit(removeReportControl(layout, id));
    setSel(null);
  };

  const preview = (it: CanvasItem) => {
    const c = layout.controls.find((x) => x.id === it.id)!;
    const st = { fontWeight: c.bold ? 700 : undefined, fontStyle: c.italic ? 'italic' : undefined, fontSize: c.size ? Math.min(c.size, 28) : undefined, textAlign: c.align, width: '100%' } as const;
    switch (c.type) {
      case 'label':
        return <span style={st}>{c.text}</span>;
      case 'field':
        return <span style={st}>[{c.field || t('(sin campo)')}]</span>;
      case 'calc':
        return <span style={st}>{c.expr}</span>;
      case 'pageNumber':
        return <span style={st}>{c.text}</span>;
      case 'chart':
        return <span>▥ {t('Gráfico')} ({c.kind})</span>;
      case 'subreport':
        return <span className="bs-cv-sub">▦ {c.table || t('(sin tabla)')}</span>;
      case 'image':
        return c.src ? <img src={c.src} alt={c.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: c.fit === 'clip' ? 'none' : c.fit === 'stretch' ? 'fill' : 'contain' }} /> : <span>▣ {c.field ? `[${c.field}]` : t('(sin imagen)')}</span>;
      default:
        return null;
    }
  };

  const num = (label: string, key: 'x' | 'y' | 'w' | 'h') => (
    <label key={key}>
      {label}
      <input
        type="number"
        aria-label={label}
        value={control![key]}
        onChange={(e) => patch(normalizeBox({ x: control!.x, y: control!.y, w: control!.w, h: control!.h, [key]: Number(e.target.value) || 0 }, { grid: 0, maxW: W }))}
      />
    </label>
  );
  const fieldSelect = (label: string, value: string, key: string) => (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={(e) => patch({ [key]: e.target.value })}>
        <option value="" />
        {value && !fields.includes(value) && <option value={value}>{`${value} ${t('(no existe)')}`}</option>}
        {fields.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
    </label>
  );

  const setPage = (p: Partial<ReportLayout>) => commit({ ...layout, ...p });
  const setRule = (i: number, r: Partial<ReportCondRule>) => control && patch({ cond: (control.cond ?? []).map((x, j) => (j === i ? { ...x, ...r } : x)) });

  return (
    <div className="bs-rdesign">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Diseño del informe')}>
        <button type="button" className="bs-btn" onClick={onClose}>
          {t('Vista previa')}
        </button>
        <button type="button" className="bs-btn" disabled={!past.length} onClick={undo}>
          {t('Deshacer el diseño')}
        </button>
        <button type="button" className="bs-btn" disabled={!future.length} onClick={redo}>
          {t('Rehacer el diseño')}
        </button>
        <span className="bs-sep" aria-hidden="true" />
        {REPORT_CONTROL_TYPES.map((k) => (
          <button key={k} type="button" className="bs-btn" onClick={() => add(k)}>
            {t(TYPE_LABEL[k])}
          </button>
        ))}
        <button type="button" className="bs-btn" disabled={!control} onClick={() => control && remove(control.id)}>
          {t('Eliminar control')}
        </button>
        <span className="bs-hint">
          {t('Los controles nuevos van a la sección')}: <strong>{bandName(target)}</strong>
        </span>
      </div>
      <div className="bs-rdbody">
        <aside className="bs-fields-pane nv-panel" aria-label={t('Campos del origen')}>
          <h3>{t('Campos del origen')}</h3>
          <p className="bs-hint">{t('Pulse un campo para agregarlo a la sección elegida.')}</p>
          <ul>
            {fields.map((f) => (
              <li key={f}>
                <button type="button" onClick={() => add('field', { field: f })}>
                  {f}
                </button>
              </li>
            ))}
          </ul>
          {!layout.labels && (
            <fieldset className="bs-relcfg">
              <legend>{t('Agrupar por')}</legend>
              {layout.groups.map((g, i) => (
                <div key={g.field} className="bs-grouprow">
                  <strong>{g.field}</strong>
                  <label className="bs-row">
                    <input type="checkbox" checked={!!g.desc} onChange={(e) => setPage({ groups: layout.groups.map((x, j) => (j === i ? { ...x, desc: e.target.checked } : x)) })} /> {t('Descendente')}
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={!!g.keepTogether} onChange={(e) => setPage({ groups: layout.groups.map((x, j) => (j === i ? { ...x, keepTogether: e.target.checked } : x)) })} /> {t('Mantener unido')}
                  </label>
                  <label>
                    {t('Agrupar por los primeros caracteres')}
                    <input type="number" min={0} max={30} aria-label={t('Caracteres de la agrupación {f}', { f: g.field })} value={g.prefix ?? 0} onChange={(e) => setPage({ groups: layout.groups.map((x, j) => (j === i ? { ...x, prefix: Math.max(0, Math.min(30, Number(e.target.value) || 0)) || undefined } : x)) })} />
                  </label>
                  <button type="button" className="bs-btn" aria-label={t('Quitar la agrupación por {f}', { f: g.field })} onClick={() => commit(removeGroup(layout, i))}>
                    ×
                  </button>
                </div>
              ))}
              <select aria-label={t('Agregar agrupación')} value="" onChange={(e) => e.target.value && commit(addGroup(layout, e.target.value))}>
                <option value="">{t('Agregar agrupación…')}</option>
                {fields.filter((f) => !layout.groups.some((g) => g.field === f)).map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <ExprAdd label={t('Agrupar por expresión')} placeholder="=Left([Nombre], 1)" onAdd={(x) => commit(addGroup(layout, x))} />
            </fieldset>
          )}
        </aside>
        <div className="bs-rdscroll">
          <div className="bs-rdpage" style={{ width: layout.labels ? layout.labels.labelW : W }}>
            {bands.map((b) => {
              const items: CanvasItem[] = layout.controls
                .filter((c) => c.band === b.id)
                .map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, thin: c.type === 'line', label: `${t(TYPE_LABEL[c.type])} ${c.name}` }));
              return (
                <section key={b.id} className="bs-band" aria-label={bandName(b)}>
                  <div className="bs-bandhead" onClick={() => setActiveBand(b.id)} style={target.id === b.id ? { fontWeight: 700 } : undefined}>
                    <button type="button" className="bs-btn" aria-pressed={target.id === b.id} onClick={() => setActiveBand(b.id)}>
                      {bandName(b)}
                    </button>
                    <label>
                      {t('Alto')}{' '}
                      <input type="number" aria-label={t('Alto de {b}', { b: bandName(b) })} min={0} value={b.height} onChange={(e) => commit(setBandHeight(layout, b.id, Number(e.target.value) || 0))} />
                    </label>
                    {!layout.labels && (
                      <label className="bs-chk">
                        <input type="checkbox" aria-label={t('Reducir {b}', { b: bandName(b) })} checked={!!b.canShrink} onChange={(e) => commit({ ...layout, bands: layout.bands.map((x) => (x.id === b.id ? { ...x, canShrink: e.target.checked } : x)) })} /> {t('Puede reducirse')}
                      </label>
                    )}
                  </div>
                  {b.height > 0 && (
                    <DesignCanvas
                      ariaLabel={bandName(b)}
                      width={layout.labels ? layout.labels.labelW : b.kind === 'detail' ? columnWidth(layout) : W}
                      height={b.height}
                      items={items}
                      selected={sel}
                      onSelect={(id) => {
                        setSel(id);
                        if (id) setActiveBand(layout.controls.find((c) => c.id === id)?.band ?? null);
                      }}
                      onChange={(id, box) => commit(updateReportControl(layout, id, box))}
                      onDelete={remove}
                      render={preview}
                    />
                  )}
                </section>
              );
            })}
          </div>
        </div>
        <aside className="bs-props nv-panel" aria-label={t('Propiedades')}>
          <h3>{t('Propiedades')}</h3>
          {!control && (
            <fieldset className="bs-relcfg">
              <legend>{t('Página')}</legend>
              {layout.labels ? (
                <>
                  <label>
                    {t('Hoja de etiquetas')}
                    <select
                      aria-label={t('Hoja de etiquetas')}
                      value={LABEL_PRESETS.find((p) => p.paper === layout.paper && Math.abs(p.spec.labelW - layout.labels!.labelW) < 0.5 && p.spec.cols === layout.labels!.cols && Math.abs(p.spec.labelH - layout.labels!.labelH) < 0.5)?.id ?? ''}
                      onChange={(e) => {
                        const p = LABEL_PRESETS.find((x) => x.id === e.target.value);
                        if (!p) return;
                        const det = bandOf(layout, 'detail')!;
                        commit({ ...setBandHeight(layout, det.id, Math.round(p.spec.labelH)), paper: p.paper, labels: { ...p.spec } });
                      }}
                    >
                      <option value="">{t('(personalizada)')}</option>
                      {LABEL_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="bs-hint">{t('El detalle es una etiqueta: se repite en la hoja.')}</p>
                </>
              ) : (
                <>
                  <label>
                    {t('Papel')}
                    <select aria-label={t('Papel')} value={layout.paper} onChange={(e) => setPage({ paper: e.target.value as ReportLayout['paper'] })}>
                      {PAPERS.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={layout.landscape} onChange={(e) => setPage({ landscape: e.target.checked })} /> {t('Horizontal')}
                  </label>
                  <div className="bs-propgrid">
                    {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
                      <label key={k}>
                        {t({ top: 'Margen superior', right: 'Margen derecho', bottom: 'Margen inferior', left: 'Margen izquierdo' }[k])}
                        <input type="number" min={0} aria-label={t({ top: 'Margen superior', right: 'Margen derecho', bottom: 'Margen inferior', left: 'Margen izquierdo' }[k])} value={layout.margins[k]} onChange={(e) => setPage({ margins: { ...layout.margins, [k]: Math.max(0, Number(e.target.value) || 0) } })} />
                      </label>
                    ))}
                  </div>
                  <fieldset>
                    <legend>{t('Orden dentro de los grupos')}</legend>
                    {(layout.sort ?? []).map((s, i) => (
                      <div key={s.field} className="bs-grouprow">
                        <strong>{s.field}</strong>
                        <label className="bs-row">
                          <input type="checkbox" checked={!!s.desc} onChange={(e) => setPage({ sort: (layout.sort ?? []).map((x, j) => (j === i ? { ...x, desc: e.target.checked } : x)) })} /> {t('Descendente')}
                        </label>
                        <button type="button" className="bs-btn" aria-label={t('Quitar el orden por {f}', { f: s.field })} onClick={() => setPage({ sort: (layout.sort ?? []).filter((_, j) => j !== i) })}>
                          ×
                        </button>
                      </div>
                    ))}
                    <select aria-label={t('Agregar orden')} value="" onChange={(e) => e.target.value && setPage({ sort: [...(layout.sort ?? []), { field: e.target.value }] })}>
                      <option value="">{t('Agregar orden…')}</option>
                      {fields.filter((f) => !(layout.sort ?? []).some((s) => s.field === f)).map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                    <ExprAdd label={t('Ordenar por expresión')} placeholder="=[Precio]*[Cantidad]" onAdd={(x) => setPage({ sort: [...(layout.sort ?? []), { field: x }] })} />
                  </fieldset>
                  <fieldset>
                    <legend>{t('Columnas')}</legend>
                    <label>
                      {t('Número de columnas')}
                      <input type="number" min={1} max={8} aria-label={t('Número de columnas')} value={layout.columns?.n ?? 1} onChange={(e) => commit(setColumns(layout, Number(e.target.value) > 1 ? { n: Math.min(8, Math.floor(Number(e.target.value))), gap: layout.columns?.gap ?? 20, direction: layout.columns?.direction ?? 'down' } : undefined))} />
                    </label>
                    {layout.columns && (
                      <>
                        <label>
                          {t('Espacio entre columnas')}
                          <input type="number" min={0} aria-label={t('Espacio entre columnas')} value={layout.columns.gap} onChange={(e) => commit(setColumns(layout, { ...layout.columns!, gap: Math.max(0, Number(e.target.value) || 0) }))} />
                        </label>
                        <label>
                          {t('Disposición')}
                          <select aria-label={t('Disposición de columnas')} value={layout.columns.direction} onChange={(e) => setPage({ columns: { ...layout.columns!, direction: e.target.value as 'down' | 'across' } })}>
                            <option value="down">{t('Hacia abajo y luego a lo ancho')}</option>
                            <option value="across">{t('A lo ancho y luego hacia abajo')}</option>
                          </select>
                        </label>
                        <p className="bs-hint">{t('El detalle es una columna: sus controles se reescalan al ancho de columna.')}</p>
                      </>
                    )}
                  </fieldset>
                  <fieldset>
                    <legend>{t('Datos del informe')}</legend>
                    <label>
                      {t('Filtro')}
                      <input aria-label={t('Filtro del informe')} value={layout.filter ?? ''} placeholder="[Importe]>100" onChange={(e) => setPage({ filter: e.target.value || undefined })} />
                    </label>
                    <label>
                      {t('Texto si no hay registros')}
                      <input aria-label={t('Texto si no hay registros')} value={layout.noData ?? ''} onChange={(e) => setPage({ noData: e.target.value || undefined })} />
                    </label>
                    <label>
                      {t('Encabezado de página')}
                      <select aria-label={t('Mostrar el encabezado de página')} value={layout.pageHeaderOn ?? 'all'} onChange={(e) => setPage({ pageHeaderOn: e.target.value as PageBandMode })}>
                        {MODES.map(([v, n]) => (
                          <option key={v} value={v}>
                            {t(n)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('Pie de página')}
                      <select aria-label={t('Mostrar el pie de página')} value={layout.pageFooterOn ?? 'all'} onChange={(e) => setPage({ pageFooterOn: e.target.value as PageBandMode })}>
                        {MODES.map(([v, n]) => (
                          <option key={v} value={v}>
                            {t(n)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                </>
              )}
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
              <label>
                {t('Sección')}
                <select aria-label={t('Sección del control')} value={control.band} onChange={(e) => patch({ band: e.target.value })}>
                  {bands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {bandName(b)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="bs-propgrid">
                {num(t('Izquierda'), 'x')}
                {num(t('Arriba'), 'y')}
                {num(t('Ancho'), 'w')}
                {num(t('Alto'), 'h')}
              </div>
              {control.type === 'label' && (
                <label>
                  {t('Texto')}
                  <input aria-label={t('Texto de la etiqueta')} value={control.text} onChange={(e) => patch({ text: e.target.value })} />
                </label>
              )}
              {control.type === 'field' && fieldSelect(t('Campo del control'), control.field, 'field')}
              {control.type === 'calc' && (
                <label>
                  {t('Expresión')}
                  <input aria-label={t('Expresión del control')} value={control.expr} placeholder="=Sum([Importe])  ·  =[Precio]*[Cantidad]" onChange={(e) => patch({ expr: e.target.value })} />
                  <ExprBuilderButton fields={fields} value={control.expr.replace(/^=/, '')} onApply={(v) => patch({ expr: v ? `=${v}` : '=' })} label={t('Generador de expresiones del control')} />
                </label>
              )}
              {control.type === 'image' && (
                <>
                  <label>
                    {t('Imagen')}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      aria-label={t('Elegir imagen')}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        if (f.size > 1_500_000) return void setNote(t('La imagen pesa más de 1,5 MB.'));
                        const r = new FileReader();
                        r.onload = () => typeof r.result === 'string' && (setNote(''), patch({ src: r.result, alt: control.alt || f.name.replace(/\.[^.]+$/, '') }));
                        r.readAsDataURL(f);
                      }}
                    />
                  </label>
                  {control.src && (
                    <button type="button" className="bs-btn" onClick={() => patch({ src: '' })}>
                      {t('Quitar la imagen')}
                    </button>
                  )}
                  <label>
                    {t('Ajuste')}
                    <select aria-label={t('Ajuste de la imagen')} value={control.fit ?? 'zoom'} onChange={(e) => patch({ fit: e.target.value })}>
                      <option value="zoom">{t('Ajustar sin deformar')}</option>
                      <option value="stretch">{t('Estirar')}</option>
                      <option value="clip">{t('Tamaño real (recortar)')}</option>
                    </select>
                  </label>
                  {fieldSelect(t('Campo con la imagen'), control.field ?? '', 'field')}
                  <label>
                    {t('Texto alternativo')}
                    <input aria-label={t('Texto alternativo de la imagen')} value={control.alt ?? ''} onChange={(e) => patch({ alt: e.target.value })} />
                  </label>
                  {note && <p role="alert" className="bs-hint">{note}</p>}
                  <p className="bs-hint">{t('Un campo puede traer la imagen como texto «data:image/png;base64,…».')}</p>
                </>
              )}
              {control.type === 'pageNumber' && (
                <label>
                  {t('Texto')}
                  <input aria-label={t('Texto del número de página')} value={control.text} onChange={(e) => patch({ text: e.target.value })} />
                  <span className="bs-hint">[Page] {t('y')} [Pages]</span>
                </label>
              )}
              {control.type === 'chart' && (
                <>
                  <label>
                    {t('Tipo de gráfico')}
                    <select aria-label={t('Tipo de gráfico')} value={control.kind} onChange={(e) => patch({ kind: e.target.value })}>
                      <option value="bar">{t('Barras')}</option>
                      <option value="line">{t('Líneas')}</option>
                      <option value="pie">{t('Circular')}</option>
                    </select>
                  </label>
                  {fieldSelect(t('Campo de categoría'), control.category, 'category')}
                  {control.fn !== 'count' && fieldSelect(t('Campo de valores'), control.value, 'value')}
                  <label>
                    {t('Calcular con')}
                    <select aria-label={t('Función del gráfico')} value={control.fn} onChange={(e) => patch({ fn: e.target.value })}>
                      <option value="sum">{t('Suma')}</option>
                      <option value="count">{t('Cuenta')}</option>
                      <option value="avg">{t('Promedio')}</option>
                    </select>
                  </label>
                  <label>
                    {t('Título')}
                    <input aria-label={t('Título del gráfico')} value={control.title ?? ''} onChange={(e) => patch({ title: e.target.value })} />
                  </label>
                  <p className="bs-hint">{t('El gráfico usa los registros de su sección: en el encabezado o pie del informe, todos; en un pie de grupo, los del grupo.')}</p>
                </>
              )}
              {control.type === 'subreport' && (
                <>
                  <label>
                    {t('Tabla del subinforme')}
                    <select aria-label={t('Tabla del subinforme')} value={control.table} onChange={(e) => patch({ table: e.target.value, childField: '', columns: undefined })}>
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
                  {fieldSelect(t('Campo vinculado (principal)'), control.parentField, 'parentField')}
                  <label>
                    {t('Alto de fila')}
                    <input type="number" min={10} aria-label={t('Alto de fila del subinforme')} value={control.rowHeight ?? 18} onChange={(e) => patch({ rowHeight: Math.max(10, Number(e.target.value) || 18) })} />
                  </label>
                  <p className="bs-hint">{t('La sección crece lo necesario para mostrar todas las filas del subinforme.')}</p>
                </>
              )}
              {TEXTUAL.has(control.type) && (
                <>
                  {(control.type === 'field' || control.type === 'calc') && (
                    <label>
                      {t('Formato')}
                      <select aria-label={t('Formato')} value={control.format ?? ''} onChange={(e) => patch({ format: e.target.value })}>
                        {FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {t(FORMAT_LABEL[f])}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    {t('Alineación')}
                    <select aria-label={t('Alineación')} value={control.align ?? 'left'} onChange={(e) => patch({ align: e.target.value })}>
                      <option value="left">{t('Izquierda')}</option>
                      <option value="center">{t('Centro')}</option>
                      <option value="right">{t('Derecha')}</option>
                    </select>
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={!!control.bold} onChange={(e) => patch({ bold: e.target.checked })} /> {t('Negrita')}
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={!!control.italic} onChange={(e) => patch({ italic: e.target.checked })} /> {t('Cursiva')}
                  </label>
                  <label className="bs-row">
                    <input type="checkbox" checked={!!control.wrap} onChange={(e) => patch({ wrap: e.target.checked })} /> {t('Ajustar el texto en varias líneas')}
                  </label>
                  {(control.type === 'label' || control.type === 'field' || control.type === 'calc') && (
                    <label className="bs-chk">
                      <input type="checkbox" aria-label={t('Puede crecer')} checked={!!control.canGrow} onChange={(e) => patch({ canGrow: e.target.checked })} /> {t('Puede crecer (según el texto)')}
                    </label>
                  )}
                  {control.type === 'field' && (
                    <label className="bs-chk">
                      <input type="checkbox" aria-label={t('Ocultar duplicados')} checked={!!control.hideDup} onChange={(e) => patch({ hideDup: e.target.checked })} /> {t('Ocultar duplicados')}
                    </label>
                  )}
                  {(control.type === 'field' || control.type === 'calc') && (
                    <label>
                      {t('Suma acumulada')}
                      <select aria-label={t('Suma acumulada')} value={control.running ?? ''} onChange={(e) => patch({ running: e.target.value || undefined })}>
                        <option value="">{t('No')}</option>
                        <option value="group">{t('Dentro del grupo')}</option>
                        <option value="all">{t('En todo el informe')}</option>
                      </select>
                    </label>
                  )}
                  <label>
                    {t('Tamaño de letra')}
                    <input type="number" min={6} max={96} aria-label={t('Tamaño de letra')} value={control.size ?? 12} onChange={(e) => patch({ size: Math.max(6, Math.min(96, Number(e.target.value) || 12)) })} />
                  </label>
                </>
              )}
              {(control.type === 'label' || control.type === 'field' || control.type === 'calc' || control.type === 'rect') && (
                <fieldset className="bs-cond">
                  <legend>{t('Formato condicional')}</legend>
                  {(control.cond ?? []).map((r, i) => (
                    <div key={i} className="bs-condrow">
                      <input aria-label={t('Condición {n}', { n: i + 1 })} value={r.expr} placeholder="[Importe]>1000" onChange={(e) => setRule(i, { expr: e.target.value })} />
                      <input type="color" aria-label={t('Color del texto {n}', { n: i + 1 })} value={r.color ?? '#000000'} onChange={(e) => setRule(i, { color: e.target.value })} />
                      <input type="color" aria-label={t('Fondo {n}', { n: i + 1 })} value={r.background ?? '#ffffff'} onChange={(e) => setRule(i, { background: e.target.value })} />
                      <label className="bs-chk">
                        <input type="checkbox" aria-label={t('Negrita {n}', { n: i + 1 })} checked={!!r.bold} onChange={(e) => setRule(i, { bold: e.target.checked })} /> B
                      </label>
                      <label className="bs-chk">
                        <input type="checkbox" aria-label={t('Ocultar {n}', { n: i + 1 })} checked={!!r.hide} onChange={(e) => setRule(i, { hide: e.target.checked })} /> {t('Ocultar')}
                      </label>
                      <button type="button" className="bs-btn" aria-label={t('Quitar la condición {n}', { n: i + 1 })} onClick={() => patch({ cond: (control.cond ?? []).filter((_, j) => j !== i) })}>
                        ×
                      </button>
                    </div>
                  ))}
                  {(control.cond ?? []).length < 5 && (
                    <button type="button" className="bs-btn" onClick={() => patch({ cond: [...(control.cond ?? []), { expr: '', color: '#c00000' }] })}>
                      {t('Agregar condición')}
                    </button>
                  )}
                  <p className="bs-hint">{t('Se aplica la primera condición que sea verdadera. Use los campos entre corchetes.')}</p>
                </fieldset>
              )}
              {control.type !== 'chart' && control.type !== 'subreport' && control.type !== 'image' && (
                <label>
                  {t('Color')}
                  <input type="color" aria-label={t('Color')} value={control.color && /^#[0-9a-f]{6}$/i.test(control.color) ? control.color : '#000000'} onChange={(e) => patch({ color: e.target.value })} />
                </label>
              )}
              {(control.type === 'label' || control.type === 'field' || control.type === 'calc') && (
                <label className="bs-row">
                  <input type="checkbox" checked={!!control.border} onChange={(e) => patch({ border: e.target.checked })} /> {t('Borde')}
                </label>
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
