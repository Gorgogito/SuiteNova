import { registerIcon, type RibbonTab } from '@suitenova/core-ui';
import { AArrowDown, AArrowUp, ArrowDownAZ, ArrowRightToLine, ArrowUpZA, Code2, Columns3, EyeOff, FileDown, FileSpreadsheet, FileText, Filter, FilterX, Grid3X3, Link2, MoveHorizontal, Pencil, Pin, PinOff, Play, Plus, RefreshCw, Replace, Rows2, Rows3, Search, Sigma, Trash2 } from 'lucide-react';
import { helpTab, viewTab } from '../common';

registerIcon('edit', Pencil);
registerIcon('play', Play);
registerIcon('spreadsheet', FileSpreadsheet);
registerIcon('exportFile', FileDown);
registerIcon('document', FileText);
registerIcon('trash', Trash2);
registerIcon('link', Link2);
registerIcon('code', Code2);
for (const [n, c] of Object.entries({ sortAsc: ArrowDownAZ, sortDesc: ArrowUpZA, filter: Filter, filterOff: FilterX, find: Search, replace: Replace, sigma: Sigma, refresh: RefreshCw, columns: Columns3, hideCol: EyeOff, freeze: Pin, unfreeze: PinOff, width: MoveHorizontal, rowH: Rows3, rowAdd: Plus, gridlines: Grid3X3, zebra: Rows2, fontUp: AArrowUp, fontDown: AArrowDown, goto: ArrowRightToLine })) registerIcon(n, c);

type Leaf = { kind: 'button'; command: string; size: 'small'; iconOnly: true; keytip: string };
const ib = (command: string, keytip: string): Leaf => ({ kind: 'button', command, size: 'small', iconOnly: true, keytip });
const dd = (id: string, label: string, icon: string, keytip: string, cmds: string[]) => ({ kind: 'dropdown' as const, id, label, icon, size: 'small' as const, iconOnly: true, keytip, entries: cmds.map((command) => ({ kind: 'command' as const, command })) });

/** The ribbon of Nova Base. */
export function baseTabs(): RibbonTab[] {
  const home: RibbonTab = {
    id: 'home',
    label: 'tab.home',
    keytip: 'I',
    groups: [
      {
        id: 'undo',
        label: 'Deshacer',
        icon: 'undo',
        items: [
          { kind: 'button', command: 'base.undo', size: 'small', keytip: 'DS' },
          { kind: 'button', command: 'base.redo', size: 'small', keytip: 'RH' },
        ],
      },
      {
        id: 'views',
        label: 'Vistas',
        icon: 'table',
        items: [
          { kind: 'button', command: 'base.view.datasheet', size: 'large', keytip: 'HD' },
          { kind: 'button', command: 'base.view.design', size: 'large', keytip: 'DI' },
        ],
      },
      {
        id: 'clipboard',
        label: 'Portapapeles',
        icon: 'paste',
        items: [{ kind: 'button', command: 'base.sheet.paste', size: 'large', keytip: 'PG' }, ib('base.sheet.cut', 'CT'), ib('base.sheet.copy', 'CO')],
      },
      {
        id: 'sortfilter',
        label: 'Ordenar y filtrar',
        icon: 'filter',
        items: [
          ib('base.sheet.sortAsc', 'OA'),
          ib('base.sheet.sortDesc', 'OD'),
          ib('base.sheet.sortClear', 'OQ'),
          ib('base.sheet.filter', 'FI'),
          dd('filterBy', 'Filtrar por selección', 'filter', 'FS', ['base.sheet.filterBy.eq', 'base.sheet.filterBy.ne', 'base.sheet.filterBy.contains', 'base.sheet.filterBy.notcontains', 'base.sheet.filterBy.begins', 'base.sheet.filterBy.ends', 'base.sheet.filterBy.gt', 'base.sheet.filterBy.lt']),
          ib('base.sheet.filterToggle', 'FT'),
          ib('base.sheet.filterClear', 'FQ'),
        ],
      },
      {
        id: 'records',
        label: 'Registros',
        icon: 'rowAdd',
        items: [ib('base.sheet.new', 'NR'), ib('base.sheet.delete', 'ER'), ib('base.sheet.totals', 'TO'), ib('base.sheet.refresh', 'AC')],
      },
      {
        id: 'find',
        label: 'Buscar',
        icon: 'find',
        items: [ib('base.sheet.find', 'BU'), ib('base.sheet.replace', 'RE'), dd('goto', 'Ir a', 'goto', 'IR', ['base.sheet.goto.first', 'base.sheet.goto.previous', 'base.sheet.goto.next', 'base.sheet.goto.last', 'base.sheet.goto.new'])],
      },
      {
        id: 'sheetcols',
        label: 'Columnas',
        icon: 'columns',
        items: [ib('base.sheet.hide', 'OC'), ib('base.sheet.columns', 'MC'), ib('base.sheet.freeze', 'IN'), ib('base.sheet.unfreeze', 'LC'), ib('base.sheet.width', 'AN'), ib('base.sheet.rowHeight', 'AF')],
      },
      {
        id: 'textfmt',
        label: 'Formato de texto',
        icon: 'fontUp',
        items: [ib('base.sheet.fontUp', 'FA'), ib('base.sheet.fontDown', 'FD'), ib('base.sheet.zebra', 'FZ'), ib('base.sheet.gridlines', 'GR')],
      },
      {
        id: 'objects',
        label: 'Objetos',
        icon: 'open',
        items: [
          { kind: 'button', command: 'base.object.open', size: 'large', keytip: 'AB' },
          { kind: 'button', command: 'base.object.design', size: 'small', keytip: 'DT' },
          { kind: 'button', command: 'base.object.rename', size: 'small', keytip: 'CN' },
          { kind: 'button', command: 'base.object.delete', size: 'small', keytip: 'EL' },
        ],
      },
      {
        id: 'query',
        label: 'Consultas',
        icon: 'play',
        items: [{ kind: 'button', command: 'base.run', size: 'large', keytip: 'EJ' }],
      },
      {
        id: 'tabs',
        label: 'Ventana',
        icon: 'close',
        items: [{ kind: 'button', command: 'base.tab.close', size: 'large', keytip: 'CE' }],
      },
    ],
  };

  const create: RibbonTab = {
    id: 'create',
    label: 'Crear',
    keytip: 'C',
    groups: [
      {
        id: 'tables',
        label: 'Tablas',
        icon: 'table',
        items: [{ kind: 'button', command: 'base.table.new', size: 'large', keytip: 'TB' }, { kind: 'button', command: 'base.copyTable', size: 'large', keytip: 'KT' }],
      },
      {
        id: 'queries',
        label: 'Consultas',
        icon: 'search',
        items: [
          { kind: 'button', command: 'base.query.design', size: 'large', keytip: 'CD' },
          { kind: 'button', command: 'base.query.new', size: 'large', keytip: 'CO' },
          { kind: 'dropdown', id: 'queryWizards', label: 'Asistentes de consultas', icon: 'search', size: 'large', keytip: 'AS', entries: [{ kind: 'command' as const, command: 'base.query.wizard.dups' }, { kind: 'command' as const, command: 'base.query.wizard.unmatched' }] },
        ],
      },
      {
        id: 'forms',
        label: 'Formularios',
        icon: 'forms',
        items: [{ kind: 'button', command: 'base.form.new', size: 'large', keytip: 'FO' }, { kind: 'button', command: 'base.form.wizard', size: 'large', keytip: 'FA' }],
      },
      {
        id: 'code',
        label: 'Macros y código',
        icon: 'code',
        items: [
          { kind: 'button', command: 'base.macro.new', size: 'large', keytip: 'MA' },
          { kind: 'button', command: 'base.module.new', size: 'large', keytip: 'MD' },
          { kind: 'button', command: 'base.module.newclass', size: 'large', keytip: 'MK' },
          { kind: 'button', command: 'base.files', size: 'large', keytip: 'AC' },
        ],
      },
      {
        id: 'reports',
        label: 'Informes',
        icon: 'document',
        items: [
          { kind: 'button', command: 'base.report.design', size: 'large', keytip: 'DN' },
          { kind: 'button', command: 'base.report.new', size: 'large', keytip: 'IN' },
          { kind: 'button', command: 'base.report.labels', size: 'large', keytip: 'ET' },
        ],
      },
    ],
  };

  const external: RibbonTab = {
    id: 'external',
    label: 'Datos externos',
    keytip: 'X',
    groups: [
      {
        id: 'import',
        label: 'Importar',
        icon: 'open',
        items: [
          { kind: 'button', command: 'base.import.csv', size: 'large', keytip: 'IC' },
          { kind: 'button', command: 'base.import.xlsx', size: 'large', keytip: 'IX' },
          { kind: 'button', command: 'base.import.file', size: 'large', keytip: 'IO' },
          { kind: 'button', command: 'base.import.paste', size: 'large', keytip: 'IG' },
        ],
      },
      {
        id: 'export',
        label: 'Exportar',
        icon: 'exportFile',
        items: [
          { kind: 'button', command: 'base.export.csv', size: 'large', keytip: 'EC' },
          { kind: 'button', command: 'base.print', size: 'large', keytip: 'EP' },
          { kind: 'dropdown', id: 'exportTo', label: 'Exportar a', icon: 'exportFile', size: 'large', keytip: 'EA', entries: ['base.export.xlsx', 'base.export.json', 'base.export.xml', 'base.export.html', 'base.export.sql', 'base.export.tsv'].map((command) => ({ kind: 'command' as const, command })) },
          { kind: 'button', command: 'base.export.dialog', size: 'large', keytip: 'EX' },
        ],
      },
    ],
  };

  const tools: RibbonTab = {
    id: 'tools',
    label: 'Herramientas',
    keytip: 'H',
    groups: [
      {
        id: 'maint',
        label: 'Mantenimiento',
        icon: 'reset',
        items: [{ kind: 'button', command: 'base.compact', size: 'large', keytip: 'CP' }, { kind: 'button', command: 'base.backup', size: 'large', keytip: 'CS' }, { kind: 'button', command: 'base.password', size: 'large', keytip: 'CK' }, { kind: 'button', command: 'base.password.remove', size: 'large', keytip: 'QK' }, { kind: 'button', command: 'base.document', size: 'large', keytip: 'DC' }],
      },
      {
        id: 'rel',
        label: 'Relaciones',
        icon: 'link',
        items: [{ kind: 'button', command: 'base.relations', size: 'large', keytip: 'RL' }],
      },
    ],
  };

  return [home, create, external, tools, viewTab({ zoom: false }), helpTab()];
}
