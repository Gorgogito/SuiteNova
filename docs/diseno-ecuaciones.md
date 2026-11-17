# Diseño: Ecuaciones (motor compartido `math-core`)

## 1. Cómo es en Office
Las ecuaciones son un **componente compartido** de Office, no un producto aparte ni uno por programa: el mismo motor («Office Math», formato **OMML**, `m:oMath`) vive en Word, PowerPoint, Excel, Outlook y OneNote. Una ecuación se copia de uno a otro sin perder nada.
- **Word** es el más completo: ecuación en línea y en bloque (`m:oMathPara`), entrada en el formato lineal («UnicodeMath»: `a/b`, `x^2`, `√(x)`, `\alpha` + espacio), autocorrección de símbolos, cinta «Ecuación» con galería de estructuras y de símbolos.
- **PowerPoint y Excel** insertan la misma ecuación dentro de un cuadro de texto o forma (`a14:m` / `m:oMathPara` en `a:p`).
- Antes de Office 2007 era un objeto OLE aparte (Editor de ecuaciones 3.0); por eso en archivos viejos aparece como imagen.

## 2. Qué había en SuiteNova (antes de esta ronda)
Cada producto tenía su versión, sin editor común:
| Producto | Estado |
|---|---|
| Writer | Nodo `math` con `tex` y `display`; LaTeX → MathML/OMML (`writer-core/src/math.ts`, 634 líneas); diálogo de texto LaTeX; `.docx` como OMML; `.odt` no guarda ecuaciones. |
| Slides | LaTeX (KaTeX) → imagen PNG con el texto como alternativa (`slides/equation.ts`); PowerPoint no la edita. |
| Notes y Mail | LaTeX; en Mail solo queda el texto. |
| Calc | Sin ecuaciones. |

## 3. Arquitectura
Igual que Gráficos y SmartArt: **un motor compartido** y una interfaz compartida.
- **`packages/math-core`** (nuevo, sin dependencias de interfaz; solo `fast-xml-parser`): modelo `MNode`, lectura y escritura en LaTeX, **formato lineal de Word**, MathML y **OMML** (en nodos y como texto XML). `writer-core` lo reexporta, así que el resto del código no cambia.
- **`apps/suite/src/math/`** (fases siguientes): editor estructurado, cinta «Ecuación», galerías de estructuras y símbolos, comandos compartidos.
- Los productos solo guardan la ecuación y su ancla: `tex` o árbol + el **OMML original** para no perder lo que Nova no modela (como `raw` en los gráficos).

### Modelo (`MNode`)
Ya estaba: fila, número, identificador, operador, texto, espacio, fracción, superíndice, subíndice, ambos, raíz, n-ario (∑ ∫), delimitadores, función, acento, barra, límite, matriz. **Añadido en la fase 1:**
- **Estilo de carácter** (`sty`: recto, negrita, cursiva, negrita cursiva; `scr`: caligráfica, gótica, doble trazo, sin serifa, monoespaciada) en número, identificador, operador y texto.
- **Fracción** lineal (`a/b`) y sesgada (`a⁄b`), además de la normal y sin barra.
- **Prefijos** (`m:sPre`), **ecuaciones alineadas** (`m:eqArr`, antes se degradaban a matriz) y **recuadros** (`m:box`, `m:borderBox`).
- `func` con límite inferior tipado (antes un `as unknown`).

### Formato lineal (`umath.ts`)
`parseUnicodeMath` / `toUnicodeMath`: fracciones (`/`, `⁄`, `∕`, `¦`), escrituras (`^`, `_`), raíces (`√`, `∛`, `∜`, `√(n&x)`), n-arios con `▒`, funciones (`sin x`, `lim_(x→0)`), corchetes que se emparejan con cualquiera (`[a,b)`), matrices (`■(a&b@c&d)`), ecuaciones alineadas (`█`), acentos como marcas combinadas, barras (`¯`, `▁`), recuadros (`▭`, `□`), límites (`┬`, `┴`), prefijos (`_a^b c`), letras con estilo como **alfanuméricos matemáticos** (𝐱, ℝ, 𝒜) y escapes (`\alpha`, `\sum`).

### OMML como texto (`omml.ts`)
`parseOmmlXml` (un `m:oMath` o un `m:oMathPara`) y `ommlXml(node, display, {rPr})`: el `rPr` cambia según el producto (`w:rPr` en Word, `a:rPr` en PowerPoint). Lo usarán Slides, Calc y Notes.

## 4. Plan por fases
1. **Motor compartido (hecha).** Paquete `math-core`, modelo ampliado, formato lineal, OMML como texto, pruebas.
2. **Editor.** Editor estructurado (la ecuación se edita en su sitio: casillas para numerador, índices, etc.) y modo lineal, ecuaciones en línea y en bloque, autocorrección de símbolos y estructuras, galerías de la cinta «Ecuación» (estructuras y símbolos), deshacer y portapapeles.
3. **Writer.** Nodo `math` con árbol y OMML original, edición en el documento, `.docx` fiel (conserva lo ajeno), `.odt` con MathML (`draw:object` con `math:math`).
4. **Slides.** Ecuación como texto en un cuadro (`a14:m`), no como imagen; `.pptx` abre en PowerPoint como ecuación editable; `.odp`.
5. **Calc.** Ecuación como objeto flotante en la hoja (cuadro de texto con OMML en el dibujo, como Excel), `.xlsx`.
6. **Notes, Mail y portapapeles.** Mismo editor; copiar y pegar ecuaciones entre productos (y como OMML hacia Office).
7. **Cierre.** Documentación, límites, regresión y comprobación con Word, PowerPoint y Excel reales (COM).

## 5. Decisiones
- **Dibujo en pantalla:** KaTeX (ya en el proyecto) / MathML nativo del navegador; sin dependencias nuevas. No será idéntico al de Office (tipografía Cambria Math cuando exista).
- **Edición:** estructurada y con modo lineal; no un cuadro de LaTeX aparte.
- **Fidelidad:** el OMML original se conserva y se fusiona (como en los gráficos) cuando no se edita lo que Nova no modela.

## 6. Bitácora
### Fase 1 (hecha, 2026-11-17): motor compartido
- Nuevo `packages/math-core`; `math.ts` y su prueba se movieron desde `writer-core` (que lo reexporta) y se ampliaron.
- 14 pruebas (`math.test.ts` + `umath.test.ts`): ida y vuelta de LaTeX, formato lineal, estilos de letra, nodos nuevos, MathML bien formado, OMML en nodos y como texto.
- **Límites:** el formato lineal cubre lo habitual, no toda la gramática de UnicodeMath; el OMML conserva todo lo modelado pero no `m:phant`, `m:groupChr` ni las propiedades de formato de cada carácter (fuente, tamaño, color), que se atenderán con la conservación del original (fase 3).
- **Word real (COM):** un `.docx` con 14 ecuaciones (fracción, escrituras, raíz cúbica, sumatoria, integral, griegas, delimitadores, matriz, límite con función, acentos, ecuación alineada, doble trazo, negrita y caligráfica, recuadro) abre y Word lee las 14 como ecuaciones. Al pedirle su forma lineal (`OMaths.Linearize`) coincide con la de `toUnicodeMath` salvo diferencias de escritura equivalentes (Word agrupa el integrando con `〖〗` y pone la letra en cursiva matemática). Con esto el formato lineal queda contrastado con el de Word.

### Fase 2 (hecha, 2026-11-17): editor estructurado
- **Motor de edición (`math-core/src/edit.ts`, `structures.ts`, `editview.ts`):** el estado es el árbol más un **cursor por rutas** (fila de una casilla y posición); todas las operaciones son funciones puras (deshacer = guardar estados) y se prueban sin navegador. Casillas por nodo (`slotsOf`: numerador, denominador, base, índices, grado, límites, celdas de matriz...). Escribir como en Word: `/` hace una fracción con lo que precede (sin paréntesis si es un grupo, y la racha de letras o cifras), `^` y `_` escrituras (`x_i^2` es del mismo elemento), `(` cierra solo y `)` sale, `\nombre` + espacio pone el símbolo, la estructura (`\frac`, `\sqrt`, `\sum`, matrices...), la función o el acento; los nombres de función (`sin`, `lim_`) se reconocen al escribir otro carácter; un operador cierra el denominador, el índice o el argumento de la función (como el formato lineal de Word). Flechas (entran y salen de las casillas), arriba y abajo (numerador/denominador, base/índices, filas de una matriz), Inicio/Fin, Tabulador (casilla siguiente), Retroceso y Supr con las reglas habituales (una estructura vacía se quita, una casilla de índice vacía quita el índice, un paréntesis solo se disuelve), selección en una fila (reemplaza al escribir y entra en la casilla principal de una estructura de la galería), clic.
- **Catálogo (`structures.ts`):** 103 estructuras en 10 grupos (fracciones, escrituras, radicales, integrales, operadores grandes, corchetes, funciones, acentos, límites, matrices) y 6 grupos de símbolos (griegas, operadores, relaciones, flechas, letras y símbolos).
- **Dibujo (`editview.ts`):** MathML del navegador con cursor parpadeante, selección, huecos en las casillas vacías, la escritura `\nombre` en curso y, en cada nodo, `data-r`/`data-i` para colocar el cursor con el ratón. Nada de dibujo propio: el navegador resuelve fracciones, raíces, límites y matrices.
- **Interfaz compartida (`apps/suite/src/math/EquationEditor.tsx`):** galería (estructuras y símbolos), cuadro de edición con teclado y ratón (clic y arrastre), deshacer y rehacer, copiar y pegar (se copia en el formato lineal; se pega LaTeX o formato lineal), AltGr (`\` en teclado español), mensajes en inglés.
- **Integrada en Writer (`dlg-objects.tsx`) y Slides (`FormDialogs7.tsx`)** sustituyendo la paleta de botones LaTeX y la vista previa: editor + código LaTeX sincronizados en los dos sentidos (lo escrito en el editor actualiza el código; lo escrito en el código actualiza el editor).
- **Pruebas:** 15 de edición en `math-core` (30 pruebas en total en `math-core`); la e2e `scripts/e2e-math-editor.mjs` (10 comprobaciones con un navegador real: teclado, fracciones, índices, `\alpha`, deshacer, galería, matriz con Tabulador, ratón, copiar y pegar, sincronía con el código, guardar y reabrir en Writer, y Slides); las e2e de ecuaciones existentes se adaptaron (la vista previa es el propio editor).
- **Cambio sobre el plan:** la **cinta contextual «Ecuación»** (galerías en la cinta, con la ecuación en el documento) pasa a la fase 3, cuando se edita dentro del documento; en esta fase las galerías van en el cuadro de edición.
- **Límites:** el dibujo depende del MathML de Edge/Chromium (espaciado y delimitadores no son idénticos a los de Office); la selección solo cubre elementos de una misma fila (no cruza estructuras, ni con el ratón); la autocorrección cubre `\nombre`, funciones, `/`, `^`, `_` y los corchetes, no todo lo de Word (`->`, `<=`, `:=`...); no hay entrada por IME; Writer sigue guardando el LaTeX (no el árbol) y Slides sigue guardando una imagen (fases 3 y 4); el diálogo es modal (la edición dentro del documento llega en la fase 3).

### Fase 3 (hecha, 2026-11-17): Writer
- **Edición en el documento (`apps/suite/src/math/core.ts`, `writer/nodeviews.ts`):** la lógica de teclado, ratón, portapapeles y deshacer salió del cuadro a una clase sin React (`MathEditing`), que usan el cuadro de ecuación y la vista del nodo `math` de Writer. Doble clic o Intro sobre una ecuación elegida (o *Insertar > Ecuación > Nueva ecuación*) la editan en su sitio, con cursor y recuadro; Intro o Esc la guardan (una ecuación vacía se quita), un clic en el texto también, y deshacer del documento devuelve la anterior. La cinta actúa sobre la ecuación en edición y le devuelve el foco.
- **Pestaña contextual «Ecuación» (`writer/commands-math.ts`, `ribbonDef.tsx`):** aparece al elegir una ecuación; *Nueva ecuación*, *Editar en el documento*, *Editar ecuación…* (cuadro) y *Ecuación en su propia línea* (en bloque o en línea), 10 menús de estructuras (103 órdenes `writer.math.struct.*`) y 6 de símbolos (`writer.math.sym.*`). Si la ecuación solo está elegida, la orden empieza a editarla primero.
- **OMML original (`math-core/src/omml.ts` `ommlString`, nodo `math` con `omml` y `ommlTex`):** al leer un `.docx` se guarda el `m:oMath` tal como estaba (con fuentes, tamaños, negrita y propiedades; los prefijos `m:` y `w:` se restituyen por el nombre del elemento) y, al guardar, si el código no cambió se escribe ese original; si se edita, se genera de nuevo. El atributo viaja también por copiar y pegar dentro de Writer (`data-omml`).
- **`.odt` (`writer-core/src/formats/odt.ts`):** las ecuaciones se guardan como objeto de fórmula (`Object N/content.xml` con MathML y el código TeX como anotación, mime `application/vnd.oasis.opendocument.formula`) y se leen de vuelta; las fórmulas de otros programas se importan con `fromMathML` (`math-core/src/mathml.ts`: fracciones, raíces, escrituras, operadores grandes, funciones, acentos, matrices, delimitadores, estilos de letra).
- **Pruebas:** 3 nuevas en `math-core` (OMML original por ida y vuelta, MathML; 32 en total) y 5 en `writer-core` (171 en total) (`math-fidelity.test.ts`: fuente, tamaño y negrita sobreviven; si se edita se regenera; copiar y pegar; `.odt` con y sin anotación); la e2e `scripts/e2e-writer-math.mjs` (10 comprobaciones con un navegador real: nueva ecuación, teclado, Intro, pestaña contextual, estructuras y símbolos desde la cinta, bloque, clic fuera, deshacer, ecuación vacía, `.docx`).
- **Word real (COM):** Word creó 11 ecuaciones (fracción, índices, raíz, sumatoria, integral, paréntesis, matriz, límite con función, doble trazo, griegas y una en negrita de 22 pt); Nova las lee, las reescribe **sin tocarlas** y Word las abre idénticas (su forma lineal coincide ecuación por ecuación, incluida la de formato propio).
- **Límites:** las fórmulas de `.odt` no se han comprobado con LibreOffice (no instalado) y se guardan sin imagen de respaldo (un programa que no entienda el objeto no muestra nada); de un `.docx` editado a mano de la ecuación se pierde el formato propio (se regenera con el estándar); el formato lineal de Word solo se ofrece por copiar y pegar (el cuadro muestra el código LaTeX); el modo «Lineal» de la cinta de Word no existe; `m:phant` y `m:groupChr` se leen como su contenido.
