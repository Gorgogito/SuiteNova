import type { CommandDef } from '@suitenova/core-ui';
import { ptToPx, setTableOption, setTableStyle, tableStyleInfo } from '@suitenova/writer-core';
import type { Command } from 'prosemirror-state';
import type { WriterUI } from './commands';
import { styleCatalog, type StyleOptions } from '@suitenova/table-core';
import { distributeColumns, findTable, fitColumns } from './table-tools';

/** Propiedades de la tabla, estilos de tabla, ordenar, distribuir columnas y convertir texto ↔ tabla. */
export function tableCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const inTable = () => !!c.state && !!findTable(c.state);
  const exec = (cmd: Command) => {
    const v = c.view;
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  };

  add({ id: 'writer.table.props', label: 'Propiedades de la tabla…', icon: 'settings', description: 'Alineación, borde, márgenes de celda y fila de encabezado.', enabled: inTable, run: () => ui.openDialog('tableProps') });
  add({ id: 'writer.table.sort', label: 'Ordenar…', icon: 'arrowDownAZ', description: 'Ordena las filas de la tabla por una columna.', enabled: inTable, run: () => ui.openDialog('tableSort') });
  add({ id: 'writer.table.formula', label: 'Fórmula…', icon: 'sigma', description: 'Calcula en la celda con SUM, AVERAGE, ARRIBA, IZQUIERDA o A1; como en Word.', enabled: inTable, run: () => ui.openDialog('tableFormula') });
  add({ id: 'writer.table.toText', label: 'Convertir en texto…', icon: 'alignLeft', description: 'Convierte la tabla en párrafos separados por tabulaciones, comas o punto y coma.', enabled: inTable, run: () => ui.openDialog('tableToText') });
  add({ id: 'writer.table.fromText', label: 'Texto a tabla…', icon: 'tableGrid', description: 'Convierte los párrafos seleccionados en una tabla.', enabled: () => !!c.view && !inTable(), run: () => ui.openDialog('textToTable') });
  add({ id: 'writer.table.distribute', label: 'Distribuir columnas', icon: 'colRight', description: 'Da el mismo ancho a todas las columnas.', enabled: inTable, run: () => exec(distributeColumns) });
  add({
    id: 'writer.table.fit',
    label: 'Ajustar a la ventana',
    icon: 'fit',
    description: 'Estira o encoge las columnas para que la tabla ocupe todo el ancho de la página.',
    enabled: inTable,
    run: () => exec(fitColumns(ptToPx(c.page.width - c.page.marginLeft - c.page.marginRight))),
  });

  for (const fam of styleCatalog()) {
    for (const st of fam.styles) {
      add({ id: `writer.table.style.${st.id}`, label: `Estilo de tabla: ${st.name}`, icon: 'gridlines', enabled: inTable, checked: () => !!c.state && tableStyleInfo(c.state)?.styleId === st.id, run: () => exec(setTableStyle(st.id)) });
    }
  }
  const opts: [keyof StyleOptions, string][] = [
    ['firstRow', 'Fila de encabezado'],
    ['lastRow', 'Fila de totales'],
    ['firstCol', 'Primera columna'],
    ['lastCol', 'Última columna'],
    ['bandRows', 'Filas con bandas'],
    ['bandCols', 'Columnas con bandas'],
  ];
  for (const [k, label] of opts) {
    add({ id: `writer.table.opt.${k}`, label, icon: 'check', enabled: inTable, checked: () => !!c.state && !!tableStyleInfo(c.state)?.options[k], run: () => exec(setTableOption(k, !(c.state && tableStyleInfo(c.state)?.options[k]))) });
  }
  return defs;
}
