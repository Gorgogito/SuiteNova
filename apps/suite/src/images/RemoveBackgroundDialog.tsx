import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { removeBackground, resample, type Pixels, type Pt } from '@suitenova/image-core';
import { useEffect, useRef, useState } from 'react';
import { paint } from './canvas';
import type { PictureHost } from './host';
import { PictureModal } from './PictureModal';

type Mode = 'none' | 'keep' | 'remove';
const MAX = 480;

/**
 * «Quitar fondo»: takes off the plain background that touches the edges, and the user can mark areas to keep (they stay even if they look like
 * the background) or to remove (they go even if they do not touch the edge). The marks are kept with the picture, so the background can be
 * brought back or changed later. The preview works on a shrunk copy; the marks are points of the full-size image.
 */
export function RemoveBackgroundDialog({ host, onClose }: { host: PictureHost; onClose: () => void }) {
  const start = host.pixelEdits().background;
  const [tol, setTol] = useState(start?.tolerance ?? 40);
  const [keep, setKeep] = useState<Pt[]>(start?.keep ?? []);
  const [remove, setRemove] = useState<Pt[]>(start?.remove ?? []);
  const [mode, setMode] = useState<Mode>('none');
  const [img, setImg] = useState<{ small: Pixels; k: number } | null>(null);
  const [info, setInfo] = useState('');
  const view = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    void host.original().then((p) => {
      if (!live || !p) return;
      const k = Math.min(1, MAX / Math.max(p.w, p.h));
      setImg({ small: k < 1 ? resample(p, p.w * k, p.h * k) : p, k });
    });
    return () => {
      live = false;
    };
  }, [host]);

  useEffect(() => {
    if (!img || !view.current) return;
    const sc = (l: Pt[]) => l.map((p) => ({ x: p.x * img.k, y: p.y * img.k }));
    const { pixels, removed } = removeBackground(img.small, tol, null, { keep: sc(keep), remove: sc(remove) });
    setInfo(removed ? t('Se quita el {n} % de la imagen.', { n: Math.round((removed / (img.small.w * img.small.h)) * 100) }) : t('No se encontró un fondo liso en los bordes: la imagen no cambia.'));
    paint(view.current, pixels);
    // the marks, drawn over the picture
    const g = view.current.getContext('2d')!;
    for (const [list, color] of [[keep, '#16a34a'], [remove, '#dc2626']] as const)
      for (const p of list) {
        g.beginPath();
        g.arc(p.x * img.k, p.y * img.k, 5, 0, Math.PI * 2);
        g.fillStyle = color;
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.stroke();
      }
  }, [img, tol, keep, remove]);

  const mark = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'none' || !img) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * img.small.w / img.k, y: ((e.clientY - r.top) / r.height) * img.small.h / img.k };
    (mode === 'keep' ? setKeep : setRemove)((l) => [...l, p].slice(-50));
  };
  const accept = async () => {
    const cur = host.pixelEdits();
    await host.setPixelEdits({ ...cur, background: { tolerance: tol, ...(keep.length ? { keep } : {}), ...(remove.length ? { remove } : {}) } }, t('Quitar fondo'));
    onClose();
  };
  const discard = async () => {
    const { background: _b, ...rest } = host.pixelEdits();
    void _b;
    await host.setPixelEdits(rest, t('Quitar fondo'));
    onClose();
  };
  return (
    <PictureModal
      title={t('Quitar fondo')}
      onClose={onClose}
      width={620}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button disabled={!start} onClick={() => void discard()}>
            {t('Descartar todos los cambios')}
          </Button>
          <Button appearance="primary" disabled={!img} onClick={() => void accept()}>
            {t('Conservar los cambios')}
          </Button>
        </>
      }
    >
      <div className="nv-img__bg">
        <p className="nv-img__note">{t('Quita el fondo de un solo color que toca los bordes de la imagen. No reconoce personas ni objetos: con fondos con degradado, sombras o del mismo color que el sujeto, marque las áreas a conservar o a quitar.')}</p>
        <div className="nv-img__bar" role="radiogroup" aria-label={t('Marcar áreas')}>
          {([['none', 'Sin marcar'], ['keep', 'Marcar áreas para mantener'], ['remove', 'Marcar áreas para quitar']] as const).map(([m, label]) => (
            <label key={m}>
              <input type="radio" name="bg-mode" checked={mode === m} onChange={() => setMode(m)} /> {t(label)}
            </label>
          ))}
          <Button size="small" disabled={!keep.length && !remove.length} onClick={() => (setKeep([]), setRemove([]))}>
            {t('Quitar marcas')}
          </Button>
        </div>
        <div className="nv-img__preview">
          <canvas ref={view} aria-label={t('Vista previa')} onClick={mark} style={{ cursor: mode === 'none' ? 'default' : 'crosshair' }} />
        </div>
        <label className="nv-img__row">
          <span>{t('Tolerancia de color')}: {tol}</span>
          <input type="range" min={5} max={160} value={tol} aria-label={t('Tolerancia de color')} onChange={(e) => setTol(Number(e.target.value))} />
        </label>
        <p className="nv-img__note" aria-live="polite">
          {info} {keep.length + remove.length > 0 && t('Marcas: {k} para mantener, {r} para quitar.', { k: keep.length, r: remove.length })}
        </p>
      </div>
    </PictureModal>
  );
}
