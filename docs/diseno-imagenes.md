# Imágenes (producto auxiliar compartido): diseño

## 1. Cómo es en Office
- **Compartido:** el motor de dibujo (Office Art / DrawingML) y las **Herramientas de imagen**. Word, Excel, PowerPoint y Outlook usan la misma pestaña «Formato de imagen» con las mismas funciones:
  - **Ajustar:** quitar fondo, correcciones (nitidez, brillo y contraste), color (saturación, tono, recolorear), efectos artísticos, comprimir, cambiar imagen, restablecer imagen.
  - **Estilos de imagen:** galería de estilos, borde, efectos (sombra, reflejo, resplandor, bordes suaves, bisel, giro 3D).
  - **Organizar y Tamaño:** recortar (también a una forma y a una relación de aspecto), alto y ancho, girar y voltear, alinear y agrupar, texto alternativo.
  - **Insertar:** desde un archivo, del portapapeles, de imágenes en línea, iconos, captura de pantalla.
- **Los efectos son propiedades, no píxeles:** la imagen original se conserva y los ajustes se pueden cambiar o quitar después («Restablecer imagen» vuelve al original). Lo que Office guarda en el archivo es la imagen original más una lista de efectos.
- **Propio de cada producto:** cómo se coloca la imagen. Word: en línea o con ajuste del texto, anclada a un párrafo. Excel: se mueve y cambia de tamaño con las celdas (o solo se mueve, o ni una cosa ni otra). PowerPoint: posición libre en la diapositiva, marcadores de posición de imagen. Outlook: dentro del cuerpo del mensaje (usa el motor de Word).
- **Conjuntos reducidos** (no tienen la pestaña completa): **OneNote** (tamaño, giro, texto alternativo, copiar el texto de la imagen, ajustar como fondo), **Visio** (un subconjunto de las herramientas de Word, sobre una forma de imagen), **Access** y **Microsoft Forms** (controles de imagen: elegir el archivo, el modo de ajuste y el texto alternativo, sin herramientas de edición).

## 2. Decisiones (del usuario)
- **Alcance «como lo tiene Office»:** conjunto completo en **Writer, Calc, Slides y Mail**; conjunto reducido en **Notes** y **Diagram**; solo el control de imagen (archivo, ajuste, texto alternativo) en **Base** y **Forms**.
- **Núcleo compartido, y los efectos pasan a ser propiedades reversibles en todos los productos** (como Office), no cambios de píxeles. Hoy Nova Slides aplica los efectos artísticos, quitar fondo y comprimir sobre los píxeles; con el núcleo compartido se guardan como propiedades sobre la imagen original y se pueden cambiar, quitar o restablecer.

## 3. Estado de partida
- **Slides** (el más completo): `PicEl` con recorte (`srcRect`), forma (`geom`), borde, efectos y ajustes de DrawingML (`a:lum`, escala de grises, blanco y negro, duotono, transparencia), formato de imagen con pestaña propia, y herramientas que **cambian los píxeles** (`slides/picfx.ts`, `slides-core/pixels.ts`): quitar fondo de un solo color, 6 efectos artísticos, comprimir, iconos, álbum, captura, guardar como imagen.
- **Writer:** átomo `image` con texto alternativo, tamaño, recorte por porcentajes en un cuadro, giro, volteo, borde y ajuste del texto (en línea, izquierda, derecha, arriba y abajo, delante, detrás). Sin correcciones, color, efectos, estilos, comprimir ni cambiar imagen; el recorte no se hace con asas.
- **Calc:** `SheetImage` con posición, tamaño, nombre y texto alternativo. Nada más: sin recorte, borde ni ajustes, y sin opción de moverse con las celdas.
- **Mail:** muestra las imágenes de los mensajes recibidos (`cid:`), pero **no hay insertar imagen en el cuerpo** al redactar (solo adjuntos).
- **Notes:** contenedores de imagen con texto alternativo, tamaño y **OCR** (Tesseract); sin giro ni recorte.
- **Diagram:** imagen de una forma (`ShapeImage`: estirar, contener, cubrir), de hasta 8 MB, insertada con un botón o arrastrando; sin herramientas de ajuste, y no se exporta a Visio.
- **Base y Forms:** controles de imagen (informes de Base, formularios de Base y de Forms) con la imagen guardada dentro (hasta 1,5 MB), sin modo de ajuste elegible ni texto alternativo en todos.
- **Diferencias de formato:** `.pptx` guarda lo de arriba; `.docx` guarda recorte, giro, volteo, borde y ajuste; `.xlsx` guarda posición y tamaño. Nada de eso se ha abierto en el producto real salvo lo ya anotado en `LIMITACIONES.md`.

## 4. Plan por fases
1. **Núcleo `image-core`:** modelo de las propiedades de una imagen (recorte, forma, correcciones, color, efectos artísticos, fondo quitado, borde y efectos) y motor que, dados la imagen original y las propiedades, produce la imagen final (el que hoy está en `slides-core/pixels.ts` pasa aquí, con correcciones nuevas: brillo, contraste, nitidez, saturación y temperatura); qué parte de las propiedades entiende Office de forma nativa en DrawingML (`a:lum`, `a:duotone`, `srcRect`…) y qué parte hay que guardar como imagen resultante junto con las propiedades de Nova; caché; pruebas.
2. **Interfaz compartida y Slides como producto de referencia:** pestaña «Formato de imagen», panel de formato, galería de estilos, cuadros (correcciones, color, efectos artísticos, quitar fondo con áreas marcadas, comprimir, cambiar y restablecer), todo reversible; Slides deja de cambiar píxeles. Recorte con asas, a una forma y a una relación de aspecto, compartido.
3. **Writer:** las propiedades de la fase 1 sobre su átomo `image` (el ajuste del texto sigue siendo suyo) y guardado en `.docx`.
4. **Calc y Mail:** Calc (propiedades, recorte, y «mover y cambiar de tamaño con las celdas», guardado en `.xlsx`); Mail (insertar imagen en el cuerpo del mensaje y sus herramientas).
5. **Notes, Diagram, Base y Forms:** los conjuntos reducidos de cada uno (Notes: giro, recorte y alt; Diagram: ajustes sobre la forma de imagen y exportación a `.vsdx`; Base y Forms: modo de ajuste y texto alternativo).
6. **Orígenes de imagen, y cierre:** menú único de insertar (archivo, portapapeles, arrastrar, iconos, captura de pantalla; sin imágenes en línea porque nada sale a Internet), y comparación con Office real por COM (abrir los `.docx`, `.xlsx` y `.pptx` de Nova en Word, Excel y PowerPoint y comprobar recorte, forma, brillo y contraste, giro, borde y texto alternativo), documentación y límites.

Cada fase se hace producto por producto y se prueba antes de pasar a la siguiente.

## 5. Bitácora
(Aún no hay fases hechas.)

## 6. Estado
Diseño hecho. Ninguna fase empezada.
