import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { PIVOT_STYLE_NAMES, type PivotAgg, type PivotDef, type PivotGroup, type PivotShowAs, type PivotValueField } from '@suitenova/calc-engine';
import { t } from '@suitenova/core-ui';
import { ArrowDown, ArrowUp, Filter, Settings2, X } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { CalcUI } from './commands';
import { parseRangeText, rectText } from './dlg-table';
import { Modal, field } from './modal';

type Area = 'filters' | 'cols' | 'rows' | 'values';
const AREAS: [Area, string][] = [
  ['filters', 'Filtros'],
  ['cols', 'Columnas'],
  ['rows', 'Filas'],
  ['values', 'Valores'],
];

const AGGS: [PivotAgg, string][] = [
  ['sum', 'Suma'],
  ['count', 'Cuenta'],
  ['countNums', 'Cuenta de números'],
  ['average', 'Promedio'],
  ['max', 'Máx'],
  ['min', 'Mín'],
  ['product', 'Producto'],
  ['stdev', 'Desviación estándar'],
  ['stdevp', 'Desviación estándar de la población'],
  ['var', 'Varianza'],
  ['varp', 'Varianza de la población'],
];

const SHOW_AS: [PivotShowAs, string][] = [
  ['normal', 'Sin cálculo'],
  ['percentOfGrand', '% del total general'],
  ['percentOfCol', '% del total de la columna'],
  ['percentOfRow', '% del total de la fila'],
];

// -------------------------------------------------------------------------------------------- create
export function PivotCreateDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const tb = d.x.tableAtActive();
  const block = d.x.defaultBlock();
  const q = (n: string) => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
  const [source, setSource] = useState(tb ? tb.table.name : block ? `${q(d.sheet.name)}!${rectText(block)}` : '');
  const [where, setWhere] = useState<'new' | 'here'>('new');
  const [dest, setDest] = useState(`${q(d.sheet.name)}!$A$1`);
  const [error, setError] = useState('');
  const go = () => {
    let src: PivotDef['source'];
    const asTable = d.wb.tableByName(source.trim());
    if (asTable) src = { table: asTable.table.name };
    else {
      const p = parseRangeText(source);
      if (!p) return setError(t('El origen de datos no es válido: escriba el nombre de una tabla o un rango como Hoja1!A1:D20.'));
      src = { sheet: p.sheet ?? d.sheet.name, ref: rectText(p.rect).replace(/\$/g, '') };
      if (!d.wb.sheetByName(src.sheet)) return setError(t('No existe la hoja "{name}".', { name: src.sheet }));
    }
    let sheetId = d.activeSheetId;
    let row = 2;
    let col = 0;
    if (where === 'here') {
      const p = parseRangeText(dest);
      if (!p) return setError(t('La ubicación no es válida.'));
      const s = p.sheet ? d.wb.sheetByName(p.sheet) : d.sheet;
      if (!s) return setError(t('No existe la hoja "{name}".', { name: p.sheet ?? '' }));
      sheetId = s.id;
      row = p.rect.r1;
      col = p.rect.c1;
    } else {
      d.addSheet();
      sheetId = d.activeSheetId;
    }
    const res = d.x.createPivot(src, sheetId, row, col);
    if (res.error) {
      setError(res.error);
      return;
    }
    onClose();
  };
  return (
    <Modal title={t('Crear tabla dinámica')} onClose={onClose} width={540} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" disabled={!source.trim()} onClick={go}>{t('Aceptar')}</Button></>}>
      <div style={field}>
        <label htmlFor="pv-src">{t('Tabla o rango')}</label>
        <Input id="pv-src" autoFocus value={source} onChange={(_e, v) => { setSource(v.value); setError(''); }} />
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
        <legend>{t('Elija dónde desea colocar el informe')}</legend>
        <label style={{ display: 'block' }}>
          <input type="radio" name="pv-where" checked={where === 'new'} onChange={() => setWhere('new')} /> {t('Nueva hoja de cálculo')}
        </label>
        <label style={{ display: 'block' }}>
          <input type="radio" name="pv-where" checked={where === 'here'} onChange={() => setWhere('here')} /> {t('Hoja de cálculo existente')}
        </label>
      </fieldset>
      {where === 'here' && (
        <div style={field}>
          <label htmlFor="pv-dest">{t('Ubicación')}</label>
          <Input id="pv-dest" value={dest} onChange={(_e, v) => { setDest(v.value); setError(''); }} />
        </div>
      )}
      {error && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{error}</p>}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- field settings
export function ValueFieldDialog({ ui, pivotId, index, onClose }: { ui: CalcUI; pivotId: string; index: number; onClose: () => void }) {
  const d = ui.doc;
  const found = d.x.pivotById(pivotId);
  const v = found?.pivot.values[index];
  const [name, setName] = useState(v?.name ?? '');
  const [agg, setAgg] = useState<PivotAgg>(v?.agg ?? 'sum');
  const [show, setShow] = useState<PivotShowAs>(v?.showAs ?? 'normal');
  const [fmt, setFmt] = useState(v?.numFmt ?? '');
  const [error, setError] = useState('');
  if (!found || !v) return null;
  return (
    <Modal
      title={t('Configuración del campo de valor')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              const err = d.x.updatePivot(pivotId, 'Campo de valor', (p) => {
                const item = p.values[index];
                if (!item) return;
                item.name = name.trim() || undefined;
                item.agg = agg;
                item.showAs = show === 'normal' ? undefined : show;
                item.numFmt = fmt.trim() || undefined;
              });
              if (err) setError(err);
              else onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <p>
        {t('Campo de origen')}: <strong>{v.field}</strong>
      </p>
      <div style={field}>
        <label htmlFor="vf-name">{t('Nombre personalizado')}</label>
        <Input id="vf-name" value={name} placeholder={d.wb.pivotOutput(found.pivot)?.captions[index] ?? ''} onChange={(_e, x) => setName(x.value)} />
      </div>
      <div style={field}>
        <label htmlFor="vf-agg">{t('Resumir valores por')}</label>
        <Select id="vf-agg" value={agg} onChange={(_e, x) => setAgg(x.value as PivotAgg)}>
          {AGGS.map(([k, l]) => (
            <option key={k} value={k}>
              {t(l)}
            </option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="vf-show">{t('Mostrar valores como')}</label>
        <Select id="vf-show" value={show} onChange={(_e, x) => setShow(x.value as PivotShowAs)}>
          {SHOW_AS.map(([k, l]) => (
            <option key={k} value={k}>
              {t(l)}
            </option>
          ))}
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="vf-fmt">{t('Formato de número (código, por ejemplo #,##0.00)')}</label>
        <Input id="vf-fmt" value={fmt} disabled={show !== 'normal'} onChange={(_e, x) => setFmt(x.value)} />
      </div>
      {error && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{error}</p>}
    </Modal>
  );
}

/** Items of a row, column or filter field to keep, and how they are ordered and grouped. */
export function PivotFieldDialog({ ui, pivotId, fieldName, onClose }: { ui: CalcUI; pivotId: string; fieldName: string; onClose: () => void }) {
  const d = ui.doc;
  const found = d.x.pivotById(pivotId);
  const out = useMemo(() => (found ? d.wb.pivotOutput({ ...found.pivot, selection: {} }) : null), [found, d]);
  const items = out?.items(fieldName) ?? [];
  const cur = found?.pivot.selection[fieldName];
  const [checked, setChecked] = useState<Set<string>>(new Set(cur ?? items.map((i) => i.key)));
  const [sort, setSort] = useState<'asc' | 'desc'>(found?.pivot.sort[fieldName] ?? 'asc');
  const g = found?.pivot.groups[fieldName];
  const [group, setGroup] = useState<PivotGroup['kind'] | ''>(g?.kind ?? '');
  const [start, setStart] = useState(String(g?.start ?? ''));
  const [end, setEnd] = useState(String(g?.end ?? ''));
  const [step, setStep] = useState(String(g?.step ?? ''));
  const [error, setError] = useState('');
  if (!found) return null;
  const all = items.length > 0 && items.every((i) => checked.has(i.key));
  return (
    <Modal
      title={`${t('Campo')}: ${fieldName}`}
      onClose={onClose}
      width={520}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              const err = d.x.updatePivot(pivotId, 'Campo de tabla dinámica', (p) => {
                // selection keys follow the grouping, so changing it resets the choice
                const grouped = (p.groups[fieldName]?.kind ?? '') !== group;
                if (all || grouped || checked.size === 0) delete p.selection[fieldName];
                else p.selection[fieldName] = [...checked];
                p.sort[fieldName] = sort;
                if (!group) delete p.groups[fieldName];
                else p.groups[fieldName] = group === 'number' ? { kind: 'number', start: Number(start) || 0, end: end === '' ? undefined : Number(end), step: Number(step) > 0 ? Number(step) : 10 } : { kind: group };
              });
              if (err) setError(err);
              else onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="pf-sort">{t('Orden de los elementos')}</label>
        <Select id="pf-sort" value={sort} onChange={(_e, v) => setSort(v.value as 'asc' | 'desc')}>
          <option value="asc">{t('De A a Z (menor a mayor)')}</option>
          <option value="desc">{t('De Z a A (mayor a menor)')}</option>
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="pf-group">{t('Agrupar')}</label>
        <Select id="pf-group" value={group} onChange={(_e, v) => setGroup(v.value as PivotGroup['kind'] | '')}>
          <option value="">{t('Sin agrupar')}</option>
          <option value="year">{t('Fechas por años')}</option>
          <option value="quarter">{t('Fechas por trimestres')}</option>
          <option value="month">{t('Fechas por meses')}</option>
          <option value="day">{t('Fechas por días')}</option>
          <option value="number">{t('Números por intervalos')}</option>
        </Select>
      </div>
      {group === 'number' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div style={field}>
            <label htmlFor="pf-start">{t('Comenzar en')}</label>
            <Input id="pf-start" value={start} onChange={(_e, v) => setStart(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="pf-end">{t('Terminar en')}</label>
            <Input id="pf-end" value={end} onChange={(_e, v) => setEnd(v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="pf-step">{t('Por')}</label>
            <Input id="pf-step" value={step} onChange={(_e, v) => setStep(v.value)} />
          </div>
        </div>
      )}
      <fieldset style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, padding: 8 }}>
        <legend>{t('Mostrar elementos')}</legend>
        <Checkbox label={t('(Seleccionar todo)')} checked={all} onChange={(_e, v) => setChecked(v.checked ? new Set(items.map((i) => i.key)) : new Set())} />
        <div role="group" aria-label={t('Elementos')} style={{ maxHeight: 200, overflow: 'auto', display: 'grid' }}>
          {items.map((i) => (
            <Checkbox
              key={i.key}
              label={i.label}
              checked={checked.has(i.key)}
              onChange={(_e, v) => {
                const next = new Set(checked);
                if (v.checked) next.add(i.key);
                else next.delete(i.key);
                setChecked(next);
              }}
            />
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{error}</p>}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- options
export function PivotOptionsDialog({ ui, pivotId, onClose }: { ui: CalcUI; pivotId: string; onClose: () => void }) {
  const d = ui.doc;
  const found = d.x.pivotById(pivotId);
  const p = found?.pivot;
  const [name, setName] = useState(p?.name ?? '');
  const [layout, setLayout] = useState<PivotDef['layout']>(p?.layout ?? 'compact');
  const [grandRows, setGrandRows] = useState(p?.grandRows ?? true);
  const [grandCols, setGrandCols] = useState(p?.grandCols ?? true);
  const [subtotals, setSubtotals] = useState(p?.subtotals ?? true);
  const [repeat, setRepeat] = useState(p?.repeatLabels ?? false);
  const [blank, setBlank] = useState(p?.blankRowAfterItem ?? false);
  const [style, setStyle] = useState(p?.style ?? 'PivotStyleLight16');
  const [error, setError] = useState('');
  if (!found || !p) return null;
  return (
    <Modal
      title={t('Opciones de tabla dinámica')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!name.trim()}
            onClick={() => {
              const clash = d.wb.sheets.some((s) => s.pivots.some((x) => x.id !== p.id && x.name.toLowerCase() === name.trim().toLowerCase()));
              if (clash) return setError(t('Ya existe una tabla dinámica con ese nombre.'));
              const err = d.x.updatePivot(pivotId, 'Opciones de tabla dinámica', (x) => {
                x.name = name.trim();
                x.layout = layout;
                x.grandRows = grandRows;
                x.grandCols = grandCols;
                x.subtotals = subtotals;
                x.repeatLabels = repeat;
                x.blankRowAfterItem = blank;
                x.style = style;
              });
              if (err) setError(err);
              else onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="po-name">{t('Nombre')}</label>
        <Input id="po-name" value={name} onChange={(_e, v) => { setName(v.value); setError(''); }} />
      </div>
      <div style={field}>
        <label htmlFor="po-layout">{t('Diseño del informe')}</label>
        <Select id="po-layout" value={layout} onChange={(_e, v) => setLayout(v.value as PivotDef['layout'])}>
          <option value="compact">{t('Compacto')}</option>
          <option value="outline">{t('Esquema')}</option>
          <option value="tabular">{t('Tabular')}</option>
        </Select>
      </div>
      <Checkbox label={t('Mostrar una fila de total general (abajo)')} checked={grandRows} onChange={(_e, v) => setGrandRows(!!v.checked)} />
      <Checkbox label={t('Mostrar una columna de total general (a la derecha)')} checked={grandCols} onChange={(_e, v) => setGrandCols(!!v.checked)} />
      <Checkbox label={t('Mostrar subtotales')} checked={subtotals} onChange={(_e, v) => setSubtotals(!!v.checked)} />
      <Checkbox label={t('Repetir todas las etiquetas de elementos (tabular)')} checked={repeat} onChange={(_e, v) => setRepeat(!!v.checked)} />
      <Checkbox label={t('Insertar línea en blanco después de cada elemento')} checked={blank} onChange={(_e, v) => setBlank(!!v.checked)} />
      <div style={{ ...field, marginTop: 10 }}>
        <label htmlFor="po-style">{t('Estilo')}</label>
        <Select id="po-style" value={style} onChange={(_e, v) => setStyle(v.value)}>
          {PIVOT_STYLE_NAMES.map((n) => (
            <option key={n} value={n}>
              {n.replace('PivotStyle', '')}
            </option>
          ))}
        </Select>
      </div>
      {error && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{error}</p>}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- field list pane
const isNumericField = (rows: unknown[][], i: number): boolean => {
  let n = 0;
  let text = 0;
  for (const r of rows.slice(0, 200)) {
    const v = r[i];
    if (typeof v === 'number') n++;
    else if (typeof v === 'string' && v !== '') text++;
  }
  return n > 0 && n >= text;
};

/** The "PivotTable Fields" pane: pick fields and place them in filters, columns, rows and values. */
export function PivotPane({ ui, onDialog }: { ui: CalcUI; onDialog: (kind: 'pivotValue' | 'pivotField', arg: { pivotId: string; index?: number; field?: string }) => void }) {
  const d = ui.doc;
  useSyncExternalStore(d.subscribe, d.getVersion);
  const found = d.x.pivotById(d.x.pivotPane);
  const [error, setError] = useState('');
  const data = useMemo(() => (found ? d.wb.pivotData(found.pivot) : null), [found, d, d.getVersion()]);
  if (!found || !data) return null;
  const p = found.pivot;
  const update = (label: string, fn: (x: PivotDef) => void) => setError(d.x.updatePivot(p.id, label, fn) ?? '');
  const placed = (name: string): Area | null => (p.rows.includes(name) ? 'rows' : p.cols.includes(name) ? 'cols' : p.filters.includes(name) ? 'filters' : null);
  const inValues = (name: string) => p.values.some((v) => v.field === name);

  const remove = (x: PivotDef, area: Area, name: string, index?: number) => {
    if (area === 'values') x.values.splice(index ?? x.values.findIndex((v) => v.field === name), 1);
    else x[area] = x[area].filter((n) => n !== name);
    delete x.selection[name];
  };
  const add = (x: PivotDef, area: Area, name: string) => {
    if (area === 'values') {
      x.values.push({ field: name, agg: isNumericField(data.rows, data.headers.indexOf(name)) ? 'sum' : 'count' });
    } else if (!x[area].includes(name)) {
      // a field is in one of rows, columns, filters at a time
      for (const a of ['rows', 'cols', 'filters'] as const) x[a] = x[a].filter((n) => n !== name);
      x[area].push(name);
    }
  };
  const toggleField = (name: string, on: boolean) =>
    update(on ? 'Agregar campo' : 'Quitar campo', (x) => {
      if (on) add(x, isNumericField(data.rows, data.headers.indexOf(name)) ? 'values' : 'rows', name);
      else {
        x.rows = x.rows.filter((n) => n !== name);
        x.cols = x.cols.filter((n) => n !== name);
        x.filters = x.filters.filter((n) => n !== name);
        x.values = x.values.filter((v) => v.field !== name);
        delete x.selection[name];
      }
    });
  const move = (area: Area, index: number, delta: -1 | 1) =>
    update('Reordenar campos', (x) => {
      const list: unknown[] = area === 'values' ? x.values : x[area];
      const j = index + delta;
      if (j < 0 || j >= list.length) return;
      [list[index], list[j]] = [list[j], list[index]];
    });
  const moveTo = (from: Area, index: number, to: Area) =>
    update('Mover campo', (x) => {
      const name = from === 'values' ? x.values[index]!.field : x[from][index]!;
      remove(x, from, name, index);
      add(x, to, name);
    });

  const itemsOf = (area: Area): { name: string; label: string; v?: PivotValueField }[] =>
    area === 'values' ? p.values.map((v) => ({ name: v.field, label: v.name || (d.wb.pivotOutput(p)?.captions[p.values.indexOf(v)] ?? v.field), v })) : p[area].map((n) => ({ name: n, label: n }));

  const onDrop = (area: Area, e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    const [kind, a, b] = raw.split('|');
    if (kind === 'field') update('Agregar campo', (x) => add(x, area, a!));
    else if (kind === 'item') moveTo(a as Area, Number(b), area);
  };

  return (
    <aside className="calc-pane" aria-label={t('Campos de tabla dinámica')}>
      <header>
        <strong>{t('Campos de tabla dinámica')}</strong>
        <button type="button" className="calc-pane__x" aria-label={t('Cerrar')} onClick={() => { d.x.pivotPane = null; d.touch(); }}>
          <X size={14} />
        </button>
      </header>
      <p className="calc-pane__hint">{p.name} — {t('Elija los campos para agregar al informe:')}</p>
      <div className="calc-pane__fields" role="group" aria-label={t('Campos')}>
        {data.headers.map((h) => (
          <label key={h} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', `field|${h}`)}>
            <input type="checkbox" checked={!!placed(h) || inValues(h)} onChange={(e) => toggleField(h, e.target.checked)} />
            <span>{h}</span>
          </label>
        ))}
      </div>
      <p className="calc-pane__hint">{t('Arrastre campos entre las áreas o use los botones:')}</p>
      <div className="calc-pane__areas">
        {AREAS.map(([area, label]) => (
          <section key={area} aria-label={t(label)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(area, e)} data-area={area}>
            <h4>{t(label)}</h4>
            <ul>
              {itemsOf(area).map((it, i) => (
                <li key={`${it.name}:${i}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', `item|${area}|${i}`)}>
                  <span title={it.label}>{it.label}</span>
                  <button type="button" aria-label={t('Subir {name}', { name: it.label })} onClick={() => move(area, i, -1)} disabled={i === 0}>
                    <ArrowUp size={12} />
                  </button>
                  <button type="button" aria-label={t('Bajar {name}', { name: it.label })} onClick={() => move(area, i, 1)} disabled={i === itemsOf(area).length - 1}>
                    <ArrowDown size={12} />
                  </button>
                  {area === 'values' ? (
                    <button type="button" aria-label={t('Configuración del campo de valor: {name}', { name: it.label })} onClick={() => onDialog('pivotValue', { pivotId: p.id, index: i })}>
                      <Settings2 size={12} />
                    </button>
                  ) : (
                    <button type="button" aria-label={t('Filtrar y ordenar: {name}', { name: it.label })} onClick={() => onDialog('pivotField', { pivotId: p.id, field: it.name })}>
                      <Filter size={12} />
                    </button>
                  )}
                  <select aria-label={t('Mover {name} a', { name: it.label })} value="" onChange={(e) => e.target.value && moveTo(area, i, e.target.value as Area)}>
                    <option value="">⇄</option>
                    {AREAS.filter(([a]) => a !== area).map(([a, l]) => (
                      <option key={a} value={a}>
                        {t(l)}
                      </option>
                    ))}
                  </select>
                  <button type="button" aria-label={t('Quitar {name}', { name: it.label })} onClick={() => update('Quitar campo', (x) => remove(x, area, it.name, i))}>
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {error && <p role="alert" className="calc-pane__err">{error}</p>}
    </aside>
  );
}
