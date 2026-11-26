# Medidas de los temas de Office (Office 2024 LTSC 16.0.18817, Windows 11, 2026-11-25)

Capturas de pantalla reales (2560x1440) de Word, Excel y PowerPoint con archivos de muestra, una por tema y aplicación
(`word-0.png`, `excel-3.png`…). Las etiquetas del nombre de archivo son las mías, no los valores del registro:

| Archivo | Tema de Office | Valor `UI Theme` (HKCU\Software\Microsoft\Office\16.0\Common) |
|---|---|---|
| `*-0.png` | Multicolor | 7 |
| `*-3.png` | Gris oscuro | 3 |
| `*-4.png` | Negro | 4 |
| `*-5.png` | Blanco | 5 |
| `*-6.png` | Utilizar la configuración del sistema | 6 (con Windows en modo oscuro, `AppsUseLightTheme=0`, se ve **igual que Negro**) |

`word-3-solo.png` es una captura suelta de Word en Gris oscuro de una prueba anterior.

Las imágenes están recortadas a la ventana de Office (2408x1390, desde la esquina superior izquierda, así que las
coordenadas no cambian) y con el avatar de la cuenta tapado: el repositorio es público.

## Cómo se midió y qué no se pudo

- Forzar el tema por registro **no funciona**: Word lo reescribe al arrancar (el tema viaja con la cuenta). Se cambió desde
  Archivo › Cuenta, a mano, con las tres aplicaciones abiertas (el cambio se aplica a todas a la vez).
- Las aplicaciones se abrieron con `ProcessStartInfo` (sin COM, que se colgaba) y se cerraron con `CloseMainWindow`.
- La barra de título, las pestañas y el lienzo de Word/PowerPoint usan el efecto Mica de Windows 11: son **translúcidos y se
  tiñen con el fondo de pantalla**. Los valores de esas zonas son la media de varias muestras, llevada a gris neutro; son
  aproximados (± unos 8 niveles). La cinta, el texto y la barra de estado son opacos y exactos.

## Valores medidos (Word; Excel y PowerPoint coinciden salvo lo indicado)

| Zona | Multicolor | Blanco | Gris oscuro | Negro / Sistema (oscuro) |
|---|---|---|---|---|
| Barra de título | color de la aplicación | ~#E6E6E6 (Mica) | ~#525252 (Mica) | ~#1A1A1A (Mica) |
| Texto de la barra de título | #FFFFFF | #242424 | #FFFFFF | #FFFFFF |
| Pestañas (fondo) | ~#E6E6E6 (Mica) | ~#E6E6E6 (Mica) | ~#525252 | ~#1A1A1A |
| Texto de pestañas | #242424 | #242424 | #FFFFFF | #FFFFFF |
| Cinta (fondo) | #FFFFFF | #FFFFFF | #BDBDBD | #292929 |
| Texto de la cinta | #242424 | #242424 | #242424 | #FFFFFF |
| Lienzo (alrededor de la página) | ~#ECECEC (degradado pastel de Mica) | ~#ECECEC | ~#555555 | ~#1C1C1C |
| Página de Word | #FFFFFF | #FFFFFF | #FFFFFF | **#262626 (la página también es oscura)** |
| Barra de estado | #F5F5F5 | #F5F5F5 | #525252 | #141414 |
| Texto de la barra de estado | #242424 | #242424 | #FFFFFF | #FFFFFF |
| Barra de fórmulas (Excel) | #FFFFFF | #FFFFFF | ~#4D4D4D | #292929 |
| Hoja de cálculo (Excel) | #FFFFFF | #FFFFFF | #FFFFFF | #FFFFFF (la cuadrícula sigue blanca) |
| Diapositiva (PowerPoint) | #FFFFFF | #FFFFFF | #FFFFFF | #FFFFFF (la diapositiva sigue blanca) |

Colores de la barra de título en Multicolor: Word `#185ABD`, Excel `#107C41`, PowerPoint `#C43E1C`.
Botón «Compartir»: del color de la aplicación en los temas oscuros y Multicolor.

## Estados y detalles (segunda pasada sobre las mismas capturas, 2026-11-25, 100 % de escala)

| Detalle | Multicolor | Blanco | Gris oscuro | Negro |
|---|---|---|---|---|
| Botón pulsado: fondo / borde | #EBEBEB / #616161 | #EBEBEB / #616161 | #CCCCCC / #7A7A7A | #383838 / #ADADAD |
| Texto desactivado | #BDBDBD | #BDBDBD | #858585 | #5C5C5C |
| Separador de grupos | #D1D1D1 | #D1D1D1 | #858585 | #666666 |
| Borde de cuadro de texto | #8A8A8A | #8A8A8A | #666666 | #757575 |
| Buscador: fondo | color de la aplicación aclarado | #FAFAFA | #BDBDBD | #1F1F1F |
| Buscador: texto | color de la aplicación oscurecido | #616161 | #424242 | #ADADAD |

| Subrayado de la pestaña activa | Multicolor y Blanco | Gris oscuro | Negro |
|---|---|---|---|
| Word | #1651AA | #AEC6F0 | #82ABF1 |
| Excel | #0F703B | #A0D8B9 | #60BD82 |
| PowerPoint | #B13719 | #EDBCB0 | #E1966D |

| Botón «Compartir» | Multicolor y Blanco | Gris oscuro | Negro |
|---|---|---|---|
| Word | #185ABD | #82ABF1 | #598FEC |
| Excel | #107C41 | #60BD82 | #37A660 |
| PowerPoint | #C43E1C | #E1966D | #D67540 |

Buscador en Multicolor: Word #D0DCEE (texto #13458F), Excel #CFE2D8, PowerPoint #EFD7D1.

Tamaños a 100 %: barra de título 48 px, pestañas unos 31 px, cinta unos 100 px como tarjeta con esquinas redondeadas y
8 px de margen. La pestaña «Archivo» es texto normal, sin fondo de color. La pestaña activa no cambia de fondo: texto en
seminegrita y subrayado.

Los negros de Office coinciden con los colores neutros de Fluent (#292929, #141414, #383838, #ADADAD, #5C5C5C), igual que
los claros (#F5F5F5, #EBEBEB, #616161, #BDBDBD).

## Menús, cuadros, paneles y vista Archivo (tercera pasada, 2026-11-25, solo Word)

Capturas con la interacción hecha (`menu-N.png`, `aviso-guardar-N.png`, `panel-N.png`, `archivo-N.png`, mismos números de
la tabla de arriba). Son recortes sin datos personales: la ubicación del archivo está tapada y la lista de documentos
recientes queda fuera. De la vista Archivo en Gris oscuro hay valores pero no imagen.

«Utilizar la configuración del sistema» **con Windows en claro es idéntico a Blanco** (las zonas dan los mismos valores,
barra de título clara incluida).

| Zona | Multicolor | Blanco | Gris oscuro | Negro |
|---|---|---|---|---|
| Menú: fondo | #FFFFFF | #FFFFFF | #BDBDBD | #292929 |
| Menú y cinta: al pasar el ratón | #F5F5F5 | #F5F5F5 | #D1D1D1 | #3D3D3D |
| Menú contextual: borde / separador | #616161 / #D1D1D1 | #616161 / #D1D1D1 | #666666 / #858585 | #ADADAD / #666666 |
| Minibarra y menú contextual: fondo | #FFFFFF | #FFFFFF | #BDBDBD | #292929 |
| Selección de texto | #C7C7C7 | #C7C7C7 | #C7C7C7 | #545454 |
| Pestaña al pasar el ratón: solo subrayado | #D1D1D1 | #D1D1D1 | #6B6B6B | #666666 |
| Barra de título: ratón sobre un botón | #1651AA (Word) | #FDFDFD | #636363 a #666666 | ~#312D31 (Mica) |
| Aviso «¿Guardar los cambios?»: fondo | #FFFFFF | #FFFFFF | **#525252** | #292929 |
| Aviso: título / texto | #185ABD / #242424 | #185ABD / #242424 | #AEC6F0 / #FFFFFF | #82ABF1 / #FFFFFF |
| Aviso: botón principal | #1651AA, texto blanco | #1651AA, texto blanco | #AEC6F0, texto negro | #82ABF1, texto negro |
| Aviso: otros botones | #FFFFFF | #FFFFFF | #BDBDBD | #292929, borde #757575 |
| Aviso: cuadro desactivado / divisor | #F0F0F0 / #D1D1D1 | #F0F0F0 / #D1D1D1 | #858585 / #6B6B6B | #141414 / #666666 |
| Panel acoplado (Navegación): fondo | #F0F0F0 | #F0F0F0 | **#525252** | **#0A0A0A** |
| Panel: cuadro de búsqueda / subrayado | #FFFFFF / #1651AA | #FFFFFF / #1651AA | #D4D4D4 / #82ABF1 | #363636 / #598FEC |
| Archivo: contenido | #F5F5F5 | #F5F5F5 | **#525252** | #141414 |
| Archivo: barra lateral | ~#EEEAE7 (Mica) | ~#ECE7EC (Mica) | #343535 | ~#19131A (Mica) |
| Archivo: apartado elegido (barra de color a la izquierda) | #1651AA | #1651AA | #82ABF1 | #82ABF1 |
| Cuadro clásico «Fuente» | #F9F9F9 | #F9F9F9 | #F9F9F9 | #F9F9F9 (claro también) |

- En Gris oscuro solo la cinta y los menús son gris claro. Paneles, avisos y vista Archivo son oscuros.
- Botón Cerrar al pasar el ratón (medido en Gris oscuro): #E81123.
- En la vista Archivo, el apartado bajo el ratón lleva una barra gris a la izquierda (visto en Multicolor), sin cambiar de
  fondo.

## Otras aplicaciones (en Multicolor, 2026-11-25, leyendo solo píxeles, sin guardar imágenes)

| Aplicación | Color | Nota |
|---|---|---|
| OneNote | #7719AA | barra de título |
| Access | #A4373A | franja lateral de la pantalla de inicio (su barra de título es blanca) |
| Visio | #185ABD | con el aviso «Preview ha expirado»; igual que Word |
| Project | #107C41 | con el mismo aviso; igual que Excel |
| Outlook | sin medir | no quedó en primer plano porque mostró un cuadro propio |

## Otras observaciones

- Multicolor y Blanco se distinguen casi solo por la barra de título (en color o clara).
- En Negro, la cinta no es negra pura (#292929) y el lienzo es más oscuro que la cinta.
- «Utilizar la configuración del sistema» no es un tema propio: con Windows en oscuro se ve como Negro y con Windows en
  claro como Blanco.
- Sin medir: Outlook y las interacciones en Excel, PowerPoint y las demás aplicaciones.
