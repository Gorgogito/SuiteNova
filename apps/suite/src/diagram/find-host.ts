import { t } from '@suitenova/core-ui';
import { renameLane, settleContainers, updateConnectors, updatePage, updateShapes, type Diagram, type Page } from '@suitenova/diagram-core';
import { expandReplacement, findInText, replaceAllInText, type Compiled, type Match } from '@suitenova/find-core';
import type { FindHost, FindRequest, FindStatus } from '../find';
import type { DiagramCtl } from './ctl';

/** Where a match is: the text of a shape or a connector, the title of a lane, or the text read in a picture. */
interface Place {
  pageId: string;
  pageName: string;
  id: string;
  kind: 'shape' | 'connector' | 'lane' | 'picture';
  lane?: string;
  text: string;
}
type Found = Place & { match: Match };

function places(d: Diagram): Place[] {
  return d.pages.flatMap((p) => {
    const at = (x: Omit<Place, 'pageId' | 'pageName'>): Place => ({ pageId: p.id, pageName: p.name, ...x });
    return [
      ...p.shapes.flatMap((s) => {
        const read = (s.image?.ocr as { text?: unknown } | undefined)?.text;
        return [
          ...(s.text ? [at({ id: s.id, kind: 'shape', text: s.text })] : []),
          ...(s.container?.lanes ?? []).map((l) => at({ id: s.id, kind: 'lane', lane: l.id, text: l.title })),
          ...(typeof read === 'string' && read ? [at({ id: s.id, kind: 'picture', text: read })] : []),
        ];
      }),
      ...p.connectors.filter((c) => c.text).map((c) => at({ id: c.id, kind: 'connector', text: c.text })),
    ];
  });
}

const matches = (d: Diagram, q: Compiled): Found[] => places(d).flatMap((p) => findInText(q, p.text).map((match) => ({ ...p, match })));

/** The text of a place changed in its page; unchanged when the place does not allow it. */
function rewrite(page: Page, p: Place, text: string): Page {
  if (p.kind === 'connector') return updateConnectors(page, [p.id], { text });
  if (p.kind === 'lane') return renameLane(page, p.id, p.lane!, text);
  return updateShapes(page, [p.id], { text });
}

/** Search and replace in a diagram: the text of shapes, connectors and lanes of every page (and of its pictures, to find only). */
export function diagramFindHost(ctl: DiagramCtl): FindHost {
  let last: FindRequest | null = null;
  let cur = -1;
  const status = (list: Found[]): FindStatus => ({ count: list.length, current: list.length ? cur : -1 });
  const page = (id: string) => ctl.diagram.pages.find((p) => p.id === id)!;
  /** What can be written over: not a picture, not a locked shape or layer. */
  const changeable = (f: Place): boolean => {
    if (f.kind === 'picture') return false;
    const p = page(f.pageId);
    const item = f.kind === 'connector' ? p.connectors.find((c) => c.id === f.id) : p.shapes.find((s) => s.id === f.id);
    const layer = p.layers?.find((l) => l.id === item?.layer) ?? p.layers?.[0];
    return !!item && !layer?.locked && !(item as { locked?: boolean }).locked;
  };
  const show = (f: Found | undefined) => {
    if (!f) return;
    if (ctl.pageId !== f.pageId) ctl.goToPage(f.pageId);
    if (f.kind === 'connector') ctl.setSelection([], [f.id]);
    else ctl.setSelection([f.id]);
    ctl.revealItem(f.id);
  };
  const kindName = (f: Found) => (f.kind === 'picture' ? t('imagen') : f.kind === 'connector' ? t('línea') : f.kind === 'lane' ? t('carril') : t('forma'));
  return {
    features: { modes: ['normal', 'regex'], replace: true },
    selectionText: () => '',
    find(req) {
      last = req;
      const list = matches(ctl.diagram, req.query);
      // from the page on screen on
      const here = ctl.diagram.pages.findIndex((p) => p.id === ctl.pageId);
      const i = list.findIndex((f) => ctl.diagram.pages.findIndex((p) => p.id === f.pageId) >= here);
      cur = list.length ? Math.max(0, i) : -1;
      show(list[cur]);
      return status(list);
    },
    step(dir) {
      if (!last) return { count: 0, current: -1 };
      const list = matches(ctl.diagram, last.query);
      if (!list.length) return status(list);
      cur = (cur + dir + list.length) % list.length;
      show(list[cur]);
      return status(list);
    },
    replaceCurrent(req, template) {
      last = req;
      let list = matches(ctl.diagram, req.query);
      if (!list.length) return status(list);
      cur = Math.min(Math.max(cur, 0), list.length - 1);
      const f = list[cur]!;
      if (changeable(f)) {
        const put = expandReplacement(req.query, f.match, template);
        const text = f.text.slice(0, f.match.start) + put + f.text.slice(f.match.end);
        if (ctl.pageId !== f.pageId) ctl.goToPage(f.pageId);
        ctl.edit((p) => rewrite(p, f, text));
        list = matches(ctl.diagram, req.query);
        // on to what follows what was written (which may match again)
        const after = list.findIndex((x) => x.id === f.id && x.kind === f.kind && x.lane === f.lane && x.match.start >= f.match.start + put.length);
        if (after >= 0) cur = after;
        else {
          const next = list.findIndex((x, i) => i >= cur && !(x.id === f.id && x.kind === f.kind && x.lane === f.lane));
          cur = next >= 0 ? next : list.length ? 0 : -1;
        }
      } else cur = (cur + 1) % list.length;
      show(list[cur]);
      return status(list);
    },
    replaceAll(req, template) {
      let total = 0;
      let next = ctl.diagram;
      for (const p of places(ctl.diagram)) {
        if (!changeable(p)) continue;
        const r = replaceAllInText(req.query, p.text, template);
        if (!r.count || r.text === p.text) continue;
        total += r.count;
        next = updatePage(next, p.pageId, (page) => settleContainers(rewrite(page, p, r.text)));
      }
      // one step to undo, whatever the pages
      if (total) ctl.commit(next);
      cur = -1;
      return total;
    },
    list: (req) => matches(ctl.diagram, req.query).map((f, i) => ({ label: `${f.pageName} · ${kindName(f)}`, detail: (f.text.split('\n').find((l) => findInText(req.query, l).length) ?? f.text).slice(0, 80), go: () => { cur = i; show(f); } })),
    clear() {
      cur = -1;
    },
  };
}
