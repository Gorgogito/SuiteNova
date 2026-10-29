import { defaultSection, sectionAttrs, sectionList, ptToPx, type NoteRef, type SectionInfo } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

/**
 * Visual pagination.
 *
 * The document is edited as one continuous column. After every change the page breaks are computed by measuring the
 * natural layout (with the spacers hidden) and spacer widgets are inserted at the break points. Each spacer is exactly as
 * tall as "rest of the page + bottom margin of this page + gap + top margin of the next page", so the pages are drawn by
 * a separate overlay and the text always falls inside the page rectangles. Pages may differ in size from section to
 * section: the overlay adds the heights of the pages it knows about.
 *
 * Sections with columns that span several pages use CSS multi-column with `column-wrap`: every "row" of columns is a page.
 * Footnotes reserve room at the bottom of the page of their reference.
 */

/** Gap between pages on screen, px. */
export const PAGE_GAP = 20;
/** Height of the footnote separator, px. */
export const NOTE_SEP = 14;

export type BreakKind = 'block' | 'line' | 'row' | 'endnote';
export interface PageBreak {
  pos: number;
  kind: BreakKind;
  /** Spacer height without the screen gap, px. */
  base: number;
  /** Number of columns of the table (row breaks only). */
  cols?: number;
  /** Index of the endnote that starts the page (endnote breaks only). */
  index?: number;
}

/** What the layout learned about one page. */
export interface PageSpec {
  section: number;
  blank: boolean;
  notes: string[];
  /** Page number shown (after section restarts). */
  number: number;
  /** 0-based page inside its section. */
  inSection: number;
}

export interface PaginationState {
  deco: DecorationSet;
  pages: number;
  pageSpecs: PageSpec[];
  signature: string;
  nonce: number;
  /** The page breaks of the last layout (positions follow the document). */
  breaks: PageBreak[];
  /** How each column section is laid out: balanced on its page or as rows of columns (one row per page). */
  colModes: Record<string, 'balanced' | 'paged'>;
  /** Pagination is off (web layout and outline views). */
  off: boolean;
}

export const paginationKey = new PluginKey<PaginationState>('pagination');

const EPS = 0.75;

interface Line {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function groupLines(rects: DOMRect[], originTop: number, s: number): Line[] {
  const items = rects
    .filter((r) => r.height > 0 || r.width > 0)
    .map((r) => ({ top: (r.top - originTop) / s, bottom: (r.bottom - originTop) / s, left: r.left, right: r.right }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Line[] = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    // rects of one line overlap vertically by more than half of the shorter one
    if (last && it.top < last.bottom - Math.min(it.bottom - it.top, last.bottom - last.top) * 0.5) {
      last.top = Math.min(last.top, it.top);
      last.bottom = Math.max(last.bottom, it.bottom);
      last.left = Math.min(last.left, it.left);
      last.right = Math.max(last.right, it.right);
    } else lines.push({ ...it });
  }
  return lines;
}

/** Rectangles of the text and images of a paragraph, leaving out floating shapes and text boxes (they do not make lines). */
function rangeRects(el: HTMLElement): DOMRect[] {
  const out: DOMRect[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || parent.closest('.nw-shape') || parent.closest('.nw-fnref') || parent.closest('.nw-gap')) continue;
    if (!(n as Text).data.length) continue;
    r.selectNodeContents(n);
    out.push(...r.getClientRects());
  }
  el.querySelectorAll('img').forEach((img) => {
    if (!img.closest('.nw-shape')) out.push(img.getBoundingClientRect());
  });
  el.querySelectorAll('.nw-math, .nw-field, .nw-fnref').forEach((m) => out.push(...m.getClientRects()));
  return out;
}

interface Unit {
  pos: number;
  top: number;
  bottom: number;
  mb: number;
  prevBottom: number;
  prevMargin: number;
  keepNext: boolean;
  reserved: number;
  notes: string[];
}

export interface MeasureContext {
  /** Height of the footnote with the given reference node when laid out `widthPx` wide. */
  noteHeight(node: PMNode, widthPx: number): number;
  colModes: Record<string, 'balanced' | 'paged'>;
}

export interface Layout {
  breaks: PageBreak[];
  pages: PageSpec[];
  colModes: Record<string, 'balanced' | 'paged'>;
}

const hasClass = (el: Element, c: string) => el.classList.contains(c);

export function measureLayout(view: EditorView, host: HTMLElement, ctx: MeasureContext): Layout {
  const sections = sectionList(view.state.doc);
  const colModes = { ...ctx.colModes };
  const geo = (s: SectionInfo) => {
    const p = s.props.page;
    return { H: ptToPx(p.height - p.marginTop - p.marginBottom), mt: ptToPx(p.marginTop), mb: ptToPx(p.marginBottom), pageH: ptToPx(p.height), pageW: ptToPx(p.width), width: ptToPx(p.width - p.marginLeft - p.marginRight) };
  };
  if (!sections.length) return { breaks: [], pages: [{ section: 0, blank: false, notes: [], number: 1, inSection: 0 }], colModes };

  host.classList.add('nw-measuring');
  try {
    const dom = view.dom as HTMLElement;
    const domRect = dom.getBoundingClientRect();
    const s = dom.offsetWidth ? domRect.width / dom.offsetWidth || 1 : 1;
    const originTop = domRect.top;
    const rel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: (r.top - originTop) / s, bottom: (r.bottom - originTop) / s };
    };
    const marginBottomOf = (el: Element) => parseFloat(getComputedStyle(el).marginBottom) || 0;

    const breaks: PageBreak[] = [];
    const pages: PageSpec[] = [{ section: 0, blank: false, notes: [], number: sections[0]!.props.pgNumStart ?? 1, inSection: 0 }];
    const spec = (section: number, blank: boolean): PageSpec => {
      const prev = pages[pages.length - 1]!;
      const newSection = section !== prev.section;
      const restart = newSection ? sections[section]!.props.pgNumStart : null;
      return { section, blank, notes: [], number: restart ?? prev.number + 1, inSection: newSection ? 0 : prev.inSection + 1 };
    };
    let sec = 0; // section being read
    let g = geo(sections[0]!);
    let H = g.H;
    let mbPage = g.mb;
    let pageStart = 0;
    let prevBottom = 0;
    let prevMargin = 0;
    let forceNext = false;
    let lastUnit: Unit | null = null;
    /** Room taken at the bottom of the current page by the footnotes of its lines. */
    let reserved = 0;
    let pageNotes: string[] = [];

    const isTop = (y: number) => Math.abs(y - pageStart) < 1.5;
    const startPage = (next: number, blank = false) => {
      pages[pages.length - 1]!.notes = pageNotes;
      pageNotes = [];
      reserved = 0;
      if (blank) pages.push(spec(next, true));
      g = geo(sections[next]!);
      H = g.H;
      pages.push(spec(next, false));
    };
    const breakBefore = (pos: number, nextTop: number, kind: BreakKind, cols?: number, nextSection = sec, blank = false) => {
      const next = geo(sections[nextSection]!);
      const filler = Math.max(0, H - (prevBottom - pageStart) - prevMargin);
      const extra = blank ? ptToPx(sections[nextSection]!.props.page.height) + PAGE_GAP : 0;
      breaks.push({ pos, kind, base: filler + mbPage + next.mt + extra, cols });
      pageStart = nextTop;
      lastUnit = null;
      startPage(nextSection, blank);
      mbPage = next.mb;
    };
    const place = (pos: number, top: number, bottom: number, mb: number, keepNext: boolean) => {
      lastUnit = { pos, top, bottom, mb, prevBottom, prevMargin, keepNext, reserved, notes: [...pageNotes] };
      prevBottom = bottom;
      prevMargin = mb;
    };
    /** The page cannot take the block: start a new page before it (dragging a keep-with-next heading along). */
    const moveToNextPage = (pos: number, top: number) => {
      const u = lastUnit as Unit | null;
      if (u && u.keepNext && !isTop(u.top)) {
        prevBottom = u.prevBottom;
        prevMargin = u.prevMargin;
        reserved = u.reserved;
        pageNotes = u.notes.slice();
        breakBefore(u.pos, u.top, 'block');
        place(u.pos, u.top, u.bottom, u.mb, true);
      } else breakBefore(pos, top, 'block');
    };
    const pageEmpty = () => {
      const u = lastUnit as Unit | null;
      return !u || (isTop(u.top) && u.keepNext);
    };
    const dom1 = (pos: number): HTMLElement | null => {
      const n = view.nodeDOM(pos);
      return n && n.nodeType === 1 ? (n as HTMLElement) : null;
    };
    const keepsWithNext = (n: PMNode) => !!n.attrs.keepNext || /^Heading\d$/.test(n.attrs.style ?? '') || n.attrs.style === 'Title' || n.attrs.style === 'Subtitle';
    const lineStartPos = (pos: number, node: PMNode, line: Line): number => {
      const y = originTop + ((line.top + line.bottom) / 2) * s;
      const hit = view.posAtCoords({ left: line.left + 1, top: y });
      const lo = pos + 1;
      const hi = pos + node.nodeSize - 1;
      return hit ? Math.min(hi, Math.max(lo, hit.pos)) : lo;
    };

    // footnote references inside an element, with the height each note will need
    interface Ref {
      id: string;
      h: number;
      y: number;
    }
    const noteRefs = (el: HTMLElement, pos: number, node: PMNode): Ref[] => {
      const out: Ref[] = [];
      node.descendants((n, off) => {
        if (n.type.name === 'footnote' && n.attrs.kind !== 'endnote') {
          const d = view.nodeDOM(pos + 1 + off) as HTMLElement | null;
          const r = d && d.nodeType === 1 ? d.getBoundingClientRect() : null;
          if (r) out.push({ id: n.attrs.id, h: ctx.noteHeight(n, g.width), y: (r.top - originTop) / s });
        }
        return true;
      });
      void el;
      return out;
    };
    const noteSpace = (refs: Ref[]): number => (refs.length ? refs.reduce((a, r) => a + r.h, 0) + (reserved === 0 ? NOTE_SEP : 0) : 0);

    function flowParagraph(node: PMNode, pos: number, breakPos: number) {
      const el = dom1(pos);
      if (!el) return;
      const { top, bottom } = rel(el);
      const mb = marginBottomOf(el);
      const keep = keepsWithNext(node);
      if ((forceNext || node.attrs.pageBreakBefore) && lastUnit) breakBefore(breakPos, top, 'block');
      forceNext = false;
      const refs = noteRefs(el, pos, node);
      const all = noteSpace(refs);
      if (bottom - pageStart <= H - reserved - all + EPS) {
        if (refs.length) {
          reserved += all;
          pageNotes.push(...refs.map((r) => r.id));
        }
        place(breakPos, top, bottom, mb, keep);
        return;
      }
      const lines = groupLines(rangeRects(el), originTop, s);
      const total = lines.length;
      let i = 0;
      for (let guard = 0; guard < 400; guard++) {
        // first line (from i) that does not fit once the notes of the lines before it are counted
        let j = -1;
        let acc = 0;
        for (let idx = i; idx < total; idx++) {
          const l = lines[idx]!;
          const here = refs.filter((r) => r.y >= l.top - 1 && r.y < l.bottom + 1);
          const need = here.length ? here.reduce((a, r) => a + r.h, 0) + (reserved === 0 && acc === 0 ? NOTE_SEP : 0) : 0;
          acc += need;
          if (l.bottom - pageStart > H - reserved - acc + EPS) {
            j = idx;
            break;
          }
        }
        if (j === -1) {
          const rest = refs.filter((r) => lines.length && r.y >= (lines[i]?.top ?? 0) - 1);
          if (rest.length) {
            reserved += rest.reduce((a, r) => a + r.h, 0) + (reserved === 0 ? NOTE_SEP : 0);
            pageNotes.push(...rest.map((r) => r.id));
          }
          place(breakPos, top, bottom, mb, keep);
          return;
        }
        let split = j;
        if (total >= 4) {
          if (total - split < 2) split = total - 2; // widow control
          if (i === 0 && split < 2) split = 0; // orphan control: move the whole paragraph
        } else if (i === 0) split = 0; // short paragraphs are not split
        if (split <= i) {
          if (i === 0 && !pageEmpty()) {
            moveToNextPage(breakPos, top);
            continue;
          }
          // nothing can be gained by moving it: split where it overflows, or let it overflow whole
          split = Math.max(i + 1, j);
          if (split >= total || j === 0) {
            place(breakPos, top, bottom, mb, keep);
            return;
          }
        }
        // notes of the lines that stay on this page
        const stay = refs.filter((r) => r.y >= (lines[i]?.top ?? 0) - 1 && r.y < lines[split]!.top - 1);
        if (stay.length) {
          reserved += stay.reduce((a, r) => a + r.h, 0) + (reserved === 0 ? NOTE_SEP : 0);
          pageNotes.push(...stay.map((r) => r.id));
        }
        prevBottom = lines[split - 1]!.bottom;
        prevMargin = 0;
        breakBefore(lineStartPos(pos, node, lines[split]!), lines[split]!.top, 'line');
        i = split;
      }
      place(breakPos, top, bottom, mb, keep);
    }

    function flowTable(node: PMNode, pos: number) {
      const el = dom1(pos);
      if (!el) return;
      const { top, bottom } = rel(el);
      const mb = marginBottomOf(el);
      let cols = 0;
      node.firstChild?.forEach((c) => (cols += c.attrs.colspan ?? 1));
      if (forceNext && lastUnit) breakBefore(pos, top, 'block');
      forceNext = false;
      const take = (refs: Ref[]) => {
        if (!refs.length) return;
        reserved += refs.reduce((a, r) => a + r.h, 0) + (reserved === 0 ? NOTE_SEP : 0);
        pageNotes.push(...refs.map((r) => r.id));
      };
      const tableRefs = noteRefs(el, pos, node);
      if (bottom - pageStart <= H - reserved - noteSpace(tableRefs) + EPS) {
        take(tableRefs);
        place(pos, top, bottom, mb, false);
        return;
      }
      const rows: { pos: number; top: number; bottom: number; node: PMNode }[] = [];
      node.forEach((row, off) => {
        const rp = pos + 1 + off;
        const rEl = dom1(rp);
        if (rEl) rows.push({ pos: rp, node: row, ...rel(rEl) });
      });
      let i = 0;
      for (let guard = 0; guard < 400; guard++) {
        const j = rows.findIndex((r, idx) => idx >= i && r.bottom - pageStart > H - reserved + EPS);
        if (j === -1) {
          for (let k = i; k < rows.length; k++) take(noteRefs(dom1(rows[k]!.pos)!, rows[k]!.pos, rows[k]!.node));
          place(pos, top, bottom, mb, false);
          return;
        }
        if (j === i) {
          if (i === 0 && !pageEmpty()) {
            moveToNextPage(pos, top);
            continue;
          }
          // a row taller than the page stays whole; the next row starts a new page
          if (j + 1 >= rows.length) {
            place(pos, top, bottom, mb, false);
            return;
          }
          prevBottom = rows[j]!.bottom;
          prevMargin = 0;
          breakBefore(rows[j + 1]!.pos, rows[j + 1]!.top, 'row', cols);
          i = j + 1;
          continue;
        }
        for (let k = i; k < j; k++) take(noteRefs(dom1(rows[k]!.pos)!, rows[k]!.pos, rows[k]!.node));
        prevBottom = rows[j - 1]!.bottom;
        prevMargin = 0;
        breakBefore(rows[j]!.pos, rows[j]!.top, 'row', cols);
        i = j;
      }
      place(pos, top, bottom, mb, false);
    }

    function flowSection(node: PMNode, pos: number, index: number) {
      const info = sections[index]!;
      const el = dom1(pos);
      if (!el) return;
      const first = index === 0;
      const start = info.props.start;
      const prev = sections[index - 1];
      const sameSize = !prev || (Math.abs(prev.props.page.width - info.props.page.width) < 1 && Math.abs(prev.props.page.height - info.props.page.height) < 1);
      const newPage = !first && (start !== 'continuous' || !sameSize);
      sec = index;
      if (first) {
        g = geo(info);
        H = g.H;
        mbPage = g.mb;
        pages[0]!.section = 0;
      }
      const cols = info.props.cols.count;
      const secTop = rel(el).top;
      if (newPage) {
        // even / odd page starts may need a blank page in between
        let blank = false;
        if (start === 'evenPage' || start === 'oddPage') {
          const nextNumber = spec(index, false).number;
          blank = start === 'evenPage' ? nextNumber % 2 !== 0 : nextNumber % 2 === 0;
        }
        breakBefore(pos, secTop, 'block', undefined, index, blank);
        forceNext = false;
      } else if (!first) {
        // a continuous section: the governing section of the page stays, the width changes (done by CSS)
      }
      if (cols <= 1) {
        node.forEach((child, off) => flow(child, pos + 1 + off));
        return;
      }
      const mode = colModes[info.props.id] ?? (start === 'continuous' && !first ? 'balanced' : 'paged');
      colModes[info.props.id] = mode;
      const top = rel(el).top;
      const bottom = rel(el).bottom;
      const mb = marginBottomOf(el);
      const m = geo(info);
      if (mode === 'balanced') {
        if (bottom - pageStart <= H + EPS) {
          place(pos, top, bottom, mb, false);
          return;
        }
        // does not fit on the rest of the page: lay it out as rows of columns on a page of its own
        colModes[info.props.id] = 'paged';
        place(pos, top, bottom, mb, false);
        return;
      }
      // rows of columns: one row per page
      if (!pageEmpty() && !isTop(top)) {
        breakBefore(pos, top, 'block', undefined, index);
      }
      const t0 = rel(el).top;
      const h = rel(el).bottom - t0;
      const rowH = m.H + m.mt + m.mb;
      const rows = Math.max(1, Math.round((h + m.mt + m.mb) / rowH));
      for (let r = 1; r < rows; r++) {
        pages[pages.length - 1]!.notes = [];
        pages.push(spec(index, false));
      }
      pageStart = t0 + (rows - 1) * rowH;
      prevBottom = pageStart + H;
      prevMargin = 0;
      lastUnit = { pos, top: t0, bottom: pageStart + H, mb, prevBottom, prevMargin, keepNext: false, reserved: 0, notes: [] };
    }

    function flow(node: PMNode, pos: number, breakPos = pos) {
      switch (node.type.name) {
        case 'paragraph':
          flowParagraph(node, pos, breakPos);
          break;
        case 'table':
          flowTable(node, pos);
          break;
        case 'bullet_list':
        case 'ordered_list':
          node.forEach((li, off) => {
            const liPos = pos + 1 + off;
            li.forEach((child, coff) => flow(child, liPos + 1 + coff, coff === 0 ? liPos : liPos + 1 + coff));
          });
          break;
        case 'page_break':
          forceNext = true;
          break;
        case 'section':
          break;
        default:
          if (node.isBlock && !node.isTextblock && !node.isLeaf && node.childCount) node.forEach((child, off) => flow(child, pos + 1 + off));
          else if (node.isBlock) {
            const el = dom1(pos);
            if (el) {
              const { top, bottom } = rel(el);
              if (forceNext && lastUnit) breakBefore(pos, top, 'block');
              forceNext = false;
              if (bottom - pageStart > H - reserved + EPS && !pageEmpty()) moveToNextPage(pos, top);
              place(pos, top, bottom, marginBottomOf(el), false);
            }
          }
          break;
      }
    }

    view.state.doc.forEach((node, off) => {
      if (node.type.name === 'section') {
        const index = sections.findIndex((x) => x.pos === off);
        flowSection(node, off, index);
      } else flow(node, off);
    });
    // the list of endnotes at the end of the last section: each note is a unit, a page may break between two of them
    const enItems = [...dom.querySelectorAll<HTMLElement>('.nw-en-item')];
    enItems.forEach((el, i) => {
      const { top, bottom } = rel(el);
      const mb = marginBottomOf(el);
      if (i > 0 && bottom - pageStart > H - reserved + EPS && !pageEmpty()) {
        breakBefore(-1 - i, top, 'endnote');
        breaks[breaks.length - 1]!.index = i;
      }
      place(-1 - i, top, bottom, mb, false);
    });
    pages[pages.length - 1]!.notes = pageNotes;
    void hasClass;
    return { breaks, pages, colModes };
  } finally {
    host.classList.remove('nw-measuring');
  }
}

function spacer(b: PageBreak): HTMLElement {
  const css = `height:calc(${b.base.toFixed(2)}px + var(--nw-gap, 0px))`;
  if (b.kind === 'row') {
    const tr = document.createElement('tr');
    tr.className = 'nw-gap-row';
    tr.setAttribute('contenteditable', 'false');
    const td = document.createElement('td');
    td.colSpan = Math.max(1, b.cols ?? 1);
    td.setAttribute('style', css);
    tr.appendChild(td);
    return tr;
  }
  const d = document.createElement('div');
  d.className = 'nw-gap';
  d.setAttribute('contenteditable', 'false');
  d.setAttribute('aria-hidden', 'true');
  d.setAttribute('style', css);
  return d;
}

function buildDecorations(doc: PMNode, breaks: PageBreak[], colModes: Record<string, 'balanced' | 'paged'>, endnotes?: PaginationHooks['endnotes']): DecorationSet {
  const decos: Decoration[] = breaks.filter((b) => b.kind !== 'endnote').map((b) => Decoration.widget(b.pos, () => spacer(b), { side: -1, key: `${b.kind}${b.pos}:${b.base.toFixed(1)}:${b.cols ?? 0}`, ignoreSelection: true, stopEvent: () => true }));
  if (endnotes) {
    const en = new Map<number, number>();
    for (const b of breaks) if (b.kind === 'endnote' && b.index !== undefined) en.set(b.index, b.base);
    const sig = endnotes.signature(doc);
    if (sig) decos.push(Decoration.widget(Math.max(0, doc.content.size - 1), () => endnotes.render(doc, en) ?? document.createElement('span'), { side: 1, key: `en:${sig}:${[...en].join(',')}`, ignoreSelection: true, stopEvent: () => true }));
  }
  doc.forEach((node, off) => {
    if (node.type.name === 'section' && colModes[node.attrs.id] === 'paged' && (node.attrs.cols?.count ?? 1) > 1) decos.push(Decoration.node(off, off + node.nodeSize, { class: 'nw-paged' }));
  });
  return DecorationSet.create(doc, decos);
}

export interface PaginationHooks {
  host: () => HTMLElement | null;
  context: () => Omit<MeasureContext, 'colModes'>;
  enabled: () => boolean;
  onLayout: (pages: PageSpec[]) => void;
  /** The list of endnotes drawn after the last paragraph of the document. */
  endnotes?: { signature(doc: PMNode): string; render(doc: PMNode, breaks: Map<number, number>): HTMLElement | null };
}

/** Keep the document shaped as `section+`: blocks that end up outside a section (pasting, replacing everything) join one. */
export function sectionFixup(): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state: EditorState) {
      if (!trs.some((t) => t.docChanged)) return null;
      let tr = state.tr;
      let changed = false;
      for (let guard = 0; guard < 30; guard++) {
        const doc = tr.doc;
        let from = -1;
        let to = -1;
        let index = 0;
        doc.forEach((n, off, i) => {
          if (from === -1 && n.type.name !== 'section') {
            from = off;
            to = off + n.nodeSize;
            index = i;
          } else if (from !== -1 && to === off && n.type.name !== 'section') to = off + n.nodeSize;
        });
        if (from === -1) break;
        const range = doc.resolve(from).blockRange(doc.resolve(to));
        if (!range) break;
        tr = tr.wrap(range, [{ type: state.schema.nodes.section!, attrs: sectionAttrs(defaultSection()) }]);
        if (index > 0) tr = tr.join(from);
        changed = true;
      }
      return changed ? tr.setMeta('addToHistory', false) : null;
    },
  });
}

/** Make sure every section ends with a paragraph (so there is a place to type after a table or page break). */
export function trailingParagraph(): Plugin {
  return new Plugin({
    appendTransaction(_trs, _old, state: EditorState) {
      let tr = state.tr;
      let changed = false;
      const para = state.schema.nodes.paragraph!;
      const fixes: number[] = [];
      state.doc.forEach((sec, off) => {
        const last = sec.lastChild;
        if (sec.type.name === 'section' && last && last.type.name !== 'paragraph') fixes.push(off + sec.nodeSize - 1);
        else if (sec.type.name !== 'section' && off + sec.nodeSize === state.doc.content.size && sec.type.name !== 'paragraph') fixes.push(state.doc.content.size);
      });
      for (const at of fixes.reverse()) {
        tr = tr.insert(at, para.create());
        changed = true;
      }
      return changed ? tr.setMeta('addToHistory', false) : null;
    },
  });
}

export function paginationPlugin(hooks: PaginationHooks): Plugin<PaginationState> {
  return new Plugin<PaginationState>({
    key: paginationKey,
    state: {
      init: (_c, state) => ({ deco: hooks.endnotes ? buildDecorations(state.doc, [], {}, hooks.endnotes) : DecorationSet.create(state.doc, []), breaks: [], pages: 1, pageSpecs: [{ section: 0, blank: false, notes: [], number: 1, inSection: 0 }], signature: '', nonce: 0, colModes: {}, off: false }),
      apply(tr, value) {
        const meta = tr.getMeta(paginationKey) as { layout?: Layout; remeasure?: boolean; off?: boolean } | undefined;
        if (meta?.layout) {
          const l = meta.layout;
          return { ...value, deco: buildDecorations(tr.doc, l.breaks, l.colModes, hooks.endnotes), breaks: l.breaks, pages: l.pages.length, pageSpecs: l.pages, colModes: l.colModes, signature: JSON.stringify([l.breaks, l.pages, l.colModes]) };
        }
        if (meta?.off !== undefined) return { ...value, off: meta.off, nonce: value.nonce + 1, deco: meta.off ? DecorationSet.empty : value.deco };
        if (!tr.docChanged) return meta?.remeasure ? { ...value, nonce: value.nonce + 1 } : value;
        const breaks = value.breaks.map((b) => (b.kind === 'endnote' ? b : { ...b, pos: tr.mapping.map(b.pos) }));
        const deco = value.off ? value.deco : buildDecorations(tr.doc, breaks, value.colModes, hooks.endnotes);
        return { ...value, deco, breaks, nonce: meta?.remeasure ? value.nonce + 1 : value.nonce };
      },
    },
    props: {
      decorations: (state) => {
        const st = paginationKey.getState(state);
        return st && !st.off ? st.deco : undefined;
      },
    },
    view(initial) {
      let raf = 0;
      let alive = true;
      let flips = 0;
      const run = (view: EditorView) => {
        raf = 0;
        const host = hooks.host();
        if (!alive || !host || !host.isConnected) return;
        const cur = paginationKey.getState(view.state);
        if (!cur) return;
        if (!hooks.enabled()) {
          if (cur.pages !== 1 || cur.deco.find().length) {
            view.dispatch(view.state.tr.setMeta(paginationKey, { layout: { breaks: [], pages: [{ section: 0, blank: false, notes: [], number: 1, inSection: 0 }], colModes: cur.colModes } }).setMeta('addToHistory', false));
          }
          hooks.onLayout(cur.pageSpecs);
          return;
        }
        const layout = measureLayout(view, host, { ...hooks.context(), colModes: cur.colModes });
        const sig = JSON.stringify([layout.breaks, layout.pages, layout.colModes]);
        // the mapped decorations can disappear when a whole range is replaced, so also compare their number
        // compare with the breaks as they are NOW (mapped through the edits), not with the last measured signature: an edit can move
        // the stored positions while the new measurement comes out equal to the old one
        const nowSig = JSON.stringify([cur.breaks, cur.pageSpecs, cur.colModes]);
        if (sig !== cur.signature || sig !== nowSig || cur.deco.find().filter((d) => (d.spec as { key?: string } | undefined)?.key !== undefined).length !== layout.breaks.length) {
          view.dispatch(view.state.tr.setMeta(paginationKey, { layout }).setMeta('addToHistory', false));
          // a column section changed mode: measure again with the new classes (bounded, so it cannot loop)
          if (JSON.stringify(layout.colModes) !== JSON.stringify(cur.colModes) && flips++ < 4) schedule(view);
          else flips = 0;
        }
        hooks.onLayout(layout.pages);
      };
      const schedule = (view: EditorView) => {
        if (!raf) raf = requestAnimationFrame(() => run(view));
      };
      schedule(initial);
      return {
        update(view, prev) {
          if (!prev.doc.eq(view.state.doc) || paginationKey.getState(prev)?.nonce !== paginationKey.getState(view.state)?.nonce) schedule(view);
        },
        destroy() {
          alive = false;
          if (raf) cancelAnimationFrame(raf);
        },
      };
    },
  });
}

/** Ask the plugin of `view` to measure again (page setup, fonts or images changed). */
export function repaginate(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(paginationKey, { remeasure: true }).setMeta('addToHistory', false));
}

/** Turn pagination on or off (web layout and outline views do not paginate). */
export function setPaginationOff(view: EditorView, off: boolean): void {
  view.dispatch(view.state.tr.setMeta(paginationKey, { off }).setMeta('addToHistory', false));
}

export type { NoteRef };
