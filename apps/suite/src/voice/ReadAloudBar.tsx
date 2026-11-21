import { t } from '@suitenova/core-ui';
import { RATES } from '@suitenova/speech-core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { VoiceController } from './controller';
import './messages';
import './voice.css';

const primary = (l: string): string => l.toLowerCase().split(/[-_]/)[0]!;

/**
 * The bar every product shows while it reads aloud (as in Word, Outlook and OneNote): previous, play or pause, next, stop, speed and voice, and where
 * the reading is. The product decides what is read and shows the words; the bar only drives the reader.
 */
export function ReadAloudBar({ ctrl, onClose, label }: { ctrl: VoiceController; onClose: () => void; label?: string }) {
  useSyncExternalStore(ctrl.subscribe, ctrl.getVersion);
  // the list of voices can arrive late (the system loads it after the first look)
  const [voices, setVoices] = useState(() => ctrl.voices());
  useEffect(() => {
    const refresh = () => setVoices(ctrl.voices());
    refresh();
    window.speechSynthesis?.addEventListener?.('voiceschanged', refresh);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', refresh);
  }, [ctrl]);
  const s = ctrl.snapshot;
  const r = ctrl.reader;
  const lang = primary(s.lang);
  const mine = voices.filter((v) => primary(v.lang) === lang);
  const playing = s.state === 'playing';
  return (
    <div className="nv-voicebar" role="toolbar" aria-label={label ?? t('Leer en voz alta')}>
      {!ctrl.available ? (
        <span role="alert">{t('Este sistema no tiene síntesis de voz disponible.')}</span>
      ) : (
        <>
          <button type="button" className="nv-voicebar__btn" aria-label={t('Voz anterior')} title={t('Frase anterior')} onClick={() => r.previous()}>
            ⏮
          </button>
          <button
            type="button"
            className="nv-voicebar__btn nv-voicebar__btn--main"
            aria-label={playing ? t('Pausa') : t('Reproducir')}
            title={playing ? t('Pausa') : t('Reproducir')}
            onClick={() => (playing ? r.pause() : s.state === 'paused' ? r.resume() : r.play())}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button type="button" className="nv-voicebar__btn" aria-label={t('Voz siguiente')} title={t('Frase siguiente')} onClick={() => r.next()}>
            ⏭
          </button>
          <button type="button" className="nv-voicebar__btn" aria-label={t('Detener la lectura')} title={t('Detener la lectura')} disabled={s.state === 'idle'} onClick={() => r.stop()}>
            ⏹
          </button>
          <label className="nv-voicebar__field">
            <span>{t('Velocidad')}</span>
            <select aria-label={t('Velocidad de lectura')} value={String(s.rate)} onChange={(e) => ctrl.setRate(Number(e.target.value))}>
              {[...new Set<number>([...RATES, s.rate])].sort((a, b) => a - b).map((x) => (
                <option key={x} value={String(x)}>
                  {x}×
                </option>
              ))}
            </select>
          </label>
          <label className="nv-voicebar__field">
            <span>{t('Voz')}</span>
            <select aria-label={t('Voz de lectura')} value={r.voices[lang] ?? ''} onChange={(e) => ctrl.setVoice(lang, e.target.value)}>
              <option value="">{t('Automática')}</option>
              {mine.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <span className="nv-voicebar__status" aria-live="polite">
            {s.error ? t('No se pudo leer: {e}', { e: s.error }) : s.index >= 0 ? t('Frase {n} de {total}', { n: s.index + 1, total: s.count }) : t('Nada que leer')}
          </span>
          {s.noVoice && (
            <span className="nv-voicebar__warn" role="status">
              {t('No hay una voz instalada para este idioma; se usa la del sistema. Puede añadir voces en la configuración de Windows (Hora e idioma › Voz).')}
            </span>
          )}
        </>
      )}
      <button type="button" className="nv-voicebar__btn nv-voicebar__close" aria-label={t('Cerrar la lectura')} title={t('Cerrar la lectura')} onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
