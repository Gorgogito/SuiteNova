import type { CommandDef } from '@suitenova/core-ui';
import type { Command } from 'prosemirror-state';
import type { WriterUI } from './commands';
import { captureFormat, changeCase, type CaseMode } from './format-tools';

/** Cuadros de Fuente, Párrafo y Símbolo, cambiar mayúsculas, Copiar formato y caracteres especiales. */
export function formatCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.view;
  const exec = (cmd: Command) => {
    const v = c.view;
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  };

  add({ id: 'writer.fontDialog', label: 'Fuente…', icon: 'bold', shortcut: 'Ctrl+D', description: 'Cambia la fuente, el tamaño, el subrayado, los efectos y el espaciado entre caracteres.', enabled: ready, run: () => ui.openDialog('font') });
  add({ id: 'writer.paragraphDialog', label: 'Párrafo…', icon: 'alignLeft', description: 'Sangrías, espaciado, interlineado y paginación del párrafo.', enabled: ready, run: () => ui.openDialog('paragraph') });
  add({ id: 'writer.autocorrect', label: 'Opciones de autocorrección…', icon: 'spell', description: 'Elige qué se corrige mientras escribe: comillas, símbolos, mayúsculas, listas y vínculos.', run: () => ui.openDialog('autocorrect') });
  add({ id: 'writer.styles', label: 'Estilos…', icon: 'paintbrush', description: 'Panel de estilos: aplicar, crear, modificar y eliminar estilos de párrafo.', enabled: ready, run: () => ui.openDialog('styles') });
  add({ id: 'writer.style.new', label: 'Crear un estilo…', icon: 'plus', description: 'Crea un estilo nuevo con el formato del texto seleccionado.', enabled: ready, run: () => ui.openDialog('styleEdit', { id: null }) });
  add({ id: 'writer.style.modify', label: 'Modificar estilo…', icon: 'settings', description: 'Cambia el estilo del párrafo actual; todos los párrafos que lo usan se actualizan.', enabled: ready, run: () => ui.openDialog('styleEdit', { id: c.currentStyleId() }) });
  add({ id: 'writer.style.update', label: 'Actualizar el estilo para que coincida con la selección', icon: 'refresh', enabled: ready, run: () => { c.updateStyleFromSelection(); c.view?.focus(); } });
  add({ id: 'writer.symbol', label: 'Símbolo…', icon: 'hash', description: 'Inserta símbolos y caracteres especiales.', enabled: ready, run: () => ui.openDialog('symbol') });

  const cases: [CaseMode, string][] = [
    ['sentence', 'Tipo oración'],
    ['lower', 'minúsculas'],
    ['upper', 'MAYÚSCULAS'],
    ['title', 'Poner en mayúscula cada palabra'],
    ['toggle', 'aLTERNAR mayúsculas y minúsculas'],
  ];
  for (const [mode, label] of cases) add({ id: `writer.case.${mode}`, label, icon: 'caseSensitive', shortcut: mode === 'upper' ? 'Ctrl+Shift+K' : undefined, enabled: ready, run: () => exec(changeCase(mode)) });

  add({
    id: 'writer.formatPainter',
    label: 'Copiar formato',
    icon: 'paintbrush',
    description: 'Copia el formato del texto seleccionado y lo aplica a lo próximo que seleccione. Un clic más lo cancela.',
    enabled: ready,
    checked: () => !!c.painter,
    run: () => {
      if (c.painter) {
        c.painter = null;
        c.painterSel = null;
      } else if (c.state) {
        c.painter = captureFormat(c.state);
        c.painterSel = { from: c.state.selection.from, to: c.state.selection.to };
      }
      c.touch();
      c.view?.focus();
    },
  });

  const chars: [string, string, string, string?][] = [
    ['nbsp', 'Espacio de no separación', '\u00a0', 'Ctrl+Shift+Space'],
    ['nbhyphen', 'Guion de no separación', '\u2011', 'Ctrl+Shift+-'],
    ['softhyphen', 'Guion opcional', '\u00ad'],
    ['endash', 'Raya corta (–)', '\u2013'],
    ['emdash', 'Raya (—)', '\u2014'],
    ['ellipsis', 'Puntos suspensivos (…)', '\u2026'],
    ['copyright', 'Copyright (©)', '\u00a9'],
    ['registered', 'Marca registrada (®)', '\u00ae'],
    ['trademark', 'Marca comercial (™)', '\u2122'],
  ];
  for (const [id, label, ch, sc] of chars) {
    add({
      id: `writer.char.${id}`,
      label,
      icon: 'hash',
      shortcut: sc,
      enabled: ready,
      run: () => {
        const v = c.view;
        if (!v) return;
        v.dispatch(v.state.tr.insertText(ch).scrollIntoView());
        v.focus();
      },
    });
  }
  return defs;
}
