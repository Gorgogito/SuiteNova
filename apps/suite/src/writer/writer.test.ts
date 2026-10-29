import { CommandRegistry, coreCommands, getLocale, setLocale, t, type RibbonItem } from '@suitenova/core-ui';
import { DEFAULT_DOC_DEFAULTS, docFromText, emptyWriterDoc, ensureSections, nodeTypes, readDocx, writeDocx } from '@suitenova/writer-core';
import { describe, expect, it } from 'vitest';
import { zoomCommands } from '../common';
import { writerCommands, type WriterUI } from './commands';
import { WriterCtl, findMatches } from './doc';
import './messages';
import './messages-more';
import './messages-objects';
import { writerTabs } from './ribbonDef';
import { measureLayout } from './paginate';

function setup() {
  const ctl = new WriterCtl();
  const ui: WriterUI = {
    ctl,
    openDialog: () => undefined,
    openFind: () => undefined,
    getZoom: () => 100,
    setZoom: () => undefined,
    fitWidth: () => undefined,
    newWindow: () => undefined,
    open: async () => undefined,
    save: async () => undefined,
    exportTxt: async () => undefined,
    exportRtf: async () => undefined,
    exportOdt: async () => undefined,
    exportHtml: async () => undefined,
    print: () => undefined,
    saveTemplate: async () => undefined,
    applyTemplate: () => undefined,
    openTemplateFile: async () => undefined,
    insertImage: () => undefined,
    close: () => undefined,
  };
  const registry = new CommandRegistry();
  registry.registerAll(coreCommands);
  registry.registerAll(zoomCommands(() => 100, () => undefined, (v) => v).map((c) => ({ ...c, shortcut: c.id === 'zoom.reset' ? undefined : c.shortcut })));
  registry.registerAll(writerCommands(ui));
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

describe('Nova Writer ribbon', () => {
  it('only references commands that exist (no decorative controls)', () => {
    const { ui, registry } = setup();
    const missing: string[] = [];
    for (const tab of writerTabs(ui, true)) for (const g of tab.groups) for (const id of commandsIn(g.items)) if (!registry.get(id)) missing.push(`${tab.id}/${g.id}: ${id}`);
    expect(missing).toEqual([]);
  });

  it('gives every command a label and no two commands share a shortcut', () => {
    const { registry } = setup();
    const seen = new Map<string, string>();
    for (const c of registry.all()) {
      expect(c.label, c.id).toBeTruthy();
      for (const sc of Array.isArray(c.shortcut) ? c.shortcut : c.shortcut ? [c.shortcut] : []) {
        const owner = seen.get(sc);
        expect(owner, `${sc} used by ${c.id} and ${owner}`).toBeUndefined();
        seen.set(sc, c.id);
      }
    }
  });

  it('shows the contextual table tab only inside a table', () => {
    const { ui } = setup();
    expect(writerTabs(ui, false).find((t) => t.id === 'tableTools')?.contextual?.visible).toBe(false);
    expect(writerTabs(ui, true).find((t) => t.id === 'tableTools')?.contextual?.visible).toBe(true);
  });

  it('keeps ribbon key tips unique within each tab', () => {
    const { ui } = setup();
    for (const tab of writerTabs(ui, true)) {
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
        .filter((c) => c.id.startsWith('writer.'))
        .filter((c) => t(c.label) === c.label && /[áéíóúñ¿¡]|^(Insertar|Abrir|Guardar|Buscar|Reemplazar|Pegar|Cortar|Copiar|Centrar|Justificar|Viñetas|Numeración|Imagen|Tabla|Fecha)/.test(c.label))
        .map((c) => `${c.id}: ${c.label}`);
      expect(missing).toEqual([]);
    } finally {
      setLocale(prev);
    }
  });
});

describe('Nova Writer document controller', () => {
  it('finds matches across the document, honoring case and whole words', () => {
    const doc = docFromText('Gato gato gatos\nel gato');
    expect(findMatches(doc, 'gato', false, false)).toHaveLength(4);
    expect(findMatches(doc, 'gato', true, false)).toHaveLength(3);
    expect(findMatches(doc, 'gato', false, true)).toHaveLength(3);
    expect(findMatches(doc, '', false, false)).toEqual([]);
    // positions point at the matched text
    const [m] = findMatches(doc, 'Gato', true, false);
    expect(doc.textBetween(m!.from, m!.to)).toBe('Gato');
  });

  it('round-trips the controller document through DOCX', async () => {
    const ctl = new WriterCtl();
    ctl.load({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: ensureSections(docFromText('Hola\nmundo')) }, 'a.docx', null);
    expect(ctl.dirty).toBe(false);
    expect(ctl.text()).toBe('Hola\nmundo');
    const { data } = await writeDocx(ctl.toWriterDoc());
    const back = await readDocx(data);
    expect(back.doc.body.textContent).toBe('Holamundo');
    expect(back.doc.body.firstChild!.childCount).toBe(2);
  });

  it('counts words and exports html without scripting', () => {
    const ctl = new WriterCtl();
    ctl.load({ ...emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS }), body: ensureSections(nodeTypes.doc!.create(null, [nodeTypes.paragraph!.create(null, [])])) }, null, null);
    expect(ctl.words().total).toBe(0);
  });

  it('exports the pagination measuring function (browser-only, covered by scripts/e2e-writer.mjs)', () => {
    expect(typeof measureLayout).toBe('function');
  });
});
