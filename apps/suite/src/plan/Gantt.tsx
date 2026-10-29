import { t } from '@suitenova/core-ui';
import { dayBasis, dateOfDay, dayOfTime, dowOf, formatDuration, formatTime, nowIn, type Day, type Time } from '@suitenova/plan-core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cellText, columnDef, type ColumnDef } from './columns';
import { PX_PER_DAY, ROW_H, type Column, type PlanCtl } from './ctl';

export interface GanttHandle {
  scrollToDay(day: Day): void;
  scrollToSelection(): void;
}

const HEAD_H = 44;
const OVERSCAN = 8;
const ID_W = 36;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DOW = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

type Gesture =
  | { kind: 'move'; index: number; x0: number; start: Time; moved: boolean }
  | { kind: 'resize'; index: number; x0: number; duration: number }
  | { kind: 'progress'; index: number; x1: number; x2: number }
  | { kind: 'link'; id: string; x: number; y: number };

const yOf = (pos: number) => pos * ROW_H;

interface Geom {
  id: string;
  index: number;
  pos: number;
  x1: number;
  x2: number;
}

export const Gantt = forwardRef<GanttHandle, { ctl: PlanCtl; zoom: number }>(function Gantt({ ctl, zoom }, ref) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [linkDrag, setLinkDrag] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [edit, setEdit] = useState<{ row: number; col: Column; text: string } | null>(null);
  const [cursorCol, setCursorCol] = useState<Column>('name');
  // what is on screen: only these rows and days are drawn, so a project with thousands of tasks stays light
  const [view, setView] = useState({ top: 0, left: 0, w: 1200, h: 600 });
  const raf = useRef(0);

  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    setView((v) => (v.top === el.scrollTop && v.left === el.scrollLeft && v.w === el.clientWidth && v.h === el.clientHeight ? v : { top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight }));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, []);

  const sched = ctl.sched;
  const ctx = ctl.ctx;
  const project = ctl.preview ?? ctl.project;
  const display = ctl.display();
  const COLS = ctl.columns.map((id) => columnDef(project, id)).filter((c): c is ColumnDef => !!c);
  const TABLE_W = ID_W + COLS.reduce((a, c) => a + c.width, 0);
  const pos = new Map<number, number>();
  display.forEach((r, i) => {
    if (r.kind === 'task') pos.set(r.index, i);
  });
  const rowIndexes = display.flatMap((r) => (r.kind === 'task' ? [r.index] : []));
  const ppd = (PX_PER_DAY[ctl.scale] * zoom) / 100;
  const mpd = project.minutesPerDay;

  // ---- timeline range (in days)
  const today = dayOfTime(nowIn(project.timeZone));
  let lo: Day = dayOfTime(project.start);
  let hi: Day = lo + 30;
  if (sched && sched.tasks.length) {
    lo = Math.min(dayOfTime(sched.start), dayOfTime(project.start));
    hi = Math.max(dayOfTime(sched.finish), hi - 20) + 1;
  }
  lo -= 3;
  lo -= (((dowOf(lo) + 6) % 7) + 7) % 7; // back to Monday
  hi += 21;
  const days = hi - lo;
  const width = Math.ceil(days * ppd);
  const x = (tm: Time) => (tm / 1440 - lo) * ppd;
  const xd = (d: Day) => (d - lo) * ppd;
  const height = Math.max(display.length * ROW_H, ROW_H);

  // ---- window
  const full = ctl.fullRender;
  const firstPos = full ? 0 : Math.max(0, Math.floor((view.top - HEAD_H) / ROW_H) - OVERSCAN);
  const lastPos = full ? display.length : Math.min(display.length, Math.ceil((view.top + view.h - HEAD_H) / ROW_H) + OVERSCAN);
  const winDisplay = display.slice(firstPos, lastPos);
  const winTasks = winDisplay.flatMap((r) => (r.kind === 'task' ? [r.index] : []));
  const winSet = new Set(winTasks);
  const xFrom = full ? 0 : Math.max(0, view.left - TABLE_W - 200);
  const xTo = full ? width : view.left + view.w + 200;
  const dFrom = Math.max(lo, lo + Math.floor(xFrom / ppd) - 1);
  const dTo = Math.min(hi, lo + Math.ceil(xTo / ppd) + 1);

  useImperativeHandle(ref, () => ({
    scrollToDay(day) {
      const el = scroller.current;
      if (el) el.scrollLeft = Math.max(0, xd(day) - (el.clientWidth - TABLE_W) / 2);
    },
    scrollToSelection() {
      const el = scroller.current;
      const s = sched?.tasks[ctl.active];
      if (!el || !s) return;
      if (s.start) el.scrollLeft = Math.max(0, x(s.start) - 40);
      const p = pos.get(ctl.active);
      if (p !== undefined) el.scrollTop = Math.max(0, yOf(p) - 60);
    },
  }));

  // bring the start of the project into view when the scale, the zoom or the start change
  const startDay = dayOfTime(project.start);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, (startDay - lo) * ppd - 12);
  }, [ctl.scale, zoom, startDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- header ticks (visible part only)
  const top: { x: number; w: number; label: string }[] = [];
  const bottom: { x: number; w: number; label: string; weekend?: boolean }[] = [];
  for (let d = dFrom; d < dTo; d++) {
    const dt = dateOfDay(d);
    const first = dt.getUTCDate() === 1 || d === dFrom;
    const mEnd = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / 86400000;
    if (ctl.scale === 'month') {
      if (first) {
        bottom.push({ x: xd(d), w: (Math.min(mEnd, hi) - d) * ppd, label: MONTHS[dt.getUTCMonth()]! });
        if (dt.getUTCMonth() === 0 || d === dFrom) {
          const yEnd = Date.UTC(dt.getUTCFullYear() + 1, 0, 1) / 86400000;
          top.push({ x: xd(d), w: (Math.min(yEnd, hi) - d) * ppd, label: String(dt.getUTCFullYear()) });
        }
      }
    } else if (ctl.scale === 'hour') {
      top.push({ x: xd(d), w: ppd, label: `${DOW[dowOf(d)]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` });
      for (let h = 0; h < 24; h += 2) bottom.push({ x: xd(d) + (h / 24) * ppd, w: (2 / 24) * ppd, label: String(h).padStart(2, '0') });
    } else {
      if (first) top.push({ x: xd(d), w: (Math.min(mEnd, hi) - d) * ppd, label: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}` });
      if (ctl.scale === 'day') bottom.push({ x: xd(d), w: ppd, label: `${DOW[dowOf(d)]}\n${dt.getUTCDate()}`, weekend: !!sched && sched.calendars.default.periodsOf(d).length === 0 });
      else if (dowOf(d) === 1) bottom.push({ x: xd(d), w: 7 * ppd, label: String(dt.getUTCDate()) });
    }
  }
  // non-working time (shaded) on the hour scale
  const idle: { x: number; w: number }[] = [];
  if (sched && ctl.scale === 'hour') {
    for (let d = dFrom; d < dTo; d++) {
      let at = 0;
      for (const p of sched.calendars.default.periodsOf(d)) {
        if (p.from > at) idle.push({ x: xd(d) + (at / 1440) * ppd, w: ((p.from - at) / 1440) * ppd });
        at = p.to;
      }
      if (at < 1440) idle.push({ x: xd(d) + (at / 1440) * ppd, w: ((1440 - at) / 1440) * ppd });
    }
  }

  // ---- bars
  const geom = (r: number): Geom | null => {
    const s = sched?.tasks[r];
    const p = pos.get(r);
    if (!s || p === undefined) return null;
    const x1 = x(s.start);
    return { id: s.id, index: r, pos: p, x1, x2: s.milestone ? x1 : Math.max(x1 + 2, x(s.finish)) };
  };
  const bars: Geom[] = [];
  for (const r of winTasks) {
    const g = geom(r);
    if (g) bars.push(g);
  }

  const arrows: { d: string; key: string; critical: boolean }[] = [];
  if (sched) {
    const idIndex = new Map<string, number>();
    sched.tasks.forEach((s, i) => idIndex.set(s.id, i));
    const seen = new Set<string>();
    // one arrow per link that touches a drawn row; the other end may be outside the window
    const addArrows = (b: Geom) => {
      const links = project.tasks[b.index]!.links;
      for (const l of links) {
        const ai = idIndex.get(l.task);
        if (ai === undefined) continue;
        const a = geom(ai);
        const sa = sched.tasks[ai]!;
        const sb = sched.tasks[b.index]!;
        if (!a || sa.summary || sb.summary) continue;
        const key = `${l.task}>${b.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const fromEnd = l.type === 'FS' || l.type === 'FF';
        const x1 = fromEnd ? a.x2 : a.x1;
        const x2 = l.type === 'FS' || l.type === 'SS' ? b.x1 : b.x2;
        const y1 = yOf(a.pos) + ROW_H / 2;
        const y2 = yOf(b.pos) + ROW_H / 2;
        const out = fromEnd ? 8 : -8;
        const into = l.type === 'FS' || l.type === 'SS' ? -8 : 8;
        let d: string;
        if (l.type === 'FS' && x2 >= x1 + 14) d = `M${x1},${y1} H${x1 + 7} V${y2} H${x2 - 1}`;
        else {
          const ym = y2 > y1 ? yOf(b.pos) : yOf(b.pos) + ROW_H;
          d = `M${x1},${y1} H${x1 + out} V${ym} H${x2 + into} V${y2} H${x2 - (into > 0 ? -1 : 1)}`;
        }
        arrows.push({ d, key, critical: ctl.showCritical && sa.critical && sb.critical });
      }
    };
    for (const b of bars) addArrows(b);
    // links that start inside the window and end below or above it
    if (!full && rowIndexes.length > winTasks.length) {
      for (const r of winTasks) {
        const id = sched.tasks[r]!.id;
        for (let j = 0; j < project.tasks.length; j++) {
          if (winSet.has(j) || !pos.has(j)) continue;
          if (project.tasks[j]!.links.some((l) => l.task === id)) {
            const g = geom(j);
            if (g) addArrows(g);
          }
        }
      }
    }
  }

  // ---- gestures
  const timeAt = (clientX: number): number => {
    const svg = scroller.current!.querySelector('svg.pl-svg') as SVGSVGElement;
    return ((clientX - svg.getBoundingClientRect().left) / ppd + lo) * 1440;
  };
  const stepMin = ctl.scale === 'hour' ? 30 : 1440;

  const onBarDown = (e: React.PointerEvent, b: Geom, kind: 'move' | 'resize' | 'progress' | 'link') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const i = b.index;
    const s = sched!.tasks[i]!;
    if (kind === 'move' || kind === 'resize') ctl.select(i, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'one');
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (kind === 'move') gesture.current = { kind, index: i, x0: e.clientX, start: s.start, moved: false };
    else if (kind === 'resize') gesture.current = { kind, index: i, x0: e.clientX, duration: project.tasks[i]!.duration };
    else if (kind === 'progress') gesture.current = { kind, index: i, x1: b.x1, x2: b.x2 };
    else {
      gesture.current = { kind, id: b.id, x: b.x2, y: yOf(b.pos) + ROW_H / 2 };
      setLinkDrag({ x1: b.x2, y1: yOf(b.pos) + ROW_H / 2, x2: b.x2, y2: yOf(b.pos) + ROW_H / 2 });
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !sched) return;
    if (g.kind === 'move') {
      const steps = Math.round(((e.clientX - g.x0) / ppd) * (1440 / stepMin));
      if (!g.moved && Math.abs(e.clientX - g.x0) < 4) return;
      g.moved = true;
      ctl.previewMove(g.index, g.start + steps * stepMin);
    } else if (g.kind === 'resize') {
      const steps = Math.round(((e.clientX - g.x0) / ppd) * (1440 / stepMin));
      // a step is half an hour on the hour scale and a whole working day otherwise
      ctl.previewDuration(g.index, g.duration + steps * (ctl.scale === 'hour' ? 30 : mpd));
    } else if (g.kind === 'progress') {
      ctl.previewPercent(g.index, Math.round((((timeAt(e.clientX) / 1440 - lo) * ppd - g.x1) / Math.max(1, g.x2 - g.x1)) * 20) * 5);
    } else {
      const svg = scroller.current!.querySelector('svg.pl-svg') as SVGSVGElement;
      const r = svg.getBoundingClientRect();
      setLinkDrag({ x1: g.x, y1: g.y, x2: e.clientX - r.left, y2: e.clientY - r.top - HEAD_H });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'link') {
      setLinkDrag(null);
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-task-id]');
      const to = el?.getAttribute('data-task-id');
      if (to && to !== g.id) {
        const err = ctl.linkPair(g.id, to);
        ctl.say(err ?? '');
      }
      return;
    }
    if (g.kind === 'move' && !g.moved) {
      ctl.endGesture(false);
      return;
    }
    ctl.endGesture(true);
  };

  // ---- table editing
  const startEdit = (row: number, col: Column, initial?: string) => {
    if (!ctl.cellEditable(row, col)) return;
    setEdit({ row, col, text: initial ?? (ctx ? cellText(ctx, row, col) : '') });
  };
  // the blur that fires when the input unmounts must not commit a cancelled edit
  const editRef = useRef(edit);
  editRef.current = edit;
  const finishEdit = (accept: boolean) => {
    const e = editRef.current;
    if (!e) return;
    editRef.current = null;
    setEdit(null);
    if (!accept) return;
    const err = ctl.commitCell(e.row, e.col, e.text);
    ctl.say(err ?? '');
  };
  const focusGrid = () => scroller.current?.querySelector<HTMLElement>('.pl-table')?.focus();

  /** Keep the active row on screen while moving with the keyboard. */
  useEffect(() => {
    const el = scroller.current;
    const p = pos.get(ctl.active);
    if (!el || p === undefined || full) return;
    const y = HEAD_H + yOf(p);
    if (y < el.scrollTop + HEAD_H) el.scrollTop = y - HEAD_H;
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight;
  }, [ctl.active]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGridKey = (ev: React.KeyboardEvent) => {
    if (edit) return;
    const colIdx = Math.max(0, COLS.findIndex((c) => c.id === cursorCol));
    const act = ctl.active;
    switch (ev.key) {
      case 'ArrowDown': ctl.moveSelection(1, ev.shiftKey); break;
      case 'ArrowUp': ctl.moveSelection(-1, ev.shiftKey); break;
      case 'ArrowRight': if (!ev.altKey) setCursorCol(COLS[Math.min(COLS.length - 1, colIdx + 1)]!.id); else return; break;
      case 'ArrowLeft': if (!ev.altKey) setCursorCol(COLS[Math.max(0, colIdx - 1)]!.id); else return; break;
      case 'Enter':
      case 'F2':
        if (ev.shiftKey) return;
        if (act >= 0) startEdit(act, cursorCol);
        break;
      case 'Home': ctl.select(rowIndexes[0] ?? 0); break;
      case 'End': ctl.select(rowIndexes[rowIndexes.length - 1] ?? 0); break;
      default:
        // typing starts editing with that character
        if (act >= 0 && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ctl.cellEditable(act, cursorCol)) {
          startEdit(act, cursorCol, ev.key);
          break;
        }
        return;
    }
    ev.preventDefault();
  };

  if (!sched || !ctx) {
    return (
      <div className="pl-empty" role="alert">
        {t('No se puede calcular el plan:')} {'error' in ctl.result ? ctl.result.error : ''}
      </div>
    );
  }

  const statusX = project.statusDate !== null ? x(project.statusDate) : null;
  const nowT = nowIn(project.timeZone);
  const select = (r: number, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => ctl.select(r, e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'one');
  const baseline = project.baselines[ctl.baselineShown];

  return (
    <div
      className="pl-scroller"
      ref={scroller}
      onKeyDown={onGridKey}
      onScroll={(e) => {
        const el = e.currentTarget;
        el.style.setProperty('--st', `${el.scrollTop}px`);
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(measure);
      }}
    >
      <div className="pl-inner" style={{ width: TABLE_W + width, height: HEAD_H + height }}>
        {/* ---------- task table ---------- */}
        <div className="pl-table" style={{ width: TABLE_W }} role="grid" aria-label={t('Tareas')} aria-rowcount={display.length + 1} tabIndex={0} aria-activedescendant={ctl.active >= 0 && winSet.has(ctl.active) ? `pl-row-${ctl.active}` : undefined}>
          <div className="pl-thead" role="row" style={{ height: HEAD_H }}>
            <div className="pl-th" role="columnheader" style={{ width: ID_W }}>
              #
            </div>
            {COLS.map((c) => (
              <div key={c.id} className="pl-th" role="columnheader" style={{ width: c.width }}>
                {t(c.label)}
              </div>
            ))}
          </div>
          <div className="pl-tbody" style={{ height }}>
            {winDisplay.map((row, wi) => {
              const dp = firstPos + wi;
              if (row.kind === 'group') {
                return (
                  <div key={row.key} role="row" className="pl-tr pl-group" style={{ height: ROW_H, top: yOf(dp) }} data-group={row.label}>
                    <div className="pl-td pl-id" style={{ width: ID_W }} />
                    <div className="pl-td" role="gridcell" style={{ width: TABLE_W - ID_W, paddingLeft: 4 + row.depth * 14 }}>
                      <button type="button" className="pl-fold" aria-label={row.collapsed ? t('Expandir') : t('Contraer')} aria-expanded={!row.collapsed} onClick={() => ctl.toggleGroup(row.key)}>
                        {row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </button>
                      <span className="pl-text">
                        <strong>{row.label}</strong> — {row.node.totals.count === 1 ? t('1 tarea') : t('{n} tareas', { n: row.node.totals.count })}
                      </span>
                    </div>
                  </div>
                );
              }
              const r = row.index;
              const s = sched.tasks[r]!;
              const task = project.tasks[r]!;
              const isSel = ctl.selected.includes(r);
              return (
                <div
                  key={task.id}
                  id={`pl-row-${r}`}
                  role="row"
                  aria-selected={isSel}
                  aria-rowindex={dp + 2}
                  data-row={r}
                  className={`pl-tr${isSel ? ' is-sel' : ''}${r === ctl.active ? ' is-active' : ''}${s.summary ? ' is-summary' : ''}${ctl.showCritical && s.critical ? ' is-critical' : ''}`}
                  style={{ height: ROW_H, top: yOf(dp) }}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest('input')) return;
                    select(r, e);
                  }}
                >
                  <div className="pl-td pl-id" role="rowheader" style={{ width: ID_W }}>
                    {r + 1}
                  </div>
                  {COLS.map((c) => {
                    const editing = edit?.row === r && edit.col === c.id;
                    const text = cellText(ctx, r, c.id);
                    const isName = c.id === 'name';
                    return (
                      <div
                        key={c.id}
                        role="gridcell"
                        aria-label={`${t(c.label)}, ${t('fila')} ${r + 1}`}
                        className={`pl-td pl-${c.id.replace(':', '-')}${cursorCol === c.id && r === ctl.active ? ' is-cursor' : ''}${c.align === 'right' ? ' pl-num' : ''}`}
                        style={{ width: c.width, paddingLeft: isName && !ctl.grouped ? 4 + (task.outline - 1) * 14 : undefined }}
                        onMouseDown={() => setCursorCol(c.id)}
                        onDoubleClick={() => startEdit(r, c.id)}
                      >
                        {isName &&
                          (s.summary && !ctl.grouped ? (
                            <button type="button" className="pl-fold" aria-label={ctl.collapsed.has(task.id) ? t('Expandir') : t('Contraer')} aria-expanded={!ctl.collapsed.has(task.id)} onClick={() => ctl.toggleCollapse(r)}>
                              {ctl.collapsed.has(task.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                            </button>
                          ) : (
                            <span className="pl-fold-gap" />
                          ))}
                        {editing ? (
                          <input
                            autoFocus
                            className="pl-edit"
                            aria-label={`${t(c.label)}, ${t('fila')} ${r + 1}`}
                            value={edit.text}
                            onFocus={(e) => e.currentTarget.setSelectionRange(edit.text.length, edit.text.length)}
                            onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                            onBlur={() => finishEdit(true)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                finishEdit(true);
                                focusGrid();
                              } else if (e.key === 'Escape') {
                                finishEdit(false);
                                focusGrid();
                              }
                            }}
                          />
                        ) : (
                          <span className="pl-text" title={text}>
                            {text}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------- chart ---------- */}
        <div className="pl-chart" style={{ width }}>
          <svg className="pl-svg" width={width} height={HEAD_H + height} onPointerMove={onMove} onPointerUp={onUp} role="img" aria-label={t('Diagrama de Gantt')}>
            <defs>
              <marker id="pl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
              </marker>
            </defs>
            <g transform={`translate(0 ${HEAD_H})`}>
              {/* row stripes and non-working time */}
              {winDisplay.map((row, wi) => {
                const dp = firstPos + wi;
                return row.kind === 'task' ? (
                  <rect key={row.key} x={xFrom} y={yOf(dp)} width={Math.max(0, xTo - xFrom)} height={ROW_H} className={`pl-rowbg${ctl.selected.includes(row.index) ? ' is-sel' : ''}`} data-task-id={sched.tasks[row.index]!.id} onPointerDown={(e) => e.button === 0 && select(row.index, e)} />
                ) : (
                  <rect key={row.key} x={xFrom} y={yOf(dp)} width={Math.max(0, xTo - xFrom)} height={ROW_H} className="pl-rowbg pl-grouprow" />
                );
              })}
              {ctl.scale === 'day' && bottom.filter((b) => b.weekend).map((b, i) => <rect key={`w${i}`} x={b.x} y={0} width={b.w} height={height} className="pl-weekend" />)}
              {idle.map((b, i) => (
                <rect key={`i${i}`} x={b.x} y={0} width={b.w} height={height} className="pl-weekend" />
              ))}
              {bottom.map((b, i) => (b.w > 0 ? <line key={`g${i}`} x1={b.x} x2={b.x} y1={0} y2={height} className="pl-grid" /> : null))}
              {today >= lo && today < hi && <line x1={ctl.scale === 'hour' ? x(nowT) : xd(today) + ppd / 2} x2={ctl.scale === 'hour' ? x(nowT) : xd(today) + ppd / 2} y1={0} y2={height} className="pl-today" data-testid="today" />}
              {statusX !== null && <line x1={statusX} x2={statusX} y1={0} y2={height} className="pl-status" data-testid="status" />}

              {/* group totals */}
              {winDisplay.map((row, wi) =>
                row.kind === 'group' && row.node.totals.start !== null && row.node.totals.finish !== null ? (
                  <rect key={`gs${row.key}`} x={x(row.node.totals.start)} y={yOf(firstPos + wi) + 10} width={Math.max(2, x(row.node.totals.finish) - x(row.node.totals.start))} height={6} className="pl-summary" />
                ) : null,
              )}

              {/* dependency arrows (below the bars) */}
              <g className="pl-arrows" fill="none">
                {arrows.map((a) => (
                  <path key={a.key} d={a.d} className={`pl-arrow${a.critical ? ' is-critical' : ''}`} markerEnd="url(#pl-arrow)" data-link={a.key} />
                ))}
              </g>

              {bars.map((b) => {
                const s = sched.tasks[b.index]!;
                const task = project.tasks[b.index]!;
                const y = yOf(b.pos);
                const sel = ctl.selected.includes(b.index);
                const crit = ctl.showCritical && s.critical;
                const bl = baseline?.tasks[s.id];
                const title = `${task.name}\n${formatTime(s.start)} – ${formatTime(s.finish)} · ${formatDuration(s.duration, task.elapsed && !s.summary, dayBasis(project, s.summary ? null : task))} · ${Math.round(s.percent)} %`;
                const cls = `pl-bar${sel ? ' is-sel' : ''}${crit ? ' is-critical' : ''}${s.conflict ? ' is-conflict' : ''}${s.manual ? ' is-manual' : ''}${s.deadlineMissed ? ' is-late' : ''}`;
                const pointer = { onPointerMove: onMove, onPointerUp: onUp };
                const parts = s.segments.length ? s.segments : [{ start: s.start, finish: s.finish }];
                return (
                  <g key={s.id} className={cls} data-task-id={s.id} data-row={b.index} data-kind={s.summary ? 'summary' : s.milestone ? 'milestone' : 'task'} data-split={parts.length > 1 ? parts.length : undefined}>
                    <title>{title}</title>
                    {bl && !s.summary && <rect x={x(bl.start)} y={y + ROW_H - 8} width={Math.max(2, x(bl.finish) - x(bl.start))} height={3} className="pl-baseline" />}
                    {s.milestone ? (
                      <path d={`M${b.x1},${y + 5} l8,8 l-8,8 l-8,-8 z`} className="pl-milestone" onPointerDown={(e) => onBarDown(e, b, 'move')} {...pointer} />
                    ) : s.summary ? (
                      <g onPointerDown={(e) => e.button === 0 && ctl.select(b.index)}>
                        <rect x={b.x1} y={y + 8} width={Math.max(2, b.x2 - b.x1)} height={7} className="pl-summary" />
                        <path d={`M${b.x1},${y + 15} v6 l6,-6 z M${b.x2},${y + 15} v6 l-6,-6 z`} className="pl-summary" />
                      </g>
                    ) : (
                      <>
                        {parts.length > 1 &&
                          parts.slice(1).map((pt, k) => <line key={`sp${k}`} x1={x(parts[k]!.finish)} x2={x(pt.start)} y1={y + ROW_H / 2} y2={y + ROW_H / 2} className="pl-splitline" />)}
                        {parts.map((pt, k) => (
                          <rect key={k} x={x(pt.start)} y={y + 6} width={Math.max(3, x(pt.finish) - x(pt.start))} height={ROW_H - 16} rx={2} className="pl-body" onPointerDown={(e) => onBarDown(e, b, 'move')} {...pointer} />
                        ))}
                        {s.percent > 0 && <rect x={b.x1} y={y + 10} width={Math.max(0, ((b.x2 - b.x1) * s.percent) / 100)} height={ROW_H - 24} className="pl-progress" pointerEvents="none" />}
                        <rect x={b.x2 - 5} y={y + 6} width={6} height={ROW_H - 16} className="pl-resize" onPointerDown={(e) => onBarDown(e, b, 'resize')} {...pointer} />
                        <path d={`M${b.x1 + ((b.x2 - b.x1) * s.percent) / 100 - 4},${y + ROW_H - 5} h8 l-4,-5 z`} className="pl-progress-handle" onPointerDown={(e) => onBarDown(e, b, 'progress')} {...pointer}>
                          <title>{t('Arrastra para cambiar el % completado')}</title>
                        </path>
                      </>
                    )}
                    {task.deadline !== null && !s.summary && <path d={`M${x(task.deadline) - 4},${y + 1} h8 l-4,6 z`} className="pl-deadline" data-testid="deadline" />}
                    {!s.summary && (
                      <circle cx={b.x2 + 9} cy={y + ROW_H / 2} r={4} className="pl-linkhandle" onPointerDown={(e) => onBarDown(e, b, 'link')} {...pointer}>
                        <title>{t('Arrastra hasta otra tarea para vincularla')}</title>
                      </circle>
                    )}
                    <text x={b.x2 + 18} y={y + ROW_H / 2 + 4} className="pl-label">
                      {task.name}
                    </text>
                  </g>
                );
              })}
              {linkDrag && <line x1={linkDrag.x1} y1={linkDrag.y1} x2={linkDrag.x2} y2={linkDrag.y2} className="pl-linkline" />}
            </g>
            {/* header: drawn last and moved with the vertical scroll so it stays in view */}
            <g className="pl-head" style={{ transform: 'translateY(var(--st, 0px))' }}>
              <rect x={0} y={0} width={width} height={HEAD_H} className="pl-head-bg" />
              {top.map((h, i) => (
                <g key={`t${i}`}>
                  <line x1={h.x} x2={h.x} y1={0} y2={HEAD_H / 2} className="pl-line" />
                  <text x={h.x + 4} y={14} className="pl-htext">
                    {h.label}
                  </text>
                </g>
              ))}
              <line x1={0} x2={width} y1={HEAD_H / 2} y2={HEAD_H / 2} className="pl-line" />
              {bottom.map((h, i) => (
                <g key={`b${i}`}>
                  {h.weekend && <rect x={h.x} y={HEAD_H / 2} width={h.w} height={HEAD_H / 2} className="pl-weekend-head" />}
                  <line x1={h.x} x2={h.x} y1={HEAD_H / 2} y2={HEAD_H} className="pl-line" />
                  {h.label.split('\n').map((ln, k, all) => (
                    <text key={k} x={h.x + (ctl.scale === 'day' ? h.w / 2 : 3)} y={all.length === 1 ? HEAD_H - 7 : HEAD_H / 2 + 9 + k * 10} textAnchor={ctl.scale === 'day' ? 'middle' : 'start'} className="pl-htext pl-htext--small">
                      {ln}
                    </text>
                  ))}
                </g>
              ))}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
});
