import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { sampleGrid, specFromGrid, type ChartGrid, type ChartSpec } from '@suitenova/chart-core';
import { nodeTypes } from '@suitenova/writer-core';
import { NodeSelection } from 'prosemirror-state';
import { useMemo, useState } from 'react';
import { ChartEditor, useBuilt } from '../chart/ChartEditor';
import { draftOf, type ChartDraft } from '../chart/draft';
import type { WriterUI } from './commands';
import { patchChart } from './commands-chart';
import { Modal, focusDocSoon } from './dialogs';

const WRAPS: [string, string][] = [['inline', 'En línea con el texto'], ['left', 'Cuadrado, a la izquierda'], ['right', 'Cuadrado, a la derecha'], ['topBottom', 'Arriba y abajo']];

/** Inserta un gráfico nuevo en el cursor, o (con `pos`) edita el elegido: datos, tipo, título, tamaño y ajuste. */
export function ChartDialog({ ui, pos, onClose }: { ui: WriterUI; pos?: number; onClose: () => void }) {
  const v = ui.ctl.mainView;
  const node = pos !== undefined ? v?.state.doc.nodeAt(pos) : null;
  const editing = pos !== undefined;
  const sample = useMemo((): { chart: ChartSpec; grid: ChartGrid } => {
    const grid = sampleGrid();
    return { chart: specFromGrid('column', grid, { title: 'Título del gráfico', legend: true }), grid };
  }, []);
  const base = (node?.attrs.chart as ChartSpec | null) ?? sample.chart;
  const [draft, setDraft] = useState<ChartDraft>(() => draftOf(base, (node?.attrs.grid as ChartGrid | null) ?? sample.grid));
  const [width, setWidth] = useState<number>(() => (node ? Number(node.attrs.width) : 480));
  const [height, setHeight] = useState<number>(() => (node ? Number(node.attrs.height) : 288));
  const [wrap, setWrap] = useState<string>(() => (node ? String(node.attrs.wrap) : 'inline'));
  const built = useBuilt(draft, editing ? base : undefined);
  if (editing && (!node || node.type.name !== 'chart')) return null;
  const ok = typeof built !== 'string' && width >= 80 && height >= 60;

  const apply = () => {
    if (!v || typeof built === 'string' || !ok) return;
    if (!editing) {
      const n = nodeTypes.chart!.create({ width, height, wrap, chart: built.spec, grid: built.grid, id: `chart-${Date.now().toString(36)}` });
      const from = v.state.selection.from;
      const tr = v.state.tr.replaceSelectionWith(n, false);
      tr.setSelection(NodeSelection.create(tr.doc, from)).setMeta('nw-no-track', true);
      v.dispatch(tr);
    } else {
      patchChart(ui, pos!, { chart: built.spec, grid: built.grid, width, height, wrap, ...(wrap !== node!.attrs.wrap && (wrap === 'inline' || wrap === 'left' || wrap === 'right' || wrap === 'topBottom') ? { x: 0, y: 0 } : {}) });
    }
    onClose();
    focusDocSoon(ui);
  };

  return (
    <Modal
      title={editing ? t('Editar el gráfico') : t('Insertar gráfico')}
      onClose={onClose}
      width={900}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={apply}>
            {editing ? t('Aceptar') : t('Insertar')}
          </Button>
        </>
      }
    >
      <ChartEditor draft={draft} onChange={setDraft} base={editing ? base : undefined} />
      <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="nc-field" style={{ width: 110, flex: 'none' }}>
          <span>{t('Ancho (px)')}</span>
          <input type="number" min={80} max={1200} aria-label={t('Ancho del gráfico')} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
        </label>
        <label className="nc-field" style={{ width: 110, flex: 'none' }}>
          <span>{t('Alto (px)')}</span>
          <input type="number" min={60} max={1200} aria-label={t('Alto del gráfico')} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
        </label>
        <label className="nc-field">
          <span>{t('Ajuste del texto')}</span>
          <select aria-label={t('Ajuste del gráfico')} value={wrap} onChange={(e) => setWrap(e.target.value)}>
            {WRAPS.map(([id, label]) => (
              <option key={id} value={id}>
                {t(label)}
              </option>
            ))}
            {(wrap === 'front' || wrap === 'behind') && <option value={wrap}>{wrap === 'front' ? t('Delante del texto') : t('Detrás del texto')}</option>}
          </select>
        </label>
      </div>
    </Modal>
  );
}
