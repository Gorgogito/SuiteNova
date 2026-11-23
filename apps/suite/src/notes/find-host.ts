import { contentNode } from '@suitenova/notes-core';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { findRanges, replaceRange, type DocMatch, type FindHost, type FindRequest, type FindStatus } from '../find';
import type { NotesCtl } from './ctl';

interface Hit extends DocMatch {
  box: string;
}

/** The text boxes of the page, in reading order (top to bottom, then left to right). */
function boxes(ctl: NotesCtl): { id: string; doc: PMNode }[] {
  return ctl.page.containers
    .filter((c) => c.kind === 'text')
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((c) => ({ id: c.id, doc: ctl.views.get(c.id)?.state.doc ?? contentNode((c as { content: unknown }).content) }));
}

/** The page's side of the shared search panel: the text boxes of the page, each one a document of its own. */
export function notesFindHost(ctl: NotesCtl): FindHost {
  let last: FindRequest | null = null;
  let cur = -1;
  const hits = (req: FindRequest): Hit[] => boxes(ctl).flatMap((b) => findRanges(b.doc, req.query).map((m) => ({ ...m, box: b.id })));
  const status = (list: Hit[]): FindStatus => ({ count: list.length, current: list.length ? cur : -1 });
  const show = (h: Hit | undefined) => {
    const v = h && ctl.views.get(h.box);
    if (!h || !v) return;
    ctl.select(null);
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, h.from, h.to)).scrollIntoView());
    v.dom.scrollIntoView({ block: 'nearest' });
  };
  return {
    features: { modes: ['normal', 'wildcards', 'regex'], replace: true, special: true },
    selectionText() {
      const v = ctl.view;
      return v && !v.state.selection.empty ? v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, '\n') : '';
    },
    find(req) {
      last = req;
      const list = hits(req);
      // the first match from the caret, when the caret is in a box
      const v = ctl.view;
      const at = v ? list.findIndex((h) => ctl.views.get(h.box) === v && h.from >= v.state.selection.from) : -1;
      cur = list.length ? Math.max(0, at) : -1;
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
      const v = ctl.views.get(h.box);
      if (v) {
        const tr = v.state.tr;
        replaceRange(tr, req.query, h, template);
        v.dispatch(tr);
      }
      list = hits(req);
      cur = list.length ? Math.min(cur, list.length - 1) : -1;
      show(list[cur]);
      return status(list);
    },
    replaceAll(req, template) {
      let n = 0;
      for (const b of boxes(ctl)) {
        const v = ctl.views.get(b.id);
        if (!v) continue;
        const ms = findRanges(v.state.doc, req.query);
        if (!ms.length) continue;
        const tr = v.state.tr;
        for (const m of [...ms].reverse()) replaceRange(tr, req.query, m, template);
        v.dispatch(tr);
        n += ms.length;
      }
      return n;
    },
    clear() {
      cur = -1;
    },
  };
}
