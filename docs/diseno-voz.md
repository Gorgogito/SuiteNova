# Voz (Leer en voz alta, producto auxiliar compartido): diseño

## 1. Cómo es en Office
- **No es una sola función, pero sí un solo servicio.** **Word, Outlook y OneNote** comparten el lector: «Leer en voz alta» (Revisar o Vista; en Outlook, en la cinta del mensaje abierto) con la misma barra (anterior, pausa/reproducir, siguiente, velocidad, voz), con la palabra o la frase que suena resaltada. Cada producto solo decide de dónde saca el texto (el documento desde el cursor, el mensaje abierto, la página). Usa las voces del sistema y, con conexión, voces neuronales de Microsoft.
- **Excel** tiene otra función aparte, **«Hablar celdas»** (lee las celdas en el orden que se elige, por filas o columnas, con opción de leer al pulsar Intro), sin resaltado de palabra.
- **PowerPoint** de escritorio no tiene «Leer en voz alta» (tiene grabar narración, que Nova Slides ya tiene); **Visio** no tiene nada.
- Windows tiene además su propio **Narrador**, que es del sistema y no de Office.

## 2. Decisiones (del usuario, 2026-11-21)
- **Alcance «como Office más Slides»:** Writer, Notes y Mail con lector y resaltado de palabra; Calc con «Hablar celdas»; Slides lee diapositivas y notas. Sin Diagram, Plan, Forms ni Base.
- **Solo voces del sistema** (las que tenga Windows instaladas, sin Internet, sin dependencias nuevas). Nada sale del equipo.
- **Núcleo compartido `speech-core` + interfaz común**, como el OCR; **Notes ya tiene «Leer en voz alta» dentro de su «Lector inmersivo»** (`notes/dlg3.tsx`, con la API del navegador directa): migra al núcleo compartido.

## 3. Estado de partida
- Solo el cuadro «Lector inmersivo» de Notes llama a `speechSynthesis`: lee toda la página de una vez (sin pausa por frase, sin anterior/siguiente, sin elegir idioma por tramo, velocidad 0,5–2 a pasos de 0,25).
- En esta máquina el motor ofrece 3 voces en español (Helena, Laura y Pablo, es-ES, locales) y 3 en inglés; **sin es-MX ni es-PE** (se usa la voz de España para esos textos; se avisa).
- El motor del navegador de la aplicación de escritorio es WebView2 (el mismo Edge): las voces y los eventos de palabra son los de aquí.

## 4. Plan por fases
1. **Núcleo `speech-core` y adaptador:** frases (con abreviaturas, decimales, signos de apertura, saltos de línea, cortar las muy largas), lo que se dice (direcciones, marcas que solo dibujan) con mapa de vuelta al texto escrito, elección de voz por idioma, lector con reproducir, pausa, continuar, detener, siguiente, anterior, velocidad y voz, y adaptador del motor del navegador en `apps/suite/src/voice/`.
2. **Interfaz compartida y Writer como producto de referencia:** barra de reproducción común, ajustes (voz por idioma y velocidad, guardados), «Leer en voz alta» desde el cursor o la selección con la palabra resaltada, y atajo.
3. **Notes y Mail:** Notes migra su lector al núcleo (la página, desde un cuadro o desde la selección); Mail lee el mensaje abierto (y, si se pide, la lista de mensajes por asunto y remitente).
4. **Slides y Calc:** Slides lee la diapositiva (título, texto, notas) o las notas y avanza de diapositiva; Calc «Hablar celdas» (por filas o por columnas, la selección, leer al pulsar Intro).
5. **Calidad:** idioma por tramo (es-ES, es-MX, es-PE, en), pronunciación (siglas, números, símbolos, abreviaturas, monedas), aviso cuando falta la voz de un idioma y cómo instalarla, comportamiento al cambiar de página o de documento mientras suena.
6. **Cierre:** probar con documentos reales, límites, documentación y comparación con Word (comprobar con COM hasta donde se pueda: su «Speak» y la segmentación en frases; el lector moderno de Word no se puede automatizar).

Cada fase se hace producto por producto y se prueba antes de pasar a la siguiente.

## 5. Bitácora
### Fase 1 (hecha, 2026-11-21): núcleo `speech-core` y adaptador
- **Paquete `packages/speech-core`** (sin DOM; 19 pruebas con un motor falso). El motor es una interfaz (`Synth`: voces, hablar un texto con opciones y eventos de palabra/fin/error, cancelar); el del navegador está en `apps/suite/src/voice/webSpeech.ts`.
- **Frases (`sentences.ts`):** cortar donde acaba una frase (también en cada salto de línea), sin cortar en abreviaturas y títulos («Sr.», «Dr.», «Mr.», «etc.» seguida de minúscula…), iniciales («J. Pérez»), decimales («3.5»), ni elementos numerados («1. Primero»); un punto tras «p.m.» o «etc.» con mayúscula detrás sí termina; los puntos suspensivos con minúscula detrás siguen. Una frase de más de 220 caracteres se corta donde habría una pausa (coma, punto y coma, dos puntos) y, si no hay, en un espacio. Los desplazamientos son sobre el texto dado.
- **Lo que se dice (`prepare.ts`):** las direcciones web y de correo se dicen como una palabra («vínculo», «link», «dirección de correo»), las marcas que solo dibujan (viñetas, caracteres de ancho cero) no se leen, y una fila de guiones o puntos tampoco. Un **mapa** lleva cada carácter dicho a su sitio del texto escrito (con el final de lo que representa: la dirección entera para «vínculo»), para marcar la palabra donde está escrita.
- **Voces (`voices.ts`):** `pickVoice`: la que la persona eligió para ese idioma si sigue valiendo, si no la que más se ajusta (el mismo idioma y región, luego otra región del mismo idioma, y una local antes que una en línea).
- **Lector (`reader.ts`):** `load(bloques)` (un bloque es un párrafo, una celda, una nota…, con su idioma y una referencia del producto), `play`, `pause`, `resume`, `stop`, `next`, `previous`, `setRate`, `setVoice`, `indexAt` (la pieza de un sitio), y un estado que el producto puede mostrar (pieza, palabra en el texto escrito, velocidad, error, si falta voz). **La pausa cancela y continúa desde la palabra** (la pausa propia de los motores falla en varios) y por eso **cambiar la velocidad se oye al momento, desde la palabra que suena**. Los eventos tardíos del motor tras cancelar se ignoran.
- **Con las voces reales de Windows (`scripts/e2e-voice-core.mjs`, 8/8):** lee de principio a fin y termina sola; marca las palabras (primera, segunda, párrafo…) en su sitio del texto escrito; pausa y sigue desde la palabra; velocidad, siguiente y anterior; detener corta lo que suena; un texto en inglés usa una voz en inglés.
- **Límites:** solo voces del sistema; sin es-MX/es-PE aquí (se usa la voz de España); el motor no da eventos de palabra con todas las voces posibles (el lector sigue sin resaltar si no llegan); aún no hay interfaz ni lo usa ningún producto (Notes migra en la fase 3).

### Fase 2 (hecha, 2026-11-21): interfaz compartida y Writer
- **Compartido (`apps/suite/src/voice/`):** `VoiceController` (el lector de un producto con los ajustes de la persona, **comunes a todos los productos**: velocidad y voz por idioma, guardadas en `nova.voice`), `ReadAloudBar` (la barra de Office: frase anterior, reproducir o pausa, frase siguiente, detener, velocidad 0,5×–2,5×, voz por idioma con «Automática», dónde va, aviso si falta la voz del idioma o no hay síntesis, cerrar) y los textos en inglés.
- **Writer (`writer/read-aloud.ts`, `commands-voice.ts`):** «Leer en voz alta» (Revisar › Voz, **Ctrl+Alt+Espacio**, que también pausa y continúa): lee **desde el cursor**, o **solo lo seleccionado**; cada párrafo (títulos, elementos de lista y celdas incluidos) se da al lector con la posición de cada carácter en el documento; **la frase que suena se tiñe y la palabra se marca** donde está escrita (complemento `readPlugin`, que sigue a los cambios) y se mantiene a la vista; el texto de un cambio controlado como borrado no se lee; **si el texto cambia mientras se lee, la lectura se detiene sola** (con una selección, cualquier cambio); un documento sin texto muestra «Nada que leer».
- **Fallo corregido en la prueba real:** el navegador entrega la lista de voces vacía la primera vez, y la barra avisaba «no hay una voz instalada» aunque las había: una lista vacía ya no cuenta como «sin voz» y se pide al crear el controlador.
- **Pruebas:** `speech-core` 20; e2e nueva `e2e-writer-voice` (7) con las voces reales: Ctrl+Alt+Espacio lee desde el cursor, la frase y la palabra se marcan en su sitio, pausa y continuar, velocidad y voz guardadas, siguiente y cerrar quitan las marcas, solo la selección, parar al cambiar el texto, documento sin texto; `e2e-voice-core` 8/8, `e2e-writer`, `-review`, `-comments` y `-security` sin fallos.
- **Límites:** el idioma de todo el documento es el de la revisión (el idioma por tramo, fase 5); no lee encabezados, pies, notas al pie ni cuadros de texto aparte, solo el cuerpo; el grupo «Voz» va al final de Revisar y en ventanas estrechas se pliega (el atajo y la barra siguen).

## 6. Estado
Fases 1 y 2 hechas.
