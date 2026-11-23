# Iconos (Galería de iconos): diseño y plan

Decisiones del usuario (2026-11-22): **producto auxiliar compartido** `icon-core`; alcance **como Office más Slides y Diagram** (Writer, Calc, Slides, Mail y Diagram; sin Notes, Plan, Forms ni Base); **biblioteca abierta incluida, sin Internet**; edición **como Office** (color, contorno, efectos y «Convertir en forma»).

## 1. Cómo es en Office
- Insertar › Iconos en Word, Excel, PowerPoint y Outlook: una sola biblioteca con categorías y buscador (se descarga de Internet).
- Se inserta como gráfico **SVG con respaldo PNG** (`asvg:svgBlip` dentro de `a:blip`), así otros lectores lo ven.
- Pestaña «Formato de gráficos»: relleno, contorno, efectos, estilos, texto alternativo, girar, **Convertir en forma** (pasa a forma personalizada y se puede desagrupar).

## 2. Qué se comparte y qué es de cada producto
- **Compartido (`packages/icon-core`):** catálogo (id, nombre, categorías, palabras de búsqueda es/en), buscador, SVG normalizado (viewBox 24×24, `currentColor`), recoloreado, conversión SVG→PNG de respaldo, conversión SVG→forma personalizada (con `shapes-core`), escritura y lectura de `svgBlip`.
- **Compartido (`apps/suite/src/icons`):** diálogo «Iconos» (categorías, búsqueda, selección múltiple como Office) y pestaña/panel «Formato de gráficos».
- **De cada producto:** el comando Insertar › Iconos y cómo guarda el resultado (imagen en Writer, Slides, Calc, Mail y Diagram, reutilizando `image-core`).

## 3. Biblioteca
Ya instaladas y con licencia libre: **`@fluentui/react-icons`** (MIT, miles de iconos, estilo parecido al de Office) y `lucide-react` (ISC). Propuesta: partir de Fluent regular/filled, agruparlos en las categorías de Office (Personas, Cosas, Tecnología, Comunicación, Negocios, Comercio, Análisis, Educación, Naturaleza, Transporte, Deportes, Arte, Edificios, Salud, Símbolos, Flechas…) con nombres en español, y **no cargar el catálogo entero al arrancar** (carga perezosa al abrir el diálogo). Incluir el aviso de licencia en la aplicación.

## 4. Plan en 6 fases
1. **`icon-core` y catálogo:** extraer los SVG de Fluent a un catálogo propio con categorías y palabras en español/inglés, buscador, pruebas, medida del peso y carga perezosa.
2. **Diálogo «Iconos» y Writer:** diálogo compartido (categorías, buscador, selección múltiple), Insertar › Iconos en Writer, guardado en `.docx` con `svgBlip` y respaldo PNG; comprobar en Word real.
3. **Edición:** relleno, contorno, efectos, girar, texto alternativo (pestaña de formato de gráficos) y recoloreado SVG.
4. **Convertir en forma** con `shapes-core` (forma personalizada, desagrupar) en Writer; guardado `custGeom`.
5. **Slides, Calc, Mail y Diagram:** el mismo diálogo en cada uno, con su guardado (`.pptx`, `.xlsx`, correo, diagrama).
6. **Cierre:** comparación con Office (COM con Word, PowerPoint y Excel), accesibilidad, rendimiento, límites y documentación.

## 5. Límites previstos
- No es la biblioteca de Microsoft: otros iconos y otras categorías.
- Sin descarga de más iconos (sin Internet).
- «Convertir en forma» solo en productos con formas.

## 6. Estado
Plan escrito; ninguna fase hecha.
