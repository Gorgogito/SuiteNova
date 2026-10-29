import type { CommandDef } from '@suitenova/core-ui';
import { STENCILS, type Arrow, type Dash, type Routing } from '@suitenova/diagram-core';
import type { DiagramCtl } from './ctl';

export type DiagramDialog = 'page' | 'rename' | 'png' | 'about' | 'shortcuts' | 'link' | 'layout';

export interface DiagramUI {
  ctl: DiagramCtl;
  openDialog(kind: DiagramDialog): void;
  newWindow(): void;
  open(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  importVsdx(): Promise<void>;
  exportSvg(): Promise<void>;
  exportVsdx(): Promise<void>;
  print(): void;
  fitPage(): void;
  /** Asks for a picture file and puts it on the page (or on the selected image shapes). */
  insertImage(): void;
  /** Follows a link of a shape: a web address, or another page of the diagram. */
  openLink(shape: { link?: { url?: string; page?: string } }): void;
  exportData(): Promise<void>;
  close(): void;
}

export const FONT_NAMES = ['Segoe UI', 'Calibri', 'Arial', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana'];
export const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 36, 48, 72];
export const WIDTHS = [0.5, 1, 1.5, 2, 3, 4, 6];
export const DASHES: [Dash, string][] = [['solid', 'Continua'], ['dash', 'Guiones'], ['dot', 'Puntos'], ['dashdot', 'Guion y punto']];
export const ROUTINGS: [Routing, string][] = [['straight', 'Recto'], ['elbow', 'En ángulo'], ['curve', 'Curvo']];
export const ARROWS: [Arrow, string][] = [['none', 'Sin flecha'], ['arrow', 'Flecha'], ['open', 'Flecha abierta'], ['diamond', 'Rombo'], ['diamondOpen', 'Rombo vacío'], ['oval', 'Círculo'], ['bar', 'Barra']];

export function diagramCommands(ui: DiagramUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const hasShapes = () => c.selShapes.length > 0;
  const has = () => c.hasSelection;
  const firstFont = () => c.selectedShapes()[0]?.font ?? c.selectedConnectors()[0]?.font ?? null;
  const warn = (m: string | null) => {
    if (m) window.alert(m);
  };

  // ---- file
  add({ id: 'diagram.new', label: 'Diagrama nuevo', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'diagram.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'diagram.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda el diagrama como archivo de Nova Diagram (.novadiagram).', run: () => void ui.save(false) });
  add({ id: 'diagram.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
  add({ id: 'diagram.import.vsdx', label: 'Importar de Visio (.vsdx)…', icon: 'open', description: 'Abre un dibujo de Visio guardado como .vsdx. Los .vsd antiguos no se pueden abrir.', run: () => void ui.importVsdx() });
  add({ id: 'diagram.export.vsdx', label: 'Exportar a Visio (.vsdx)…', icon: 'exportFile', run: () => void ui.exportVsdx() });
  add({ id: 'diagram.export.svg', label: 'Exportar página como SVG…', icon: 'exportFile', run: () => void ui.exportSvg() });
  add({ id: 'diagram.export.png', label: 'Exportar página como imagen PNG…', icon: 'image', run: () => ui.openDialog('png') });
  add({ id: 'diagram.print', label: 'Imprimir / PDF', icon: 'print', shortcut: 'Ctrl+P', run: () => ui.print() });
  add({ id: 'diagram.about', label: 'Acerca de Nova Diagram', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'help.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', run: () => ui.openDialog('shortcuts') });

  // ---- edit
  add({ id: 'diagram.undo', label: 'Deshacer', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => c.canUndo, run: () => c.undo() });
  add({ id: 'diagram.redo', label: 'Rehacer', icon: 'redo', shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: () => c.canRedo, run: () => c.redo() });
  add({ id: 'diagram.cut', label: 'Cortar', icon: 'cut', shortcut: 'Ctrl+X', enabled: has, run: () => c.cut() });
  add({ id: 'diagram.copy', label: 'Copiar', icon: 'copy', shortcut: 'Ctrl+C', enabled: has, run: () => c.copy() });
  add({ id: 'diagram.paste', label: 'Pegar', icon: 'paste', shortcut: 'Ctrl+V', enabled: () => c.canPaste, run: () => c.paste() });
  add({ id: 'diagram.duplicate', label: 'Duplicar', icon: 'copy', shortcut: 'Ctrl+D', enabled: has, run: () => c.duplicate() });
  add({ id: 'diagram.delete', label: 'Eliminar', icon: 'trash', enabled: has, run: () => c.deleteSelection() });
  add({ id: 'diagram.selectAll', label: 'Seleccionar todo', shortcut: 'Ctrl+A', run: () => c.selectAll() });

  // ---- tools
  add({ id: 'diagram.tool.select', label: 'Puntero', icon: 'pointer', checked: () => c.tool === 'select', run: () => c.setTool('select') });
  add({ id: 'diagram.tool.connector', label: 'Conector', icon: 'connector', description: 'Arrastra de una forma a otra para conectarlas.', checked: () => c.tool === 'connector', run: () => c.setTool(c.tool === 'connector' ? 'select' : 'connector') });
  add({ id: 'diagram.connect', label: 'Conectar las dos formas seleccionadas', icon: 'link', enabled: () => c.selShapes.length === 2, run: () => warn(c.connectSelected()) });
  add({ id: 'diagram.edittext', label: 'Editar texto', icon: 'text', shortcut: 'F2', enabled: () => c.selShapes.length + c.selConnectors.length === 1, run: () => c.startEditing(c.selShapes[0] ?? c.selConnectors[0] ?? null) });

  // ---- text
  const toggles: [string, 'bold' | 'italic' | 'underline', string, string, string][] = [
    ['diagram.bold', 'bold', 'Negrita', 'bold', 'Ctrl+B'],
    ['diagram.italic', 'italic', 'Cursiva', 'italic', 'Ctrl+I'],
    ['diagram.underline', 'underline', 'Subrayado', 'underline', 'Ctrl+U'],
  ];
  for (const [id, key, label, icon, sc] of toggles) add({ id, label, icon, shortcut: sc, enabled: has, checked: () => !!firstFont()?.[key], run: () => c.setFont({ [key]: !firstFont()?.[key] }) });
  const aligns: [string, 'left' | 'center' | 'right', string, string][] = [['diagram.alignText.left', 'left', 'Alinear texto a la izquierda', 'alignLeft'], ['diagram.alignText.center', 'center', 'Centrar texto', 'alignCenter'], ['diagram.alignText.right', 'right', 'Alinear texto a la derecha', 'alignRight']];
  for (const [id, a, label, icon] of aligns) add({ id, label, icon, enabled: has, checked: () => firstFont()?.align === a, run: () => c.setFont({ align: a }) });
  const valigns: [string, 'top' | 'middle' | 'bottom', string, string][] = [['diagram.valign.top', 'top', 'Texto arriba', 'alignTop'], ['diagram.valign.middle', 'middle', 'Texto en el centro', 'alignMiddle'], ['diagram.valign.bottom', 'bottom', 'Texto abajo', 'alignBottom']];
  for (const [id, a, label, icon] of valigns) add({ id, label, icon, enabled: has, checked: () => firstFont()?.valign === a, run: () => c.setFont({ valign: a }) });
  add({ id: 'diagram.fontGrow', label: 'Aumentar tamaño de fuente', icon: 'plus', shortcut: 'Ctrl+Shift+>', enabled: has, run: () => c.setFont({ size: Math.min(200, (firstFont()?.size ?? 13) + 1) }) });
  add({ id: 'diagram.fontShrink', label: 'Disminuir tamaño de fuente', icon: 'minus', shortcut: 'Ctrl+Shift+<', enabled: has, run: () => c.setFont({ size: Math.max(4, (firstFont()?.size ?? 13) - 1) }) });

  // ---- shape and line
  add({ id: 'diagram.shadow', label: 'Sombra', icon: 'shadow', enabled: hasShapes, checked: () => !!c.selectedShapes()[0]?.style.shadow, run: () => c.setStyle({ shadow: !c.selectedShapes()[0]?.style.shadow }) });
  for (const [d, label] of DASHES) add({ id: `diagram.dash.${d}`, label: `Línea: ${label.toLowerCase()}`, icon: 'line', enabled: has, checked: () => (c.selectedShapes()[0]?.style.dash ?? c.selectedConnectors()[0]?.dash) === d, run: () => c.setDash(d) });
  for (const w of WIDTHS) add({ id: `diagram.width.${w}`, label: `Grosor de línea: ${w} px`, icon: 'line', enabled: has, checked: () => (c.selectedShapes()[0]?.style.strokeWidth ?? c.selectedConnectors()[0]?.strokeWidth) === w, run: () => c.setStyle({ strokeWidth: w }) });
  for (const [r, label] of ROUTINGS) add({ id: `diagram.routing.${r}`, label: `Conector: ${label.toLowerCase()}`, icon: 'connector', checked: () => (c.selectedConnectors()[0]?.routing ?? c.routing) === r, run: () => c.setRoutingOf(r) });
  for (const [a, label] of ARROWS) {
    add({ id: `diagram.arrowEnd.${a}`, label: `Extremo final: ${label.toLowerCase()}`, icon: 'arrowRight', checked: () => (c.selectedConnectors()[0]?.endArrow ?? c.endArrow) === a, run: () => c.setArrow('end', a) });
    add({ id: `diagram.arrowStart.${a}`, label: `Extremo inicial: ${label.toLowerCase()}`, icon: 'arrowRight', checked: () => (c.selectedConnectors()[0]?.startArrow ?? c.startArrow) === a, run: () => c.setArrow('start', a) });
  }
  add({ id: 'diagram.lock', label: 'Bloquear forma', icon: 'lock', enabled: hasShapes, run: () => c.setLocked(true) });
  add({ id: 'diagram.unlock', label: 'Desbloquear forma', icon: 'unlock', enabled: hasShapes, run: () => c.setLocked(false) });

  // ---- arrange
  add({ id: 'diagram.front', label: 'Traer al frente', icon: 'moveUp', enabled: hasShapes, run: () => c.order('front') });
  add({ id: 'diagram.back', label: 'Enviar al fondo', icon: 'moveDown', enabled: hasShapes, run: () => c.order('back') });
  add({ id: 'diagram.forward', label: 'Traer adelante', icon: 'moveUp', enabled: hasShapes, run: () => c.order('forward') });
  add({ id: 'diagram.backward', label: 'Enviar atrás', icon: 'moveDown', enabled: hasShapes, run: () => c.order('backward') });
  const many = () => c.selShapes.length >= 2;
  const al: [string, 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', string, string][] = [
    ['diagram.align.left', 'left', 'Alinear a la izquierda', 'alignLeft'], ['diagram.align.center', 'center', 'Centrar horizontalmente', 'alignCenter'], ['diagram.align.right', 'right', 'Alinear a la derecha', 'alignRight'],
    ['diagram.align.top', 'top', 'Alinear arriba', 'alignTop'], ['diagram.align.middle', 'middle', 'Centrar verticalmente', 'alignMiddle'], ['diagram.align.bottom', 'bottom', 'Alinear abajo', 'alignBottom'],
  ];
  for (const [id, m, label, icon] of al) add({ id, label, icon, enabled: many, run: () => c.align(m) });
  add({ id: 'diagram.distribute.h', label: 'Distribuir horizontalmente', icon: 'distributeH', enabled: () => c.selShapes.length >= 3, run: () => c.distribute('h') });
  add({ id: 'diagram.distribute.v', label: 'Distribuir verticalmente', icon: 'distributeV', enabled: () => c.selShapes.length >= 3, run: () => c.distribute('v') });
  add({ id: 'diagram.match.w', label: 'Mismo ancho', icon: 'matchW', description: 'Iguala el ancho al de la primera forma seleccionada.', enabled: many, run: () => c.match('w') });
  add({ id: 'diagram.match.h', label: 'Mismo alto', icon: 'matchH', enabled: many, run: () => c.match('h') });
  add({ id: 'diagram.match.both', label: 'Mismo tamaño', icon: 'matchB', enabled: many, run: () => c.match('both') });
  add({ id: 'diagram.rotate.right', label: 'Girar 90° a la derecha', icon: 'rotateRight', enabled: hasShapes, run: () => c.rotate(90) });
  add({ id: 'diagram.rotate.left', label: 'Girar 90° a la izquierda', icon: 'rotateLeft', enabled: hasShapes, run: () => c.rotate(-90) });

  // ---- automatic layout
  const kinds: [string, 'layered' | 'tree' | 'radial' | 'circular' | 'grid' | 'organic', string][] = [
    ['layered', 'layered', 'Diseño jerárquico (por capas)'],
    ['tree', 'tree', 'Diseño de árbol'],
    ['radial', 'radial', 'Diseño radial'],
    ['circular', 'circular', 'Diseño circular'],
    ['grid', 'grid', 'Diseño en cuadrícula'],
    ['organic', 'organic', 'Diseño orgánico'],
  ];
  for (const [id, kind, label] of kinds) add({ id: `diagram.layout.${id}`, label, icon: 'layout', description: 'Ordena las formas seleccionadas (o todas, si hay menos de dos seleccionadas) a partir de los conectores. Es un solo paso de deshacer.', run: () => c.applyLayout(kind) });
  for (const [dir, label] of [['TB', 'Dirección: de arriba abajo'], ['BT', 'Dirección: de abajo arriba'], ['LR', 'Dirección: de izquierda a derecha'], ['RL', 'Dirección: de derecha a izquierda']] as const) {
    add({ id: `diagram.layout.dir.${dir}`, label, icon: 'layout', checked: () => c.layoutOptions.dir === dir, run: () => c.setLayoutDir(dir) });
  }
  add({ id: 'diagram.layout.options', label: 'Opciones del diseño automático…', icon: 'settings', run: () => ui.openDialog('layout') });

  // ---- containers and lanes
  const pool = () => c.selectedPool();
  add({ id: 'diagram.container.wrap', label: 'Rodear con un contenedor', icon: 'container', description: 'Pone un contenedor detrás de las formas seleccionadas. El contenedor las sigue y crece con ellas.', enabled: hasShapes, run: () => c.wrapSelection() });
  for (const [mode, label] of [['never', 'Tamaño del contenedor: el que tú pongas'], ['grow', 'Tamaño del contenedor: crece cuando hace falta'], ['fit', 'Tamaño del contenedor: siempre ajustado']] as const) {
    add({ id: `diagram.container.size.${mode}`, label, icon: 'container', enabled: () => c.selectedContainers().length > 0, checked: () => c.selectedContainers()[0]?.container?.autoSize === mode, run: () => c.setAutoSize(mode) });
  }
  add({ id: 'diagram.lane.add', label: 'Agregar un carril', icon: 'lanes', description: 'Agrega un carril después del último que tocaste de la piscina seleccionada.', enabled: () => !!pool(), run: () => c.addLaneAfter() });
  add({ id: 'diagram.lane.remove', label: 'Quitar el carril', icon: 'trash', description: 'Quita el último carril que tocaste; sus formas pasan al carril vecino.', enabled: () => (pool()?.container?.lanes?.length ?? 0) > 1, run: () => c.removeActiveLane() });

  // ---- groups and layers
  add({ id: 'diagram.group', label: 'Agrupar', icon: 'group', shortcut: 'Ctrl+G', description: 'Une las formas seleccionadas: se seleccionan, mueven, cambian de tamaño y giran juntas.', enabled: () => c.canGroup, run: () => c.group() });
  add({ id: 'diagram.ungroup', label: 'Desagrupar', icon: 'ungroup', shortcut: 'Ctrl+Shift+G', enabled: () => c.canUngroup, run: () => c.ungroup() });
  add({ id: 'diagram.layers.pane', label: 'Capas', icon: 'layers', description: 'Muestra, oculta, bloquea y ordena las capas de la página.', checked: () => c.pane === 'layers', run: () => c.togglePane('layers') });
  add({ id: 'diagram.layer.add', label: 'Capa nueva', icon: 'layers', run: () => c.addLayerNamed() });
  add({ id: 'diagram.layer.assign', label: 'Pasar la selección a la capa activa', icon: 'layers', enabled: has, run: () => c.assignSelectionToLayer(c.basePage.activeLayer ?? c.layers[0]!.id) });

  // ---- mirror, links, data, pictures
  add({ id: 'diagram.flip.h', label: 'Reflejar horizontalmente', icon: 'flipH', description: 'Voltea la forma de izquierda a derecha; el texto no se refleja.', enabled: hasShapes, run: () => c.flip('h') });
  add({ id: 'diagram.flip.v', label: 'Reflejar verticalmente', icon: 'flipV', enabled: hasShapes, run: () => c.flip('v') });
  add({ id: 'diagram.link', label: 'Vínculo…', icon: 'link', shortcut: 'Ctrl+K', description: 'Une la forma a una dirección web o a otra página del diagrama. Ctrl+clic abre el vínculo.', enabled: hasShapes, run: () => ui.openDialog('link') });
  add({ id: 'diagram.link.remove', label: 'Quitar el vínculo', icon: 'trash', enabled: () => c.selectedShapes().some((s) => s.link), run: () => c.setLink(null) });
  add({ id: 'diagram.link.open', label: 'Abrir el vínculo', icon: 'link', enabled: () => !!c.selectedShapes()[0]?.link, run: () => { const s = c.selectedShapes()[0]; if (s) ui.openLink(s); } });
  add({ id: 'diagram.image.insert', label: 'Imagen…', icon: 'image', description: 'Inserta una imagen (PNG, JPEG, GIF, WebP o SVG) en la página.', run: () => ui.insertImage() });
  for (const [fit, label] of [['contain', 'Ajustar la imagen a la forma'], ['cover', 'Rellenar la forma con la imagen'], ['stretch', 'Estirar la imagen']] as const) {
    add({ id: `diagram.image.${fit}`, label, icon: 'image', enabled: () => c.selectedShapes().some((s) => s.image), checked: () => c.selectedShapes()[0]?.image?.fit === fit, run: () => c.setImageFit(fit) });
  }
  add({ id: 'diagram.data.pane', label: 'Datos de forma', icon: 'table', description: 'Muestra y edita los datos de la forma seleccionada. En el texto de una forma, {{nombre}} se sustituye por el dato de ese nombre.', checked: () => c.pane === 'data', run: () => c.togglePane('data') });
  add({ id: 'diagram.data.show', label: 'Mostrar los datos bajo la forma', icon: 'text', enabled: () => c.selectedShapes().some((s) => s.data?.length), checked: () => !!c.selectedShapes()[0]?.showData, run: () => c.setShowData(!c.selectedShapes()[0]?.showData) });
  add({ id: 'diagram.data.export', label: 'Exportar los datos de las formas (CSV)…', icon: 'exportFile', run: () => void ui.exportData() });

  // ---- insert
  for (const s of STENCILS) add({ id: `diagram.add.${s.id}`, label: s.name, icon: 'shapes', run: () => void c.addStencil(s.id) });

  // ---- pages
  add({ id: 'diagram.page.new', label: 'Página nueva', icon: 'pageNew', run: () => c.newPage() });
  add({ id: 'diagram.page.duplicate', label: 'Duplicar página', icon: 'copy', run: () => c.duplicateCurrentPage() });
  add({
    id: 'diagram.page.delete',
    label: 'Eliminar página',
    icon: 'trash',
    enabled: () => c.diagram.pages.length > 1,
    run: () => {
      if (window.confirm('¿Eliminar esta página y todo su contenido?')) c.deleteCurrentPage();
    },
  });
  add({ id: 'diagram.page.rename', label: 'Cambiar nombre de la página…', icon: 'text', run: () => ui.openDialog('rename') });
  add({ id: 'diagram.page.left', label: 'Mover página a la izquierda', icon: 'moveUp', enabled: () => c.diagram.pages[0]?.id !== c.pageId, run: () => c.moveCurrentPage(-1) });
  add({ id: 'diagram.page.right', label: 'Mover página a la derecha', icon: 'moveDown', enabled: () => c.diagram.pages[c.diagram.pages.length - 1]?.id !== c.pageId, run: () => c.moveCurrentPage(1) });
  add({ id: 'diagram.page.setup', label: 'Configurar página…', icon: 'settings', run: () => ui.openDialog('page') });
  add({ id: 'diagram.page.landscape', label: 'Orientación horizontal', icon: 'landscape', checked: () => c.basePage.width >= c.basePage.height, run: () => { const p = c.basePage; if (p.width < p.height) c.setPageProps({ width: p.height, height: p.width }); } });
  add({ id: 'diagram.page.portrait', label: 'Orientación vertical', icon: 'portrait', checked: () => c.basePage.width < c.basePage.height, run: () => { const p = c.basePage; if (p.width >= p.height) c.setPageProps({ width: p.height, height: p.width }); } });

  // ---- view
  add({ id: 'diagram.grid.show', label: 'Mostrar cuadrícula', icon: 'grid', checked: () => c.showGrid, run: () => { c.showGrid = !c.showGrid; c.touch(); } });
  add({ id: 'diagram.grid.snap', label: 'Ajustar a la cuadrícula', icon: 'magnet', checked: () => c.snapToGrid, run: () => { c.snapToGrid = !c.snapToGrid; c.touch(); } });
  add({ id: 'diagram.fit', label: 'Ajustar a la ventana', icon: 'zoomIn', shortcut: 'Ctrl+Shift+H', run: () => ui.fitPage() });
  return defs;
}
