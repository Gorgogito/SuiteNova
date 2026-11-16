# Diseño: SmartArt compartido (2026-11-16)

Estado: **decisiones tomadas (catálogo propio, opción a); fases 1 y 2 HECHAS (2026-11-16); fases 3 a 6 pendientes.**

## 1. Cómo es en Office
SmartArt es **un componente único de Office**, no una función de cada programa: Word, Excel, PowerPoint y Outlook usan el mismo motor y el mismo formato. Cada producto solo lo aloja:
- **PowerPoint:** `p:graphicFrame` con `a:graphicData uri=".../diagram"` y `dgm:relIds`.
- **Word:** `wp:inline` o `wp:anchor` con el mismo `a:graphicData`.
- **Excel:** `xdr:graphicFrame` en el dibujo de la hoja.
Un SmartArt son **cinco partes** (ECMA-376 §21.4): `dgm:dataModel` (los nodos y sus conexiones: el texto y los niveles), `dgm:layoutDef` (el diseño: un programa declarativo de algoritmos, restricciones y reglas), `dgm:styleDef` (estilo rápido), `dgm:colorsDef` (colores) y `dsp:drawing` (el dibujo ya calculado, caché de Office 2010+). Al editar, Office vuelve a ejecutar el diseño sobre los datos.

## 2. Estado actual en SuiteNova
Solo Slides (`slides-core/src/smartart.ts`): 7 diseños (lista, lista vertical, proceso, ciclo, jerarquía, pirámide, Venn) que se generan **una vez como grupo de formas** y quedan desvinculados de la lista. Al leer un `.pptx` se muestra el dibujo guardado (`dsp:drawing`). Writer y Calc no tienen SmartArt.

## 3. Decisiones del usuario
1. **Motor compartido** en un paquete `packages/smartart-core` usado por Slides, Writer y Calc (como WordArt y Formas).
2. **Vinculado a los datos**: el SmartArt guarda su lista y su diseño; panel de texto; añadir, quitar, subir y bajar de nivel; cambiar de diseño; estilos y colores; el dibujo se recalcula.
3. **Intérprete completo de `layoutDef`** (no algoritmos propios por diseño).
4. **Orden:** motor → Slides (migrar el existente) → Writer → Calc.

## 4. Arquitectura propuesta (`smartart-core`)
- `model`: árbol de nodos (texto, nivel, tipo) y operaciones puras (añadir hermano/hijo, quitar, subir/bajar nivel, mover); se serializa como `dgm:dataModel`.
- `layoutdef`: lector de `dgm:layoutDef` (alg, shape, presOf, constrLst, ruleLst, forEach, choose/if, varLst) a un árbol tipado.
- `engine`: ejecuta el diseño sobre el modelo con los algoritmos de la norma (`composite`, `lin`, `snake`, `cycle`, `hierRoot`, `hierChild`, `pyra`, `conn`, `tx`, `sp`), resuelve restricciones y reglas (reducir texto, estirar), y produce formas neutras (`SmartShape[]`: geometría de la lista de formas prestablecidas, posición, relleno, texto, flechas).
- `style`: aplica `styleDef` y `colorsDef`.
- `io`: lee y escribe las cinco partes; al escribir incluye `dsp:drawing` para que Office lo vea igual sin recalcular.
- Adaptadores por producto: Slides (hoy grupo de formas → un elemento SmartArt), Writer (nodo con el modelo, dibujo SVG, DOCX), Calc (forma con el modelo, XLSX).
- Reutiliza `shapes-core` (geometrías) y los componentes de panel de texto en `apps/suite/src/smartart/`.

## 5. Punto abierto: el catálogo de diseños
Un intérprete ejecuta cualquier `layoutDef`, y **cada archivo de Office que trae un SmartArt lleva su propio diseño dentro** (`diagrams/layout*.xml`): abrir archivos existentes funciona sin catálogo. El catálogo hace falta para **crear SmartArt nuevos**. Hechos comprobados:
- Los ~200 diseños incorporados de Office **no están en ECMA-376** (a diferencia de las geometrías y las transformaciones de WordArt) y no hay una copia pública que yo haya encontrado. En este equipo, Office los lleva dentro de `OART.DLL` (recursos binarios), no como archivos XML.
- Son contenido de Microsoft: **incluirlos tal cual en SuiteNova (MPL-2.0) tiene un riesgo de licencia** que conviene que decida el usuario.
Opciones: (a) catálogo **propio**: diseños escritos por nosotros en el mismo lenguaje `layoutDef` y con los mismos identificadores de Office (legalmente limpio; cubre los más usados); (b) exportar los de Office del equipo del usuario (PowerPoint instalado) y empaquetarlos (más fiel, con el riesgo de licencia); (c) mixto. **Pendiente de la decisión del usuario**; no bloquea las fases 1 a 3.

## 6. Fases
1. **Modelo y archivos:** `model`, `layoutdef`, `io` (lectura y escritura de las cinco partes), con pruebas de ida y vuelta.
2. **Motor de diseño:** algoritmos y restricciones; diseños de prueba propios (lista, proceso, ciclo, jerarquía, pirámide, relación); dibujo a formas neutras.
3. **Estilos y colores.**
4. **Slides:** migrar el SmartArt actual, panel de texto, cambiar de diseño, estilos, `.pptx` con las cinco partes.
5. **Writer:** nodo, dibujo, DOCX.
6. **Calc:** forma, dibujo, XLSX.

## 7. Límites previsibles (a decir sin rodeos)
- La norma describe los algoritmos de forma parcial: el resultado **no será idéntico píxel a píxel** al de Office; el ajuste del texto, las reglas de reducción y algunos diseños complejos (jerarquías con muchos niveles) pueden diferir.
- Sin 3D, sin animación de SmartArt, sin edición de los diseños propios del usuario (`.glox`).
- Nada se ha contrastado con Office real hasta que se pruebe.

## 8. Registro de fases
### Fase 1 (hecha, 2026-11-16): modelo y archivos — `packages/smartart-core`
- **Decisión del usuario:** catálogo **propio** (opción a): diseños escritos por nosotros en `layoutDef` con los identificadores de Office; los de Microsoft no se empaquetan. Un archivo de Office trae su propio diseño y se ejecuta sin catálogo.
- `xml.ts`: árbol XML ordenado y sin pérdidas (`El`), con prefijos conservados. `datamodel.ts`: `dgm:dataModel` completo (puntos, conexiones, `prSet`, `extLst` con el `relId` del dibujo). `model.ts`: árbol de nodos editable y operaciones puras (añadir hijo/hermano/primer nivel, quitar sin perder hijos, subir/bajar nivel, mover, cambiar texto), esquema de texto del panel (`treeToOutline`/`outlineToTree`, que conserva ids y formato) y conversión de ida y vuelta al modelo de datos (descarta los puntos de presentación y el dibujo en caché, que regenera el motor). `layoutdef.ts`: lector tipado de `layoutDef` (alg, shape, presOf, constrLst, ruleLst, varLst, forEach, choose/if/else, layoutNode, con los valores por omisión de la norma). `styles.ts`: `styleDef` y `colorsDef`. `drawing.ts`: `dsp:drawing` (lectura y escritura). `parts.ts`: las cinco partes juntas, tipos de relación y de contenido, y `DIAGRAM_URI`.
- **Pruebas:** 26 con datos escritos a mano (`fixtures.ts`) + 1 que valida con **archivos reales de Office** (`office-files.test.ts`, se activa con la variable `SMARTART_FILES`; no se guardan en el repositorio). Se generaron 8 SmartArt reales con PowerPoint (COM) en una carpeta temporal: lista de bloques, proceso, ciclo, jerarquía, pirámide, Venn, lista vertical y matriz; todos se leen y se reescriben sin pérdidas (datos y dibujo).
- **Lo que enseñaron los archivos reales:** algoritmos en uso: `snake`, `tx`, `sp`, `composite`, `lin`, `hierRoot`, `hierChild`, `conn`, `pyra`, `cycle`; restricciones: `w h l t r b ctrX ctrY sp sibSp lMarg rMarg tMarg bMarg begPad endPad connDist bendDist primFontSz secFontSz pyraAcctRatio` (con `equ`/`lte`); reglas: `h primFontSz secFontSz`; funciones de `choose`: `var:dir`, `cnt`, `pos`, `depth`, `maxDepth`; ejes: `ch followSib self none`. Es la lista de trabajo de la fase 2.
- **Límites de esta fase:** al volver el árbol al modelo de datos se escriben solo los puntos de contenido, las transiciones y las conexiones `parOf`; Office regenera lo demás al abrir (no comprobado con Office real hasta la fase 4).

### Fase 2 (hecha, 2026-11-16): motor de diseño — `packages/smartart-core/src/engine`
- **`data.ts`:** el modelo de datos como lo ve un diseño (puntos con padre, hijos, `parTrans` y `sibTrans` por nodo) y los ejes de ECMA-376 (`self ch des desOrSelf par root ancst followSib precedSib follow preced`) con tipos de punto, `hideLastTrans`, `st` (desde 1), `cnt`, `step` y listas de pasos (`ch,ch,desOrSelf`). `ch` con todos los tipos da, por hijo, su transición de padre, él y su transición de hermano.
- **`present.ts`:** ejecuta un `layoutDef` sobre el árbol y da el árbol de presentación (`PNode`): `forEach` (también `ref`), `choose` (`var`, `cnt`, `pos`, `revPos`, `posEven/Odd`, `depth`, `maxDepth`), `presOf`, variables (`dir` viene de los datos: opción `vars` del motor), restricciones y reglas.
- **`layout.ts`:** restricciones (`for` self/ch/des, `forName`, `ptType`, `refType`/`refFor`, `fact`, `op` equ/lte/gte) sobre las propiedades de cada nodo y los algoritmos **`composite`** (restricciones l/t/r/b/w/h/ctrX/ctrY, proporción `ar`, conjunto centrado), **`snake`** (elige las columnas que dejan los nodos más grandes y centra la fila incompleta), **`lin`** (cuatro direcciones, reducción a escala, centrado), **`cycle`** (cuerda entre centros = tamaño + `sibSp`, reducción a escala, transiciones en el punto medio de la cuerda y giradas), **`pyra`**, **`hierRoot`/`hierChild`** (tamaño natural, centrado de cada padre entre su primer y su último hijo, reducción a escala), **`conn`**, **`sp`**, **`tx`**; el resto de algoritmos no rompe nada.
- **`render.ts`:** formas en EMU (geometría con los ajustes del diseño, giro, rectángulo del texto de la geometría), conectores de jerarquía con codo (`custGeom`) y flechas con sus márgenes, texto con tamaño de letra que cabe (letras iguales con `op="equ"`, regla de mínimo), párrafos con viñeta para los subniveles, `hideGeom` fusionado con la forma del mismo dato.
- **Pruebas:** 19 unitarias (`engine.test.ts`, con diseños propios y las cifras medidas con PowerPoint como valores esperados) y la comparación con archivos reales (`engine-office.test.ts`, opcional: `SMARTART_FILES`, `SMARTART_FRAME`, `SMARTART_TOL`, `SMARTART_ONLY`, `SMARTART_REPORT`).
- **Resultado contra PowerPoint** (el motor ejecuta el diseño que trae el archivo sobre sus datos y se compara la geometría con la caché que Office guardó; marco de 640 x 380 pt; 16 SmartArt generados con PowerPoint por COM): lista de bloques (3, 5 y 8 nodos), proceso (3 y 5), pirámide (3 y 5), Venn (3 y 4), matriz, jerarquía (4 y 6 nodos) y ciclo (3, 5 y 7) coinciden **dentro de 1,5 pt** (la mayoría, exactos o a 0,5). **Lista vertical (vList2): 12 a 23 pt de diferencia** (aproximada).
- **Lo que enseñó la comparación:** con 3 nodos Office elige una rejilla de 2 + 1 (no una fila); Office centra siempre el conjunto de hijas de un `composite`; un padre se centra entre su primer y su último hijo, no entre los extremos del subárbol; los conectores no miden menos de 7,2 pt; las flechas dejan 25 % y 22 % de la distancia a cada lado.
- **Límites (sin rodeos):** (1) **vList2** y los diseños cuyas alturas dependen del tamaño de letra: la letra se supone la máxima (65 pt) y se reduce a escala, con un factor empírico; (2) las medidas de texto son **aproximadas** (se pueden sustituir por las de la fuente real con `metrics`), así que el tamaño de letra puede diferir en uno o dos puntos; (3) no se ejecutan las reglas de crecimiento (`h` con `fact`), ni `autoTxRot`, ni los ayudantes (`asst`) y `orgChart` en las jerarquías, ni los acentos de la pirámide (`acctBkgd/acctTx`), ni las flechas 2D; (4) formas sin relleno ni línea: estilos y colores son la fase 3; (5) nada de esto se ha abierto en el visor de Office más que por la comparación numérica.