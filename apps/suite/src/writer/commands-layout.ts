import type { CommandDef } from '@suitenova/core-ui';
import { defaultNotesOptions, nodeTypes, type Watermark } from '@suitenova/writer-core';
import type { Command } from 'prosemirror-state';
import type { WriterUI } from './commands';
import { insertSectionBreak, setColumns } from './sections-edit';
import { insertNode, insertPageBreak } from './editing';
import { expandAll, moveHeading, shiftLevel, showLevel, toBodyText, toggleFold } from './outline';

export const WATERMARK_PRESETS: { id: string; text: string }[] = [
  { id: 'confidential', text: 'CONFIDENCIAL' },
  { id: 'draft', text: 'BORRADOR' },
  { id: 'noCopy', text: 'NO COPIAR' },
  { id: 'urgent', text: 'URGENTE' },
  { id: 'sample', text: 'MUESTRA' },
];

export const defaultWatermark = (text: string): Watermark => ({ text, image: null, font: 'Calibri', color: '#c0c0c0', size: 0, semitransparent: true, layout: 'diagonal', scale: 100 });

/** Section, column, watermark, header/footer and view commands. */
export function layoutCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.mainView;
  const exec = (cmd: Command) => {
    const v = c.mainView;
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  };

  // ---- breaks
  add({ id: 'writer.break.page', label: 'Página', icon: 'pageBreak', description: 'Empieza una página nueva en este punto.', enabled: ready, run: () => exec(insertPageBreak()) });
  add({ id: 'writer.break.nextPage', label: 'Salto de sección: página siguiente', icon: 'pageBreak', description: 'Empieza una sección nueva en la página siguiente.', enabled: ready, run: () => exec(insertSectionBreak('nextPage')) });
  add({ id: 'writer.break.continuous', label: 'Salto de sección: continuo', icon: 'pageBreak', description: 'Empieza una sección nueva en la misma página (por ejemplo para cambiar las columnas).', enabled: ready, run: () => exec(insertSectionBreak('continuous')) });
  add({ id: 'writer.break.evenPage', label: 'Salto de sección: página par', icon: 'pageBreak', description: 'La sección nueva empieza en la siguiente página par.', enabled: ready, run: () => exec(insertSectionBreak('evenPage')) });
  add({ id: 'writer.break.oddPage', label: 'Salto de sección: página impar', icon: 'pageBreak', description: 'La sección nueva empieza en la siguiente página impar.', enabled: ready, run: () => exec(insertSectionBreak('oddPage')) });

  // ---- columns
  const cur = () => c.currentSection().props.cols;
  const colsCmd = (id: string, label: string, count: number, widths: ((total: number) => number[]) | null, icon: string) =>
    add({
      id,
      label,
      icon,
      enabled: ready,
      checked: () => !!c.mainView && cur().count === count && (widths ? !!cur().widths : !cur().widths),
      run: () => {
        const page = c.currentSection().props.page;
        const total = page.width - page.marginLeft - page.marginRight;
        const space = count > 1 ? 36 : 36;
        exec(setColumns({ count, space, sep: false, widths: widths ? widths(total - space) : null }, true));
      },
    });
  colsCmd('writer.columns.1', 'Una', 1, null, 'columns1');
  colsCmd('writer.columns.2', 'Dos', 2, null, 'columns2');
  colsCmd('writer.columns.3', 'Tres', 3, null, 'columns3');
  colsCmd('writer.columns.left', 'Izquierda', 2, (w) => [w / 3, (w * 2) / 3], 'columns2');
  colsCmd('writer.columns.right', 'Derecha', 2, (w) => [(w * 2) / 3, w / 3], 'columns2');
  add({ id: 'writer.columns.more', label: 'Más columnas…', icon: 'columns2', enabled: ready, run: () => ui.openDialog('columns') });

  // ---- watermark
  for (const w of WATERMARK_PRESETS) {
    add({ id: `writer.watermark.${w.id}`, label: w.text.charAt(0) + w.text.slice(1).toLowerCase(), icon: 'droplet', enabled: ready, checked: () => c.watermark?.text === w.text, run: () => c.setWatermark(defaultWatermark(w.text)) });
  }
  add({ id: 'writer.watermark.custom', label: 'Marca de agua personalizada…', icon: 'droplet', enabled: ready, run: () => ui.openDialog('watermark') });
  add({ id: 'writer.watermark.remove', label: 'Quitar marca de agua', icon: 'trash', enabled: () => !!c.watermark, run: () => c.setWatermark(null) });

  // ---- header and footer editing (contextual tab)
  const inHF = () => !!c.hfEdit;
  const insertHF = (id: string, label: string, kind: string, icon: string) => add({ id, label, icon, enabled: inHF, run: () => { const v = c.view; if (!v) return; insertNode(nodeTypes.field!.create({ kind }))(v.state, v.dispatch); v.focus(); } });
  insertHF('writer.hf.pageNumber', 'Número de página', 'page', 'hash');
  insertHF('writer.hf.pages', 'Total de páginas', 'pages', 'hash');
  insertHF('writer.hf.date', 'Fecha', 'date', 'calendar');
  insertHF('writer.hf.time', 'Hora', 'time', 'clock');
  insertHF('writer.hf.section', 'Número de sección', 'section', 'hash');
  add({ id: 'writer.hf.close', label: 'Cerrar encabezado y pie de página', icon: 'x', enabled: inHF, run: () => c.endHFEdit() });
  add({
    id: 'writer.hf.firstPage',
    label: 'Primera página diferente',
    icon: 'file',
    enabled: inHF,
    checked: () => !!c.hfEdit && c.sections()[c.hfEdit.section]?.props.titlePg === true,
    run: () => {
      const e = c.hfEdit;
      if (!e) return;
      const s = c.sections()[e.section]!;
      c.setSectionProps(e.section, { titlePg: !s.props.titlePg });
      // the page that was being edited may now use another variant
      const page = c.pageSpecs[e.page];
      if (page) c.hfEdit = { ...e, variant: c.variantFor(page) };
      c.touch();
    },
  });
  add({
    id: 'writer.hf.evenOdd',
    label: 'Páginas pares e impares diferentes',
    icon: 'file',
    enabled: inHF,
    checked: () => c.evenAndOdd,
    run: () => {
      c.evenAndOdd = !c.evenAndOdd;
      c.dirty = true;
      const e = c.hfEdit;
      const page = e && c.pageSpecs[e.page];
      if (e && page) c.hfEdit = { ...e, variant: c.variantFor(page) };
      c.touch();
    },
  });
  add({
    id: 'writer.hf.linkPrev',
    label: 'Vincular al anterior',
    icon: 'link',
    enabled: () => !!c.hfEdit && c.hfEdit.section > 0,
    checked: () => !!c.hfEdit && !c.hasOwnPart(c.hfEdit.section, c.hfEdit.kind, c.hfEdit.variant),
    run: () => {
      const e = c.hfEdit;
      if (!e) return;
      const linked = !c.hasOwnPart(e.section, e.kind, e.variant);
      c.setLinkToPrevious(e.section, e.kind, e.variant, !linked);
      // restart the editor on the part it now shows
      const keep = c.hfEdit;
      c.hfEdit = null;
      c.activeView = null;
      c.touch();
      queueMicrotask(() => {
        c.hfEdit = keep;
        c.touch();
      });
    },
  });
  add({ id: 'writer.hf.goFooter', label: 'Ir al pie de página', icon: 'panelBottom', enabled: inHF, run: () => c.switchHF('footer') });
  add({ id: 'writer.hf.goHeader', label: 'Ir al encabezado', icon: 'panelTop', enabled: inHF, run: () => c.switchHF('header') });
  add({ id: 'writer.hf.prev', label: 'Anterior', icon: 'chevronUp', enabled: inHF, run: () => c.stepHF(-1) });
  add({ id: 'writer.hf.next', label: 'Siguiente', icon: 'chevronDown', enabled: inHF, run: () => c.stepHF(1) });
  add({ id: 'writer.hf.removeHeader', label: 'Quitar encabezado', icon: 'trash', enabled: inHF, run: () => c.hfEdit && c.setPart(c.hfEdit.section, 'header', c.hfEdit.variant, null) });

  // ---- views
  const views: [string, 'print' | 'web' | 'outline' | 'draft', string, string][] = [
    ['writer.view.print', 'print', 'Diseño de impresión', 'file'],
    ['writer.view.web', 'web', 'Diseño web', 'globe'],
    ['writer.view.outline', 'outline', 'Esquema', 'list'],
    ['writer.view.draft', 'draft', 'Borrador', 'document'],
  ];
  for (const [id, mode, label, icon] of views) add({ id, label, icon, checked: () => c.viewMode === mode, run: () => c.setViewMode(mode) });
  add({ id: 'writer.view.ruler', label: 'Regla', icon: 'ruler', checked: () => c.showRuler, run: () => { c.showRuler = !c.showRuler; c.touch(); } });
  add({ id: 'writer.view.nav', label: 'Panel de navegación', icon: 'panelLeft', checked: () => c.showNav, run: () => { c.showNav = !c.showNav; c.touch(); } });

  // ---- outline view
  const outline = () => c.viewMode === 'outline';
  add({ id: 'writer.outline.promote', label: 'Subir de nivel', icon: 'arrowLeft', enabled: outline, run: () => exec(shiftLevel(-1)) });
  add({ id: 'writer.outline.demote', label: 'Bajar de nivel', icon: 'arrowRight', enabled: outline, run: () => exec(shiftLevel(1)) });
  add({ id: 'writer.outline.body', label: 'Convertir en texto independiente', icon: 'textType', enabled: outline, run: () => exec(toBodyText) });
  add({ id: 'writer.outline.up', label: 'Subir', icon: 'chevronUp', enabled: outline, run: () => exec(moveHeading(-1)) });
  add({ id: 'writer.outline.down', label: 'Bajar', icon: 'chevronDown', enabled: outline, run: () => exec(moveHeading(1)) });
  add({ id: 'writer.outline.toggle', label: 'Expandir o contraer', icon: 'chevronDown', enabled: outline, run: () => exec(toggleFold) });
  add({ id: 'writer.outline.expandAll', label: 'Expandir todo', icon: 'chevronDown', enabled: outline, run: () => exec(expandAll()) });
  for (let n = 1; n <= 6; n++) add({ id: `writer.outline.level.${n}`, label: `Mostrar nivel ${n}`, icon: 'list', enabled: outline, run: () => exec(showLevel(n)) });
  add({ id: 'writer.outline.close', label: 'Cerrar vista Esquema', icon: 'x', enabled: outline, run: () => c.setViewMode('print') });

  void defaultNotesOptions;
  return defs;
}
