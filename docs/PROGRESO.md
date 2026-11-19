# Progreso de trabajo (para retomar tras un corte)

Este archivo se actualiza en cada avance. Léelo primero al retomar.
Última actualización: 2026-11-15.

## Subproducto en curso: Formas (`shapes-core` + galería común)

Objetivo: tener un catálogo de formas único (como las Formas de Office) compartido por Slides, Calc y Writer.

### Hecho
- [x] Commit `c133fa6`: `packages/shapes-core` creado; catálogo (`presets.json`), `preset.ts`, `custom.ts` extraídos de Slides.
- [x] `shapes-core/src/gallery.ts` + `gallery.test.ts` (sin commit): `resolveKind`, `isLineKind`, `shapeSvg`, categorías.
- [x] `apps/suite/src/shapes/ShapeGallery.tsx` + `shapes.css` (sin commit): galería de la cinta reutilizable.
- [x] Calc: `ribbonObjects.tsx` usa `ShapeGallery`; `calc-engine/objects.ts`, `xlsx-io/shapes-io.ts`, `ObjectLayer.tsx`, `doc-objects.ts`, `print.ts` adaptados.
- [x] Writer: `insertShapeKind` (`commands-objects.ts`), `ShapeView` dibuja con `shapeSvg` (`nodeviews.ts`), `ribbonDef.tsx` con la galería; DOCX reader/writer/shared tocados.
- [x] Verificado 2026-11-15: `pnpm typecheck` limpio; `pnpm test` todo en verde (apps/suite 347, shapes-core 9, writer-core 144, xlsx-io 63); e2e `e2e-calc-shapes` y `e2e-calc` en verde.

- [x] Arreglado: el botón «Cuadro de texto» de Writer ensanchaba el grupo Ilustraciones y colapsaba la cinta a 1280 px (rompía e2e-writer); ahora `iconOnly`. e2e-writer 19/19, e2e-writer-page e image en verde.
- [x] Capturas reales de la galería en Writer y Calc revisadas (9 categorías, insertar elipse en Calc OK).

- [x] Slides migrado a `ShapeGallery` (`slides/ribbonParts.tsx`: `ShapesGallery` es ahora un envoltorio; se quitó la lista duplicada de categorías). Selectores de e2e cambiados a `[data-shape="..."]` (e2e-slides, e2e-slides-objects). Los 9 e2e de Slides en verde, typecheck limpio, captura revisada.
- [x] `docs/LIMITACIONES.md`: sección «Formas comunes».

- [x] Commit `05ebddd` (galería común en Slides, Calc y Writer).
- [x] `scripts/e2e-writer-shapes.mjs` (6 comprobaciones: 9 categorías, insertar 4 formas, dibujo distinto, botón de acción, cuadro de texto editable, ida y vuelta .docx).
- [x] README: `shapes-core` en la tabla y en la estructura.

### Siguiente (orden fijado por el usuario)
1. [x] Puntos de ajuste (amarillos) en Calc y Writer — HECHO: `shapes-core/src/adjust.ts` (adjustHandles, dragAdjust, cleanAdjust, avLstXml, parseGuide) + pruebas; Calc: `SheetShape.adj`, XLSX avLst, tiradores en `ObjectLayer.tsx`, e2e en e2e-calc-shapes; Writer: atributo `adj`, DOCX avLst, tiradores en `ShapeView` (con forma girada), e2e en e2e-writer-shapes. Tests: shapes-core 11, writer-core 145, xlsx-io 64.
2. [x] Rotación en Calc — HECHO: `SheetShape.rotation`, XLSX `rot`, asa de giro y redimensionado en ejes girados (`ObjectLayer.tsx`), campo en `dlg-shape.tsx`, comandos `calc.shape.rotateRight/Left` en el grupo Organizar, impresión girada. Tests: xlsx-io 65; e2e-calc-shapes (asa, comandos, deshacer, redimensionar, diálogo). Lección: en los e2e de Calc los botones de la cinta se localizan con `[data-nv-item="..."]` (getByRole no los halla).
3a. [x] Agrupar formas en CALC — HECHO (2026-11-15): `calc-engine/src/shape-group.ts` (límites, mover, escalar, girar, agrupar; 5 pruebas), `SheetShape.group`, XLSX `xdr:grpSp` (`shapes-io.ts` groupBodyXml/parseGroup, `charts-io.ts` DrawingItem 'group', `writer.ts`, `reader.ts`), `DocObjects` (selectedShapes, toggleShapeSelection, group/ungroup/deleteSelectedShapes/updateShapes; 4 pruebas), `ObjectLayer.tsx` (marco del grupo, startGroup), comandos calc.shape.group/ungroup. e2e en e2e-calc-shapes. Tests: calc-engine 287, xlsx-io 66, apps/suite 351.
3b. [ ] Agrupar formas en WRITER (paso aparte, decidido por el usuario): las formas son nodos inline de ProseMirror; un grupo sería un nodo nuevo con formas dentro y en DOCX `wpg:wgp`. DISEÑO en `docs/diseno-agrupar-writer.md`, APROBADO por el usuario tal cual (2026-11-15). **Fase 1 (núcleo) HECHA**: `shapes-core/src/group.ts`, nodo `shape_group`, DOCX leer/escribir `wpg`, 7 pruebas nuevas (ver sección 12 del diseño). **Fase 2 (interfaz) HECHA** (sección 13 del diseño): selección múltiple Ctrl/Mayús+clic, `GroupView`, comandos Agrupar/Desagrupar con medida del DOM, mover/redimensionar/girar, diálogo, pestaña contextual «Formato de forma», e2e de 10 comprobaciones. Arregló además dos defectos previos (asas que desaparecían al primer movimiento; cursor fuera de un cuadro de texto seleccionado). **Pendiente del subproducto Formas:** imágenes dentro de grupos (decidido dejarlas para después), editar el relleno de una hija sin desagrupar, selección por recuadro, probar en Word/Excel reales. e2e-writer-format («Copiar formato») es intermitente desde antes.

## Subproducto WordArt (2026-11-15)
Decisiones del usuario: motor compartido `wordart-core`, deformación real de letras, orden motor → Writer → Calc; diseño aprobado y opentype.js autorizado. Diseño y registro en `docs/diseno-wordart.md`.
- [x] **Fase 1 HECHA: motor + Slides.** `packages/wordart-core` (40 transformaciones de ECMA-376 con letras reales, dibujo SVG con efectos, catálogo), Slides migrado con respaldo, 20 pruebas + `e2e-slides-wordart.mjs`. Verificado con Calibri real y capturas.
- [x] **Fase 2 HECHA: Writer** (`wordart` en el nodo `shape`, DOCX con `a:prstTxWarp` y `w14:*`, galería Insertar › Texto › WordArt, grupo «Estilos de WordArt», cuadro de formato, edición con texto normal y redibujado al salir; componentes compartidos en `apps/suite/src/wordart/`; `e2e-writer-wordart.mjs` 6 comprobaciones; writer-core 156, wordart-core 24). Detalle en la sección 12 del diseño.
- [x] **Fase 3 HECHA: Calc** (`SheetShape.wordart`; XLSX con `a:prstTxWarp` y `a:rPr` como PowerPoint, sin `w14`; `wordart-core/src/dml.ts`; Insertar › Ilustraciones › WordArt, grupo «Estilos de WordArt» en la pestaña de forma, cuadro de formato; `e2e-calc-wordart.mjs` 7 comprobaciones; xlsx-io 68). Detalle en la sección 13 del diseño. **Subproducto WordArt completo en Slides, Writer y Calc.** Pendiente aparte: abrir en Office real.
- Pendiente de verificar: abrir los archivos en Office real (Word, Excel, PowerPoint). Lo de Tauri y las asas ya está hecho.
- Hallazgo sin arreglar: `shapes-core/scripts/build-presets.mjs` apunta a un `data/` que no existe (el XML está en `slides-core/data`).

## Cómo retomar
1. `git status` y este archivo.
2. Shim de pnpm: crear `pnpm.cmd` con `corepack pnpm %*` en una carpeta del PATH.
3. `pnpm typecheck`, `pnpm test`; dev server (`pnpm dev` en `apps/suite`) y `node scripts/e2e-<producto>.mjs`.

## Otros subproductos de Office (lista del usuario: ver `SubProductos.png` / `Pruductos.png`)
Se abordan de uno en uno; registrar aquí cada uno al empezarlo.
- [x] **Fuentes en Tauri HECHO (2026-11-16):** probado en la app real (WebView2 por CDP): `queryLocalFonts()` no responde (permiso en «prompt»). Plan B implementado: `src-tauri/src/fonts.rs` (`system_fonts`, `system_font_bytes`), `LocalFontSource` con proveedor inyectable, `scripts/probe-tauri-fonts.mjs` (OK: 275 fuentes, Writer dibuja WordArt).
- [x] **Selección por recuadro HECHA (2026-11-16)** en Calc y Writer: modo «Seleccionar objetos» (ver sección 14 de `docs/diseno-agrupar-writer.md`). Pendiente de Formas: imágenes dentro de grupos de Writer (necesita diseño y aprobación), editar relleno de una hija sin desagrupar.
- [ ] **Formas: imágenes en grupos de Writer (opción B) y editar una hija sin desagrupar.** Diseño en la sección 15 de `docs/diseno-agrupar-writer.md`. Fases: B1 modelo+DOCX · B2 interfaz · C editar hija (Calc y Writer). B1 y B2 HECHAS (ver 15.1 del diseño; `e2e-writer-image-groups.mjs`). C HECHA (editar una hija sin desagrupar, Calc y Writer; 15.2 del diseño). **Formas: sin pendientes pedidos.**

## Subproducto SmartArt (2026-11-16)
Decisiones del usuario: motor compartido `smartart-core`, vinculado a los datos, intérprete completo de `layoutDef`, orden motor → Slides → Writer → Calc. Diseño y fases en `docs/diseno-smartart.md`. **Punto abierto:** de dónde sale el catálogo de diseños para crear SmartArt nuevos (propio / exportado de Office con riesgo de licencia / mixto); no bloquea las fases 1-3.
- [x] **Fase 1 HECHA:** `packages/smartart-core` (XML ordenado, `dgm:dataModel`, árbol editable y operaciones, panel de texto, `layoutDef` tipado, estilos, colores, `dsp:drawing`, 5 partes). 27 pruebas, validado con 8 SmartArt reales generados con PowerPoint (`SMARTART_FILES`). Catálogo propio decidido. Detalle en la sección 8 del diseño.
- [x] **Fase 2 HECHA:** motor (`smartart-core/src/engine`): ejes y selectores, árbol de presentación, restricciones y algoritmos `composite snake lin cycle pyra hierRoot hierChild conn sp tx`, texto con ajuste de letra. 45 pruebas; contra 16 SmartArt reales de PowerPoint: coincide dentro de 1,5 pt salvo `vList2` (12-23 pt). Detalle y límites en la sección 8 del diseño.
- [x] **Fase 3 HECHA:** `engine/style.ts` (etiquetas automáticas por nivel, `presStyleIdx/Cnt`, relleno, línea, efectos, `dsp:style`), `renderSmartArt`/`updateSmartArt`. 51 pruebas; el aspecto de los 24 SmartArt reales de PowerPoint coincide exactamente. Límites (degradados, efectos, `span` con >2 colores) en la sección 8 del diseño.
- [x] **Fase 4 HECHA (Slides):** catálogo propio (8 diseños, 3 estilos, 7 colores), puente `slides-core/src/smartart-art.ts` y la interfaz (`SmartArtUi.tsx`, `commands-smartart.ts`): cuadro con galería y vista previa, texto con subniveles, pestaña contextual *Diseño de SmartArt*, doble clic, reajuste al cambiar de tamaño y «Convertir en SmartArt» con el catálogo. PowerPoint real abre los archivos y los recalcula. e2e: `scripts/e2e-slides-smartart.mjs` (5) y la de `e2e-slides.mjs` actualizada.
- [x] **Fase 5 HECHA (Writer):** nodo `smartart` (átomo con las cinco partes), lectura y escritura de `dgm:relIds` y `word/diagrams/*` en `.docx` (Word real lo abre y lo reconoce), cuadro compartido `apps/suite/src/smartart/SmartArtUi.tsx` (Slides y Writer), pestaña *Diseño de SmartArt*, doble clic, e2e `scripts/e2e-writer-smartart.mjs`. Nuevo en `smartart-core`: `host.ts` (operaciones sobre las partes) y `svg.ts` (dibujo como SVG), para Writer y Calc.
- [x] **Fase 6 HECHA (Calc):** `SheetImage.smartart` (las cinco partes; `media` guarda el SVG del dibujo), lectura y escritura de `dgm:relIds` y `xl/diagrams/*` en `.xlsx` (Excel real lo abre y lo reconoce), cuadro compartido, pestaña *Diseño de SmartArt*, doble clic, reajuste al cambiar de tamaño, e2e `scripts/e2e-calc-smartart.mjs`. **Con esto el SmartArt queda en Slides, Writer y Calc.**

## Subproducto Gráficos (2026-11-16)
Decisiones del usuario: motor compartido `chart-core` (Slides y Calc migran), datos de Slides/Writer en rejilla propia con libro mínimo incrustado, todos los tipos de Calc, orden motor → Calc → Slides → Writer. Diseño y fases en `docs/diseno-graficos.md`.
- [x] **Fase 1 HECHA:** `packages/chart-core` (modelo `ChartSpec`, tendencias y estadísticos, opción de echarts, 3D, SVG; `ChartData` como única entrada, sin libro); Calc lo importa con envoltorios (`chartOption.ts`, `chartRender.ts`); 26 pruebas y las 9 e2e de Calc en verde.
- [x] **Fase 2 HECHA:** `chart-core/src/dml` (`chartXml`/`parseChart`, `chartExXml`/`parseChartEx`, tendencias y barras de error, caché `readChartCaches`, libro mínimo `writeGridWorkbook`/`readGridWorkbook`), `ChartSource` y `chartData` genéricos, rejilla (`grid.ts`); `xlsx-io` solo conserva el ancla; Excel real abre el libro mínimo; 33 pruebas en `chart-core`.
- [x] **Fase 3 HECHA:** comprobado con Excel real: los 8 clásicos + 3D abren bien; los 4 de Office 2016 NO abrían (faltaban `chartStyle`/`chartColorStyle`): corregido y verificado; cuadrícula gris; nombres ocultos `_xlchart.*` de los gráficos de Excel se resuelven al leer (10 gráficos de Excel se leen). 73 pruebas en `xlsx-io`.
- [x] **Fase 4 HECHA (Slides):** `ChartEl` = `ChartSpec` + rejilla; `.pptx` con caché y libro mínimo incrustado (PowerPoint real: 10 tipos abren, «Editar datos» abre el libro; gráficos de PowerPoint se leen); cuadro compartido `apps/suite/src/chart/` con todos los tipos; borrados `chartxml/chartw/render/chart` propios. Pendiente: Fase 5 (Writer) y 6 (cierre).
- [x] **Fase 5 HECHA (Writer):** nodo `chart`, `.docx` con parte, libro incrustado y caché; cuadro compartido; Word real abre los 9 tipos probados y edita los datos; e2e nueva. `readChartPart`/`chartParts` pasaron a `chart-core`.
- [x] **Fase 6 HECHA (cierre):** documentación y límites (`LIMITACIONES.md`, `diseno-graficos.md`), regresión completa (typecheck, todas las pruebas y las e2e de Calc, Slides y Writer). **Subproducto Gráficos terminado.**

### Gráficos, segunda ronda: igualar a Office (plan en `docs/diseno-graficos.md` §8)
- [x] **Fase 1 HECHA:** elementos del gráfico (leyenda en 4 posiciones, etiquetas de datos, títulos de ejes, cuadrículas secundarias, ejes, tabla de datos) en motor, DrawingML y Calc; menú «Agregar elemento de gráfico»; Excel real lo abre.
- [x] **Fase 2 HECHA:** formato de serie y de punto (relleno, transparencia, borde, línea, marcadores, color por punto, hueco, superposición, sectores) en motor, DrawingML y Calc; panel compartido; Excel real lo abre.
- [x] **Fase 3 HECHA:** estilos y colores (10 juegos, 8 estilos rápidos propios), formato del área del gráfico y de trazado, fuentes; DrawingML con colores del tema con luminosidad; Excel real lo abre.
- [x] **Fase 4 HECHA:** Slides y Writer con los mismos elementos, formato, estilos y fuentes (cuadro con pestañas y menús de la cinta compartidos); Writer mueve y redimensiona gráficos y SmartArt con el ratón; información emergente en Slides y Writer; PowerPoint y Word reales abren el formato.
- [x] **Fase 5 HECHA:** fidelidad de archivo: fusión de tres vías del XML original con lo editado, libro incrustado original parcheado, Writer y Calc conservan lo que Nova no modela; PowerPoint y Excel reales abren lo reescrito (la comprobación real destapó dos fallos que ya están corregidos).
- [x] **Fase 6 HECHA:** portapapeles entre Calc, Slides y Writer (HTML con tabla de datos y el gráfico entero) y gráficos en `.odp` y `.odt` (objeto de OpenDocument con imagen de respaldo); sin comprobar con LibreOffice (no instalado).
- [x] **Fase 7 HECHA (cierre):** límites y documentación al día, regresión completa y comprobación con Office real (Excel abre tendencias y barras de error). **Segunda ronda de Gráficos terminada.**

## Subproducto Ecuaciones (2026-11-17)
En Office es un componente compartido (OMML, el mismo motor en Word, PowerPoint, Excel, Outlook y OneNote). Diseño y fases en `docs/diseno-ecuaciones.md`.
- [x] **Fase 1 HECHA:** paquete compartido `packages/math-core` (modelo ampliado con estilos de letra, fracciones lineal y sesgada, prefijos, ecuaciones alineadas y recuadros; **formato lineal de Word**; OMML como texto con propiedades por producto); `writer-core` lo reexporta; 14 pruebas.
- [x] **Fase 2 HECHA:** editor estructurado compartido (`math-core/edit.ts` + `apps/suite/src/math/EquationEditor.tsx`): teclado como Word (`/`, `^`, `_`, `\alpha` + espacio), flechas por casillas, galerías de 103 estructuras y símbolos, ratón, deshacer, copiar y pegar; integrado en Writer y Slides, sincronizado con el código LaTeX; e2e nueva. La cinta contextual «Ecuación» pasa a la fase 3 (edición en el documento).
- [x] **Fase 3 HECHA (Writer):** edición de la ecuación en el documento (doble clic, Intro o *Nueva ecuación*), pestaña contextual «Ecuación» con 103 estructuras y los símbolos, OMML original conservado en `.docx` (Word real abre lo reescrito idéntico), `.odt` con fórmulas (MathML) y lector de MathML; e2e nueva.
- [x] **Fase 4 HECHA (Slides):** la ecuación es un cuadro con la fórmula (`ShapeEl.math`), no una imagen: `.pptx` con `a14:m` y la imagen como respaldo (PowerPoint real la abre como ecuación, con su tamaño, y la reescritura de Nova no cambia nada), OMML original conservado, `.odp` con fórmula MathML; se dibuja con MathML en el lienzo, doble clic o Intro abren el cuadro con el editor estructurado y un tamaño en pt; e2e al día.
- [x] **Fase 5 HECHA (Calc):** la ecuación es un cuadro flotante con la fórmula (`SheetShape.math`), no una imagen: `.xlsx` con `a14:m` en el dibujo (cuadro de texto) y la imagen como respaldo (Excel real la abre y la guarda como ecuación; la reescritura de Nova queda idéntica), OMML original conservado; Insertar > Ecuación… con el editor estructurado, tamaño en pt, doble clic para editar, impresión; e2e nueva `scripts/e2e-calc-equation.mjs`.
- [x] **Fase 6 HECHA (Notes, Mail y portapapeles):** Notes usa el editor estructurado compartido en su cuadro «Ecuación…»; el cuerpo de Mail es texto sin formato (la ecuación llega en formato lineal, y las páginas de Notes enviadas por correo llevan el lineal en vez de LaTeX); **portapapeles común** (`math-core/clip.ts` + `apps/suite/src/math/clipboard.ts`): se copia como la ecuación de Word (comentario `msEquation` con el espacio de nombres de 2004, respaldo con MathML y código TeX) y se lee el de Nova, el de Word real y un `<math>` suelto, en Writer, Notes, Slides y Calc; Word real pega 2 ecuaciones con el HTML de Nova y su forma lineal coincide; e2e nueva `scripts/e2e-math-clipboard.mjs` (12).
- [x] **Fase 7 HECHA (cierre):** `LIMITACIONES.md` corregido y con sección propia, Word, PowerPoint y Excel reales abren las 5 ecuaciones de `scripts/real-equations.mjs` como ecuaciones (tamaños 20-36 pt en PowerPoint), regresión completa (tipos, pruebas y e2e). **Subproducto Ecuaciones terminado.** Pendiente: LibreOffice, Outlook y OneNote reales.
- [ ] Fase 6: Notes, Mail y portapapeles entre productos.
- [ ] Fase 7: cierre (documentación, límites, regresión, Office real).

## Subproducto Corrector ortográfico y gramatical (2026-11-17)
En Office es un componente compartido (motor y diccionarios, diccionario personal y Autocorrección comunes; idioma por texto; Excel solo a petición). Diseño y fases en `docs/diseno-corrector.md`.
- [x] **Fase 1 HECHA:** paquete compartido `packages/spell-core` (motor sobre texto plano, palabras que se omiten, idiomas **es-ES, es-MX, es-PE y en**, diccionario personal único); adaptador de ProseMirror y carga de diccionarios en `apps/suite/src/spell/`; Writer, Slides y Notes migrados; 12 pruebas nuevas y una e2e nueva en `e2e-writer-spell`.
- [x] **Fase 2 HECHA:** motor de gramática, puntuación y estilo en `spell-core` (`checkGrammar`, 20 reglas: repetidas, mayúscula inicial, espacios, signos sin pareja y ¿ ¡, concordancia, dequeísmo, queísmo, «haber» impersonal, «a ver», «hecho», muletillas, «a»/«an»…; correcciones por regla); 29 pruebas nuevas. Pendiente: comparación con Word real.
- [x] **Fase 3 HECHA:** interfaz compartida en `apps/suite/src/spell/` (opciones de revisión únicas en `spell-core`, revisión unificada de ortografía y gramática con caché por bloque, subrayado rojo/azul/verde, menú contextual, cuadro F7 único, panel «Editor», opciones, diccionario personal con alta y baja inmediatas); Writer y Notes la usan (Slides, solo las opciones de omisión); 10 pruebas de revisión, 5 de opciones y 10 e2e nuevas.
- [x] **Fase 4 HECHA:** idioma de revisión por texto (marca `lang` y nueva `noproof` en Writer y Notes, `w:lang`/`w:noProof` en .docx; `lang`/`noProof` de cada tramo en .pptx), subrayado mientras se escribe en Notes y en el editor de texto de Slides, menú contextual y comandos de idioma en los tres, panel «Editor» en Writer y Notes; pruebas de idioma por texto en la revisión, de .docx y de .pptx; e2e nuevas en Writer (3), Notes (3) y Slides (1).
- [x] **Fase 5 HECHA:** Autocorrección compartida (lógica común en `spell-core`, una sola lista de reemplazos y un solo cuadro para todos los productos), campos de texto con corrector (`ProofTextarea`: Mail, Plan, Forms y memo de Base), Calc con F7 sobre celdas y autocorrección al escribir en la celda, Notes con autocorrección; 7 pruebas nuevas de autocorrección, 3 de texto sin formato y e2e nueva `e2e-proof-fields` (8).
- [x] **Fase 6 HECHA:** cierre con Word real por COM (50 frases; idioma y «no revisar» de `.docx` correctos en Word; ortografía idéntica en 37/50, las demás son ortografía contextual de Word; `GrammarErrors` devolvió 0 en todo, sin criterio para la gramática). Ver `docs/diseno-corrector.md` y `scripts/word-compare/`. **Corrector terminado (6 fases).**

## Diccionario de sinónimos (`thesaurus-core`, plan en `docs/diseno-sinonimos.md`)
- [x] **Fase 1 HECHA:** motor y datos (es: OpenThesaurus, en: WordNet; 10 pruebas).
- [x] **Fase 2 HECHA:** interfaz compartida (panel «Sinónimos», sinónimos en el menú del corrector, Mayús+F7) y Writer como producto de referencia; e2e `e2e-thesaurus` (10).
- [ ] Fase 3: Writer, Notes y Slides. Fase 4: Mail, Plan, Forms y Base. Fase 5: cierre con Word real.
