import { MAX_COLS, MAX_ROWS, canonicalFormula, formatA1, hyperlinkAt, normRect, parseFormula, walk, type Hyperlink, type Rect } from '@suitenova/calc-engine';
import { useCore } from '@suitenova/core-ui';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CalcDoc } from './doc';
import { ENTRY_PENDING } from './doc-objects';
import { CellEditor } from './CellEditor';
import { ChartLayer } from './ChartLayer';
import { NoteLayer, ObjectLayer, ValidationHint } from './ObjectLayer';
import { activeListValidation, dropdownButtonRect } from './render-objects';
import { DARK, LIGHT, buildLayout, colX, drawGrid, filterButtonRect, hitTest, rowY, screenX, screenY, type Layout, type Viewport } from './render';

export interface GridViewProps {
  doc: CalcDoc;
  zoom: number;
  dark: boolean;
  onZoomChange: (z: number) => void;
  onContextMenu: (x: number, y: number, target: 'cell' | 'col' | 'row') => void;
  /** The drop-down of an autofilter column was clicked; x/y are client coordinates below the button. */
  onFilterButton?: (col: number, x: number, y: number) => void;
  /** The arrow of a list validation was clicked; x/y are client coordinates below the cell. */
  onListButton?: (row: number, col: number, x: number, y: number, width: number) => void;
  /** A hyperlink was Ctrl+clicked. */
  onFollowLink?: (link: Hyperlink) => void;
  /** Extra overlays (e.g. charts) rendered above the canvas. */
  children?: React.ReactNode;
  /** Report layout/viewport so overlays can position themselves. */
  onFrame?: (layout: Layout, viewport: Viewport) => void;
}

const REF_COLORS = ['#4472c4', '#ed7d31', '#a64d79', '#2f855a', '#7f6000', '#00b0f0', '#c00000'];
const MAX_SPACER = 30_000_000;

/** Ranges referenced by a formula being edited, for coloured highlighting. */
function formulaRefs(doc: CalcDoc, text: string): { rect: Rect; color: string }[] {
  if (!text.startsWith('=')) return [];
  try {
    const ast = parseFormula(canonicalFormula(text.slice(1), doc.locale));
    const out: { rect: Rect; color: string }[] = [];
    walk(ast, (n) => {
      if (n.t === 'ref' && !n.sheet) out.push({ rect: { r1: n.a.row, c1: n.a.col, r2: n.a.row, c2: n.a.col }, color: REF_COLORS[out.length % REF_COLORS.length]! });
      else if (n.t === 'range' && !n.sheet) out.push({ rect: normRect({ r1: n.a.row, c1: n.a.col, r2: n.b.row, c2: n.b.col }), color: REF_COLORS[out.length % REF_COLORS.length]! });
    });
    return out;
  } catch {
    return [];
  }
}

/** After which characters may a cell reference be inserted by clicking/arrowing? */
export function canPointAt(text: string, caret: number): boolean {
  if (!text.startsWith('=')) return false;
  const before = text.slice(0, caret).trimEnd();
  if (before === '=') return true;
  return /[=+\-*/^&(,;<>:]$/.test(before);
}

export function GridView({ doc, zoom, dark, onZoomChange, onContextMenu, onFilterButton, onListButton, onFollowLink, children, onFrame }: GridViewProps) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const { registry } = useCore();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [marquee, setMarquee] = useState(0);
  const [fillPreview, setFillPreviewState] = useState<Rect | null>(null);
  const fillRef = useRef<Rect | null>(null);
  const setFillPreview = (r: Rect | null) => {
    fillRef.current = r;
    setFillPreviewState(r);
  };
  const [resizeGuide, setResizeGuide] = useState<{ axis: 'col' | 'row'; pos: number } | null>(null);
  const [cursor, setCursor] = useState('cell');
  const drag = useRef<null | { kind: 'select' | 'cols' | 'rows' | 'fill' | 'resizeCol' | 'resizeRow' | 'point'; src?: Rect; start?: number; index?: number; pointStart?: number; pointEnd?: number }>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const wantVisible = useRef(false);
  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null);

  const sheetId = doc.activeSheetId;
  const rowDigits = String(Math.max(99, doc.sheet.maxRow + 1)).length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => buildLayout(doc, zoom), [doc, zoom, doc.layoutVersion, sheetId, rowDigits]);
  const fw = colX(layout, layout.frozenCols);
  const fh = rowY(layout, layout.frozenRows);

  // virtual scrolling: browsers cap element heights, so very tall sheets map scrollTop proportionally
  const totalW = layout.colAxis.total * zoom;
  const totalH = layout.rowAxis.total * zoom;
  const spacerW = Math.min(MAX_SPACER, Math.max(1, totalW - fw + layout.headerW + 40));
  const spacerH = Math.min(MAX_SPACER, Math.max(1, totalH - fh + layout.headerH + 40));
  const clientW = size.w;
  const clientH = size.h;
  const ratioX = totalW - fw + layout.headerW + 40 > MAX_SPACER ? (totalW - fw + layout.headerW + 40 - clientW) / Math.max(1, spacerW - clientW) : 1;
  const ratioY = totalH - fh + layout.headerH + 40 > MAX_SPACER ? (totalH - fh + layout.headerH + 40 - clientH) / Math.max(1, spacerH - clientH) : 1;

  const viewport: Viewport = useMemo(() => ({ width: size.w, height: size.h, scrollX: scroll.x * ratioX, scrollY: scroll.y * ratioY }), [size, scroll, ratioX, ratioY]);

  // ---- size observation
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // restore per-sheet scroll when switching sheets
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const v = doc.view;
    el.scrollLeft = v.scrollX / ratioX;
    el.scrollTop = v.scrollY / ratioY;
    setScroll({ x: el.scrollLeft, y: el.scrollTop });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setScroll({ x: el.scrollLeft, y: el.scrollTop });
    doc.view.scrollX = el.scrollLeft * ratioX;
    doc.view.scrollY = el.scrollTop * ratioY;
  }, [doc, ratioX, ratioY]);

  // ---- clipboard marching ants
  useEffect(() => {
    if (!doc.clip) return;
    const id = setInterval(() => setMarquee((m) => (m + 1) % 9), 120);
    return () => clearInterval(id);
  }, [doc.clip]);

  const refHighlights = useMemo(() => (doc.edit ? formulaRefs(doc, doc.edit.text) : []), [doc, doc.edit?.text, doc.edit]);

  // ---- painting
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, size.w);
    const h = Math.max(1, size.h);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawGrid({ doc, ctx, layout, viewport, palette: dark ? DARK : LIGHT, dpr, marquee, fillPreview, refHighlights });
    onFrame?.(layout, viewport);
  });

  // ---- keep the active cell visible after keyboard navigation
  const ensureVisible = useCallback(
    (row: number, col: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const l = layout;
      const v = { width: size.w, height: size.h, scrollX: el.scrollLeft * ratioX, scrollY: el.scrollTop * ratioY };
      const m = doc.sheet.merges.find((mm) => row >= mm.r1 && row <= mm.r2 && col >= mm.c1 && col <= mm.c2);
      const r = m ?? { r1: row, c1: col, r2: row, c2: col };
      if (col >= l.frozenCols) {
        const left = colX(l, r.c1) - colX(l, l.frozenCols);
        const right = colX(l, r.c2 + 1) - colX(l, l.frozenCols);
        const viewW = size.w - l.headerW - colX(l, l.frozenCols);
        if (left < v.scrollX) el.scrollLeft = left / ratioX;
        else if (right > v.scrollX + viewW) el.scrollLeft = (right - viewW) / ratioX;
      }
      if (row >= l.frozenRows) {
        const top = rowY(l, r.r1) - rowY(l, l.frozenRows);
        const bottom = rowY(l, r.r2 + 1) - rowY(l, l.frozenRows);
        const viewH = size.h - l.headerH - rowY(l, l.frozenRows);
        if (top < v.scrollY) el.scrollTop = top / ratioY;
        else if (bottom > v.scrollY + viewH) el.scrollTop = (bottom - viewH) / ratioY;
      }
    },
    [doc, layout, size, ratioX, ratioY],
  );
  const activeKey = `${doc.sel.active.row}:${doc.sel.active.col}:${sheetId}`;
  useEffect(() => {
    if (wantVisible.current) ensureVisible(doc.sel.active.row, doc.sel.active.col);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // keep focus on the grid when nothing else is being edited
  useEffect(() => {
    if (!doc.edit && document.activeElement === document.body) rootRef.current?.focus();
  });

  // ---- geometry helpers
  const relPoint = (e: { clientX: number; clientY: number }) => {
    const r = scrollerRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onScrollbar = (x: number, y: number) => {
    const el = scrollerRef.current!;
    return x > el.clientWidth || y > el.clientHeight;
  };
  const fillHandlePos = (): { x: number; y: number } | null => {
    if (doc.edit) return null;
    const cur = doc.sel.ranges[doc.sel.ranges.length - 1]!;
    if (cur.r2 >= MAX_ROWS - 1 || cur.c2 >= MAX_COLS - 1) return null;
    return { x: screenX(layout, viewport, cur.c2 + 1), y: screenY(layout, viewport, cur.r2 + 1) };
  };

  // ---- mouse
  const insertPointRef = (rect: Rect, replace: boolean) => {
    const e = doc.edit!;
    const text = e.text;
    const caret = e.caret ?? text.length;
    const ref = rect.r1 === rect.r2 && rect.c1 === rect.c2 ? formatA1(rect.r1, rect.c1) : `${formatA1(rect.r1, rect.c1)}:${formatA1(rect.r2, rect.c2)}`;
    const d = drag.current;
    const start = replace && d?.pointStart !== undefined ? d.pointStart : caret;
    const end = replace && d?.pointEnd !== undefined ? d.pointEnd : caret;
    const next = text.slice(0, start) + ref + text.slice(end);
    doc.setEditText(next, start + ref.length);
    return { start, end: start + ref.length };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      const { x, y } = relPoint(e);
      const hit = hitTest(layout, viewport, x, y);
      if (hit.kind === 'cell') {
        const inSel = doc.sel.ranges.some((r) => hit.row >= r.r1 && hit.row <= r.r2 && hit.col >= r.c1 && hit.col <= r.c2);
        if (!inSel) doc.selectCell(hit.row, hit.col);
        onContextMenu(e.clientX, e.clientY, 'cell');
      } else if (hit.kind === 'colHeader') {
        if (!doc.sel.ranges.some((r) => r.r1 === 0 && r.r2 === MAX_ROWS - 1 && hit.col >= r.c1 && hit.col <= r.c2)) doc.selectCols(hit.col, hit.col);
        onContextMenu(e.clientX, e.clientY, 'col');
      } else if (hit.kind === 'rowHeader') {
        if (!doc.sel.ranges.some((r) => r.c1 === 0 && r.c2 === MAX_COLS - 1 && hit.row >= r.r1 && hit.row <= r.r2)) doc.selectRows(hit.row, hit.row);
        onContextMenu(e.clientX, e.clientY, 'row');
      }
      return;
    }
    if (e.button !== 0) return;
    const { x, y } = relPoint(e);
    if (onScrollbar(x, y)) return;
    pointer.current = { x, y };
    const hit = hitTest(layout, viewport, x, y, fillHandlePos());
    wantVisible.current = false;

    // formula point mode: clicking a cell while editing a formula inserts its reference
    if (doc.edit && hit.kind === 'cell' && !hit.fill && canPointAt(doc.edit.text, doc.edit.caret ?? doc.edit.text.length)) {
      const span = insertPointRef({ r1: hit.row, c1: hit.col, r2: hit.row, c2: hit.col }, false);
      drag.current = { kind: 'point', start: hit.row * MAX_COLS + hit.col, pointStart: span.start, pointEnd: span.end };
      e.preventDefault();
      return;
    }
    rootRef.current?.focus({ preventScroll: true });
    if (doc.edit) {
      const err = doc.commitEdit();
      if (err === ENTRY_PENDING) return;
      if (err) {
        window.alert(err);
        return;
      }
    }

    // autofilter drop-down button in a header cell
    const af = doc.sheet.autoFilter;
    const overButton = (row: number, col: number) => {
      const rc = filterButtonRect(screenX(layout, viewport, col), screenY(layout, viewport, row), screenX(layout, viewport, col + 1), screenY(layout, viewport, row + 1), zoom);
      return rc && x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.w ? rc : null;
    };
    if (af && hit.kind === 'cell' && !hit.fill) {
      const hr = normRect(af.range);
      if (hit.row === hr.r1 && hit.col >= hr.c1 && hit.col <= hr.c2) {
        const rc = overButton(hit.row, hit.col);
        if (rc) {
          const box = scrollerRef.current!.getBoundingClientRect();
          doc.filterTable = null;
          onFilterButton?.(hit.col, box.left + rc.x, box.top + rc.y + rc.w + 2);
          return;
        }
      }
    }
    // the same in the header of a table
    if (hit.kind === 'cell' && !hit.fill) {
      for (const tb of doc.sheet.tables) {
        const r = normRect(tb.ref);
        if (!tb.header || !tb.filterButtons || hit.row !== r.r1 || hit.col < r.c1 || hit.col > r.c2) continue;
        const rc = overButton(hit.row, hit.col);
        if (rc) {
          const box = scrollerRef.current!.getBoundingClientRect();
          doc.filterTable = tb.id;
          onFilterButton?.(hit.col, box.left + rc.x, box.top + rc.y + rc.w + 2);
          return;
        }
      }
    }
    // the arrow of a list validation on the active cell
    if (hit.kind === 'cell' && !hit.fill && hit.row === doc.sel.active.row && hit.col === doc.sel.active.col && activeListValidation(doc)) {
      const rc = dropdownButtonRect(screenX(layout, viewport, hit.col), screenY(layout, viewport, hit.row), screenX(layout, viewport, hit.col + 1), screenY(layout, viewport, hit.row + 1), zoom);
      if (rc && x >= rc.x && x <= rc.x + rc.w && y >= rc.y && y <= rc.y + rc.h) {
        const box = scrollerRef.current!.getBoundingClientRect();
        onListButton?.(hit.row, hit.col, box.left + screenX(layout, viewport, hit.col), box.top + rc.y + rc.h + 2, screenX(layout, viewport, hit.col + 1) - screenX(layout, viewport, hit.col));
        return;
      }
    }
    // Ctrl+click on a cell with a hyperlink follows it
    if (hit.kind === 'cell' && !hit.fill && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      const link = hyperlinkAt(doc.sheet, hit.row, hit.col);
      if (link) {
        doc.selectCell(hit.row, hit.col);
        onFollowLink?.(link);
        return;
      }
    }

    if (hit.fill) {
      drag.current = { kind: 'fill', src: { ...doc.sel.ranges[doc.sel.ranges.length - 1]! } };
      return;
    }
    switch (hit.kind) {
      case 'cell':
        doc.selectCell(hit.row, hit.col, { extend: e.shiftKey, add: e.ctrlKey || e.metaKey });
        drag.current = { kind: 'select' };
        break;
      case 'colHeader':
        if (hit.resize) {
          drag.current = { kind: 'resizeCol', index: hit.col, start: x };
        } else {
          if (e.shiftKey) doc.selectCols(doc.sel.anchor.col, hit.col);
          else doc.selectCols(hit.col, hit.col, e.ctrlKey || e.metaKey);
          drag.current = { kind: 'cols', start: hit.col };
        }
        break;
      case 'rowHeader':
        if (hit.resize) {
          drag.current = { kind: 'resizeRow', index: hit.row, start: y };
        } else {
          if (e.shiftKey) doc.selectRows(doc.sel.anchor.row, hit.row);
          else doc.selectRows(hit.row, hit.row, e.ctrlKey || e.metaKey);
          drag.current = { kind: 'rows', start: hit.row };
        }
        break;
      case 'corner':
        doc.selectAll();
        break;
    }
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      const scroller = scrollerRef.current;
      if (!d || !scroller) return;
      const r = scroller.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      pointer.current = { x, y };
      // auto-scroll near the edges while selecting
      if (d.kind === 'select' || d.kind === 'cols' || d.kind === 'rows' || d.kind === 'fill' || d.kind === 'point') {
        const margin = 18;
        if (x > scroller.clientWidth - margin) scroller.scrollLeft += 30;
        else if (x < layout.headerW + fw + margin && scroller.scrollLeft > 0) scroller.scrollLeft -= 30;
        if (y > scroller.clientHeight - margin) scroller.scrollTop += 30;
        else if (y < layout.headerH + fh + margin && scroller.scrollTop > 0) scroller.scrollTop -= 30;
      }
      const hit = hitTest(layout, { ...viewport, scrollX: scroller.scrollLeft * ratioX, scrollY: scroller.scrollTop * ratioY }, Math.max(layout.headerW + 1, x), Math.max(layout.headerH + 1, y));
      if (d.kind === 'select' && hit.kind === 'cell') doc.selectCell(hit.row, hit.col, { extend: true });
      else if (d.kind === 'cols' && hit.kind !== 'rowHeader') doc.selectCols(doc.sel.anchor.col, hit.col);
      else if (d.kind === 'rows' && hit.kind !== 'colHeader') doc.selectRows(doc.sel.anchor.row, hit.row);
      else if (d.kind === 'point' && hit.kind === 'cell' && doc.edit) {
        const a = d.start!;
        const rect = normRect({ r1: Math.floor(a / MAX_COLS), c1: a % MAX_COLS, r2: hit.row, c2: hit.col });
        const span = insertPointRef(rect, true);
        d.pointStart = span.start;
        d.pointEnd = span.end;
      } else if (d.kind === 'fill' && d.src && hit.kind === 'cell') {
        const s = d.src;
        let t: Rect = s;
        if (hit.row > s.r2) t = { ...s, r2: hit.row };
        else if (hit.row < s.r1) t = { ...s, r1: hit.row };
        else if (hit.col > s.c2) t = { ...s, c2: hit.col };
        else if (hit.col < s.c1) t = { ...s, c1: hit.col };
        setFillPreview(t === s ? null : t);
      } else if (d.kind === 'resizeCol') {
        setResizeGuide({ axis: 'col', pos: x });
      } else if (d.kind === 'resizeRow') {
        setResizeGuide({ axis: 'row', pos: y });
      }
    };
    const up = (e: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (d.kind === 'fill' && d.src) {
        const target = fillRef.current;
        setFillPreview(null);
        if (target) doc.fillTo(d.src, target, { increment: e.ctrlKey || e.metaKey });
      } else if ((d.kind === 'resizeCol' || d.kind === 'resizeRow') && d.index !== undefined) {
        const scroller = scrollerRef.current!;
        const r = scroller.getBoundingClientRect();
        const v = { ...viewport, scrollX: scroller.scrollLeft * ratioX, scrollY: scroller.scrollTop * ratioY };
        if (d.kind === 'resizeCol') {
          const newW = (e.clientX - r.left - screenX(layout, v, d.index)) / zoom;
          const selected = doc.selectedCols();
          const wholeSelected = doc.sel.ranges.some((rg) => rg.r1 === 0 && rg.r2 === MAX_ROWS - 1 && d.index! >= rg.c1 && d.index! <= rg.c2);
          doc.setColWidth(wholeSelected ? selected : [d.index], newW);
        } else {
          const newH = (e.clientY - r.top - screenY(layout, v, d.index)) / zoom;
          const wholeSelected = doc.sel.ranges.some((rg) => rg.c1 === 0 && rg.c2 === MAX_COLS - 1 && d.index! >= rg.r1 && d.index! <= rg.r2);
          doc.setRowHeight(wholeSelected ? doc.selectedRows() : [d.index], newH);
        }
        setResizeGuide(null);
      }
      wantVisible.current = true;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  });

  const onMouseMoveHover = (e: React.MouseEvent) => {
    if (drag.current) return;
    const { x, y } = relPoint(e);
    if (onScrollbar(x, y)) return setCursor('default');
    const hit = hitTest(layout, viewport, x, y, fillHandlePos());
    const over = hit.kind === 'cell' && doc.sheet.comments.length ? { row: hit.row, col: hit.col } : null;
    setHoverCell((prev) => (prev?.row === over?.row && prev?.col === over?.col ? prev : over));
    setCursor(hit.fill ? 'crosshair' : hit.resize === 'col' ? 'col-resize' : hit.resize === 'row' ? 'row-resize' : hit.kind === 'colHeader' ? 's-resize' : hit.kind === 'rowHeader' ? 'e-resize' : 'cell');
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = relPoint(e);
    if (onScrollbar(x, y)) return;
    const hit = hitTest(layout, viewport, x, y);
    if (hit.kind === 'cell') {
      doc.beginEdit({ mode: 'edit' });
    } else if (hit.kind === 'colHeader' && hit.resize) {
      doc.selectCols(hit.col, hit.col);
      doc.autoFitColumns();
    } else if (hit.kind === 'rowHeader' && hit.resize) {
      doc.run('Autoajustar alto', () => doc.wb.editLayout(doc.activeSheetId, (s) => s.rowHeights.delete(hit.row)));
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      onZoomChange(Math.max(10, Math.min(400, Math.round(zoom * 100 + (e.deltaY < 0 ? 10 : -10)))));
    }
  };

  // ---- keyboard
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (doc.edit) return;
    if (doc.x.selectedImage || doc.x.selectedSlicer) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (doc.x.selectedImage) doc.x.deleteImage(doc.x.selectedImage);
        else if (doc.x.selectedSlicer) doc.x.deleteSlicer(doc.x.selectedSlicer);
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        doc.x.selectObject(null, null);
        e.preventDefault();
        return;
      }
    }
    if (doc.selectedChart) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        doc.deleteChart(doc.selectedChart);
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') {
        doc.selectChart(null);
        e.preventDefault();
        return;
      }
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    wantVisible.current = true;
    const page = Math.max(1, Math.floor((size.h - layout.headerH) / (20 * zoom)) - 1);
    switch (e.key) {
      case 'ArrowDown':
        doc.moveActive(1, 0, { extend: shift, jump: ctrl });
        break;
      case 'ArrowUp':
        doc.moveActive(-1, 0, { extend: shift, jump: ctrl });
        break;
      case 'ArrowLeft':
        doc.moveActive(0, -1, { extend: shift, jump: ctrl });
        break;
      case 'ArrowRight':
        doc.moveActive(0, 1, { extend: shift, jump: ctrl });
        break;
      case 'PageDown':
        if (e.altKey) doc.moveActive(0, 8, { extend: shift });
        else doc.moveActive(page, 0, { extend: shift });
        break;
      case 'PageUp':
        if (e.altKey) doc.moveActive(0, -8, { extend: shift });
        else doc.moveActive(-page, 0, { extend: shift });
        break;
      case 'Home':
        if (ctrl) doc.selectCell(0, 0, { extend: shift });
        else doc.selectCell(doc.sel.active.row, 0, { extend: shift });
        break;
      case 'End':
        if (ctrl) doc.selectCell(Math.max(0, doc.sheet.maxRow), Math.max(0, doc.sheet.maxCol), { extend: shift });
        else doc.moveActive(0, 1, { extend: shift, jump: true });
        break;
      case 'Tab':
        doc.moveActive(0, shift ? -1 : 1);
        break;
      case 'Enter':
        doc.moveEnter(shift);
        break;
      case 'F2':
        doc.beginEdit({ mode: 'edit' });
        break;
      case 'Delete':
        doc.clearContents();
        break;
      case 'Backspace':
        doc.clearContents();
        doc.beginEdit({ text: '', mode: 'enter' });
        break;
      case 'Escape':
        doc.clearClipboardMarks();
        return;
      case ' ':
        if (ctrl) doc.selectCols(doc.sel.active.col, doc.activeRange.c2);
        else if (shift) doc.selectRows(doc.sel.active.row, doc.activeRange.r2);
        else {
          doc.beginEdit({ text: ' ', mode: 'enter' });
        }
        break;
      default:
        if (e.key.length === 1 && !ctrl && !e.altKey) {
          doc.beginEdit({ text: e.key, mode: 'enter' });
        } else {
          wantVisible.current = false;
          return;
        }
    }
    e.preventDefault();
  };

  // copy / cut / paste go through real clipboard events so they work with the system clipboard
  const onCopy = (e: React.ClipboardEvent) => {
    if (doc.edit) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', doc.copy(false));
  };
  const onCut = (e: React.ClipboardEvent) => {
    if (doc.edit) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', doc.copy(true));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (doc.edit) return;
    e.preventDefault();
    const err = doc.paste(e.clipboardData.getData('text/plain'));
    if (err) window.alert(err);
    wantVisible.current = true;
  };

  // expose ribbon-driven clipboard actions through the registry's document events
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const focus = () => {
      // while a cell is being edited, focus belongs to its editor
      const editor = el.querySelector<HTMLTextAreaElement>('.calc-editor');
      if (editor) {
        editor.focus({ preventScroll: true });
        const end = editor.value.length;
        editor.setSelectionRange(end, end);
      } else el.focus({ preventScroll: true });
    };
    window.addEventListener('nova:focus-grid', focus);
    return () => window.removeEventListener('nova:focus-grid', focus);
  }, []);
  void registry;

  // ---- editor placement
  const edit = doc.edit && doc.edit.sheetId === sheetId ? doc.edit : null;
  const editRect = (() => {
    if (!edit) return null;
    const m = doc.sheet.merges.find((mm) => mm.r1 === edit.row && mm.c1 === edit.col);
    const r2 = m ? m.r2 : edit.row;
    const c2 = m ? m.c2 : edit.col;
    const x = screenX(layout, viewport, edit.col);
    const y = screenY(layout, viewport, edit.row);
    return { x, y, w: screenX(layout, viewport, c2 + 1) - x, h: screenY(layout, viewport, r2 + 1) - y };
  })();

  return (
    <div className="calc-grid" ref={rootRef} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste} onWheel={onWheel} style={{ cursor }}>
      <canvas ref={canvasRef} className="calc-grid__canvas" />
      <div
        ref={scrollerRef}
        className="calc-grid__scroller"
        onScroll={onScroll}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMoveHover}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div style={{ width: spacerW, height: spacerH }} />
      </div>
      {resizeGuide && (
        <div className="calc-grid__guide" style={resizeGuide.axis === 'col' ? { left: resizeGuide.pos, top: 0, width: 1, height: '100%' } : { top: resizeGuide.pos, left: 0, height: 1, width: '100%' }} />
      )}
      <ChartLayer doc={doc} layout={layout} viewport={viewport} zoom={zoom} dark={dark} />
      <ObjectLayer doc={doc} layout={layout} viewport={viewport} zoom={zoom} />
      <NoteLayer doc={doc} layout={layout} viewport={viewport} hover={hoverCell} />
      <ValidationHint doc={doc} layout={layout} viewport={viewport} />
      {children}
      {edit && editRect && <CellEditor doc={doc} edit={edit} rect={editRect} zoom={zoom} dark={dark} maxW={size.w - editRect.x} maxH={size.h - editRect.y} />}
    </div>
  );
}
