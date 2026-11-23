# Temas (subproducto compartido)

Decisiones del usuario (2026-11-23): un paquete compartido `theme-core` + interfaz común; alcance **Writer, Calc y Slides**; funciones **estándar de Office** (galería, colores, fuentes, efectos, personalizados, archivos `.thmx`, restablecer, y que las paletas usen el tema).

## 1. Cómo es en Office
- **Es un componente compartido.** Un tema de documento (DrawingML `theme1.xml`: esquema de **12 colores**, esquema de **fuentes** de títulos y de cuerpo, esquema de **efectos**) es el mismo en Word, Excel, PowerPoint y Outlook; viaja en `word/theme/theme1.xml`, `xl/theme/theme1.xml` y `ppt/theme/theme1.xml`, y como archivo `.thmx` que cualquiera de ellos abre y guarda. «Tema de Office» es el predeterminado.
- **Cada programa lo aplica a su manera:** Word, a los estilos y a los colores y fuentes «del tema» (los demás colores no cambian); Excel, a los estilos de celda, tablas, gráficos y formas; PowerPoint, al patrón de diapositivas, que además trae diseños y fondos.
- **Pestaña:** Word *Diseño* (Temas, Colores, Fuentes, Efectos), Excel *Disposición de página* (igual), PowerPoint *Diseño* (galería de temas con variantes, Colores, Fuentes, Efectos, Estilos de fondo). Cada galería tiene «Personalizar colores…», «Personalizar fuentes…», «Buscar temas…», «Guardar tema actual…» y «Restablecer».
- **Colores del tema** en el selector de colores: 10 columnas (Fondo 1, Texto 1, Fondo 2, Texto 2 y 6 énfasis) con 5 tintes cada una; al cambiar el tema esos colores cambian solos, los «colores estándar» y los personalizados no.
- **No confundir** con el tema de la aplicación (Colorido, Gris oscuro, Negro, Blanco): ese es de la interfaz y ya existe aquí (sistema, claro, oscuro, contraste).

## 2. Qué hay hoy
- **Slides:** modelo completo en `slides-core` (`Theme`: `colors`, `fonts`, `fmt`), 10 esquemas de colores y 7 de fuentes, aplicar plantillas, variante oscura, `.pptx`; `themes.ts`, `pptx/themexml.ts`.
- **Writer:** solo lee las fuentes de `theme1.xml` (`asciiTheme`); los colores del selector son fijos (`OFFICE_PALETTE` de `table-core`); no guarda el tema ni lo cambia.
- **Calc:** `xlsx-io` lee los colores del tema como una lista para resolver colores de celdas, pero el libro no guarda el tema ni se puede cambiar.
- **Tablas, gráficos y formas** (`table-core`, `chart-core`, `shapes-core`) tienen paletas «Office» propias, no leen el tema del producto.
- Notes, Mail, Diagram, Plan, Forms y Base: sin temas de documento (fuera de alcance).

## 3. Qué se comparte y qué es de cada producto
- **`packages/theme-core` (sin interfaz):** el modelo `Theme` (12 colores, fuentes mayor y menor, efectos), el catálogo (esquemas de colores y de fuentes, efectos, temas completos de Office), lectura y escritura de `theme1.xml` y de `.thmx` (zip con `theme/theme/theme1.xml`), resolución de color de tema con tintes y sombras (`schemeClr` + `lumMod`/`lumOff`), derivar paletas (selector de colores, énfasis para tablas, gráficos y formas) y temas personalizados (crear, nombrar, guardar en la configuración del programa).
- **`apps/suite/src/themes/` (interfaz común):** galería de temas con miniatura, galerías de colores, fuentes y efectos, cuadros «Personalizar colores…» y «Personalizar fuentes…», «Guardar tema actual…», «Buscar temas…» (abrir `.thmx`), «Restablecer»; habla con un `ThemeHost`.
- **Cada producto (adaptador `ThemeHost`):** da su tema actual, lo cambia con su deshacer, y cuenta qué se repinta (Writer: estilos y colores/fuentes del tema en el texto; Calc: estilos de celda, tablas, gráficos y formas; Slides: el tema del patrón de diapositivas).

## 4. Plan en 6 fases
1. **`theme-core`:** modelo, catálogo, `theme1.xml` y `.thmx` (leer y escribir), colores con tintes, paletas derivadas, personalizados; pruebas; Slides se apoya en él (sin cambiar lo que ya hace).
2. **Interfaz común y Slides:** galerías, cuadros y `ThemeHost`; Slides migra a la parte compartida (galería de temas, colores, fuentes, efectos, `.thmx`); comparar con PowerPoint real por COM (`ThemeColorScheme`, `ThemeFontScheme`, `.thmx`).
3. **Writer:** el tema en el documento (`word/theme/theme1.xml` se lee y se guarda entero), pestaña *Diseño* con Temas, Colores, Fuentes y Efectos; colores «del tema» en el texto, sombreados, bordes y tablas; comparar con Word real.
4. **Calc:** el libro guarda su tema (`xl/theme/theme1.xml`), pestaña *Disposición de página*; colores de tema en celdas, tablas, gráficos y formas; comparar con Excel real.
5. **Paletas compartidas:** el selector de colores de todos los productos del alcance muestra los colores del tema (10 columnas con 5 tintes), y tablas, gráficos y formas usan los énfasis del tema del documento (`table-core`, `chart-core`, `shapes-core`).
6. **Cierre:** comparación con Office por COM (Word, Excel y PowerPoint), accesibilidad (teclado, nombres de colores), rendimiento (cambiar el tema en documentos grandes), límites y documentación.

## 5. Límites previstos
- Notes, Mail, Diagram, Plan, Forms y Base no usan temas de documento (decisión).
- Sin las variantes (cuatro por tema) de PowerPoint para los temas descargables de Office ni «Buscar temas» en línea: solo archivos `.thmx` locales.
- Los efectos del tema (sombras, bordes, rellenos 3D) se guardan y se aplican en Slides y en las formas; en Word y Excel se conservan en el archivo aunque no todos se dibujen.
- El tema de la aplicación (claro, oscuro, contraste) sigue siendo aparte.

## 6. Bitácora
(sin fases hechas)
