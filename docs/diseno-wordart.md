# Diseño: WordArt compartido (Slides, Writer y Calc)

Estado: **aprobado por el usuario (2026-11-15); las 3 fases (motor + Slides, Writer, Calc) HECHAS** (2026-11-15). El dato que faltaba (sección 7) **ya está en el repositorio y validado**. No hay código escrito.
Decisiones del usuario (2026-11-15): **motor compartido**, **deformación real de las letras**, orden **motor → Writer → Calc**.

## 1. Qué es WordArt en Office
Un componente común de la capa de dibujo (DrawingML): una galería de **estilos de texto** (relleno, contorno, sombra, resplandor,
reflejo, relieve) y una **transformación** de texto (`prstTxWarp`, ~40 valores: arcos, círculo, botón, ondas, inclinaciones, embudos…).
Word, Excel y PowerPoint lo alojan en un cuadro de texto o forma. En Office la transformación **deforma los contornos de las letras**
(no las coloca sobre una curva), por eso el resultado se ve «de una pieza».

## 2. Qué hay hoy
- Solo en Slides: `slides-core/src/wordart.ts` (NovaArt: 22 estilos, 10 transformaciones) y `slides/render/warp.tsx` (**texto SVG
  sobre una trayectoria**: aproximado, no deforma letras; el resto de transformaciones se conservan en el archivo pero se ven sin curvar).
- Los tipos (`Clr`, `Fill`, `Ln`, `Effects`, `TextEffects`, `TextWarp`) y su lectura/escritura PPTX viven en `slides-core`.
- Writer solo lee el WordArt antiguo (VML) de las marcas de agua; Calc no tiene nada.

## 3. Lo verificado para la deformación real
- **Contornos de letras:** el navegador no los da, pero la **API de fuentes locales** (`window.queryLocalFonts()`) **funciona en
  Edge** con el permiso `local-fonts` y devuelve los bytes de la fuente (probado: 393 fuentes, Calibri 1,65 MB, cabecera TrueType).
  Hay que leer `glyf`/`CFF` con una biblioteca (propuesta: **opentype.js**, MIT; requiere añadir una dependencia: **se pedirá permiso
  antes**) o con un lector propio mínimo de TrueType (más trabajo, no cubre fuentes CFF).
- **No verificado:** que la app de escritorio (WebView2 dentro de Tauri) conceda `local-fonts` sin aviso o con aviso. Plan B si no:
  una orden de Rust que lea `C:\Windows\Fonts`. Plan C sin fuentes: la transformación actual sobre trayectoria (ver 6).
- **Definición de las transformaciones:** `presetTextWarpDefinitions.xml` (ECMA-376). **No está en el repositorio y no la he podido
  conseguir** (la ruta de LibreOffice da 404 y la búsqueda no la localiza). Ver sección 7.

## 4. Arquitectura: paquete `wordart-core`
Sin interfaz, como `shapes-core`:
1. **Modelo común** (se mueve desde `slides-core`, que lo reexporta para no romper nada): `Clr`, `Fill`, `Ln`, `Effects`,
   `TextEffects`, `TextWarp`, resolución de color con tema.
2. **Catálogo:** estilos de WordArt (los 22 de NovaArt, ampliables) y transformaciones (las ~40, con su nombre en español).
3. **Contornos:** interfaz `FontSource` (`load(familia, negrita, cursiva) → Font | null`) y `layoutText(texto, fuente, tamaño,
   alineación, espaciado) → trazados` (líneas, avance, alineación; sin ligaduras ni escrituras complejas en la primera versión).
   Implementación `LocalFontSource` (API de fuentes locales, con caché) y, en pruebas, una fuente falsa de rectángulos.
4. **Transformación:** evalúa las curvas superior e inferior de cada preset (con sus ajustes) y **aplana** los contornos antes de
   deformarlos (si no, las curvas de Bézier se distorsionan); las variantes «verter»/arco/círculo usan el mapeo polar.
5. **Dibujo:** genera el SVG (relleno sólido o degradado, contorno, sombra, resplandor, reflejo). Relieve 3D: fuera de alcance.
6. **Archivos:** lectura/escritura del marcado. **Ojo, no es el mismo en todos los formatos:**
   - PPTX y XLSX (DrawingML): `a:bodyPr/a:prstTxWarp` y, en `a:rPr`, `a:solidFill|a:gradFill`, `a:ln`, `a:effectLst`.
   - DOCX: `wps:bodyPr/a:prstTxWarp` igual, pero los efectos de texto van como **extensiones de Word 2010** en `w:rPr`:
     `w14:textFill`, `w14:textOutline`, `w14:shadow`, `w14:glow`, `w14:reflection`.

## 5. Anfitriones
- **Slides** (migra primero, sin perder nada): sus 22 estilos y 10 transformaciones y sus pruebas siguen en verde; usa contornos
  cuando hay fuente y la trayectoria actual cuando no.
- **Writer:** un WordArt es un cuadro de texto (`shape` `textbox`) con atributos `wordart` (estilo de texto) y `warp`. Insertar ›
  **WordArt** (galería) y, en la pestaña contextual de forma, un grupo **Estilos de WordArt**: relleno, contorno y efectos de texto,
  y **Transformar**. Se escribe en el texto en el propio cuadro; al confirmar se vuelve a deformar.
- **Calc:** igual sobre `SheetShape` (`textBox`), con la misma pestaña contextual.

## 6. Degradación (si algo falla, no se rompe nada)
Sin fuente disponible → transformación sobre trayectoria (la de hoy) y, si es una de las no dibujables, texto sin curvar con
aviso; el archivo conserva siempre estilo y transformación. Nunca se pierde el texto editable.

## 7. Definición de las transformaciones (RESUELTO)
`packages/wordart-core/data/presetTextWarpDefinitions.xml` (51,6 KB, copiado por el usuario desde el paquete de ECMA-376). Validado:
raíz `presetTextWarpDefinitions`, **40 transformaciones** (textArchDown/Up, textArchDownPour/UpPour, textButton, textButtonPour, textCanDown/Up,
textCascadeDown/Up, textChevron, textChevronInverted, textCircle, textCirclePour, textCurveDown/Up, textDeflate (+Bottom, Top, Inflate,
InflateDeflate), textDoubleWave1, textFadeDown/Left/Right/Up, textInflate (+Bottom, Top), textPlain, textRingInside/Outside,
textSlantDown/Up, textStop, textTriangle, textTriangleInverted, textWave1/2/4). Cada una trae `avLst`, `gdLst`, `ahLst` y `pathLst`.
Sin `rect` ni `cxnLst`.
- **Mismo lenguaje que las formas:** las guías usan las mismas fórmulas (`*/`, `+-`, `pin`, `sin`, `cat2`…) y las trayectorias los mismos
  comandos (`moveTo`, `arcTo`, `cubicBezTo`…). Se **reutiliza el evaluador de `shapes-core`** y su script de compilación (`build-presets.mjs`,
  que hay que arreglar de paso: apunta a un `data/` que no existe) para generar un JSON de transformaciones.
- **Dos modelos de curva:** una trayectoria (p. ej. `textArchUp`: el texto sigue un arco, con las letras giradas) o **dos** (p. ej. `textWave1`: curva
  superior e inferior; el texto se deforma entre ambas = envolvente). Las variantes «Pour» (verter) y los anillos usan arcos.

## 8. Fases y pruebas
1. **Motor** (`wordart-core`): extraer el modelo, catálogo, contornos, transformación y dibujo; Slides migra. Pruebas: envolventes
   sobre contornos sintéticos (identidad en `textPlain`, simetrías, límites), aplanado, diseño de líneas con fuente falsa, ida y vuelta
   de PPTX, y una prueba con una fuente real **solo si existe** en el equipo.
2. **Writer:** nodo/atributos, galería, pestaña contextual, DOCX (`w14:*` y `prstTxWarp`), e2e con captura real.
3. **Calc:** igual con XLSX.
Cada fase termina con typecheck, `pnpm test`, e2e y captura; commit al terminar cada una.

## 9. Riesgos
- **Fidelidad frente a Office** (no se puede comparar con Office real) y rendimiento al deformar mucho texto (caché por texto,
  fuente y transformación).
- **Permiso de fuentes locales** en el escritorio (ver 3).
- **Dependencia nueva** (opentype.js): requiere tu aprobación.
- **Tipos movidos entre paquetes:** refactor grande pero mecánico; `slides-core` reexporta para limitar el impacto.

## 10. Hallazgo aparte
`packages/shapes-core/scripts/build-presets.mjs` lee `../data/presetShapeDefinitions.xml`, pero el XML sigue en `packages/slides-core/data/`:
el script quedó roto al extraer `shapes-core`. No se ha tocado.

## 11. Registro de la fase 1 (hecha, 2026-11-15): motor + Slides
Aprobado por el usuario: el diseño tal cual y la dependencia **opentype.js 2.0.0** (MIT, instalada solo en `wordart-core`).
- `packages/wordart-core`: `types`, `geometry` (aplanado, subdivisión, `Curve` por fracción de longitud con prolongación tangente), `layout`
  (`layoutText`: líneas, avance, kerning, espaciado, alineación), `warpdefs` + `textwarps.json` (las 40 definiciones compiladas con
  `scripts/build-textwarps.mjs` y evaluadas con el evaluador de guías de `shapes-core`, que ahora exporta `baseEnv/formula/val/rad/ellipsePoint`),
  `warp` (`warpText`), `fonts` (`fontFromBytes` con opentype.js y `LocalFontSource` sobre `queryLocalFonts()`), `render` (`wordArtSvg`:
  relleno sólido o degradado, contorno, sombra, resplandor y reflejo) y `catalog` (22 estilos y los 40 nombres en español). 20 pruebas.
- **Cómo se deforma:** *envolvente* (30 transformaciones con dos curvas): el bloque de texto se estira entre la curva superior y la inferior y
  llena la forma; *trayectoria* (`textArchUp`, `textArchDown`, `textCircle`, `textButton`): el texto recorre la curva a todo lo largo, con las
  letras giradas (arco hacia abajo: la línea base sobre la curva; las demás: las letras cuelgan hacia dentro para que el texto quede dentro de
  la forma). Se comprueba que el texto no salga reflejado (se intercambian las curvas si hace falta).
- **Desviación del diseño:** el modelo de estilo del motor es **neutral y ya resuelto** (`WordArtFx`: colores css), no los tipos de `slides-core`
  movidos. Evita acoplar Writer y Calc a Slides; cada producto convierte su estilo (Slides lo hace en `render/warp.tsx`, `toFx`).
- **Slides:** `WarpedText` usa el motor cuando hay fuente y la transformación está en la norma; si no, `PathWarpedText` (el dibujo anterior,
  texto sobre trayectoria). `scripts/e2e-slides-wordart.mjs` (3 comprobaciones, con y sin permiso de fuentes) y capturas revisadas.
- **Verificado a ojo con Calibri real** (banco temporal con las 40): ondas, inflar/desinflar, curvas, cilindros, cascadas, inclinaciones,
  desvanecer, arcos, círculos y anillos. El arco por defecto abarca media circunferencia, así que las letras de los extremos quedan casi verticales
  (es lo que define la norma). **No se ha comparado con Office real.**
- **Simplificaciones:** las transformaciones con varios grupos de curvas (`textDeflateInflate`, `textDeflateInflateDeflate`, `textButtonPour`)
  usan solo el primer grupo para todo el texto (Office reparte las líneas entre grupos); sin ligaduras ni escrituras complejas; sin relieve 3D;
  sin asas de ajuste todavía (los valores de `adj` sí se respetan).
- **No verificado:** el permiso de fuentes locales en la app de escritorio (WebView2 en Tauri); plan B en la sección 3.

## 12. Registro de la fase 2 (hecha, 2026-11-15): Writer
- **Modelo:** atributo `wordart` en el nodo `shape` (`{ fx, warp }`: el estilo neutral de `wordart-core` y la transformación con sus ajustes; `null` = texto normal). Un WordArt es un cuadro de texto, así que se mueve, redimensiona, gira, agrupa y se anota igual que cualquier forma.
- **Motor (`wordart-core`):** `placeText` (colocar sin deformar, para «solo estilo»), `docx.ts` (`w14Fx`, `prstTxWarpXml`, `parseCssColor`, `emuToPx`). 24 pruebas.
- **DOCX (`writer-core`, 2 pruebas nuevas, 156 en total):** al escribir, `a:prstTxWarp` dentro de `wps:bodyPr` y el estilo como extensiones `w14:*` al **final** de `w:rPr` de cada letra del cuadro (orden del esquema: glow, shadow, reflection, textOutline, textFill; `Ctx.fxTail`). Al leer, se toma la transformación del `bodyPr` y el estilo de la primera letra que tenga `w14:*` (el ancho del contorno vuelve con el redondeo a EMU, 1,25 → 1,24997 px).
- **App** (`apps/suite/src/wordart/` compartido con Calc): `engine.ts` (`renderWordArt`, fuentes del sistema una vez por página, caché), `WordArtUi.tsx` (`WordArtPreview`, `WordArtStyleGallery`, `WarpGallery`, `WordArtForm`), `wordart.css`.
- **Writer:** `ShapeView` dibuja el WordArt en un SVG encima del texto (que queda transparente pero clicable); el plugin `wordart-editing.ts` pone `data-editing` mientras el cursor está dentro del cuadro: se ve el texto normal para editarlo y se redibuja al salir. Insertar › Texto › **WordArt** (galería de 22 estilos), pestaña contextual de forma › grupo **Estilos de WordArt** (Estilos, Transformar con las 40 + «Sin transformación», Formato de WordArt…, Quitar WordArt). Cuadro «Formato de WordArt» con relleno liso/degradado, contorno, sombra, resplandor, reflejo y transformación, con vista previa. Textos en inglés registrados.
- **Sin fuente o sin permiso:** no se marca `data-wordart`, así que el texto normal queda visible y el modelo conserva el WordArt (se guarda igual en .docx).
- **e2e** `scripts/e2e-writer-wordart.mjs` (6 comprobaciones, con y sin permiso de fuentes) y capturas revisadas. Verificado: typecheck limpio; todo `pnpm test`; e2e de Writer (19 + shapes + image + page + tables + styles + review + autocorrect + format), Slides y Calc en verde.
- **Un defecto encontrado por el camino:** un componente intermedio como disparador de `PopoverTrigger` no recibe sus propiedades y el menú no se abre; hay que pasar un `<button>` directo.
- **Límites:** la transformación no tiene asas de ajuste (sí se respetan los valores `adj` leídos de un archivo); el estilo se guarda con los efectos de Word 2010 (`w14`), no con los de PowerPoint; con varias letras de estilos distintos solo se usa el de la primera; la fuente, el tamaño y la alineación salen del texto del cuadro. **No se ha abierto en Word real.**

## 13. Registro de la fase 3 (hecha, 2026-11-16): Calc
- **Modelo (`calc-engine`):** `SheetShape.wordart?: { fx, warp }` (el mismo estilo neutral de `wordart-core`; `warp: null` = sin deformar; ausente = texto normal). Un WordArt es un cuadro de texto, así que se mueve, redimensiona, gira, agrupa y se deshace como cualquier forma.
- **Motor:** `wordart-core/src/dml.ts` (`dmlTextFx`, `dmlFill`): el estilo como hijos de `a:rPr` en el orden del esquema (`a:ln`, relleno, `a:effectLst` con glow, outerShdw y reflection), como PowerPoint; en Excel **no** se usa `w14`.
- **XLSX (`xlsx-io/src/shapes-io.ts`):** al escribir, `a:prstTxWarp` dentro de `a:bodyPr` y el estilo en `a:rPr`; al leer, `wordArtOf` toma la transformación del `bodyPr` y el estilo de la primera letra. Un color liso sin transformación ni efectos sigue siendo solo texto con color (no se convierte en WordArt). 2 pruebas nuevas (68 en total).
- **App:** `ObjectLayer.tsx` (`WordArtDraw`: SVG encima de la forma, con el tamaño y el zoom; si no hay fuente, el texto normal sigue visible; al editar se ve el `textarea` normal), `doc-objects.ts` (`insertWordArt`, `setWordArt`), `commands-objects.ts` (`calc.wordart.format/clear`), `dlg-wordart.tsx` (reutiliza `WordArtForm`), cinta: Insertar › Ilustraciones › WordArt (22 estilos) y, en la pestaña «Formato de forma», el grupo «Estilos de WordArt» (Estilos, Transformar con las 40, Formato de WordArt…, Quitar). Los textos en inglés se movieron a `apps/suite/src/wordart/messages.ts` (compartidos con Writer).
- **e2e** `scripts/e2e-calc-wordart.mjs` (7 comprobaciones, con y sin permiso de fuentes; usa el gancho de desarrollo `__novaCalc.xlsxRoundTrip`) y capturas revisadas (arco, degradado con sombra y reflejo, texto editado).
- **Verificado:** typecheck limpio; todo `pnpm test` (xlsx-io 68, wordart-core 24, calc-engine 287, apps/suite 351…); e2e Calc (shapes, general), Writer WordArt y Slides WordArt en verde.
- **Defecto propio por el camino:** las barras de una expresión regular se perdieron al escribir el gancho con un script de shell y Vite devolvió 500 (la página no cargaba); se corrigió con la herramienta de edición.
- **Límites:** el tamaño de letra de Calc se dibuja como en el resto de formas de Calc (puntos tratados como píxeles, igual que el texto normal); un solo estilo por cuadro; sin asas de ajuste de la transformación; los extremos de un arco pueden rozar el borde del cuadro. **No se ha abierto en Excel real.**
