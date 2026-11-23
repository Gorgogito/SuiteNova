import { invoke } from '@tauri-apps/api/core';
import { t } from '@suitenova/core-ui';
import { clampPoint, describeSize, isZone, rectBetween, viewToImage, type Point, type Rect } from '@suitenova/clip-core';
import { useEffect, useRef, useState } from 'react';
import './messages';

/**
 * The page of a selection window of the desktop app (`?app=clip-overlay&monitor=N`): it covers one monitor with the frozen capture, dimmed, and the
 * person drags the area on it, like Office's Screen Clipping. Enter takes the whole screen, Esc (or the right button) cancels.
 * It tells the desktop app what was chosen with `clip_pick_done`; the zone is in pixels of the capture of this monitor.
 */
export function ClipOverlay() {
  const monitor = Number(new URLSearchParams(location.search).get('monitor') ?? 0);
  const view = useRef<HTMLCanvasElement>(null);
  const image = useRef<ImageBitmap | null>(null);
  const [zone, setZone] = useState<Rect | null>(null);
  const [ready, setReady] = useState(false);
  // the desktop app resizes this window to the monitor after it has loaded, so what is drawn follows the size of the window
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const drag = useRef<Point | null>(null);
  const done = useRef(false);

  const finish = (rect: Rect | null | 'cancel') => {
    if (done.current) return;
    done.current = true;
    const img = image.current;
    const r = rect === 'cancel' ? null : rect && img ? viewToImage(rect, { w: innerWidth, h: innerHeight }, { w: img.width, h: img.height }) : null;
    const result = rect === 'cancel' ? null : { monitor, rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) } : null };
    void invoke('clip_pick_done', { result });
  };

  useEffect(() => {
    document.documentElement.style.cssText = 'margin:0;overflow:hidden;background:#000;cursor:crosshair';
    document.body.style.cssText = 'margin:0;overflow:hidden;background:#000';
    let live = true;
    void (async () => {
      const bytes = await invoke<ArrayBuffer>('clip_shot', { monitor });
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      if (!live) return;
      image.current = bmp;
      setReady(true);
    })().catch(() => finish('cancel'));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish('cancel');
      else if (e.key === 'Enter') finish(null);
    };
    const resize = () => setSize({ w: innerWidth, h: innerHeight });
    addEventListener('keydown', key);
    addEventListener('resize', resize);
    return () => {
      live = false;
      removeEventListener('keydown', key);
      removeEventListener('resize', resize);
    };
  }, []);

  // draw: the capture, dimmed, with the chosen area at full brightness
  useEffect(() => {
    const cv = view.current;
    const img = image.current;
    if (!cv || !img || !ready) return;
    const { w, h } = size;
    const dpr = devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    const g = cv.getContext('2d')!;
    g.drawImage(img, 0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(0, 0, cv.width, cv.height);
    if (isZone(zone, 1)) {
      const s = cv.width / w;
      g.drawImage(img, (zone.x / w) * img.width, (zone.y / h) * img.height, (zone.w / w) * img.width, (zone.h / h) * img.height, zone.x * s, zone.y * s, zone.w * s, zone.h * s);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2 * s;
      g.setLineDash([6 * s, 4 * s]);
      g.strokeRect(zone.x * s, zone.y * s, zone.w * s, zone.h * s);
    }
  }, [ready, zone, size]);

  useEffect(() => {
    // the page is on screen only when the capture is drawn (the desktop app places the window and shows it)
    if (ready) requestAnimationFrame(() => void invoke('clip_overlay_ready').catch(() => finish('cancel')));
  }, [ready]);

  const at = (e: React.PointerEvent): Point => clampPoint({ x: e.clientX, y: e.clientY }, { w: innerWidth, h: innerHeight });
  const img = image.current;
  const real = zone && img && isZone(zone, 1) ? viewToImage(zone, { w: innerWidth, h: innerHeight }, { w: img.width, h: img.height }) : null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, cursor: 'crosshair', userSelect: 'none', touchAction: 'none' }}
      onContextMenu={(e) => {
        e.preventDefault();
        finish('cancel');
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = at(e);
        setZone(null);
      }}
      onPointerMove={(e) => drag.current && setZone(rectBetween(drag.current, at(e)))}
      onPointerUp={(e) => {
        const from = drag.current;
        drag.current = null;
        if (!from) return;
        const z = rectBetween(from, at(e));
        if (isZone(z)) finish(z);
        else setZone(null);
      }}
    >
      <canvas ref={view} aria-hidden="true" style={{ display: 'block' }} />
      <div role="status" style={{ position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)', background: 'rgba(32,32,32,.88)', color: '#fff', padding: '6px 14px', borderRadius: 6, font: '14px Segoe UI, system-ui, sans-serif', pointerEvents: 'none' }}>
        {real ? describeSize(real) : t('Arrastra para elegir la zona · Intro: toda la pantalla · Esc: cancelar')}
      </div>
    </div>
  );
}
