import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import { ImageTextBody } from '../ocr/ImageTextBody';
import type { WriterUI } from './commands';
import { selectedImage } from './commands-image';
import { Modal, focusDocSoon } from './dialogs';
import { readingOf } from './ocr-images';

/** The text read from the selected picture: where it is, read it again (language, turn, zone), copy it or put it in the document. */
export function ImageTextDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const sel = selectedImage(ui.ctl.mainState);
  const [, setRev] = useState(0);
  if (!sel) return null;
  const node = ui.ctl.mainState!.doc.nodeAt(sel.pos)!;
  const result = readingOf(node);
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
      <ImageTextBody
        src={node.attrs.src}
        result={result}
        lang={ui.ctl.imageOcr.lang}
        onLang={(l) => (ui.ctl.imageOcr.lang = l)}
        onReading={(r) => {
          ui.ctl.imageOcr.setReading(sel.pos, r);
          setRev((n) => n + 1);
        }}
        extra={
          <Button
            disabled={!result?.text}
            onClick={() => {
              const v = ui.ctl.mainView;
              if (!v || !result) return;
              // the text goes in a new paragraph after the one that has the picture
              const $p = v.state.doc.resolve(sel.pos);
              const at = $p.after($p.depth);
              const para = v.state.schema.nodes.paragraph!;
              v.dispatch(v.state.tr.insert(at, result.text.split('\n').map((l) => para.create(null, l ? v.state.schema.text(l) : undefined))));
              close();
            }}
          >
            {t('Insertar el texto después de la imagen')}
          </Button>
        }
      />
    </Modal>
  );
}
