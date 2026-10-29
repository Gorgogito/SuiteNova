import { getLocale, t } from '@suitenova/core-ui';
import { ptToPx } from '@suitenova/writer-core';
import { useRef, useSyncExternalStore } from 'react';
import type { WriterCtl } from './doc';
import { selectionParagraph, updateParagraphs } from './editing';
import type { TabStop } from './tabs';

const PX = 96 / 72;
const PT_PER_CM = 72 / 2.54;
const PT_PER_IN = 72;

type Drag =
  | { kind: 'left' | 'right'; startX: number; start: number }
  | { kind: 'indentLeft' | 'indentFirst' | 'indentRight'; startX: number; start: number; first: number; left: number }
  | { kind: 'tab'; index: number; startX: number; startY: number; start: number; removed: boolean }
  | { kind: 'top' | 'bottom'; startY: number; start: number };

const TAB_GLYPH: Record<TabStop['kind'], string> = { left: '⌊', center: '⏊', right: '⌋', decimal: '⌊.', bar: '|' };
export const TAB_KINDS: TabStop['kind'][] = ['left', 'center', 'right', 'decimal', 'bar'];

/** The horizontal ruler: margins, indents and tab stops of the page that holds the caret. */
export function HRuler({ ctl, zoom }: { ctl: WriterCtl; zoom: number }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const drag = useRef<Drag | null>(null);
  const rects = ctl.pageRects();
  const pageIdx = Math.min(rects.length - 1, Math.max(0, ctl.currentPage() - 1));
  const r = rects[pageIdx];
  const sec = ctl.sections()[r?.spec.section ?? 0];
  if (!r || !sec) return null;
  const z = zoom / 100;
  const k = PX * z; // px per pt on screen
  const p = sec.props.page;
  const state = ctl.state;
  const para = state ? selectionParagraph(state) : null;
  const inList = !!state && (() => {
    for (let d = state.selection.$from.depth; d > 0; d--) {
      const n = state.selection.$from.node(d).type.name;
      if (n === 'bullet_list' || n === 'ordered_list') return true;
    }
    return false;
  })();
  const left = (para?.attrs.indentLeft as number) ?? 0;
  const first = (para?.attrs.indentFirst as number) ?? 0;
  const right = (para?.attrs.indentRight as number) ?? 0;
  const tabs: TabStop[] = Array.isArray(para?.attrs.tabs) ? (para!.attrs.tabs as TabStop[]) : [];
  const textW = p.width - p.marginLeft - p.marginRight;
  const imperial = getLocale() === 'en';
  const unit = imperial ? PT_PER_IN : PT_PER_CM;
  const x0 = r.left * z;
  const W = p.width * k;

  const toPt = (clientX: number, el: HTMLElement) => (clientX - el.getBoundingClientRect().left) / k;
  const snap = (v: number) => Math.round(v / (unit / (imperial ? 16 : 20))) * (unit / (imperial ? 16 : 20));

  const act = (fn: (d: Drag, ptX: number, ev: PointerEvent) => void, root: HTMLElement) => {
    const move = (ev: PointerEvent) => {
      if (drag.current) fn(drag.current, toPt(ev.clientX, root), ev);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ctl.view?.focus();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const apply = (patch: Record<string, unknown>) => {
    const v = ctl.view;
    if (!v) return;
    updateParagraphs(patch)(v.state, v.dispatch);
  };
  const setTabs = (next: TabStop[]) => apply({ tabs: next.length ? [...next].sort((a, b) => a.pos - b.pos) : null });

  const onMarker = (kind: 'indentLeft' | 'indentFirst' | 'indentRight') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = (e.currentTarget as HTMLElement).closest('.nw-hruler') as HTMLElement;
    drag.current = { kind, startX: e.clientX, start: kind === 'indentLeft' ? left : kind === 'indentFirst' ? first : right, first, left };
    act((d, ptX) => {
      if (d.kind === 'indentLeft') {
        const v = Math.max(0, Math.min(textW - 36, snap(ptX - p.marginLeft)));
        // moving the left indent keeps the first line where it is relative to it
        apply({ indentLeft: v, indentFirst: Math.max(-v, d.first) });
      } else if (d.kind === 'indentFirst') {
        const v = snap(ptX - p.marginLeft - d.left);
        apply({ indentFirst: Math.max(-d.left, Math.min(textW - d.left - 36, v)) });
      } else if (d.kind === 'indentRight') apply({ indentRight: Math.max(0, Math.min(textW - 36, snap(p.width - p.marginRight - ptX))) });
    }, root);
  };

  const onMargin = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = (e.currentTarget as HTMLElement).closest('.nw-hruler') as HTMLElement;
    drag.current = { kind: side, startX: e.clientX, start: side === 'left' ? p.marginLeft : p.marginRight };
    act((d, ptX) => {
      if (d.kind === 'left') ctl.setPage({ marginLeft: Math.max(0, Math.min(p.width - p.marginRight - 72, snap(ptX))) }, 'section');
      else if (d.kind === 'right') ctl.setPage({ marginRight: Math.max(0, Math.min(p.width - p.marginLeft - 72, snap(p.width - ptX))) }, 'section');
    }, root);
  };

  const onTab = (index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = (e.currentTarget as HTMLElement).closest('.nw-hruler') as HTMLElement;
    drag.current = { kind: 'tab', index, startX: e.clientX, startY: e.clientY, start: tabs[index]!.pos, removed: false };
    const base = [...tabs];
    act((d, ptX, ev) => {
      if (d.kind !== 'tab') return;
      if (Math.abs(ev.clientY - d.startY) > 24) {
        // dragged off the ruler: the stop is removed
        d.removed = true;
        setTabs(base.filter((_, i) => i !== d.index));
        return;
      }
      d.removed = false;
      const pos = Math.max(0, Math.min(textW, snap(ptX - p.marginLeft)));
      setTabs(base.map((t, i) => (i === d.index ? { ...t, pos } : t)));
    }, root);
  };

  const onBaseline = (e: React.PointerEvent) => {
    if (!para || inList) return;
    const root = e.currentTarget as HTMLElement;
    const ptX = toPt(e.clientX, root) - p.marginLeft;
    if (ptX < 0 || ptX > textW) return;
    setTabs([...tabs, { pos: snap(ptX), kind: ctl.tabKind, leader: 'none' }]);
  };

  // ticks
  const ticks: React.ReactNode[] = [];
  const step = imperial ? PT_PER_IN / 8 : PT_PER_CM / 2;
  const n = Math.floor(textW / step);
  for (let i = 0; i <= n; i++) {
    const pt = i * step;
    const major = imperial ? i % 8 === 0 : i % 2 === 0;
    const mid = !major && (imperial ? i % 4 === 0 : false);
    const px = (p.marginLeft + pt) * k;
    ticks.push(<span key={`t${i}`} className={`nw-tick${major ? ' is-major' : mid ? ' is-mid' : ''}`} style={{ left: px }} />);
    if (major && i > 0) {
      ticks.push(
        <span key={`n${i}`} className="nw-ticknum" style={{ left: px }}>
          {imperial ? i / 8 : i / 2}
        </span>,
      );
    }
  }

  return (
    <div className="nw-hruler" style={{ width: W, marginLeft: x0 }} onPointerDown={onBaseline} role="presentation">
      <div className="nw-hruler-margin" style={{ left: 0, width: p.marginLeft * k }} />
      <div className="nw-hruler-margin" style={{ left: (p.width - p.marginRight) * k, width: p.marginRight * k }} />
      <div className="nw-hruler-handle" style={{ left: p.marginLeft * k - 3 }} title={t('Margen izquierdo')} onPointerDown={onMargin('left')} />
      <div className="nw-hruler-handle" style={{ left: (p.width - p.marginRight) * k - 3 }} title={t('Margen derecho')} onPointerDown={onMargin('right')} />
      {ticks}
      {sec.props.cols.count > 1 &&
        (() => {
          const cw = sec.props.cols;
          const each = (textW - cw.space * (cw.count - 1)) / cw.count;
          return Array.from({ length: cw.count - 1 }, (_, i) => (
            <span key={`c${i}`} className="nw-hruler-col" style={{ left: (p.marginLeft + (i + 1) * each + i * cw.space) * k, width: cw.space * k }} title={t('Espacio entre columnas')} />
          ));
        })()}
      {para && !inList && (
        <>
          <button type="button" aria-label={t('Sangría de primera línea')} title={t('Sangría de primera línea')} className="nw-mk nw-mk-first" style={{ left: (p.marginLeft + left + first) * k - 5 }} onPointerDown={onMarker('indentFirst')} />
          <button type="button" aria-label={t('Sangría izquierda')} title={t('Sangría izquierda')} className="nw-mk nw-mk-left" style={{ left: (p.marginLeft + left) * k - 5 }} onPointerDown={onMarker('indentLeft')} />
          <button type="button" aria-label={t('Sangría derecha')} title={t('Sangría derecha')} className="nw-mk nw-mk-right" style={{ left: (p.width - p.marginRight - right) * k - 5 }} onPointerDown={onMarker('indentRight')} />
          {tabs.map((tb, i) => (
            <button
              key={`${tb.pos}-${i}`}
              type="button"
              className={`nw-tabstop nw-tabstop-${tb.kind}`}
              aria-label={t('Tabulación')}
              title={t('Tabulación: arrastre para mover; fuera de la regla para quitarla')}
              style={{ left: (p.marginLeft + tb.pos) * k - 4 }}
              onPointerDown={onTab(i)}
            >
              {TAB_GLYPH[tb.kind]}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

/** Selector at the left of the ruler: the kind of tab stop that a click on the ruler adds. */
export function TabKindButton({ ctl }: { ctl: WriterCtl }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const names: Record<TabStop['kind'], string> = { left: t('Tabulación izquierda'), center: t('Tabulación centrada'), right: t('Tabulación derecha'), decimal: t('Tabulación decimal'), bar: t('Tabulación de barra') };
  return (
    <button
      type="button"
      className="nw-tabkind"
      title={names[ctl.tabKind]}
      aria-label={names[ctl.tabKind]}
      onClick={() => {
        ctl.tabKind = TAB_KINDS[(TAB_KINDS.indexOf(ctl.tabKind) + 1) % TAB_KINDS.length]!;
        ctl.touch();
      }}
    >
      {TAB_GLYPH[ctl.tabKind]}
    </button>
  );
}

/** The vertical ruler: top and bottom margins of the page that holds the caret. */
export function VRuler({ ctl, zoom }: { ctl: WriterCtl; zoom: number }) {
  useSyncExternalStore(ctl.subscribe, ctl.getVersion);
  const drag = useRef<Drag | null>(null);
  const rects = ctl.pageRects();
  const idx = Math.min(rects.length - 1, Math.max(0, ctl.currentPage() - 1));
  const r = rects[idx];
  const sec = ctl.sections()[r?.spec.section ?? 0];
  if (!r || !sec) return null;
  const z = zoom / 100;
  const k = PX * z;
  const p = sec.props.page;
  const imperial = getLocale() === 'en';
  const unit = imperial ? PT_PER_IN : PT_PER_CM;
  const textH = p.height - p.marginTop - p.marginBottom;
  const snap = (v: number) => Math.round(v / (unit / (imperial ? 16 : 20))) * (unit / (imperial ? 16 : 20));
  const begin = (side: 'top' | 'bottom') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const root = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    drag.current = { kind: side, startY: e.clientY, start: side === 'top' ? p.marginTop : p.marginBottom };
    const move = (ev: PointerEvent) => {
      const ptY = (ev.clientY - root.getBoundingClientRect().top) / k;
      if (side === 'top') ctl.setPage({ marginTop: Math.max(0, Math.min(p.height - p.marginBottom - 72, snap(ptY))) }, 'section');
      else ctl.setPage({ marginBottom: Math.max(0, Math.min(p.height - p.marginTop - 72, snap(p.height - ptY))) }, 'section');
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const step = imperial ? PT_PER_IN / 8 : PT_PER_CM / 2;
  const ticks: React.ReactNode[] = [];
  for (let i = 0; i <= Math.floor(textH / step); i++) {
    const major = imperial ? i % 8 === 0 : i % 2 === 0;
    const y = (p.marginTop + i * step) * k;
    ticks.push(<span key={`t${i}`} className={`nw-vtick${major ? ' is-major' : ''}`} style={{ top: y }} />);
    if (major && i > 0) ticks.push(<span key={`n${i}`} className="nw-vticknum" style={{ top: y }}>{imperial ? i / 8 : i / 2}</span>);
  }
  return (
    <div className="nw-vruler" style={{ left: r.left * z - 24, top: r.top * z, height: p.height * k }}>
      <div className="nw-hruler-margin" style={{ top: 0, height: p.marginTop * k, left: 0, right: 0, width: 'auto' }} />
      <div className="nw-hruler-margin" style={{ top: (p.height - p.marginBottom) * k, height: p.marginBottom * k, left: 0, right: 0, width: 'auto' }} />
      <div className="nw-vruler-handle" style={{ top: p.marginTop * k - 3 }} title={t('Margen superior')} onPointerDown={begin('top')} />
      <div className="nw-vruler-handle" style={{ top: (p.height - p.marginBottom) * k - 3 }} title={t('Margen inferior')} onPointerDown={begin('bottom')} />
      {ticks}
    </div>
  );
}

void ptToPx;
