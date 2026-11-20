import { CommandRegistry, coreCommands, getLocale, setLocale, t, type RibbonItem } from '@suitenova/core-ui';
import { describe, expect, it } from 'vitest';
import { textResult } from '@suitenova/ocr-core';
import { zoomCommands } from '../common';
import { notesCommands, type NotesUI } from './commands';
import { notesCommands2 } from './commands2';
import { NotesCtl } from './ctl';
import './messages';
import './messages-image';
import { notesTabs } from './ribbonDef';

function setup() {
  const ctl = new NotesCtl();
  const ui: NotesUI = {
    ctl,
    openDialog: () => undefined,
    getZoom: () => 100,
    setZoom: () => undefined,
    newWindow: () => undefined,
    open: async () => undefined,
    save: async () => undefined,
    importFile: async () => undefined,
    exportPage: async () => undefined,
    insertImage: () => undefined,
    pictureFromClipboard: () => undefined,
    pictureIcons: () => undefined,
    insertMediaFile: () => undefined,
    insertFile: () => undefined,
    insertPdf: () => undefined,
    screenClip: async () => undefined,
    print: () => undefined,
    dock: async () => undefined,
    docked: () => false,
    toggleRecording: () => undefined,
    recording: () => null,
    runOcr: () => undefined,
    ocrLang: () => 'spa+eng',
    setOcrLang: () => undefined,
    mergeFile: async () => undefined,
    focusSearch: () => undefined,
    close: () => undefined,
  };
  const registry = new CommandRegistry();
  registry.registerAll(coreCommands);
  registry.registerAll(zoomCommands(() => 100, () => undefined, (v) => v));
  registry.registerAll(notesCommands(ui));
  registry.registerAll(notesCommands2(ui));
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

describe('Nova Notes ribbon', () => {
  it('only references commands that exist (no decorative controls)', () => {
    const { ui, registry } = setup();
    const missing: string[] = [];
    for (const tab of notesTabs(ui)) for (const g of tab.groups) for (const id of commandsIn(g.items)) if (!registry.get(id)) missing.push(`${tab.id}/${g.id}: ${id}`);
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
    const { ui } = setup();
    for (const tab of notesTabs(ui)) {
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
        .filter((c) => c.id.startsWith('notes.'))
        .filter((c) => t(c.label) === c.label && /[áéíóúñ¿¡]|^(Insertar|Abrir|Guardar|Nueva|Eliminar|Duplicar|Pegar|Cortar|Copiar|Centrar|Viñetas|Numeración|Imagen|Tabla|Fecha|Hora|Sección)/.test(c.label))
        .map((c) => `${c.id}: ${c.label}`);
      expect(missing).toEqual([]);
    } finally {
      setLocale(prev);
    }
  });
});

describe('Nova Notes controller (without an editor view)', () => {
  it('manages sections and pages', () => {
    const ctl = new NotesCtl();
    expect(ctl.nb.sections).toHaveLength(1);
    ctl.addPage();
    ctl.addPage();
    expect(ctl.section.pages).toHaveLength(3);
    ctl.setTitle('Tercera');
    ctl.movePage(-1);
    expect(ctl.section.pages[1]!.title).toBe('Tercera');
    ctl.duplicatePage();
    expect(ctl.section.pages.map((p) => p.title)).toEqual(['', 'Tercera', 'Tercera (copia)', '']);
    ctl.deletePage();
    expect(ctl.section.pages).toHaveLength(3);
    ctl.addSection();
    ctl.renameSection(ctl.sectionId, 'Ideas');
    expect(ctl.nb.sections.map((s) => s.name)).toEqual(['Sección nueva', 'Ideas']);
    ctl.moveSection(-1);
    expect(ctl.nb.sections.map((s) => s.name)).toEqual(['Ideas', 'Sección nueva']);
    ctl.deleteSection();
    expect(ctl.nb.sections).toHaveLength(1);
    ctl.deleteSection(); // the last section cannot be deleted
    expect(ctl.nb.sections).toHaveLength(1);
  });

  it('the last page of a section is replaced by an empty one instead of leaving none', () => {
    const ctl = new NotesCtl();
    ctl.setTitle('Única');
    ctl.deletePage();
    expect(ctl.section.pages).toHaveLength(1);
    expect(ctl.page.title).toBe('');
  });

  it('searches the notebook', () => {
    const ctl = new NotesCtl();
    ctl.setTitle('Plan de viaje');
    ctl.search('VIAJE');
    expect(ctl.results).toHaveLength(1);
    expect(ctl.showResults).toBe(true);
    ctl.search('');
    expect(ctl.showResults).toBe(false);
  });
});

describe('Nova Notes controller: new features', () => {
  it('puts text boxes anywhere on the page and drops the empty ones', () => {
    const ctl = new NotesCtl();
    const before = ctl.page.containers.length;
    const id = ctl.addTextAt(400, 300);
    expect(ctl.page.containers).toHaveLength(before + 1);
    const c = ctl.page.containers.find((x) => x.id === id)!;
    expect(c.x).toBeGreaterThan(300);
    ctl.dropIfEmpty(id);
    expect(ctl.page.containers.some((x) => x.id === id)).toBe(false);
  });

  it('moves a deleted page to the trash and restores it', () => {
    const ctl = new NotesCtl();
    ctl.addPage();
    ctl.setTitle('Borrable');
    ctl.deletePage();
    expect(ctl.nb.trash).toHaveLength(1);
    ctl.restoreFromTrash(ctl.nb.trash[0]!.id);
    expect(ctl.nb.trash).toHaveLength(0);
    expect(ctl.section.pages.some((p) => p.title === 'Borrable')).toBe(true);
  });

  it('makes subpages and keeps their order', () => {
    const ctl = new NotesCtl();
    ctl.addPage();
    expect(ctl.canIndent(1)).toBe(true);
    ctl.indentPage(1);
    expect(ctl.page.level).toBe(1);
    expect(ctl.pageRows().map((r) => r.depth)).toEqual([0, 1]);
  });

  it('protects a page with a password, locks it and opens it again', async () => {
    const ctl = new NotesCtl();
    ctl.setTitle('Secreta');
    await ctl.protectPage('clave-larga', 'una pista');
    await ctl.lockCurrent('page');
    expect(ctl.page.vault).toBeTruthy();
    expect(JSON.stringify(ctl.nb)).not.toContain('Secreta');
    expect(await ctl.unlock('page', 'incorrecta')).toBe(false);
    expect(await ctl.unlock('page', 'clave-larga')).toBe(true);
    expect(ctl.page.title).toBe('Secreta');
  }, 60_000);

  it('adds a custom tag, groups sections and merges a shared notebook', () => {
    const ctl = new NotesCtl();
    const tag = ctl.addCustomTag('Revisar', '★', '#ff0000', true);
    expect(ctl.isCheckbox(tag.id)).toBe(true);
    const g = ctl.addGroup('Trabajo');
    ctl.moveSectionToGroup(g.id);
    expect(ctl.section.group).toBe(g.id);
    const copy = JSON.parse(JSON.stringify(ctl.nb));
    copy.sections[0].pages.push({ ...ctl.page, id: 'otra', title: 'Del otro equipo', created: Date.now(), modified: Date.now() });
    const r = ctl.mergeFrom(copy);
    expect(r.added).toBe(1);
    expect(ctl.section.pages.some((p) => p.title === 'Del otro equipo')).toBe(true);
  });

  it('finds the text read from an image', () => {
    const ctl = new NotesCtl();
    const asset = ctl.addAsset({ mime: 'image/png', data: 'iVBORw0KGgo=', name: 'factura.png', size: 8 });
    ctl.addImage(asset, 100, 50);
    expect(ctl.ocrPending).toBe(1);
    ctl.search('total a pagar');
    expect(ctl.results).toHaveLength(0);
    return ctl.runOcr(async () => textResult('Total a pagar: 42 €', 'spa'), 'spa').then(() => {
      expect(ctl.ocrPending).toBe(0);
      ctl.search('TOTAL A PAGAR');
      expect(ctl.results[0]?.where).toBe('image');
    });
  });
});

describe('Nova Notes controller: segunda ronda', () => {
  it('mueve y copia páginas entre secciones y combina secciones', () => {
    const ctl = new NotesCtl();
    ctl.setTitle('Uno');
    ctl.addPage();
    ctl.setTitle('Dos');
    ctl.addSection();
    const dest = ctl.sectionId;
    ctl.goTo(ctl.nb.sections[0]!.id, ctl.nb.sections[0]!.pages[1]!.id);
    expect(ctl.canTransfer(dest, false)).toBe(true);
    expect(ctl.transferPage(dest, true)).toBe(true);
    expect(ctl.section.id).toBe(dest);
    expect(ctl.nb.sections[0]!.pages).toHaveLength(2);
    ctl.goTo(ctl.nb.sections[0]!.id, ctl.nb.sections[0]!.pages[1]!.id);
    expect(ctl.transferPage(dest, false)).toBe(true);
    expect(ctl.nb.sections[0]!.pages.map((p) => p.title)).toEqual(['Uno']);
    expect(ctl.nb.sections[1]!.pages.map((p) => p.title)).toEqual(['', 'Dos (copia)', 'Dos']);
    expect(ctl.mergeSectionInto(ctl.nb.sections[0]!.id)).toBe(true);
    expect(ctl.nb.sections).toHaveLength(1);
    expect(ctl.section.pages).toHaveLength(4);
  });

  it('ordena las páginas y crea la nota rápida en su sección', () => {
    const ctl = new NotesCtl();
    ctl.setTitle('Zeta');
    ctl.addPage();
    ctl.setTitle('Alfa');
    ctl.sortPages('title');
    expect(ctl.section.pages.map((p) => p.title)).toEqual(['Alfa', 'Zeta']);
    ctl.quickNote();
    expect(ctl.section.name).toBe('Notas rápidas');
    expect(ctl.section.pages).toHaveLength(1);
    ctl.quickNote();
    expect(ctl.nb.sections.filter((s) => s.name === 'Notas rápidas')).toHaveLength(1);
    expect(ctl.section.pages).toHaveLength(2);
  });

  it('marca las páginas como leídas al abrirlas o editarlas y avisa de las que cambian después', () => {
    const ctl = new NotesCtl();
    ctl.addPage();
    const other = ctl.section.pages[0]!;
    expect(ctl.unreadCount).toBe(0);
    other.modified = Date.now() + 10_000; // lo que traería otro equipo
    expect(ctl.isUnread(other)).toBe(true);
    expect(ctl.unreadCount).toBe(1);
    ctl.goToPage(other.id);
    expect(ctl.unreadCount).toBe(0);
    other.modified += 5_000;
    ctl.addPage();
    expect(ctl.isUnread(other)).toBe(true);
    ctl.markAllSeen();
    expect(ctl.unreadCount).toBe(0);
  });

  it('copia un vínculo a la página y adjunta archivos', () => {
    const ctl = new NotesCtl();
    ctl.setTitle('Destino');
    ctl.copyPageLink();
    expect(ctl.linkClip).toEqual({ href: `#nn:page:${ctl.page.id}`, title: 'Destino' });
    const a = ctl.addAsset({ mime: 'application/pdf', data: 'JVBERi0=', name: 'doc.pdf', size: 5 });
    ctl.addFileAttachment(a);
    expect(ctl.page.containers.some((c) => c.kind === 'file')).toBe(true);
    ctl.search('doc.pdf');
    expect(ctl.results).toHaveLength(1);
  });

  it('inserta y quita espacio en la página y se deshace', () => {
    const ctl = new NotesCtl();
    const id = ctl.addTextAt(100, 400);
    const y0 = ctl.page.containers.find((c) => c.id === id)!.y;
    ctl.insertSpaceAt(200, 120);
    expect(ctl.page.containers.find((c) => c.id === id)!.y).toBe(y0 + 120);
    ctl.insertSpaceAt(200, -60);
    expect(ctl.page.containers.find((c) => c.id === id)!.y).toBe(y0 + 60);
    ctl.undoPage();
    ctl.undoPage();
    expect(ctl.page.containers.find((c) => c.id === id)!.y).toBe(y0);
  });

  it('la goma de punto parte el trazo y la de trazo lo quita; la tinta seleccionada se duplica y se agranda', () => {
    const ctl = new NotesCtl();
    ctl.setTool('pen');
    ctl.addStroke(ctl.newStrokeFrom(Array.from({ length: 21 }, (_, i) => [i * 10, 50]).flat()));
    ctl.setEraserMode('point');
    ctl.erase(100, 50, 6);
    expect(ctl.page.ink).toHaveLength(2);
    ctl.setEraserMode('stroke');
    ctl.erase(10, 50, 6);
    expect(ctl.page.ink).toHaveLength(1);
    ctl.selectStrokes([ctl.page.ink[0]!.id]);
    const w = (): number => ctl.page.ink[0]!.pts[ctl.page.ink[0]!.pts.length - 2]! - ctl.page.ink[0]!.pts[0]!;
    const before = w();
    ctl.scaleSelected(2);
    expect(w()).toBeCloseTo(before * 2, 0);
    ctl.duplicateSelected();
    expect(ctl.page.ink).toHaveLength(2);
    expect(ctl.selectedStrokes).toEqual([ctl.page.ink[1]!.id]);
  });

  it('el lazo elige la tinta que rodea y los trazos de una regla quedan rectos', () => {
    const ctl = new NotesCtl();
    ctl.setTool('pen');
    ctl.addStroke(ctl.newStrokeFrom([100, 100, 120, 110, 140, 100]));
    ctl.addStroke(ctl.newStrokeFrom([500, 500, 520, 510]));
    ctl.selectInLasso([50, 50, 200, 60, 180, 160, 60, 150]);
    expect(ctl.selectedStrokes).toHaveLength(1);
    expect(ctl.ruler).toBeNull();
    ctl.toggleRuler();
    expect(ctl.ruler).not.toBeNull();
    ctl.toggleRuler();
    expect(ctl.ruler).toBeNull();
  });
});
