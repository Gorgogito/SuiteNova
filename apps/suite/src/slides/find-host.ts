import { registerMessages } from '@suitenova/core-ui';
import { expandReplacement, parseGoToNumber } from '@suitenova/find-core';
import { findAll, replaceAll, type FindOptions as DeckFind, type Hit } from '@suitenova/slides-core';
import type { FindHost, FindRequest, FindStatus } from '../find';
import type { SlidesCtl } from './ctl';
import { t } from '@suitenova/core-ui';

registerMessages('en', {
  'Incluir las notas': 'Include notes',
  'Diapositiva': 'Slide',
  'número, +3 o -2': 'number, +3 or -2',
  'No hay una diapositiva {n}.': 'There is no slide {n}.',
  'Escribe un número de diapositiva.': 'Type a slide number.',
});

/** The slides' side of the shared search panel: shapes, table cells, notes and the text read from pictures, slide by slide. */
export function slidesFindHost(c: SlidesCtl): FindHost {
  let last: FindRequest | null = null;
  let cur = -1;
  const opts = (req: FindRequest): DeckFind => ({
    regex: req.query.regex,
    fold: req.query.fold,
    notes: req.filters.notes === true,
    expand: (m) => expandReplacement(req.query, { start: 0, end: m.text.length, text: m.text, groups: m.groups }, template),
  });
  let template = '';
  const hits = (req: FindRequest): Hit[] => findAll(c.deck, '', { ...opts(req), pictures: req.query.options.mode === 'normal' });
  const show = (h: Hit | undefined) => {
    if (!h) return;
    c.goTo(h.slideIndex);
    c.select(h.elementId ? [h.elementId] : []);
    if (!h.elementId && !c.showNotes) {
      c.showNotes = true;
      c.touch();
    }
  };
  const status = (list: Hit[]): FindStatus => ({ count: list.length, current: list.length ? cur : -1 });
  return {
    features: {
      modes: ['normal', 'wildcards', 'regex'],
      replace: true,
      filters: [{ id: 'notes', label: 'Incluir las notas', kind: 'bool' }],
      goTo: [{ id: 'slide', label: 'Diapositiva', hint: t('número, +3 o -2') }],
    },
    selectionText: () => '',
    find(req) {
      last = req;
      const list = hits(req);
      // the first match from the slide that is on screen
      cur = list.length ? Math.max(0, list.findIndex((h) => h.slideIndex >= c.index)) : -1;
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
    replaceCurrent(req, tpl) {
      last = req;
      template = tpl;
      const list = hits(req);
      if (!list.length) return status(list);
      cur = Math.min(Math.max(cur, 0), list.length - 1);
      const h = list[cur]!;
      // the text of a picture is found, not replaced: the next match is shown
      if (h.where !== 'picture') {
        const res = replaceAll(c.deck, '', tpl, opts(req), { slideId: h.slideId, elementId: h.elementId });
        if (res.count) c.apply('Reemplazar', () => res.deck);
      } else cur++;
      const after = hits(req);
      if (after.length) cur = Math.min(cur, after.length - 1);
      else cur = -1;
      show(after[cur]);
      return status(after);
    },
    replaceAll(req, tpl) {
      template = tpl;
      const res = replaceAll(c.deck, '', tpl, opts(req));
      if (res.count) c.apply('Reemplazar todo', () => res.deck);
      return res.count;
    },
    clear() {
      cur = -1;
    },
    goTo(kind, value) {
      if (kind !== 'slide') return null;
      const n = parseGoToNumber(value);
      if (!n) return t('Escribe un número de diapositiva.');
      const target = n.relative ? c.index + 1 + n.n : n.n;
      if (target < 1 || target > c.deck.slides.length) return t('No hay una diapositiva {n}.', { n: target });
      c.goTo(target - 1);
      return null;
    },
  };
}
