import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import JSZip from 'jszip';
import { useState } from 'react';
import { saveBytes } from '../fileio';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { canvasBlob, slideToCanvas } from './export/raster';

type P = { ui: SlidesUI; onClose: () => void; arg?: unknown };

const baseName = (ui: SlidesUI) => (ui.ctl.fileName ?? ui.ctl.deck.props.title ?? 'Presentación').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'Presentación';

/** Export as pictures (one file, or a zip with one per slide) or as a video. */
export function ExportMediaDialog({ ui, onClose, arg }: P) {
  const c = ui.ctl;
  const video = arg === 'video';
  const deck = c.realDeck;
  const [width, setWidth] = useState(video ? 1280 : 1920);
  const [fmt, setFmt] = useState<'png' | 'jpeg'>('png');
  const [scope, setScope] = useState<'current' | 'all'>('all');
  const [secs, setSecs] = useState(5);
  const [useTimes, setUseTimes] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const slides = () => deck.slides.map((s, i) => ({ s, i })).filter(({ s }) => !s.hidden);
  const run = async () => {
    setError('');
    try {
      c.endEdit();
      if (!video) {
        const list = scope === 'current' ? [{ s: deck.slides[Math.min(c.index, deck.slides.length - 1)]!, i: c.index }] : deck.slides.map((s, i) => ({ s, i }));
        const type = fmt === 'png' ? 'image/png' : 'image/jpeg';
        const files: [string, Uint8Array][] = [];
        for (const { s, i } of list) {
          setBusy(t('Dibujando la diapositiva {n} de {m}…', { n: files.length + 1, m: list.length }));
          const cv = await slideToCanvas(deck, s, c.urls, i, width);
          files.push([`diapositiva-${String(i + 1).padStart(2, '0')}.${fmt === 'png' ? 'png' : 'jpg'}`, await canvasBlob(cv, type)]);
        }
        if (files.length === 1) await saveBytes(files[0]![0].replace('diapositiva', baseName(ui)), files[0]![1], [{ name: fmt === 'png' ? 'Imagen PNG' : 'Imagen JPEG', extensions: [fmt === 'png' ? 'png' : 'jpg'] }]);
        else {
          const zip = new JSZip();
          for (const [n, d] of files) zip.file(n, d);
          await saveBytes(`${baseName(ui)}.zip`, await zip.generateAsync({ type: 'uint8array' }), [{ name: 'Imágenes en un archivo ZIP', extensions: ['zip'] }]);
        }
      } else {
        const list = slides();
        const frames: { cv: HTMLCanvasElement; ms: number }[] = [];
        for (const { s, i } of list) {
          setBusy(t('Dibujando la diapositiva {n} de {m}…', { n: frames.length + 1, m: list.length }));
          const cv = await slideToCanvas(deck, s, c.urls, i, width);
          const ms = useTimes ? (s.rehearsed ?? s.transition?.advTm ?? secs * 1000) : secs * 1000;
          frames.push({ cv, ms });
        }
        if (!frames.length) throw new Error(t('No hay diapositivas visibles.'));
        const out = document.createElement('canvas');
        out.width = frames[0]!.cv.width;
        out.height = frames[0]!.cv.height;
        const g = out.getContext('2d')!;
        const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
        if (!mime) throw new Error(t('Este equipo no puede grabar vídeo.'));
        const rec = new MediaRecorder(out.captureStream(30), { mimeType: mime, videoBitsPerSecond: 4_000_000 });
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        const done = new Promise<void>((ok) => (rec.onstop = () => ok()));
        rec.start(250);
        let n = 0;
        for (const f of frames) {
          setBusy(t('Grabando la diapositiva {n} de {m}…', { n: ++n, m: frames.length }));
          const end = performance.now() + f.ms;
          while (performance.now() < end) {
            g.drawImage(f.cv, 0, 0, out.width, out.height);
            await new Promise((r) => setTimeout(r, 80));
          }
        }
        rec.stop();
        await done;
        const data = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
        await saveBytes(`${baseName(ui)}.webm`, data, [{ name: 'Vídeo WebM', extensions: ['webm'] }]);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  };
  return (
    <Modal
      title={video ? t('Exportar como vídeo') : t('Exportar como imágenes')}
      onClose={busy ? () => undefined : onClose}
      actions={
        <>
          <Button disabled={!!busy} onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!!busy} onClick={() => void run()}>{t('Exportar')}</Button>
        </>
      }
    >
      <div className="sl-form" data-testid="export-media">
        <label className="sl-field">
          <span>{t('Ancho (px)')}</span>
          <select aria-label={t('Ancho de la imagen')} value={width} onChange={(e) => setWidth(Number(e.target.value))}>
            {(video ? [854, 1280, 1920] : [1280, 1920, 3840]).map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        {!video && (
          <>
            <label className="sl-field">
              <span>{t('Formato')}</span>
              <select aria-label={t('Formato de la imagen')} value={fmt} onChange={(e) => setFmt(e.target.value as 'png' | 'jpeg')}>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
              </select>
            </label>
            <label className="sl-field">
              <span>{t('Diapositivas')}</span>
              <select aria-label={t('Diapositivas que se exportan')} value={scope} onChange={(e) => setScope(e.target.value as 'current' | 'all')}>
                <option value="all">{t('Todas (en un archivo ZIP)')}</option>
                <option value="current">{t('Solo la actual')}</option>
              </select>
            </label>
          </>
        )}
        {video && (
          <>
            <label className="sl-field">
              <span>{t('Segundos por diapositiva')}</span>
              <input type="number" min={0.5} step={0.5} aria-label={t('Segundos por diapositiva')} value={secs} onChange={(e) => setSecs(Number(e.target.value))} />
            </label>
            <label className="sl-check"><input type="checkbox" checked={useTimes} onChange={(e) => setUseTimes(e.target.checked)} /> {t('Usar los tiempos de la presentación cuando existan')}</label>
            <p className="sl-note">{t('El vídeo es una imagen fija por diapositiva (formato WebM, sin sonido): no incluye animaciones, transiciones ni narración. Las diapositivas ocultas se omiten.')}</p>
          </>
        )}
        {busy && <p role="status" aria-live="polite">{busy}</p>}
        {error && <p role="alert" className="sl-eqerr">{error}</p>}
      </div>
    </Modal>
  );
}
