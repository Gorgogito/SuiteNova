import type { CommandDef } from '@suitenova/core-ui';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, type EditorState } from 'prosemirror-state';
import type { ChartGrid, ChartSpec } from '@suitenova/chart-core';
import { chartFormatCommands } from '../chart/commands';
import '../chart/messages';
import type { WriterUI } from './commands';

/** El gráfico elegido como objeto, con su posición. */
export function chartTarget(state: EditorState | null | undefined): { pos: number; node: PMNode } | null {
  const s = state?.selection;
  return s instanceof NodeSelection && s.node.type.name === 'chart' ? { pos: s.from, node: s.node } : null;
}

/** Cambia atributos del gráfico en `pos` y lo deja elegido. */
export function patchChart(ui: WriterUI, pos: number, patch: Record<string, unknown>): void {
  const v = ui.ctl.mainView;
  const node = v?.state.doc.nodeAt(pos);
  if (!v || !node || node.type.name !== 'chart') return;
  const tr = v.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }).setMeta('nw-no-track', true);
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  v.dispatch(tr);
  v.focus();
}

export function chartCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const ready = () => !!c.mainView && !c.readOnly;
  const spec = (): ChartSpec | null => (chartTarget(c.mainState)?.node.attrs.chart as ChartSpec | null) ?? null;
  const formats = chartFormatCommands({
    ids: { element: 'writer.chart.el', colors: 'writer.chart.colors', style: 'writer.chart.style' },
    get: spec,
    ready: () => !!c.mainView && !c.readOnly,
    pointCount: () => Math.max(0, ((chartTarget(c.mainState)?.node.attrs.grid as ChartGrid | null)?.length ?? 1) - 1),
    apply: (next) => {
      const t = chartTarget(c.mainState);
      if (t) patchChart(ui, t.pos, { chart: next });
    },
  });
  return [
    ...formats,
    { id: 'writer.insert.chart', label: 'Gráfico…', icon: 'chart', description: 'Inserta un gráfico (columnas, barras, líneas, circular, cascada y más) con sus datos en una tabla.', enabled: ready, run: () => ui.openDialog('chart', {}) },
    { id: 'writer.chart.edit', label: 'Editar datos y tipo del gráfico…', icon: 'chart', description: 'Cambia los datos, el tipo, el título, el tamaño y el ajuste del gráfico elegido.', enabled: () => ready() && !!chartTarget(c.mainState), run: () => { const t = chartTarget(c.mainState); if (t) ui.openDialog('chart', { pos: t.pos }); } },
  ];
}
