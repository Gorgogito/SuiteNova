import { findInText, replaceAllInText, expandReplacement, type Match } from '@suitenova/find-core';
import type { FindHost, FindRequest, FindStatus } from '../find';

/** Changes the value of a field as if it had been typed, so that the `onChange` of whoever uses it finds out. */
function setNativeValue(ta: HTMLTextAreaElement, value: string, caret: number): void {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  set.call(ta, value);
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * The body of the message being written (a plain text field). A field shows its selection only while it has the focus, so «Next» and «Replace» move
 * the focus to it (F3 and Shift+F3 go on from there); while typing in the search box the field is not touched.
 */
export function textareaFindHost(getEl: () => HTMLTextAreaElement | null): FindHost {
  let last: FindRequest | null = null;
  let cur = -1;
  const hits = (req: FindRequest): Match[] => {
    const el = getEl();
    return el ? findInText(req.query, el.value) : [];
  };
  const status = (list: Match[]): FindStatus => ({ count: list.length, current: list.length ? cur : -1 });
  const show = (m: Match | undefined, focus: boolean) => {
    const el = getEl();
    if (!el || !m) return;
    if (focus) el.focus();
    el.setSelectionRange(m.start, m.end);
    // bring the line into view: the lines before it, by the height of one line
    const line = el.value.slice(0, m.start).split('\n').length - 1;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    if (line * lh < el.scrollTop || line * lh > el.scrollTop + el.clientHeight - lh) el.scrollTop = Math.max(0, line * lh - el.clientHeight / 2);
  };
  return {
    features: { modes: ['normal', 'wildcards', 'regex'], replace: true, special: true },
    selectionText: () => {
      const el = getEl();
      return el && el.selectionEnd > el.selectionStart ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
    },
    find(req) {
      last = req;
      const list = hits(req);
      const from = getEl()?.selectionStart ?? 0;
      const i = list.findIndex((m) => m.start >= from);
      cur = list.length ? Math.max(0, i) : -1;
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
      const el = getEl();
      const list = hits(req);
      if (!el || !list.length) return status(list);
      cur = Math.min(Math.max(cur, 0), list.length - 1);
      const m = list[cur]!;
      const text = expandReplacement(req.query, m, template);
      setNativeValue(el, el.value.slice(0, m.start) + text + el.value.slice(m.end), m.start + text.length);
      const after = hits(req);
      cur = after.length ? Math.max(0, after.findIndex((x) => x.start >= m.start + text.length)) : -1;
      show(after[cur], true);
      return status(after);
    },
    replaceAll(req, template) {
      const el = getEl();
      if (!el) return 0;
      const r = replaceAllInText(req.query, el.value, template);
      if (r.count) setNativeValue(el, r.text, 0);
      return r.count;
    },
    clear() {
      cur = -1;
    },
  };
}

const BLOCKS = 'p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,pre,blockquote,table,ul,ol,section,article,header,footer';
const HIGHLIGHT_CSS = '::highlight(nova-find){background:#ffe066;color:#000}::highlight(nova-find-cur){background:#ff9632;color:#000}';

interface HighlightApi {
  highlights?: { set(name: string, h: unknown): void; delete(name: string): void };
}

/** The message being read (HTML in a frame): found with its text nodes and shown with the page's highlights, so the message itself is not changed. */
export function frameFindHost(getDoc: () => Document | null): FindHost {
  let last: FindRequest | null = null;
  let cur = -1;
  interface Run {
    node: Text;
    off: number;
  }
  const index = (doc: Document): { text: string; runs: Run[] } => {
    const runs: Run[] = [];
    let text = '';
    let prevBlock: Element | null = null;
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const tn = n as Text;
      if (!tn.data || tn.parentElement?.closest('script,style')) continue;
      const block = tn.parentElement?.closest(BLOCKS) ?? null;
      if (runs.length && block !== prevBlock) text += '\n';
      prevBlock = block;
      runs.push({ node: tn, off: text.length });
      text += tn.data;
    }
    return { text, runs };
  };
  const at = (runs: Run[], off: number, end: boolean): { node: Text; offset: number } | null => {
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i]!;
      if (off >= r.off && (off < r.off + r.node.data.length || (end && off === r.off + r.node.data.length))) return { node: r.node, offset: off - r.off };
    }
    return null;
  };
  const ranges = (req: FindRequest): Range[] => {
    const doc = getDoc();
    if (!doc?.body) return [];
    const { text, runs } = index(doc);
    const out: Range[] = [];
    for (const m of findInText(req.query, text)) {
      const a = at(runs, m.start, false);
      const b = at(runs, m.end, true);
      if (!a || !b) continue;
      const r = doc.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      out.push(r);
    }
    return out;
  };
  const paint = (list: Range[]) => {
    const doc = getDoc();
    const win = doc?.defaultView as (Window & { CSS?: HighlightApi; Highlight?: new (...r: Range[]) => unknown }) | null;
    if (!doc || !win?.CSS?.highlights || !win.Highlight) return;
    if (!doc.getElementById('nova-find-style')) {
      const st = doc.createElement('style');
      st.id = 'nova-find-style';
      st.textContent = HIGHLIGHT_CSS;
      doc.head.appendChild(st);
    }
    win.CSS.highlights.set('nova-find', new win.Highlight(...list));
    if (list[cur]) win.CSS.highlights.set('nova-find-cur', new win.Highlight(list[cur]!));
    else win.CSS.highlights.delete('nova-find-cur');
    list[cur]?.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  };
  const status = (list: Range[]): FindStatus => ({ count: list.length, current: list.length ? cur : -1 });
  return {
    features: { modes: ['normal', 'wildcards', 'regex'], replace: false, special: true },
    selectionText: () => getDoc()?.getSelection()?.toString() ?? '',
    find(req) {
      last = req;
      const list = ranges(req);
      cur = list.length ? 0 : -1;
      paint(list);
      return status(list);
    },
    step(dir) {
      if (!last) return { count: 0, current: -1 };
      const list = ranges(last);
      if (list.length) cur = (cur + dir + list.length) % list.length;
      paint(list);
      return status(list);
    },
    replaceCurrent: () => ({ count: 0, current: -1 }),
    replaceAll: () => 0,
    clear() {
      cur = -1;
      const win = getDoc()?.defaultView as (Window & { CSS?: HighlightApi }) | null;
      win?.CSS?.highlights?.delete('nova-find');
      win?.CSS?.highlights?.delete('nova-find-cur');
    },
  };
}
