import { CommandRegistry, coreCommands, type RibbonItem } from '@suitenova/core-ui';
import { describe, expect, it } from 'vitest';
import { zoomCommands } from '../common';
import { calcCommands, type CalcUI } from './commands';
import { CalcDoc } from './doc';
import { calcTabs } from './ribbonDef';

function setup() {
  const doc = new CalcDoc();
  const ui: CalcUI = {
    doc,
    openDialog: () => undefined,
    getZoom: () => 100,
    setZoom: () => undefined,
    newWindow: () => undefined,
    open: async () => undefined,
    save: async () => undefined,
    exportCsv: async () => undefined,
    close: () => undefined,
    openUrl: () => undefined,
    insertPicture: async () => undefined,
    restorePictureSize: async () => undefined,
  };
  const registry = new CommandRegistry();
  registry.registerAll(coreCommands);
  // like CalcApp: zoom shortcuts are dropped (Ctrl+0 hides columns there)
  registry.registerAll(zoomCommands(() => 100, () => undefined, (v) => v).map((c) => ({ ...c, shortcut: undefined })));
  registry.registerAll(calcCommands(ui));
  registry.register({ id: 'file.close', label: 'Cerrar', run: () => undefined });
  return { ui, registry, doc };
}

function commandsIn(items: RibbonItem[]): string[] {
  return items.flatMap((i) => {
    if (i.kind === 'button') return [i.command];
    if (i.kind === 'dropdown') return [...(i.primaryCommand ? [i.primaryCommand] : []), ...i.entries.flatMap((e) => (e.kind === 'command' ? [e.command] : []))];
    return [];
  });
}

describe('Nova Calc ribbon', () => {
  it('only references commands that exist (no decorative controls)', () => {
    const { ui, registry } = setup();
    const missing: string[] = [];
    for (const tab of calcTabs(ui, true)) for (const g of tab.groups) for (const id of commandsIn(g.items)) if (!registry.get(id)) missing.push(`${tab.id}/${g.id}: ${id}`);
    expect(missing).toEqual([]);
  });

  it('gives every command a label and no two commands share a shortcut', () => {
    const { registry } = setup();
    const seen = new Map<string, string>();
    for (const c of registry.all()) {
      expect(c.label, c.id).toBeTruthy();
      for (const sc of Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []) {
        const owner = seen.get(sc);
        // Ctrl+R is "fill right" in Calc and "align right" is deliberately not bound
        expect(owner, `${sc} used by ${c.id} and ${owner}`).toBeUndefined();
        seen.set(sc, c.id);
      }
    }
  });

  it('shows the contextual chart tab only while a chart is selected', () => {
    const { ui } = setup();
    expect(calcTabs(ui, false).find((t) => t.id === 'chart')?.contextual?.visible).toBe(false);
    expect(calcTabs(ui, true).find((t) => t.id === 'chart')?.contextual?.visible).toBe(true);
  });

  it('keeps ribbon key tips unique within each tab', () => {
    const { ui } = setup();
    for (const tab of calcTabs(ui, true)) {
      const tips = tab.groups.flatMap((g) => g.items.flatMap((i) => ('keytip' in i && i.keytip ? [i.keytip] : [])));
      // tips are matched as prefixes, so none may start another
      for (const a of tips) for (const b of tips) if (a !== b) expect(b.startsWith(a), `${tab.id}: ${a} vs ${b}`).toBe(false);
    }
  });
});
