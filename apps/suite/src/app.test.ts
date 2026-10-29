import { coreCommands, MODULE_ACCENTS, type RibbonTab } from '@suitenova/core-ui';
import { describe, expect, it } from 'vitest';
import { helpTab, viewTab, zoomCommands } from './common';
import { MODULES } from './modules';

function commandIds(tab: RibbonTab): string[] {
  return tab.groups.flatMap((g) =>
    g.items.flatMap((i) => {
      if (i.kind === 'button') return [i.command];
      if (i.kind === 'dropdown') return [...(i.primaryCommand ? [i.primaryCommand] : []), ...i.entries.flatMap((e) => (e.kind === 'command' ? [e.command] : []))];
      return [];
    }),
  );
}

describe('module catalog', () => {
  it('has unique ids and an accent colour for each module', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(MODULE_ACCENTS[id], id).toBeTruthy();
  });
});

describe('shared ribbon tabs', () => {
  const known = new Set([...coreCommands.map((c) => c.id), ...zoomCommands(() => 100, () => {}, (v) => v).map((c) => c.id), 'help.shortcuts']);

  it('only reference commands that exist (no decorative controls)', () => {
    for (const tab of [viewTab(), helpTab()]) {
      for (const id of commandIds(tab)) expect(known.has(id), `${tab.id}: ${id}`).toBe(true);
    }
  });

  it('omits zoom and shortcuts when the host does not provide them', () => {
    expect(commandIds(viewTab({ zoom: false }))).not.toContain('zoom.in');
    expect(commandIds(helpTab({ shortcuts: false }))).not.toContain('help.shortcuts');
  });

  it('uses unique explicit keytips inside a tab', () => {
    const tips = (tab: RibbonTab) => tab.groups.flatMap((g) => g.items.flatMap((i) => ('keytip' in i && i.keytip ? [i.keytip] : [])));
    for (const tab of [viewTab(), helpTab()]) expect(new Set(tips(tab)).size).toBe(tips(tab).length);
  });
});
