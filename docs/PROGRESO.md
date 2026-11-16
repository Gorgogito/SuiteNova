# Progreso de trabajo (para retomar tras un corte)

Este archivo se actualiza en cada avance. Léelo primero al retomar.
Última actualización: 2026-11-15.

## Subproducto en curso: Formas (`shapes-core` + galería común)

Objetivo: tener un catálogo de formas único (como las Formas de Office) compartido por Slides, Calc y Writer.

### Hecho
- [x] Commit `c133fa6`: `packages/shapes-core` creado; catálogo (`presets.json`), `preset.ts`, `custom.ts` extraídos de Slides.
- [x] `shapes-core/src/gallery.ts` + `gallery.test.ts` (sin commit): `resolveKind`, `isLineKind`, `shapeSvg`, categorías.
- [x] `apps/suite/src/shapes/ShapeGallery.tsx` + `shapes.css` (sin commit): galería de la cinta reutilizable.
- [x] Calc: `ribbonObjects.tsx` usa `ShapeGallery`; `calc-engine/objects.ts`, `xlsx-io/shapes-io.ts`, `ObjectLayer.tsx`, `doc-objects.ts`, `print.ts` adaptados.
- [x] Writer: `insertShapeKind` (`commands-objects.ts`), `ShapeView` dibuja con `shapeSvg` (`nodeviews.ts`), `ribbonDef.tsx` con la galería; DOCX reader/writer/shared tocados.
- [x] Verificado 2026-11-15: `pnpm typecheck` limpio; `pnpm test` todo en verde (apps/suite 347, shapes-core 9, writer-core 144, xlsx-io 63); e2e `e2e-calc-shapes` y `e2e-calc` en verde.

- [x] Arreglado: el botón «Cuadro de texto» de Writer ensanchaba el grupo Ilustraciones y colapsaba la cinta a 1280 px (rompía e2e-writer); ahora `iconOnly`. e2e-writer 19/19, e2e-writer-page e image en verde.
- [x] Capturas reales de la galería en Writer y Calc revisadas (9 categorías, insertar elipse en Calc OK).

- [x] Slides migrado a `ShapeGallery` (`slides/ribbonParts.tsx`: `ShapesGallery` es ahora un envoltorio; se quitó la lista duplicada de categorías). Selectores de e2e cambiados a `[data-shape="..."]` (e2e-slides, e2e-slides-objects). Los 9 e2e de Slides en verde, typecheck limpio, captura revisada.
- [x] `docs/LIMITACIONES.md`: sección «Formas comunes».

- [x] Commit `05ebddd` (galería común en Slides, Calc y Writer).
- [x] `scripts/e2e-writer-shapes.mjs` (6 comprobaciones: 9 categorías, insertar 4 formas, dibujo distinto, botón de acción, cuadro de texto editable, ida y vuelta .docx).
- [x] README: `shapes-core` en la tabla y en la estructura.

### Siguiente (orden fijado por el usuario)
1. [x] Puntos de ajuste (amarillos) en Calc y Writer — HECHO: `shapes-core/src/adjust.ts` (adjustHandles, dragAdjust, cleanAdjust, avLstXml, parseGuide) + pruebas; Calc: `SheetShape.adj`, XLSX avLst, tiradores en `ObjectLayer.tsx`, e2e en e2e-calc-shapes; Writer: atributo `adj`, DOCX avLst, tiradores en `ShapeView` (con forma girada), e2e en e2e-writer-shapes. Tests: shapes-core 11, writer-core 145, xlsx-io 64.
2. [x] Rotación en Calc — HECHO: `SheetShape.rotation`, XLSX `rot`, asa de giro y redimensionado en ejes girados (`ObjectLayer.tsx`), campo en `dlg-shape.tsx`, comandos `calc.shape.rotateRight/Left` en el grupo Organizar, impresión girada. Tests: xlsx-io 65; e2e-calc-shapes (asa, comandos, deshacer, redimensionar, diálogo). Lección: en los e2e de Calc los botones de la cinta se localizan con `[data-nv-item="..."]` (getByRole no los halla).
3a. [x] Agrupar formas en CALC — HECHO (2026-11-15): `calc-engine/src/shape-group.ts` (límites, mover, escalar, girar, agrupar; 5 pruebas), `SheetShape.group`, XLSX `xdr:grpSp` (`shapes-io.ts` groupBodyXml/parseGroup, `charts-io.ts` DrawingItem 'group', `writer.ts`, `reader.ts`), `DocObjects` (selectedShapes, toggleShapeSelection, group/ungroup/deleteSelectedShapes/updateShapes; 4 pruebas), `ObjectLayer.tsx` (marco del grupo, startGroup), comandos calc.shape.group/ungroup. e2e en e2e-calc-shapes. Tests: calc-engine 287, xlsx-io 66, apps/suite 351.
3b. [ ] Agrupar formas en WRITER (paso aparte, decidido por el usuario): las formas son nodos inline de ProseMirror; un grupo sería un nodo nuevo con formas dentro y en DOCX `wpg:wgp`. DISEÑO en `docs/diseno-agrupar-writer.md`, APROBADO por el usuario tal cual (2026-11-15). **Fase 1 (núcleo) HECHA**: `shapes-core/src/group.ts`, nodo `shape_group`, DOCX leer/escribir `wpg`, 7 pruebas nuevas (ver sección 12 del diseño). **Siguiente: fase 2 (interfaz)**: plugin de selección múltiple (Ctrl/Mayús+clic), `GroupView` + marco común extraído de `ShapeView`, comandos `writer.shape.group/ungroup` midiendo el DOM, mover/redimensionar/girar, diálogo, cinta (contextual + Insertar) y traducciones; luego fase 3 (e2e + docs). Hoy un grupo leído de un .docx se ve pero no se edita como bloque.

## Cómo retomar
1. `git status` y este archivo.
2. Shim de pnpm: crear `pnpm.cmd` con `corepack pnpm %*` en una carpeta del PATH.
3. `pnpm typecheck`, `pnpm test`; dev server (`pnpm dev` en `apps/suite`) y `node scripts/e2e-<producto>.mjs`.

## Otros subproductos de Office (lista del usuario: ver `SubProductos.png` / `Pruductos.png`)
Se abordan de uno en uno; registrar aquí cada uno al empezarlo.
