import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { packResult, unpackResult } from '@suitenova/ocr-core';
import type { PicEl } from '@suitenova/slides-core';
import { useState } from 'react';
import { ImageTextBody } from '../ocr/ImageTextBody';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';

/** The text read from the selected picture: where it is, read it again (language, turn, zone) and copy it. */
export function ImageTextDialog({ ui, onClose }: { ui: SlidesUI; onClose: () => void }) {
  const c = ui.ctl;
  const [, setRev] = useState(0);
  const p = c.selected.length === 1 && c.selected[0]!.kind === 'pic' ? (c.selected[0] as PicEl) : null;
  const asset = p ? c.deck.assets[p.src] : undefined;
  if (!p || !asset) return null;
  return (
    <Modal
      title={t('Texto de la imagen')}
      onClose={onClose}
      wide
      actions={
        <Button appearance="primary" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      }
    >
      <ImageTextBody
        src={c.urls.url(p.src)}
        result={asset.ocr ? unpackResult(asset.ocr) : null}
        lang={c.imageOcr.lang}
        onLang={(l) => (c.imageOcr.lang = l)}
        onReading={(r) => {
          c.setAssetOcr(p.src, packResult({ ...r, text: r.text.trim() }));
          setRev((n) => n + 1);
        }}
      />
    </Modal>
  );
}
