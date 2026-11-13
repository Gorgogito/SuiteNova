import type { CommandDef } from '@suitenova/core-ui';
import { ptToPx } from '@suitenova/writer-core';
import type { Command } from 'prosemirror-state';
import type { WriterUI } from './commands';
import { applyTableStyle, DEFAULT_STYLE_OPTIONS, distributeColumns, findTable, fitColumns, TABLE_STYLES, type TableStyleOptions } from './table-tools';

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
  const options: TableStyleOptions = { ...DEFAULT_STYLE_OPTIONS };

  add({ id: 'writer.table.props', label: 'Propiedades de la tabla…', icon: 'settings', description: 'Alineación, borde, márgenes de celda y fila de encabezado.', enabled: inTable, run: () => ui.openDialog('tableProps') });
  add({ id: 'writer.table.sort', label: 'Ordenar…', icon: 'arrowDownAZ', description: 'Ordena las filas de la tabla por una columna.', enabled: inTable, run: () => ui.openDialog('tableSort') });
  add({ id: 'writer.table.toText', label: 'Convertir en texto…', icon: 'alignLeft', description: 'Convierte la tabla en párrafos separados por tabulaciones, comas o punto y coma.', enabled: inTable, run: () => ui.openDialog('tableToText') });
  add({ id: 'writer.table.fromText', label: 'Convertir texto en tabla…', icon: 'tableGrid', description: 'Convierte los párrafos seleccionados en una tabla.', enabled: () => !!c.view && !inTable(), run: () => ui.openDialog('textToTable') });
  add({ id: 'writer.table.distribute', label: 'Distribuir columnas', icon: 'colRight', description: 'Da el mismo ancho a todas las columnas.', enabled: inTable, run: () => exec(distributeColumns) });
  add({
    id: 'writer.table.fit',
    label: 'Ajustar a la ventana',
    icon: 'fit',
    description: 'Estira o encoge las columnas para que la tabla ocupe todo el ancho de la página.',
    enabled: inTable,
    run: () => exec(fitColumns(ptToPx(c.page.width - c.page.marginLeft - c.page.marginRight))),
  });

  for (const st of TABLE_STYLES) {
    add({ id: `writer.table.style.${st.id}`, label: `Estilo de tabla: ${st.name}`, icon: 'gridlines', enabled: inTable, run: () => exec(applyTableStyle(st, options)) });
  }
  const opts: [keyof TableStyleOptions, string][] = [
    ['headerRow', 'Fila de encabezado'],
    ['bandedRows', 'Filas con bandas'],
    ['firstCol', 'Primera columna'],
    ['lastRow', 'Fila de totales'],
  ];
  for (const [k, label] of opts) {
    add({
      id: `writer.table.opt.${k}`,
      label,
      icon: 'check',
      enabled: inTable,
      checked: () => options[k],
      run: () => {
        options[k] = !options[k];
        // no hay forma de saber qué estilo tiene la tabla, así que las opciones valen para el próximo estilo que se aplique
        if (c.view) c.view.dispatch(c.view.state.tr);
      },
    });
  }
  return defs;
}
