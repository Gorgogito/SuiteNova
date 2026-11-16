import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { partsIds, partsText } from '@suitenova/smartart-core';
import { useState } from 'react';
import { SmartArtForm, newSmartArtValue, type SmartArtValue } from '../smartart/SmartArtUi';
import type { CalcUI } from './commands';
import { Modal } from './modal';

/** Inserta un SmartArt nuevo, o (con uno elegido) edita su texto, diseño, colores, estilo y tamaño. */
export function SmartArtDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const target = d.x.selectedSmartArt;
  const ids = target?.smartart ? partsIds(target.smartart) : null;
  const [value, setValue] = useState<SmartArtValue>(() => (target?.smartart && ids ? { ...ids, text: partsText(target.smartart), touched: true } : newSmartArtValue()));
  const [width, setWidth] = useState<number>(() => target?.width ?? 480);
  const [height, setHeight] = useState<number>(() => target?.height ?? 300);
  const nodes = value.text.split('\n').filter((x) => x.trim()).length;
  const ok = nodes > 0 && width >= 40 && height >= 40;

  const apply = () => {
    if (!ok) return;
    if (!target || !ids || !target.smartart) d.x.insertSmartArt({ layout: value.layout, text: value.text, style: value.style, colors: value.colors }, width, height);
    else {
      d.x.editSmartArt(target.id, {
        text: value.text !== partsText(target.smartart) ? value.text : undefined,
        layout: value.layout !== ids.layout ? value.layout : undefined,
        style: value.style !== ids.style ? value.style : undefined,
        colors: value.colors !== ids.colors ? value.colors : undefined,
        width,
        height,
      });
    }
    onClose();
  };

  return (
    <Modal
      title={target ? t('Editar SmartArt') : t('Insertar SmartArt')}
      onClose={onClose}
      width={820}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={apply}>
            {target ? t('Aceptar') : t('Insertar')}
          </Button>
        </>
      }
    >
      <SmartArtForm value={value} onChange={setValue} aspect={height / width} />
      <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'flex-end' }}>
        <label className="sa-field" style={{ width: 110 }}>
          <span>{t('Ancho (px)')}</span>
          <input type="number" min={40} max={2000} aria-label={t('Ancho del SmartArt')} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        <label className="sa-field" style={{ width: 110 }}>
          <span>{t('Alto (px)')}</span>
          <input type="number" min={40} max={2000} aria-label={t('Alto del SmartArt')} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
        </label>
      </div>
      <p className="sa-note">{t('Cada SmartArt guarda su lista y su diseño: se puede editar el texto, cambiar de diseño, de colores y de estilo, y se guarda en el .xlsx como un SmartArt de Excel.')}</p>
    </Modal>
  );
}
