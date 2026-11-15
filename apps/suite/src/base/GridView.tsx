import { t } from '@suitenova/core-ui';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export const ROW_H = 26;
const RH_W = 56;

export interface GridColumn {
  name: string;
  type?: string;
  width?: number;
  /** what the header shows instead of the name (the caption property) */
  caption?: string;
  /** tooltip of the header (the description of the field) */
  title?: string;
  /** the value as it is shown, or null to show it as it is stored (display format, lookup) */
  display?: (v: unknown) => string | null;
  /** a list to choose from instead of typing (lookup) */
  options?: { value: string; label: string }[];
  /** the value is a web address */
  link?: boolean;
  /** the cells cannot be written (a calculated field) */
  readOnly?: boolean;
  /** the cell holds attachments: it shows how many and opens their window instead of being edited */
  attach?: boolean;
}

export interface GridProps {
  columns: GridColumn[];
  rowCount: number;
  /** Cell values of a row, or null while not available. */
  getRow: (index: number) => unknown[] | null;
  readOnly?: boolean;
  sortCol?: string | null;
  sortDesc?: boolean;
  /** Click on a column header; `add` is true with Shift (a second sort key). */
  onSort?: (col: string, add?: boolean) => void;
  /** Return an error message to keep the cell in edit mode. */
  onCommit?: (rowIndex: number, col: GridColumn, text: string) => string | null;
  selected: Set<number>;
  onSelect: (rows: Set<number>) => void;
  /** An attachment cell was opened (clicked, double clicked or Enter). */
  onAttach?: (rowIndex: number, col: GridColumn) => void;
  /** Row to scroll to and edit (after adding a record). */
  focusRow?: number | null;
  /** A cell to scroll to and select (find, go to). `tick` changes when the same cell is asked again. */
  focusCell?: { row: number; col?: string; tick: number } | null;
  rowLabel?: (index: number) => string;
  /** Height of a row, font size, alternate colours and grid lines. */
  rowH?: number;
  fontSize?: number;
  zebra?: boolean;
  gridlines?: boolean;
  /** The first `frozen` columns stay in place when the sheet scrolls sideways. */
  frozen?: number;
  /** A column is resized with the mouse. */
  onResize?: (col: string, width: number) => void;
  /** The small arrow of a column header was pressed. */
  onHeaderMenu?: (col: string, anchor: DOMRect) => void;
  /** Columns that have a filter (they show a mark). */
  filtered?: Set<string>;
  /** The active cell changed. */
  onActive?: (row: number | null, col: string | null) => void;
  /** Content under each column (totals). */
  footer?: (col: GridColumn, index: number) => ReactNode;
  footerLabel?: string;
}

const show = (v: unknown, type?: string, col?: GridColumn): string => {
  if (v === null || v === undefined) return '';
  const shown = col?.display?.(v);
  if (shown !== null && shown !== undefined) return shown;
  if (v instanceof Uint8Array) return `[${v.length} bytes]`;
  if (type?.toUpperCase() === 'BOOLEAN') return Number(v) ? '☑' : '☐';
  return String(v);
};

const isNum = (type?: string) => /^(INTEGER|REAL)$/i.test(type ?? '');

/** Virtualized datasheet: only the visible rows exist in the DOM. Cells are edited in place. */
export function GridView(p: GridProps) {
  const { columns, rowCount, getRow, readOnly, selected } = p;
  const RH = p.rowH ?? ROW_H;
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [left, setLeft] = useState(0);
  const [height, setHeight] = useState(400);
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; text: string; error: string | null } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const frozen = Math.max(0, Math.min(p.frozen ?? 0, columns.length));

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (p.focusRow === null || p.focusRow === undefined) return;
    const el = scroller.current;
    if (el) el.scrollTop = Math.max(0, p.focusRow * RH - height / 2);
    setCell({ r: p.focusRow, c: Math.min(1, columns.length - 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusRow]);

  const widths = columns.map((c) => c.width ?? (isNum(c.type) ? 110 : /DATE/i.test(c.type ?? '') ? 140 : 180));
  const lefts = widths.map((_w, i) => RH_W + widths.slice(0, i).reduce((s, w) => s + w, 0));
  const total = widths.reduce((s, w) => s + w, 0) + RH_W;

  useEffect(() => {
    const f = p.focusCell;
    if (!f) return;
    const el = scroller.current;
    const c = f.col ? Math.max(0, columns.findIndex((x) => x.name === f.col)) : 0;
    if (el) {
      if (f.row * RH < el.scrollTop || (f.row + 2) * RH > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, f.row * RH - height / 2);
      const fz = columns.slice(0, frozen).reduce((s, _x, i) => s + widths[i]!, 0);
      if (c >= frozen && (lefts[c]! - fz < el.scrollLeft + RH_W || lefts[c]! + widths[c]! > el.scrollLeft + el.clientWidth)) el.scrollLeft = Math.max(0, lefts[c]! - RH_W - fz - 24);
    }
    setCell({ r: f.row, c });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusCell?.tick]);

  useEffect(() => {
    p.onActive?.(cell ? cell.r : null, cell ? (columns[cell.c]?.name ?? null) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell?.r, cell?.c, columns.map((c) => c.name).join('|')]);

  const first = Math.max(0, Math.floor(top / RH) - 8);
  const last = Math.min(rowCount - 1, Math.ceil((top + height) / RH) + 8);

  const begin = (r: number, c: number, text?: string) => {
    if (readOnly || !p.onCommit) return;
    const col = columns[c]!;
    if (col.name === '__rid') return;
    if (col.readOnly) return;
    if (col.attach) return void p.onAttach?.(r, col);
    const row = getRow(r);
    setEdit({ r, c, text: text ?? (row?.[c] === null || row?.[c] === undefined ? '' : String(row[c])), error: null });
  };

  /** Moving focus out of the editor fires its blur, which would commit a second time. */
  const committing = useRef(false);
  const commit = (move?: 'down' | 'right') => {
    if (!edit || committing.current) return;
    committing.current = true;
    try {
      const err = p.onCommit!(edit.r, columns[edit.c]!, edit.text);
      if (err) {
        setEdit({ ...edit, error: err });
        return;
      }
      setEdit(null);
      if (move === 'down' && edit.r + 1 < rowCount) setCell({ r: edit.r + 1, c: edit.c });
      else if (move === 'right' && edit.c + 1 < columns.length) setCell({ r: edit.r, c: edit.c + 1 });
      scroller.current?.focus();
    } finally {
      committing.current = false;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (edit || !cell) return;
    const { r, c } = cell;
    const go = (nr: number, nc: number) => {
      const rr = Math.max(0, Math.min(rowCount - 1, nr));
      setCell({ r: rr, c: Math.max(0, Math.min(columns.length - 1, nc)) });
      const el = scroller.current!;
      if (rr * RH < el.scrollTop) el.scrollTop = rr * RH;
      else if ((rr + 1) * RH + RH > el.scrollTop + el.clientHeight) el.scrollTop = (rr + 2) * RH - el.clientHeight;
    };
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'Home') go(0, 0);
      else if (e.key === 'End') go(rowCount - 1, columns.length - 1);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') go(r + 1, c);
    else if (e.key === 'ArrowUp') go(r - 1, c);
    else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) go(r, c + 1);
    else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) go(r, c - 1);
    else if (e.key === 'PageDown') go(r + Math.floor(height / RH), c);
    else if (e.key === 'PageUp') go(r - Math.floor(height / RH), c);
    else if (e.key === 'F2' || e.key === 'Enter') begin(r, c);
    else if (e.key === ' ' && e.shiftKey) p.onSelect(new Set([r]));
    else if (e.key.length === 1 && !e.altKey) {
      if (columns[c]?.type?.toUpperCase() === 'BOOLEAN' && e.key === ' ') begin(r, c, Number(getRow(r)?.[c]) ? '0' : '1');
      else begin(r, c, e.key);
    } else return;
    e.preventDefault();
  };

  const startResize = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = widths[i]!;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => p.onResize?.(columns[i]!.name, Math.max(40, Math.round(w0 + ev.clientX - x0)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const fz = (c: number): React.CSSProperties | undefined => (c < frozen ? { transform: `translateX(${left}px)`, zIndex: 4 } : undefined);

  const rows: React.ReactNode[] = [];
  for (let r = first; r <= last; r++) {
    const row = getRow(r);
    const sel = selected.has(r);
    rows.push(
      <div key={r} role="row" aria-rowindex={r + 2} aria-selected={sel} className={`bs-row${sel ? ' is-selected' : ''}${p.zebra && r % 2 ? ' is-alt' : ''}`} style={{ top: r * RH + RH, height: RH, width: total }}>
        <div
          role="rowheader"
          className="bs-rh"
          style={{ transform: `translateX(${left}px)` }}
          onClick={(e) => {
            if (e.shiftKey && anchor !== null) {
              const s = new Set<number>();
              for (let i = Math.min(anchor, r); i <= Math.max(anchor, r); i++) s.add(i);
              p.onSelect(s);
            } else if (e.ctrlKey || e.metaKey) {
              const s = new Set(selected);
              s.has(r) ? s.delete(r) : s.add(r);
              p.onSelect(s);
              setAnchor(r);
            } else {
              p.onSelect(new Set([r]));
              setAnchor(r);
            }
          }}
        >
          {p.rowLabel ? p.rowLabel(r) : r + 1}
        </div>
        {columns.map((col, c) => {
          const active = cell?.r === r && cell.c === c;
          const editing = edit?.r === r && edit.c === c;
          const v = row?.[c];
          return (
            <div
              key={c}
              role="gridcell"
              aria-colindex={c + 1}
              aria-selected={active}
              data-col={col.name}
              className={`bs-cell${active ? ' is-active' : ''}${isNum(col.type) ? ' is-num' : ''}${v === null || v === undefined ? ' is-null' : ''}${c < frozen ? ' is-frozen' : ''}`}
              style={{ width: widths[c], left: lefts[c], ...fz(c), ...(active ? { zIndex: c < frozen ? 5 : 1 } : {}) }}
              onMouseDown={() => {
                setCell({ r, c });
                if (edit && !(edit.r === r && edit.c === c)) commit();
              }}
              onDoubleClick={() => begin(r, c)}
            >
              {editing ? (
                col.type?.toUpperCase() === 'BOOLEAN' ? (
                  <select
                    autoFocus
                    aria-label={col.name}
                    value={/^(1|true)$/i.test(edit!.text) ? '1' : '0'}
                    onChange={(e) => setEdit({ ...edit!, text: e.target.value })}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commit('down');
                      else if (e.key === 'Escape') {
                        setEdit(null);
                        scroller.current?.focus();
                      }
                    }}
                    onBlur={() => commit()}
                  >
                    <option value="1">Sí</option>
                    <option value="0">No</option>
                  </select>
                ) : col.options ? (
                  <select
                    autoFocus
                    aria-label={col.name}
                    value={edit!.text}
                    onChange={(e) => setEdit({ ...edit!, text: e.target.value })}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commit('down');
                      else if (e.key === 'Escape') {
                        setEdit(null);
                        scroller.current?.focus();
                      }
                    }}
                    onBlur={() => edit && !edit.error && commit()}
                  >
                    <option value="" />
                    {!col.options.some((o) => o.value === edit!.text) && edit!.text !== '' && <option value={edit!.text}>{edit!.text}</option>}
                    {col.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    autoFocus
                    aria-label={col.name}
                    aria-invalid={!!edit!.error}
                    value={edit!.text}
                    onChange={(e) => setEdit({ ...edit!, text: e.target.value, error: null })}
                    onFocus={(e) => e.currentTarget.setSelectionRange(edit!.text.length, edit!.text.length)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') commit('down');
                      else if (e.key === 'Tab') {
                        e.preventDefault();
                        commit('right');
                      } else if (e.key === 'Escape') {
                        setEdit(null);
                        scroller.current?.focus();
                      }
                    }}
                    onBlur={() => edit && !edit.error && commit()}
                  />
                )
              ) : (
                col.attach ? (
                  <button type="button" className="bs-attbtn" aria-label={`${col.name} ${t('adjuntos')} ${r + 1}`} onClick={() => p.onAttach?.(r, col)}>
                    {col.display?.(v) || '＋'}
                  </button>
                ) : col.link && v ? (
                  <a className="bs-link" href={String(v)} title={t('Ctrl+clic para abrir')} onClick={(e) => (e.preventDefault(), (e.ctrlKey || e.metaKey) && window.open(/^[a-z][a-z0-9+.-]*:/i.test(String(v)) ? String(v) : `https://${String(v)}`, '_blank', 'noopener'))}>
                    {String(v)}
                  </a>
                ) : (
                  <span>{show(v, col.type, col)}</span>
                )
              )}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div className={`bs-gridwrap${p.zebra ? ' has-zebra' : ''}${p.gridlines === false ? ' no-grid' : ''}`} style={{ fontSize: p.fontSize ?? 13 }}>
      <div
        ref={scroller}
        className="bs-grid"
        role="grid"
        aria-label={t('Hoja de datos')}
        aria-rowcount={rowCount + 1}
        aria-colcount={columns.length}
        aria-readonly={readOnly}
        tabIndex={0}
        data-tabster='{"uncontrolled":{"completely":true}}'
        style={{ fontSize: 'inherit' }}
        onScroll={(e) => {
          setTop(e.currentTarget.scrollTop);
          setLeft(e.currentTarget.scrollLeft);
        }}
        onKeyDown={onKeyDown}
      >
        <div className="bs-inner" style={{ height: (rowCount + 1) * RH + (readOnly ? 0 : RH), width: total }}>
          <div role="row" className="bs-head" style={{ width: total, height: RH }}>
            <div className="bs-rh" role="columnheader" style={{ transform: `translateX(${left}px)` }} />
            {columns.map((c, i) => (
              <div key={i} className={`bs-chwrap${i < frozen ? ' is-frozen' : ''}`} style={{ width: widths[i], left: lefts[i], ...fz(i) }}>
                <button
                  type="button"
                  role="columnheader"
                  aria-sort={p.sortCol === c.name ? (p.sortDesc ? 'descending' : 'ascending') : 'none'}
                  className="bs-ch"
                  style={{ width: '100%', left: 0 }}
                  onClick={(e) => p.onSort?.(c.name, e.shiftKey)}
                  title={c.title ?? (c.type ? `${c.name} (${c.type})` : c.name)}
                >
                  <span>{c.caption ?? c.name}</span>
                  {p.filtered?.has(c.name) && <i className="bs-filtered" title={t('Filtrada')} aria-label={t('Filtrada')}>⧩</i>}
                  {p.sortCol === c.name && <b aria-hidden="true">{p.sortDesc ? '▼' : '▲'}</b>}
                </button>
                {p.onHeaderMenu && (
                  <button type="button" className="bs-chmenu" aria-label={`${t('Menú de la columna')} ${c.name}`} aria-haspopup="menu" onClick={(e) => (e.stopPropagation(), p.onHeaderMenu!(c.name, e.currentTarget.getBoundingClientRect()))}>
                    ▾
                  </button>
                )}
                {p.onResize && <div className="bs-grip" role="separator" aria-label={`${t('Ancho de la columna')} ${c.name}`} onPointerDown={startResize(i)} onDoubleClick={() => p.onResize!(c.name, c.type && isNum(c.type) ? 110 : 180)} />}
              </div>
            ))}
          </div>
          {rows}
        </div>
      </div>
      {p.footer && (
        <div className="bs-foot" style={{ height: RH }} role="row" aria-label={t('Totales')}>
          <div style={{ width: total, height: '100%', position: 'relative', transform: `translateX(${-left}px)` }}>
            <div className="bs-rh bs-footlabel" style={{ transform: `translateX(${left}px)` }}>{p.footerLabel ?? t('Total')}</div>
            {columns.map((c, i) => (
              <div key={i} className={`bs-fcell${i < frozen ? ' is-frozen' : ''}`} style={{ width: widths[i], left: lefts[i], ...fz(i) }}>
                {p.footer!(c, i)}
              </div>
            ))}
          </div>
        </div>
      )}
      {edit?.error && (
        <div className="bs-error" role="alert">
          {edit.error}
        </div>
      )}
    </div>
  );
}
