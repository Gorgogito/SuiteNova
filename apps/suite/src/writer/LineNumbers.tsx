import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { ptToPx, type LineNumbers as LineNumberProps } from '@suitenova/writer-core';
import type { WriterCtl } from './doc';

export interface LineMark {
  /** Distance from the top of the sheet (px, zoom 100 %) and the left edge of the text it numbers. */
  top: number;
  left: number;
  /** Line height in px, to centre the number. */
  height: number;
  text: string;
  /** Gap between the number and the text, px. */
  gap: number;
}

/** Number the lines of the sections that ask for it. `lines` are the lines of every section in document order. */
export function numberLines(
  sections: { props: LineNumberProps | null; lines: { top: number; left: number; height: number }[] }[],
  pageOf: (top: number) => number,
): LineMark[] {
  const out: LineMark[] = [];
  let counter = 0;
  let lastPage = -1;
  sections.forEach((sec, i) => {
    const p = sec.props;
    if (!p) return;
    if (p.restart === 'newSection' || i === 0 || !sections[i - 1]?.props) counter = p.start - 1;
    lastPage = -1;
    for (const l of sec.lines) {
      const page = pageOf(l.top);
      if (p.restart === 'newPage' && page !== lastPage) counter = p.start - 1;
      lastPage = page;
      counter++;
      if (counter % p.countBy === 0) out.push({ top: l.top, left: l.left, height: l.height, text: String(counter), gap: ptToPx(p.distance) });
    }
  });
  return out;
}

/** The lines of the paragraphs of a section element (tables, notes and paragraphs that opt out are skipped). */
function linesOf(section: Element, origin: DOMRect, scale: number): { top: number; left: number; height: number }[] {
  const out: { top: number; left: number; height: number }[] = [];
  section.querySelectorAll('p.nw-p').forEach((p) => {
    if (p.closest('td, th, .nw-note, .nw-hf') || p.hasAttribute('data-no-ln')) return;
    const box = p.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top);
    const lines: DOMRect[] = [];
    for (const r of rects) {
      const last = lines[lines.length - 1];
      if (last && r.top < last.top + last.height * 0.6) continue; // same line
      lines.push(r);
    }
    const left = (section.getBoundingClientRect().left - origin.left) / scale;
    if (!lines.length) {
      if (box.height > 0) out.push({ top: (box.top - origin.top) / scale, left, height: Math.min(box.height, 24) / scale });
      return;
    }
    for (const r of lines) out.push({ top: (r.top - origin.top) / scale, left, height: r.height / scale });
  });
  return out;
}

/** Line numbers drawn in the margin beside the text, over the page. */
export function LineNumbersLayer({ ctl }: { ctl: WriterCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const [marks, setMarks] = useState<LineMark[]>([]);
  const secs = ctl.sections();
  const wanted = secs.some((s) => s.props.lineNumbers);
  const key = secs.map((s) => JSON.stringify(s.props.lineNumbers)).join('|');
  useLayoutEffect(() => {
    const view = ctl.view;
    const host = view?.dom.closest('.nw-sheet, .nw-zoomwrap') ?? view?.dom.parentElement;
    const pages = host?.querySelector('.nw-pages') as HTMLElement | null;
    if (!view || !pages || !wanted) {
      setMarks((m) => (m.length ? [] : m));
      return;
    }
    const origin = pages.getBoundingClientRect();
    const scale = pages.offsetWidth ? origin.width / pages.offsetWidth : 1;
    const rects = ctl.pageRects();
    const pageOf = (top: number) => {
      for (let i = 0; i < rects.length; i++) if (top < rects[i]!.top + rects[i]!.height + 10) return i;
      return Math.max(0, rects.length - 1);
    };
    const doms = [...view.dom.querySelectorAll(':scope > section.nw-section')];
    const list = secs.map((s, i) => ({ props: s.props.lineNumbers, lines: s.props.lineNumbers && doms[i] ? linesOf(doms[i]!, origin, scale) : [] }));
    const next = numberLines(list, pageOf);
    setMarks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });
  if (!wanted) return null;
  void key;
  return (
    <div className="nw-linenumbers" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      {marks.map((m, i) => (
        <span key={i} className="nw-ln" style={{ position: 'absolute', top: m.top, height: m.height, lineHeight: `${m.height}px`, left: m.left - m.gap - 40, width: 40, textAlign: 'right', fontSize: 10, color: '#555' }}>
          {m.text}
        </span>
      ))}
    </div>
  );
}
