# Diseño: WordArt compartido (Slides, Writer y Calc)

Estado: **propuesta, pendiente de aprobación** (2026-11-15). El dato que faltaba (sección 7) **ya está en el repositorio y validado**. No hay código escrito.
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
