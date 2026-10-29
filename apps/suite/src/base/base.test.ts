import { CommandRegistry, coreCommands, getLocale, setLocale, t, type RibbonItem } from '@suitenova/core-ui';
import { describe, expect, it } from 'vitest';
import { baseCommands, type BaseUI } from './commands';
import { BaseCtl } from './ctl';
import './messages';
import { baseTabs } from './ribbonDef';

function setup() {
  const ctl = new BaseCtl();
  const ui: BaseUI = {
    ctl,
    openDialog: () => undefined,
    newWindow: () => undefined,
    open: async () => undefined,
    save: async () => undefined,
    importCsv: async () => undefined,
    importXlsx: async () => undefined,
    exportCsv: async () => undefined,
    startRename: () => undefined,
    selected: () => null,
    printReport: () => undefined,
    close: () => undefined,
  };
  const registry = new CommandRegistry();
  registry.registerAll(coreCommands);
  registry.registerAll(baseCommands(ui));
  registry.register({ id: 'file.close', label: 'Cerrar', run: () => undefined });
  return { ui, registry, ctl };
}

function commandsIn(items: RibbonItem[]): string[] {
  return items.flatMap((i) => {
    if (i.kind === 'button') return [i.command];
    if (i.kind === 'dropdown') return [...(i.primaryCommand ? [i.primaryCommand] : []), ...i.entries.flatMap((e) => (e.kind === 'command' ? [e.command] : []))];
    return [];
  });
}

describe('Nova Base ribbon', () => {
  it('only references commands that exist (no decorative controls)', () => {
    const { registry } = setup();
    const missing: string[] = [];
    for (const tab of baseTabs()) for (const g of tab.groups) for (const id of commandsIn(g.items)) if (!registry.get(id)) missing.push(`${tab.id}/${g.id}: ${id}`);
    expect(missing).toEqual([]);
  });

  it('gives every command a label and no two commands share a shortcut', () => {
    const { registry } = setup();
    const seen = new Map<string, string>();
    for (const c of registry.all()) {
      expect(c.label, c.id).toBeTruthy();
      for (const sc of Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []) {
        expect(seen.get(sc), `${sc} used by ${c.id} and ${seen.get(sc)}`).toBeUndefined();
        seen.set(sc, c.id);
      }
    }
  });

  it('keeps ribbon key tips unique within each tab', () => {
    for (const tab of baseTabs()) {
      const tips = tab.groups.flatMap((g) => g.items.flatMap((i) => ('keytip' in i && i.keytip ? [i.keytip] : [])));
      for (const a of tips) for (const b of tips) if (a !== b) expect(b.startsWith(a), `${tab.id}: ${a} vs ${b}`).toBe(false);
    }
  });

  it('has an English translation for every command label', () => {
    const { registry } = setup();
    const prev = getLocale();
    setLocale('en');
    try {
      const missing = registry
        .all()
        .filter((c) => c.id.startsWith('base.'))
        .filter((c) => t(c.label) === c.label && /[áéíóúñ¿¡]|^(Abrir|Guardar|Tabla|Consulta|Formulario|Informe|Importar|Exportar|Cambiar|Eliminar|Cerrar)/.test(c.label))
        .map((c) => `${c.id}: ${c.label}`);
      expect(missing).toEqual([]);
    } finally {
      setLocale(prev);
    }
  });
});

describe('Nova Base controller', () => {
  it('commands that need a database are disabled until it is loaded', () => {
    const { registry } = setup();
    expect(registry.isEnabled('base.table.new')).toBe(false);
    expect(registry.isEnabled('base.new')).toBe(true);
  });

  it('opens, switches and closes tabs (with a database)', async () => {
    const ctl = new BaseCtl();
    await ctl.init();
    expect(ctl.error).toBeNull();
    ctl.db!.execute('CREATE TABLE A (x INTEGER); CREATE TABLE B (y TEXT)');
    ctl.openTable('A');
    ctl.openTable('B');
    ctl.openTable('A'); // already open: just activated
    expect(ctl.tabs.map((x) => x.name)).toEqual(['A', 'B']);
    expect(ctl.tab!.name).toBe('A');
    ctl.openDesign('B');
    ctl.close(ctl.tab!.id);
    expect(ctl.tabs).toHaveLength(2);
    ctl.rename('table', 'A', 'Alfa');
    expect(ctl.tabs.map((x) => x.name)).toContain('Alfa');
    expect(ctl.db!.tableNames()).toContain('Alfa');
    ctl.remove('table', 'Alfa');
    expect(ctl.tabs.map((x) => x.name)).not.toContain('Alfa');
  });

  it('saves a query under a new name and refuses duplicates', async () => {
    const ctl = new BaseCtl();
    await ctl.init();
    ctl.newQuery('SELECT 1');
    const first = ctl.tab!;
    ctl.saveQuery(first.id, 'Uno');
    expect(ctl.db!.objects('query')).toEqual(['Uno']);
    ctl.newQuery('SELECT 2');
    expect(() => ctl.saveQuery(ctl.tab!.id, 'uno')).toThrow(/Ya existe/);
    ctl.saveQuery(ctl.tab!.id, 'Dos');
    expect(ctl.db!.objects('query')).toEqual(['Dos', 'Uno']);
    expect(ctl.sqlOfQuery('Dos')).toBe('SELECT 2');
  });
});
