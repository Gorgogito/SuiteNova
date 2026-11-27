/** The message being written, for the shared search panel. */
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { findRanges, replaceRange, type DocMatch, type FindHost, type FindRequest, type FindStatus } from '../../find';

export function richFindHost(getView: () => EditorView | null): FindHost {
  let last: FindRequest | null = null;
  let cur = -1;
  const hits = (req: FindRequest): DocMatch[] => {
    const v = getView();
    return v ? findRanges(v.state.doc, req.query) : [];
  };
  const status = (list: DocMatch[]): FindStatus => ({ count: list.length, current: list.length ? cur : -1 });
  /** `focus`: the editor shows its selection only with the focus, which stays in the search box while typing in it. */
  const show = (h: DocMatch | undefined, focus: boolean) => {
    const v = getView();
    if (!h || !v) return;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, h.from, h.to)).scrollIntoView());
    if (focus) v.focus();
  };
  return {
    features: { modes: ['normal', 'wildcards', 'regex'], replace: true, special: true },
    selectionText: () => {
      const v = getView();
      return v && !v.state.selection.empty ? v.state.doc.textBetween(v.state.selection.from, v.state.selection.to, '\n') : '';
    },
    find(req) {
      last = req;
      const list = hits(req);
      const from = getView()?.state.selection.from ?? 0;
      cur = list.length ? Math.max(0, list.findIndex((h) => h.from >= from)) : -1;
      show(list[cur], false);
      return status(list);
    },
    step(dir) {
      if (!last) return { count: 0, current: -1 };
      const list = hits(last);
      if (!list.length) return status(list);
      cur = (cur + dir + list.length) % list.length;
      show(list[cur], true);
      return status(list);
    },
    replaceCurrent(req, template) {
      last = req;
      let list = hits(req);
      const v = getView();
      if (!v || !list.length) return status(list);
      cur = Math.min(Math.max(cur, 0), list.length - 1);
      const tr = v.state.tr;
      replaceRange(tr, req.query, list[cur]!, template);
      v.dispatch(tr);
      list = hits(req);
      cur = list.length ? Math.min(cur, list.length - 1) : -1;
      show(list[cur], true);
      return status(list);
    },
    replaceAll(req, template) {
      const v = getView();
      const list = hits(req);
      if (!v || !list.length) return 0;
      const tr = v.state.tr;
      for (const m of [...list].reverse()) replaceRange(tr, req.query, m, template);
      v.dispatch(tr);
      return list.length;
    },
    clear() {
      cur = -1;
    },
  };
}
