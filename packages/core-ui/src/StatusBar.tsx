import { Minus, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from './i18n';

export interface ZoomState {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function clampZoom(value: number, min = 10, max = 400): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function ZoomControl({ value, onChange, min = 10, max = 400, step = 10 }: ZoomState) {
  return (
    <div className="nv-zoom" role="group" aria-label={t('zoom.label')}>
      <button type="button" aria-label={t('zoom.out')} onClick={() => onChange(clampZoom(value - step, min, max))}>
        <Minus size={14} />
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={t('zoom.label')}
        onChange={(e) => onChange(clampZoom(Number(e.target.value), min, max))}
      />
      <button type="button" aria-label={t('zoom.in')} onClick={() => onChange(clampZoom(value + step, min, max))}>
        <Plus size={14} />
      </button>
      <button type="button" className="nv-zoom__value" title={t('zoom.reset')} onClick={() => onChange(100)}>
        {value}%
      </button>
    </div>
  );
}

export function StatusBar({ left, right, zoom }: { left?: ReactNode; right?: ReactNode; zoom?: ZoomState }) {
  return (
    <footer className="nv-status" role="status">
      <div className="nv-status__left">{left}</div>
      <div className="nv-status__right">
        {right}
        {zoom && <ZoomControl {...zoom} />}
      </div>
    </footer>
  );
}
