import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { newId, newMedia, samplesToWav, updateSlide, wavDuration, type MediaEl, type SlideElement } from '@suitenova/slides-core';
import { useEffect, useRef, useState } from 'react';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';

type P = { ui: SlidesUI; onClose: () => void };
const NAME = 'Narración';

/** Records the narration of the current slide with the microphone and stores it as an audio that plays by itself. */
export function NarrationDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const existing = c.slide.shapes.find((e): e is MediaEl => e.kind === 'media' && e.name === NAME);
  const [state, setState] = useState<'idle' | 'recording' | 'done'>('idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState('');
  const [advance, setAdvance] = useState(true);
  const [wav, setWav] = useState<Uint8Array | null>(null);
  const [url, setUrl] = useState('');
  const rec = useRef<{ stop: () => Uint8Array; cancel: () => void } | null>(null);

  useEffect(() => () => rec.current?.cancel(), []);
  useEffect(() => {
    if (state !== 'recording') return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const src = ac.createMediaStreamSource(stream);
      const proc = ac.createScriptProcessor(4096, 1, 1);
      const mute = ac.createGain();
      mute.gain.value = 0;
      const parts: Float32Array[] = [];
      proc.onaudioprocess = (e) => parts.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(proc);
      proc.connect(mute);
      mute.connect(ac.destination);
      const end = () => {
        proc.onaudioprocess = null;
        src.disconnect();
        proc.disconnect();
        stream.getTracks().forEach((x) => x.stop());
        void ac.close();
      };
      rec.current = {
        stop: () => {
          end();
          return samplesToWav(parts, ac.sampleRate);
        },
        cancel: end,
      };
      setSecs(0);
      setState('recording');
    } catch (e) {
      setError((e as Error).name === 'NotAllowedError' ? t('No se concedió permiso para usar el micrófono.') : t('No se pudo usar el micrófono: {error}', { error: (e as Error).message }));
    }
  };
  const stop = () => {
    const data = rec.current?.stop();
    rec.current = null;
    if (!data) return;
    setWav(data);
    setUrl(URL.createObjectURL(new Blob([data as BlobPart], { type: 'audio/wav' })));
    setState('done');
  };
  const save = () => {
    if (!wav) return;
    const id = newId('a');
    const ms = wavDuration(wav);
    const size = 36;
    const el: MediaEl = {
      ...newMedia('audio', id, 'audio/wav', c.deck.size.w - size - 12, c.deck.size.h - size - 12, size, size),
      name: NAME,
      descr: t('Narración de la diapositiva'),
      autoplay: true,
      hideWhenStopped: false,
    };
    c.apply('Grabar narración', (d) =>
      updateSlide({ ...d, assets: { ...d.assets, [id]: { id, mime: 'audio/wav', data: wav, name: 'narracion.wav' } } }, c.slide.id, (s) => ({
        ...s,
        shapes: [...s.shapes.filter((e) => !(e.kind === 'media' && e.name === NAME)), el] as SlideElement[],
        ...(advance ? { transition: { ...(s.transition ?? { type: 'cut' }), advTm: ms + 700 } } : {}),
      })),
    );
    onClose();
  };
  const remove = () => {
    c.apply('Quitar la narración', (d) => updateSlide(d, c.slide.id, (s) => ({ ...s, shapes: s.shapes.filter((e) => !(e.kind === 'media' && e.name === NAME)) })));
    onClose();
  };
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <Modal
      title={t('Grabar narración')}
      onClose={() => (rec.current?.cancel(), onClose())}
      actions={
        <>
          {existing && state === 'idle' && <Button onClick={remove}>{t('Quitar la narración')}</Button>}
          <Button onClick={() => (rec.current?.cancel(), onClose())}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={state !== 'done'} onClick={save}>
            {t('Guardar')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <p>{t('Diapositiva {n}', { n: c.index + 1 })}{existing ? ` · ${t('ya tiene una narración; se reemplazará')}` : ''}</p>
        <div className="sl-form__row" style={{ alignItems: 'center' }}>
          {state !== 'recording' ? (
            <Button appearance="primary" onClick={() => void start()}>
              {state === 'done' ? t('Grabar de nuevo') : t('Grabar')}
            </Button>
          ) : (
            <Button appearance="primary" onClick={stop}>
              {t('Detener')}
            </Button>
          )}
          <span role="timer" aria-label={t('Tiempo grabado')} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {state === 'recording' ? `● ${mmss}` : state === 'done' ? `${Math.round(wavDuration(wav!) / 100) / 10} s` : ''}
          </span>
        </div>
        {state === 'done' && url && <audio controls src={url} aria-label={t('Escuchar la grabación')} style={{ width: '100%' }} />}
        <label className="sl-check">
          <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> {t('Pasar a la siguiente diapositiva al terminar la narración')}
        </label>
        <p role="alert">{error}</p>
        <p className="sl-note">{t('La narración se guarda como un audio WAV en la diapositiva, con un icono abajo a la derecha, y suena sola al presentar. Para que se pase de diapositiva sola, la presentación se configura con «Usar intervalos». No se graban los trazos del lápiz ni el puntero láser, ni se graba la presentación entera de una vez.')}</p>
      </div>
    </Modal>
  );
}
