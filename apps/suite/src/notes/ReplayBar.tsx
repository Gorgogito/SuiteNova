import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useEffect, useRef, useState } from 'react';
import type { NotesCtl } from './ctl';

/** Barra de reproducción de la tinta: vuelve a dibujar los trazos en el orden en que se hicieron. */
export function ReplayBar({ ctl }: { ctl: NotesCtl }) {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const frac = ctl.replay ?? 0;
  const ref = useRef(frac);
  ref.current = frac;
  useEffect(() => {
    if (!playing) return;
    // la reproducción entera dura unos 6 s a velocidad normal (50 ms por paso), tenga la tinta que tenga
    const id = setInterval(() => {
      const next = Math.min(1, ref.current + speed / 120);
      ctl.setReplay(next);
      if (next >= 1) setPlaying(false);
    }, 50);
    return () => clearInterval(id);
  }, [playing, speed, ctl]);
  return (
    <div className="nn-recbar nn-replay" role="group" aria-label={t('Reproducción de la tinta')}>
      <Button
        size="small"
        onClick={() => {
          if (frac >= 1) ctl.setReplay(0);
          setPlaying((p) => !p);
        }}
      >
        {playing ? t('Pausa') : frac >= 1 ? t('Repetir') : t('Reproducir')}
      </Button>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(frac * 1000)}
        aria-label={t('Posición')}
        onChange={(e) => {
          setPlaying(false);
          ctl.setReplay(Number(e.target.value) / 1000);
        }}
      />
      <label>
        {t('Velocidad')}{' '}
        <select className="nv-select" aria-label={t('Velocidad de reproducción')} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          <option value={0.5}>0,5×</option>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={4}>4×</option>
        </select>
      </label>
      <Button size="small" appearance="primary" onClick={() => ctl.setReplay(null)}>
        {t('Cerrar')}
      </Button>
    </div>
  );
}
