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

### Pendiente / a revisar
- [ ] e2e propio de Writer para la galería de formas (`scripts/e2e-writer-shapes.mjs`): insertar varias formas, guardar .docx y releer.
- [ ] README: mencionar `shapes-core` y la galería común.
- [ ] Siguiente del subproducto (a decidir con el usuario): puntos de ajuste, rotación en Calc, agrupar formas en Calc/Writer.
- [ ] Commit (solo cuando el usuario lo pida). Archivos sueltos sin versionar: `Pruductos.png`, `SubProductos.png` (referencias del usuario).

## Cómo retomar
1. `git status` y este archivo.
2. Shim de pnpm: crear `pnpm.cmd` con `corepack pnpm %*` en una carpeta del PATH.
3. `pnpm typecheck`, `pnpm test`; dev server (`pnpm dev` en `apps/suite`) y `node scripts/e2e-<producto>.mjs`.

## Otros subproductos de Office (lista del usuario: ver `SubProductos.png` / `Pruductos.png`)
Se abordan de uno en uno; registrar aquí cada uno al empezarlo.
