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
(vacío: se anota aquí al terminar cada una)
