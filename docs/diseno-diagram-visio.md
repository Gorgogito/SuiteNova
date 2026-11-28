# Nova Diagram frente a Microsoft Visio (segunda ronda)

Estado: **plan aprobado** (2026-11-28; propuesto el 2026-11-27). Fases 1 a 4 hechas; ver la bitácora al final.

Referencia: Visio de escritorio. La comparación sale de leer el código de Nova Diagram y `docs/LIMITACIONES.md`, de
probarlo en Edge, de **abrir en Nova dibujos creados con Visio real y en Visio real un dibujo exportado por Nova**
(por automatización, con dibujos nuevos hechos para la prueba) y de la ayuda de Microsoft sobre
[conectores](https://support.microsoft.com/en-us/visio/add-connectors-between-visio-shapes),
[organigramas desde datos](https://support.microsoft.com/en-us/visio/build-an-org-chart-in-visio-based-on-worksheet-data),
[bordes y títulos](https://support.microsoft.com/en-us/visio/add-a-page-border-or-title) y
[comprobación de diagramas](https://support.microsoft.com/en-us/visio/validate-a-structured-diagram). El resto de las
funciones de Visio sale de lo que conozco: **no se recorrió su interfaz**.

El Visio instalado en este equipo es «LTSC Profesional 2024 Preview» y **avisa de que ha expirado**. La automatización
todavía permitió crear, guardar y exportar, pero puede dejar de hacerlo.

## 1. Lo que ya hay

- **Formas:** 64 propias (básicas, flujo, UML, redes, BPMN, imagen, contenedor y piscinas), con búsqueda y arrastrar.
- **Conectores:** rectos, en ángulo o curvos, pegados a las formas, siete puntas, texto, reparto en un mismo punto.
- **Organizar:** alinear, distribuir, igualar tamaño, orden, girar, reflejar, agrupar, bloquear, capas, contenedores y
  carriles, seis diseños automáticos.
- **Contenido:** imágenes con ajustes, iconos, recorte de pantalla, vínculos, datos de forma (CSV), comentarios, texto
  de imágenes, buscar, macros.
- **Archivos:** `.novadiagram`, SVG, PNG, PDF por impresión, importar y exportar `.vsdx`.

## 2. Fallos encontrados al revisar

### En el intercambio con Visio (de Visio a Nova, corregido en la fase 2)

Dibujo de prueba hecho con Visio (diagrama de flujo, grupo girado, imagen, líneas, página de fondo, BPMN, carril y
servidor) y abierto con la importación de Nova:

| Fallo | Detalle |
|---|---|
| **El dibujo entra casi en blanco** | Los colores del tema no se calculan: los rellenos salen blancos y el texto, que Visio guarda en blanco, queda **invisible**. Afecta a un dibujo nuevo con el tema por defecto |
| Las formas que son grupos en Visio salen rotas | La tarea BPMN pierde su caja, el servidor su dibujo y el carril se convierte en triángulos (las partes no heredan de su patrón) |
| La imagen desaparece **sin aviso** | Queda un rectángulo vacío; los avisos solo citan las curvas y el fondo |
| Se pierden datos de forma, vínculos, capas y fondo | Solo el fondo se avisa |
| Un grupo girado entra sin girar | Ya anotado en `LIMITACIONES.md` |
| El formato de la primera letra se aplica a todo el texto y sobra un salto de línea | «Revisar» a 18 pt agranda toda la forma |

Un dibujo de Nova abierto en Visio **se veía casi igual**, pero (corregido en la fase 3):

| Fallo | Detalle |
|---|---|
| **Los conectores son líneas sueltas** | 0 uniones: al mover una forma en Visio, las flechas se quedan donde estaban (ya anotado) |
| Se pierden datos de forma, **vínculos web**, capas, grupos y títulos de carril | Visio ve 0 en cada uno |
| Las clases UML muestran las líneas `---` encima de los compartimentos | |

La prueba del contenedor de Visio falló al crearlo, así que **los contenedores de Visio quedan sin comprobar**.

### En la aplicación (probado en Edge; corregidos en la fase 1)

| Fallo | Cómo se comprobó |
|---|---|
| **Imprimir con páginas de distinto tamaño sale mal:** todas usan el de la primera (dos páginas, una vertical, dan tres hojas apaisadas) | PDF generado |
| **Ctrl+S mientras se escribe guarda sin el texto**, y cerrar en ese momento no pregunta | En Edge |
| **No se puede mover el extremo de un conector pegado:** el punto de conexión queda encima y se crea otro conector | Con el ratón |
| La barra de estado sigue diciendo «Guardado» después de cambiar el diagrama | En Edge y en el código |
| Las palabras se parten por la mitad («existencia / s») | En Edge |
| Ctrl+rueda no mantiene el punto bajo el puntero (se fue 230 px) | En Edge |
| Una página nueva no toma el tamaño de la actual | En Edge |
| El botón de relleno tiene el icono de «Pegar» | En Edge y en el código |

## 3. Lo que falta frente a Visio

| Área | Falta |
|---|---|
| Dibujar | Flechas de conexión automática y formas rápidas, guías inteligentes, reglas y guías, desplazar arrastrando, menú contextual, escribir sobre la forma seleccionada, pegar entre ventanas y desde otros programas, copiar formato, cambiar de forma, panel de tamaño y posición, seleccionar por tipo, reemplazar texto, dibujo libre de líneas y curvas |
| Conectores | Esquivar formas, tramos editables, saltos de línea, mover el rótulo, insertar una forma sobre un conector |
| Texto | Formatos distintos dentro de una forma, viñetas, corrector y autocorrección, campos (página, fecha, nombre) |
| Aspecto y página | Temas y estilos rápidos, degradados y transparencia, páginas de fondo, bordes y títulos, centímetros y dibujo a escala, ajustar la página al dibujo, opciones de impresión |
| Plantillas y formas | Galería de plantillas al empezar, organigrama, escala de tiempo, planos, más formas de cada tipo, galerías propias (Visio instalado trae 362 galerías) |
| Datos | Crear o actualizar un diagrama desde Excel o CSV, gráficos de datos, informes de formas |
| Proceso | Comprobar el diagrama (conectores sueltos, reglas de flujo y BPMN) |

## 4. Plan en 8 fases

Cada fase termina con pruebas, e2e con capturas, `LIMITACIONES.md` y `PROGRESO.md`. Las de intercambio se comprueban
además con Visio real mientras funcione.

1. **Fallos y cimientos.** Los fallos de la aplicación.
2. **Abrir dibujos de Visio.** Colores y estilos del tema, herencia de patrones en grupos, imágenes, texto con formato
   básico, datos, vínculos, capas, fondo, giro de grupos; las formas comunes de flujo pasan a ser formas de Nova; avisar
   de todo lo que no entre.
3. **Guardar para Visio.** Conectores pegados, datos, vínculos, capas, grupos, carriles, compartimentos y contenedores.
4. **Dibujar como en Visio.** Conexión automática y formas rápidas, guías, reglas, desplazar, menú contextual, escribir
   directo, portapapeles del sistema, copiar formato, cambiar forma, tamaño y posición, buscar y reemplazar.
5. **Conectores y texto.** Esquivar formas, tramos editables, saltos, rótulos movibles, insertar en un conector; formato
   por fragmentos, viñetas y corrector (`spell-core`).
6. **Aspecto y página.** Temas y estilos rápidos, degradados, fondos, bordes y títulos, campos, unidades y escala,
   impresión (ajustar, mosaico).
7. **Plantillas y formas.** Galería al empezar, plantillas (flujo, funciones cruzadas, organigrama, BPMN, red, escala de
   tiempo, plano sencillo), formas nuevas dibujadas por nosotros y abrir galerías `.vssx` propias.
8. **Datos, comprobación y cierre.** Diagrama desde Excel o CSV (`xlsx-io`) y actualizarlo, gráficos de datos, informes,
   comprobar el diagrama; revisión final, versión 0.0.17 e instaladores.

Las fases 2 y 3 van pronto para poder usar Visio antes de que su versión de prueba deje de responder.

## 5. Fuera del plan

- Visio para la web, coautoría, Teams, SharePoint, Power Automate y complementos.
- Los `.vsd` antiguos, la tinta, y planos de ingeniería o CAD.
- Copiar las formas de Microsoft: Nova no las incluirá. Quien las tenga podrá abrirlas desde sus galerías (fase 7).

## 6. Límites que seguirán

- Fidelidad aproximada en `.vsdx`: Visio calcula formas con fórmulas que no se van a reproducir.
- Los archivos de prueba hechos con Visio contienen formas de Microsoft y **no se suben al repositorio**; las pruebas
  automáticas usarán archivos escritos a mano con la misma estructura.

## 7. Bitácora

### Fase 1 (hecha, 2026-11-28): fallos y cimientos
Los ocho fallos de la tabla de la aplicación, corregidos:

- **Imprimir:** cada página sale en una hoja de su tamaño (`printDocument` en `diagram-core`, con páginas CSS con
  nombre). La hoja crece si el dibujo se sale; las capas ocultas ya no la agrandan.
- **Escribir y guardar:** el controlador sabe qué se está escribiendo (texto de forma o conector, nombre de carril o de
  capa). Ctrl+S, imprimir y exportar lo incluyen sin cerrar el editor; cerrar o abrir otro archivo pregunta. El guardado
  automático no toca el editor: recoge el texto al terminar de escribirlo.
- **Extremo de un conector pegado:** los extremos del conector seleccionado se dibujan encima de los puntos de conexión.
- **«Guardado»:** solo mientras no haya cambios.
- **Palabras partidas:** una palabra más larga que la línea queda entera mientras quepa en la forma. De paso, los
  rótulos de conector se miden sobre las mismas líneas que se dibujan.
- **Ctrl+rueda:** el punto bajo el puntero no se mueve.
- **Página nueva:** toma tamaño, cuadrícula y separación de conectores de la anterior (el color de fondo no).
- **Icono de relleno:** un bote de pintura. Y el editor de texto es opaco, para que no se transparente el texto ya
  guardado.

Pruebas: 7 nuevas en `diagram-core` (`foundations.test.ts`), 2 del controlador y `scripts/e2e-diagram-fixes.mjs`
(9 comprobaciones). Pasan además las 27 de `e2e-diagram` y los e2e de comentarios, imágenes, OCR y macros.

Sin probar: la ventana de impresión real y una impresora (las hojas se comprobaron generando el PDF con Edge sin
ventana), y la aplicación de escritorio compilada.

### Fase 2 (hecha, 2026-11-28): abrir dibujos de Visio
El lector se ha rehecho en `diagram-core`: `vsdx-read.ts` (partes y herencia de celdas), `vsdx-theme.ts` (temas),
`vsdx-geometry.ts` (arcos, elipses, polilíneas y NURBS) y `vsdx-import.ts` (formas de Nova). `vsdx.ts` queda para
escribir.

- **Herencia como Visio:** forma → patrón (cada parte de un grupo con la suya) → hojas de estilo → tema de la página.
- **Temas:** el color de una forma sale de sus números de «estilo rápido», la variante de la página y las listas de
  estilos del tema; los conectores usan las suyas. Las mezclas de color se hacen en luz lineal.
- **Reglas halladas comparando con Visio:** el relleno de varios contornos de una forma deja huecos; las líneas van
  encima de los rellenos sea cual sea su orden; el dibujo propio de un grupo va delante de sus partes; reflejar no gira
  el texto; sin tema, `THEMEVAL(…)` vale su valor guardado; el texto claro del tema se dibuja con el color de la forma
  cuando detrás solo está la hoja; una forma puede dibujar fuera de su caja.
- **Cómo se comprobó:** pidiendo a Visio por automatización los colores que calcula (1449 formas, 6 temas) y
  comparando a la vista las páginas que exporta con las de Nova (`real.vsdx` y un dibujo de 20 páginas). Esos archivos
  llevan formas de Microsoft y no están en el repositorio.
- **Pruebas:** 25 nuevas con archivos escritos a mano (`vsdx-import.test.ts`) y `scripts/e2e-diagram-visio.mjs`
  (5 comprobaciones). El dibujo grande (unas 2000 piezas) se abre en Edge en 1,2 s.

Queda aproximado o fuera (ver `LIMITACIONES.md`): degradados y tramas, sombras del tema, un formato por texto,
imágenes en metarchivo, contenedores como grupos y el recorrido de los conectores. Los temas, degradados y fondos
propios son de la fase 6; el formato por fragmentos, de la fase 5.

### Fase 3 (hecha, 2026-11-28): guardar para Visio
La escritura se ha rehecho: `vsdx-write.ts` (formas y conectores de cada página), `vsdx.ts` (paquete, capas y
comentarios) y `vsdx-nova.ts` (lo que comparten escritura y lectura).

- **Conectores:** líneas con `ObjType 2`. Pegados a la forma entera con `_WALKGLUE` o a un punto con
  `PAR(PNT(…))`, con sus registros `Connect`. Cada forma lleva sus puntos de conexión.
- **Formas:** contornos relativos a la caja. Lo que Visio no puede pintar en una sola hoja (otro color u otro grosor
  encima de un relleno, una imagen, los compartimentos de una clase) va como grupo que lleva el texto, los datos y los
  puntos.
- **Datos, vínculos, capas, grupos:** en las secciones propias de Visio; en un grupo las partes siguen el tamaño del
  grupo. Los textos con `{{nombre}}` son campos ligados al dato. Todas las capas se escriben, también las ocultas.
- **Contenedores y carriles:** contenedores de Visio; el contenedor nombra todo lo que tiene y cada miembro todos los
  que lo rodean (`DEPENDSON`). Cada carril es un contenedor dentro de la piscina.
- **De vuelta:** anotaciones `Nova…` en la sección `User` para recomponer formas, piscinas y textos; un carril
  copiado en Visio cuenta como uno más y los de una piscina borrada quedan como formas.
- **Corregidos de paso:** de la fase 2, una expresión mal escrita (`/s+/` en lugar de `/\s+/`) que ensanchaba de más
  los rótulos colocados fuera de su forma o girados; una línea sin trazo ya no se lee como discontinua; el texto bajo
  una forma de Nova ya no vuelve como rótulo aparte; una forma de punta «rombo» de Visio se lee como rombo hueco; no se
  crea una capa «Sin capa» solo porque haya grupos.
- **Cómo se comprobó:** abriendo en Visio un dibujo de 4 páginas con todo lo anterior, pidiéndole uniones, capas,
  datos, vínculos y miembros de cada contenedor, moviendo y ampliando formas, guardando desde Visio y volviendo a abrir
  en Nova; y reexportando los dibujos de Visio de la fase 2.
- **Pruebas:** 21 nuevas en la biblioteca (casi todas en `vsdx-write.test.ts`) y una comprobación más en
  `scripts/e2e-diagram-visio.mjs`.

Sin probar: el uso con el ratón en Visio (que un contenedor arrastre a sus miembros: por automatización tampoco lo
hacen los de Visio), otras versiones de Visio y la aplicación de escritorio compilada.

### Fase 4 (hecha, 2026-11-28): dibujar como en Visio
La lógica está en `diagram-core/draw.ts`; en la aplicación, `Stage.tsx`, `Rulers.tsx`, `clipboard.ts`, `menu.ts`,
`find-host.ts` y `SizePane.tsx`.

- **Conexión automática** con formas rápidas, **guías inteligentes**, **reglas y guías** (guardadas con el diagrama y
  que van y vuelven de Visio), **desplazar** con Espacio o el botón central, **menú contextual** (también con el
  teclado), **escribir** sobre la forma seleccionada, **portapapeles del sistema** y «Copiar como imagen», **copiar
  formato**, **cambiar forma**, panel de **tamaño y posición** y **buscar y reemplazar** con el panel común de la suite.
- **Cambios de comportamiento:** Ctrl+C, X y V pasan a ser los del sistema; mientras se escribe, Ctrl+Z, Ctrl+D y
  Ctrl+A actúan sobre el texto y no sobre el diagrama; «Buscar» deja de ser un cuadro y es una barra.
- **Corregidos de paso:** Ctrl+C dentro de un texto copiaba las formas, y al arrastrar, el contorno de la selección se
  quedaba en el sitio de partida.
- **Pruebas:** 14 nuevas en la biblioteca (`draw.test.ts` y la de las guías), 9 de la aplicación y
  `scripts/e2e-diagram-draw.mjs` (10 comprobaciones). Las guías se comprobaron en Visio en los dos sentidos.
- **Quedan fuera** (estaban en la comparación, no en esta fase): seleccionar por tipo y el dibujo libre de líneas y
  curvas.

Sin probar: la aplicación de escritorio compilada (en especial el portapapeles), copiar desde Word o Excel, teclas
muertas con un teclado real y pantallas táctiles.
