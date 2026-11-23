# Buscar y Reemplazar (subproducto compartido)

Decisiones del usuario (2026-11-23): paquete compartido `find-core` + interfaz común; alcance **Writer, Calc, Slides, Notes y Base** (Mail conserva su búsqueda de correos y gana buscar dentro del mensaje que se escribe, fase 5; Diagram, Plan y Forms quedan fuera); funciones **estándar de Office** (sin «Buscar en archivos» ni en varios documentos).

## 1. Cómo es en Office
- **Word:** panel de navegación (Ctrl+F) con resultados en vivo; cuadro «Buscar y reemplazar» (Ctrl+H) con pestañas Buscar, Reemplazar e Ir a. Opciones: coincidir mayúsculas y minúsculas, palabras completas, **usar caracteres comodín** (`?`, `*`, `[abc]`, `<`, `>`, `{n,m}`, `@`), suena como, todas las formas de la palabra, omitir signos y espacios, **caracteres especiales** (`^p`, `^t`, `^l`, `^#`, `^$`, `^w`…), **formato** (fuente, párrafo, estilo), dirección (arriba/abajo/todo), resaltar todo, «Reemplazar» y «Reemplazar todo» con recuento.
- **Excel:** Ctrl+F/Ctrl+H; Buscar dentro de hoja o libro, por filas o columnas, en fórmulas, valores o comentarios, coincidir con todo el contenido de la celda, formato; comodines `?`, `*`, `~`; «Buscar todos» con lista de resultados.
- **PowerPoint:** Buscar y Reemplazar con mayúsculas y palabras completas; reemplazar fuentes aparte.
- **OneNote:** Ctrl+F en la página, Ctrl+E en todas las notas.
- **Ir a** (Ctrl+G): página, sección, línea, marcador, comentario, nota al pie…; en Excel, una celda o nombre.

## 2. Qué hay hoy
- **Writer:** `findPlugin` en `writer/doc.ts` (coincidencias, mayúsculas, palabra completa; incluye texto leído de imágenes por OCR) y panel de navegación.
- **Calc:** `FindDialog` en `calc/dialogs.tsx` con `replaceAll` del documento.
- **Notes:** cuadro propio en `notes/dlg2.tsx` (solo la página).
- **Slides:** `findReplace` propio y «Reemplazar fuentes».
- **Base:** búsqueda en la hoja de datos (`base/dlg-sheet.tsx`).
- **Mail:** solo busca correos (`mail.search`); sin reemplazar.
- Cada uno repite la lógica de mayúsculas, palabra completa y acentos, con resultados distintos.

## 3. Qué se comparte y qué es de cada producto
- **`packages/find-core` (sin dependencias de interfaz):** opciones (`FindOptions`), compilación de la consulta a un patrón (texto literal, comodines de Word, caracteres especiales, expresión regular, ignorar acentos y mayúsculas, palabra completa), búsqueda sobre una lista de «unidades de texto» (cada una con su identificador y su texto), recorrido siguiente/anterior circular, recuento, plantilla de reemplazo (`\1`, `^&`), y el comando «Ir a».
- **`apps/suite/src/find/` (interfaz común):** panel de búsqueda (Ctrl+F, «3 de 12», opciones, siguiente/anterior), cuadro Buscar y reemplazar (Ctrl+H) con pestañas Buscar, Reemplazar e Ir a, lista de «Buscar todos». Habla con un `FindHost`.
- **Cada producto (adaptador `FindHost`):** da sus unidades de texto, resalta una coincidencia, la selecciona y reemplaza dentro de su modelo con su deshacer.
  - Writer: párrafos de ProseMirror (con formato y estilo); Notes: igual, solo la página; Calc: celdas (valor, fórmula o comentario; hoja o libro); Slides: formas, tablas y notas por diapositiva; Base: celdas de la hoja de datos.

## 4. Plan en 6 fases
1. **`find-core`:** opciones, comodines de Word y de Excel, caracteres especiales, regex, acentos, palabra completa, reemplazo con grupos, recorrido, «Ir a»; pruebas.
2. **Interfaz común y Writer:** panel y cuadro compartidos; Writer migra su plugin (resalta todo, buscar por formato y estilo, Ir a página/marcador/comentario…); comparar con Word real por COM (`Find.Execute`).
3. **Notes y Slides:** los adaptadores; Slides busca en formas, tablas y notas; comparar con PowerPoint real.
4. **Calc y Base:** celdas (fórmulas, valores, comentarios, hoja o libro, por filas o columnas, «Buscar todos» con lista); comparar con Excel real.
5. **Mail:** buscar dentro del mensaje que se escribe (y en el que se lee) con el mismo panel; la búsqueda de correos se conserva.
6. **Cierre:** comparación con Office por COM (Word, Excel y PowerPoint), accesibilidad (teclado, anuncios del recuento), rendimiento (documentos grandes), límites y documentación.

## 5. Límites previstos
- Sin «Buscar en archivos» ni en varios documentos abiertos (decisión).
- Sin «suena como» ni «todas las formas de la palabra» de Word (necesitan un analizador del idioma).
- Diagram, Plan y Forms no usan este producto.
- La búsqueda de correos de Mail sigue siendo la suya.

## 6. Bitácora
### Fase 1 (hecha, 2026-11-23): `find-core`
- **Paquete `packages/find-core`** (sin dependencias; enlazado a mano: junction en `apps/suite/node_modules/@suitenova`, `apps/suite/package.json` y `pnpm-lock.yaml`). Un producto da **unidades de texto** (`{ id, text }`: un párrafo, una celda, una forma) y el paquete busca en ellas; en el texto `
` es el párrafo (`^p`), `` el salto de línea (`^l`), `	` la tabulación, `` el salto de página.
- **Cuatro modos:** `normal` (texto con los caracteres especiales de Word: `^p ^t ^l ^m ^s ^~ ^+ ^= ^# ^$ ^w ^? ^^` y `^nnn`), `wildcards` (comodines de Word: `? * [a-z] [!a] < > {n;m} @ ( ) \`), `excel` (`? * ~`) y `regex` (JavaScript). Opciones: mayúsculas, palabra completa (no con comodines, como Word), ignorar acentos (`foldAccents` letra a letra, así las posiciones son las del texto original) y «todo el contenido de la celda».
- **Funciones:** `compileQuery`, `findInText`, `findAll`, `nextIndex` (siguiente/anterior con vuelta), `indexOfSelection`, `counter` («3 de 12»), `expandReplacement` y `replaceAllInText` (`^&`, ``, `$1`…), `parseGoToNumber` (5, +3, -2) y `parseCellRef` (`B12`, `A1:C5`). Máximo 100 000 coincidencias.
- **Comparado con Word real** (`scripts/office-find/`: `cases.mjs write` → `word-find.ps1` por COM (`Find.Execute`) → `cases.mjs compare`): **30 casos, 30 iguales.** Dos diferencias reales encontradas y corregidas: **`@` de Word toma lo mínimo tras un carácter o un conjunto** (`ab@` encuentra `ab`, no `abb`; `ab@>` sí encuentra la palabra) **y todo lo posible tras un grupo** (`(b)@` encuentra `bbb`); y **`{n;m}` usa el separador de listas del sistema** (punto y coma en español; `{2,3}` da error en Word): se leen los dos.
- **Pruebas:** 26 en `find-core`.
- **Sin comparar con Excel:** los comodines de Excel (`* ?` voraz, `~`) son lo conocido, no se comparó con Excel real (fase 4).
