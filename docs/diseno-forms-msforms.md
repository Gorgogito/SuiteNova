# Nova Forms frente a Microsoft Forms (segunda ronda)

Estado: **plan aprobado por el usuario** (2026-11-27): las 7 fases en este orden, respuestas por **red local** (opción A) y
el número de versión corregido en todos los productos dentro de la fase 1. Fases 1 y 2 hechas (ver la bitácora al final).

Referencia: Microsoft Forms (web). La comparación sale de leer el código de Nova Forms y `docs/LIMITACIONES.md`, de
probar en Edge los fallos de la sección 2 y de la ayuda de Microsoft sobre
[ajustes](https://support.microsoft.com/en-us/forms/adjust-your-form-or-quiz-settings-in-microsoft-forms),
[resultados](https://support.microsoft.com/en-US/Forms/check-and-share-your-form-results),
[resultados de cuestionarios](https://support.microsoft.com/en-us/forms/check-and-share-your-quiz-results),
[ramificación](https://support.microsoft.com/en-us/forms/use-branching-logic-in-microsoft-forms) y
[envío](https://support.microsoft.com/en-us/forms/send-a-form-and-collect-responses). **No se ha usado Microsoft Forms
con ninguna cuenta**; las opciones de cada tipo de pregunta (restricciones de texto, barajar opciones, símbolos de
calificación) salen de lo que conozco, porque la página de ayuda consultada ya no existe.

## 1. Lo que ya hay

- **Preguntas:** texto corto y párrafo (correo, dirección web, límites de longitud), opción única, casillas, lista
  desplegable, calificación de 3 a 10, recomendación 0–10, fecha, número, escala por filas y títulos; imagen por pregunta.
- **Lógica:** mostrar una pregunta solo si una anterior es, no es o contiene un valor.
- **Cuestionarios:** respuestas correctas, puntos y puntuación al enviar.
- **Recoger:** rellenar dentro de la aplicación, o exportar una página web que descarga un archivo de respuesta que luego
  se importa. **No hay servidor.**
- **Resultados:** resumen con barras y cifras, respuestas una a una, CSV.
- **Importar:** Google Forms (página guardada) y hojas de respuestas de Microsoft y Google (`.xlsx`, `.csv`).

## 2. Fallos encontrados al revisar

| Fallo | Cómo se comprobó |
|---|---|
| **Cambiar el texto de una opción rompe lo que dependía de ella:** la respuesta correcta, las condiciones y las respuestas ya recogidas siguen con el texto antiguo (con las filas de una escala ocurre igual) | En Edge (opciones); en el código (filas) |
| La puntuación del resumen sale mal con preguntas condicionales: «media 1 de 1, mejor 2» | En Edge |
| Un título de sección cuenta en la numeración: las preguntas salen «1.» y «3.» (también en la página exportada) | En Edge; en el código (página) |
| Dos opciones iguales (o vacías) se admiten; al pulsar la primera no queda marcada | En Edge |
| «+ Añadir» crea la opción **«Opcione 3»** | En Edge |
| Ctrl+Z deshace letra a letra; escribir una descripción larga agota los 100 pasos | En Edge |
| Cambiar de modo con una respuesta a medio rellenar la pierde sin preguntar | En el código (`Runner`) |
| «Acerca de» dice «Nova Forms 0.0.7»; los demás productos también muestran versiones antiguas | En el código |

## 3. Lo que falta frente a Microsoft Forms

| Área | Falta |
|---|---|
| Preguntas | Clasificación (ordenar), carga de archivos, restricciones numéricas en texto, barajar opciones, límite de casillas, símbolos y etiquetas de calificación, etiquetas de la recomendación, ecuaciones, vídeo |
| Estructura | Secciones y páginas, barra de progreso, ramificación (ir a una sección o al final), barajar preguntas, ocultar números |
| Ajustes | Cerrar el formulario con un mensaje, fecha de inicio y fin, temporizador, ocultar «enviar otra respuesta», comprobante de las respuestas, pedir el nombre, temas con imagen de fondo, vista de ordenador y móvil, página en varios idiomas (hoy siempre en español) |
| Recoger | Enlace y código QR para responder, respuestas que llegan solas, aviso de cada respuesta |
| Cuestionarios | Comentarios por respuesta, explicaciones, mostrar las correctas al terminar, modo práctica, corregir a mano y poner puntos, devolver la nota con comentarios |
| Resultados | Gráficos circulares, tiempo medio de respuesta, buscar y ordenar respuestas, imprimir el resumen, compartir un resumen, exportar a Excel |

## 4. Plan en 7 fases

Cada fase termina con pruebas, e2e con capturas, `LIMITACIONES.md` y `PROGRESO.md`. La página web exportada hace lo mismo
que la aplicación y una prueba lo compara.

1. **Fallos y cimientos.** Los fallos de la tabla; renombrar una opción o una fila arrastra respuestas, respuesta correcta y
   condiciones; deshacer por cambio y no por letra.
2. **Preguntas como en Forms.** Clasificación, carga de archivos (dentro del archivo de respuesta, con límite de tamaño),
   restricciones de texto y número, barajar opciones, límite de casillas, símbolos y etiquetas de calificación, ecuaciones
   en las preguntas (`math-core`).
3. **Secciones y ramificación.** Secciones como páginas, barra de progreso, ramificación a sección o al final, varias
   condiciones, barajar preguntas, ocultar números.
4. **Ajustes y aspecto.** Cierre con mensaje, fechas, temporizador, «enviar otra», comprobante para imprimir o guardar en
   PDF, nombre de quien responde, temas con imagen de fondo, vista de ordenador y móvil, página en español o inglés.
5. **Recoger respuestas.** Según lo que se decida en la sección 5. Además, desde Nova Mail: pasar a un formulario el
   archivo de respuesta que llega adjunto.
6. **Cuestionarios.** Comentarios y explicaciones, mostrar resultados, modo práctica, revisar por persona o por pregunta,
   puntos a mano, hoja de devolución para cada persona.
7. **Resultados y cierre.** Gráficos (`chart-core`), tiempo de respuesta, buscar, ordenar y filtrar, imprimir, resumen como
   página para compartir, exportar a `.xlsx` (`xlsx-io`), plantillas; revisión final, versión 0.0.16 e instaladores.

## 5. Cómo se recogen las respuestas (decidido: A)

| Opción | Qué da | Coste y riesgo |
|---|---|---|
| **A. Red local (elegida)** | La aplicación de escritorio sirve el formulario a la red Wi-Fi o de cable: dirección y código QR, se responde desde el móvil y las respuestas llegan solas | Abre un puerto en este equipo (apagado salvo que se encienda; Windows pedirá permiso); sin cifrado dentro de la red; solo mientras la aplicación está abierta; hay código Rust nuevo que proteger |
| **B. Solo archivos** | Como hoy, más el paso por correo desde Nova Mail | Sin riesgos nuevos; cada persona tiene que devolver un archivo |
| C. Servicio en internet | Como Microsoft Forms | No se propone: necesita alojamiento, cuentas y custodiar datos de otras personas, y no se puede comprobar aquí |

## 6. Fuera del plan

- Cuentas, limitar a una organización, Teams, SharePoint, libro de Excel conectado en vivo, Copilot, recordatorios por
  correo desde un servidor, coautoría y galería de plantillas en línea.

## 7. Límites que seguirán

- Sin un servidor con identidad, «una respuesta por persona», las fechas y el temporizador **se pueden saltar** en una
  página guardada: sirven para guiar, no para impedir.
- Los archivos reales de Microsoft y Google Forms siguen sin probarse mientras no haya una muestra.

## 8. Bitácora

### Fase 1 (hecha, 2026-11-27): fallos y cimientos
- **Los fallos de la tabla, corregidos**, y tres más hallados al leer y probar el código antes de tocarlo:
  - el cuadro de respuestas aceptadas de un cuestionario **no dejaba escribir el punto y coma** («Lima; lima» quedaba
    «Limalima»);
  - **Ctrl+Z mientras se rellenaba borraba una respuesta ya guardada**;
  - la barra de estado seguía diciendo «Guardado» después de cambiar el formulario;
  - al guardar y volver a abrir **se borraban sin aviso** las respuestas que ya no cumplían las reglas actuales (una opción
    quitada, un límite cambiado). El archivo propio conserva ahora todo; las comprobaciones siguen para lo que llega de
    fuera.
- **Núcleo** (`forms-core`): `edit.ts` (renombrar y quitar opciones, filas y columnas llevándose respuestas, correcta y
  condiciones; listas sin repetidos), `numbers` para la numeración y puntuación del resumen cuando el máximo varía.
- **Aplicación:** `DraftInput.tsx` (los textos que solo se pueden juzgar enteros), deshacer por cambio, respuestas
  recogidas fuera del deshacer, borrador que sigue al cambiar de vista y órdenes activas según la vista.
- **Versión:** `apps/suite/src/version.ts` la lee de `package.json`; la muestran los «Acerca de» de todos los productos y
  `Application.Version` de las macros de Base. Una prueba compara `package.json`, `Cargo.toml` y `tauri.conf.json` y
  que nadie la escriba a mano.
- **Pruebas:** `edit.test.ts` (12), `version.test.ts` (3), 5 más en `forms.test.ts`, `e2e-forms.mjs` pasa de 21 a 27.

### Fase 2 (hecha, 2026-11-27): preguntas como en Forms
- **Núcleo** (`forms-core`): tipos «clasificación» y «subir archivos», `files.ts` (tipos vetados, límites y nombres
  seguros), restricciones de número, mínimo y máximo de casillas, barajar con semilla, símbolos y etiquetas de
  calificación y ecuaciones (`math-core`). La página web (`html.ts`) hace lo mismo y una prueba lo compara.
- **Aplicación:** `Fields.tsx` (símbolos, ordenar, archivos), `Equation.tsx` (el editor de ecuaciones compartido),
  `uploads.ts` (guardar los archivos recibidos) y los ajustes nuevos en el diseñador y los resultados.
- **Cambios en lo que ya había:** una calificación nueva se dibuja con estrellas; las escalas lineales de Google se
  importan con sus etiquetas (antes iban en la descripción) y sus preguntas de subir archivos ya no se omiten.
- **Fallos hallados y corregidos al probar:** el cuadro de ecuación dejaba la página oculta para los lectores de pantalla
  al cerrarse; en el tema gris oscuro la línea de fechas de Resultados no se leía (venía de antes); «1 respuestas
  añadidas».
- **Pruebas:** `types.test.ts` (14), 2 más en `forms.test.ts`, `e2e-forms.mjs` pasa de 27 a 32.