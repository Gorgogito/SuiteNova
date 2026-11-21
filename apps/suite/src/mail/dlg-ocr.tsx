import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { setImageReading } from '@suitenova/mail-core';
import { packResult, unpackResult, type OcrResult } from '@suitenova/ocr-core';
import { useEffect, useState } from 'react';
import { ImageTextBody } from '../ocr/ImageTextBody';
import { readImage } from '../ocr/read';
import type { MailCtl } from './ctl';
import { dataUriOf } from './ocr-images';

/** The text read from the pictures of the open message: pick one, see where the text is, read it again (language, turn, zone) and copy it. */
export function MessageImagesForm({ ctl, onClose }: { ctl: MailCtl; onClose: () => void }) {
  const rec = ctl.selected;
  const images = rec ? ctl.imageOcr.imagesOf(rec) : [];
  const [i, setI] = useState(0);
  const [, setRev] = useState(0);
  const img = images[Math.min(i, images.length - 1)];
  if (!rec || !img) return null;
  return (
    <>
      <DialogTitle>{t('Texto de las imágenes del mensaje')}</DialogTitle>
      <DialogContent>
        {images.length > 1 && (
          <label style={{ display: 'block', marginBottom: 8 }}>
            {t('Imagen')}{' '}
            <select aria-label={t('Imagen del mensaje')} value={i} onChange={(e) => setI(Number(e.target.value))}>
              {images.map((x, k) => (
                <option key={x.key} value={k}>
                  {x.filename || `${t('Imagen')} ${k + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <ImageTextBody
          key={img.key}
          src={dataUriOf(img)}
          result={rec.ocr?.[img.key] ? unpackResult(rec.ocr[img.key]) : null}
          lang={ctl.imageOcr.lang}
          onLang={(l) => (ctl.imageOcr.lang = l)}
          onReading={(r) => {
            setImageReading(rec, img.key, packResult({ ...r, text: r.text.trim() }));
            ctl.touch(true);
            setRev((n) => n + 1);
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button appearance="primary" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      </DialogActions>
    </>
  );
}

/** The text of a picture being written: it is read when the dialog opens (the person can read it again with other settings). */
export function PictureTextForm({ src, reading, lang, onReading, onLang, onClose }: { src: string; reading: unknown; lang: string; onReading: (r: OcrResult) => void; onLang: (l: string) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (reading) return;
    let alive = true;
    setBusy(true);
    readImage(src, lang)
      .then((r) => alive && onReading(r))
      .catch(() => undefined)
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <DialogTitle>{t('Texto de la imagen')}</DialogTitle>
      <DialogContent>
        {busy && <p aria-live="polite">{t('Leyendo…')}</p>}
        <ImageTextBody src={src} result={reading ? unpackResult(reading) : null} lang={lang} onLang={onLang} onReading={onReading} />
      </DialogContent>
      <DialogActions>
        <Button appearance="primary" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      </DialogActions>
    </>
  );
}
