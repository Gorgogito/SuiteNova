import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { ARTISTIC_EFFECTS, DEFAULT_LEVEL, NEUTRAL_TEMPERATURE, applyPixelEdits, normalizePixelEdits, recolorPresets, resample, type Pixels, type PixelEdits } from '@suitenova/image-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { paint } from './canvas';
import type { PictureHost } from './host';
import { PictureModal } from './PictureModal';

export type FormatTab = 'corrections' | 'color' | 'artistic';

/** One slider with its value, a number box and a button to put it back. */
function Slider({ label, value, min, max, step = 1, neutral, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; neutral: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="nv-img__row">
      <label>
        <span>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      </label>
      <input type="number" min={min} max={max} step={step} value={value} aria-label={`${label} (${unit})`} className="nv-img__num" onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} />
      <span className="nv-img__unit">{unit}</span>
      <Button size="small" appearance="subtle" disabled={value === neutral} aria-label={`${t('Restablecer')}: ${label}`} onClick={() => onChange(neutral)}>
        ↺
      </Button>
    </div>
  );
}

/**
 * «Formato de imagen» for the selected pictures: corrections (brightness, contrast, sharpness), colour (saturation, temperature,
 * transparency, recolor) and artistic effects with their intensity. A preview on a shrunk copy of the original follows every change; Accept
 * gives the edits to the product, in one step. Nothing is lost: the original stays and «Restablecer imagen» brings it back.
 */
export function FormatPictureDialog({ host, tab: first = 'corrections', onClose }: { host: PictureHost; tab?: FormatTab; onClose: () => void }) {
  const [tab, setTab] = useState<FormatTab>(first);
  const [edits, setEdits] = useState<PixelEdits>(() => host.pixelEdits());
  const [src, setSrc] = useState<Pixels | null>(null);
  const [busy, setBusy] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  const set = (patch: Partial<PixelEdits>) => setEdits((e) => ({ ...e, ...patch }));
  const presets = useMemo(() => recolorPresets(host.accent()), [host]);

  useEffect(() => {
    let live = true;
    void host.original().then((p) => {
      if (!live || !p) return;
      // a copy small enough to follow the sliders
      const k = Math.min(1, 420 / Math.max(p.w, p.h));
      setSrc(k < 1 ? resample(p, p.w * k, p.h * k) : p);
    });
    return () => {
      live = false;
    };
  }, [host]);
  useEffect(() => {
    if (!src || !view.current) return;
    // the marks of the background are points of the full-size image: the preview leaves that edit out
    const { background: _b, ...rest } = edits;
    void _b;
    paint(view.current, applyPixelEdits(src, rest));
  }, [src, edits]);

  const recolorId = presets.find((p) => JSON.stringify(p.recolor ?? null) === JSON.stringify(edits.recolor ?? null))?.id ?? 'custom';
  const accept = async () => {
    setBusy(true);
    try {
      await host.setPixelEdits(normalizePixelEdits(edits) ?? {}, t('Formato de imagen'));
    } finally {
      setBusy(false);
      onClose();
    }
  };
  const tabs: [FormatTab, string][] = [
    ['corrections', t('Correcciones')],
    ['color', t('Color')],
    ['artistic', t('Efectos artísticos')],
  ];
  const art = edits.artistic;
  return (
    <PictureModal
      title={t('Formato de imagen')}
      onClose={onClose}
      width={720}
      actions={
        <>
          <Button onClick={() => setEdits((e) => ({ background: e.background }))}>{t('Restablecer todo')}</Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={busy || !src} onClick={() => void accept()}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div className="nv-img__dlg">
        <div className="nv-img__side">
          <div role="tablist" aria-label={t('Formato de imagen')} className="nv-img__tabs">
            {tabs.map(([id, name]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {name}
              </button>
            ))}
          </div>
          {tab === 'corrections' && (
            <div role="tabpanel" aria-label={t('Correcciones')}>
              <Slider label={t('Brillo')} unit="%" value={edits.brightness ?? 0} min={-100} max={100} neutral={0} onChange={(v) => set({ brightness: v })} />
              <Slider label={t('Contraste')} unit="%" value={edits.contrast ?? 0} min={-100} max={100} neutral={0} onChange={(v) => set({ contrast: v })} />
              <Slider label={t('Nitidez')} unit="%" value={edits.sharpness ?? 0} min={-100} max={100} neutral={0} onChange={(v) => set({ sharpness: v })} />
            </div>
          )}
          {tab === 'color' && (
            <div role="tabpanel" aria-label={t('Color')}>
              <Slider label={t('Saturación')} unit="%" value={edits.saturation ?? 100} min={0} max={400} neutral={100} onChange={(v) => set({ saturation: v })} />
              <Slider label={t('Temperatura')} unit="K" value={edits.temperature ?? NEUTRAL_TEMPERATURE} min={1500} max={11500} step={100} neutral={NEUTRAL_TEMPERATURE} onChange={(v) => set({ temperature: v })} />
              <Slider label={t('Transparencia')} unit="%" value={edits.transparency ?? 0} min={0} max={100} neutral={0} onChange={(v) => set({ transparency: v })} />
              <label className="nv-img__row">
                <span>{t('Recolorear')}</span>
                <select value={recolorId} aria-label={t('Recolorear')} onChange={(e) => set({ recolor: presets.find((p) => p.id === e.target.value)?.recolor ?? undefined })}>
                  {recolorId === 'custom' && <option value="custom">{t('Personalizado')}</option>}
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {t(p.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {tab === 'artistic' && (
            <div role="tabpanel" aria-label={t('Efectos artísticos')}>
              <label className="nv-img__row">
                <span>{t('Efecto')}</span>
                <select value={art?.id ?? ''} aria-label={t('Efecto artístico')} onChange={(e) => set({ artistic: e.target.value ? { id: e.target.value, level: art?.level ?? DEFAULT_LEVEL } : undefined })}>
                  <option value="">{t('Ninguno')}</option>
                  {ARTISTIC_EFFECTS.map((fx) => (
                    <option key={fx.id} value={fx.id}>
                      {t(fx.name)}
                    </option>
                  ))}
                </select>
              </label>
              {art && <Slider label={t('Intensidad')} unit="%" value={art.level ?? DEFAULT_LEVEL} min={0} max={100} neutral={DEFAULT_LEVEL} onChange={(v) => set({ artistic: { id: art.id, level: v } })} />}
              <p className="nv-img__note">{t('El efecto se aplica sobre la imagen original: se puede cambiar o quitar cuando quiera.')}</p>
            </div>
          )}
        </div>
        <div className="nv-img__preview">
          <canvas ref={view} aria-label={t('Vista previa')} />
          {!src && <p className="nv-img__note">{t('No se pudo leer la imagen.')}</p>}
        </div>
      </div>
    </PictureModal>
  );
}
