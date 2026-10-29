import { t } from '@suitenova/core-ui';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export const ROW_H = 26;

export interface GridColumn {
  name: string;
  type?: string;
  width?: number;
}

export interface GridProps {
  columns: GridColumn[];
  rowCount: number;
  /** Cell values of a row, or null while not available. */
  getRow: (index: number) => unknown[] | null;
  readOnly?: boolean;
  sortCol?: string | null;
  sortDesc?: boolean;
  onSort?: (col: string) => void;
  /** Return an error message to keep the cell in edit mode. */
  onCommit?: (rowIndex: number, col: GridColumn, text: string) => string | null;
  selected: Set<number>;
  onSelect: (rows: Set<number>) => void;
  /** Row to scroll to and edit (after adding a record). */
  focusRow?: number | null;
  rowLabel?: (index: number) => string;
}

const show = (v: unknown, type?: string): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Uint8Array) return `[${v.length} bytes]`;
  if (type?.toUpperCase() === 'BOOLEAN') return Number(v) ? '☑' : '☐';
  return String(v);
};

const isNum = (type?: string) => /^(INTEGER|REAL)$/i.test(type ?? '');

/** Virtualized datasheet: only the visible rows exist in the DOM. Cells are edited in place. */
export function GridView(p: GridProps) {
  const { columns, rowCount, getRow, readOnly, selected } = p;
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(400);
  const [cell, setCell] = useState<{ r: number; c: number } | null>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; text: string; error: string | null } | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);

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
    if (el) el.scrollTop = Math.max(0, p.focusRow * ROW_H - height / 2);
    setCell({ r: p.focusRow, c: Math.min(1, columns.length - 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusRow]);

  const first = Math.max(0, Math.floor(top / ROW_H) - 8);
  const last = Math.min(rowCount - 1, Math.ceil((top + height) / ROW_H) + 8);
  const widths = columns.map((c) => c.width ?? (isNum(c.type) ? 110 : /DATE/i.test(c.type ?? '') ? 140 : 180));
  const total = widths.reduce((s, w) => s + w, 0) + 56;

  const begin = (r: number, c: number, text?: string) => {
    if (readOnly || !p.onCommit) return;
    const col = columns[c]!;
    if (col.name === '__rid') return;
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
      if (rr * ROW_H < el.scrollTop) el.scrollTop = rr * ROW_H;
      else if ((rr + 1) * ROW_H + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = (rr + 2) * ROW_H - el.clientHeight;
    };
    if (e.key === 'ArrowDown') go(r + 1, c);
    else if (e.key === 'ArrowUp') go(r - 1, c);
    else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) go(r, c + 1);
    else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) go(r, c - 1);
    else if (e.key === 'PageDown') go(r + Math.floor(height / ROW_H), c);
    else if (e.key === 'PageUp') go(r - Math.floor(height / ROW_H), c);
    else if (e.key === 'Home' && e.ctrlKey) go(0, 0);
    else if (e.key === 'End' && e.ctrlKey) go(rowCount - 1, columns.length - 1);
    else if (e.key === 'F2' || e.key === 'Enter') begin(r, c);
    else if (e.key === ' ' && e.shiftKey) p.onSelect(new Set([r]));
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (columns[c]?.type?.toUpperCase() === 'BOOLEAN' && e.key === ' ') begin(r, c, Number(getRow(r)?.[c]) ? '0' : '1');
      else begin(r, c, e.key);
    } else return;
    e.preventDefault();
  };

  const rows: React.ReactNode[] = [];
  for (let r = first; r <= last; r++) {
    const row = getRow(r);
    const sel = selected.has(r);
    rows.push(
      <div key={r} role="row" aria-rowindex={r + 2} aria-selected={sel} className={`bs-row${sel ? ' is-selected' : ''}`} style={{ top: r * ROW_H + ROW_H, height: ROW_H, width: total }}>
        <div
          role="rowheader"
          className="bs-rh"
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
              className={`bs-cell${active ? ' is-active' : ''}${isNum(col.type) ? ' is-num' : ''}${v === null || v === undefined ? ' is-null' : ''}`}
              style={{ width: widths[c], left: 56 + widths.slice(0, c).reduce((s, w) => s + w, 0) }}
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
                <span>{show(v, col.type)}</span>
              )}
            </div>
          );
        })}
      </div>,
    );
  }

  return (
    <div className="bs-gridwrap">
      <div
        ref={scroller}
        className="bs-grid"
        role="grid"
        aria-label={t('Hoja de datos')}
        aria-rowcount={rowCount + 1}
        aria-colcount={columns.length}
        aria-readonly={readOnly}
        tabIndex={0}
        onScroll={(e) => setTop(e.currentTarget.scrollTop)}
        onKeyDown={onKeyDown}
      >
        <div className="bs-inner" style={{ height: (rowCount + 1) * ROW_H + (readOnly ? 0 : ROW_H), width: total }}>
          <div role="row" className="bs-head" style={{ width: total, height: ROW_H }}>
            <div className="bs-rh" role="columnheader" />
            {columns.map((c, i) => (
              <button
                key={i}
                type="button"
                role="columnheader"
                aria-sort={p.sortCol === c.name ? (p.sortDesc ? 'descending' : 'ascending') : 'none'}
                className="bs-ch"
                style={{ width: widths[i], left: 56 + widths.slice(0, i).reduce((s, w) => s + w, 0) }}
                onClick={() => p.onSort?.(c.name)}
                title={c.type ? `${c.name} (${c.type})` : c.name}
              >
                <span>{c.name}</span>
                {p.sortCol === c.name && <b aria-hidden="true">{p.sortDesc ? '▼' : '▲'}</b>}
              </button>
            ))}
          </div>
          {rows}
        </div>
      </div>
      {edit?.error && (
        <div className="bs-error" role="alert">
          {edit.error}
        </div>
      )}
    </div>
  );
}
