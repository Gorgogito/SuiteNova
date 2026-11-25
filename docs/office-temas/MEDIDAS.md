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

## Otras observaciones

- Multicolor y Blanco se distinguen casi solo por la barra de título (en color o clara).
- En Negro, la cinta no es negra pura (#292929) y el lienzo es más oscuro que la cinta.
- «Utilizar la configuración del sistema» no es un tema propio: elige Multicolor/Blanco o Negro según el modo de Windows
  (aquí, oscuro → Negro). No se midió con Windows en modo claro.
- Pendiente de medir si hace falta: color de selección, de pasar el ratón, de la pestaña activa y de los botones. Hay que
  capturarlos con la interacción hecha.
