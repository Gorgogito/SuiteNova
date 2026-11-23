# Recorte de pantalla: diseño y plan

Decisiones del usuario (2026-11-23): **producto auxiliar compartido** (`clip-core` + diálogo común); alcance **los de hoy: Writer, Calc, Slides, Mail, Diagram y Notes**; captura **ambas: recorte nativo en la aplicación de escritorio y recorte en un cuadro propio en el navegador**; edición **como Office: insertar, copiar, guardar como PNG y un anotador básico** (sin miniaturas de ventanas).

## 1. Cómo es en Office
- Insertar › Captura (Word, Excel, PowerPoint, Outlook): una galería de ventanas abiertas y **Recorte de pantalla**: la aplicación se oculta, se arrastra una zona sobre la pantalla real y se inserta en el documento. Es una función común de Office; cada programa decide dónde pone la imagen.
- OneNote y Windows (Win+Shift+S) añaden un anotador (lápiz, resaltador, regla, borrador) y copiar al portapapeles.

## 2. Qué hay hoy
- «Captura de pantalla…» en Writer, Calc, Slides, Mail, Diagram y Notes (`images/sources.ts`, `screenshot()`): selector del navegador (`getDisplayMedia`) y **captura completa**, sin recorte.
- Notes tiene su propio recorte de zona (`notes/dlg3.tsx`: `captureScreen`, `ScreenClipDialog`), duplicado y solo probado con una captura simulada.
- Tauri 2 (`apps/suite/src-tauri`) con Rust instalado: se puede añadir un comando nativo.

## 3. Qué se comparte y qué es de cada producto
- **Compartido `packages/clip-core`:** geometría del recorte (zona, ajuste a la imagen, escala de pantalla), modelo de anotaciones (lápiz, resaltador, flecha, rectángulo, borrador, deshacer) y su dibujado a PNG, sin interfaz; con pruebas.
- **Compartido `apps/suite/src/clip`:** diálogo de recorte (zona, anotar, Insertar / Copiar / Guardar PNG), fuente de captura (navegador o nativa) y mensajes en español e inglés.
- **De cada producto:** el comando Insertar › Captura › Recorte de pantalla y dónde se pone la imagen (ya lo hacen con el origen «Captura de pantalla…» de Imágenes).

## 4. Plan en 6 fases
1. **`clip-core` y recorte en el navegador:** geometría, diálogo compartido con zona, copiar y guardar PNG; sustituye el recorte duplicado de Notes.
2. **Anotador:** lápiz, resaltador, flecha, rectángulo, borrador, color, grosor, deshacer.
3. **Productos:** Insertar › Captura › Recorte de pantalla en Writer, Calc, Slides, Mail, Diagram y Notes (texto alternativo, deshacer, e2e en cada uno).
4. **Nativo (Tauri), captura:** comando Rust que oculta la ventana, captura la pantalla (todos los monitores, escala de pantalla) y la devuelve; permisos y respaldo si falla.
5. **Nativo, selección sobre la pantalla real:** superposición a pantalla completa para arrastrar la zona como Office; el navegador sigue con el cuadro propio.
6. **Cierre:** comparación con Office (COM donde se pueda), accesibilidad (teclado: mover y ajustar la zona), rendimiento (pantallas 4K y varios monitores), límites y documentación.

## 5. Límites previstos
- En el navegador la captura exige el permiso y el selector del sistema; no se puede ocultar la ventana ni elegir la zona sobre la pantalla real.
- El recorte nativo solo en Windows (primero); macOS y Linux sin probar.
- Sin miniaturas de ventanas abiertas (decisión del usuario).
- El anotador es básico (no la regla, texto ni difuminado de Windows).

## 6. Bitácora
### Fase 1 (hecha, 2026-11-23): `clip-core` y recorte en el navegador
- **`packages/clip-core`** (10 pruebas): geometría pura de la zona en píxeles de la captura (`rectBetween`, `clampPoint`, `isZone`, `moveRect`, `resizeRect`, `cropBox` con enteros dentro de la captura y nunca vacío, `fitScale`, `clipFileName` con fecha local, `describeSize`).
- **`apps/suite/src/clip`:** `ClipDialog` compartido (elegir la zona arrastrando, moverla arrastrando desde dentro, teclado: flechas, Ctrl+flechas para el tamaño, Mayús de 10 en 10, Supr para quitarla; **Copiar** al portapapeles, **Guardar como PNG** con nombre con fecha, **Insertar**; sin zona se usa la captura entera; el tamaño se anuncia con `aria-live`), `captureScreenCanvas` (selector del navegador; cancelar devuelve `null`, otro fallo da un mensaje claro) y `useRestorePage` (Fluent deja `aria-hidden` en la página si el padre desmonta el diálogo abierto; también se aplicó a `IconsDialog`).
- **Notes** usa ya el diálogo compartido; se quitó su `ScreenClipDialog` duplicado. Los otros cinco productos siguen con la captura completa hasta la fase 3.
- **Pruebas:** `scripts/e2e-clip.mjs` 11/11 (captura simulada de 1600×900: zona en píxeles reales, mover, límites, teclado, guardar solo la zona, copiar, insertar con y sin zona, cancelar, fallo del sistema, sin errores); `e2e-notes-more` sin fallos (se actualizó el selector), `e2e-icons-close`, `e2e-image-sources`, `e2e-calc-icons`; app 450 y `tsc` limpio.
- **Límites:** solo se probó con una captura simulada, no con el selector real de pantallas de Edge/WebView2; en el navegador la ventana de SuiteNova aparece en la captura si se elige su pantalla (el ocultado llega con el modo nativo, fases 4 y 5); copiar al portapapeles depende del permiso del navegador.
