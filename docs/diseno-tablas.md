# Tablas: diseño y plan

Decisiones del usuario (2026-11-23): **producto auxiliar compartido** `table-core` + interfaz común; alcance **como Office: Writer, Slides, Notes y Mail** (Calc conserva sus tablas de datos, como Excel; Diagram, Base, Plan y Forms quedan fuera); arquitectura **paquete con modelo, estilos y operaciones, e interfaz común**; funciones **las que Office tiene en todos** (sin Dibujar tabla, Borrador, tablas rápidas ni hoja incrustada).

## 1. Cómo es en Office
- **Word, PowerPoint, Outlook y OneNote** comparten la experiencia de tabla: selector de cuadrícula (Insertar › Tabla), **Diseño de tabla** (galería de estilos, opciones de estilo —fila de encabezado, fila de totales, primera y última columna, filas y columnas con bandas—, sombreado, bordes con estilo, grosor y color) y **Disposición** (insertar y eliminar filas y columnas, combinar y dividir celdas, tamaño de celda, distribuir, alineación, márgenes de celda, autoajuste, ordenar, texto a tabla y tabla a texto, repetir fila de encabezado, texto alternativo).
- **Fórmulas** (`=SUMA(ARRIBA)`): solo **Word y Outlook**. PowerPoint y OneNote no las tienen.
- **Excel** tiene sus propias «Tablas» de datos (filtros, totales, segmentaciones, dinámicas): otra cosa.

## 2. Qué hay hoy (2026-11-23)
- **Writer:** completo, sobre ProseMirror (`prosemirror-tables`): `writer/table-tools.ts` (estilos como **formato directo**, ordenar, texto↔tabla, propiedades), comandos `writer.table.*`, `.docx` con `w:tbl`.
- **Notes:** importa `table-tools` de Writer (reutilización casual): cuadro de aspecto y ordenar.
- **Slides:** modelo propio (`slides-core/table.ts`: filas, columnas, combinar, dividir, bordes, familias de estilos reales de `.pptx`) y cinta propia (`slides/TableRibbon.tsx`).
- **Mail:** no tiene tablas (el cuerpo es texto sin formato con `[Imagen: nombre]` y una parte HTML que se construye al enviar).
- **Calc:** tablas de datos (`calc.table.*`), fuera de este producto.
- Resultado: **tres juegos de estilos distintos**, tres cintas y funciones que existen solo en uno (por ejemplo, borde con estilo en Slides, ordenar en Writer).

## 3. Qué se comparte y qué es de cada producto
- **Compartido `packages/table-core` (sin interfaz ni dependencias de producto):**
  - **Modelo de cuadrícula** genérico en el contenido de la celda: filas, columnas, combinadas, bordes y sombreado por celda, anchos y altos; operaciones (insertar, eliminar, combinar, dividir, distribuir, autoajuste, ordenar) que usan Slides y Mail directamente.
  - **Estilos de tabla** al estilo de Office (familias × color de énfasis) y **opciones de estilo**, con una sola función que resuelve cómo se ve cada celda (relleno, texto, negrita, bordes). Writer, Notes y Slides la usan para pintar y para exportar.
  - **Bordes** (estilo, grosor, color), **sombreado**, **márgenes** y **alineación** de celda.
  - **Texto↔tabla** (separadores) y **fórmulas** (`SUMA`, `PROMEDIO`, `MIN`, `MAX`, `CONTAR`; `ARRIBA`, `IZQUIERDA`, referencias `A1`) con la lista de funciones en español e inglés.
- **Compartido `apps/suite/src/tables` (interfaz):** selector de cuadrícula, galería de estilos con opciones, menús de sombreado y bordes, cuadro de propiedades (márgenes, alineación, texto alternativo, repetir encabezado) y su cinta «Diseño de tabla» / «Disposición».
- **De cada producto:** dónde vive la tabla y cómo se edita su contenido. **Writer y Notes** siguen con ProseMirror (`prosemirror-tables`) para las celdas y adaptan el estado a `table-core` para estilos, bordes y fórmulas; **Slides** convierte su `TableEl`; **Mail** guarda la tabla como un bloque `[Tabla: nombre]` del cuerpo, con su HTML y su texto alineado al enviar.

## 4. Plan en 6 fases
1. **`table-core`:** modelo de cuadrícula, operaciones, estilos y opciones de Office, resolución de la apariencia, bordes, texto↔tabla, ordenar y motor de fórmulas; pruebas.
2. **Interfaz común y Writer (y Notes):** selector de cuadrícula, galería de estilos con opciones, sombreado y bordes con estilo/grosor/color; Writer y Notes los usan; `.docx` con estilos y bordes reales (comprobar con Word).
3. **Slides:** los mismos estilos, opciones y bordes sobre su modelo; `.pptx` sin pérdidas (comprobar con PowerPoint).
4. **Disposición y funciones:** márgenes y alineación de celda, autoajuste, repetir fila de encabezado, texto alternativo, ordenar y texto↔tabla en los que Office los tiene; **fórmulas en Writer** (`w:fldSimple` con `=SUM(ABOVE)`, comprobar con Word).
5. **Mail:** Insertar › Tabla en el mensaje (bloque `[Tabla: nombre]`, editor con la interfaz común, HTML con estilos en línea y texto alineado), fórmulas como Outlook.
6. **Cierre:** comparación con Office por COM (Word y PowerPoint: estilos, bordes, combinadas, fórmulas; Outlook si se puede), accesibilidad (encabezado, texto alternativo, teclado), rendimiento (tablas de cientos de filas), límites y documentación.

## 5. Límites previstos
- Sin Dibujar tabla, Borrador, tablas rápidas ni hoja de cálculo incrustada (decisión).
- Los estilos serán de SuiteNova (la misma idea que los de Office, no los mismos nombres ni colores exactos de todo el catálogo de Office).
- Fórmulas solo donde Office las tiene (Writer y Mail); PowerPoint y OneNote no.
- Las tablas de Calc no cambian.
- En Mail el cuerpo sigue siendo texto: la tabla se edita en su cuadro, no en el cuerpo.
