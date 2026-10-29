import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

/** A custom tab stop of a paragraph. `pos` is measured from the left margin, in points. */
export interface TabStop {
  pos: number;
  kind: 'left' | 'center' | 'right' | 'decimal' | 'bar';
  leader?: 'none' | 'dot' | 'hyphen' | 'underscore' | 'middleDot';
}

interface TabsState {
  /** Width in px of each tab character (by position), measured after layout. */
  widths: Map<number, number>;
  deco: DecorationSet;
}

export const tabsKey = new PluginKey<TabsState>('tabs');

const PX = 96 / 72;
/** Default tab stops (Word: every 1.27 cm = 36 pt) after the last custom one. */
const DEFAULT_STOP_PX = 36 * PX;

const stopsOf = (node: PMNode): TabStop[] => (Array.isArray(node.attrs.tabs) ? (node.attrs.tabs as TabStop[]) : []);

const LEADERS: Record<string, string> = {
  dot: 'radial-gradient(circle at 50% 85%, currentColor 0.6px, transparent 0.9px)',
  middleDot: 'radial-gradient(circle at 50% 55%, currentColor 0.6px, transparent 0.9px)',
  hyphen: 'linear-gradient(to right, currentColor 3px, transparent 3px)',
  underscore: 'linear-gradient(to top, currentColor 1px, transparent 1px)',
};
const LEADER_SIZE: Record<string, string> = { dot: '4px 100%', middleDot: '4px 100%', hyphen: '6px 100%', underscore: '100% 100%' };

function tabStyle(width: number, stop: TabStop | undefined): string {
  const leader = stop?.leader && stop.leader !== 'none' ? stop.leader : null;
  let css = `display:inline-block;white-space:pre;overflow:hidden;vertical-align:bottom;width:${width.toFixed(2)}px`;
  if (leader) css += `;background-image:${LEADERS[leader]};background-size:${LEADER_SIZE[leader]};background-repeat:${leader === 'underscore' ? 'no-repeat' : 'repeat-x'}`;
  return css;
}

/** The stop each tab character of a paragraph runs to, in order, for the leader (the width itself comes from layout). */
function tabsOfParagraph(node: PMNode, pos: number): number[] {
  const out: number[] = [];
  node.forEach((child, off) => {
    if (!child.isText) return;
    const text = child.text!;
    for (let i = text.indexOf('\t'); i !== -1; i = text.indexOf('\t', i + 1)) out.push(pos + 1 + off + i);
  });
  return out;
}

function build(doc: PMNode, widths: Map<number, number>): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const stops = stopsOf(node);
    if (!stops.length) return false;
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    tabsOfParagraph(node, pos).forEach((at, i) => {
      const w = widths.get(at) ?? 0;
      decos.push(Decoration.inline(at, at + 1, { class: 'nw-tab', nodeName: 'span', style: tabStyle(w, sorted[Math.min(i, sorted.length - 1)]) }));
    });
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/**
 * Tab stops. A paragraph with custom stops gets every tab character wrapped in an inline box whose width is measured
 * after layout so that the text that follows lines up with the next stop (left, centered, right or on the decimal
 * point), with an optional leader (dots, hyphens, underscore).
 */
export function tabsPlugin(): Plugin<TabsState> {
  return new Plugin<TabsState>({
    key: tabsKey,
    state: {
      init: (_c, s) => ({ widths: new Map(), deco: build(s.doc, new Map()) }),
      apply(tr, v) {
        const meta = tr.getMeta(tabsKey) as Map<number, number> | undefined;
        if (meta) return { widths: meta, deco: build(tr.doc, meta) };
        if (!tr.docChanged) return v;
        const widths = new Map<number, number>();
        v.widths.forEach((w, p) => {
          const m = tr.mapping.mapResult(p);
          if (!m.deleted) widths.set(m.pos, w);
        });
        return { widths, deco: build(tr.doc, widths) };
      },
    },
    props: { decorations: (state) => tabsKey.getState(state)?.deco },
    view(initial) {
      let raf = 0;
      const run = (view: EditorView) => {
        raf = 0;
        const next = measureTabs(view);
        const cur = tabsKey.getState(view.state)?.widths;
        if (!cur) return;
        let same = next.size === cur.size;
        if (same) for (const [p, w] of next) if (Math.abs((cur.get(p) ?? -9) - w) > 0.5) same = false;
        if (!same) view.dispatch(view.state.tr.setMeta(tabsKey, next).setMeta('addToHistory', false));
      };
      const schedule = (view: EditorView) => {
        if (!raf) raf = requestAnimationFrame(() => run(view));
      };
      schedule(initial);
      return {
        update(view, prev) {
          if (prev.doc !== view.state.doc) schedule(view);
        },
        destroy() {
          if (raf) cancelAnimationFrame(raf);
        },
      };
    },
  });
}

/** Measure the width every tab box needs; the DOM is left exactly as it was. */
export function measureTabs(view: EditorView): Map<number, number> {
  const out = new Map<number, number>();
  const dom = view.dom as HTMLElement;
  const scale = dom.offsetWidth ? dom.getBoundingClientRect().width / dom.offsetWidth || 1 : 1;
  view.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const stops = stopsOf(node);
    if (!stops.length) return false;
    const p = view.nodeDOM(pos) as HTMLElement | null;
    if (!p || p.nodeType !== 1) return false;
    const at = tabsOfParagraph(node, pos);
    const spans = [...p.querySelectorAll<HTMLElement>('span.nw-tab')];
    if (!spans.length || spans.length !== at.length) return false;
    const container = (p.parentElement as HTMLElement) ?? p;
    const cs = getComputedStyle(container);
    const origin = container.getBoundingClientRect().left + (parseFloat(cs.paddingLeft) || 0) * scale;
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    const saved = spans.map((s) => s.getAttribute('style'));
    for (const s of spans) s.style.width = '0px';
    spans.forEach((s, idx) => {
      const x = (s.getBoundingClientRect().left - origin) / scale;
      let stop: TabStop | null = sorted.find((t) => t.pos * PX > x + 1) ?? null;
      let stopPx: number;
      if (stop) stopPx = stop.pos * PX;
      else {
        stopPx = (Math.floor((x + 1) / DEFAULT_STOP_PX) + 1) * DEFAULT_STOP_PX;
        stop = { pos: stopPx / PX, kind: 'left' };
      }
      let w = stopPx - x;
      if (stop.kind === 'center' || stop.kind === 'right' || stop.kind === 'decimal') {
        // the text after the tab, up to the next tab or the end of the line
        const next = spans[idx + 1];
        const r = document.createRange();
        r.setStartAfter(s);
        if (next) r.setEndBefore(next);
        else r.setEnd(p, p.childNodes.length);
        let tw = r.getBoundingClientRect().width / scale;
        if (stop.kind === 'decimal') {
          const m = /[.,]/.exec(r.toString());
          if (m) {
            let remaining = m.index;
            const r2 = document.createRange();
            r2.setStartAfter(s);
            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (!(s.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
              const len = (n as Text).data.length;
              if (remaining <= len) {
                r2.setEnd(n, remaining);
                tw = r2.getBoundingClientRect().width / scale;
                break;
              }
              remaining -= len;
            }
          }
          w -= tw;
        } else w -= stop.kind === 'center' ? tw / 2 : tw;
      }
      w = Math.max(0, w);
      s.style.width = `${w.toFixed(2)}px`;
      out.set(at[idx]!, Math.round(w * 100) / 100);
    });
    spans.forEach((s, i) => {
      if (saved[i] === null) s.removeAttribute('style');
      else s.setAttribute('style', saved[i]!);
    });
    return false;
  });
  return out;
}
