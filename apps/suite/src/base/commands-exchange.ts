import type { CommandDef } from '@suitenova/core-ui';
import { saveBytes } from '../fileio';
import type { ExportFormat } from './dlg-exchange';
import type { BaseCtl } from './ctl';

/** Import, export and database tools: other sources, formats, copies of tables, backup and documenter. */
export function exchangeCommands(c: BaseCtl, selectedTable: () => string | null): CommandDef[] {
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.db;
  const open = (kind: NonNullable<BaseCtl['xDialog']>['kind'], arg?: NonNullable<BaseCtl['xDialog']>['arg']) => {
    c.xDialog = { kind, ...(arg ? { arg } : {}) };
    c.touch();
  };
  add({ id: 'base.import.file', label: 'Otros orígenes…', icon: 'open', description: 'Importa un archivo JSON, de texto con separadores o una base de datos SQLite (sus tablas).', enabled: ready, run: () => open('import', { start: 'file' }) });
  add({ id: 'base.import.paste', label: 'Pegar como tabla…', icon: 'paste', description: 'Crea una tabla con el texto del portapapeles (por ejemplo, celdas copiadas de Excel).', enabled: ready, run: () => open('import', { start: 'paste' }) });
  add({ id: 'base.export.dialog', label: 'Exportar…', icon: 'exportFile', description: 'Exporta una tabla o el resultado de una consulta a Excel, texto, JSON, XML, HTML o SQL.', enabled: ready, run: () => open('export') });
  const fmts: [ExportFormat, string][] = [['xlsx', 'Excel'], ['json', 'JSON'], ['xml', 'XML'], ['html', 'HTML'], ['sql', 'Script SQL'], ['tsv', 'Texto con tabuladores']];
  for (const [f, label] of fmts) add({ id: `base.export.${f}`, label, icon: 'exportFile', enabled: ready, run: () => open('export', { format: f }) });
  add({ id: 'base.copyTable', label: 'Copiar tabla…', icon: 'copy', description: 'Copia la tabla seleccionada: estructura y datos, solo estructura, o anexa sus registros a otra tabla.', enabled: () => ready() && !!(selectedTable() ?? (c.tab && (c.tab.kind === 'table' || c.tab.kind === 'design') ? c.tab.name : null)), run: () => open('copyTable', { table: selectedTable() ?? c.tab!.name }) });
  add({
    id: 'base.backup',
    label: 'Copia de seguridad…',
    icon: 'save',
    description: 'Guarda una copia de la base de datos tal como está ahora, con la fecha en el nombre; el archivo que tienes abierto no cambia.',
    enabled: ready,
    run: async () => {
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      const base = (c.fileName ?? 'Base de datos').replace(/\.[^.]+$/, '');
      const out = await saveBytes(`${base}-copia-${stamp}.sqlite`, await c.exportFile(), [{ name: 'Base de datos SQLite', extensions: ['sqlite'] }]);
      if (out) {
        c.notice = `Copia de seguridad guardada: ${out.name}`;
        c.touch();
      }
    },
  });
  add({ id: 'base.module.newclass', label: 'Módulo de clase', icon: 'code', description: 'Crea un módulo de clase: sus procedimientos y propiedades pertenecen a objetos que se crean con New.', enabled: ready, run: () => c.newModule('class') });
  add({ id: 'base.files', label: 'Archivos del código…', icon: 'document', description: 'Los archivos de texto que el código lee y escribe con Open, Print # y Input #: verlos, importar uno, guardar una copia o eliminarlo.', enabled: ready, run: () => open('files') });
  add({ id: 'base.form.wizard', label: 'Asistente de formularios…', icon: 'forms', description: 'Crea un formulario eligiendo la tabla, los campos y la distribución (columnas, tarjetas, hoja de datos o dividido).', enabled: () => ready() && c.db!.tableNames().length > 0, run: () => open('wizForm') });
  add({ id: 'base.query.wizard.dups', label: 'Buscar duplicados…', icon: 'search', description: 'Asistente: lista los registros de una tabla que repiten el valor de uno o varios campos.', enabled: ready, run: () => open('wizDups') });
  add({ id: 'base.query.wizard.unmatched', label: 'Buscar no coincidentes…', icon: 'search', description: 'Asistente: lista los registros de una tabla que no tienen pareja en otra.', enabled: ready, run: () => open('wizUnmatched') });
  add({ id: 'base.document', label: 'Documentador', icon: 'document', description: 'Describe la base de datos entera (tablas, campos, reglas, índices, relaciones y objetos guardados) en un documento.', enabled: ready, run: () => open('document') });
  return defs;
}
