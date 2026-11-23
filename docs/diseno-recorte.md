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

### Fase 2 (hecha, 2026-11-23): anotador
- **`clip-core/annotate.ts`** (16 pruebas nuevas, 26 en total): marcas en píxeles de la captura. Herramientas lápiz, resaltador (4 veces más ancho y al 40 % de opacidad), flecha (con punta que nunca es mayor que la flecha) y rectángulo (solo contorno); seis colores (rojo, amarillo, verde, azul, negro, blanco) y tres grosores (2, 4 y 8 px **de pantalla**, que el diálogo convierte a píxeles de la captura: la marca se ve igual de gruesa aunque la captura sea de 4K). Borrador que quita la marca entera y que, al arrastrar rápido, revisa también el camino entre dos eventos del puntero (`eraseAlong`). Historial con deshacer y rehacer (cada marca y cada arrastre del borrador es un paso).
- **Diálogo:** barra de herramientas (herramienta, color, grosor, Deshacer, Rehacer, Quitar anotaciones), Ctrl+Z y Ctrl+Y, y el estado anuncia «n anotaciones». **Zona** sigue siendo la herramienta inicial. Las marcas entran en lo que se copia, guarda o inserta, recortado a la zona.
- **Pruebas:** `scripts/e2e-clip-marks.mjs` 12/12 (lee los píxeles del PNG guardado: lápiz, grosor, resaltador transparente, rectángulo hueco, punta de la flecha, borrador de un solo paso, deshacer/rehacer sin duplicarse, zona que recorta las marcas, insertar en Notes); `e2e-clip` 11/11; `e2e-notes-more` sin fallos; `tsc` limpio.
- **Límites:** las marcas **solo se dibujan con el puntero** (con el teclado solo se elige la zona); no hay texto, regla, difuminado ni mover una marca ya dibujada (se borra y se vuelve a dibujar); el lápiz no suaviza el trazo ni admite presión; la flecha tiene la punta fija. Las marcas se funden con la imagen: no quedan como objetos editables en el documento.

### Fase 3 (hecha, 2026-11-23): los seis productos
- **`useScreenClip`** (`apps/suite/src/clip`): captura (selector del sistema) → diálogo compartido → el PNG llega al producto como un archivo, igual que cualquier imagen. `useImageSources` lo usa, así que **Writer, Calc, Diagram y Mail** lo tienen con su botón de siempre; **Slides** lo usa directo (sustituye su captura propia) y **Notes** conserva su integración de la fase 1.
- **Cambio visible:** el botón «Captura de pantalla…» pasa a llamarse **«Recorte de pantalla…»** en todos (Slides: «Recorte de pantalla»); ya no inserta la captura entera de golpe, abre el diálogo (con «Insertar todo» si no se elige zona). El archivo se llama «Recorte de pantalla 2026-11-23 10-30-00.png», que es también su texto alternativo.
- **Pruebas:** `scripts/e2e-clip-products.mjs` 10/10 (en cada producto: abre, Cancelar no inserta, y la zona de 320×180 y la marca roja elegidas son lo que queda en el documento, leído en píxeles); se actualizaron `e2e-image-sources` (18/18) y `e2e-slides-pictures`; `e2e-clip` 11/11, `e2e-clip-marks` 12/12, iconos y la app (450) sin fallos; `tsc` limpio.
- **Lo que no cambia:** «Datos desde imagen…» de Calc sigue tomando la captura entera con su botón propio (es para leer una tabla, no para insertar); en el navegador el selector del sistema es el de Edge/WebView2.
- **Límites:** sigue siendo el recorte sobre una captura ya hecha (la ventana de SuiteNova puede salir en ella); solo se probó con una pantalla simulada y con el modo de captura automática de Edge, no con el selector real elegido a mano.

### Fase 4 (hecha, 2026-11-23): captura nativa (Tauri)
- **Rust (`apps/suite/src-tauri/src/clip.rs`, dependencias `xcap` e `image` solo en Windows):** `clip_monitors` (monitores en píxeles físicos, escala, principal) y `clip_capture(monitor, hide)`: oculta **todas** las ventanas de SuiteNova, espera 350 ms a que el compositor las quite, captura el monitor (el de la ventana que lo pide por defecto), devuelve el PNG como bytes (sin JSON) y vuelve a mostrar las ventanas y a dar el foco **pase lo que pase** (`Drop`). En los demás sistemas los comandos devuelven un error claro.
- **Web (`clip/native.ts`, `clip/source.ts`):** en la aplicación de escritorio `captureScreenCanvas` pide la captura nativa; si falla (o fuera de la aplicación de escritorio) cae al selector del navegador. El diálogo es el mismo.
- **Comprobado con la aplicación real** (`scripts/e2e-clip-native.mjs`, 7/7: se arranca el `.exe` de depuración con WebView2 y un puerto de depuración remota y se maneja con Playwright): lista de monitores; «Recorte de pantalla…» abre el diálogo con la captura del **monitor entero en píxeles físicos (2560×1440 en esta máquina)**; con la aplicación oculta la captura difiere más del 5 % de la hecha sin ocultarla (la aplicación no sale); una zona marcada con un rectángulo se inserta en Writer con el tamaño exacto de la zona; Cancelar devuelve la aplicación y el foco. También `cargo test` (2 pruebas: PNG válido del tamaño del monitor y error —no pánico— con un monitor inexistente) y `e2e-clip` 12/12 (con un `__TAURI_INTERNALS__` simulado: pide `clip_capture` con `hide: true` y, si falla, cae al selector del navegador).
- **Límites:** solo Windows; con varios monitores se captura el de la ventana (elegir otro llega con la selección sobre la pantalla real de la fase 5); en esta máquina hay un solo monitor, así que **varios monitores no se han probado**; no se captura una ventana concreta (solo monitores enteros); las ventanas de otros programas con contenido protegido contra capturas salen en negro; el parpadeo al ocultar y mostrar la aplicación (unos 0,4 s) es visible. macOS pediría permiso de grabación de pantalla (sin probar).
