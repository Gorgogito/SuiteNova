# Gráficos: motor compartido (`chart-core`)

Estado: diseño aprobado (2026-11-16). Fases al final; cada fase termina con pruebas, documentación y commit.

## 1. Cómo lo tiene Office
- **Un solo componente para los tres productos.** Word, Excel y PowerPoint comparten el motor de gráficos y el mismo formato de archivo (`c:chartSpace`, DrawingML Chart). Un gráfico copiado de Excel a Word o PowerPoint conserva todo.
- **Lo que cambia es el origen de los datos.** En Excel las series apuntan a rangos de la hoja. En Word y PowerPoint el gráfico lleva dentro un libro de Excel incrustado (`embeddings/…xlsx`) y las mismas referencias («Hoja1!$B$2:$B$5») más una copia de los valores (`c:numCache`, `c:strCache`); «Editar datos» abre ese libro.

## 2. Cómo lo tenemos hoy (cada producto por su cuenta)
- **Calc** (el más completo): `calc-engine/src/charts.ts` (modelo `ChartDef`: 14 tipos, combinados, eje secundario, 3D, estadísticos, tendencias y barras de error con `chart-fit.ts`), `apps/suite/src/calc/chartOption.ts`, `chartStatOption.ts`, `chart3d.ts`, `chartRender.ts` (echarts a SVG, 3D propio), diálogos y capa de objetos; lectura y escritura de DrawingML en `xlsx-io` (`charts-io.ts`, `chartex-io.ts`, `chart-fit-io.ts`, ~900 líneas).
- **Slides:** otro modelo (`ChartModel`, 20 campos), otro lector y escritor de `.pptx` (`pptx/chartxml.ts`, `chartw.ts`, 257 líneas), un dibujo SVG propio (`render/chart.tsx`, sin 3D) y un cuadro con rejilla (`ChartDialog`). Comparte con Calc solo la idea.
- **Writer:** nada; al leer un `.docx` los gráficos se descartan con un aviso.

## 3. Decisiones del usuario
1. **Motor compartido** `chart-core`; Slides y Calc se migran a él.
2. **Datos de Slides y Writer: rejilla propia en un cuadro**, guardada con valores en caché y un libro mínimo incrustado para que Office pueda editarlos.
3. **Todos los tipos de Calc** en Slides y Writer.
4. **Orden:** motor → Calc → Slides → Writer.

## 4. Arquitectura
`packages/chart-core` (sin dependencias de producto; depende de `echarts` y `jszip`):
- **`model`**: `ChartDef` sin posición (tipo, título, leyenda, apilado, ejes, 3D, radar, cotizaciones, superficie, cascada, histograma, caja y bigotes, series con tendencias y barras de error). Es el de `calc-engine` hoy, movido; Calc añade encima su posición en la hoja (`x y width height`).
- **`source`**: la **fuente de datos** como interfaz: `readRange(ref) → { values, labels }`. Calc la implementa con su libro; Slides y Writer, con una **rejilla** (`grid: string[][]` en la «Hoja1» propia del gráfico). Así las series de los tres productos usan referencias de rango, igual que Office, y la rejilla es lo que se incrusta como libro.
- **`data`**: `chartData(def, source, locale) → { categories, series }` (hoy `chartOption.ts#chartData`).
- **`option`**: `chartOption(def, data, palette)` para echarts y `chartStatOption`; **`chart3d`**; **`render`** (`chartSvg`, `echarts.use`). Es lo que hoy está en `apps/suite/src/calc`, movido sin cambiar su comportamiento.
- **`fit`**: tendencias y barras de error (hoy `calc-engine/src/chart-fit.ts`).
- **`dml`**: lector y escritor de `c:chartSpace` y de `cx:chartSpace` (gráficos de Office 2016) entre `ChartDef` (+ caché) y XML, con las referencias y la caché. Sustituye a `xlsx-io/charts-io.ts`, `chartex-io.ts`, `chart-fit-io.ts` y a `slides-core/pptx/chartxml.ts`/`chartw.ts`. `xlsx-io` conserva solo el ancla del dibujo y las relaciones.
- **`workbook`**: escribe y lee el **libro mínimo** incrustado (una hoja con la rejilla; `jszip`, a mano, sin depender de `xlsx-io`).
- **Interfaz compartida** `apps/suite/src/chart/`: el editor de rejilla, el selector de tipo con miniaturas y los formatos de eje/título/leyenda que hoy están en `dlg-chart*.tsx`, para que los usen los tres productos.

Adaptadores: Calc (`ChartDef` + posición, datos del libro), Slides (`ChartEl` con `ChartDef` + rejilla, `.pptx` con la parte `chart`, el libro y la caché), Writer (nodo `chart`, átomo como el SmartArt, `.docx` con `c:chart`, el libro incrustado y la caché).

## 5. Fases
1. **Motor:** crear `chart-core`; mover modelo, ajustes, opciones de echarts, 3D y render; `calc-engine` y Calc lo importan. Sin cambios visibles; todas las pruebas y e2e de Calc deben seguir igual.
2. **Formato:** `dml` (lectura y escritura de `c:chartSpace`/`cx:chartSpace` con caché) y `workbook`; `xlsx-io` lo usa y se borra su código propio. Pruebas de ida y vuelta con los archivos de las pruebas actuales y gráficos reales de Excel.
3. **Calc:** fuente de datos del libro y limpieza; comprobar contra Excel real.
4. **Slides:** migrar `ChartEl`; rejilla, todos los tipos, `.pptx` con libro incrustado; borrar `chartxml/chartw` y el SVG propio; comprobar con PowerPoint real.
5. **Writer:** nodo `chart`, cuadro, `.docx`; comprobar con Word real.
6. **Cierre:** documentación, límites, regresión completa.

## 6. Límites previsibles (a decir sin rodeos)
- Echarts no dibuja todo igual que Office (estilos de gráfico, efectos, gradientes de serie, etiquetas de datos muy personalizadas); lo que no se entiende se **conserva en el archivo** al reescribirlo cuando sea posible y, si no, se avisa.
- El libro incrustado es mínimo (una hoja con la rejilla, sin formato ni fórmulas); Excel lo abre y lo edita, pero no es el libro original si el archivo traía uno grande (se avisa; al editar los datos en Nova se sustituye).
- 3D con el dibujo propio de Calc (no es el de Office); sin animación.
- Un gráfico de Calc pegado en Slides o Writer pierde el vínculo con el rango (queda con sus valores).

## 7. Registro de fases
### Fase 1 (hecha, 2026-11-16): motor — `packages/chart-core`
- **Qué se movió** (sin cambiar su comportamiento): el modelo (`model.ts`: `ChartSpec` = el gráfico sin id ni posición, y `ChartType`, `ChartAxis`, `Chart3D`, `ChartSeries`, `SeriesType`, `StockKind`…), las tendencias y barras de error (`fit.ts`, de `calc-engine/chart-fit`), los estadísticos de cascada, histograma y caja (`stat.ts`, de `chart-stat`), la opción de echarts (`option.ts` y `statOption.ts`), el 3D propio (`chart3d.ts`) y el dibujo a SVG (`render.ts`: `chartSvg`, `chart3dFor`, `is3D`, `echarts`). Los archivos se movieron con `git mv` para conservar el historial.
- **Fuente de datos:** `ChartData { categories, series }` (`data.ts`) es lo único que el motor necesita; **no sabe nada de libros ni de rangos**. Calc sigue leyendo su libro en `apps/suite/src/calc/chartOption.ts` (`chartData`, con `readRange`) y delega en `chart-core`; `chartRender.ts` es el envoltorio equivalente.
- **`calc-engine`:** `ChartDef = ChartSpec + { id, x, y, width, height }`; reexporta los tipos, `DEFAULT_3D` y las funciones de ajuste y estadística desde `chart-core`, de modo que el resto del código no cambió.
- **Formato de números:** en lugar de depender de `calc-engine`, `chart-core` tiene un formateador **registrable** (`setChartNumberFormatter`, por omisión uno general); Calc registra el suyo (`formatValue`) y Slides y Writer registrarán el mismo desde la app.
- **Pruebas:** las 23 de ajuste y estadística pasaron a `chart-core` y se añadieron 3 (opción de echarts y SVG de columnas, circular, líneas y 3D con datos literales, y el formateador); `calc-engine` queda con 264. Total sin cambios en el resto (287 = 264 + 23). Las 9 e2e de Calc (incluidas las de gráficos con tendencias, barras de error y estadísticos) pasan igual.
- **Pendiente para la fase 2:** `chartPresets.ts` y los cuadros (`dlg-chart*.tsx`) siguen en Calc; pasan a la interfaz compartida al llegar a Slides.


### Fase 2 (hecha, 2026-11-16): formato DrawingML, caché y libro mínimo
- **`chart-core/src/dml/`:** `chartspace.ts` (`chartXml` y `parseChart` de `c:chartSpace`), `chartex.ts` (`chartExXml` y `parseChartEx` de `cx:chartSpace`: cascada, embudo, histograma, cajas y bigotes), `fitio.ts` (tendencias y barras de error), `xml.ts`. Es el código que estaba en `xlsx-io` (`charts-io`, `chartex-io`, `chart-fit-io`), movido con `git mv` y **desacoplado del libro**: el escritor ya no recibe `(libro, hoja)` sino una `ChartSource`. `xlsx-io` conserva solo lo que es de la hoja: el ancla del dibujo (`drawingXml`, `anchorToRect`) y las relaciones.
- **`source.ts`:** `ChartCell`, `ChartSource { range(ref) → { values, labels } }` y `chartData(spec, fuente, idioma)` (movido de Calc). `calc-engine` aporta `chartSource(libro, hoja, idioma)`; Calc y el escritor de `.xlsx` la usan.
- **`grid.ts`:** la **rejilla** de Slides y Writer (`ChartGrid`), `gridSource`, `parseRef`/`refOf` (`Sheet1!$B$2:$B$5`), `specFromGrid` (una serie por columna, nombres en la primera fila, categorías en la primera columna) y `sampleGrid`.
- **`dml/cache.ts`:** `readChartCaches` lee de un `c:chartSpace` o `cx:chartSpace` todos los pares referencia → valores en caché, para reconstruir la rejilla de un gráfico de Word o PowerPoint sin su libro.
- **`dml/workbook.ts`:** `writeGridWorkbook` y `readGridWorkbook`: el libro mínimo (una hoja, celdas en línea, sin estilos). **Excel real lo abre** (COM: hoja «Sheet1», números, texto con `&` y `<`, y booleanos correctos).
- **Pruebas:** 7 nuevas en `chart-core` (referencias, series desde la rejilla, `c:chartSpace` con caché, ida y vuelta, caché sin libro, gráfico de Office 2016, libro mínimo); las 70 de `xlsx-io` (incluidas las de ida y vuelta de gráficos) y las e2e de Calc siguen en verde sin tocarlas.
- **Límites:** `parseChart` sigue sin conservar lo que Nova no modela (estilos de gráfico, efectos, etiquetas de datos personalizadas); al reescribir un gráfico que viene de otro programa se pierde. Las caché del lector solo cubren valores y cadenas (no formatos de número por punto).

### Fase 3 (hecha, 2026-11-16): Calc sobre el motor y comprobación con Excel real
- **Calc ya usaba el motor desde la fase 1**; esta fase era la limpieza y la comprobación. No quedó código de gráficos duplicado: `xlsx-io` solo tiene el ancla del dibujo, `calc-engine` el adaptador del libro (`chartSource`) y `apps/suite/src/calc` los envoltorios y los cuadros.
- **Excel real (COM) por primera vez:** un libro con los 8 tipos clásicos abre y da el tipo y las series esperados (columnas agrupadas, barras, líneas con marcadores, circular, áreas, dispersión, anillo, radar), más el 3D. **Hallazgos y correcciones:**
  1. **Los 4 gráficos de Office 2016 (cascada, embudo, histograma, cajas y bigotes) hacían que Excel no abriera el libro.** Se aisló por partes: Excel exige las partes `chartStyle` y `chartColorStyle` de cada `chartEx` (sin ellas ni abre). Se escriben ahora, mínimas (el estilo con todas sus entradas en el orden del esquema, los seis acentos en ciclo), con sus relaciones y tipos de contenido (`chartex.ts`: `chartExStyleXml`, `chartExColorsXml`).
  2. **Sin relleno en los puntos de datos, las columnas de una cascada salían sin barras:** el estilo mínimo ahora rellena `dataPoint` con el color de la serie.
  3. **La cuadrícula salía negra y gruesa:** ahora se escribe en gris claro (`D9D9D9`), como la de Excel.
- **Lectura de lo que crea Excel:** un libro con 10 gráficos hechos por Excel (cascada, columnas con línea de tendencia, líneas, circular, dispersión, embudo, histograma, cajas y bigotes, columnas 3D) se lee entero. Excel guarda las fórmulas de los gráficos de Office 2016 como **nombres ocultos `_xlchart.v1.N`** que Nova ignoraba (el gráfico quedaba vacío); ahora el lector los sustituye por el rango que nombran.
- **Pruebas:** 3 nuevas en `xlsx-io` (partes de estilo y colores, cuadrícula, nombres ocultos de Excel); 73 en total. Las e2e de Calc de gráficos siguen en verde.
- **Límites:** las cajas y bigotes necesitan varios valores por categoría para verse como cajas; el estilo de gráfico es el mínimo (colores del tema, no los estilos de Office); un gráfico de Excel con estilos o efectos propios los pierde al reescribirse.

### Fase 4 (hecha, 2026-11-16): Slides sobre el motor y comprobación con PowerPoint real
- **Modelo:** `ChartEl` ahora es `{ chart: ChartSpec, grid: ChartGrid, raw? }`; desaparecen `ChartModel`, `ChartSeries`, `pptx/chartxml.ts`, `pptx/chartw.ts` y el dibujo propio `slides/render/chart.tsx` (SVG a mano, sin 3D). El gráfico se dibuja con `chart-core` (`ChartPicture`: `chartSvg` con los acentos del tema), así que **Slides tiene todos los tipos de Calc**: 3D, cotizaciones, superficie, combinados, cascada, embudo, histograma y cajas y bigotes.
- **`.pptx`:** `slides-core/src/pptx/chartio.ts`. Al **leer**, la parte del gráfico se interpreta con `parseChart`/`parseChartEx` y la rejilla sale de los valores en caché (`gridFromCaches`, nueva en `chart-core`), sin abrir el libro incrustado. Al **escribir** un gráfico nuevo o editado se generan la parte, sus relaciones y el libro mínimo incrustado (`writeGridWorkbook`, generado antes de escribir porque es asíncrono), con `c:externalData`; los de Office 2016 llevan además estilo, colores y un `mc:AlternateContent` con aviso para versiones antiguas. Un gráfico leído y no editado se escribe **byte a byte igual** (`raw`).
- **Gráficos de Office 2016 sin fórmulas:** PowerPoint (y Word) guardan a veces los datos solo dentro del gráfico (`cx:lvl`, sin `cx:f`). `parseChartEx` les da referencias propias (categorías en A, una serie por columna) y devuelve los valores en `literals`.
- **Interfaz compartida `apps/suite/src/chart/`:** `presets.ts` (movido de Calc: los 30+ tipos), `draft.ts` (borrador del cuadro y `buildChart`, que conserva el formato de las series que ya había), `ChartEditor.tsx` (tipo agrupado, título, leyenda, rejilla y vista previa) y `ChartPicture.tsx`. Writer usará lo mismo en la fase 5.
- **PowerPoint real (COM):** un `.pptx` con 10 gráficos (columnas, circular, líneas, dispersión, cascada, embudo, histograma, cajas y bigotes, columnas 3D y radar) abre sin reparar y da los 10 tipos esperados (51, 5, 65, -4169, 119, 123, 118, 121, 54, -4151); **«Editar datos» abre el libro incrustado** con la hoja, los nombres de series y los valores (clásico y cascada). Gráficos creados por PowerPoint (columnas, circular y cascada) se leen con sus datos, y reescritos por Nova vuelven a abrir.
- **Pruebas:** 4 nuevas en `slides-core` (parte con caché y libro, todos los tipos clásicos, cascada con estilo y alternativa, sin tocar hasta editar), 3 en `apps/suite` (borrador), 1 en `chart-core` (gráfico sin fórmulas); la e2e de Slides cubre el cuadro nuevo (tipo circular, edición, cascada y su archivo).
- **Límites:** el gráfico de Slides no tiene tooltips (se dibuja como imagen vectorial); no se conserva el estilo de gráfico de PowerPoint (efectos, etiquetas personalizadas) al editar un gráfico ajeno, solo mientras no se edita; los gráficos de Calc que se pegan en Slides pierden el vínculo con el rango. `.odp` sigue sin guardar gráficos.

### Fase 5 (hecha, 2026-11-16): Writer sobre el motor y comprobación con Word real
- **Modelo:** nodo `chart` de Writer (átomo en línea, como `smartart`): `chart` (`ChartSpec`) y `grid` (`ChartGrid`), ancho, alto y ajuste de texto. Se dibuja como imagen SVG con el motor compartido (`chartImage` en `schema.ts`, con caché por rejilla).
- **`chart-core/src/dml/part.ts`:** `readChartPart` y `chartParts(spec, grid, libro, 'ppt' | 'word', n)` pasaron del código de Slides al motor, así Slides y Writer escriben y leen igual.
- **`.docx`:** al leer, las partes `word/charts/*` se interpretan (`c:chart` y `cx:chart`, también dentro de `mc:AlternateContent`) y la rejilla sale de los valores en caché. Al escribir: parte del gráfico, relaciones, libro incrustado en `word/embeddings/` y, en los de Office 2016, estilo, colores y alternativa. **Siempre se regenera** a partir del modelo (a diferencia de Slides, no se conservan las partes originales).
- **Interfaz:** comandos «Gráfico…» (Insertar > Tablas) y «Editar datos y tipo del gráfico…», pestaña contextual «Diseño de gráfico», doble clic para editar, cuadro con tamaño y ajuste (`dlg-chart.tsx`), el mismo `ChartEditor` que Slides.
- **Word real (COM):** un `.docx` con 9 gráficos (columnas, circular con ajuste a la derecha, líneas, dispersión, cascada, embudo, histograma, cajas y bigotes y columnas 3D) abre y da los tipos esperados (51, 5, 65, -4169, 119, 123, 118, 121, 54); «Editar datos» abre el libro incrustado con sus valores; al guardar Word el archivo de nuevo, Nova lee los 9 gráficos sin avisos. Word no deja crear gráficos por COM en este entorno, así que no se probó con gráficos hechos desde cero por Word (sí con los que reescribe).
- **Pruebas:** 4 nuevas en `writer-core` (`chart.test.ts`) y la e2e `scripts/e2e-writer-chart.mjs` (3 comprobaciones: insertar, editar desde la pestaña y con doble clic, guardar y reabrir). Las e2e de Writer existentes siguen en verde.
- **Límites:** al editar o reescribir se pierden los estilos propios de Word (se escribe el estilo mínimo); tras un guardado de Word, los gráficos de Office 2016 pueden perder los nombres de serie de la rejilla; sin mover ni cambiar de tamaño con el ratón (se hace desde el cuadro); sin información emergente.


### Fase 6 (hecha, 2026-11-16): cierre
- **Resultado:** un solo motor (`chart-core`) y una sola interfaz de datos y tipo (`apps/suite/src/chart/`) para Calc, Slides y Writer. Se borraron el código propio de gráficos de `xlsx-io`, `slides-core` y el dibujo SVG de Slides. Los tres productos tienen los mismos tipos (clásicos, 3D y los cuatro de Office 2016) y se comprobaron con Excel, PowerPoint y Word reales.
- **Lo que se aprendió de Office (queda como regla):** (1) un gráfico de Office 2016 sin las partes `chartStyle`/`chartColorStyle` hace que Excel no abra el libro; (2) Excel guarda las fórmulas de esos gráficos como nombres ocultos `_xlchart.v1.N`, y PowerPoint y Word a veces solo guardan los valores dentro del gráfico, sin fórmulas; (3) Word y PowerPoint llevan siempre un libro incrustado para «Editar datos»; (4) la automatización por COM no deja crear gráficos desde cero en Word (ni en PowerPoint sin ventana), por eso la lectura de gráficos de Word se comprobó con archivos que Word reescribe.
- **Regresión completa:** typecheck de todos los paquetes sin errores; pruebas unitarias de todos los paquetes en verde (`chart-core` 34, `calc-engine` 264, `xlsx-io` 73, `slides-core` 99, `writer-core` 168, `apps/suite` 354, y el resto sin cambios); e2e de Calc, Slides y Writer (ver `PROGRESO.md`).
- **Pendiente (opcional, no empezado):** mover o redimensionar con el ratón en Writer; información emergente al pasar el ratón en Slides y Writer; conservar el estilo de Office al reescribir; conservar el libro original en vez del mínimo; ODT, ODP y ODS con gráficos; pegar de Calc a Slides o Writer conservando el vínculo.

## 8. Segunda ronda: igualar a Office (2026-11-16)
El usuario pidió cerrar los pendientes y límites para parecerse lo más posible a Office. Inventario hecho contra el código (no de memoria). Lo que Office tiene y Nova no, ordenado por lo que más se nota:

| Área | Office | Nova hoy |
|---|---|---|
| Elementos del gráfico | título, **títulos de ejes**, **etiquetas de datos**, **leyenda en 4 posiciones**, **cuadrículas mayores y menores**, **tabla de datos**, líneas de tendencia, barras de error, ejes, ejes secundarios | título y leyenda (solo abajo), tendencias, barras de error, título y cuadrícula por eje |
| Formato de serie y de punto | color, relleno, borde, grosor y estilo de línea, marcadores (forma y tamaño), ancho del hueco y superposición, suavizado, color por punto, explosión de sectores | color de serie y suavizado |
| Estilos | galería de estilos de gráfico (decenas) y de colores (monocromáticos, coloridos), formato del área del gráfico y del área de trazado, fuentes | un estilo mínimo (colores del tema) |
| Ratón | mover, redimensionar, información emergente al pasar | Calc y Slides sí mueven y redimensionan; Writer solo desde el cuadro; sin información emergente en Slides y Writer |
| Archivo | conserva todo lo que no entiende; libro incrustado original; ODF | Slides conserva el original mientras no se edita; Writer y Calc regeneran; libro mínimo; ODF sin gráficos |
| Portapapeles | pegar un gráfico de Excel en Word o PowerPoint: incrustado (con su libro) o vinculado | no hay pegado entre productos |

### Fases propuestas
1. **Elementos del gráfico (motor + Calc):** títulos de ejes, etiquetas de datos (valor, nombre, porcentaje; posición), leyenda en 4 posiciones, cuadrículas mayores/menores, tabla de datos; menú «Elementos del gráfico» con casillas como el de Office. Modelo, `option.ts`, DrawingML de ida y vuelta, interfaz, pruebas y Excel real.
2. **Formato de serie y de punto (motor + Calc):** relleno, borde, línea, marcadores, ancho del hueco, superposición, color por punto, explosión; panel «Formato de serie». Ida y vuelta con Office.
3. **Estilos y colores (motor + Calc):** galería de estilos y de colores, formato del área del gráfico y de trazado, fuentes. Escritura de `c:style`/`chartStyle` reales.
4. **Slides y Writer con los mismos elementos y formatos:** pestaña «Diseño de gráfico» completa (como la de Calc), mover y redimensionar en Writer con el ratón, información emergente en los tres.
5. **Fidelidad de archivo:** conservar lo no modelado al reescribir (partes originales con parches de datos), conservar el libro original actualizando sus celdas, Writer sin regenerar, nombres de serie tras Word.
6. **Portapapeles y ODF:** copiar/pegar gráficos entre Calc, Slides y Writer (incrustado con su rejilla, como Office) y exportar/importar gráficos en ODS/ODP/ODT.
7. **Cierre:** documentación, límites, regresión y comprobación con Office real.

**Reglas de la ronda:** cada fase con comprobación contra Excel, PowerPoint o Word reales; lo que Office haga y Nova no pueda se dice sin rodeos en `LIMITACIONES.md`.

### Ronda 2, fase 1 (hecha, 2026-11-16): elementos del gráfico
- **Modelo (`chart-core/src/model.ts`):** `legendPos` (abajo, arriba, izquierda, derecha, arriba a la derecha), `dataTable` (con o sin claves de leyenda), `ChartAxis.minorGridlines` y `ChartAxis.hidden`, y `ChartSeries.labels` (`DataLabels`: valor, nombre de categoría, nombre de serie, porcentaje, posición, separador y formato de número). Los títulos de ejes ya existían.
- **Dibujo (`option.ts`):** leyenda en las 5 posiciones con el trazado reservando su sitio; etiquetas de datos por serie con la posición que admite cada tipo (columnas: centro, interior final, base interior, exterior final; líneas y dispersión: centro, izquierda, derecha, arriba, abajo; circular: ajuste óptimo, centro, interior y exterior final); cuadrículas secundarias; ejes ocultos; **tabla de datos** dibujada bajo el trazado (series personalizadas de echarts, con claves de leyenda). Un gráfico circular ya no pone etiquetas por defecto (como Office): se piden con «Etiquetas de datos».
- **DrawingML (`dml/chartspace.ts`):** escritura y lectura de `c:legendPos`, `c:dLbls` (con las posiciones que Excel admite por tipo: una posición no válida hace que Excel rechace el archivo, así que se omite), `c:minorGridlines`, `c:delete` y `c:dTable`.
- **Interfaz:** `apps/suite/src/chart/elements.ts` define los elementos como en el menú «Agregar elemento de gráfico» de Office (título, títulos de ejes, ejes, cuadrícula, etiquetas de datos, leyenda, tabla de datos), con texto, disponibilidad, casilla y cambio; Calc los registra como `calc.el.*` y los ofrece en un menú de la pestaña «Diseño de gráfico» (sustituye a los botones sueltos «Título» y «Leyenda»). Slides y Writer lo usarán en la fase 4. Los nombres son únicos en el menú plano («Leyenda a la derecha», «Etiquetas: arriba»…).
- **Excel real (COM):** un libro con 8 gráficos con leyenda en las 4 posiciones, etiquetas con posición, títulos de ejes, cuadrícula secundaria, eje oculto y tabla de datos abre sin reparar; Excel reconoce la posición de la leyenda, las etiquetas y la tabla (`HasDataTable`), y los dibuja como Nova.
- **Pruebas:** 7 nuevas en `chart-core` (4 de dibujo, 2 de DrawingML con posiciones no válidas), 7 en `apps/suite` (elementos) y la e2e `scripts/e2e-calc-chartelements.mjs` (menú, etiquetas, tabla, deshacer y guardar y leer el `.xlsx`).
- **Límites:** la tabla de datos solo en columnas, líneas y áreas (como Excel); sin etiquetas de datos en los gráficos de Office 2016 (cascada, embudo, histograma, cajas); sin texto enriquecido en etiquetas ni títulos (fuente, tamaño y color: fase 3); la leyenda no se coloca a mano con el ratón.
