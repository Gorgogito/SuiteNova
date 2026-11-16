import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { changeSmartArt, diagramArea, isLiveSmartArt, newSmartArtGroup, setSmartArtText, smartArtIds, smartArtText, updateSlide, type GroupEl, type SlideElement } from '@suitenova/slides-core';
import { useState } from 'react';
import { SmartArtForm, newSmartArtValue, type SmartArtValue } from '../smartart/SmartArtUi';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';

type Props = { ui: SlidesUI; onClose: () => void; arg?: unknown };

/** Insertar un SmartArt nuevo o editar el elegido (`arg = { edit: true }`): diseño, texto, estilo y colores con vista previa. */
export function SmartArtDialog({ ui, onClose, arg }: Props) {
  const c = ui.ctl;
  const editing = (arg as { edit?: boolean } | undefined)?.edit === true;
  const target = editing && c.selected.length === 1 && isLiveSmartArt(c.selected[0]!) ? (c.selected[0] as GroupEl) : null;
  const ids = target ? smartArtIds(target) : null;
  const [value, setValue] = useState<SmartArtValue>(() => (target && ids ? { layout: ids.layout, style: ids.style, colors: ids.colors, text: smartArtText(target), touched: true } : newSmartArtValue()));
  const area = diagramArea(c.deck.size);
  const frame = target?.xfrm ?? { x: area.x, y: area.y, w: area.w, h: area.h };
  const apply = () => {
    if (target) {
      let g: GroupEl | null = value.text !== smartArtText(target) ? setSmartArtText(target, value.text) : target;
      g = g && changeSmartArt(g, { layout: value.layout !== ids?.layout ? value.layout : undefined, style: value.style !== ids?.style ? value.style : undefined, colors: value.colors !== ids?.colors ? value.colors : undefined });
      if (!g) {
        onClose();
        return;
      }
      const next = g;
      c.apply('Editar SmartArt', (d) => updateSlide(d, c.slide.id, (s) => ({ ...s, shapes: s.shapes.map((e): SlideElement => (e.id === target.id ? next : e)) })), { selection: [target.id] });
    } else c.addElement(newSmartArtGroup({ layout: value.layout, text: value.text, style: value.style, colors: value.colors }, frame), { select: true });
    onClose();
  };
  const nodes = value.text.split('\n').filter((x) => x.trim()).length;
  return (
    <Modal
      title={editing ? t('Editar SmartArt') : t('Insertar SmartArt')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!nodes || (editing && !target)} onClick={apply}>
            {editing ? t('Aceptar') : t('Insertar')}
          </Button>
        </>
      }
    >
      <SmartArtForm value={value} onChange={setValue} aspect={frame.h / frame.w} />
      <p className="sl-note">{t('Cada SmartArt guarda su lista y su diseño: se puede editar el texto, cambiar de diseño, de colores y de estilo, y vuelve a distribuirse solo.')}</p>
    </Modal>
  );
}
