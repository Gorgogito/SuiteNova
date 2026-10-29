import type { CommandDef } from '@suitenova/core-ui';
import { t } from '@suitenova/core-ui';
import { nodeTypes, ruleLabel } from '@suitenova/writer-core';
import { pickAndRead } from '../fileio';
import type { WriterUI } from './commands';
import { readMergeData } from './mail-data';

/** Envelopes, labels, recipients, merge fields and rules, preview and finishing of a mail merge. */
export function mailCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.mainView && !c.readOnly;
  const hasData = () => !!c.mailMerge && c.mailMerge.records.length > 0;
  const hasFields = () => !!c.mailMerge && c.mailMerge.fields.length > 0;

  add({ id: 'writer.mail.envelope', label: 'Sobres…', icon: 'mail', description: 'Crea un sobre con remitente y destinatario y lo agrega al principio del documento.', enabled: ready, run: () => ui.openDialog('envelope') });
  add({ id: 'writer.mail.labels', label: 'Etiquetas…', icon: 'tag', description: 'Crea una hoja de etiquetas, una por destinatario.', enabled: ready, run: () => ui.openDialog('labels') });

  add({
    id: 'writer.mail.import',
    label: 'Usar una lista existente…',
    icon: 'users',
    description: 'Lee los destinatarios de un archivo CSV o de un libro de Excel (la primera fila son los nombres de los campos).',
    run: async () => {
      const f = await pickAndRead([{ name: 'Datos', extensions: ['csv', 'txt', 'tsv', 'xlsx'] }]).catch(() => null);
      if (!f) return;
      try {
        c.setMergeData(await readMergeData(f.name, f.data));
        ui.openDialog('recipients');
      } catch (e) {
        window.alert(t('No se pudo leer la lista: {error}', { error: (e as Error).message }));
      }
    },
  });
  add({
    id: 'writer.mail.type',
    label: 'Escribir una lista nueva…',
    icon: 'users',
    run: () => {
      if (!c.mailMerge) c.setMergeData({ kind: 'letters', fields: ['Nombre', 'Apellidos', 'Dirección', 'CP', 'Ciudad'], records: [['', '', '', '', '']], source: t('Lista escrita a mano') });
      ui.openDialog('recipients');
    },
  });
  add({ id: 'writer.mail.edit', label: 'Editar lista de destinatarios…', icon: 'users', enabled: () => !!c.mailMerge, run: () => ui.openDialog('recipients') });
  add({ id: 'writer.mail.unlink', label: 'Quitar la lista de destinatarios', icon: 'trash', enabled: () => !!c.mailMerge, run: () => c.setMergeData(null) });

  add({ id: 'writer.mail.field', label: 'Insertar campo combinado…', icon: 'formInput', description: 'Inserta un campo de la lista de destinatarios, como «Nombre».', enabled: () => ready() && hasFields(), run: () => ui.openDialog('mergeField') });
  add({ id: 'writer.mail.address', label: 'Bloque de direcciones…', icon: 'mail', enabled: () => ready() && hasFields(), run: () => ui.openDialog('mergeBlock', { kind: 'address' }) });
  add({ id: 'writer.mail.greeting', label: 'Línea de saludo…', icon: 'quote', enabled: () => ready() && hasFields(), run: () => ui.openDialog('mergeBlock', { kind: 'greeting' }) });
  for (const [rule, label] of [['IF', 'Si… entonces… si no…'], ['SKIPIF', 'Saltar registro si…'], ['NEXTIF', 'Siguiente registro si…']] as const)
    add({ id: `writer.mail.rule.${rule}`, label, icon: 'script', enabled: () => ready() && hasFields(), run: () => ui.openDialog('mergeRule', { rule }) });
  add({
    id: 'writer.mail.rule.NEXT',
    label: 'Siguiente registro',
    icon: 'arrowRight',
    description: 'Pasa al registro siguiente dentro de la misma página (etiquetas y directorios).',
    enabled: ready,
    run: () => {
      const v = c.mainView;
      if (v) v.dispatch(v.state.tr.replaceSelectionWith(nodeTypes.field!.create({ kind: 'merge-rule', arg: 'NEXT', switches: '', result: ruleLabel('NEXT', null) }), false));
    },
  });

  add({
    id: 'writer.mail.preview',
    label: 'Vista previa de resultados',
    icon: 'eye',
    description: 'Muestra los datos del destinatario en lugar de los nombres de los campos.',
    enabled: hasData,
    checked: () => c.mergePreview.on,
    run: () => c.setMergePreview(!c.mergePreview.on),
  });
  const nav = (id: string, label: string, icon: string, to: () => number) =>
    add({ id: `writer.mail.${id}`, label, icon, enabled: () => hasData() && c.mergePreview.on, run: () => c.setMergePreview(true, to()) });
  nav('first', 'Primer registro', 'arrowLeft', () => 0);
  nav('prev', 'Registro anterior', 'arrowLeft', () => c.mergePreview.index - 1);
  nav('next', 'Registro siguiente', 'arrowRight', () => c.mergePreview.index + 1);
  nav('last', 'Último registro', 'arrowRight', () => (c.mailMerge?.records.length ?? 1) - 1);

  add({ id: 'writer.mail.finish', label: 'Finalizar y combinar…', icon: 'mailOpen', description: 'Genera los documentos combinados: los abre aquí o los guarda en un archivo .docx.', enabled: () => hasData() && ready(), run: () => ui.openDialog('finishMerge') });
  return defs;
}
