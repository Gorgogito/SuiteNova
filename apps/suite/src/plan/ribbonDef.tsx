import type { RibbonItem, RibbonTab } from '@suitenova/core-ui';
import { REPORTS } from '@suitenova/plan-core';
import { helpTab, viewTab } from '../common';
import { PERCENTS, QUICK_FILTERS, SCALES, VIEWS } from './commands';

const cmd = (command: string) => ({ kind: 'command' as const, command });

/** The ribbon of Nova Plan. Every item is bound to a registered command. */
export function planTabs(): RibbonTab[] {
  const task: RibbonTab = {
    id: 'task',
    label: 'Tarea',
    keytip: 'T',
    groups: [
      {
        id: 'views',
        label: 'Vista',
        icon: 'chart',
        items: [
          { kind: 'button', command: 'plan.view.gantt', size: 'large', keytip: 'GA' },
          { kind: 'button', command: 'plan.view.network', size: 'large', keytip: 'RD' },
        ],
      },
      {
        id: 'insert',
        label: 'Insertar',
        icon: 'plus',
        items: [
          { kind: 'button', command: 'plan.task.add', size: 'large', keytip: 'TN' },
          { kind: 'button', command: 'plan.task.milestone', size: 'large', keytip: 'HI' },
          { kind: 'button', command: 'plan.task.delete', size: 'large', keytip: 'EL' },
        ],
      },
      {
        id: 'structure',
        label: 'Esquema',
        icon: 'indentMore',
        items: [
          { kind: 'button', command: 'plan.task.indent', size: 'small', keytip: 'SA' },
          { kind: 'button', command: 'plan.task.outdent', size: 'small', keytip: 'SD' },
          { kind: 'button', command: 'plan.task.up', size: 'small', keytip: 'MA' },
          { kind: 'button', command: 'plan.task.down', size: 'small', keytip: 'MB' },
        ],
      },
      {
        id: 'links',
        label: 'Programación',
        icon: 'link',
        items: [
          { kind: 'button', command: 'plan.task.link', size: 'small', keytip: 'VI' },
          { kind: 'button', command: 'plan.task.unlink', size: 'small', keytip: 'DV' },
          { kind: 'button', command: 'plan.task.manual', size: 'small', keytip: 'PM' },
          { kind: 'button', command: 'plan.task.auto', size: 'small', keytip: 'PA' },
          { kind: 'button', command: 'plan.task.split', size: 'small', keytip: 'DT' },
          { kind: 'button', command: 'plan.task.unsplit', size: 'small', keytip: 'QD' },
        ],
      },
      {
        id: 'progress',
        label: 'Avance',
        icon: 'checkSquare',
        items: [
          {
            kind: 'dropdown',
            id: 'percentMenu',
            label: '% completado',
            icon: 'checkSquare',
            size: 'large',
            keytip: 'PC',
            entries: PERCENTS.map((p) => cmd(`plan.percent.${p}`)),
          },
        ],
      },
      {
        id: 'props',
        label: 'Propiedades',
        icon: 'info',
        items: [
          { kind: 'button', command: 'plan.task.info', size: 'large', keytip: 'IN' },
          { kind: 'button', command: 'plan.task.goto', size: 'large', keytip: 'IR' },
        ],
      },
    ],
  };

  const resource: RibbonTab = {
    id: 'resource',
    label: 'Recurso',
    keytip: 'R',
    groups: [
      {
        id: 'resviews',
        label: 'Vistas de recursos',
        icon: 'table',
        items: [
          { kind: 'button', command: 'plan.view.resourceSheet', size: 'large', keytip: 'HR' },
          { kind: 'button', command: 'plan.view.resourceUsage', size: 'large', keytip: 'UR' },
          { kind: 'button', command: 'plan.view.resourceGraph', size: 'large', keytip: 'GR' },
          { kind: 'button', command: 'plan.view.taskUsage', size: 'large', keytip: 'UT' },
        ],
      },
      { id: 'resnew', label: 'Insertar', icon: 'plus', items: [{ kind: 'button', command: 'plan.resource.add', size: 'large', keytip: 'RN' }] },
      {
        id: 'reslevel',
        label: 'Nivelación',
        icon: 'settings',
        items: [
          { kind: 'button', command: 'plan.level', size: 'small', keytip: 'NV' },
          { kind: 'button', command: 'plan.level.clear', size: 'small', keytip: 'NB' },
        ],
      },
      {
        id: 'resstep',
        label: 'Escala de las tablas',
        icon: 'calendar',
        items: ['day', 'week', 'month'].map((s, i) => ({ kind: 'button' as const, command: `plan.step.${s}`, size: 'small' as const, keytip: ['TD', 'TS', 'TM'][i]! })),
      },
    ],
  };

  const project: RibbonTab = {
    id: 'project',
    label: 'Proyecto',
    keytip: 'P',
    groups: [
      {
        id: 'setup',
        label: 'Propiedades',
        icon: 'info',
        items: [
          { kind: 'button', command: 'plan.project.info', size: 'large', keytip: 'IP' },
          { kind: 'button', command: 'plan.calendar', size: 'large', keytip: 'CL' },
          { kind: 'button', command: 'plan.customFields', size: 'large', keytip: 'CP' },
        ],
      },
      {
        id: 'baseline',
        label: 'Seguimiento',
        icon: 'save',
        items: [
          { kind: 'button', command: 'plan.baselines', size: 'large', keytip: 'LB' },
          { kind: 'button', command: 'plan.status', size: 'large', keytip: 'FE' },
        ],
      },
      {
        id: 'sub',
        label: 'Subproyectos',
        icon: 'open',
        items: [
          { kind: 'button', command: 'plan.subproject.insert', size: 'small', keytip: 'SI' },
          { kind: 'button', command: 'plan.subproject.refresh', size: 'small', keytip: 'SU' },
          { kind: 'button', command: 'plan.subproject.live', size: 'small', keytip: 'SV' },
        ],
      },
      {
        id: 'reports',
        label: 'Informes',
        icon: 'list',
        items: [
          {
            kind: 'dropdown',
            id: 'reportMenu',
            label: 'Informes visuales',
            icon: 'list',
            size: 'large',
            keytip: 'RS',
            entries: REPORTS.map((r) => cmd(`plan.report.${r.id}`)),
          },
        ],
      },
      {
        id: 'data',
        label: 'Datos',
        icon: 'exportFile',
        items: [
          { kind: 'button', command: 'plan.import.mspdi', size: 'large', keytip: 'IM' },
          {
            kind: 'dropdown',
            id: 'exportMenu',
            label: 'Exportar',
            icon: 'exportFile',
            size: 'large',
            keytip: 'EX',
            entries: [cmd('plan.export.mspdi'), cmd('plan.export.mspdi.ext'), cmd('plan.export.csv'), cmd('plan.print'), cmd('plan.export.report.csv'), cmd('plan.export.report.html'), cmd('plan.print.report')],
          },
        ],
      },
    ],
  };

  // the shared view tab, with the planner's own options in front
  const view = viewTab();
  const views: RibbonItem[] = VIEWS.map(([v], i) => ({ kind: 'button' as const, command: `plan.view.${v}`, size: 'small' as const, keytip: ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'][i]! }));
  view.groups.unshift(
    { id: 'planviews', label: 'Vistas', icon: 'chart', items: views },
    {
      id: 'scale',
      label: 'Escala de tiempo',
      icon: 'calendar',
      items: SCALES.map(([s], i) => ({ kind: 'button' as const, command: `plan.scale.${s}`, size: 'small' as const, keytip: ['EH', 'ED', 'ES', 'EM'][i]! })),
    },
    {
      id: 'data',
      label: 'Datos',
      icon: 'filter',
      items: [
        {
          kind: 'dropdown',
          id: 'filterMenu',
          label: 'Filtro',
          icon: 'filter',
          size: 'large',
          keytip: 'FI',
          entries: [...QUICK_FILTERS.map((id) => cmd(`plan.filter.${id}`)), cmd('plan.filters')],
        },
        { kind: 'dropdown', id: 'groupMenu', label: 'Agrupar', icon: 'list', size: 'large', keytip: 'AG', entries: [cmd('plan.group.none'), cmd('plan.groups')] },
        { kind: 'button', command: 'plan.columns', size: 'large', keytip: 'KO' },
      ],
    },
    {
      id: 'show',
      label: 'Mostrar',
      icon: 'star',
      items: [
        { kind: 'button', command: 'plan.critical', size: 'large', keytip: 'UC' },
        { kind: 'button', command: 'plan.today', size: 'large', keytip: 'HO' },
      ],
    },
    {
      id: 'outline',
      label: 'Esquema',
      icon: 'list',
      items: [
        { kind: 'button', command: 'plan.expandAll', size: 'small', keytip: 'XA' },
        { kind: 'button', command: 'plan.collapseAll', size: 'small', keytip: 'XC' },
      ],
    },
  );
  return [task, resource, project, view, helpTab()];
}
