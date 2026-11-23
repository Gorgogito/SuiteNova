import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { clampPoint, clipFileName, cropBox, describeSize, fitScale, isZone, moveRect, rectBetween, resizeRect, type Point, type Rect } from '@suitenova/clip-core';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import './messages';
import { useRestorePage } from './restorePage';
import { cropToPng } from './source';

/**
 * The screen clip dialog shared by every product: the capture is shown and the person chooses the area with the pointer or the keyboard, then
 * inserts it, copies it or saves it as a PNG. With no area, the whole capture is used. What to do with the PNG when inserting is the product's.
 */
export function ClipDialog({ canvas, onInsert, onClose }: { canvas: HTMLCanvasElement; onInsert: (png: Blob, w: number, h: number) => void | Promise<void>; onClose: () => void }) {
  const bounds = { w: canvas.width, h: canvas.height };
  const view = useRef<HTMLCanvasElement>(null);
  const [zone, setZone] = useState<Rect | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useRestorePage();
  const drag = useRef<{ mode: 'new' | 'move'; from: Point; start: Rect | null } | null>(null);
  const scale = fitScale(bounds, { w: 860, h: 460 });

  useEffect(() => {
    const v = view.current!;
    v.width = Math.max(1, Math.round(bounds.w * scale));
    v.height = Math.max(1, Math.round(bounds.h * scale));
    v.getContext('2d')!.drawImage(canvas, 0, 0, v.width, v.height);
  }, [canvas, bounds.w, bounds.h, scale]);

  /** Where the pointer is, in pixels of the capture. */
  const at = (e: PointerEvent): Point => {
    const r = view.current!.getBoundingClientRect();
    return clampPoint({ x: ((e.clientX - r.left) / (r.width || 1)) * bounds.w, y: ((e.clientY - r.top) / (r.height || 1)) * bounds.h }, bounds);
  };
  const inside = (p: Point, z: Rect | null) => !!z && isZone(z) && p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    const p = at(e);
    drag.current = inside(p, zone) ? { mode: 'move', from: p, start: zone } : { mode: 'new', from: p, start: null };
    if (drag.current.mode === 'new') setZone({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const moveTo = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    setZone(d.mode === 'new' ? rectBetween(d.from, p) : moveRect(d.start!, p.x - d.from.x, p.y - d.from.y, bounds));
  };
  const up = () => {
    drag.current = null;
    setZone((z) => (isZone(z) ? z : null));
  };

  const key = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as string];
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setZone(null);
    } else if (dir) {
      e.preventDefault();
      // with no zone yet the first arrow starts one in the middle of the capture
      const z = isZone(zone) ? zone : { x: bounds.w / 4, y: bounds.h / 4, w: bounds.w / 2, h: bounds.h / 2 };
      setZone(e.ctrlKey ? resizeRect(z, dir[0]! * step, dir[1]! * step, bounds) : moveRect(z, dir[0]! * step, dir[1]! * step, bounds));
    }
  };

  const box = cropBox(zone, bounds);
  const png = () => cropToPng(canvas, box);
  const insert = async () => {
    setBusy(true);
    try {
      await onInsert(await png(), box.w, box.h);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })]);
      setNote(t('Copiado al portapapeles.'));
    } catch {
      setNote(t('No se pudo copiar la imagen al portapapeles.'));
    }
  };
  const save = async () => {
    const url = URL.createObjectURL(await png());
    const a = document.createElement('a');
    a.href = url;
    a.download = clipFileName(t('Recorte de pantalla'));
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 940, width: '96vw' }}>
        <DialogBody>
          <DialogTitle>{t('Recorte de pantalla')}</DialogTitle>
          <DialogContent>
            <p style={{ marginTop: 0 }}>{t('Arrastra sobre la captura para elegir la zona, o arrástrala desde dentro para moverla. Con el teclado: flechas para mover, Ctrl y flechas para cambiar el tamaño, Mayús para ir de 10 en 10, Supr para quitar la zona. Si no eliges ninguna se usa la captura entera.')}</p>
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', overflow: 'hidden', touchAction: 'none', lineHeight: 0 }}>
              <canvas
                ref={view}
                tabIndex={0}
                role="application"
                aria-label={`${t('Captura de pantalla')}: ${isZone(zone) ? `${t('Zona elegida')} ${describeSize(box)}` : t('Toda la captura')}`}
                data-testid="clip-canvas"
                style={{ maxWidth: '100%', height: 'auto', cursor: 'crosshair', display: 'block' }}
                onPointerDown={down}
                onPointerMove={moveTo}
                onPointerUp={up}
                onKeyDown={key}
              />
              {isZone(zone) && <div data-testid="clip-zone" style={{ position: 'absolute', left: pct(zone.x, bounds.w), top: pct(zone.y, bounds.h), width: pct(zone.w, bounds.w), height: pct(zone.h, bounds.h), border: '2px dashed #ffffff', outline: '1px solid #0f6cbd', boxShadow: '0 0 0 9999px rgba(0,0,0,.45)', pointerEvents: 'none' }} />}
            </div>
            <div aria-live="polite" style={{ marginTop: 6, minHeight: 20, opacity: 0.8 }}>
              {note || `${isZone(zone) ? t('Zona elegida') : t('Toda la captura')}: ${describeSize(box)}`}
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => void copy()}>{t('Copiar')}</Button>
            <Button onClick={() => void save()}>{t('Guardar como PNG')}</Button>
            <Button onClick={onClose}>{t('Cancelar')}</Button>
            <Button appearance="primary" disabled={busy} onClick={() => void insert()}>
              {isZone(zone) ? t('Insertar el recorte') : t('Insertar todo')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
