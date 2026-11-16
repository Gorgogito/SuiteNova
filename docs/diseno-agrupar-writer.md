# Diseño: agrupar formas en Nova Writer

Estado: **aprobado tal cual por el usuario (2026-11-15); fases 1 (núcleo) y 2 (interfaz) HECHAS; la 3 (e2e y docs finales) queda cubierta en lo esencial, ver sección 13.** Decisiones: imágenes en grupos después, anidar desde ya, comandos en la pestaña contextual e Insertar. Continúa el trabajo de Formas
(`docs/PROGRESO.md`, punto 3b). Calc ya agrupa (`3f3540e`); aquí se parte de lo aprendido allí.

## 1. Por qué Writer es distinto de Calc

| | Calc | Writer |
|---|---|---|
| Dónde viven las formas | lista plana por hoja, coordenadas absolutas | **nodos `shape` en línea** dentro de párrafos de ProseMirror |
| Posición | `x`, `y` de la hoja | según `wrap`: en línea, a izquierda/derecha, o flotante con `x`,`y` **relativos a su párrafo** |
| Selección múltiple | un arreglo de ids | **ProseMirror no tiene selección múltiple de nodos** |
| Grupo en el archivo | `xdr:grpSp` | `wpg:wgp` dentro de un `w:drawing` (un solo objeto) |

Por eso el modelo de Calc (campo `group` plano) **no sirve**: en DOCX un grupo es *un* objeto con hijos, y en Writer las
formas de un grupo no tienen por qué estar en el mismo párrafo.

## 2. Modelo propuesto

### 2.1 Nodo nuevo `shape_group`
- Inline, `content: '(shape | shape_group)+'`, `isolating`, atributos de marco como `shape`: `width`, `height`, `rotation`,
  `wrap`, `x`, `y`, `alt`, `id` (sin relleno ni contorno: eso es de las hijas).
- Las hijas son los **mismos nodos `shape`** que ya existen. Dentro de un grupo, su `x`,`y` son **relativos a la esquina del
  grupo** (siempre en píxeles; `wrap` de las hijas se ignora y se guarda como `front`).
- **Anidar se permite en el modelo y en DOCX** (así se lee un documento real sin aplanarlo, a diferencia de Calc).
  Agrupar un grupo con otra forma crea un grupo dentro de otro; Desagrupar deshace un nivel.
- Las hijas **conservan su texto editable** (los cuadros de texto siguen siendo contenido de ProseMirror).
- El grupo gira con CSS `rotate` y sus hijas lo siguen sin cálculo; su tamaño siempre coincide con el de sus hijas
  (identidad, sin `chExt` aparte): al redimensionar el grupo se **reescriben** `x,y,width,height` de todas las descendientes
  en una sola transacción (igual que Calc). Al **leer** un DOCX con `chExt ≠ ext` se escala una vez al cargar.

### 2.2 Matemática compartida (refactor previo)
Mover, escalar y girar un bloque ya está escrito y probado en `calc-engine/src/shape-group.ts`, pero depende de `SheetShape`.
Se **extrae a `shapes-core/src/group.ts`** sobre un tipo mínimo `{ id; x; y; width; height; rotation? }`; Calc lo usa por un
adaptador y **sus pruebas actuales (5 + 4 + e2e) deben seguir en verde**. Writer lo necesita para:
- **Agrupar:** hijas = posición de cada forma relativa a la esquina del cuadro que las rodea.
- **Desagrupar:** el giro del grupo se reparte (centro de cada hija girado alrededor del centro del grupo + `rotation` sumado).
- **Redimensionar/girar** el grupo.

## 3. Selección múltiple
- Un *plugin* de ProseMirror guarda las **posiciones** de las formas elegidas (se mapean con cada transacción), con
  decoraciones de contorno. **Ctrl/Mayús+clic** sobre una forma la añade o quita (el clic ya selecciona por borde/dibujo).
- Una sola forma seguirá siendo `NodeSelection` normal; el plugin solo se activa con dos o más.
- Solo formas **del mismo editor** (cuerpo, o la misma cabecera/pie). Si no, el comando avisa.

## 4. Agrupar y desagrupar (con geometría real)
Como las formas pueden estar en párrafos distintos y su posición depende del `wrap`, **se mide el DOM**:
1. Se obtienen los rectángulos en pantalla de las formas elegidas y del párrafo de la primera; se divide por el zoom
   (el cálculo ya existe en `ShapeView`: `getBoundingClientRect().width / offsetWidth`).
2. El grupo se crea en el párrafo de la primera forma con `wrap: 'front'` y `x,y` relativos a ese párrafo; las hijas relativas
   al grupo. Todo en **una transacción** (un paso de deshacer); las formas originales se borran.
3. Desagrupar hace el camino inverso: cada hija pasa a `front` con `x,y` relativos al párrafo (medidos igual).
- Comandos `writer.shape.group` / `writer.shape.ungroup` en la pestaña contextual de formas y en Insertar › Ilustraciones.

## 5. Vista y edición (`GroupView`)
- Sale de `ShapeView`: el **mismo marco** (asas de tamaño, de mover si es flotante, giro) pero sin relleno propio. Se extrae
  de `ShapeView` el comportamiento de marco a un módulo común en vez de duplicarlo.
- Las hijas se dibujan con su `ShapeView` pero en modo `inGroup`: **sin asas ni arrastre propios** (se ve por
  `resolve(pos).parent`), con el texto editable.
- El diálogo «Formato de forma» sobre un grupo edita solo ajuste, posición, tamaño, giro y texto alternativo.
  Para cambiar el relleno de una hija: Desagrupar (igual que Calc).
- Paginación: el grupo lleva la clase `nw-shape`, así `paginate.ts` (que excluye `.nw-shape` y descendientes) no cuenta su
  texto como líneas. No hay cambios de diseño de página.

## 6. DOCX (`packages/writer-core/src/docx`)
**Escritura** (`writer.ts`): `a:graphicData uri="…/wordprocessingGroup"` con `wpg:wgp` › `wpg:cNvGrpSpPr`, `wpg:grpSpPr`
(`a:xfrm` con `off`/`ext`/`chOff`/`chExt` iguales: identidad) y por hija `wps:wsp` (reutiliza `shapeXml`, ya con `avLst` y giro)
o `wpg:grpSp` si va dentro de otro grupo (en la especificación el anidado se llama `grpSp`, no `wgp`). Dentro de `mc:AlternateContent Requires="wpg"`; hay que **declarar el espacio de nombres `wpg`** en
`shared.ts` y en el elemento raíz (`mc:Ignorable`).
**Lectura** (`reader.ts`): hoy `wgp`/`grpSp` se **omiten con aviso** (`reader.ts`, `drawing()`); pasará a leerse recursivamente,
mapeando coordenadas hijas con `chOff`/`chExt` y leyendo `rot`. Se avisa de lo no admitido.

## 7. Otros sitios que hay que tocar (auditoría)
`packages/writer-core`: `notes.ts:46`, `refs.ts:40`, `formats/odt.ts:600`, `formats/rtf.ts:665` (tratan `shape` como objeto
opaco → `shape_group` igual). App: `story.ts:43` (no recorrer dentro), `commands-objects.ts:68` (`selectedShape`),
`dialogs.tsx:309` / `dlg-objects.tsx:156`, y el schema `parseDOM`/`toDOM`. Comprobar además revisión de accesibilidad
(texto alternativo) y recuento de palabras para que cuenten el texto de las hijas igual que hoy cuentan el de un cuadro de texto.

## 8. Fuera de alcance de esta fase (se documentará en LIMITACIONES.md)
- **Imágenes dentro de un grupo** (`pic:pic` en `wpg`): hoy las imágenes son nodos en línea sin posición absoluta; admitirlas es
  otro paso. Al leer un grupo con imágenes se **omiten con aviso** (no se inventan).
- Voltear (`flipH/V`) hijas o el grupo: Writer no lo soporta en formas; se ignora con aviso.
- Editar relleno/contorno de una hija sin desagrupar; selección por recuadro.
- **Sin probar en Word real** (como en todo lo demás).
- ODT/RTF: un grupo se guarda como lo hacen hoy las formas en esos formatos (opaco/omitido); sin soporte propio.

## 9. Fases y pruebas
1. **Núcleo** (sin UI): extraer la matemática a `shapes-core` (Calc sigue en verde) · schema `shape_group` · DOCX leer/escribir ·
   pruebas en `writer-core` (ida y vuelta con 2 formas + cuadro de texto, anidado, escalado por `chExt`, giro, aviso por imagen) y
   en `shapes-core`.
2. **Interfaz:** plugin de selección múltiple · `GroupView` + marco común · comandos agrupar/desagrupar con medida del DOM ·
   mover/redimensionar/girar el grupo · diálogo · cinta y traducciones.
3. **e2e `e2e-writer-shapes.mjs`** (Ctrl+clic, agrupar, mover, redimensionar, girar, texto de una hija, guardar y releer .docx,
   desagrupar, deshacer) + regresión de `e2e-writer*` y Calc + docs + `PROGRESO.md`.

Cada fase termina con typecheck, `pnpm test`, e2e y captura real antes de seguir; commit solo cuando se pida.

## 10. Riesgos
- **Medir el DOM al agrupar** (zoom, tablas, formas flotantes entre párrafos): se mitiga midiendo respecto de un único origen y
  con pruebas e2e a distintos zoom.
- **Word real:** la forma exacta de `wpg` es delicada (orden de elementos, espacios de nombres). Se sigue la especificación y
  se documenta que no se ha abierto en Word.
- **Selección dentro de nodos anidados** en ProseMirror (hijas con texto editable): el plugin y `GroupView` deben dejar al
  cursor entrar en el texto de una hija sin seleccionar el grupo.

## 11. Decisiones que necesito del usuario
1. **Imágenes en grupos:** ¿se dejan para después (recomendado) o se incluyen ahora?
2. **Anidar grupos:** ¿se admite desde ya (recomendado, porque Word los usa) o se aplana como en Calc?
3. **Dónde ir:** ¿pestaña contextual de forma + Insertar (recomendado) o solo la contextual?

## 12. Registro de la fase 1 (hecha, 2026-11-15)
- `shapes-core/src/group.ts` (+ `group.test.ts`, 6 pruebas): `frameBounds`, `framesBounds`, `moveFrames`, `scaleFrames`, `rotateFrames`, `framesToGroup`, `framesFromGroup`. El tipo se llama `FrameBox` (no `Box`: `slides-core` ya exporta uno y chocaba). `calc-engine/shape-group.ts` delega en él y conserva su API; sus 5 pruebas y el e2e de Calc siguen en verde.
- `writer-core/schema.ts`: nodo `shape_group` (contenido `(shape | shape_group)+`, `wrap` por omisión `front`). La regla `parseDOM` de `shape` ya no toma un grupo.
- DOCX: `writer.ts` reparte `shapeXml` en `wspXml`, `wgpXml` y `floatingXml`; `shared.ts` declara `wpg`; `reader.ts` mira `wgp` antes que `wsp` (antes un grupo se leía como una sola forma) y escala las hijas por `chExt`. Imágenes dentro de un grupo: se omiten con aviso.
- `notes.ts`, `refs.ts`, `formats/odt.ts`, `formats/rtf.ts` y `apps/suite/src/writer/story.ts` tratan `shape_group` como `shape`.
- Pruebas: 3 en `docx-features.test.ts` (ida y vuelta con anidado, giro, ajuste y texto; escalado por `chExt` con comprobación de que el XML cambió; imagen omitida con aviso) y 4 en `shape-group.test.ts` (contenido del nodo, DOM, ODT/RTF, sin aviso al escribir). writer-core 152, shapes-core 17.
- Comprobado en la app real: un grupo insertado se dibuja con sus hijas giradas juntas y sobrevive a guardar y releer el .docx, sin errores de consola. Todavía **no hay** asas, selección múltiple ni comandos (fase 2): un grupo abierto desde un .docx se ve pero no se puede mover ni redimensionar como bloque.

## 13. Registro de la fase 2 (hecha, 2026-11-15)
- `writer-core/src/shape-group.ts` (`scaleGroupContent`, con 2 pruebas): escala un grupo y, de forma recursiva, sus hijas. Una prueba cazó un error propio (el anidado se escalaba desde el tamaño ya nuevo).
- `apps/suite/src/writer/shape-selection.ts`: plugin de selección múltiple (posiciones mapeadas con cada transacción, contorno discontinuo en las elegidas), `toggleShapeSelection` (Ctrl/Mayús+clic), `selectShapeOnly`, `outerGroupPos`, `placeCaretFromClick`.
- `shape-group-ops.ts`: `groupSelectedShapes` y `ungroupSelectedShapes`. Miden el DOM **antes** de cambiar el documento (el bloque contenedor es el primer antecesor con `position`, con el zoom dividido) y hacen todo en una transacción. **Sin `scrollIntoView`**: al principio la vista se desplazaba 16 px y parecía que las formas se movían.
- `nodeviews.ts`: `GroupView` (asas de tamaño, de mover si flota y de giro; escalado desde el grupo del inicio del gesto) y cambios en `ShapeView` (una hija no tiene marco propio y al pulsarla se elige el grupo más externo; Ctrl/Mayús+clic; `dblclick` solo fuera de grupos).
- Comandos `writer.shape.group` / `writer.shape.ungroup`; pestaña contextual **Formato de forma** (Formato de forma…, Agrupar, Desagrupar) y dos botones solo con icono en Insertar › Ilustraciones. El cuadro Formato de forma de un grupo no ofrece relleno ni contorno y, si cambia el tamaño, escala las hijas.
- **Dos defectos que ya existían y se corrigieron por el camino:** (1) `setNodeMarkup` convierte la selección de nodo en selección de texto, así que las asas de una forma desaparecían al primer movimiento; ahora los gestos de `ShapeView` y `GroupView` restauran la selección. (2) Con un cuadro de texto seleccionado como objeto, un clic en su texto dejaba el cursor fuera y lo escrito iba al párrafo; ahora el cursor entra en la caja (en la zona vacía, al final de su último párrafo).
- e2e (`e2e-writer-shapes.mjs`, 10 comprobaciones): Ctrl+clic con 3 formas, agrupar **sin que ninguna se mueva a la vista**, clic en una hija = grupo, escribir en el cuadro de texto de una hija, mover, redimensionar (hijas escaladas), girar 90°, guardar y releer .docx, desagrupar **sin que se mueva nada aun con el grupo girado**, deshacer en un paso, y el cuadro de formato del grupo.
- Verificado: typecheck limpio; `pnpm test` en verde (writer-core 154); e2e de Writer (19 + shapes + image + page + tables + styles + review + autocorrect), Calc y Slides en verde.
- **Conocido, anterior a esta fase:** `e2e-writer-format` («Copiar formato») falla de forma intermitente (≈1 de 4 también sin estos cambios); y a 1400 px el grupo «Texto» de Insertar se pliega, así que el e2e de «Símbolo…» abre el desplegable si hace falta.

## 14. Selección por recuadro (hecha, 2026-11-16)
Como en Office, es un modo: **Seleccionar objetos** (Calc: Inicio › Edición › Buscar; Writer: Inicio › Edición). Arrastrar sobre la hoja o la página dibuja un recuadro y elige las formas y grupos que quedan **por completo** dentro (los grupos se eligen enteros); Ctrl o Mayús suman; un clic en vacío deselecciona; Esc o el mismo comando vuelven al modo normal; un clic sobre una forma la elige como siempre. Calc: capa `calc-selectcatch` en `ObjectLayer` y `doc.x.selectShapes`. Writer: `shape-marquee.ts`, capturado en el contenedor de la página (los márgenes también cuentan) y en fase de captura, para que el editor no mueva el cursor. e2e: una comprobación en `e2e-calc-shapes.mjs` y otra en `e2e-writer-shapes.mjs`. Límite: no se elige una forma que queda solo en parte dentro, y en Writer las formas dentro de un cuadro de texto o de un grupo no se eligen por separado.
