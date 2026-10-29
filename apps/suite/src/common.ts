import type { CommandDef, RibbonTab } from '@suitenova/core-ui';
import './messages';

/** View tab shared by every window: theme, language, zoom and ribbon pinning. All commands are real. */
export function viewTab(opts: { zoom?: boolean } = { zoom: true }): RibbonTab {
  return {
    id: 'view',
    label: 'tab.view',
    keytip: 'W',
    groups: [
      {
        id: 'theme',
        label: 'group.theme',
        icon: 'sun',
        items: [
          {
            kind: 'dropdown',
            id: 'themeMenu',
            label: 'menu.theme',
            icon: 'contrast',
            size: 'large',
            keytip: 'T',
            entries: [
              { kind: 'command', command: 'theme.system' },
              { kind: 'command', command: 'theme.light' },
              { kind: 'command', command: 'theme.dark' },
              { kind: 'command', command: 'theme.contrast' },
            ],
          },
        ],
      },
      {
        id: 'language',
        label: 'group.language',
        icon: 'language',
        items: [
          {
            kind: 'dropdown',
            id: 'langMenu',
            label: 'menu.language',
            icon: 'language',
            size: 'large',
            keytip: 'L',
            entries: [
              { kind: 'command', command: 'lang.es' },
              { kind: 'command', command: 'lang.en' },
            ],
          },
        ],
      },
      ...(opts.zoom === false
        ? []
        : [
            {
              id: 'zoom',
              label: 'group.zoom',
              icon: 'zoomIn',
              items: [
                { kind: 'button' as const, command: 'zoom.in', keytip: 'I' },
                { kind: 'button' as const, command: 'zoom.out', keytip: 'O' },
                { kind: 'button' as const, command: 'zoom.reset', keytip: 'R' },
              ],
            },
          ]),
      {
        id: 'ribbon',
        label: 'group.ribbon',
        icon: 'ribbonCollapse',
        items: [{ kind: 'button', command: 'view.toggleRibbon', size: 'large', keytip: 'C' }],
      },
    ],
  };
}

export function helpTab(opts: { shortcuts?: boolean } = { shortcuts: true }): RibbonTab {
  return {
    id: 'help',
    label: 'tab.help',
    keytip: 'Y',
    groups: [
      {
        id: 'help',
        label: 'group.help',
        icon: 'help',
        items: [
          ...(opts.shortcuts === false ? [] : [{ kind: 'button' as const, command: 'help.shortcuts', size: 'large' as const, keytip: 'K' }]),
          { kind: 'button', command: 'tellme.focus', size: 'large', keytip: 'Q' },
        ],
      },
    ],
  };
}

export function zoomCommands(get: () => number, set: (v: number) => void, clamp: (v: number) => number): CommandDef[] {
  return [
    { id: 'zoom.in', label: 'cmd.zoom.in', icon: 'zoomIn', shortcut: 'Ctrl++', run: () => set(clamp(get() + 10)) },
    { id: 'zoom.out', label: 'cmd.zoom.out', icon: 'zoomOut', shortcut: 'Ctrl+-', run: () => set(clamp(get() - 10)) },
    { id: 'zoom.reset', label: 'cmd.zoom.reset', icon: 'reset', shortcut: 'Ctrl+0', enabled: () => get() !== 100, run: () => set(100) },
  ];
}
