# Nova Mail frente a Outlook (segunda ronda)

Estado: **plan aprobado por el usuario** (2026-11-26); S/MIME y la sincronización de calendario y contactos con el
servidor quedan para después. Fases 1 y 2 hechas (ver la bitácora al final).

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
