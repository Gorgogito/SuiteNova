import { registerMessages } from '@suitenova/core-ui';

// English: "as late as possible", leveling, resource and task calendars, time zone, Project XML extras, report export,
// live subprojects and earned value by distribution.
registerMessages('en', {
  // ---- constraint
  'Lo más tarde posible': 'As late as possible',
  // ---- fields and task form
  Prioridad: 'Priority',
  'Retraso por nivelación': 'Leveling delay',
  'Prioridad (0–1000; la nivelación retrasa primero las de menor prioridad)': 'Priority (0–1000; leveling delays the lower ones first)',
  'La prioridad debe estar entre 0 y 1000 (500 es la normal).': 'Priority must be between 0 and 1000 (500 is normal).',
  // ---- leveling
  'Nivelar recursos…': 'Level resources…',
  'Nivelar recursos': 'Level resources',
  'Resuelve las sobreasignaciones retrasando tareas de menor prioridad.': 'Solves over-allocations by delaying lower-priority tasks.',
  'Borrar nivelación': 'Clear leveling',
  'Quita los retrasos que añadió la nivelación.': 'Removes the delays that leveling added.',
  Nivelación: 'Leveling',
  'Recursos sobreasignados: {n}.': 'Over-allocated resources: {n}.',
  'Ningún recurso está sobreasignado ahora.': 'No resource is over-allocated now.',
  'Se retrasan primero las tareas de menor prioridad y, a igual prioridad, las que empiezan más tarde. No se mueven las tareas ya iniciadas ni las programadas manualmente.': 'Lower-priority tasks are delayed first and, at equal priority, the ones that start later. Tasks already under way and manually scheduled ones are never moved.',
  'Qué tareas se pueden retrasar': 'Which tasks may be delayed',
  'Todo el proyecto': 'The whole project',
  'Solo las tareas seleccionadas': 'Only the selected tasks',
  'Solo dentro de la holgura (no retrasa el fin del proyecto)': 'Only within the slack (does not push the end of the project)',
  'Conservar los retrasos de una nivelación anterior': 'Keep the delays of an earlier leveling',
  'Selecciona alguna tarea o nivela todo el proyecto.': 'Select some tasks or level the whole project.',
  'Nivelación hecha: {n} tareas con retraso.': 'Leveling done: {n} tasks delayed.',
  'No hizo falta retrasar ninguna tarea.': 'No task needed to be delayed.',
  'Se quitaron los retrasos de nivelación.': 'The leveling delays were removed.',
  // ---- project options
  'Cómo se programa': 'How the plan is scheduled',
  'La tarea espera a los calendarios de sus recursos (solo avanza cuando el calendario de la tarea y el de algún recurso asignado trabajan)': 'A task waits for the calendars of its resources (it only advances while the task calendar and the calendar of an assigned resource are both working)',
  'Un «día» de una tarea vale las horas diarias de su propio calendario': 'A "day" of a task is the daily hours of its own calendar',
  'Valor ganado según el reparto del trabajo y del costo (no solo el porcentaje)': 'Earned value by the distribution of work and cost (not just the percent)',
  'Zona horaria (vacía = reloj sin zona)': 'Time zone (empty = clock without a zone)',
  'La zona horaria no existe. Usa un nombre como Europe/Madrid o America/Bogota.': 'The time zone does not exist. Use a name such as Europe/Madrid or America/Bogota.',
  // ---- resources
  Costo: 'Cost',
  // ---- Project XML and reports
  'Exportar a Project XML con campos extendidos (experimental)…': 'Export to Project XML with extended fields (experimental)…',
  'Añade los campos personalizados y la lista completa de divisiones. Los números de campo no están comprobados con Project.': 'Adds the custom fields and the full list of splits. The field numbers have not been checked against Project.',
  'Exportar el informe a CSV…': 'Export the report to CSV…',
  'Exportar el informe a HTML…': 'Export the report to HTML…',
  'Imprimir el informe / PDF': 'Print the report / PDF',
  'No hay tareas que mostrar en el informe.': 'There are no tasks to show in the report.',
  // ---- subprojects
  'Vínculo vivo': 'Live link',
  'El subproyecto se vuelve a leer cuando el archivo cambia (al abrir el proyecto y al volver a esta ventana).': 'The subproject is read again when the file changes (when the project opens and when you come back to this window).',
  'Subproyecto actualizado desde su archivo: {name}': 'Subproject updated from its file: {name}',
});
