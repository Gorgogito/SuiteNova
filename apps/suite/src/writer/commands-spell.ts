import type { CommandDef } from '@suitenova/core-ui';
import type { WriterUI } from './commands';
import { SPELL_LANGS, issuesOf, langOfSelection, noProofOfSelection, setSelectionLang, spellLangTag, toggleNoProof, type SpellLang } from '../spell';

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
  // idioma por texto: el de la selección (o de lo que se escriba), distinto del idioma del documento
  const sel = () => (c.mainView ? langOfSelection(c.mainView.state) : null);
  for (const l of SPELL_LANGS)
    add({
      id: `writer.spell.selLang.${l.id}`,
      label: `Idioma de la selección: ${l.label}`,
      icon: 'globe',
      description: 'Marca el texto seleccionado con este idioma de revisión; se guarda en el archivo .docx.',
      checked: () => sel() === spellLangTag(l.id),
      enabled: () => !!c.mainView && !c.readOnly,
      run: () => c.mainView && setSelectionLang(c.mainView, spellLangTag(l.id)),
    });
  add({
    id: 'writer.spell.selLang.default',
    label: 'Idioma de la selección: el del documento',
    icon: 'globe',
    description: 'Quita el idioma propio del texto seleccionado: vale el idioma del documento.',
    checked: () => sel() === null,
    enabled: () => !!c.mainView && !c.readOnly,
    run: () => c.mainView && setSelectionLang(c.mainView, null),
  });
  add({
    id: 'writer.spell.noProof',
    label: 'No revisar la ortografía ni la gramática',
    icon: 'check',
    description: 'El texto seleccionado no se subraya ni se revisa.',
    checked: () => !!c.mainView && noProofOfSelection(c.mainView.state),
    enabled: () => !!c.mainView && !c.readOnly,
    run: () => c.mainView && toggleNoProof(c.mainView),
  });
  add({ id: 'writer.spell.next', label: 'Siguiente error', icon: 'arrowRight', enabled: () => !!c.mainView && issuesOf(c.mainView).length > 0, run: () => ui.openDialog('spell') });
  return defs;
}
