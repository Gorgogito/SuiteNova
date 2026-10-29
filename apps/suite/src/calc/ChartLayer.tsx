import type { ChartDef } from '@suitenova/calc-engine';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { chartOption } from './chartOption';
import { chart3dFor, echarts, is3D } from './chartRender';
import type { CalcDoc } from './doc';
import { colX, type Layout, type Viewport } from './render';

interface Rect4 {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_W = 160;
const MIN_H = 110;

function ChartView({ doc, chart, rect, dark, selected, onPointerDown }: { doc: CalcDoc; chart: ChartDef; rect: { x: number; y: number; w: number; h: number }; dark: boolean; selected: boolean; onPointerDown: (e: React.PointerEvent, handle: Handle | 'move') => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<echarts.ECharts | null>(null);
  const lastOption = useRef('');
  const palette = useMemo(() => (dark ? { text: '#e0e0e0', grid: '#444444', bg: '#252525' } : { text: '#333333', grid: '#dddddd', bg: '#ffffff' }), [dark]);
  const threeD = is3D(chart);
  const option = useMemo(() => (threeD ? {} : chartOption(chart, doc.wb, doc.activeSheetId, doc.locale, palette)), [chart, doc, palette, threeD, doc.getVersion()]);
  const svg = useMemo(() => (threeD ? chart3dFor(chart, doc.wb, doc.activeSheetId, doc.locale, palette, rect.w, rect.h) : ''), [chart, doc, palette, threeD, rect.w, rect.h, doc.getVersion()]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || threeD) return;
    const inst = echarts.init(el, undefined, { renderer: 'canvas' });
    instRef.current = inst;
    lastOption.current = '';
    return () => {
      inst.dispose();
      instRef.current = null;
    };
  }, [threeD]);

  useEffect(() => {
    const inst = instRef.current;
    if (!inst || threeD) return;
    const key = JSON.stringify(option);
    if (key !== lastOption.current) {
      inst.setOption(option, true);
      lastOption.current = key;
    }
  }, [option, threeD]);

  useEffect(() => {
    instRef.current?.resize({ width: Math.max(10, rect.w), height: Math.max(10, rect.h) });
  }, [rect.w, rect.h]);

  return (
    <div
      className={`calc-chart ${selected ? 'is-selected' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      role="img"
      aria-label={chart.title ?? 'Gráfico'}
      data-chart-id={chart.id}
    >
      {threeD ? <div className="calc-chart__canvas calc-chart__svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <div ref={hostRef} className="calc-chart__canvas" />}
      {selected &&
        HANDLES.map((h) => (
          <span
            key={h}
            className={`calc-chart__handle calc-chart__handle--${h}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onPointerDown(e, h);
            }}
          />
        ))}
    </div>
  );
}

/** Charts of the active sheet, positioned over the grid and manipulable with the mouse. */
export function ChartLayer({ doc, layout, viewport, zoom, dark }: { doc: CalcDoc; layout: Layout; viewport: Viewport; zoom: number; dark: boolean }) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const [preview, setPreview] = useState<{ id: string; r: Rect4 } | null>(null);
  const charts = doc.sheet.charts;
  if (!charts.length) return null;
  const fw = colX(layout, layout.frozenCols);
  const fh = layout.rowAxis.offset(layout.frozenRows) * zoom;

  const place = (r: Rect4) => {
    const ax = r.x * zoom;
    const ay = r.y * zoom;
    return {
      x: ax - (ax >= fw ? viewport.scrollX : 0),
      y: ay - (ay >= fh ? viewport.scrollY : 0),
      w: r.width * zoom,
      h: r.height * zoom,
    };
  };

  const begin = (c: ChartDef, e: React.PointerEvent, mode: Handle | 'move') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    doc.commitIfEditing();
    doc.selectChart(c.id);
    const start = { x: e.clientX, y: e.clientY };
    const orig: Rect4 = { x: c.x, y: c.y, width: c.width, height: c.height };
    let latest = orig;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / zoom;
      const dy = (ev.clientY - start.y) / zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      let { x, y, width, height } = orig;
      if (mode === 'move') {
        x = Math.max(0, orig.x + dx);
        y = Math.max(0, orig.y + dy);
      } else {
        if (mode.includes('e')) width = Math.max(MIN_W, orig.width + dx);
        if (mode.includes('s')) height = Math.max(MIN_H, orig.height + dy);
        if (mode.includes('w')) {
          width = Math.max(MIN_W, orig.width - dx);
          x = Math.max(0, orig.x + orig.width - width);
        }
        if (mode.includes('n')) {
          height = Math.max(MIN_H, orig.height - dy);
          y = Math.max(0, orig.y + orig.height - height);
        }
      }
      latest = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
      setPreview({ id: c.id, r: latest });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPreview(null);
      if (moved) doc.updateChart(c.id, latest, mode === 'move' ? 'Mover gráfico' : 'Cambiar tamaño del gráfico');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="calc-charts" style={{ left: layout.headerW, top: layout.headerH }}>
      {charts.map((c) => {
        const r = preview?.id === c.id ? preview.r : { x: c.x, y: c.y, width: c.width, height: c.height };
        return <ChartView key={c.id} doc={doc} chart={c} rect={place(r)} dark={dark} selected={doc.selectedChart === c.id} onPointerDown={(e, mode) => begin(c, e, mode)} />;
      })}
    </div>
  );
}
