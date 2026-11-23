import { registerMessages, t } from '@suitenova/core-ui';
import type { FindOptions } from '@suitenova/base-core';
import { findInText, replaceAllInText, type Compiled } from '@suitenova/find-core';
import type { FindHost, FindRequest } from '../find';
import type { BaseCtl } from './ctl';

registerMessages('en', {
  'Solo el campo actual': 'Current field only',
  'Registro': 'Record',
  'Escribe un número de registro.': 'Type a record number.',
  'No hay un registro {n}.': 'There is no record {n}.',
});

export interface BaseFindArgs {
  ctl: BaseCtl;
  table: string;
  sheetOpts: object;
  cols: string[];
  /** Read when it is needed: the cursor moves while the panel is open. */
  active: () => { col: string | null; row: number | null };
  rows: () => number;
  onGo: (row: number, col?: string) => void;
  onChanged: () => void;
}

/** The datasheet's side of the shared search panel: the cells of the table in the order and with the filter that are on screen. */
export function baseFindHost(a: BaseFindArgs): FindHost {
  let last: FindRequest | null = null;
  let cur = -1;
  type Cell = { row: number; rid: number; col: string };
  const order = (c: { row: number; col: string }) => c.row * 1000 + Math.max(0, a.cols.indexOf(c.col));
  const options = (q: Compiled, onlyCol: boolean): FindOptions => ({
    find: '',
    test: (text) => findInText(q, text).length > 0,
    replacer: (text, to) => replaceAllInText(q, text, to).text,
    ...(onlyCol && a.active().col ? { cols: [a.active().col!] } : {}),
  });
  const list = (req: FindRequest): Cell[] => a.ctl.db!.findCells(a.table, options(req.query, req.filters.onlyField === true), a.sheetOpts).sort((x, y) => order(x) - order(y));
  const status = (cells: Cell[]) => ({ count: cells.length, current: cells.length ? cur : -1 });
  const show = (c: Cell | undefined) => c && a.onGo(c.row, c.col);
  return {
    features: {
      modes: ['normal', 'excel', 'regex'],
      replace: true,
      wholeUnit: true,
      filters: [{ id: 'onlyField', label: 'Solo el campo actual', kind: 'bool' }],
      goTo: [{ id: 'row', label: 'Registro', hint: t('número, +3 o -2') }],
    },
    selectionText: () => '',
    find(req) {
      last = req;
      const cells = list(req);
      const act = a.active();
      const from = act.row !== null ? order({ row: act.row, col: act.col ?? a.cols[0]! }) : -1;
      const i = cells.findIndex((c) => order(c) >= from);
      cur = cells.length ? Math.max(0, i) : -1;
      show(cells[cur]);
      return status(cells);
    },
    step(dir) {
      if (!last) return { count: 0, current: -1 };
      const cells = list(last);
      if (!cells.length) return status(cells);
      cur = (cur + dir + cells.length) % cells.length;
      show(cells[cur]);
      return status(cells);
    },
    replaceCurrent(req, template) {
      last = req;
      let cells = list(req);
      if (!cells.length) return status(cells);
      cur = Math.min(Math.max(cur, 0), cells.length - 1);
      const c = cells[cur]!;
      const r = a.ctl.db!.replaceCells(a.table, options(req.query, req.filters.onlyField === true), template, [{ rid: c.rid, col: c.col }], a.sheetOpts);
      if (!r.changed) cur++;
      a.onChanged();
      cells = list(req);
      cur = cells.length ? Math.min(cur, cells.length - 1) : -1;
      show(cells[cur]);
      return status(cells);
    },
    replaceAll(req, template) {
      const r = a.ctl.db!.replaceCells(a.table, options(req.query, req.filters.onlyField === true), template, undefined, a.sheetOpts);
      a.onChanged();
      return r.changed;
    },
    list: (req) => list(req).map((c) => ({ label: `${t('Registro')} ${c.row + 1}`, detail: c.col, go: () => a.onGo(c.row, c.col) })),
    clear() {
      cur = -1;
    },
    goTo(kind, value) {
      if (kind !== 'row') return null;
      const m = /^\s*([+-]?)\s*(\d{1,9})\s*$/.exec(value);
      if (!m) return t('Escribe un número de registro.');
      const act = a.active().row ?? 0;
      const n = m[1] === '' ? Number(m[2]) : act + 1 + (m[1] === '-' ? -1 : 1) * Number(m[2]);
      if (n < 1 || n > a.rows()) return t('No hay un registro {n}.', { n });
      a.onGo(n - 1, a.active().col ?? undefined);
      return null;
    },
  };
}
