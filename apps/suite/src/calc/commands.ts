import { ICON_COUNTS, defaultIconThresholds, formatValue, isDateFormat, normRect, type CFKind, type CFRule, type IconSetName, type Rect, type Style } from '@suitenova/calc-engine';
import type { CommandDef } from '@suitenova/core-ui';
import { ICON_LABELS, SCALE_PRESETS } from './cfDialogs';
import { objectCommands } from './commands-objects';
import type { CalcDoc } from './doc';

export type DialogKind =
  | 'cfRule'
  | 'cfManager'
  | 'customFilter'
  | 'chartData'
  | 'chartFormat'
  | 'find'
  | 'replace'
  | 'goto'
  | 'format'
  | 'names'
  | 'sort'
  | 'function'
  | 'rowHeight'
  | 'colWidth'
  | 'about'
  | 'shortcuts'
  | 'validation'
  | 'hyperlink'
  | 'note'
  | 'tableCreate'
  | 'tableResize'
  | 'sparkline'
  | 'slicer'
  | 'pivotCreate'
  | 'pivotOptions'
  | 'pivotValue'
  | 'pivotField'
  | 'pageSetup'
  | 'printPreview'
  | 'macros'
  | 'macroEditor';

export interface CalcUI {
  doc: CalcDoc;
  openDialog(kind: DialogKind, arg?: unknown): void;
  getZoom(): number;
  setZoom(z: number): void;
  newWindow(): void;
  open(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  exportCsv(): Promise<void>;
  close(): void;
  /** Hand an address (already checked) to the system. */
  openUrl(url: string): void;
  /** Ask for an image file and put it on the sheet. */
  insertPicture(): Promise<void>;
  /** Give the selected picture the size of its file. */
  restorePictureSize(): Promise<void>;
}

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const FONT_NAMES = ['Calibri', 'Arial', 'Arial Narrow', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

export const PALETTE = [
  ['#000000', '#7f7f7f', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'],
  ['#ffffff', '#d9d9d9', '#f4cccc', '#fce5cd', '#fff2cc', '#ffffcc', '#d9ead3', '#d0e0e3', '#cfe2f3', '#c9daf8', '#d9d2e9', '#ead1dc'],
  ['#f2f2f2', '#bfbfbf', '#ea9999', '#f9cb9c', '#ffe599', '#ffff99', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#a4c2f4', '#b4a7d6', '#d5a6bd'],
];

export function numberFormats(locale: 'es' | 'en'): Record<string, { label: string; code: string | undefined; sample: number }> {
  const es = locale === 'es';
  return {
    general: { label: 'General', code: undefined, sample: 1234.5 },
    number: { label: 'Número', code: '0.00', sample: 1234.5 },
    thousands: { label: 'Número con separador de miles', code: '#,##0.00', sample: 1234.5 },
    currency: { label: 'Moneda', code: es ? '#,##0.00 "€"' : '$#,##0.00', sample: 1234.5 },
    accounting: { label: 'Contabilidad', code: es ? '#,##0.00 "€";(#,##0.00 "€")' : '$#,##0.00;($#,##0.00)', sample: 1234.5 },
    shortDate: { label: 'Fecha corta', code: es ? 'dd/mm/yyyy' : 'm/d/yyyy', sample: 45322 },
    longDate: { label: 'Fecha larga', code: es ? 'dddd, d "de" mmmm "de" yyyy' : 'dddd, mmmm d, yyyy', sample: 45322 },
    time: { label: 'Hora', code: 'hh:mm:ss', sample: 0.7541 },
    percent: { label: 'Porcentaje', code: '0.00%', sample: 0.256 },
    scientific: { label: 'Científica', code: '0.00E+00', sample: 12345.678 },
    text: { label: 'Texto', code: '@', sample: 1234.5 },
  };
}

/** Which named format matches a number-format code (for the dropdown's label). */
export function formatLabel(code: string | undefined, locale: 'es' | 'en'): string {
  if (!code) return 'General';
  for (const f of Object.values(numberFormats(locale))) if (f.code === code) return f.label;
  if (isDateFormat(code)) return 'Fecha';
  if (/%/.test(code)) return 'Porcentaje';
  return 'Personalizada';
}

/** Increase/decrease the number of decimals in a number-format code. */
export function changeDecimals(code: string | undefined, current: number | null, delta: 1 | -1): string {
  let base = code && code !== 'General' ? code : undefined;
  if (!base) {
    const dec = current === null ? 0 : (String(current).split('.')[1]?.length ?? 0);
    const places = Math.max(0, Math.min(30, dec + delta));
    return places === 0 ? '0' : `0.${'0'.repeat(places)}`;
  }
  const first = base.split(';')[0]!;
  const m = /^(.*?)(0|#)(\.([0#]+))?(.*)$/.exec(first);
  if (!m) return base;
  const decimals = m[4]?.length ?? 0;
  const next = Math.max(0, Math.min(30, decimals + delta));
  const rebuilt = `${m[1]}${m[2] === '#' && !m[3] ? '0' : m[2]}${next ? '.' + '0'.repeat(next) : ''}${m[5]}`;
  base = base.replace(first, rebuilt);
  return base;
}

function nextFontSize(cur: number, up: boolean): number {
  if (up) return FONT_SIZES.find((s) => s > cur) ?? cur + 2;
  return [...FONT_SIZES].reverse().find((s) => s < cur) ?? Math.max(1, cur - 1);
}

/** Every command of Nova Calc. All of them act on the document or on the surrounding UI. */
export function calcCommands(ui: CalcUI): CommandDef[] {
  const d = ui.doc;
  const editing = () => !!d.edit;
  const loc = () => d.locale;
  const cmds: CommandDef[] = [];
  const add = (c: CommandDef) => cmds.push(c);

  const style = (): Style => d.currentStyle();

  // ---- file
  add({ id: 'calc.new', label: 'Nuevo libro', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'calc.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({ id: 'calc.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda el libro como archivo de Excel (.xlsx).', run: () => void ui.save(false) });
  add({ id: 'calc.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
  add({ id: 'calc.exportCsv', label: 'Exportar hoja a CSV…', icon: 'exportFile', description: 'Guarda la hoja activa como texto separado por comas.', run: () => void ui.exportCsv() });
  add({ id: 'calc.close', label: 'Cerrar', icon: 'close', run: () => ui.close() });
  add({ id: 'calc.about', label: 'Acerca de Nova Calc', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'calc.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', shortcut: 'F1', run: () => ui.openDialog('shortcuts') });

  // ---- undo / clipboard
  add({ id: 'calc.undo', label: 'Deshacer', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => !editing() && d.canUndo, run: () => d.undo() });
  add({ id: 'calc.redo', label: 'Rehacer', icon: 'redo', shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: () => !editing() && d.canRedo, run: () => d.redo() });

  const copyToSystem = (cut: boolean) => {
    const tsv = d.copy(cut);
    void navigator.clipboard?.writeText(tsv).catch(() => undefined);
  };
  const pasteFromSystem = async (mode: Parameters<CalcDoc['paste']>[1]) => {
    let text: string | null = null;
    try {
      text = (await navigator.clipboard?.readText()) ?? null;
    } catch {
      text = null; // permission denied: fall back to the internal clipboard
    }
    const err = d.paste(text, mode);
    if (err) window.alert(err);
  };
  add({ id: 'calc.copy', label: 'Copiar', icon: 'copy', hint: 'Ctrl+C', enabled: () => !editing(), run: () => copyToSystem(false) });
  add({ id: 'calc.cut', label: 'Cortar', icon: 'cut', hint: 'Ctrl+X', enabled: () => !editing(), run: () => copyToSystem(true) });
  add({ id: 'calc.paste', label: 'Pegar', icon: 'paste', hint: 'Ctrl+V', enabled: () => !editing(), run: () => void pasteFromSystem('all') });
  add({ id: 'calc.pasteValues', label: 'Pegar valores', icon: 'paste', enabled: () => !editing(), run: () => void pasteFromSystem('values') });
  add({ id: 'calc.pasteFormulas', label: 'Pegar fórmulas', icon: 'paste', enabled: () => !editing(), run: () => void pasteFromSystem('formulas') });
  add({ id: 'calc.pasteFormats', label: 'Pegar formato', icon: 'paste', enabled: () => !editing(), run: () => void pasteFromSystem('formats') });
  add({ id: 'calc.pasteTranspose', label: 'Pegar transpuesto', icon: 'paste', enabled: () => !editing(), run: () => void pasteFromSystem('transpose') });

  // ---- font
  const toggles: [string, 'bold' | 'italic' | 'underline' | 'strike', string, string, string][] = [
    ['calc.bold', 'bold', 'Negrita', 'bold', 'Ctrl+B'],
    ['calc.italic', 'italic', 'Cursiva', 'italic', 'Ctrl+I'],
    ['calc.underline', 'underline', 'Subrayado', 'underline', 'Ctrl+U'],
    ['calc.strike', 'strike', 'Tachado', 'strike', 'Ctrl+5'],
  ];
  for (const [id, key, label, icon, sc] of toggles) add({ id, label, icon, shortcut: sc, checked: () => !!style()[key], run: () => d.toggleStyle(key) });
  add({ id: 'calc.fontGrow', label: 'Aumentar tamaño de fuente', icon: 'plus', shortcut: 'Ctrl+Shift+>', run: () => d.applyStyle({ fontSize: nextFontSize(style().fontSize ?? d.wb.defaultFont.size, true) }, 'Tamaño de fuente') });
  add({ id: 'calc.fontShrink', label: 'Disminuir tamaño de fuente', icon: 'minus', shortcut: 'Ctrl+Shift+<', run: () => d.applyStyle({ fontSize: nextFontSize(style().fontSize ?? d.wb.defaultFont.size, false) }, 'Tamaño de fuente') });

  // ---- borders
  const borders: [string, Parameters<CalcDoc['setBorders']>[0], string][] = [
    ['calc.border.all', 'all', 'Todos los bordes'],
    ['calc.border.outer', 'outer', 'Borde exterior'],
    ['calc.border.thick', 'thickOuter', 'Borde exterior grueso'],
    ['calc.border.top', 'top', 'Borde superior'],
    ['calc.border.bottom', 'bottom', 'Borde inferior'],
    ['calc.border.left', 'left', 'Borde izquierdo'],
    ['calc.border.right', 'right', 'Borde derecho'],
    ['calc.border.topBottom', 'topBottom', 'Borde superior e inferior'],
    ['calc.border.none', 'none', 'Sin bordes'],
  ];
  for (const [id, kind, label] of borders) add({ id, label, icon: 'gridlines', run: () => d.setBorders(kind) });

  // ---- alignment
  const aligns: [string, 'left' | 'center' | 'right', string, string, string?][] = [
    ['calc.alignLeft', 'left', 'Alinear a la izquierda', 'alignLeft', 'Ctrl+L'],
    ['calc.alignCenter', 'center', 'Centrar', 'alignCenter', 'Ctrl+E'],
    ['calc.alignRight', 'right', 'Alinear a la derecha', 'alignRight', 'Ctrl+R'],
  ];
  for (const [id, h, label, icon] of aligns) add({ id, label, icon, checked: () => style().hAlign === h, run: () => d.applyStyle({ hAlign: style().hAlign === h ? undefined : h }, 'Alineación') });
  const valigns: [string, 'top' | 'middle' | 'bottom', string, string][] = [
    ['calc.alignTop', 'top', 'Alinear en la parte superior', 'alignTop'],
    ['calc.alignMiddle', 'middle', 'Alinear en el medio', 'alignMiddle'],
    ['calc.alignBottom', 'bottom', 'Alinear en la parte inferior', 'alignBottom'],
  ];
  for (const [id, v, label, icon] of valigns) add({ id, label, icon, checked: () => (style().vAlign ?? 'bottom') === v, run: () => d.applyStyle({ vAlign: v === 'bottom' ? undefined : v }, 'Alineación') });
  add({ id: 'calc.wrap', label: 'Ajustar texto', icon: 'file', checked: () => !!style().wrap, run: () => d.toggleStyle('wrap') });
  add({ id: 'calc.indentMore', label: 'Aumentar sangría', icon: 'indentMore', run: () => d.applyStyle({ indent: (style().indent ?? 0) + 1 }, 'Sangría') });
  add({ id: 'calc.indentLess', label: 'Disminuir sangría', icon: 'indentLess', enabled: () => (style().indent ?? 0) > 0, run: () => d.applyStyle({ indent: Math.max(0, (style().indent ?? 0) - 1) || undefined }, 'Sangría') });
  add({ id: 'calc.mergeCenter', label: 'Combinar y centrar', icon: 'mergeCells', run: () => d.merge(true) });
  add({ id: 'calc.merge', label: 'Combinar celdas', icon: 'merge', run: () => d.merge(false) });
  add({ id: 'calc.unmerge', label: 'Separar celdas', icon: 'unmergeCells', enabled: () => d.activeIsMerged, run: () => d.unmerge() });

  // ---- number formats
  const fmts = () => numberFormats(loc());
  for (const key of Object.keys(numberFormats('es'))) {
    add({
      id: `calc.fmt.${key}`,
      label: fmts()[key]!.label,
      icon: key === 'percent' ? 'percent' : key === 'currency' ? 'euro' : 'table',
      description: `Ejemplo: ${formatValue(fmts()[key]!.sample, fmts()[key]!.code, loc()).text}`,
      checked: () => (style().numFmt ?? undefined) === fmts()[key]!.code,
      run: () => d.applyStyle({ numFmt: fmts()[key]!.code }, 'Formato de número'),
    });
  }
  add({ id: 'calc.percent', label: 'Estilo porcentual', icon: 'percent', shortcut: 'Ctrl+Shift+5', run: () => d.applyStyle({ numFmt: '0%' }, 'Formato de número') });
  add({ id: 'calc.currency', label: 'Formato de moneda', icon: 'euro', shortcut: 'Ctrl+Shift+4', run: () => d.applyStyle({ numFmt: fmts().currency!.code }, 'Formato de número') });
  add({ id: 'calc.thousands', label: 'Estilo millares', icon: 'table', shortcut: 'Ctrl+Shift+1', run: () => d.applyStyle({ numFmt: '#,##0.00' }, 'Formato de número') });
  const currentNumber = () => {
    const v = d.wb.getValue(d.activeSheetId, d.sel.active.row, d.sel.active.col);
    return typeof v === 'number' ? v : null;
  };
  add({ id: 'calc.decMore', label: 'Aumentar decimales', icon: 'plus', run: () => d.applyStyle({ numFmt: changeDecimals(style().numFmt, currentNumber(), 1) }, 'Decimales') });
  add({ id: 'calc.decLess', label: 'Disminuir decimales', icon: 'minus', run: () => d.applyStyle({ numFmt: changeDecimals(style().numFmt, currentNumber(), -1) }, 'Decimales') });
  add({ id: 'calc.formatCells', label: 'Formato de celdas…', icon: 'settings', shortcut: 'Ctrl+1', run: () => ui.openDialog('format') });

  // ---- cells
  add({ id: 'calc.insertRows', label: 'Insertar filas', icon: 'rows', run: () => d.insertRows() });
  add({ id: 'calc.insertCols', label: 'Insertar columnas', icon: 'columns', run: () => d.insertCols() });
  add({ id: 'calc.insertSheet', label: 'Insertar hoja', icon: 'new', shortcut: 'Shift+F11', run: () => d.addSheet() });
  add({ id: 'calc.deleteRows', label: 'Eliminar filas', icon: 'trash', run: () => d.deleteRows() });
  add({ id: 'calc.deleteCols', label: 'Eliminar columnas', icon: 'trash', run: () => d.deleteCols() });
  add({ id: 'calc.deleteSheet', label: 'Eliminar hoja', icon: 'trash', enabled: () => d.wb.sheets.length > 1, run: () => {
    if (window.confirm(`¿Eliminar la hoja "${d.sheet.name}"? Esta acción no se puede deshacer.`)) d.deleteSheet(d.activeSheetId);
  } });
  add({ id: 'calc.rowHeight', label: 'Alto de fila…', icon: 'ruler', run: () => ui.openDialog('rowHeight') });
  add({ id: 'calc.colWidth', label: 'Ancho de columna…', icon: 'ruler', run: () => ui.openDialog('colWidth') });
  add({ id: 'calc.autoFitCols', label: 'Autoajustar ancho de columna', icon: 'ruler', run: () => d.autoFitColumns() });
  add({ id: 'calc.autoFitRows', label: 'Autoajustar alto de fila', icon: 'ruler', run: () => d.run('Autoajustar alto', () => d.wb.editLayout(d.activeSheetId, (s) => d.selectedRows().forEach((r) => s.rowHeights.delete(r)))) });
  add({ id: 'calc.hideRows', label: 'Ocultar filas', icon: 'eye', shortcut: 'Ctrl+9', run: () => d.setHidden('row', true) });
  add({ id: 'calc.showRows', label: 'Mostrar filas', icon: 'eye', shortcut: 'Ctrl+Shift+9', run: () => d.setHidden('row', false) });
  add({ id: 'calc.hideCols', label: 'Ocultar columnas', icon: 'eye', shortcut: 'Ctrl+0', run: () => d.setHidden('col', true) });
  add({ id: 'calc.showCols', label: 'Mostrar columnas', icon: 'eye', shortcut: 'Ctrl+Shift+0', run: () => d.setHidden('col', false) });

  // ---- editing
  const sums: [string, Parameters<CalcDoc['autoSum']>[0], string][] = [
    ['calc.sum', 'SUM', 'Suma'],
    ['calc.average', 'AVERAGE', 'Promedio'],
    ['calc.count', 'COUNT', 'Contar números'],
    ['calc.max', 'MAX', 'Máx'],
    ['calc.min', 'MIN', 'Mín'],
  ];
  for (const [id, fn, label] of sums) add({ id, label, icon: 'sigma', shortcut: fn === 'SUM' ? 'Alt+=' : undefined, run: () => d.autoSum(fn) });
  add({ id: 'calc.fillDown', label: 'Rellenar hacia abajo', icon: 'fillDown', shortcut: 'Ctrl+D', run: () => d.fillDown() });
  add({ id: 'calc.fillRight', label: 'Rellenar hacia la derecha', icon: 'fillRight', shortcut: 'Ctrl+R', run: () => d.fillRight() });
  add({ id: 'calc.clearAll', label: 'Borrar todo', icon: 'eraser', run: () => d.clearAll('all') });
  add({ id: 'calc.clearFormats', label: 'Borrar formatos', icon: 'eraser', run: () => d.clearAll('formats') });
  add({ id: 'calc.clearContents', label: 'Borrar contenido', icon: 'eraser', hint: 'Supr', run: () => d.clearAll('contents') });
  add({ id: 'calc.sortAsc', label: 'Ordenar de A a Z', icon: 'sortAsc', description: 'Ordena por la columna activa, de menor a mayor.', run: () => sortActive(true) });
  add({ id: 'calc.sortDesc', label: 'Ordenar de Z a A', icon: 'sortDesc', run: () => sortActive(false) });
  add({ id: 'calc.sortCustom', label: 'Ordenación personalizada…', icon: 'sortAsc', run: () => ui.openDialog('sort') });
  add({ id: 'calc.removeDup', label: 'Quitar duplicados', icon: 'listFilter', description: 'Elimina las filas repetidas del rango seleccionado.', run: () => {
    const r = d.activeRange;
    const single = r.r1 === r.r2 && r.c1 === r.c2;
    const rect = single ? (d.usedBlock() ?? r) : r;
    const header = window.confirm('¿La primera fila contiene encabezados?');
    const n = d.removeDuplicates(rect, header);
    window.alert(n ? `Se quitaron ${n} valores duplicados.` : 'No se encontraron valores duplicados.');
  } });
  add({ id: 'calc.find', label: 'Buscar…', icon: 'search', shortcut: 'Ctrl+F', run: () => ui.openDialog('find') });
  add({ id: 'calc.replace', label: 'Reemplazar…', icon: 'replace', shortcut: 'Ctrl+H', run: () => ui.openDialog('replace') });
  add({ id: 'calc.goto', label: 'Ir a…', icon: 'search', shortcut: ['Ctrl+G', 'F5'], run: () => ui.openDialog('goto') });

  function sortActive(asc: boolean) {
    const r = d.activeRange;
    const single = r.r1 === r.r2 && r.c1 === r.c2;
    const rect = single ? (d.usedBlock() ?? r) : r;
    const header = single ? d.looksLikeHeader(rect) : false;
    d.sortRange(rect, d.sel.active.col, asc, header);
  }

  // ---- insert tab
  add({ id: 'calc.insertFunction', label: 'Insertar función…', icon: 'fx', shortcut: 'Shift+F3', run: () => ui.openDialog('function') });

  // ---- autofilter
  add({ id: 'calc.filter', label: 'Filtro', icon: 'filter', shortcut: 'Ctrl+Shift+L', description: 'Activa o desactiva los botones de filtro en los encabezados del rango.', checked: () => d.filterActive, run: () => {
    const err = d.toggleAutoFilter();
    if (err) window.alert(err);
  } });
  add({ id: 'calc.filterClear', label: 'Borrar filtros', icon: 'eraser', enabled: () => d.hasColumnFilters, description: 'Quita los criterios de todas las columnas y muestra todas las filas.', run: () => d.clearColumnFilters() });
  add({ id: 'calc.filterReapply', label: 'Volver a aplicar filtro', icon: 'filter', enabled: () => d.filterActive, description: 'Vuelve a evaluar los criterios con los datos actuales.', run: () => d.reapplyFilter() });

  // ---- conditional formatting
  const presets: [string, string, string][] = [
    ['gt', 'Mayor que…', 'cfRule'],
    ['lt', 'Menor que…', 'cfRule'],
    ['between', 'Entre…', 'cfRule'],
    ['eq', 'Igual a…', 'cfRule'],
    ['text', 'Texto que contiene…', 'cfRule'],
    ['dup', 'Valores duplicados…', 'cfRule'],
    ['top', '10 superiores…', 'cfRule'],
    ['bottom', '10 inferiores…', 'cfRule'],
    ['above', 'Por encima del promedio…', 'cfRule'],
    ['below', 'Por debajo del promedio…', 'cfRule'],
    ['new', 'Nueva regla…', 'cfRule'],
  ];
  for (const [preset, label] of presets) add({ id: `calc.cf.${preset}`, label, icon: 'highlighter', run: () => ui.openDialog('cfRule', { preset }) });

  /** Ranges for a one-click rule: the selection, or the data block around a single cell. */
  const cfTarget = (): Rect[] | null => {
    const r = d.activeRange;
    const single = r.r1 === r.r2 && r.c1 === r.c2;
    if (!single) return d.sel.ranges.map((x) => normRect(x));
    const block = d.usedBlock();
    if (!block) {
      window.alert('Selecciona las celdas a las que quieres aplicar el formato.');
      return null;
    }
    return [block];
  };
  const quick = (id: string, label: string, kind: CFKind, icon = 'highlighter') =>
    add({
      id,
      label,
      icon,
      run: () => {
        const ranges = cfTarget();
        if (ranges) d.addCF({ ranges, ...kind } as Omit<CFRule, 'id' | 'priority'>);
      },
    });
  const bars: [string, string, string][] = [['blue', 'Barra de datos azul', '#638ec6'], ['green', 'Barra de datos verde', '#63c384'], ['red', 'Barra de datos roja', '#ff555a'], ['orange', 'Barra de datos naranja', '#ffb628']];
  for (const [k, label, color] of bars) quick(`calc.cf.bar.${k}`, label, { type: 'dataBar', color, min: { type: 'min' }, max: { type: 'max' } });
  for (const [k, sc] of Object.entries(SCALE_PRESETS)) {
    const pos = sc.stops.length === 3 ? [{ type: 'min' as const }, { type: 'percentile' as const, value: 50 }, { type: 'max' as const }] : [{ type: 'min' as const }, { type: 'max' as const }];
    quick(`calc.cf.scale.${k}`, `Escala de color: ${sc.label}`, { type: 'colorScale', stops: sc.stops.map((color, i) => ({ cfvo: pos[i]!, color })) });
  }
  for (const set of Object.keys(ICON_COUNTS) as IconSetName[]) quick(`calc.cf.icons.${set}`, `Iconos: ${ICON_LABELS[set]}`, { type: 'iconSet', set, thresholds: defaultIconThresholds(set) });
  add({ id: 'calc.cf.clearSel', label: 'Borrar reglas de las celdas seleccionadas', icon: 'eraser', enabled: () => d.condFormats.length > 0, run: () => d.clearCF('selection') });
  add({ id: 'calc.cf.clearSheet', label: 'Borrar reglas de toda la hoja', icon: 'eraser', enabled: () => d.condFormats.length > 0, run: () => d.clearCF('sheet') });
  add({ id: 'calc.cf.manage', label: 'Administrar reglas…', icon: 'settings', run: () => ui.openDialog('cfManager') });

  // ---- charts (the kinds are in commands-objects.ts)
  const chart = () => d.chartById(d.selectedChart);
  add({ id: 'calc.chartTitle', label: 'Título del gráfico…', icon: 'file', enabled: () => !!chart(), run: () => {
    const c = chart();
    if (!c) return;
    const title = window.prompt('Título del gráfico (vacío para quitarlo):', c.title ?? '');
    if (title !== null) d.updateChart(c.id, { title: title.trim() || undefined }, 'Título del gráfico');
  } });
  add({ id: 'calc.chartLegend', label: 'Leyenda', icon: 'list', enabled: () => !!chart(), checked: () => !!chart()?.legend, run: () => chart() && d.updateChart(chart()!.id, { legend: !chart()!.legend }, 'Leyenda') });
  add({ id: 'calc.chartStacked', label: 'Apilado', icon: 'rows', enabled: () => !!chart() && ['column', 'bar', 'line', 'area'].includes(chart()!.type), checked: () => !!chart()?.stacked, run: () => chart() && d.updateChart(chart()!.id, { stacked: !chart()!.stacked }, 'Apilar series') });
  add({ id: 'calc.chartSmooth', label: 'Líneas suavizadas', icon: 'chartLine', enabled: () => !!chart() && ['line', 'area'].includes(chart()!.type), checked: () => !!chart()?.smooth, run: () => chart() && d.updateChart(chart()!.id, { smooth: !chart()!.smooth }, 'Suavizar líneas') });
  add({ id: 'calc.chartData', label: 'Seleccionar datos…', icon: 'tableGrid', enabled: () => !!chart(), run: () => ui.openDialog('chartData') });
  add({ id: 'calc.chartDelete', label: 'Eliminar gráfico', icon: 'trash', enabled: () => !!chart(), hint: 'Supr', run: () => d.selectedChart && d.deleteChart(d.selectedChart) });

  // ---- formulas / names / calculation
  add({ id: 'calc.names', label: 'Administrador de nombres…', icon: 'tag', shortcut: 'Ctrl+F3', run: () => ui.openDialog('names') });
  add({ id: 'calc.defineName', label: 'Definir nombre…', icon: 'tag', run: () => {
    const name = window.prompt('Nombre para la selección actual:');
    if (name) {
      const err = d.defineNameForSelection(name.trim());
      if (err) window.alert(err);
    }
  } });
  add({ id: 'calc.showFormulas', label: 'Mostrar fórmulas', icon: 'fx', shortcut: 'Ctrl+`', checked: () => d.showFormulas, run: () => {
    d.showFormulas = !d.showFormulas;
    d.touch();
  } });
  add({ id: 'calc.recalc', label: 'Calcular ahora', icon: 'calculator', shortcut: 'F9', description: 'Vuelve a calcular todas las fórmulas del libro.', run: () => d.wb.recalcAll() });

  // ---- view
  add({ id: 'calc.freezeTop', label: 'Inmovilizar fila superior', icon: 'freeze', run: () => d.freezePanes('top') });
  add({ id: 'calc.freezeFirst', label: 'Inmovilizar primera columna', icon: 'freeze', run: () => d.freezePanes('first') });
  add({ id: 'calc.freezeCursor', label: 'Inmovilizar paneles', icon: 'freeze', run: () => d.freezePanes('cursor') });
  add({ id: 'calc.unfreeze', label: 'Movilizar paneles', icon: 'freeze', enabled: () => d.sheet.freeze.rows > 0 || d.sheet.freeze.cols > 0, run: () => d.freezePanes('none') });
  add({ id: 'calc.gridlines', label: 'Líneas de cuadrícula', icon: 'gridlines', checked: () => d.sheet.showGrid, run: () => d.toggleGridlines() });

  return [...cmds, ...objectCommands(ui)];
}
