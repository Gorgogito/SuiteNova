import { registerMessages, t } from '@suitenova/core-ui';
import { formatA1 } from '@suitenova/calc-engine';
import type { FindHost, FindRequest } from '../find';
import type { CalcDoc, FindHit, FindOptions } from './doc';

registerMessages('en', {
  'Buscar en fórmulas': 'Look in formulas',
  'En todo el libro': 'In the whole workbook',
  'Por columnas': 'By columns',
  'Incluir las notas': 'Include notes',
  'Referencia': 'Reference',
  'Imagen': 'Picture',
  'A1, B2:D9, Hoja2!C3 o un nombre': 'A1, B2:D9, Sheet2!C3 or a name',
  'La referencia no es válida.': 'The reference is not valid.',
});

/** The workbook's side of the shared search panel: the cells of the sheet or of the whole workbook (values or formulas), notes and pictures. */
export function calcFindHost(d: CalcDoc): FindHost {
  let last: FindRequest | null = null;
  let cur = -1;
  const opts = (req: FindRequest): FindOptions => ({
    compiled: req.query,
    inFormulas: req.filters.inFormulas === true,
    allSheets: req.filters.allSheets === true,
    byColumns: req.filters.byColumns === true,
    inNotes: req.filters.inNotes === true,
    pictures: true,
  });
  const hits = (req: FindRequest): FindHit[] => d.findHits(req.text, opts(req));
  const status = (list: FindHit[]) => ({ count: list.length, current: list.length ? cur : -1 });
  const show = (h: FindHit | undefined) => h && d.selectHit(h);
  const where = (h: FindHit) => `${d.wb.sheets.find((s) => s.id === h.sheetId)?.name ?? ''}!${h.image ? t('Imagen') : formatA1(h.row, h.col)}`;
  return {
    features: {
      modes: ['excel', 'regex'],
      replace: true,
      wholeUnit: true,
      filters: [
        { id: 'inFormulas', label: 'Buscar en fórmulas', kind: 'bool' },
        { id: 'allSheets', label: 'En todo el libro', kind: 'bool' },
        { id: 'byColumns', label: 'Por columnas', kind: 'bool' },
        { id: 'inNotes', label: 'Incluir las notas', kind: 'bool' },
      ],
      goTo: [{ id: 'ref', label: 'Referencia', hint: t('A1, B2:D9, Hoja2!C3 o un nombre') }],
    },
    selectionText: () => '',
    find(req) {
      last = req;
      const list = hits(req);
      const i = list.findIndex((h) => d.hitIsAfterActive(h, req.filters.byColumns === true));
      cur = list.length ? Math.max(0, i) : -1;
      show(list[cur]);
      return status(list);
    },
    step(dir) {
      if (!last) return { count: 0, current: -1 };
      const list = hits(last);
      if (!list.length) return status(list);
      cur = (cur + dir + list.length) % list.length;
      show(list[cur]);
      return status(list);
    },
    replaceCurrent(req, template) {
      last = req;
      let list = hits(req);
      if (!list.length) return status(list);
      cur = Math.min(Math.max(cur, 0), list.length - 1);
      const h = list[cur]!;
      // the text of a picture is found, not replaced: the next match is shown
      if (h.image || !d.replaceHit(h, { ...opts(req), template }, template)) cur++;
      list = hits(req);
      cur = list.length ? Math.min(cur, list.length - 1) : -1;
      show(list[cur]);
      return status(list);
    },
    replaceAll: (req, template) => d.replaceAll(req.text, template, { ...opts(req), template }),
    list: (req) => hits(req).map((h) => ({ label: where(h), detail: h.text.slice(0, 80), go: () => d.selectHit(h) })),
    clear() {
      cur = -1;
    },
    goTo: (kind, value) => (kind === 'ref' && !d.goTo(value) ? t('La referencia no es válida.') : null),
  };
}
