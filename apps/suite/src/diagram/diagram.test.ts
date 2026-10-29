import { CommandRegistry, coreCommands, getLocale, setLocale, t, type RibbonItem } from '@suitenova/core-ui';
import { STENCILS, newConnector, routeOf } from '@suitenova/diagram-core';
import { describe, expect, it } from 'vitest';
import { zoomCommands } from '../common';
import { diagramCommands, type DiagramUI } from './commands';
import { DiagramCtl } from './ctl';
import './messages';
import './messages-more';
import './messages-more2';
import { diagramTabs } from './ribbonDef';

function setup() {
  const ctl = new DiagramCtl();
  const ui: DiagramUI = {
    ctl,
    openDialog: () => undefined,
    newWindow: () => undefined,
    open: async () => undefined,
    save: async () => undefined,
    importVsdx: async () => undefined,
    exportSvg: async () => undefined,
    exportVsdx: async () => undefined,
    print: () => undefined,
    fitPage: () => undefined,
    insertImage: () => undefined,
    openLink: () => undefined,
    exportData: async () => undefined,
    close: () => undefined,
  };
  const registry = new CommandRegistry();
  registry.registerAll(coreCommands);
  registry.registerAll(zoomCommands(() => 100, () => undefined, (v) => v));
  registry.registerAll(diagramCommands(ui));
  registry.register({ id: 'file.close', label: 'Cerrar', run: () => undefined });
  return { ctl, ui, registry };
}

function commandsIn(items: RibbonItem[]): string[] {
  return items.flatMap((i) => {
    if (i.kind === 'button') return [i.command];
    if (i.kind === 'dropdown') return [...(i.primaryCommand ? [i.primaryCommand] : []), ...i.entries.flatMap((e) => (e.kind === 'command' ? [e.command] : []))];
    return [];
  });
}

describe('Nova Diagram ribbon', () => {
  it('only references commands that exist (no decorative controls)', () => {
    const { ui, registry } = setup();
    const missing: string[] = [];
    for (const tab of diagramTabs(ui)) for (const g of tab.groups) for (const id of commandsIn(g.items)) if (!registry.get(id)) missing.push(`${tab.id}/${g.id}: ${id}`);
    expect(missing).toEqual([]);
  });
  it('offers every stencil from the ribbon', () => {
    const { ui } = setup();
    const ids = new Set(diagramTabs(ui).flatMap((t) => t.groups.flatMap((g) => commandsIn(g.items))));
    for (const s of STENCILS) expect(ids.has(`diagram.add.${s.id}`), s.id).toBe(true);
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
    for (const tab of diagramTabs(ui)) {
      const tips = tab.groups.flatMap((g) => g.items.flatMap((i) => ('keytip' in i && i.keytip ? [i.keytip] : [])));
      expect(new Set(tips).size, tab.id).toBe(tips.length);
      for (const a of tips) for (const b of tips) if (a !== b) expect(b.startsWith(a), `${tab.id}: ${a} vs ${b}`).toBe(false);
    }
  });
  it('has an English translation for every command and stencil name', () => {
    const { registry } = setup();
    const prev = getLocale();
    setLocale('en');
    try {
      const missing = registry
        .all()
        .filter((c) => c.id.startsWith('diagram.'))
        .filter((c) => t(c.label) === c.label && /[áéíóúñ¿¡]|^(Insertar|Abrir|Guardar|Nueva|Eliminar|Duplicar|Pegar|Cortar|Copiar|Centrar|Tabla|Fecha|Hora|Puntero|Proceso|Clase|Nodo|Nota|Cruz|Flecha|Nube)/.test(c.label))
        .map((c) => `${c.id}: ${c.label}`);
      expect(missing).toEqual([]);
    } finally {
      setLocale(prev);
    }
  });
});

describe('DiagramCtl', () => {
  it('adds shapes from stencils, selects them and keeps undo history', () => {
    const { ctl } = setup();
    const a = ctl.addStencil('process', { x: 200, y: 200 });
    expect(ctl.basePage.shapes).toHaveLength(1);
    expect(ctl.selShapes).toEqual([a.id]);
    expect(ctl.dirty).toBe(true);
    ctl.undo();
    expect(ctl.basePage.shapes).toHaveLength(0);
    expect(ctl.selShapes).toEqual([]);
    ctl.redo();
    expect(ctl.basePage.shapes).toHaveLength(1);
  });
  it('connects two selected shapes with the current defaults and follows moves', () => {
    const { ctl } = setup();
    const a = ctl.addStencil('process', { x: 200, y: 200 });
    const b = ctl.addStencil('process', { x: 500, y: 200 });
    expect(ctl.connectSelected()).toMatch(/exactamente dos/);
    ctl.setSelection([a.id, b.id]);
    ctl.setRoutingOf('straight');
    expect(ctl.connectSelected()).toBeNull();
    const c = ctl.basePage.connectors[0]!;
    expect(c.routing).toBe('straight');
    expect(c.endArrow).toBe('arrow');
    const before = routeOf(c, ctl.basePage).points;
    ctl.setSelection([b.id]);
    ctl.nudge(80, 0);
    const after = routeOf(ctl.basePage.connectors[0]!, ctl.basePage).points;
    expect(after[1]!.x).toBe(before[1]!.x + 80);
  });
  it('changing routing and arrows applies to the selected connectors, else to the defaults', () => {
    const { ctl } = setup();
    const a = ctl.addStencil('process', { x: 100, y: 100 });
    const b = ctl.addStencil('process', { x: 400, y: 100 });
    ctl.setSelection([a.id, b.id]);
    ctl.connectSelected();
    expect(ctl.selConnectors).toHaveLength(1);
    ctl.setRoutingOf('curve');
    ctl.setArrow('start', 'diamond');
    expect(ctl.basePage.connectors[0]).toMatchObject({ routing: 'curve', startArrow: 'diamond' });
    ctl.clearSelection();
    ctl.setArrow('end', 'oval');
    expect(ctl.endArrow).toBe('oval');
    expect(ctl.basePage.connectors[0]!.endArrow).toBe('arrow');
  });
  it('format changes reach shapes and connectors; text edits are single undo steps', () => {
    const { ctl } = setup();
    const a = ctl.addStencil('process', { x: 100, y: 100 });
    ctl.setStyle({ fill: '#ff0000', strokeWidth: 4 });
    ctl.setFont({ bold: true, size: 20 });
    expect(ctl.basePage.shapes[0]).toMatchObject({ style: { fill: '#ff0000', strokeWidth: 4 }, font: { bold: true, size: 20 } });
    const steps = ctl.canUndo;
    ctl.setText(a.id, 'Hola');
    ctl.setText(a.id, 'Hola');
    expect(ctl.basePage.shapes[0]!.text).toBe('Hola');
    ctl.undo();
    expect(ctl.basePage.shapes[0]!.text).toBe('');
    expect(steps).toBe(true);
  });
  it('gestures preview without history and commit once', () => {
    const { ctl } = setup();
    const a = ctl.addStencil('process', { x: 100, y: 100 });
    const x0 = a.x;
    ctl.previewWith((p) => ({ ...p, shapes: p.shapes.map((s) => ({ ...s, x: s.x + 50 })) }));
    expect(ctl.page.shapes[0]!.x).toBe(x0 + 50);
    expect(ctl.basePage.shapes[0]!.x).toBe(x0);
    ctl.endGesture(false);
    expect(ctl.page.shapes[0]!.x).toBe(x0);
    ctl.previewWith((p) => ({ ...p, shapes: p.shapes.map((s) => ({ ...s, x: s.x + 50 })) }));
    ctl.endGesture(true);
    ctl.undo();
    expect(ctl.basePage.shapes[0]!.x).toBe(x0);
  });
  it('copy, paste (fresh ids, growing offset), cut, duplicate and delete', () => {
    const { ctl } = setup();
    const a = ctl.addStencil('process', { x: 100, y: 100 });
    ctl.copy();
    ctl.paste();
    ctl.paste();
    const xs = ctl.basePage.shapes.map((s) => s.x);
    expect(xs).toEqual([a.x, a.x + 24, a.x + 48]);
    expect(new Set(ctl.basePage.shapes.map((s) => s.id)).size).toBe(3);
    ctl.duplicate();
    expect(ctl.basePage.shapes).toHaveLength(4);
    ctl.cut();
    expect(ctl.basePage.shapes).toHaveLength(3);
    ctl.paste();
    expect(ctl.basePage.shapes).toHaveLength(4);
    ctl.selectAll();
    ctl.deleteSelection();
    expect(ctl.basePage.shapes).toHaveLength(0);
  });
  it('locked shapes cannot be deleted or nudged', () => {
    const { ctl } = setup();
    const a = ctl.addStencil('process', { x: 100, y: 100 });
    ctl.setLocked(true);
    ctl.nudge(40, 0);
    expect(ctl.basePage.shapes[0]!.x).toBe(a.x);
    ctl.deleteSelection();
    expect(ctl.basePage.shapes).toHaveLength(1);
    ctl.setLocked(false);
    ctl.deleteSelection();
    expect(ctl.basePage.shapes).toHaveLength(0);
  });
  it('pages: add, switch, rename, duplicate, delete, reorder', () => {
    const { ctl } = setup();
    ctl.addStencil('process', { x: 100, y: 100 });
    const first = ctl.pageId;
    ctl.newPage();
    expect(ctl.diagram.pages).toHaveLength(2);
    expect(ctl.basePage.shapes).toHaveLength(0);
    ctl.renamePage(ctl.pageId, 'Detalle');
    expect(ctl.basePage.name).toBe('Detalle');
    ctl.renamePage(ctl.pageId, '   ');
    expect(ctl.basePage.name).toBe('Detalle');
    ctl.goToPage(first);
    ctl.duplicateCurrentPage();
    expect(ctl.diagram.pages.map((p) => p.name)).toEqual(['Página 1', 'Página 1 (copia)', 'Detalle']);
    expect(ctl.basePage.shapes).toHaveLength(1);
    ctl.moveCurrentPage(1);
    expect(ctl.diagram.pages[2]!.name).toBe('Página 1 (copia)');
    ctl.deleteCurrentPage();
    expect(ctl.diagram.pages).toHaveLength(2);
    ctl.deleteCurrentPage();
    ctl.deleteCurrentPage();
    expect(ctl.diagram.pages).toHaveLength(1);
  });
  it('alignment needs two shapes, distribution three', () => {
    const { ctl } = setup();
    const ids = [100, 260, 500].map((x, i) => ctl.addStencil('process', { x, y: 100 + i * 50 }).id);
    ctl.setSelection(ids.slice(0, 1));
    ctl.align('left');
    expect(ctl.canUndo).toBe(true);
    ctl.setSelection(ids);
    ctl.align('left');
    expect(new Set(ctl.basePage.shapes.map((s) => s.x)).size).toBe(1);
    ctl.distribute('v');
    const ys = ctl.basePage.shapes.map((s) => s.y);
    expect(ys[1]! - ys[0]!).toBeCloseTo(ys[2]! - ys[1]!);
  });
  it('uses newConnector defaults consistently', () => {
    expect(newConnector({ x: 0, y: 0 }, { x: 5, y: 5 }).endArrow).toBe('arrow');
  });
});
