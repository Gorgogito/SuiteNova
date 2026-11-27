/*
 * The language a form is answered in. The program writes its texts in Spanish; here they are said in English when the
 * form asks for it. The texts of the person who made the form are never touched.
 */

export type Lang = 'es' | 'en';

export const LANGUAGES: { id: Lang; name: string }[] = [
  { id: 'es', name: 'Español' },
  { id: 'en', name: 'English' },
];

/** Spanish and English. `{#}` stands for a number and `{*}` for any text, in the same order in both. */
export const PAGE_EN: [string, string][] = [
  // answering
  ['Elige una opción', 'Choose an option'],
  ['Otro:', 'Other:'],
  ['Otro', 'Other'],
  ['Nada probable', 'Not at all likely'],
  ['Muy probable', 'Very likely'],
  ['Dejar este orden', 'Keep this order'],
  ['Orden elegido.', 'Order chosen.'],
  ['Archivos elegidos', 'Chosen files'],
  ['obligatoria', 'required'],
  ['Enviar', 'Submit'],
  ['Enviar (prueba)', 'Submit (test)'],
  ['Borrar respuestas', 'Clear answers'],
  ['Atrás', 'Back'],
  ['Siguiente', 'Next'],
  ['Progreso', 'Progress'],
  ['Página {#} de {#}', 'Page {#} of {#}'],
  ['Tu nombre', 'Your name'],
  ['Escribe tu nombre.', 'Type your name.'],
  ['Elige {#} opciones.', 'Choose {#} options.'],
  ['Elige de {#} a {#} opciones.', 'Choose {#} to {#} options.'],
  ['Un archivo de {#} MB como mucho.', 'One file of {#} MB at most.'],
  ['Hasta {#} archivos de {#} MB como mucho cada uno.', 'Up to {#} files of {#} MB at most each.'],
  // the end
  ['Respuesta lista', 'Your response is ready'],
  ['Respuesta guardada', 'Response saved'],
  ['Así se vería al terminar', 'This is how it ends'],
  ['Gracias por responder.', 'Thanks for your response.'],
  ['Puntuación', 'Score'],
  ['Puntuación: {#} de {#}', 'Score: {#} of {#}'],
  ['Esto es solo una vista previa: no se ha guardado nada.', 'This is only a preview: nothing has been saved.'],
  ['Este formulario no se envía solo: descarga tu respuesta y mándasela a quien te lo compartió.', 'This form does not send itself: download your response and send it to whoever shared it with you.'],
  ['Descargar mi respuesta', 'Download my response'],
  ['Copiar respuesta', 'Copy response'],
  ['Copiada', 'Copied'],
  ['Responder otra vez', 'Submit another response'],
  ['Rellenar otra respuesta', 'Fill in another response'],
  ['Volver a probar', 'Try again'],
  ['Imprimir o guardar mis respuestas', 'Print or save my answers'],
  ['Mis respuestas', 'My answers'],
  ['Enviado el {*}', 'Sent on {*}'],
  ['Nombre', 'Name'],
  ['Formulario creado con Nova Forms', 'Form made with Nova Forms'],
  // closed and timed
  ['Este formulario ya no admite respuestas.', 'This form is no longer accepting responses.'],
  ['Este formulario todavía no admite respuestas.', 'This form is not accepting responses yet.'],
  ['Empieza el {*}.', 'It starts on {*}.'],
  ['Este formulario tiene un tiempo límite de {#} minutos.', 'This form has a time limit of {#} minutes.'],
  ['Este formulario tiene un tiempo límite de 1 minuto.', 'This form has a time limit of 1 minute.'],
  ['El tiempo empieza al pulsar «Empezar».', 'The time starts when you press “Start”.'],
  ['Empezar', 'Start'],
  ['Tiempo restante: {*}', 'Time left: {*}'],
  ['Se acabó el tiempo.', 'Time is up.'],
  ['Se envió lo que habías respondido.', 'What you had answered was sent.'],
  ['No habías respondido nada.', 'You had not answered anything.'],
  // answering over the network
  ['Enviando…', 'Sending…'],
  ['Respuesta enviada', 'Response sent'],
  ['No se ha enviado', 'Not sent'],
  ['No se pudo enviar la respuesta.', 'The response could not be sent.'],
  ['No se pudo conectar con quien recoge las respuestas.', 'Could not reach whoever is collecting the responses.'],
  ['La respuesta es demasiado grande.', 'The response is too large.'],
  ['Hay demasiadas peticiones: espera un momento y reintenta.', 'Too many requests: wait a moment and try again.'],
  ['La aplicación que recoge las respuestas no contesta: reintenta.', 'The program collecting the responses is not answering: try again.'],
  ['Reintentar', 'Try again'],
  ['Revisar mis respuestas', 'Review my answers'],
  ['Ya has enviado tu respuesta.', 'You have already sent your response.'],
  ['No se pudo guardar la respuesta: avisa a quien la recoge y reintenta.', 'The response could not be saved: tell whoever is collecting and try again.'],
  ['La respuesta no se entiende.', 'The response cannot be understood.'],
  ['Esta dirección recoge ahora otro formulario. Recarga la página.', 'This address now collects another form. Reload the page.'],
  ['La respuesta está vacía.', 'The response is empty.'],
  ['Hay respuestas que no son válidas: puede que el formulario haya cambiado. Recarga la página.', 'Some answers are not valid: the form may have changed. Reload the page.'],
  // what can be wrong
  ['Esta pregunta es obligatoria.', 'This question is required.'],
  ['Escribe un correo electrónico válido.', 'Type a valid e-mail address.'],
  ['Escribe una dirección web que empiece por http:// o https://.', 'Type a web address starting with http:// or https://.'],
  ['Escribe al menos {#} caracteres.', 'Type at least {#} characters.'],
  ['Escribe como máximo {#} caracteres.', 'Type at most {#} characters.'],
  ['Escribe un número.', 'Type a number.'],
  ['Escribe un número entero.', 'Type a whole number.'],
  ['Escribe un número menor que {#} o mayor que {#}.', 'Type a number less than {#} or greater than {#}.'],
  ['Escribe un número mayor que {#}.', 'Type a number greater than {#}.'],
  ['Escribe un número menor que {#}.', 'Type a number less than {#}.'],
  ['El número no puede ser {#}.', 'The number cannot be {#}.'],
  ['El valor mínimo es {#}.', 'The lowest value is {#}.'],
  ['El valor máximo es {#}.', 'The highest value is {#}.'],
  ['Escribe una fecha válida.', 'Type a valid date.'],
  ['Elige una puntuación de 1 a {#}.', 'Choose a rating from 1 to {#}.'],
  ['Elige un valor de 0 a 10.', 'Choose a value from 0 to 10.'],
  ['Elige una opción.', 'Choose an option.'],
  ['Elige una de las opciones.', 'Choose one of the options.'],
  ['Elige una o varias opciones.', 'Choose one or more options.'],
  ['Hay una opción que no existe.', 'There is an option that does not exist.'],
  ['Elige al menos {#} opciones.', 'Choose at least {#} options.'],
  ['Elige como máximo {#} opciones.', 'Choose at most {#} options.'],
  ['Hay un elemento que no existe.', 'There is an item that does not exist.'],
  ['Ordena todos los elementos.', 'Put all the items in order.'],
  ['Adjunta un archivo.', 'Attach a file.'],
  ['Puedes adjuntar como máximo {#} archivo(s).', 'You can attach at most {#} file(s).'],
  ['Entre todos, los archivos pasan de {#} MB.', 'Together, the files are over {#} MB.'],
  ['Responde cada fila.', 'Answer each row.'],
  ['Responde todas las filas.', 'Answer all the rows.'],
  ['Hay una columna que no existe.', 'There is a column that does not exist.'],
  ['No se admiten archivos .{*}.', '.{*} files are not accepted.'],
  ['El archivo «{*}» no es de un tipo admitido.', 'The file “{*}” is not of an accepted type.'],
  ['El archivo «{*}» está vacío.', 'The file “{*}” is empty.'],
  ['El archivo «{*}» pasa de {#} MB.', 'The file “{*}” is over {#} MB.'],
  ['No se pudo leer «{*}».', '“{*}” could not be read.'],
  // last: the ones that start with a verb and end with anything
  ['Tipos: {*}.', 'Types: {*}.'],
  ['Subir {*}', 'Move up {*}'],
  ['Bajar {*}', 'Move down {*}'],
  ['Quitar {*}', 'Remove {*}'],
];

const literal = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = PAGE_EN.filter(([es]) => /\{[#*]\}/.test(es)).map(([es, en]) => ({
  re: new RegExp(`^${es.split(/(\{[#*]\})/).map((p) => (p === '{#}' ? '(-?[0-9]+(?:\\.[0-9]+)?(?:e[+-]?[0-9]+)?)' : p === '{*}' ? '([\\s\\S]+?)' : literal(p))).join('')}$`),
  en,
}));
const EXACT = new Map(PAGE_EN);

/** A text of the program in the language of the form; one it does not know stays as it is. */
export function localize(text: string, lang: Lang | undefined): string {
  if (lang !== 'en') return text;
  const exact = EXACT.get(text);
  if (exact !== undefined) return exact;
  for (const p of PATTERNS) {
    const found = p.re.exec(text);
    if (!found) continue;
    let i = 1;
    return p.en.replace(/\{[#*]\}/g, () => found[i++]!);
  }
  return text;
}
