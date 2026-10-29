import type { CommandDef } from '@suitenova/core-ui';
import type { WriterUI } from './commands';
import { SPELL_LANGS, misspellings } from './spell';

/** Spelling check: dialog, check while typing, language and personal dictionary. */
export function spellCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  add({ id: 'writer.spell.check', label: 'Ortografía', icon: 'spell', shortcut: 'F7', description: 'Revisa la ortografía del documento palabra por palabra.', enabled: () => !!c.mainView && !c.readOnly && c.spellLang !== 'off', run: () => ui.openDialog('spell') });
  add({
    id: 'writer.spell.toggle',
    label: 'Revisar mientras escribe',
    icon: 'check',
    description: 'Subraya en rojo las palabras que no están en el diccionario.',
    checked: () => c.spellLang !== 'off',
    run: () => c.setSpellLang(c.spellLang === 'off' ? (localStorage.getItem('nova.writer.spellLangLast') as 'es' | 'en' | null) ?? 'es' : 'off'),
  });
  add({ id: 'writer.spell.dictionary', label: 'Diccionario personalizado…', icon: 'book', run: () => ui.openDialog('userDict') });
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
  add({ id: 'writer.spell.next', label: 'Siguiente error', icon: 'arrowRight', enabled: () => !!c.mainView && misspellings(c.mainView).length > 0, run: () => ui.openDialog('spell') });
  return defs;
}
