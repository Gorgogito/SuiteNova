# Nova Mail frente a Outlook (segunda ronda)

Estado: **plan aprobado por el usuario** (2026-11-26); S/MIME y la sincronización de calendario y contactos con el
servidor quedan para después. Fases 1 a 5 hechas (ver la bitácora al final).

Referencia: Outlook clásico de Office 2024. La comparación sale de leer el código de Nova Mail, sus pruebas y
`docs/LIMITACIONES.md`, y de lo que conozco de Outlook: **no se ha abierto el Outlook de este equipo** (usa cuentas reales).

## 1. Lo que ya hay

- **Cuentas:** IMAP, POP3, JMAP y Exchange (EWS), contraseña u OAuth, sincronización automática, cambios pendientes sin
  conexión, subcarpetas. Probado solo con servidores falsos.
- **Correo:** leer HTML saneado, responder, reenviar, borradores, adjuntos, imágenes y tablas en el mensaje, buscar,
  corrector, dictado y lectura en voz alta, texto de imágenes, macros.
- **Calendario:** día, semana y mes, repeticiones, recordatorios con la aplicación abierta, `.ics`.
- **Contactos y tareas:** fichas, vencimiento y prioridad, `.vcf`, `.csv`.
- **Archivos:** `.eml`, `.mbox`; lectura de `.msg`, `.pst`, `.ost`.

## 2. Fallos encontrados al revisar

| Fallo | Cómo se comprobó |
|---|---|
| Cerrar el mensaje que se escribe (Esc, clic fuera o «Cerrar») lo **descarta sin preguntar** y no queda borrador | En Edge, las tres formas |
| «Responder a todos» te incluye a ti si no has escrito «Mi dirección» (no mira las direcciones de las cuentas) | En Edge |
| El original queda como «respondido» (también en el servidor) al pulsar Responder, aunque no se envíe | En el código (`ctl.reply`) |
| Con varias cuentas, responder sale desde la primera y no desde la que recibió el mensaje | En el código (`ComposeBody`) |

## 3. Lo que falta frente a Outlook

| Área | Falta |
|---|---|
| Redacción | Formato (negrita, listas, vínculos, fuentes), firmas, plantillas, autocompletar destinatarios, borrador automático, escribir sin que un cuadro tape el correo, adjuntar arrastrando, importancia, respuesta con el original en su formato |
| Lista y lectura | Conversaciones, selección múltiple, menú contextual, arrastrar a carpetas, ordenar, filtro «No leídos», grupos por fecha, deshacer, imprimir, renombrar y mover carpetas, favoritos, ver encabezados, guardar todos los adjuntos, `winmail.dat` |
| Organizar | Categorías de color, seguimiento con fecha, reglas, pasos rápidos, búsqueda por campos y en todo el cuerpo, carpetas de búsqueda, remitentes bloqueados y seguros |
| Avisos y envío | Aviso de Windows al llegar correo, IMAP IDLE, enviar más tarde, deshacer envío, bandeja de salida, posponer recordatorios |
| Calendario | Invitaciones y respuestas, cambiar una sola repetición, varios calendarios con color, arrastrar y estirar citas, semana laboral y agenda, zona horaria por cita, imprimir |
| Contactos y tareas | Grupos de contactos, foto, duplicados, agregar desde un mensaje, tareas periódicas, hora y recordatorio |

## 4. Plan en 7 fases

Cada fase termina con pruebas, e2e con capturas, `LIMITACIONES.md` y `PROGRESO.md`.

1. **Fallos y escritura segura.** Los cuatro fallos; borrador automático y pregunta al cerrar; autocompletar destinatarios
   con contactos y correos usados; elegir bien el remitente; adjuntar arrastrando; escribir en el panel de lectura, como
   Outlook, con opción de abrir aparte.
2. **Formato y firmas.** Editor con formato (ProseMirror, ya usado en Writer) en HTML con su versión en texto; barra de
   formato; las imágenes y tablas actuales dentro del texto; firmas por cuenta; plantillas; responder y reenviar
   conservando el formato y las imágenes del original; importancia.
3. **Lista y lectura.** Selección múltiple, menú contextual, arrastrar a carpetas, ordenar, filtrar, grupos por fecha,
   conversaciones, deshacer, imprimir, renombrar y mover carpetas (también en el servidor), favoritos, encabezados,
   guardar todos los adjuntos, `winmail.dat`.
4. **Organizar.** Categorías, seguimiento con fecha (que aparece en Tareas), reglas que se aplican al recibir y a mano,
   pasos rápidos, búsqueda por campos (`de:`, `asunto:`, adjuntos, fechas) en todo el mensaje, carpetas de búsqueda,
   remitentes bloqueados y seguros.
5. **Avisos y envío.** Avisos de Windows para correo y recordatorios (con posponer), IMAP IDLE, bandeja de salida, enviar
   más tarde y deshacer envío. Solo funciona con la aplicación abierta.
6. **Calendario.** Invitaciones por correo (iCalendar: invitar, aceptar, rechazar, provisional, cancelar), cambiar una
   repetición, varios calendarios con color, arrastrar y estirar, semana laboral y agenda, imprimir.
7. **Contactos, tareas y cierre.** Grupos de contactos, foto, duplicados, agregar desde un mensaje, tareas periódicas con
   recordatorio; revisión final, versión e instaladores.

## 5. Fuera del plan

- **Se puede, pero conviene decidirlo aparte:** S/MIME (firmar y cifrar), sincronizar calendario y contactos con el
  servidor (CalDAV, CardDAV, Exchange), respuestas automáticas en el servidor (solo JMAP y Exchange).
- **No se hará:** ActiveSync, Microsoft Graph, Teams, calendarios compartidos y delegados, complementos de Outlook,
  recuperar mensajes y votaciones de Exchange, escribir `.pst` o `.msg`. Dependen de servicios o formatos que no se pueden
  comprobar aquí.

## 6. Límites que seguirán

- Sin una cuenta de pruebas real, todo lo del servidor solo se puede comprobar con servidores falsos escritos aquí.
- Las invitaciones se probarán entre dos archivos de Nova Mail y con `.ics` creados para las pruebas, no con Outlook ni
  Google.
- Todo el correo sigue en un solo archivo cargado en memoria. Cambiar el almacenamiento sería otro proyecto.

## 7. Bitácora

### Fase 1 (hecha, 2026-11-26): fallos y escritura segura
- **Los cuatro fallos corregidos:** cerrar pregunta si se perdería algo; «Responder a todos» te quita también por las
  cuentas; «respondido» al enviar; la respuesta sale de la cuenta que recibió el correo. De paso, un borrador de respuesta
  abierto de nuevo conserva la conversación (antes perdía `In-Reply-To`) y ya no gana un salto de línea al final.
- **Escribir:** en el panel de lectura (`Composer.tsx`), con «Abrir en grande»; Ctrl+Intro envía, Esc cierra; mientras
  se escribe, las órdenes del mensaje elegido (Ctrl+R, Ctrl+F…) quedan desactivadas. Borrador automático y aviso al pasar
  a otra cosa.
- **Destinatarios** (`mail-core/recipients.ts`): sugerencias con teclado y ratón; los nombres con coma entre comillas ya
  no se parten.
- **Adjuntos:** arrastrar y pegar; una imagen sobre el texto se inserta en él; aviso por encima de 40 MB.
- **Escritorio:** las ventanas dejan el arrastre a la página (`dragDropEnabled: false`) y un archivo soltado donde nada lo
  espera se rechaza (`file-drop.ts`).
- **Pruebas:** `compose.test.ts` (nuevas), `recipients.test.ts` (5), `e2e-mail-compose.mjs` (10), una más en
  `e2e-window-native.mjs` (18).
- **Cuentas de prueba:** el usuario ofreció una de Gmail y otra de Outlook.com. Los puertos responden desde esta red.
  Gmail exige contraseña de aplicación u OAuth y Outlook.com solo OAuth, así que el alta la hace el usuario en la
  aplicación. Las credenciales no se guardan en el repositorio.

### Fase 2 (hecha, 2026-11-26): formato y firmas
- **Editor** (`mail/rich/`): el de Writer y Notes (esquema de `writer-core`), con barra de formato, herramientas de
  tabla, imágenes con las herramientas de siempre, corrector, sinónimos, autocorrección y buscar.
- **Lo que se envía** (`rich/html.ts`): HTML propio con cada estilo en línea y la misma versión en texto; texto solo si no
  hay formato. El borrador guarda además el documento del editor (`MailRecord.compose`) y se abre como se escribió.
- **Responder y reenviar:** el original se conserva (HTML saneado e imágenes) debajo de lo escrito; «Editar el original» y
  «Quitar el original».
- **Firmas** por cuenta, para mensajes nuevos y para respuestas; **plantillas**; **importancia** (cabeceras
  `Importance` y `X-Priority`, lista y panel de lectura). Macros: `HTMLBody` e `Importance`.
- **Fallos hallados y corregidos al probar:** Esc no cerraba desde el editor; una segunda imagen sustituía a la primera;
  tras insertar una tabla el cursor quedaba fuera; mirar un mensaje con firma lo marcaba como cambiado; Mayús+F7 podía leer
  la palabra anterior; la cita de un correo sin fecha decía «El , …»; el botón «Firmas…» en Inicio ocultaba «Eliminar
  carpeta» a 1400 px (pasó a «Enviar y recibir»).
- **Se quitaron** las marcas `[Imagen: …]` y `[Tabla: …]` del texto y el panel de tablas.
- **Pruebas:** `rich.test.ts` (11), `e2e-mail-format.mjs` (10); adaptadas las e2e que usaban el cuadro de texto.

### Fase 3 (hecha, 2026-11-26): lista y lectura
- **Núcleo** (`mail-core`): `view.ts` (orden, filtros, grupos por fecha, filas), `threads.ts` (conversaciones),
  `tnef.ts` (`winmail.dat`), `folders.ts` (renombrar, mover, favoritos, retirar cambios sin enviar).
- **Lista** (`MessageList.tsx`): filas de alturas distintas virtualizadas, selección múltiple, menú contextual
  (`ContextMenu.tsx`), arrastrar, teclado. **Carpetas** (`FolderTree.tsx`): menú, arrastrar, cambiar nombre, Favoritos.
  Pestaña «Carpeta», grupo «Organización» en Vista y «Mensaje» en Datos.
- **Deshacer**, también en el servidor. **Servidor:** orden nueva `mail_rename_folder` (IMAP RENAME, JMAP
  `Mailbox/set`, Exchange `UpdateFolder` y `MoveFolder`) y permiso `fs:allow-exists` para no sobrescribir adjuntos.
- **Fallos previos corregidos:** un mensaje movido quedaba desvinculado del servidor hasta la siguiente sincronización
  (borrarlo entretanto no llegaba allí); las carpetas IMAP con tildes se veían codificadas.
- **Fallos hallados y corregidos al probar y repasar:** abrir una conversación no mostraba ningún mensaje; deshacer un
  movimiento revertía «leído»; Esc al renombrar podía aplicar el nombre y F2 no lo dejaba seleccionado; un submenú dejaba
  sin teclado al menú.
- **Pruebas:** `list.test.ts` (17), `list-actions.test.ts`, 5 de Rust, `e2e-mail-list.mjs` (11).

### Fase 4 (hecha, 2026-11-27): organizar
- **Núcleo** (`mail-core`): `categories.ts`, `followup.ts`, `search.ts` (la búsqueda salió de `store.ts`; campos, fechas,
  texto entero y carpetas de búsqueda), `junk.ts`, `rules.ts` (reglas y pasos rápidos). Categorías en `.ics` y `.vcf`.
- **Aplicación:** `organizer.ts` (hace lo que piden reglas, pasos y remitentes), `dlg-organize.tsx`, `organize-menus.ts`,
  `CategoryViews.tsx`. Deshacer admite varias acciones como una sola, también copias. Carpetas de búsqueda en el árbol,
  seguimiento en Tareas, avisos de seguimiento y de reglas.
- **Fallos anteriores corregidos:** al cambiar de sección la cinta podía quedarse con los grupos plegados habiendo sitio;
  los atajos con un número y Mayús no se reconocían (ahora se miran por la tecla).
- **Fallos hallados y corregidos al probar y repasar:** deshacer «Listo» ya enviado al servidor perdía la bandera; un
  menú abierto desde un grupo plegado de la cinta salía desplazado o se cerraba; la cinta plegaba «Carpeta» a 1400 px;
  copiar en una cuenta POP3 dejaba en la cola un cambio imposible que frenaba los siguientes; una regla «copiar y
  eliminar para siempre» borraba aunque la copia fallara; reabrir en Tareas un mensaje completado perdía su fecha; la
  bandera y «completado» se leían mal en el tema Negro.
- **Pruebas:** `organize.test.ts` (19), `organize-actions.test.ts` (23), una de macros, una de atajos,
  `e2e-mail-organize.mjs` (10).

### Fase 5 (hecha, 2026-11-27): avisos y envío
- **Escritorio:** orden `mail_wait` (IMAP IDLE, con una marca para no perder lo que llegue entre dos esperas) y
  `notify.rs` (avisos de Windows con botones; nueva dependencia directa de `windows` y `windows-registry`).
- **Núcleo:** `outbox.ts` (reintentos, fecha del envío, horas para enviar más tarde) y `reminders.ts` (posponer y
  descartar, guardado en el archivo). Carpeta del sistema «Bandeja de salida».
- **Aplicación:** `outbox.ts` (cola de salida, deshacer envío, sin envíos dobles), `alerts.ts` (avisos, recibir al
  instante, ajustes), `notify.ts`, `dlg-send.tsx`. La pregunta al cerrar admite avisar de lo que dejará de ocurrir.
- **Cambios en lo que ya había:** un fallo de red de SMTP ya no se explica como un problema de certificado; los
  recordatorios descartados no vuelven al reabrir el archivo.
- **Fallos hallados y corregidos al probar y repasar:** un recordatorio pospuesto justo hasta la hora de la cita no volvía
  a avisar a Windows; dos ventanas habrían subido dos copias a Enviados del servidor (y podían enviar a la vez); un paso
  rápido de responder se podía aplicar a un mensaje sin enviar; la barra de estado seguía diciendo que un envío retenido
  se haría.
- **Pruebas:** `outbox.test.ts` (8), `outbox-alerts.test.ts` (22), 4 de Rust (y una que muestra un aviso real, aparte),
  `e2e-mail-send.mjs` (7).

### Fase 6 (hecha, 2026-11-27): calendario
- **Núcleo** (`mail-core`): `calendars.ts` (varios calendarios), `events.ts` (una repetición, la serie, mover y estirar,
  invitados), `invites.ts` (invitar, contestar y cancelar según iTIP). `ics.ts` lee y escribe organizador, asistentes,
  versión, estado y repeticiones cambiadas (RECURRENCE-ID); los mensajes llevan y reconocen `text/calendar`.
- **Aplicación:** `calendar.ts` (cambios con deshacer propio y reuniones, que salen por la Bandeja de salida),
  `CalendarView.tsx` rehecho (lista de calendarios, semana laboral, agenda, arrastrar, estirar y teclado),
  `EventDialog.tsx`, `InviteCard.tsx` en el panel de lectura y `calendar-print.ts`. Órdenes nuevas: «Reunión nueva»
  (Ctrl+Mayús+Q), «Semana laboral», «Vista Agenda» e «Imprimir el calendario».
- **Cambios en lo que ya había:** Ctrl+Z deshace también en el calendario (el aviso al eliminar ya no dice que no se
  puede); los `.ics` con repeticiones cambiadas ya no las tratan como citas sueltas.
- **Fallos hallados y corregidos al probar y repasar:** deshacer un cambio anterior a un envío devolvía la reunión sin su
  número de versión (la siguiente actualización habría llegado como anticuada) y borraba respuestas anotadas; los
  recordatorios pospuestos de una cita cancelada seguían saliendo; los botones del cuadro se partían en varias líneas;
  la descripción quedaba muy estrecha; los títulos decían «Junio De 2026».
- **Pruebas:** `calendar.test.ts` (15), `calendar-actions.test.ts` (13), `e2e-mail-calendar.mjs` (10).
