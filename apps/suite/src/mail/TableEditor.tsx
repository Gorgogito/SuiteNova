import { t } from '@suitenova/core-ui';
import { type StyleOptions } from '@suitenova/table-core';
import { useMemo, useState } from 'react';
import { StyleGallery, type TableHost } from '../tables';
import { shownCells, type ComposeTable } from './tables';

type Host = Pick<TableHost, 'useRefresh' | 'info' | 'setStyle' | 'setOption'>;

/**
 * The table of the message being written: its cells (text; «=» starts a formula, as in Outlook), rows and columns, and the shared style
 * gallery. The cell that has the focus shows what is written; the others show the result of their formula.
 */
export function TableEditor({ table, onChange }: { table: ComposeTable; onChange: (t: ComposeTable) => void }) {
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const shown = useMemo(() => shownCells(table), [table]);
  const cols = table.rows[0]?.length ?? 0;
  const host: Host = useMemo(
    () => ({
      useRefresh: () => undefined,
      info: () => ({ styleId: table.styleId, options: table.options }),
      setStyle: (id) => onChange({ ...table, styleId: id }),
      setOption: (name: keyof StyleOptions, value: boolean) => onChange({ ...table, options: { ...table.options, [name]: value } }),
    }),
    [table, onChange],
  );
  const setCell = (r: number, c: number, v: string) => onChange({ ...table, rows: table.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const addRow = () => onChange({ ...table, rows: [...table.rows, Array.from({ length: cols }, () => '')] });
  const addCol = () => onChange({ ...table, rows: table.rows.map((row) => [...row, '']) });
  const delRow = () => table.rows.length > 1 && onChange({ ...table, rows: table.rows.filter((_row, i) => i !== focus.r) });
  const delCol = () => cols > 1 && onChange({ ...table, rows: table.rows.map((row) => row.filter((_x, j) => j !== focus.c)) });
  return (
    <div className="ml-table" role="group" aria-label={t('Tabla {name}', { name: table.name })}>
      <div className="ml-table__bar">
        <StyleGallery host={host} />
        <button type="button" className="ml-btn" onClick={addRow}>{t('Agregar fila')}</button>
        <button type="button" className="ml-btn" onClick={addCol}>{t('Agregar columna')}</button>
        <button type="button" className="ml-btn" disabled={table.rows.length < 2} onClick={delRow}>{t('Quitar fila')}</button>
        <button type="button" className="ml-btn" disabled={cols < 2} onClick={delCol}>{t('Quitar columna')}</button>
      </div>
      <div className="ml-table__grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(70px, 1fr))` }}>
        {table.rows.map((row, r) =>
          row.map((raw, c) => {
            const isEditing = editing?.r === r && editing.c === c;
            return (
              <input
                key={`${r}-${c}`}
                aria-label={t('Fila {r}, columna {c}', { r: r + 1, c: c + 1 })}
                title={/^\s*=/.test(raw) ? raw : undefined}
                data-sel={focus.r === r && focus.c === c}
                value={isEditing ? raw : (shown[r]?.[c] ?? raw)}
                onFocus={() => (setFocus({ r, c }), setEditing({ r, c }))}
                onBlur={() => setEditing(null)}
                onChange={(e) => setCell(r, c, e.target.value)}
              />
            );
          }),
        )}
      </div>
      <p className="ml-pics__note">{t('Una celda que empieza por «=» es una fórmula, por ejemplo =SUM(ABOVE) o =B2*C2. Se envía como tabla en el HTML y como texto alineado.')}</p>
    </div>
  );
}
