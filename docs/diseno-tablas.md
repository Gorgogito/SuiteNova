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

## 6. Bitácora
### Fase 1 (hecha, 2026-11-23): `table-core`
- **Paquete `packages/table-core`** (sin interfaz, sin dependencias; 61 pruebas): `grid.ts`, `style.ts`, `number.ts`, `convert.ts`, `sort.ts`, `formula.ts`. Todavía **no lo usa ningún producto** (las fases 2 a 5 lo conectan).
- **Cuadrícula (`grid.ts`):** modelo genérico en el contenido de la celda (`Grid<C>`; cada producto pone el suyo). Celdas combinadas con `rs`/`cs` y las cubiertas marcadas con `hm`/`vm` (como `hMerge`/`vMerge` de OOXML). Insertar y eliminar filas y columnas, combinar (con una función para unir el contenido), dividir (una celda sin combinar agranda la tabla), propiedades de celda (relleno, alineación, margen, bordes propios), **bordes** en los modos de Word (todos, exteriores, interiores, arriba, abajo…) escritos **en las dos celdas que comparten cada arista**, tamaños (columna con su vecina, distribuir, escalar, autoajuste) y `validate`, que dice qué está mal en una cuadrícula. Una prueba aplica **300 operaciones al azar** y comprueba que la cuadrícula sigue siendo válida en cada paso.
- **Estilos (`style.ts`):** al estilo de Office: partes (toda la tabla, encabezado, totales, primera y última columna, bandas por filas y por columnas, esquinas) y opciones que las activan. **32 estilos**: «Sin estilo», «Cuadrícula de tabla» y cinco familias (Claro, Cuadrícula, Medio, Oscuro, Lista) en los seis colores de énfasis de una paleta (la de Office por defecto, cambiable). `lookOf` dice cómo se ve una celda (relleno, color de texto, negrita y bordes), con la regla de Office de que **el borde que pide una parte gana al de la tabla y se ve igual desde las dos celdas de la arista**; lo que la celda tiene propio gana al estilo (un relleno `null` quita el del estilo; un borde `null` quita el suyo). `gridLooks` lo da para toda la cuadrícula, con las combinadas ocupando su extensión.
- **Números (`number.ts`):** `parseNumber` (coma o punto decimal, miles, paréntesis, signo, símbolo de moneda o unidad, %) y `formatNumber` con imagen (`#,##0.00`, `0%`, `$#,##0`, `0;(0)`, texto entre comillas).
- **Texto y tabla (`convert.ts`):** separar con comillas, detectar el separador, texto→filas rectangulares, filas→texto y →HTML (escapado).
- **Ordenar (`sort.ts`):** texto (con la colación del idioma: acentos y mayúsculas no separan), número y fecha; lo vacío o que no es número va siempre al final; estable; la fila de encabezado se queda arriba; **se niega si rompería una celda combinada en varias filas**.
- **Fórmulas (`formula.ts`):** `=SUM(ABOVE)`, `=A1+B2`, rangos `B2:B4`, `ABOVE/BELOW/LEFT/RIGHT`, `+ - * / ^ %`, comparaciones, paréntesis, imagen de número `\# "0.00"`; 15 funciones con nombre en inglés y en español (`SUMA`, `PROMEDIO`, `CONTAR`, `REDONDEAR`, `SI`…); con coma decimal los argumentos se separan con «;»; errores como Word (`!División por cero`, `!Error de sintaxis`, `!Referencia no válida`).
- **Lo que no está comprobado:** la regla de `ABOVE` (**se detiene en la primera celda vacía y se salta el texto**) es la que recuerdo de Word, **no se ha comparado con Word real**: se comprobará por COM en la fase 4 (`Fields.Add` y `Update`) y se corregirá si difiere; tampoco están comparados el `%` («50 %» vale 0,5) ni el redondeo.
