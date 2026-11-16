import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { wordArtStyle } from '@suitenova/wordart-core';
import { useState } from 'react';
import { WordArtForm, type WordArtValue } from '../wordart/WordArtUi';
import type { CalcUI } from './commands';
import { Modal } from './modal';

/** Cuadro «Formato de WordArt»: estilo del texto y transformación de la forma elegida. */
export function WordArtFormatDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const shape = d.sheet.shapes.find((s) => s.id === d.x.selectedShape);
  const [value, setValue] = useState<WordArtValue>(() => (shape?.wordart ? structuredClone(shape.wordart) : { fx: structuredClone(wordArtStyle('tx1').fx), warp: null }));
  if (!shape) return null;
  return (
    <Modal
      title={t('Formato de WordArt')}
      onClose={onClose}
      width={560}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              d.x.setWordArt(value);
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <WordArtForm value={value} onChange={setValue} />
    </Modal>
  );
}
