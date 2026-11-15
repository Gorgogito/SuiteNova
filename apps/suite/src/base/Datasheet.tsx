import { t } from '@suitenova/core-ui';
import { aggregatesFor, applyMask, formatField, type AggFn, type ColumnFilter, type QueryResult } from '@suitenova/base-core';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BaseCtl, SheetApi } from './ctl';
import { ColumnMenu, FilterDialog, FindReplaceDialog, NumberDialog, ColumnsDialog } from './dlg-sheet';
import { AttachmentsDialog } from './dlg-attach';
import { GridView, type GridColumn } from './GridView';

const BLOCK = 250;

export const AGG_LABEL: Record<AggFn, string> = { sum: 'Suma', avg: 'Promedio', count: 'Cuenta', countnn: 'Cuenta (no vacíos)', countdistinct: 'Valores distintos', min: 'Mínimo', max: 'Máximo' };
const fmtTotal = (v: unknown): string => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : v === null || v === undefined ? '' : String(v));

/** Rows of text from what the clipboard holds (tab-separated, as Excel and Access copy it). */
export function parseTsv(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  return rows.map((r) => r.split('\t'));
}

/** Datasheet of a table: sorted, filtered, searched and edited through the database. */
export function TableDatasheet({ ctl, table }: { ctl: BaseCtl; table: string }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const tab = ctl.tabs.find((x) => x.kind === 'table' && x.name === table)!;
  const sheet = ctl.sheetOf(tab);
  const patch = (p: Parameters<BaseCtl['setSheet']>[1]) => ctl.setSheet(tab, p);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [focusCell, setFocusCell] = useState<{ row: number; col?: string; tick: number } | null>(null);
  const [active, setActive] = useState<{ row: number | null; col: string | null }>({ row: null, col: null });
  const [attach, setAttach] = useState<{ rid: number; col: string } | null>(null);
  const [rev, setRev] = useState(0);
  const [menu, setMenu] = useState<{ col: string; rect: DOMRect } | null>(null);
  const cache = useRef(new Map<number, QueryResult>());
  const filters: ColumnFilter[] = sheet.filterOn ? sheet.filters : [];
  const key = `${table}|${JSON.stringify(sheet.sorts)}|${JSON.stringify(filters)}|${search}|${rev}|${ctl.getVersion()}`;
  const lastKey = useRef('');
  if (lastKey.current !== key) {
    cache.current.clear();
    lastKey.current = key;
  }

  const cols = useMemo(() => {
    try {
      return db.columns(table);
    } catch {
      return [];
    }
  }, [db, table, ctl.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const meta = useMemo(() => {
    try {
      return db.getMeta(table);
    } catch {
      return { fields: {} } as ReturnType<typeof db.getMeta>;
    }
  }, [db, table, ctl.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  /** What each lookup field offers: the stored value and the text that shows for it. */
  const lookups = useMemo(() => {
    const out = new Map<string, { value: string; label: string }[]>();
    for (const [name, f] of Object.entries(meta.fields)) {
      const l = f.lookup;
      if (!l) continue;
      if (l.kind === 'list') out.set(name, l.items.map((v) => ({ value: v, label: v })));
      else {
        try {
          const r = db.execute(`SELECT "${l.valueCol.replace(/"/g, '""')}", "${l.displayCol.replace(/"/g, '""')}" FROM "${l.table.replace(/"/g, '""')}" ORDER BY 2 LIMIT 2000`);
          out.set(name, r.rows.map((row) => ({ value: String(row[0]), label: String(row[1] ?? row[0]) })));
        } catch {
          /* the table of the lookup is gone: the field shows its stored values */
        }
      }
    }
    return out;
  }, [db, meta, ctl.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const exists = cols.length > 0;
  const visible = cols.map((c, i) => ({ c, i })).filter(({ c }) => !sheet.hidden.includes(c.name) || cols.length === sheet.hidden.length);
  const count = exists ? db.count(table, search, undefined, filters) : 0;
  const gridCols: GridColumn[] = visible.map(({ c }) => {
    const m = meta.fields[c.name];
    const options = lookups.get(c.name);
    return {
      name: c.name,
      type: c.type,
      width: sheet.widths[c.name],
      caption: m?.caption,
      title: m?.description ? `${c.name}: ${m.description}` : undefined,
      options: options && m?.lookup?.limit !== false ? options : undefined,
      link: m?.kind === 'hyperlink',
      readOnly: !!c.generated,
      attach: m?.kind === 'attachment',
      display: (v) => (options ? (options.find((o) => o.value === String(v))?.label ?? null) : formatField(v, c.type, m)),
    };
  });
  const pk = cols.find((c) => c.primaryKey)?.name;
  const opts = { sorts: sheet.sorts, filters, search };

  const block = (b: number): QueryResult => {
    let r = cache.current.get(b);
    if (!r) {
      r = db.browse(table, { ...opts, offset: b * BLOCK, limit: BLOCK });
      cache.current.set(b, r);
    }
    return r;
  };
  const rawRow = (i: number): unknown[] | null => block(Math.floor(i / BLOCK)).rows[i % BLOCK] ?? null;
  const getRow = (i: number): unknown[] | null => {
    const r = rawRow(i);
    return r ? visible.map(({ i: ci }) => r[ci + 1]) : null; // [0] is __rid
  };
  const ridOf = (i: number): number | null => {
    const r = rawRow(i);
    return r ? Number(r[0]) : null;
  };

  useEffect(() => {
    setSelected(new Set());
  }, [table, search, sheet.sorts, sheet.filters, sheet.filterOn]);

  const fail = (e: unknown) => window.alert((e as Error).message);
  const bump = () => {
    cache.current.clear();
    setRev((x) => x + 1);
    ctl.touch();
  };
  const goTo = (row: number, col?: string) => setFocusCell({ row: Math.max(0, Math.min(Math.max(0, count - 1), row)), col, tick: Date.now() });
  const newRecord = () => {
    try {
      db.insertRow(table);
      ctl.touch();
      setSearch('');
      patch({ sorts: [], filters: [] });
      setRev((x) => x + 1);
      setFocusRow(db.count(table) - 1);
    } catch (e) {
      fail(e);
    }
  };
  const deleteSelected = () => {
    const rids = [...selected].map(ridOf).filter((x): x is number => x !== null);
    if (!rids.length) return;
    if (!window.confirm(t('¿Eliminar {n} registros? Podrá deshacerlo con Ctrl+Z.', { n: rids.length }))) return;
    try {
      db.deleteRows(table, rids);
      setSelected(new Set());
      ctl.touch();
    } catch (e) {
      fail(e);
    }
  };

  /** The text of the selected records, or of the active cell (tab-separated). */
  const copyText = (): string | null => {
    if (selected.size) {
      return [...selected]
        .sort((a, b) => a - b)
        .map((r) => (getRow(r) ?? []).map((v) => (v === null || v === undefined ? '' : String(v))).join('\t'))
        .join('\n');
    }
    if (active.row !== null && active.col !== null) {
      const v = getRow(active.row)?.[visible.findIndex(({ c }) => c.name === active.col)];
      return v === null || v === undefined ? '' : String(v);
    }
    return null;
  };
  const clearCells = () => {
    const edits: { rid: number; col: string; value: unknown }[] = [];
    const rows = selected.size ? [...selected] : active.row !== null ? [active.row] : [];
    for (const r of rows) {
      const rid = ridOf(r);
      if (rid === null) continue;
      for (const { c } of selected.size ? visible : visible.filter(({ c: x }) => x.name === active.col)) if (!c.primaryKey) edits.push({ rid, col: c.name, value: '' });
    }
    const res = db.applyEdits(table, edits, [], t('Borrar celdas'));
    if (res.errors.length) window.alert(res.errors[0]);
    bump();
  };
  const pasteText = (text: string) => {
    const grid = parseTsv(text);
    if (!grid.length || (grid.length === 1 && grid[0]!.length === 1 && grid[0]![0] === '' )) return;
    const r0 = active.row ?? 0;
    const c0 = Math.max(0, visible.findIndex(({ c }) => c.name === active.col));
    const edits: { rid: number; col: string; value: unknown }[] = [];
    const inserts: Record<string, unknown>[] = [];
    grid.forEach((cells, i) => {
      const row = r0 + i;
      const rid = row < count ? ridOf(row) : null;
      const vals: Record<string, unknown> = {};
      cells.forEach((v, j) => {
        const col = visible[c0 + j]?.c;
        if (!col) return;
        if (rid !== null) edits.push({ rid, col: col.name, value: v });
        else if (!(col.primaryKey && col.autoIncrement)) vals[col.name] = v;
      });
      if (rid === null && Object.keys(vals).length) inserts.push(vals);
    });
    if (inserts.length && !window.confirm(t('Se van a agregar {n} registros nuevos. ¿Continuar?', { n: inserts.length }))) return;
    const res = db.applyEdits(table, edits, inserts, t('Pegar en {table}', { table }));
    if (res.errors.length) window.alert(t('Algunos valores no se pudieron pegar ({n}): {first}', { n: res.errors.length, first: res.errors[0]! }));
    bump();
  };

  const api: SheetApi = {
    tabId: tab.id,
    table,
    rowCount: count,
    activeCol: active.col,
    activeRow: active.row,
    selectedRows: [...selected],
    newRecord,
    deleteSelected,
    copy: async (cut) => {
      const text = copyText();
      if (text === null) return;
      await navigator.clipboard.writeText(text).catch(() => undefined);
      if (cut) {
        if (selected.size) deleteSelected();
        else clearCells();
      }
    },
    paste: async () => {
      try {
        pasteText(await navigator.clipboard.readText());
      } catch {
        window.alert(t('No se pudo leer el portapapeles. Usa Ctrl+V sobre la hoja de datos.'));
      }
    },
    goto: (where) => {
      if (where === 'new') return newRecord();
      const r = active.row ?? 0;
      goTo(where === 'first' ? 0 : where === 'last' ? count - 1 : where === 'next' ? r + 1 : r - 1, active.col ?? undefined);
    },
    activeValue: () => {
      if (active.row === null || active.col === null) return null;
      const v = getRow(active.row)?.[visible.findIndex(({ c }) => c.name === active.col)];
      return v === null || v === undefined ? '' : String(v);
    },
    refresh: bump,
  };
  ctl.sheetApi = api;
  useEffect(() => {
    ctl.sheetApi = api;
    return () => {
      if (ctl.sheetApi?.tabId === tab.id) ctl.sheetApi = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // the ribbon reads what the datasheet offers (active cell, selection): tell it once the sheet has been drawn
  useEffect(() => {
    ctl.touch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, active.row, active.col, selected.size, count]);

  if (!exists) return <div className="bs-empty">{t('La tabla ya no existe.')}</div>;

  const totalCell = (col: GridColumn) => {
    const fn = sheet.totals[col.name];
    const types = aggregatesFor(col.type ?? 'TEXT');
    let v: unknown = null;
    if (fn) {
      try {
        v = db.aggregate(table, col.name, fn, { search, filters });
      } catch {
        v = null;
      }
    }
    return (
      <>
        <span className="bs-total" aria-label={`${t('Valor del total de')} ${col.name}`} title={fn ? t(AGG_LABEL[fn]) : ''}>
          {fn ? fmtTotal(v) : ''}
        </span>
        <select className="bs-totsel" aria-label={`${t('Total de')} ${col.name}`} value={fn ?? ''} onChange={(e) => patch({ totals: { ...sheet.totals, [col.name]: (e.target.value || undefined) as AggFn } })}>
          <option value="">{t('Ninguno')}</option>
          {types.map((f) => (
            <option key={f} value={f}>
              {t(AGG_LABEL[f])}
            </option>
          ))}
        </select>
      </>
    );
  };

  const activeSort = sheet.sorts[0];
  return (
    <div
      className="bs-sheet"
      onCopy={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT') return;
        const text = copyText();
        if (text === null) return;
        e.preventDefault();
        e.clipboardData.setData('text/plain', text);
      }}
      onCut={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT') return;
        const text = copyText();
        if (text === null) return;
        e.preventDefault();
        e.clipboardData.setData('text/plain', text);
        if (selected.size) deleteSelected();
        else clearCells();
      }}
      onPaste={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT') return;
        e.preventDefault();
        pasteText(e.clipboardData.getData('text/plain'));
      }}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) (e.preventDefault(), (ctl.sheetDialog = { kind: 'find' }), ctl.touch());
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) (e.preventDefault(), (ctl.sheetDialog = { kind: 'replace' }), ctl.touch());
        else if (e.key === 'Delete' && selected.size) (e.preventDefault(), deleteSelected());
      }}
    >
      <div className="bs-toolbar" role="toolbar" aria-label={t('Hoja de datos')}>
        <input type="search" aria-label={t('Buscar en la tabla')} placeholder={t('Buscar en la tabla')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="bs-btn" onClick={newRecord}>
          {t('Nuevo registro')}
        </button>
        <button type="button" className="bs-btn" disabled={selected.size === 0} onClick={deleteSelected}>
          {t('Eliminar registros')}
        </button>
        {sheet.filters.length > 0 && (
          <button type="button" className="bs-btn bs-filterchip" aria-pressed={sheet.filterOn} onClick={() => patch({ filterOn: !sheet.filterOn })} title={t('Activar o desactivar el filtro')}>
            {sheet.filterOn ? t('Filtrado') : t('Sin filtrar')}
          </button>
        )}
        {sheet.filters.length > 0 && (
          <button type="button" className="bs-btn" onClick={() => patch({ filters: [], filterOn: true })}>
            {t('Quitar filtro')}
          </button>
        )}
        <span className="bs-count" aria-live="polite">
          {count !== db.rowCount(table) ? t('{n} de {total} registros', { n: count, total: db.rowCount(table) }) : t('{n} registros', { n: count })}
        </span>
      </div>
      <GridView
        columns={gridCols}
        rowCount={count}
        getRow={getRow}
        selected={selected}
        onSelect={setSelected}
        focusRow={focusRow}
        focusCell={focusCell}
        sortCol={activeSort?.col ?? null}
        sortDesc={activeSort?.desc}
        onSort={(c, add) => {
          const cur = sheet.sorts.find((s) => s.col === c);
          const next = !cur ? { col: c, desc: false } : !cur.desc ? { col: c, desc: true } : null;
          if (add) patch({ sorts: next ? [...sheet.sorts.filter((s) => s.col !== c), next] : sheet.sorts.filter((s) => s.col !== c) });
          else patch({ sorts: next ? [next] : [] });
        }}
        rowH={sheet.rowHeight}
        fontSize={sheet.fontSize}
        zebra={sheet.zebra}
        gridlines={sheet.gridlines}
        frozen={sheet.frozen}
        onResize={(c, w) => patch({ widths: { ...sheet.widths, [c]: w } })}
        onHeaderMenu={(col, rect) => setMenu({ col, rect })}
        filtered={new Set(sheet.filters.map((f) => f.col))}
        onActive={(row, col) => setActive((a) => (a.row === row && a.col === col ? a : { row, col }))}
        onAttach={(r, col) => {
          const rid = ridOf(r);
          if (rid !== null) setAttach({ rid, col: col.name });
        }}
        footer={sheet.showTotals ? (c) => totalCell(c) : undefined}
        onCommit={(r, col, text) => {
          const rid = ridOf(r);
          if (rid === null) return t('El registro ya no existe.');
          try {
            let value = text;
            const mask = meta.fields[col.name]?.inputMask;
            if (mask && text !== '') {
              const masked = applyMask(mask, text);
              if (masked === null) return t('El valor no coincide con la máscara de entrada «{mask}».', { mask });
              value = masked;
            }
            db.updateCell(table, rid, col.name, value);
            cache.current.clear();
            ctl.touch();
            return null;
          } catch (e) {
            return (e as Error).message;
          }
        }}
        rowLabel={(i) => String(i + 1)}
      />
      {pk && <div className="bs-hint">{t('Clave principal: {pk}', { pk })}</div>}
      {menu && <ColumnMenu ctl={ctl} tab={tab} sheet={sheet} table={table} col={menu.col} rect={menu.rect} search={search} filters={filters} onClose={() => setMenu(null)} />}
      {ctl.sheetDialog?.kind === 'filter' && ctl.sheetDialog.col && <FilterDialog ctl={ctl} tab={tab} sheet={sheet} col={ctl.sheetDialog.col} type={cols.find((c) => c.name === ctl.sheetDialog!.col)?.type ?? 'TEXT'} />}
      {(ctl.sheetDialog?.kind === 'find' || ctl.sheetDialog?.kind === 'replace') && (
        <FindReplaceDialog ctl={ctl} table={table} sheetOpts={opts} cols={cols.map((c) => c.name)} activeCol={active.col} activeRow={active.row} replace={ctl.sheetDialog.kind === 'replace'} onGo={goTo} onChanged={bump} />
      )}
      {attach && <AttachmentsDialog ctl={ctl} table={table} rid={attach.rid} column={attach.col} onClose={() => setAttach(null)} onChanged={bump} />}
      {ctl.sheetDialog?.kind === 'columns' && <ColumnsDialog ctl={ctl} tab={tab} sheet={sheet} cols={cols.map((c) => c.name)} />}
      {ctl.sheetDialog?.kind === 'width' && ctl.sheetDialog.col && <NumberDialog ctl={ctl} title={t('Ancho de columna')} label={`${t('Ancho (píxeles)')}: ${ctl.sheetDialog.col}`} value={sheet.widths[ctl.sheetDialog.col] ?? 150} min={40} max={800} onOk={(v) => patch({ widths: { ...sheet.widths, [ctl.sheetDialog!.col!]: v } })} />}
      {ctl.sheetDialog?.kind === 'rowHeight' && <NumberDialog ctl={ctl} title={t('Altura de fila')} label={t('Altura (píxeles)')} value={sheet.rowHeight} min={16} max={120} onOk={(v) => patch({ rowHeight: v })} />}
    </div>
  );
}

/** Read-only datasheet of a query result. */
export function ResultSheet({ result }: { result: QueryResult }) {
  const [sort, setSort] = useState<{ col: string | null; desc: boolean }>({ col: null, desc: false });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rows = useMemo(() => {
    if (!sort.col) return result.rows;
    const i = result.columns.indexOf(sort.col);
    const dir = sort.desc ? -1 : 1;
    return [...result.rows].sort((a, b) => {
      const x = a[i], y = b[i];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * dir;
    });
  }, [result, sort]);
  return (
    <GridView
      columns={result.columns.map((name) => ({ name }))}
      rowCount={rows.length}
      getRow={(i) => rows[i] ?? null}
      readOnly
      selected={selected}
      onSelect={setSelected}
      sortCol={sort.col}
      sortDesc={sort.desc}
      onSort={(c) => setSort((s) => (s.col !== c ? { col: c, desc: false } : !s.desc ? { col: c, desc: true } : { col: null, desc: false }))}
    />
  );
}
