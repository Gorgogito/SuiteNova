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
