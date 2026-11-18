import type { CommandDef } from '@suitenova/core-ui';
import type { WriterUI } from './commands';
import { SPELL_LANGS, issuesOf, type SpellLang } from '../spell';

/** Spelling check: dialog, check while typing, language and personal dictionary. */
export function spellCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  add({ id: 'writer.spell.check', label: 'Ortografía y gramática', icon: 'spell', shortcut: 'F7', description: 'Revisa la ortografía, la gramática, la puntuación y el estilo del documento, de un problema en un problema.', enabled: () => !!c.mainView && !c.readOnly && c.spellLang !== 'off', run: () => ui.openDialog('spell') });
  add({
    id: 'writer.spell.toggle',
    label: 'Revisar mientras escribe',
    icon: 'check',
    description: 'Subraya en rojo las palabras que no están en el diccionario y en azul y verde los problemas de gramática, puntuación y estilo.',
    checked: () => c.spellLang !== 'off',
    run: () => c.setSpellLang(c.spellLang === 'off' ? (localStorage.getItem('nova.writer.spellLangLast') as SpellLang | null) ?? 'es' : 'off'),
  });
  add({ id: 'writer.spell.dictionary', label: 'Diccionario personalizado…', icon: 'book', run: () => ui.openDialog('userDict') });
  add({ id: 'writer.spell.pane', label: 'Editor', icon: 'spell', description: 'Muestra a un lado todos los problemas de ortografía, gramática y estilo, con su corrección.', checked: () => c.showEditor, enabled: () => !!c.mainView && c.spellLang !== 'off', run: () => { c.showEditor = !c.showEditor; c.touch(); } });
  add({ id: 'writer.spell.options', label: 'Opciones de revisión…', icon: 'check', description: 'Qué se omite en la ortografía y qué reglas de gramática y estilo se aplican.', run: () => ui.openDialog('reviewOptions') });
  for (const l of SPELL_LANGS)
    add({
      id: `writer.spell.lang.${l.id}`,
      label: l.label,
      icon: 'globe',
      checked: () => c.spellLang === l.id,
      run: () => {
        try {
          localStorage.setItem('nova.writer.spellLangLast', l.id);
        } catch {
          /* no storage */
        }
        c.setSpellLang(l.id);
      },
    });
  add({ id: 'writer.spell.next', label: 'Siguiente error', icon: 'arrowRight', enabled: () => !!c.mainView && issuesOf(c.mainView).length > 0, run: () => ui.openDialog('spell') });
  return defs;
}
