import type { CommandDef } from '@suitenova/core-ui';
import type { BaseCtl, ObjKind } from './ctl';

export type BaseDialog = 'about' | 'shortcuts';

export interface BaseUI {
  ctl: BaseCtl;
  openDialog(kind: BaseDialog): void;
  newWindow(): void;
  open(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  importCsv(): Promise<void>;
  importXlsx(): Promise<void>;
  exportCsv(): Promise<void>;
  startRename(): void;
  /** The object highlighted in the navigation pane. */
  selected(): { kind: ObjKind; name: string } | null;
  printReport(): void;
  close(): void;
}

export function baseCommands(ui: BaseUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.db;
  /** Inside a text box Ctrl+Z belongs to the text box. */
  const editing = (): boolean => {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)));
  };
  const tab = () => c.tab;
  const tableOfTab = (): string | null => {
    const t = tab();
    if (!t) return null;
    if (t.kind === 'table' || t.kind === 'design') return t.name;
    if (t.kind === 'form') return c.forms.get(t.id)?.table ?? null;
    return null;
  };

  /** The table highlighted in the navigation pane wins over the one of the open tab, as in Access. */
  const selectedTable = (): string | null => (ui.selected()?.kind === 'table' ? ui.selected()!.name : null);

  add({ id: 'base.new', label: 'Base de datos nueva', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'base.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'base.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda la base de datos como archivo SQLite (.sqlite).', enabled: ready, run: () => void ui.save(false) });
  add({ id: 'base.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', enabled: ready, run: () => void ui.save(true) });
  add({
    id: 'base.undo',
    label: 'Deshacer',
    icon: 'undo',
    shortcut: 'Ctrl+Z',
    description: 'Deshace el último cambio de datos o de estructura.',
    enabled: () => !!c.db?.canUndo && !editing(),
    run: () => c.undo(),
  });
  add({
    id: 'base.redo',
    label: 'Rehacer',
    icon: 'redo',
    shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'],
    enabled: () => !!c.db?.canRedo && !editing(),
    run: () => c.redo(),
  });
  add({ id: 'base.about', label: 'Acerca de Nova Base', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'help.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', run: () => ui.openDialog('shortcuts') });

  // create
  add({ id: 'base.table.new', label: 'Tabla', icon: 'table', enabled: ready, run: () => c.newTable() });
  add({ id: 'base.query.new', label: 'Consulta SQL', icon: 'search', enabled: ready, run: () => c.newQuery() });
  add({ id: 'base.query.design', label: 'Diseño de consulta', icon: 'table', enabled: ready, run: () => c.newDesignQuery() });
  add({ id: 'base.relations', label: 'Relaciones', icon: 'link', description: 'Ventana de relaciones entre tablas, con integridad referencial y acciones en cascada.', enabled: ready, run: () => c.openRelations() });
  add({
    id: 'base.form.new',
    label: 'Formulario',
    icon: 'forms',
    enabled: () => ready() && c.db!.tableNames().length > 0,
    run: () => c.newForm(selectedTable() ?? tableOfTab() ?? c.db!.tableNames()[0]!),
  });
  add({
    id: 'base.report.new',
    label: 'Informe',
    icon: 'document',
    enabled: () => ready() && c.db!.tableNames().length > 0,
    run: () => {
      const table = selectedTable() ?? tableOfTab() ?? c.db!.tableNames()[0]!;
      void import('@suitenova/base-core').then(({ newReport }) => c.newReport(newReport({ kind: 'table', name: table }, c.db!.columns(table).map((x) => x.name))));
    },
  });

  add({
    id: 'base.report.design',
    label: 'Diseño de informe',
    icon: 'document',
    description: 'Informe de diseño libre: secciones, grupos, totales, gráficos, subinformes y numeración de páginas.',
    enabled: () => ready() && c.db!.tableNames().length > 0,
    run: () => c.newReportDesign(selectedTable() ?? tableOfTab() ?? c.db!.tableNames()[0]!),
  });
  add({
    id: 'base.report.labels',
    label: 'Etiquetas',
    icon: 'document',
    description: 'Hoja de etiquetas (direcciones, productos…) con un registro por etiqueta.',
    enabled: () => ready() && c.db!.tableNames().length > 0,
    run: () => c.newLabelReport(selectedTable() ?? tableOfTab() ?? c.db!.tableNames()[0]!),
  });

  add({ id: 'base.macro.new', label: 'Macro', icon: 'play', description: 'Crea una macro: una lista de acciones con condiciones.', enabled: ready, run: () => c.newMacro() });
  add({ id: 'base.module.new', label: 'Módulo', icon: 'code', description: 'Crea un módulo de código en Nova Basic (un subconjunto de VBA).', enabled: ready, run: () => c.newModule() });

  // home / views
  add({ id: 'base.view.datasheet', label: 'Vista Hoja de datos', icon: 'table', enabled: () => !!tableOfTab() && tab()?.kind !== 'table', run: () => c.openTable(tableOfTab()!) });
  add({ id: 'base.view.design', label: 'Vista Diseño', icon: 'settings', enabled: () => !!tableOfTab() && tab()?.kind !== 'design', run: () => c.openDesign(tableOfTab()!) });
  add({
    id: 'base.object.open',
    label: 'Abrir objeto',
    icon: 'open',
    enabled: () => !!ui.selected(),
    run: () => {
      const s = ui.selected();
      if (!s) return;
      if (s.kind === 'table') c.openTable(s.name);
      else if (s.kind === 'query') c.openQuery(s.name);
      else if (s.kind === 'form') c.openForm(s.name);
      else if (s.kind === 'macro') c.openMacro(s.name);
      else if (s.kind === 'module') c.openModule(s.name);
      else c.openReport(s.name);
    },
  });
  add({ id: 'base.object.design', label: 'Diseño de la tabla', icon: 'settings', enabled: () => ui.selected()?.kind === 'table', run: () => c.openDesign(ui.selected()!.name) });
  add({ id: 'base.object.rename', label: 'Cambiar nombre', icon: 'edit', enabled: () => !!ui.selected(), hint: 'F2', run: () => ui.startRename() });
  add({
    id: 'base.object.delete',
    label: 'Eliminar objeto',
    icon: 'trash',
    enabled: () => !!ui.selected(),
    run: () => {
      const s = ui.selected();
      if (!s) return;
      if (!window.confirm(`¿Eliminar ${s.kind === 'table' ? 'la tabla' : s.kind === 'query' ? 'la consulta' : s.kind === 'form' ? 'el formulario' : s.kind === 'macro' ? 'la macro' : s.kind === 'module' ? 'el módulo' : 'el informe'} "${s.name}"? ${s.kind === 'table' ? 'Podrá deshacerlo con Ctrl+Z.' : 'Esta acción no se puede deshacer.'}`)) return;
      try {
        c.remove(s.kind, s.name);
      } catch (e) {
        window.alert((e as Error).message);
      }
    },
  });
  add({ id: 'base.tab.close', label: 'Cerrar pestaña', icon: 'close', shortcut: 'Ctrl+W', enabled: () => !!tab(), run: () => c.close(tab()!.id) });

  // external data
  add({ id: 'base.import.csv', label: 'Importar texto o CSV…', icon: 'open', enabled: ready, run: () => void ui.importCsv() });
  add({ id: 'base.import.xlsx', label: 'Importar libro de Excel…', icon: 'spreadsheet', enabled: ready, run: () => void ui.importXlsx() });
  add({ id: 'base.export.csv', label: 'Exportar a CSV…', icon: 'exportFile', enabled: () => tab()?.kind === 'table' || (tab()?.kind === 'query' && !!c.results.get(tab()!.id)?.columns.length), run: () => void ui.exportCsv() });
  add({ id: 'base.print', label: 'Imprimir / guardar como PDF…', icon: 'print', shortcut: 'Ctrl+P', enabled: () => tab()?.kind === 'report', run: () => ui.printReport() });

  // tools
  add({
    id: 'base.compact',
    label: 'Compactar y reparar',
    icon: 'reset',
    enabled: ready,
    run: () => {
      try {
        c.db!.execute('VACUUM');
        c.touch();
      } catch (e) {
        window.alert((e as Error).message);
      }
    },
  });
  add({ id: 'base.run', label: 'Ejecutar consulta', icon: 'play', hint: 'Ctrl+Intro', enabled: () => tab()?.kind === 'query', run: () => document.querySelector<HTMLButtonElement>('.bs-query .bs-btn--primary')?.click() });
  return defs;
}
