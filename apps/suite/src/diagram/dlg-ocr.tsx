import { Button, DialogActions, DialogContent, DialogTitle } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { packResult, unpackResult } from '@suitenova/ocr-core';
import { useState } from 'react';
import { ImageTextBody } from '../ocr/ImageTextBody';
import type { DiagramCtl } from './ctl';

/** The text read from the selected picture: where it is, read it again (language, turn, zone) and copy it. */
export function ImageTextForm({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  const [, setRev] = useState(0);
  const s = ctl.selectedShapes();
  const shape = s.length === 1 && s[0]!.image ? s[0]! : null;
  if (!shape?.image) return null;
  return (
    <>
      <DialogTitle>{t('Texto de la imagen')}</DialogTitle>
      <DialogContent>
        <ImageTextBody
          src={shape.image.src}
          result={shape.image.ocr ? unpackResult(shape.image.ocr) : null}
          lang={ctl.imageOcr.lang}
          onLang={(l) => (ctl.imageOcr.lang = l)}
          onReading={(r) => {
            ctl.setShapeOcr(shape.id, packResult({ ...r, text: r.text.trim() }));
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
