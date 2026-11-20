import { t } from '@suitenova/core-ui';
import { hasPositions, type Box, type OcrResult } from '@suitenova/ocr-core';
import { useState, type ReactNode } from 'react';
import './messages';
import { OcrPreview } from './OcrPreview';
import { readImage } from './read';

/**
 * What every product shows of the text read from one picture: the picture with where each word is (and where a search falls), the text, and the
 * options to read it again (language, turn, a zone), copy it, and whatever else the product offers (`extra`). The product keeps the reading
 * (`onReading`); `src` is an address the reader can load.
 */
export function ImageTextBody({ src, result, lang: lang0, onReading, onLang, extra }: { src: string; result: OcrResult | null; lang: string; onReading: (r: OcrResult) => void; onLang?: (l: string) => void; extra?: ReactNode }) {
  const [find, setFind] = useState('');
  const [zone, setZone] = useState<Box | null>(null);
  const [turns, setTurns] = useState<'auto' | '0' | '1' | '2' | '3'>('auto');
  const [lang, setLang] = useState(lang0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const text = result?.text ?? '';
  const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 };
  const reread = async () => {
    setBusy(true);
    setErr('');
    try {
      onReading(await readImage(src, lang, { zone: zone ?? undefined, turns: turns === 'auto' ? 'auto' : (Number(turns) as 0 | 1 | 2 | 3) }));
      onLang?.(lang);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {result && hasPositions(result) && (
        <div style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
          <OcrPreview src={src} result={result} query={find} zone={zone ?? result.zone ?? null} onZone={setZone} />
          <input aria-label={t('Buscar en el texto de la imagen')} placeholder={t('Buscar en el texto de la imagen')} value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
      )}
      <div style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
        <span>{t('Texto leído en la imagen (OCR)')}</span>
        <textarea readOnly rows={6} aria-label={t('Texto leído en la imagen')} style={{ width: '100%' }} value={result ? text || t('(no se encontró texto)') : t('(todavía no se ha leído)')} />
        {result && result.rotation !== 0 && <span>{t('La imagen estaba girada {n}° y se leyó girándola.', { n: result.rotation })}</span>}
      </div>
      <div style={row}>
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
        <button type="button" disabled={busy} onClick={() => void reread()}>
          {zone ? t('Leer solo la zona') : t('Leer con estos ajustes')}
        </button>
        <button type="button" disabled={!zone} onClick={() => setZone(null)}>
          {t('Quitar la zona')}
        </button>
        {busy && <span aria-live="polite">{t('Leyendo…')}</span>}
        {err && <span role="alert">{err}</span>}
      </div>
      <div style={row}>
        <button type="button" disabled={!text} onClick={() => void navigator.clipboard?.writeText(text)}>
          {t('Copiar el texto')}
        </button>
        {extra}
      </div>
    </div>
  );
}
