import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { wordArtStyle } from '@suitenova/wordart-core';
import { useState } from 'react';
import { WordArtForm, type WordArtValue } from '../wordart/WordArtUi';
import type { WriterUI } from './commands';
import { setWordArt } from './commands-wordart';
import { Modal, focusDocSoon } from './dialogs';

/** Cuadro «Formato de WordArt»: estilo del texto y transformación de la forma de texto elegida. */
export function WordArtDialog({ ui, pos, onClose }: { ui: WriterUI; pos: number; onClose: () => void }) {
  const node = ui.ctl.mainView?.state.doc.nodeAt(pos);
  const [value, setValue] = useState<WordArtValue>(() => (node?.attrs.wordart ? structuredClone(node.attrs.wordart as WordArtValue) : { fx: structuredClone(wordArtStyle('tx1').fx), warp: null }));
  if (!node || node.type.name !== 'shape') return null;
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
              setWordArt(ui, pos, value);
              onClose();
              focusDocSoon(ui);
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
