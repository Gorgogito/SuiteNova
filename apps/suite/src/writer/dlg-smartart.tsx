import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { newParts, partsChange, partsIds, partsReflow, partsSetText, partsText, type SmartArtParts } from '@suitenova/smartart-core';
import { nodeTypes } from '@suitenova/writer-core';
import { NodeSelection } from 'prosemirror-state';
import { useState } from 'react';
import { SmartArtForm, newSmartArtValue, type SmartArtValue } from '../smartart/SmartArtUi';
import type { WriterUI } from './commands';
import { patchSmartArt } from './commands-smartart';
import { Modal, focusDocSoon } from './dialogs';

const WRAPS: [string, string][] = [['inline', 'En línea con el texto'], ['left', 'Cuadrado, a la izquierda'], ['right', 'Cuadrado, a la derecha'], ['topBottom', 'Arriba y abajo']];

/** Inserta un SmartArt nuevo en el cursor, o (con `pos`) edita el elegido: texto, diseño, colores, estilo, tamaño y ajuste. */
export function SmartArtDialog({ ui, pos, onClose }: { ui: WriterUI; pos?: number; onClose: () => void }) {
  const v = ui.ctl.mainView;
  const node = pos !== undefined ? v?.state.doc.nodeAt(pos) : null;
  const editing = pos !== undefined;
  const parts = (node?.attrs.parts ?? null) as SmartArtParts | null;
  const ids = parts ? partsIds(parts) : null;
  const [value, setValue] = useState<SmartArtValue>(() => (parts && ids ? { ...ids, text: partsText(parts), touched: true } : newSmartArtValue()));
  const [width, setWidth] = useState<number>(() => (node ? Number(node.attrs.width) : 480));
  const [height, setHeight] = useState<number>(() => (node ? Number(node.attrs.height) : 300));
  const [wrap, setWrap] = useState<string>(() => (node ? String(node.attrs.wrap) : 'inline'));
  if (editing && (!node || node.type.name !== 'smartart')) return null;
  const nodes = value.text.split('\n').filter((x) => x.trim()).length;
  const ok = nodes > 0 && width >= 40 && height >= 40;

  const apply = () => {
    if (!v || !ok) return;
    const size = { width: width * 0.75, height: height * 0.75 };
    if (!editing) {
      const made = newParts({ layout: value.layout, text: value.text, style: value.style, colors: value.colors, width: size.width, height: size.height });
      const sa = nodeTypes.smartart!.create({ width, height, wrap, parts: made, id: `smartart-${Date.now().toString(36)}` });
      const from = v.state.selection.from;
      const tr = v.state.tr.replaceSelectionWith(sa, false);
      tr.setSelection(NodeSelection.create(tr.doc, from)).setMeta('nw-no-track', true);
      v.dispatch(tr);
    } else if (parts && ids) {
      let p: SmartArtParts | null = parts;
      let changed = false;
      if (value.text !== partsText(parts)) (p = partsSetText(p, value.text, size)), (changed = true);
      const what = { layout: value.layout !== ids.layout ? value.layout : undefined, style: value.style !== ids.style ? value.style : undefined, colors: value.colors !== ids.colors ? value.colors : undefined };
      if (p && (what.layout || what.style || what.colors)) (p = partsChange(p, what, size)), (changed = true);
      if (p && !changed && (width !== Number(node!.attrs.width) || height !== Number(node!.attrs.height))) p = partsReflow(p, size);
      if (p && changed && (width !== Number(node!.attrs.width) || height !== Number(node!.attrs.height))) p = partsReflow(p, size);
      patchSmartArt(ui, pos!, { parts: p ?? parts, width, height, wrap, ...(wrap !== node!.attrs.wrap && (wrap === 'inline' || wrap === 'left' || wrap === 'right' || wrap === 'topBottom') ? { x: 0, y: 0 } : {}) });
    }
    onClose();
    focusDocSoon(ui);
  };

  return (
    <Modal
      title={editing ? t('Editar SmartArt') : t('Insertar SmartArt')}
      onClose={onClose}
      width={820}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={apply}>
            {editing ? t('Aceptar') : t('Insertar')}
          </Button>
        </>
      }
    >
      <SmartArtForm value={value} onChange={setValue} aspect={height / width} />
      <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="sa-field" style={{ width: 110 }}>
          <span>{t('Ancho (px)')}</span>
          <input type="number" min={40} max={1200} aria-label={t('Ancho del SmartArt')} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        <label className="sa-field" style={{ width: 110 }}>
          <span>{t('Alto (px)')}</span>
          <input type="number" min={40} max={1200} aria-label={t('Alto del SmartArt')} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
        </label>
        <label className="sa-field">
          <span>{t('Ajuste del texto')}</span>
          <select aria-label={t('Ajuste del SmartArt')} value={wrap} onChange={(e) => setWrap(e.target.value)}>
            {WRAPS.map(([id, label]) => (
              <option key={id} value={id}>
                {t(label)}
              </option>
            ))}
            {(wrap === 'front' || wrap === 'behind') && <option value={wrap}>{wrap === 'front' ? t('Delante del texto') : t('Detrás del texto')}</option>}
          </select>
        </label>
      </div>
      <p className="sa-note">{t('Cada SmartArt guarda su lista y su diseño: se puede editar el texto, cambiar de diseño, de colores y de estilo, y se guarda en el .docx como un SmartArt de Word.')}</p>
    </Modal>
  );
}
