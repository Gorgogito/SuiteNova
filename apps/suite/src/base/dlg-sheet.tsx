import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import type { ColumnFilter, FilterOp, FindOptions } from '@suitenova/base-core';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BaseCtl, SheetState, Tab } from './ctl';

/** Fluent leaves aria-hidden on the page when a dialog unmounts without closing: give the page back once no dialog is left. */
export function useRestorePage(): void {
  useEffect(
    () => () => {
      for (const ms of [0, 120, 500]) {
        setTimeout(() => {
          if (document.querySelector('[role=dialog]')) return;
          for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
          document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
        }, ms);
      }
    },
    [],
  );
}

export function Dlg({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useRestorePage();
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>{actions ?? <Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

const closeDialog = (ctl: BaseCtl) => {
  ctl.sheetDialog = null;
  ctl.touch();
};

const isNumeric = (type: string) => /^(INTEGER|REAL)$/i.test(type);

// ------------------------------------------------------------------------------------------------ column menu

/** Menu of a column header: sort, filter (by value list or condition), hide, freeze and width. */
export function ColumnMenu({ ctl, tab, sheet, table, col, rect, search, filters, onClose }: { ctl: BaseCtl; tab: Tab; sheet: SheetState; table: string; col: string; rect: DOMRect; search: string; filters: ColumnFilter[]; onClose: () => void }) {
  const db = ctl.db!;
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const values = useMemo(() => db.distinct(table, col, { search, filters, limit: 300 }), [db, table, col, search, JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const existing = sheet.filters.find((f) => f.col === col && f.op === 'in');
  const [chosen, setChosen] = useState<Set<string | null>>(() => new Set(existing?.values ?? values.map((v) => v.value)));
  const shown = values.filter((v) => (v.value ?? t('(Vacíos)')).toLowerCase().includes(q.toLowerCase()));
  const index = ctl.sheetOf(tab) && 0;
  void index;

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const patch = (p: Partial<SheetState>) => ctl.setSheet(tab, p);
  const filteredHere = sheet.filters.some((f) => f.col === col);
  const colsVisible = db.columns(table).filter((c) => !sheet.hidden.includes(c.name));
  const pos = colsVisible.findIndex((c) => c.name === col);
  const item = (label: string, run: () => void, disabled = false) => (
    <button type="button" role="menuitem" className="bs-mi" disabled={disabled} onClick={() => (run(), onClose())}>
      {label}
    </button>
  );
  const applyValues = () => {
    const rest = sheet.filters.filter((f) => !(f.col === col && f.op === 'in'));
    const all = values.length > 0 && values.every((v) => chosen.has(v.value));
    patch({ filters: all ? rest : [...rest, { col, op: 'in', values: [...chosen] }], filterOn: true });
    onClose();
  };
  const left = Math.min(rect.left, window.innerWidth - 260);
  return (
    <div ref={ref} role="menu" aria-label={`${t('Menú de la columna')} ${col}`} className="bs-colmenu" style={{ left, top: rect.bottom + 2 }}>
      {item(t('Ordenar de A a Z'), () => patch({ sorts: [{ col, desc: false }] }))}
      {item(t('Ordenar de Z a A'), () => patch({ sorts: [{ col, desc: true }] }))}
      {item(t('Quitar el orden'), () => patch({ sorts: [] }), !sheet.sorts.length)}
      <hr />
      {item(t('Filtro por condición…'), () => ((ctl.sheetDialog = { kind: 'filter', col }), ctl.touch()))}
      {item(`${t('Borrar el filtro de')} «${col}»`, () => patch({ filters: sheet.filters.filter((f) => f.col !== col) }), !filteredHere)}
      <div className="bs-valist">
        <input type="search" aria-label={t('Buscar valores')} placeholder={t('Buscar valores')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="bs-vrow">
          <input
            type="checkbox"
            checked={shown.length > 0 && shown.every((v) => chosen.has(v.value))}
            aria-label={t('Seleccionar todo')}
            onChange={(e) => setChosen((c) => { const n = new Set(c); for (const v of shown) e.target.checked ? n.add(v.value) : n.delete(v.value); return n; })}
          />
          <b>{t('(Seleccionar todo)')}</b>
        </label>
        <div className="bs-vlist" role="group" aria-label={t('Valores')}>
          {shown.map((v) => (
            <label key={v.value ?? '∅'} className="bs-vrow">
              <input type="checkbox" checked={chosen.has(v.value)} onChange={(e) => setChosen((c) => { const n = new Set(c); e.target.checked ? n.add(v.value) : n.delete(v.value); return n; })} />
              <span>{v.value ?? t('(Vacíos)')}</span>
              <small>{v.n}</small>
            </label>
          ))}
          {values.length >= 300 && <p className="bs-note">{t('Solo se muestran los 300 primeros valores.')}</p>}
        </div>
        <Button size="small" appearance="primary" onClick={applyValues}>
          {t('Aplicar')}
        </Button>
      </div>
      <hr />
      {item(t('Ocultar la columna'), () => patch({ hidden: [...sheet.hidden, col] }), colsVisible.length <= 1)}
      {item(t('Inmovilizar hasta esta columna'), () => patch({ frozen: pos + 1 }))}
      {item(t('Liberar las columnas'), () => patch({ frozen: 0 }), sheet.frozen === 0)}
      {item(t('Ancho de columna…'), () => ((ctl.sheetDialog = { kind: 'width', col }), ctl.touch()))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ filter by condition

const TEXT_OPS: [FilterOp, string][] = [['contains', 'Contiene'], ['notcontains', 'No contiene'], ['begins', 'Comienza con'], ['ends', 'Termina con'], ['eq', 'Es igual a'], ['ne', 'No es igual a'], ['null', 'Está vacío'], ['notnull', 'No está vacío']];
const NUM_OPS: [FilterOp, string][] = [['eq', 'Es igual a'], ['ne', 'No es igual a'], ['gt', 'Es mayor que'], ['ge', 'Es mayor o igual que'], ['lt', 'Es menor que'], ['le', 'Es menor o igual que'], ['between', 'Está entre'], ['null', 'Está vacío'], ['notnull', 'No está vacío']];
export const OP_LABEL: Record<FilterOp, string> = { contains: 'Contiene', notcontains: 'No contiene', begins: 'Comienza con', ends: 'Termina con', eq: 'Es igual a', ne: 'No es igual a', gt: 'Es mayor que', ge: 'Es mayor o igual que', lt: 'Es menor que', le: 'Es menor o igual que', between: 'Está entre', null: 'Está vacío', notnull: 'No está vacío', in: 'Es uno de' };

/** Filter of one column by a condition (text, number or date). */
export function FilterDialog({ ctl, tab, sheet, col, type }: { ctl: BaseCtl; tab: Tab; sheet: SheetState; col: string; type: string }) {
  const ops = isNumeric(type) || /DATE|BOOLEAN/i.test(type) ? NUM_OPS : TEXT_OPS;
  const cur = sheet.filters.find((f) => f.col === col && f.op !== 'in');
  const [op, setOp] = useState<FilterOp>(cur?.op ?? ops[0]![0]);
  const [v1, setV1] = useState(cur?.value ?? '');
  const [v2, setV2] = useState(cur?.value2 ?? '');
  const needs = op !== 'null' && op !== 'notnull';
  const apply = () => {
    const rest = sheet.filters.filter((f) => !(f.col === col && f.op !== 'in'));
    ctl.setSheet(tab, { filters: [...rest, { col, op, ...(needs ? { value: v1 } : {}), ...(op === 'between' ? { value2: v2 } : {}) }], filterOn: true });
    closeDialog(ctl);
  };
  const ok = !needs || (v1 !== '' && (op !== 'between' || v2 !== ''));
  return (
    <Dlg
      title={`${t('Filtro')}: ${col}`}
      onClose={() => closeDialog(ctl)}
      actions={
        <>
          <Button onClick={() => closeDialog(ctl)}>{t('Cancelar')}</Button>
          {cur && (
            <Button onClick={() => (ctl.setSheet(tab, { filters: sheet.filters.filter((f) => f.col !== col) }), closeDialog(ctl))}>{t('Quitar el filtro')}</Button>
          )}
          <Button appearance="primary" disabled={!ok} onClick={apply}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        <label>
          {t('Condición')}
          <select aria-label={t('Condición')} value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
            {ops.map(([o, l]) => (
              <option key={o} value={o}>
                {t(l)}
              </option>
            ))}
          </select>
        </label>
        {needs && (
          <label>
            {t('Valor')}
            <input aria-label={t('Valor')} value={v1} autoFocus onChange={(e) => setV1(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && apply()} />
          </label>
        )}
        {op === 'between' && (
          <label>
            {t('y')}
            <input aria-label={t('Segundo valor')} value={v2} onChange={(e) => setV2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && apply()} />
          </label>
        )}
        <p className="bs-note">{t('Las fechas se escriben como AAAA-MM-DD. Si ya hay otros filtros, se aplican todos a la vez.')}</p>
      </div>
    </Dlg>
  );
}

// ------------------------------------------------------------------------------------------------ find and replace

/** Find and replace in the datasheet (in the order and with the filter that are on screen). */
export function FindReplaceDialog({ ctl, table, sheetOpts, cols, activeCol, activeRow, replace, onGo, onChanged }: { ctl: BaseCtl; table: string; sheetOpts: object; cols: string[]; activeCol: string | null; activeRow: number | null; replace: boolean; onGo: (row: number, col?: string) => void; onChanged: () => void }) {
  const db = ctl.db!;
  const [mode, setMode] = useState<'find' | 'replace'>(replace ? 'replace' : 'find');
  const [find, setFind] = useState('');
  const [to, setTo] = useState('');
  const [scope, setScope] = useState<'all' | 'col'>('all');
  const [match, setMatch] = useState<'any' | 'whole' | 'start'>('any');
  const [matchCase, setMatchCase] = useState(false);
  const [msg, setMsg] = useState('');
  const cur = useRef<{ row: number; rid: number; col: string } | null>(null);
  const opts = (): FindOptions => ({ find, match, matchCase, ...(scope === 'col' && activeCol ? { cols: [activeCol] } : {}) });
  const list = () => db.findCells(table, opts(), sheetOpts);
  const order = (c: { row: number; col: string }) => c.row * 1000 + Math.max(0, cols.indexOf(c.col));

  const step = (dir: 1 | -1): boolean => {
    if (!find) return false;
    const cells = list().sort((a, b) => order(a) - order(b));
    if (!cells.length) {
      setMsg(t('No se encontró «{text}».', { text: find }));
      cur.current = null;
      return false;
    }
    const from = cur.current ?? (activeRow !== null ? { row: activeRow, col: activeCol ?? cols[0]! } : null);
    let next = from ? (dir === 1 ? cells.find((c) => order(c) > order(from)) : [...cells].reverse().find((c) => order(c) < order(from))) : dir === 1 ? cells[0] : cells[cells.length - 1];
    let wrapped = false;
    if (!next) {
      next = dir === 1 ? cells[0] : cells[cells.length - 1];
      wrapped = true;
    }
    cur.current = next!;
    onGo(next!.row, next!.col);
    setMsg(wrapped ? t('Se llegó al final: sigue desde el principio. {n} coincidencias.', { n: cells.length }) : t('{n} coincidencias.', { n: cells.length }));
    return true;
  };
  const replaceOne = () => {
    if (!find) return;
    if (!cur.current) {
      step(1);
      return;
    }
    const r = db.replaceCells(table, opts(), to, [{ rid: cur.current.rid, col: cur.current.col }], sheetOpts);
    if (!r.changed) setMsg(r.failed ? t('Esa columna no admite el valor nuevo.') : t('Esta celda ya no coincide.'));
    onChanged();
    step(1);
  };
  const replaceAll = () => {
    if (!find || !window.confirm(t('¿Reemplazar todas las coincidencias? Podrá deshacerlo con Ctrl+Z.'))) return;
    const r = db.replaceCells(table, opts(), to, undefined, sheetOpts);
    setMsg(r.failed ? t('Se reemplazaron {n} y {f} no admitieron el valor nuevo.', { n: r.changed, f: r.failed }) : t('Se reemplazaron {n}.', { n: r.changed }));
    cur.current = null;
    onChanged();
  };
  return (
    <Dlg title={t('Buscar y reemplazar')} onClose={() => closeDialog(ctl)}>
      <div className="bs-dlgform" role="tablist" aria-label={t('Buscar y reemplazar')}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" role="tab" aria-selected={mode === 'find'} className={`bs-btn${mode === 'find' ? ' is-on' : ''}`} onClick={() => setMode('find')}>
            {t('Buscar')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'replace'} className={`bs-btn${mode === 'replace' ? ' is-on' : ''}`} onClick={() => setMode('replace')}>
            {t('Reemplazar')}
          </button>
        </div>
        <label>
          {t('Buscar')}
          <input aria-label={t('Texto que se busca')} autoFocus value={find} onChange={(e) => ((cur.current = null), setFind(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && step(e.shiftKey ? -1 : 1)} />
        </label>
        {mode === 'replace' && (
          <label>
            {t('Reemplazar con')}
            <input aria-label={t('Texto nuevo')} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        )}
        <label>
          {t('Buscar en')}
          <select aria-label={t('Dónde buscar')} value={scope} onChange={(e) => ((cur.current = null), setScope(e.target.value as 'all' | 'col'))}>
            <option value="all">{t('Todos los campos')}</option>
            <option value="col" disabled={!activeCol}>{`${t('Solo el campo actual')}${activeCol ? ` (${activeCol})` : ''}`}</option>
          </select>
        </label>
        <label>
          {t('Coincidencia')}
          <select aria-label={t('Tipo de coincidencia')} value={match} onChange={(e) => ((cur.current = null), setMatch(e.target.value as 'any' | 'whole' | 'start'))}>
            <option value="any">{t('Cualquier parte del campo')}</option>
            <option value="whole">{t('Campo completo')}</option>
            <option value="start">{t('Comienzo del campo')}</option>
          </select>
        </label>
        <label className="bs-check">
          <input type="checkbox" checked={matchCase} onChange={(e) => ((cur.current = null), setMatchCase(e.target.checked))} /> {t('Distinguir mayúsculas y minúsculas')}
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button appearance="primary" disabled={!find} onClick={() => step(1)}>
            {t('Buscar siguiente')}
          </Button>
          <Button disabled={!find} onClick={() => step(-1)}>
            {t('Buscar anterior')}
          </Button>
          {mode === 'replace' && (
            <>
              <Button disabled={!find} onClick={replaceOne}>
                {t('Reemplazar')}
              </Button>
              <Button disabled={!find} onClick={replaceAll}>
                {t('Reemplazar todo')}
              </Button>
            </>
          )}
        </div>
        <p className="bs-note" role="status" aria-live="polite">{msg}</p>
      </div>
    </Dlg>
  );
}

// ------------------------------------------------------------------------------------------------ columns and numbers

/** Which columns are shown, and how many stay in place when scrolling. */
export function ColumnsDialog({ ctl, tab, sheet, cols }: { ctl: BaseCtl; tab: Tab; sheet: SheetState; cols: string[] }) {
  const [hidden, setHidden] = useState(new Set(sheet.hidden));
  const [frozen, setFrozen] = useState(sheet.frozen);
  const shown = cols.filter((c) => !hidden.has(c));
  return (
    <Dlg
      title={t('Mostrar columnas')}
      onClose={() => closeDialog(ctl)}
      actions={
        <>
          <Button onClick={() => closeDialog(ctl)}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!shown.length} onClick={() => (ctl.setSheet(tab, { hidden: [...hidden], frozen: Math.min(frozen, shown.length) }), closeDialog(ctl))}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        <div role="group" aria-label={t('Columnas')} style={{ maxHeight: 260, overflow: 'auto' }}>
          {cols.map((c) => (
            <label key={c} className="bs-check" style={{ display: 'block' }}>
              <input type="checkbox" checked={!hidden.has(c)} onChange={(e) => setHidden((h) => { const n = new Set(h); e.target.checked ? n.delete(c) : n.add(c); return n; })} /> {c}
            </label>
          ))}
        </div>
        <label>
          {t('Columnas inmovilizadas')}
          <input type="number" min={0} max={shown.length} aria-label={t('Columnas inmovilizadas')} value={frozen} onChange={(e) => setFrozen(Math.max(0, Number(e.target.value) || 0))} />
        </label>
      </div>
    </Dlg>
  );
}

/** Asks for one number (column width, row height). */
export function NumberDialog({ ctl, title, label, value, min, max, onOk }: { ctl: BaseCtl; title: string; label: string; value: number; min: number; max: number; onOk: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const n = Number(v);
  const ok = Number.isFinite(n) && n >= min && n <= max;
  useEffect(() => setV(String(value)), [value]);
  return (
    <Dlg
      title={title}
      onClose={() => closeDialog(ctl)}
      actions={
        <>
          <Button onClick={() => closeDialog(ctl)}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={() => (onOk(Math.round(n)), closeDialog(ctl))}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        <label>
          {label}
          <input type="number" min={min} max={max} aria-label={label} value={v} autoFocus onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && (onOk(Math.round(n)), closeDialog(ctl))} />
        </label>
        <p className="bs-note">{t('Entre {min} y {max}.', { min, max })}</p>
      </div>
    </Dlg>
  );
}
