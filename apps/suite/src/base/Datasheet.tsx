import { t } from '@suitenova/core-ui';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { QueryResult } from '@suitenova/base-core';
import type { BaseCtl } from './ctl';
import { GridView, type GridColumn } from './GridView';

const BLOCK = 250;

/** Datasheet of a table: sorted, searched and edited through the database. */
export function TableDatasheet({ ctl, table }: { ctl: BaseCtl; table: string }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const db = ctl.db!;
  const [sort, setSort] = useState<{ col: string | null; desc: boolean }>({ col: null, desc: false });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [rev, setRev] = useState(0);
  const cache = useRef(new Map<number, QueryResult>());
  const key = `${table}|${sort.col}|${sort.desc}|${search}|${rev}|${ctl.getVersion()}`;
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
  const exists = cols.length > 0;
  const count = exists ? db.count(table, search) : 0;
  const gridCols: GridColumn[] = cols.map((c) => ({ name: c.name, type: c.type }));
  const pk = cols.find((c) => c.primaryKey)?.name;

  const block = (b: number): QueryResult => {
    let r = cache.current.get(b);
    if (!r) {
      r = db.browse(table, { orderBy: sort.col, desc: sort.desc, search, offset: b * BLOCK, limit: BLOCK });
      cache.current.set(b, r);
    }
    return r;
  };
  const getRow = (i: number): unknown[] | null => {
    const r = block(Math.floor(i / BLOCK)).rows[i % BLOCK];
    return r ? r.slice(1) : null; // drop __rid
  };
  const ridOf = (i: number): number | null => {
    const r = block(Math.floor(i / BLOCK)).rows[i % BLOCK];
    return r ? Number(r[0]) : null;
  };

  useEffect(() => {
    setSelected(new Set());
  }, [table, search, sort.col, sort.desc]);

  if (!exists) return <div className="bs-empty">{t('La tabla ya no existe.')}</div>;

  return (
    <div className="bs-sheet">
      <div className="bs-toolbar" role="toolbar" aria-label={t('Hoja de datos')}>
        <input type="search" aria-label={t('Buscar en la tabla')} placeholder={t('Buscar en la tabla')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button
          type="button"
          className="bs-btn"
          onClick={() => {
            try {
              const rid = db.insertRow(table);
              void rid;
              ctl.touch();
              setSearch('');
              setSort({ col: null, desc: false });
              setRev((x) => x + 1);
              setFocusRow(db.count(table) - 1);
            } catch (e) {
              window.alert((e as Error).message);
            }
          }}
        >
          {t('Nuevo registro')}
        </button>
        <button
          type="button"
          className="bs-btn"
          disabled={selected.size === 0}
          onClick={() => {
            const rids = [...selected].map(ridOf).filter((x): x is number => x !== null);
            if (!window.confirm(t('¿Eliminar {n} registros? Podrá deshacerlo con Ctrl+Z.', { n: rids.length }))) return;
            try {
              db.deleteRows(table, rids);
              setSelected(new Set());
              ctl.touch();
            } catch (e) {
              window.alert((e as Error).message);
            }
          }}
        >
          {t('Eliminar registros')}
        </button>
        <span className="bs-count" aria-live="polite">
          {search ? t('{n} de {total} registros', { n: count, total: db.rowCount(table) }) : t('{n} registros', { n: count })}
        </span>
      </div>
      <GridView
        columns={gridCols}
        rowCount={count}
        getRow={getRow}
        selected={selected}
        onSelect={setSelected}
        focusRow={focusRow}
        sortCol={sort.col}
        sortDesc={sort.desc}
        onSort={(c) => setSort((s) => (s.col !== c ? { col: c, desc: false } : !s.desc ? { col: c, desc: true } : { col: null, desc: false }))}
        onCommit={(r, col, text) => {
          const rid = ridOf(r);
          if (rid === null) return t('El registro ya no existe.');
          try {
            db.updateCell(table, rid, col.name, text);
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
