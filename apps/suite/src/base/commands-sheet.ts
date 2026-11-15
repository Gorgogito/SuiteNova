import type { CommandDef } from '@suitenova/core-ui';
import type { ColumnFilter, FilterOp } from '@suitenova/base-core';
import type { BaseCtl } from './ctl';

/** Datasheet commands: clipboard, sort and filter, records, find, columns and text format. They act on the open datasheet. */
export function sheetCommands(c: BaseCtl): CommandDef[] {
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const tab = () => c.tab;
  const on = (): boolean => !!c.sheetApi && !!tab() && tab()!.kind === 'table' && c.sheetApi.tabId === tab()!.id;
  const sheet = () => c.sheetOf(tab()!);
  const set = (p: Parameters<BaseCtl['setSheet']>[1]) => c.setSheet(tab()!, p);
  const col = () => c.sheetApi?.activeCol ?? null;
  const hasCol = () => on() && col() !== null;
  const dialog = (kind: NonNullable<BaseCtl['sheetDialog']>['kind'], withCol = false) => {
    c.sheetDialog = { kind, ...(withCol && col() ? { col: col()! } : {}) };
    c.touch();
  };
  const visibleCols = () => c.db!.columns(c.sheetApi!.table).filter((x) => !sheet().hidden.includes(x.name));

  // clipboard
  add({ id: 'base.sheet.copy', label: 'Copiar', icon: 'copy', description: 'Copia los registros seleccionados o la celda activa (separados por tabuladores).', enabled: on, run: () => void c.sheetApi!.copy() });
  add({ id: 'base.sheet.cut', label: 'Cortar', icon: 'cut', description: 'Copia y quita: borra la celda activa o elimina los registros seleccionados.', enabled: on, run: () => void c.sheetApi!.copy(true) });
  add({ id: 'base.sheet.paste', label: 'Pegar', icon: 'paste', description: 'Pega texto de celdas (de Excel o de otra hoja de datos) a partir de la celda activa; si sobran filas, se agregan registros.', enabled: on, run: () => void c.sheetApi!.paste() });

  // sort and filter
  add({ id: 'base.sheet.sortAsc', label: 'Ascendente', icon: 'sortAsc', description: 'Ordena por la columna de la celda activa, de menor a mayor.', enabled: hasCol, run: () => set({ sorts: [{ col: col()!, desc: false }] }) });
  add({ id: 'base.sheet.sortDesc', label: 'Descendente', icon: 'sortDesc', description: 'Ordena por la columna de la celda activa, de mayor a menor.', enabled: hasCol, run: () => set({ sorts: [{ col: col()!, desc: true }] }) });
  add({ id: 'base.sheet.sortClear', label: 'Quitar orden', icon: 'filterOff', enabled: () => on() && sheet().sorts.length > 0, run: () => set({ sorts: [] }) });
  add({ id: 'base.sheet.filter', label: 'Filtro…', icon: 'filter', description: 'Filtra la columna de la celda activa por una condición.', enabled: hasCol, run: () => dialog('filter', true) });
  const by = (id: string, op: FilterOp, label: string) =>
    add({
      id: `base.sheet.filterBy.${id}`,
      label,
      icon: 'filter',
      enabled: () => on() && c.sheetApi!.activeValue() !== null && col() !== null,
      run: () => {
        const v = c.sheetApi!.activeValue() ?? '';
        const f: ColumnFilter = v === '' && (op === 'eq' || op === 'ne') ? { col: col()!, op: op === 'eq' ? 'null' : 'notnull' } : { col: col()!, op, value: v };
        set({ filters: [...sheet().filters.filter((x) => !(x.col === f.col && x.op === f.op && x.value === f.value)), f], filterOn: true });
      },
    });
  by('eq', 'eq', 'Es igual a «valor»');
  by('ne', 'ne', 'No es igual a «valor»');
  by('contains', 'contains', 'Contiene «valor»');
  by('notcontains', 'notcontains', 'No contiene «valor»');
  by('begins', 'begins', 'Comienza con «valor»');
  by('ends', 'ends', 'Termina con «valor»');
  by('gt', 'gt', 'Es mayor que «valor»');
  by('lt', 'lt', 'Es menor que «valor»');
  add({ id: 'base.sheet.filterToggle', label: 'Alternar filtro', icon: 'filter', description: 'Activa o desactiva el filtro sin perderlo.', enabled: () => on() && sheet().filters.length > 0, checked: () => on() && sheet().filterOn && sheet().filters.length > 0, run: () => set({ filterOn: !sheet().filterOn }) });
  add({ id: 'base.sheet.filterClear', label: 'Quitar todos los filtros', icon: 'filterOff', enabled: () => on() && sheet().filters.length > 0, run: () => set({ filters: [], filterOn: true }) });

  // records
  add({ id: 'base.sheet.new', label: 'Nuevo', icon: 'rowAdd', description: 'Agrega un registro al final de la tabla.', enabled: on, run: () => c.sheetApi!.newRecord() });
  add({ id: 'base.sheet.delete', label: 'Eliminar', icon: 'trash', description: 'Elimina los registros seleccionados (se pueden recuperar con Deshacer).', enabled: () => on() && c.sheetApi!.selectedRows.length > 0, run: () => c.sheetApi!.deleteSelected() });
  add({ id: 'base.sheet.totals', label: 'Totales', icon: 'sigma', description: 'Muestra u oculta la fila de totales (suma, promedio, cuenta, mínimo y máximo por columna).', enabled: on, checked: () => on() && sheet().showTotals, run: () => set({ showTotals: !sheet().showTotals }) });
  add({ id: 'base.sheet.refresh', label: 'Actualizar todo', icon: 'refresh', enabled: on, run: () => c.sheetApi!.refresh() });

  // find and go to
  add({ id: 'base.sheet.find', label: 'Buscar…', icon: 'find', shortcut: 'Ctrl+F', description: 'Busca texto en las celdas, en el orden y con el filtro de la hoja.', enabled: on, run: () => dialog('find') });
  add({ id: 'base.sheet.replace', label: 'Reemplazar…', icon: 'replace', shortcut: 'Ctrl+H', description: 'Busca texto y lo cambia por otro.', enabled: on, run: () => dialog('replace') });
  for (const [id, label] of [['first', 'Primero'], ['previous', 'Anterior'], ['next', 'Siguiente'], ['last', 'Último'], ['new', 'Nuevo']] as const)
    add({ id: `base.sheet.goto.${id}`, label, icon: 'goto', enabled: on, run: () => c.sheetApi!.goto(id) });

  // columns
  add({ id: 'base.sheet.hide', label: 'Ocultar columna', icon: 'hideCol', description: 'Oculta la columna de la celda activa (los datos no se tocan).', enabled: () => hasCol() && visibleCols().length > 1, run: () => set({ hidden: [...sheet().hidden, col()!] }) });
  add({ id: 'base.sheet.columns', label: 'Mostrar columnas…', icon: 'columns', description: 'Elige qué columnas se ven y cuántas se inmovilizan.', enabled: on, run: () => dialog('columns') });
  add({ id: 'base.sheet.showAll', label: 'Mostrar todas las columnas', icon: 'columns', enabled: () => on() && sheet().hidden.length > 0, run: () => set({ hidden: [] }) });
  add({ id: 'base.sheet.freeze', label: 'Inmovilizar hasta aquí', icon: 'freeze', description: 'Las columnas hasta la activa se quedan en su sitio al desplazarse.', enabled: hasCol, run: () => set({ frozen: visibleCols().findIndex((x) => x.name === col()) + 1 }) });
  add({ id: 'base.sheet.unfreeze', label: 'Liberar las columnas', icon: 'unfreeze', enabled: () => on() && sheet().frozen > 0, run: () => set({ frozen: 0 }) });
  add({ id: 'base.sheet.width', label: 'Ancho de columna…', icon: 'width', enabled: hasCol, run: () => dialog('width', true) });
  add({ id: 'base.sheet.rowHeight', label: 'Altura de fila…', icon: 'rowH', enabled: on, run: () => dialog('rowHeight') });

  // text format
  add({ id: 'base.sheet.fontUp', label: 'Aumentar el tamaño del texto', icon: 'fontUp', enabled: () => on() && sheet().fontSize < 24, run: () => set({ fontSize: sheet().fontSize + 1, rowHeight: Math.max(sheet().rowHeight, sheet().fontSize + 14) }) });
  add({ id: 'base.sheet.fontDown', label: 'Reducir el tamaño del texto', icon: 'fontDown', enabled: () => on() && sheet().fontSize > 9, run: () => set({ fontSize: sheet().fontSize - 1 }) });
  add({ id: 'base.sheet.zebra', label: 'Filas alternas', icon: 'zebra', description: 'Colorea una de cada dos filas.', enabled: on, checked: () => on() && sheet().zebra, run: () => set({ zebra: !sheet().zebra }) });
  add({ id: 'base.sheet.gridlines', label: 'Líneas de cuadrícula', icon: 'gridlines', enabled: on, checked: () => on() && sheet().gridlines, run: () => set({ gridlines: !sheet().gridlines }) });
  return defs;
}
