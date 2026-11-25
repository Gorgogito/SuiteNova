import type { CommandDef, RibbonItem } from '@suitenova/core-ui';
import type { ChartSpec } from '@suitenova/chart-core';
import { CHART_ELEMENTS, ELEMENT_GROUPS } from './elements';
import { CHART_STYLES, COLOR_PALETTES, applyPalette, applyStyle, paletteOf } from './styles';
import './messages';

/*
 * Los comandos y los menús de la cinta de «Agregar elemento de gráfico», «Cambiar colores» y «Estilos rápidos»: los mismos para Calc,
 * Slides y Writer. Cada producto dice cómo se obtiene el gráfico elegido y cómo se guarda el cambio.
 */

export interface ChartCommandIds {
  /** Prefijo de los elementos («calc.el» → `calc.el.title`). */
  element: string;
  colors: string;
  style: string;
}

export interface ChartCommandHost {
  ids: ChartCommandIds;
  icon?: string;
  /** El gráfico elegido, o null. */
  get: () => ChartSpec | null;
  /** Cuántos puntos (categorías) tiene: los circulares colorean uno por punto. */
  pointCount: () => number;
  /** Guarda el gráfico cambiado (`label` es el nombre del paso para deshacer). */
  apply: (next: ChartSpec, label: string) => void;
  /** Los seis énfasis del tema del documento: «Cambiar colores» se hace con ellos (los de Office si no se dan). */
  accents?: () => string[] | undefined;
  /** Además de haber un gráfico elegido, el producto debe poder editar (no estar en solo lectura). */
  ready?: () => boolean;
}

export const chartCommandIds = (prefix: string): ChartCommandIds => ({ element: `${prefix}.el`, colors: `${prefix}.colors`, style: `${prefix}.style` });

export function chartFormatCommands(h: ChartCommandHost): CommandDef[] {
  const ok = () => !!h.get() && (h.ready ? h.ready() : true);
  const icon = h.icon ?? 'chart';
  const out: CommandDef[] = [];
  for (const el of CHART_ELEMENTS) {
    out.push({
      id: `${h.ids.element}.${el.id}`,
      label: el.label,
      icon,
      enabled: () => ok() && el.enabled(h.get()!),
      checked: () => !!h.get() && el.checked(h.get()!),
      run: () => {
        const c = h.get();
        if (c) h.apply({ ...c, ...el.apply(c) }, el.group);
      },
    });
  }
  for (const p of COLOR_PALETTES) {
    out.push({
      id: `${h.ids.colors}.${p.id}`,
      label: p.label,
      icon: 'palette',
      enabled: ok,
      checked: () => !!h.get() && paletteOf(h.get()!, h.pointCount(), h.accents?.()) === p.id,
      run: () => {
        const c = h.get();
        if (c) h.apply(applyPalette(c, p.id, h.pointCount(), h.accents?.()), 'Cambiar colores');
      },
    });
  }
  for (const st of CHART_STYLES) {
    out.push({
      id: `${h.ids.style}.${st.id}`,
      label: st.label,
      icon,
      description: st.description,
      enabled: ok,
      run: () => {
        const c = h.get();
        if (c) h.apply(applyStyle(c, st.id), 'Estilo de gráfico');
      },
    });
  }
  return out;
}

/** Los tres menús de la cinta: «Agregar elemento de gráfico», «Cambiar colores» y «Estilos rápidos». */
export function chartFormatRibbon(ids: ChartCommandIds, o: { icon?: string; keytips?: [string, string, string] } = {}): { element: RibbonItem; colors: RibbonItem; styles: RibbonItem } {
  const icon = o.icon ?? 'chart';
  const [kEl, kCol, kSt] = o.keytips ?? ['AE', 'CC', 'ER'];
  return {
    element: {
      kind: 'dropdown',
      id: 'addElement',
      label: 'Agregar elemento de gráfico',
      icon,
      size: 'large',
      keytip: kEl,
      entries: ELEMENT_GROUPS.flatMap((g, i) => [
        ...(i ? [{ kind: 'separator' as const }] : []),
        { kind: 'header' as const, label: g },
        ...CHART_ELEMENTS.filter((e) => e.group === g).map((e) => ({ kind: 'command' as const, command: `${ids.element}.${e.id}` })),
      ]),
    },
    colors: { kind: 'dropdown', id: 'chartColors', label: 'Cambiar colores', icon: 'palette', size: 'large', keytip: kCol, entries: COLOR_PALETTES.map((p) => ({ kind: 'command' as const, command: `${ids.colors}.${p.id}` })) },
    styles: { kind: 'dropdown', id: 'chartQuick', label: 'Estilos rápidos', icon, size: 'large', keytip: kSt, entries: CHART_STYLES.map((s) => ({ kind: 'command' as const, command: `${ids.style}.${s.id}` })) },
  };
}
