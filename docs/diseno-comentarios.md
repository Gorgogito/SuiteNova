# Comentarios y Control de cambios (producto auxiliar compartido): diseño

## 1. Cómo es en Office
- **Comentarios.** Los tienen **Word, Excel, PowerPoint y Visio**, con la misma idea y el mismo aspecto: un hilo con autor, fecha y texto, **respuestas**, **resolver** y volver a abrir, **mencionar** a alguien con @, panel de comentarios, globo junto al contenido, anterior y siguiente, mostrar u ocultar, eliminar uno o todos. Cada aplicación **guarda y ancla** los suyos a su manera:
  - Word: a un **rango de texto** (`comments.xml`, con respuestas y «resuelto» en `commentsExtended.xml`).
  - Excel: a una **celda**, de dos clases: **notas** (el comentario clásico, un cuadro de texto sin respuestas) y **comentarios encadenados** (con respuestas y resolver; `threadedComments` y `persons`).
  - PowerPoint: a una **diapositiva** o a un objeto de ella (comentarios modernos con respuestas y resolver; los antiguos, solo texto).
  - Visio: a una **forma** o a la página (`comments.xml`).
- **OneNote, Access, Outlook, Forms y Project no tienen comentarios en este sentido** (OneNote tiene etiquetas y notas vinculadas; Planner, comentarios en tareas). Corrijo lo que dije antes: OneNote no tiene comentarios.
- **Control de cambios.** Es **solo de Word**: inserciones, borrados, cambios de formato, movimientos y cambios de tabla, con autor y fecha; aceptar y rechazar uno o todos; vistas (todo el marcado, marcado simple, sin marcado, original); mostrar por tipo y por revisor; bloquear el control; comparar y combinar documentos. PowerPoint solo **compara y combina**. El «control de cambios» de Excel (libro compartido) está obsoleto y Office lo sustituyó por la coautoría: **no se hace**.
- **Compartido y propio.** No hay un motor común de dibujo como en las imágenes: es una **idea y una interfaz** comunes (autor, hilo, resolver, panel) con **anclas y archivos propios** de cada producto.

## 2. Decisiones (del usuario)
- **Comentarios en los productos donde Office también los tiene:** Writer, Calc, Slides y Diagram.
- **Núcleo compartido, y Calc y Slides migran a él** (en lugar de dejar lo que ya funciona y cerrar huecos por separado).
- **Control de cambios** solo en Writer, como Office.

## 3. Estado de partida
- **Writer:** comentarios con respuestas y resolver (`CommentData` en `writer-core/docx/model.ts`; ancla = marca `comment` en el texto), panel (`ReviewPane.tsx`), control de cambios con aceptar y rechazar, vistas, autor y fecha, comparar; guarda en `.docx`. Sin mencionar, sin editar el comentario de otro, sin filtros por autor.
- **Slides:** `Comment` con autor, iniciales, texto, fecha, posición (x, y) en la diapositiva, `resolved` y `replyTo`; interfaz en `slides/comments.tsx`; guarda `.pptx` (`commentAuthors`).
- **Calc:** solo **notas** (`CellComment`: fila, columna, autor, texto, visible, tamaño); sin respuestas ni resolver; se guardan en `.xlsx`.
- **Diagram:** nada.
- **Tres modelos distintos para lo mismo** (`CommentData`, `Comment`, `CellComment`) y tres interfaces distintas.
- **Nada de lo que escribe la suite se ha abierto en Word, Excel o PowerPoint reales con comentarios**, y Visio no admite aún los de Nova.

## 4. Plan por fases
1. **Núcleo `comment-core`:** modelo del hilo (autor con nombre, iniciales e id, fecha, texto, respuestas, resuelto, menciones), operaciones (añadir, responder, editar, borrar, resolver y reabrir, contar, filtrar por estado y autor, ordenar), identidad del autor compartida (el nombre del usuario que ya existe en Writer pasa a ser de toda la suite), conversión del texto con @menciones, y lectura y escritura de las formas de Office que son comunes (autores y fechas). Sin DOM. Pruebas de biblioteca.
2. **Interfaz compartida y Writer como producto de referencia:** panel de comentarios (lista, filtros, respuestas, resolver, anterior y siguiente, mostrar u ocultar), tarjeta de comentario y globo; Writer migra sus comentarios al núcleo (ancla = rango de texto, igual que hoy) y gana mencionar, editar y filtrar; el `.docx` guarda también `commentsExtended` y `commentsIds`. El control de cambios de Writer se **repasa frente a Word** (lo que falte: cambios de formato, de tabla y movimientos, mostrar por revisor, bloquear el control).
3. **Slides:** migra al núcleo (ancla = diapositiva y posición); comentarios **modernos** de PowerPoint (con hilo) y los antiguos al leer; panel y globos con la interfaz compartida.
4. **Calc:** las **notas** se quedan (como Excel) y se añaden los **comentarios encadenados** (respuestas y resolver) sobre el núcleo; las dos clases conviven y se puede convertir una nota en comentario y al revés; `threadedComments` y `persons` en `.xlsx`.
5. **Diagram:** comentarios sobre formas y sobre la página con la interfaz compartida, y `comments.xml` en `.vsdx`.
6. **Cierre:** comparación con Office real por COM (abrir los `.docx`, `.xlsx`, `.pptx` y `.vsdx` de Nova en Word, Excel, PowerPoint y Visio y comprobar autor, fecha, texto, respuestas, resuelto, ancla y cambios controlados) y lo que salga de ahí; documentación y límites.

Cada fase se hace producto por producto y se prueba antes de pasar a la siguiente.

## 5. Bitácora
### Fase 1 (hecha, 2026-11-20): núcleo `comment-core`
- **Paquete `packages/comment-core`** (sin dependencias ni DOM; 22 pruebas). **Modelo:** `Author` (id estable, nombre, iniciales), `Message` (autor, fecha ISO, texto, fecha de edición) y `Thread<A>` (el comentario y sus respuestas, `resolved`, quién y cuándo lo resolvió, y un **ancla `A` que pone cada producto**: rango de texto, diapositiva y posición, celda o forma).
- **Operaciones** (todas devuelven listas nuevas, nada cambia en su sitio): añadir, responder (**responder a uno resuelto lo reabre**, como Office), editar (anota la fecha; el mismo texto no cuenta), borrar una respuesta (borrar el comentario borra el hilo), resolver y reabrir, borrar todos o solo los resueltos, mover las anclas (`null` borra el hilo), contar, **filtrar** (estado, persona, texto sin mayúsculas ni tildes), ordenar por el orden del ancla de cada producto, anterior y siguiente dando la vuelta.
- **Listas planas** (`threadsFromFlat` y `flatFromThreads`): así guardan los comentarios todos los archivos de Office (cada respuesta apunta al comentario). Una respuesta a una respuesta se une al primero; una respuesta cuyo comentario falta (archivo dañado) pasa a ser un comentario y **no se pierde nada**; un bucle no cuelga; «resuelto» se lee del comentario o de una respuesta que lo lleve.
- **Menciones** (`@Nombre`, el texto sigue siendo texto plano para que cualquier formato lo guarde): buscar menciones (gana el nombre más largo, sin mayúsculas ni tildes; `a@luis.com` no es una mención), personas mencionadas, saber si el cursor está escribiendo una, sugerir y completarla.
- **Personas:** iniciales (hasta tres letras), id estable desde el nombre, autores de un conjunto de hilos. **Fechas:** «hace 5 minutos», «ayer» o la fecha pasada una semana, y la fecha completa para el tooltip.
- **Un solo nombre de usuario para toda la suite** (`apps/suite/src/comments/identity.ts`, 4 pruebas): hasta ahora Writer guardaba `nova.writer.user`, Slides `nova.slides.commentAuthor` y Calc `nova.author`; ahora hay uno (`nova.user`, con nombre, iniciales e id) y **se leen los antiguos una vez** para que nadie tenga que escribirlo otra vez. Writer (`review.ts`), Slides (`comments.tsx`) y Calc (`dlg-data.tsx`, notas) lo usan. Writer ya no tiene su propia función de iniciales.
- **No cambia nada de lo que ve la persona**: los modelos y las interfaces de Writer, Slides y Calc siguen igual hasta sus fases (2, 3 y 4); esta fase no los migra todavía.
**Pruebas:** comment-core 22; app 442 (+4); `e2e-writer-review` 6, `e2e-slides-review` 6, `e2e-writer-spell` 19 y `e2e-calc` 17 sin cambios.
**Límites:** (1) el núcleo todavía **no lo usa ningún producto salvo para el nombre de usuario** (la migración empieza en la fase 2); (2) la identidad es **local** (un nombre en el equipo, sin cuentas): cualquiera puede escribir el nombre de otro, como en Office sin sesión; (3) las menciones son solo texto: no avisan a nadie ni se guardan como menciones del formato (eso se verá con cada formato, fases 2 a 5); (4) «hace N minutos» se calcula al dibujar, no se actualiza solo.


## 6. Estado
Fase 1 hecha.
