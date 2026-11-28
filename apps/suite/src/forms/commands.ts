import type { CommandDef } from '@suitenova/core-ui';
import { QTYPES, canShuffle, isInput } from '@suitenova/forms-core';
import { FORM_HEAD, type FormsCtl, type Mode } from './ctl';
import { finishTyping } from './DraftInput';

export type FormsDialog = 'about' | 'shortcuts' | 'settings' | 'collect';

export interface FormsUI {
  ctl: FormsCtl;
  openDialog(kind: FormsDialog): void;
  newWindow(): void;
  open(): Promise<void>;
  importForm(): Promise<void>;
  save(saveAs: boolean): Promise<void>;
  exportHtml(): Promise<void>;
  exportCsv(): Promise<void>;
  importResponses(): Promise<void>;
  close(): void;
}

export const MODES: [Mode, string, string][] = [
  ['design', 'Diseñar', 'edit'],
  ['preview', 'Vista previa', 'eye'],
  ['fill', 'Rellenar y guardar respuestas', 'forms'],
  ['results', 'Resultados', 'chart'],
];

export function formsCommands(ui: FormsUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const q = () => c.selectedQuestion;
  // questions are changed while designing; elsewhere the keys belong to the boxes being filled in
  const designing = () => c.mode === 'design';
  const history = () => c.mode === 'design' || c.mode === 'results';
  const hasQ = () => designing() && !!q();

  // ---- file
  add({ id: 'forms.new', label: 'Formulario nuevo', icon: 'new', shortcut: 'Ctrl+N', run: () => ui.newWindow() });
  add({ id: 'forms.open', label: 'Abrir…', icon: 'open', shortcut: 'Ctrl+O', run: () => void ui.open() });
  add({
    id: 'forms.import',
    label: 'Importar formulario…',
    icon: 'open',
    description: 'Google Forms: la página del formulario guardada como .html. Microsoft Forms y Google Forms: la hoja de respuestas (.xlsx o .csv), de la que se deducen las preguntas y se traen las respuestas.',
    run: () => void ui.importForm(),
  });
  add({ id: 'forms.save', label: 'Guardar', icon: 'save', shortcut: 'Ctrl+S', description: 'Guarda el formulario y sus respuestas como archivo de Nova Forms (.novaforms).', run: () => void ui.save(false) });
  add({ id: 'forms.saveAs', label: 'Guardar como…', icon: 'save', shortcut: 'Ctrl+Shift+S', run: () => void ui.save(true) });
  add({ id: 'forms.export.html', label: 'Exportar formulario como página web…', icon: 'exportFile', description: 'Crea un único archivo .html que se puede rellenar en cualquier navegador. Las respuestas no se envían solas: cada persona descarga un archivo que debes importar.', run: () => void ui.exportHtml() });
  add({ id: 'forms.export.csv', label: 'Exportar respuestas a CSV…', icon: 'exportFile', enabled: () => c.responses.length > 0, run: () => void ui.exportCsv() });
  add({ id: 'forms.collect', label: 'Recoger por la red local…', icon: 'wifi', description: 'Quienes estén en tu red responden desde su navegador y las respuestas llegan solas (aplicación de escritorio).', run: () => ui.openDialog('collect') });
  add({ id: 'forms.responses.import', label: 'Importar respuestas…', icon: 'open', description: 'Añade los archivos de respuesta que te devolvieron (.json) o las de otro archivo .novaforms del mismo formulario.', run: () => void ui.importResponses() });
  add({
    id: 'forms.responses.clear',
    label: 'Eliminar todas las respuestas',
    icon: 'trash',
    enabled: () => c.responses.length > 0,
    run: () => {
      if (window.confirm('¿Eliminar todas las respuestas? Puedes deshacerlo con Ctrl+Z mientras no cierres la ventana.')) c.clearResponses();
    },
  });
  add({ id: 'forms.about', label: 'Acerca de Nova Forms', icon: 'info', run: () => ui.openDialog('about') });
  add({ id: 'help.shortcuts', label: 'Atajos de teclado', icon: 'keyboard', run: () => ui.openDialog('shortcuts') });

  // ---- edit
  add({ id: 'forms.undo', label: 'Deshacer', icon: 'undo', shortcut: 'Ctrl+Z', enabled: () => history() && c.canUndo, run: () => (finishTyping(), c.undo()) });
  add({ id: 'forms.redo', label: 'Rehacer', icon: 'redo', shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: () => history() && c.canRedo, run: () => (finishTyping(), c.redo()) });

  // ---- questions
  for (const t of QTYPES) add({ id: `forms.q.add.${t.id}`, label: t.name, icon: 'plus', run: () => { c.setMode('design'); c.addQuestion(t.id); } });
  add({ id: 'forms.q.duplicate', label: 'Duplicar pregunta', icon: 'copy', shortcut: 'Ctrl+D', enabled: hasQ, run: () => (finishTyping(), c.duplicateQuestion()) });
  add({
    id: 'forms.q.delete',
    label: 'Eliminar pregunta',
    icon: 'trash',
    enabled: hasQ,
    run: () => {
      const q0 = q();
      const n = c.responses.filter((r) => q0 && q0.id in r.answers).length;
      if (n && !window.confirm(`Eliminar la pregunta también borra sus ${n} respuestas guardadas. ¿Continuar?`)) return;
      c.deleteQuestion();
    },
  });
  add({ id: 'forms.q.up', label: 'Mover pregunta hacia arriba', icon: 'moveUp', shortcut: 'Alt+Shift+Up', enabled: () => designing() && c.canMove(-1), run: () => (finishTyping(), c.moveQuestion(-1)) });
  add({ id: 'forms.q.down', label: 'Mover pregunta hacia abajo', icon: 'moveDown', shortcut: 'Alt+Shift+Down', enabled: () => designing() && c.canMove(1), run: () => (finishTyping(), c.moveQuestion(1)) });
  add({ id: 'forms.q.required', label: 'Pregunta obligatoria', icon: 'star', enabled: () => hasQ() && isInput(q()!), checked: () => !!q()?.required, run: () => c.updateQuestion(q()!.id, { required: !q()!.required }) });
  add({ id: 'forms.q.top', label: 'Título y descripción del formulario', icon: 'file', run: () => { c.setMode('design'); c.select(FORM_HEAD); } });

  // ---- form
  add({ id: 'forms.quiz', label: 'Modo cuestionario (con puntuación)', icon: 'checkSquare', checked: () => c.form.quiz, run: () => c.setForm({ quiz: !c.form.quiz }) });
  add({ id: 'forms.showScore', label: 'Mostrar la puntuación al responder', icon: 'eye', enabled: () => c.form.quiz, checked: () => c.form.showScore, description: 'La página web exportada llevará las respuestas correctas dentro del archivo para poder puntuar.', run: () => c.setForm({ showScore: !c.form.showScore }) });

  add({ id: 'forms.showAnswers', label: 'Mostrar las respuestas al terminar', icon: 'eye', enabled: () => c.form.quiz, checked: () => c.form.quiz && !!c.form.showAnswers, description: 'Quien responde ve cada respuesta con la correcta, los comentarios y las explicaciones. La página llevará las respuestas correctas dentro.', run: () => c.setForm({ showAnswers: !c.form.showAnswers || undefined }) });
  add({ id: 'forms.practice', label: 'Modo práctica', icon: 'checkSquare', enabled: () => c.form.quiz, checked: () => c.form.quiz && !!c.form.practice, description: 'Cada respuesta se puede comprobar mientras se responde y volver a intentar. La página llevará las respuestas correctas dentro.', run: () => c.setForm({ practice: !c.form.practice || undefined }) });
  add({ id: 'forms.grade', label: 'Corregir y devolver…', icon: 'edit', description: 'Puntos y comentarios a mano, por persona o por pregunta, y la hoja de devolución de cada persona.', enabled: () => c.form.quiz, run: () => { finishTyping(); c.setResultsView('grade'); c.setMode('results'); } });

  add({ id: 'forms.settings', label: 'Ajustes del formulario…', icon: 'settings', description: 'Plazo, tiempo límite, nombre de quien responde, copia de las respuestas, fondo e idioma.', run: () => ui.openDialog('settings') });

  // ---- pages and order
  const paged = () => !canShuffle(c.form);
  add({ id: 'forms.progress', label: 'Barra de progreso', icon: 'chart', description: 'Con varias secciones, quien responde ve en qué página está.', enabled: paged, checked: () => paged() && !!c.form.progress, run: () => c.setForm({ progress: !c.form.progress || undefined }) });
  add({ id: 'forms.shuffle', label: 'Barajar las preguntas', icon: 'moveDown', description: 'Cada persona ve las preguntas en otro orden. No se puede con secciones; las que dependen de una condición no se mueven.', enabled: () => !paged(), checked: () => !paged() && !!c.form.shuffle, run: () => c.setForm({ shuffle: !c.form.shuffle || undefined }) });
  add({ id: 'forms.hideNumbers', label: 'Ocultar los números', icon: 'eye', description: 'Quien responde ve las preguntas sin numerar.', checked: () => !!c.form.hideNumbers, run: () => c.setForm({ hideNumbers: !c.form.hideNumbers || undefined }) });

  // ---- modes
  for (const [m, label, icon] of MODES) add({ id: `forms.mode.${m}`, label, icon, checked: () => c.mode === m, run: () => c.setMode(m) });
  return defs;
}
