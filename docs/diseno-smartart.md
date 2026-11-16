# Diseño: SmartArt compartido (2026-11-16)

Estado: **decisiones tomadas por el usuario; falta resolver de dónde sale el catálogo de diseños (sección 5). Sin código.**

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
(vacío)
