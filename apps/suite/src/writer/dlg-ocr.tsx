import { Button, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { hasPositions, type Box } from '@suitenova/ocr-core';
import { useState } from 'react';
import { OcrPreview } from '../ocr/OcrPreview';
import { readImage } from '../ocr/read';
import type { WriterUI } from './commands';
import { selectedImage } from './commands-image';
import { Modal, field, focusDocSoon } from './dialogs';
import { readingOf } from './ocr-images';

/** The text read from the selected picture: where it is, read it again (language, turn, zone), copy it or put it in the document. */
export function ImageTextDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const sel = selectedImage(ui.ctl.mainState);
  const [find, setFind] = useState('');
  const [zone, setZone] = useState<Box | null>(null);
  const [turns, setTurns] = useState<'auto' | '0' | '1' | '2' | '3'>('auto');
  const [lang, setLang] = useState(ui.ctl.imageOcr.lang);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [rev, setRev] = useState(0);
  if (!sel) return null;
  void rev;
  const node = ui.ctl.mainState!.doc.nodeAt(sel.pos)!;
  const result = readingOf(node);
  const src: string = node.attrs.src;
  const text = result?.text ?? '';
  const reread = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await readImage(src, lang, { zone: zone ?? undefined, turns: turns === 'auto' ? 'auto' : (Number(turns) as 0 | 1 | 2 | 3) });
      ui.ctl.imageOcr.setReading(sel.pos, r);
      ui.ctl.imageOcr.lang = lang;
      setRev((n) => n + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Texto de la imagen')}
      onClose={close}
      width={640}
      actions={
        <Button appearance="primary" onClick={close}>
          {t('Cerrar')}
        </Button>
      }
    >
      {result && hasPositions(result) && (
        <div style={field}>
          <OcrPreview src={src} result={result} query={find} zone={zone ?? result.zone ?? null} onZone={setZone} />
          <Input aria-label={t('Buscar en el texto de la imagen')} placeholder={t('Buscar en el texto de la imagen')} value={find} onChange={(_e, d) => setFind(d.value)} />
        </div>
      )}
      <div style={field}>
        <span>{t('Texto leído en la imagen (OCR)')}</span>
        <textarea readOnly rows={6} aria-label={t('Texto leído en la imagen')} style={{ width: '100%' }} value={result ? text || t('(no se encontró texto)') : t('(todavía no se ha leído)')} />
        {result && result.rotation !== 0 && <span>{t('La imagen estaba girada {n}° y se leyó girándola.', { n: result.rotation })}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <label>
          {t('Idioma')}{' '}
          <select aria-label={t('Idioma de la lectura')} value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="spa+eng">{t('Español e inglés')}</option>
            <option value="spa">{t('Español')}</option>
            <option value="eng">{t('Inglés')}</option>
          </select>
        </label>
        <label>
          {t('Giro al leer')}{' '}
          <select aria-label={t('Giro al leer')} value={turns} onChange={(e) => setTurns(e.target.value as typeof turns)}>
            <option value="auto">{t('Automático')}</option>
            <option value="0">{t('Sin girar')}</option>
            <option value="1">{t('90° a la derecha')}</option>
            <option value="2">{t('180°')}</option>
            <option value="3">{t('90° a la izquierda')}</option>
          </select>
        </label>
        <Button disabled={busy} onClick={() => void reread()}>
          {zone ? t('Leer solo la zona') : t('Leer con estos ajustes')}
        </Button>
        <Button disabled={!zone} onClick={() => setZone(null)}>
          {t('Quitar la zona')}
        </Button>
        {busy && <span aria-live="polite">{t('Leyendo…')}</span>}
        {err && <span role="alert">{err}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button disabled={!text} onClick={() => void navigator.clipboard?.writeText(text)}>
          {t('Copiar el texto')}
        </Button>
        <Button
          disabled={!text}
          onClick={() => {
            const v = ui.ctl.mainView;
            if (!v) return;
            // the text goes in a new paragraph after the one that has the picture
            const $p = v.state.doc.resolve(sel.pos);
            const at = $p.after($p.depth);
            const para = v.state.schema.nodes.paragraph!;
            v.dispatch(v.state.tr.insert(at, text.split('\n').map((l) => para.create(null, l ? v.state.schema.text(l) : undefined))));
            close();
          }}
        >
          {t('Insertar el texto después de la imagen')}
        </Button>
      </div>
    </Modal>
  );
}
