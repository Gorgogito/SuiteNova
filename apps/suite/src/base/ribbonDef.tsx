import { registerIcon, type RibbonTab } from '@suitenova/core-ui';
import { Code2, FileDown, FileSpreadsheet, FileText, Link2, Pencil, Play, Trash2 } from 'lucide-react';
import { helpTab, viewTab } from '../common';

registerIcon('edit', Pencil);
registerIcon('play', Play);
registerIcon('spreadsheet', FileSpreadsheet);
registerIcon('exportFile', FileDown);
registerIcon('document', FileText);
registerIcon('trash', Trash2);
registerIcon('link', Link2);
registerIcon('code', Code2);

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
        items: [{ kind: 'button', command: 'base.table.new', size: 'large', keytip: 'TB' }],
      },
      {
        id: 'queries',
        label: 'Consultas',
        icon: 'search',
        items: [
          { kind: 'button', command: 'base.query.design', size: 'large', keytip: 'CD' },
          { kind: 'button', command: 'base.query.new', size: 'large', keytip: 'CO' },
        ],
      },
      {
        id: 'forms',
        label: 'Formularios',
        icon: 'forms',
        items: [{ kind: 'button', command: 'base.form.new', size: 'large', keytip: 'FO' }],
      },
      {
        id: 'code',
        label: 'Macros y código',
        icon: 'code',
        items: [
          { kind: 'button', command: 'base.macro.new', size: 'large', keytip: 'MA' },
          { kind: 'button', command: 'base.module.new', size: 'large', keytip: 'MD' },
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
        ],
      },
      {
        id: 'export',
        label: 'Exportar',
        icon: 'exportFile',
        items: [
          { kind: 'button', command: 'base.export.csv', size: 'large', keytip: 'EC' },
          { kind: 'button', command: 'base.print', size: 'large', keytip: 'EP' },
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
        items: [{ kind: 'button', command: 'base.compact', size: 'large', keytip: 'CP' }],
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
