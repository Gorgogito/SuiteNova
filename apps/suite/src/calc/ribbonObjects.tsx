import type { RibbonGroup, RibbonItem, RibbonTab } from '@suitenova/core-ui';
import { CHART_PRESETS } from './chartPresets';
import type { CalcUI } from './commands';
import { TableNameField } from './dlg-table';

type Entry = Extract<RibbonItem, { kind: 'dropdown' }>['entries'][number];

const cmd = (command: string): Entry => ({ kind: 'command', command });
const header = (label: string): Entry => ({ kind: 'header', label });

/** The gallery of chart kinds, in groups. */
export function chartEntries(prefix: 'calc.chart.' | 'calc.chartType.'): Entry[] {
  const groups: [string, string][] = [
    ['column', 'Columna'],
    ['bar', 'Barra'],
    ['line', 'Línea'],
    ['area', 'Área'],
    ['pie', 'Circular y anillos'],
    ['scatter', 'Dispersión'],
    ['radar', 'Radar'],
    ['stock', 'Cotizaciones'],
    ['surface', 'Superficie'],
    ['combo', 'Combinado'],
  ];
  const out: Entry[] = [];
  for (const [g, label] of groups) {
    out.push(header(label));
    for (const p of CHART_PRESETS.filter((x) => x.group === g)) out.push(cmd(`${prefix}${p.id}`));
  }
  return out;
}

/** Groups added to the Insert tab. */
export function insertGroups(): RibbonGroup[] {
  return [
    {
      id: 'tables',
      label: 'Tablas',
      icon: 'tableGrid',
      items: [
        { kind: 'button', command: 'calc.pivot.create', size: 'large', keytip: 'TD' },
        { kind: 'button', command: 'calc.table.create', size: 'large', keytip: 'TB' },
      ],
    },
    { id: 'illustrations', label: 'Ilustraciones', icon: 'picture', items: [{ kind: 'button', command: 'calc.picture', size: 'large', keytip: 'IM' }] },
    {
      id: 'sparklines',
      label: 'Minigráficos',
      icon: 'sparkline',
      items: [
        { kind: 'button', command: 'calc.spark.line', size: 'small', keytip: 'ML' },
        { kind: 'button', command: 'calc.spark.column', size: 'small', keytip: 'MC' },
        { kind: 'button', command: 'calc.spark.winloss', size: 'small', keytip: 'MG' },
      ],
    },
    { id: 'filters', label: 'Filtros', icon: 'slicer', items: [{ kind: 'button', command: 'calc.slicer', size: 'large', keytip: 'SG' }] },
    { id: 'links', label: 'Vínculos', icon: 'link', items: [{ kind: 'button', command: 'calc.link', size: 'large', keytip: 'VI' }] },
    { id: 'comments', label: 'Comentarios', icon: 'note', items: [{ kind: 'button', command: 'calc.note.new', size: 'large', keytip: 'NO' }] },
  ];
}

export function reviewTab(): RibbonTab {
  return {
    id: 'review',
    label: 'Revisar',
    keytip: 'R',
    groups: [
      {
        id: 'notes',
        label: 'Notas',
        icon: 'note',
        items: [
          { kind: 'button', command: 'calc.note.new', size: 'large', keytip: 'N' },
          { kind: 'button', command: 'calc.note.delete', size: 'small', keytip: 'E' },
          { kind: 'button', command: 'calc.note.prev', size: 'small', keytip: 'A' },
          { kind: 'button', command: 'calc.note.next', size: 'small', keytip: 'S' },
          {
            kind: 'dropdown',
            id: 'showNotes',
            label: 'Mostrar notas',
            icon: 'note',
            size: 'large',
            keytip: 'M',
            entries: [cmd('calc.note.toggle'), cmd('calc.note.showAll'), cmd('calc.note.hideAll')],
          },
        ],
      },
      {
        id: 'links',
        label: 'Vínculos',
        icon: 'link',
        items: [
          { kind: 'button', command: 'calc.link', size: 'large', keytip: 'V' },
          { kind: 'button', command: 'calc.link.open', size: 'small', keytip: 'O' },
          { kind: 'button', command: 'calc.link.remove', size: 'small', keytip: 'Q' },
        ],
      },
    ],
  };
}

export function pageTab(): RibbonTab {
  return {
    id: 'page',
    label: 'Diseño de página',
    keytip: 'P',
    groups: [
      {
        id: 'setup',
        label: 'Configurar página',
        icon: 'print',
        items: [
          { kind: 'dropdown', id: 'margins', label: 'Márgenes', icon: 'print', size: 'large', keytip: 'M', entries: ['normal', 'wide', 'narrow'].map((k) => cmd(`calc.page.margins.${k}`)) },
          { kind: 'dropdown', id: 'orientation', label: 'Orientación', icon: 'print', size: 'large', keytip: 'O', entries: [cmd('calc.page.portrait'), cmd('calc.page.landscape')] },
          { kind: 'dropdown', id: 'paper', label: 'Tamaño', icon: 'print', size: 'large', keytip: 'T', entries: ['A4', 'A3', 'A5', 'Letter', 'Legal'].map((k) => cmd(`calc.page.paper.${k}`)) },
          {
            kind: 'dropdown',
            id: 'printArea',
            label: 'Área de impresión',
            icon: 'print',
            size: 'large',
            keytip: 'AR',
            entries: [cmd('calc.page.areaSet'), cmd('calc.page.areaAdd'), cmd('calc.page.areaClear')],
          },
          { kind: 'dropdown', id: 'breaks', label: 'Saltos', icon: 'print', size: 'large', keytip: 'SA', entries: [cmd('calc.page.break'), cmd('calc.page.breakClear')] },
          { kind: 'button', command: 'calc.page.titles', size: 'large', keytip: 'IT' },
        ],
      },
      {
        id: 'fit',
        label: 'Ajustar área de impresión',
        icon: 'print',
        items: [
          { kind: 'dropdown', id: 'fit', label: 'Escala', icon: 'print', size: 'large', keytip: 'AJ', entries: [cmd('calc.page.fitNone'), cmd('calc.page.fitWidth'), cmd('calc.page.fitAll')] },
        ],
      },
      {
        id: 'sheetOptions',
        label: 'Opciones de la hoja',
        icon: 'gridlines',
        items: [
          { kind: 'button', command: 'calc.page.gridlines', size: 'small', keytip: 'CU' },
          { kind: 'button', command: 'calc.page.headings', size: 'small', keytip: 'EN' },
        ],
      },
      {
        id: 'print',
        label: 'Imprimir',
        icon: 'print',
        items: [
          { kind: 'button', command: 'calc.print', size: 'large', keytip: 'IP' },
          { kind: 'button', command: 'calc.page.setup', size: 'small', keytip: 'CP' },
        ],
      },
    ],
  };
}

export function developerTab(): RibbonTab {
  return {
    id: 'developer',
    label: 'Programador',
    keytip: 'L',
    groups: [
      {
        id: 'code',
        label: 'Código',
        icon: 'code',
        items: [
          { kind: 'button', command: 'calc.macroEditor', size: 'large', keytip: 'ED' },
          { kind: 'button', command: 'calc.macros', size: 'large', keytip: 'MA' },
        ],
      },
      { id: 'security', label: 'Seguridad', icon: 'run', items: [{ kind: 'button', command: 'calc.macroEnable', size: 'large', keytip: 'HC' }] },
    ],
  };
}

export interface ContextFlags {
  chart: boolean;
  table: boolean;
  pivot: boolean;
  sparkline: boolean;
  picture: boolean;
  slicer: boolean;
}

const styleMenu = (family: 'Light' | 'Medium' | 'Dark', counts: number): Entry[] => Array.from({ length: counts }, (_x, i) => cmd(`calc.table.style.TableStyle${family}${i + 1}`));
const pivotStyleMenu = (family: 'Light' | 'Medium' | 'Dark', from: number, to: number): Entry[] => Array.from({ length: to - from + 1 }, (_x, i) => cmd(`calc.pivot.style.PivotStyle${family}${from + i}`));

export function contextualTabs(ui: CalcUI, f: ContextFlags): RibbonTab[] {
  const tbl = ui.doc.x.tableAtActive()?.table;
  const table: RibbonTab = {
    id: 'tableDesign',
    label: 'Diseño de tabla',
    keytip: 'JT',
    contextual: { label: 'Herramientas de tabla', color: '#2b7a4b', visible: f.table },
    groups: [
      {
        id: 'props',
        label: 'Propiedades',
        icon: 'tableGrid',
        items: [{ kind: 'custom', id: 'tableName', label: 'Nombre de la tabla', keytip: 'NT', render: () => (tbl ? <TableNameField key={tbl.id} ui={ui} table={tbl} /> : null) }, { kind: 'button', command: 'calc.table.resize', size: 'small', keytip: 'CT' }],
      },
      {
        id: 'tools',
        label: 'Herramientas',
        icon: 'pivot',
        items: [
          { kind: 'button', command: 'calc.table.pivot', size: 'large', keytip: 'RD' },
          { kind: 'button', command: 'calc.table.slicer', size: 'large', keytip: 'IS' },
          { kind: 'button', command: 'calc.table.toRange', size: 'large', keytip: 'CR' },
        ],
      },
      {
        id: 'styleOptions',
        label: 'Opciones de estilo de tabla',
        icon: 'tableGrid',
        items: [
          { kind: 'button', command: 'calc.table.totals', size: 'small', keytip: 'FT' },
          { kind: 'button', command: 'calc.table.rowStripes', size: 'small', keytip: 'FB' },
          { kind: 'button', command: 'calc.table.colStripes', size: 'small', keytip: 'CB' },
          { kind: 'button', command: 'calc.table.firstCol', size: 'small', keytip: 'PC' },
          { kind: 'button', command: 'calc.table.lastCol', size: 'small', keytip: 'UC' },
          { kind: 'button', command: 'calc.table.filter', size: 'small', keytip: 'BF' },
        ],
      },
      {
        id: 'styles',
        label: 'Estilos de tabla',
        icon: 'tableGrid',
        items: [
          { kind: 'dropdown', id: 'styleLight', label: 'Claro', icon: 'tableGrid', size: 'large', keytip: 'EC', entries: styleMenu('Light', 21) },
          { kind: 'dropdown', id: 'styleMedium', label: 'Medio', icon: 'tableGrid', size: 'large', keytip: 'EM', entries: styleMenu('Medium', 28) },
          { kind: 'dropdown', id: 'styleDark', label: 'Oscuro', icon: 'tableGrid', size: 'large', keytip: 'EO', entries: styleMenu('Dark', 11) },
        ],
      },
    ],
  };

  const pivot: RibbonTab = {
    id: 'pivot',
    label: 'Tabla dinámica',
    keytip: 'JD',
    contextual: { label: 'Herramientas de tabla dinámica', color: '#7a4e9b', visible: f.pivot },
    groups: [
      {
        id: 'pivotMain',
        label: 'Tabla dinámica',
        icon: 'pivot',
        items: [
          { kind: 'button', command: 'calc.pivot.options', size: 'large', keytip: 'OP' },
          { kind: 'button', command: 'calc.pivot.delete', size: 'small', keytip: 'EL' },
        ],
      },
      {
        id: 'pivotData',
        label: 'Datos',
        icon: 'refresh',
        items: [
          { kind: 'button', command: 'calc.pivot.refresh', size: 'large', keytip: 'AC' },
          { kind: 'button', command: 'calc.pivot.refreshAll', size: 'small', keytip: 'AT' },
        ],
      },
      {
        id: 'pivotShow',
        label: 'Mostrar',
        icon: 'panel',
        items: [
          { kind: 'button', command: 'calc.pivot.fieldList', size: 'large', keytip: 'LC' },
          { kind: 'button', command: 'calc.pivot.slicer', size: 'large', keytip: 'SE' },
        ],
      },
      {
        id: 'pivotLayout',
        label: 'Diseño',
        icon: 'pivot',
        items: [
          { kind: 'dropdown', id: 'pivotLayout', label: 'Diseño del informe', icon: 'pivot', size: 'large', keytip: 'DI', entries: ['compact', 'outline', 'tabular'].map((k) => cmd(`calc.pivot.layout.${k}`)) },
          {
            kind: 'dropdown',
            id: 'pivotTotals',
            label: 'Totales y subtotales',
            icon: 'sigma',
            size: 'large',
            keytip: 'TS',
            entries: [cmd('calc.pivot.grandRows'), cmd('calc.pivot.grandCols'), cmd('calc.pivot.subtotals'), cmd('calc.pivot.repeat'), cmd('calc.pivot.blank')],
          },
        ],
      },
      {
        id: 'pivotStyles',
        label: 'Estilos de tabla dinámica',
        icon: 'pivot',
        items: [
          { kind: 'dropdown', id: 'pivotStyleLight', label: 'Claro', icon: 'pivot', size: 'large', keytip: 'PC', entries: pivotStyleMenu('Light', 15, 21) },
          { kind: 'dropdown', id: 'pivotStyleMedium', label: 'Medio', icon: 'pivot', size: 'large', keytip: 'PM', entries: pivotStyleMenu('Medium', 1, 7) },
          { kind: 'dropdown', id: 'pivotStyleDark', label: 'Oscuro', icon: 'pivot', size: 'large', keytip: 'PO', entries: pivotStyleMenu('Dark', 1, 7) },
        ],
      },
    ],
  };

  const spark: RibbonTab = {
    id: 'sparkline',
    label: 'Minigráfico',
    keytip: 'JM',
    contextual: { label: 'Herramientas de minigráfico', color: '#0e7490', visible: f.sparkline },
    groups: [
      {
        id: 'sparkType',
        label: 'Tipo',
        icon: 'sparkline',
        items: ['line', 'column', 'winloss'].map((k) => ({ kind: 'button' as const, command: `calc.sparkType.${k}`, size: 'small' as const, keytip: k === 'line' ? 'TL' : k === 'column' ? 'TC' : 'TW' })),
      },
      {
        id: 'sparkShow',
        label: 'Mostrar',
        icon: 'sparkline',
        items: [
          { kind: 'button', command: 'calc.spark.high', size: 'small', keytip: 'PA' },
          { kind: 'button', command: 'calc.spark.low', size: 'small', keytip: 'PB' },
          { kind: 'button', command: 'calc.spark.negative', size: 'small', keytip: 'PN' },
          { kind: 'button', command: 'calc.spark.first', size: 'small', keytip: 'PP' },
          { kind: 'button', command: 'calc.spark.last', size: 'small', keytip: 'PU' },
          { kind: 'button', command: 'calc.spark.markers', size: 'small', keytip: 'PM' },
        ],
      },
      {
        id: 'sparkStyle',
        label: 'Estilo',
        icon: 'sparkline',
        items: [
          { kind: 'dropdown', id: 'sparkColor', label: 'Color del minigráfico', icon: 'sparkline', size: 'large', keytip: 'CO', entries: ['blue', 'green', 'orange', 'red', 'gray', 'purple'].map((k) => cmd(`calc.spark.color.${k}`)) },
        ],
      },
      {
        id: 'sparkGroup',
        label: 'Agrupar',
        icon: 'sparkline',
        items: [
          { kind: 'button', command: 'calc.spark.axis', size: 'small', keytip: 'EJ' },
          { kind: 'button', command: 'calc.spark.rtl', size: 'small', keytip: 'RL' },
          { kind: 'button', command: 'calc.spark.scale', size: 'small', keytip: 'ES' },
          { kind: 'button', command: 'calc.spark.clear', size: 'small', keytip: 'CL' },
          { kind: 'button', command: 'calc.spark.clearGroup', size: 'small', keytip: 'CG' },
        ],
      },
    ],
  };

  const picture: RibbonTab = {
    id: 'picture',
    label: 'Formato de imagen',
    keytip: 'JI',
    contextual: { label: 'Herramientas de imagen', color: '#b45309', visible: f.picture },
    groups: [
      {
        id: 'picAccess',
        label: 'Accesibilidad',
        icon: 'picture',
        items: [{ kind: 'button', command: 'calc.picture.alt', size: 'large', keytip: 'TA' }],
      },
      {
        id: 'picSize',
        label: 'Tamaño',
        icon: 'picture',
        items: [{ kind: 'button', command: 'calc.picture.original', size: 'large', keytip: 'TO' }],
      },
      { id: 'picActions', label: 'Acciones', icon: 'trash', items: [{ kind: 'button', command: 'calc.picture.delete', size: 'large', keytip: 'EL' }] },
    ],
  };

  const slicer: RibbonTab = {
    id: 'slicer',
    label: 'Segmentación',
    keytip: 'JS',
    contextual: { label: 'Herramientas de segmentación', color: '#be123c', visible: f.slicer },
    groups: [
      {
        id: 'slSettings',
        label: 'Segmentación',
        icon: 'slicer',
        items: [
          { kind: 'button', command: 'calc.slicer.caption', size: 'small', keytip: 'TI' },
          { kind: 'button', command: 'calc.slicer.columns', size: 'small', keytip: 'CO' },
          { kind: 'button', command: 'calc.slicer.clear', size: 'small', keytip: 'BF' },
        ],
      },
      { id: 'slActions', label: 'Acciones', icon: 'trash', items: [{ kind: 'button', command: 'calc.slicer.delete', size: 'large', keytip: 'EL' }] },
    ],
  };
  return [table, pivot, spark, picture, slicer];
}
