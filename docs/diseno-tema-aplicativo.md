# Tema general del aplicativo (como los temas de Office)

Objetivo (2026-11-25): que la interfaz de SuiteNova ofrezca los temas de aplicación de Office (**Multicolor, Gris oscuro,
Negro, Blanco y Utilizar la configuración del sistema**) y se vea como Office en cada uno. Es el tema de la **interfaz**,
no el tema del documento (`docs/diseno-temas.md`).

Decisiones del usuario (2026-11-25):
- Referencia: **Office real medido** (`docs/office-temas/MEDIDAS.md`).
- **Una sola barra de título**, como Office: se quita la nativa de Windows y la nuestra lleva minimizar, maximizar y cerrar.
- **Documentos como Office:** Writer oscurece la página en Negro (con un botón en Vista para volver a página blanca); Calc y
  Slides se quedan blancos (Calc deja de oscurecer su cuadrícula). Imprimir y exportar no cambian.
- **Contraste alto automático:** la lista queda con los cinco temas; si Windows tiene contraste alto activo, se aplica solo.

Decisiones del usuario (2026-11-26):
- **Diagram y Plan conservan su color propio** (Visio y Project mostraron el azul de Word y el verde de Excel).
- **Tema por defecto:** «Utilizar la configuración del sistema».

## 1. Cómo es en Office (medido en Office 2024 LTSC, Windows 11)

| Zona | Multicolor | Blanco | Gris oscuro | Negro |
|---|---|---|---|---|
| Barra de título | color de la aplicación, texto blanco | clara, texto oscuro | gris #525252, texto blanco | #1A1A1A, texto blanco |
| Pestañas | claras | claras | gris #525252 | #1A1A1A |
| Cinta | blanca | blanca | **gris claro #BDBDBD, texto oscuro** | #292929, texto blanco |
| Lienzo | #ECECEC | #ECECEC | #555555 | #1C1C1C |
| Página de Word | blanca | blanca | blanca | **#262626** |
| Cuadrícula de Excel y diapositiva | blancas | blancas | blancas | blancas |
| Barra de estado | #F5F5F5 | #F5F5F5 | #525252 | #141414 |

- «Utilizar la configuración del sistema» no es un quinto aspecto: con Windows en oscuro se ve igual que Negro y con
  Windows en claro, igual que Blanco.
- Multicolor y Blanco se distinguen casi solo por la barra de título.
- Colores de aplicación medidos: Word `#185ABD`, Excel `#107C41`, PowerPoint `#C43E1C`.
- La barra de título, las pestañas y el lienzo usan el efecto Mica de Windows 11 (se tiñen con el fondo de pantalla): esos
  valores son aproximados (± unos 8 niveles).
- Menús, avisos, paneles, vista Archivo y estados están medidos en Word (`MEDIDAS.md`). En Gris oscuro solo la cinta y los
  menús son claros: paneles, avisos y vista Archivo son oscuros (#525252). Los paneles en Negro son casi negros (#0A0A0A).
- **Sin medir:** Outlook y las interacciones fuera de Word.

## 2. Qué hay hoy
- `packages/core-ui`: `theme.ts` (`system`, `light`, `dark`, `contrast`; `fluentTheme(mode, accent)`), `core-commands.ts`
  (`theme.*`, ajuste `theme`), `AppFrame.tsx` (un solo `FluentProvider` para toda la ventana) y `core-ui.css`.
- La barra de título propia (`.nv-titlebar`) es siempre del color del módulo, en todos los temas.
- Encima de ella está la barra nativa de Windows (solo la superposición de recorte va sin ella).
- Menú del tema en `apps/suite/src/common.ts` y página de Opciones en `options.tsx`.
- 22 hojas de estilo usan los colores de Fluent, pero hay unas 580 líneas con colores fijos (parte es contenido de
  documento y debe quedarse; parte es interfaz y no cambia con el tema).
- **Fallos ya presentes:** la barra de seguridad de Calc (`calc-objects.css`) y los gráficos de Plan (`plan/Chart.tsx`)
  siguen el modo de Windows en vez del tema elegido.

## 3. Cómo se construye
- **Todo en `core-ui`**, para que los nueve productos y el inicio lo reciban sin tocar cada uno.
- **Preferencia:** `system | colorful | darkgray | black | white`. **Tema resuelto:** `colorful | darkgray | black | white |
  contrast`. «Sistema» da Blanco o Negro según Windows (medido) y el contraste alto de Windows gana a cualquier
  preferencia.
- **Migración del ajuste guardado:** `light` → `colorful` (es lo que se veía), `dark` → `black`, `contrast` y `system` →
  `system`. Un valor desconocido da `system`.
- **Colores por zona** (barra de título, pestañas, cinta, lienzo, estado, panel, texto de cada una) en una sola tabla en
  TypeScript, publicados como variables CSS propias (`--nv-…`) junto con los colores de Fluent, de modo que también lleguen
  a menús y cuadros, que Fluent monta fuera del marco. Se comprueba en la fase 1.
- **Gris oscuro es mixto:** marco oscuro y cinta clara. Cada zona lleva sus propios colores de texto, iconos y estados; no
  basta con un tema claro o uno oscuro de Fluent para toda la ventana.

## 4. Plan en 6 fases
1. **Modelo y colores.** Medir en Office lo que falta (menús, diálogos, paneles, Archivo, estados, «Sistema» en claro y las
   aplicaciones instaladas; **necesita que cambies el tema de Office a mano otra vez**). Los cinco temas, la migración, la
   tabla de colores por zona, los colores de aplicación de Office, menú y Opciones. Pruebas.
2. **Marco.** Pestañas, cinta (también plegada y contextual), barra de acceso rápido, buscador, barra de estado y lienzo en
   los cuatro aspectos, con contraste de texto comprobado por prueba. e2e nueva.
3. **Barra de título única.** Ventanas sin decoración nativa; botones de minimizar, maximizar/restaurar y cerrar; arrastrar
   y doble clic; permisos de Tauri; cerrar sigue preguntando por los cambios sin guardar; las ventanas sin marco propio
   (vista de moderador) conservan la nativa; sin destello blanco al abrir en un tema oscuro. Prueba en la aplicación
   compilada, no solo en el navegador.
4. **Superficies comunes.** Vista Archivo, cuadros, menús, paneles, galerías y las hojas de estilo compartidas (comentarios,
   buscar, ortografía, tablas, imágenes, ecuaciones, voz, macros, WordArt, gráficos, inicio); selector de tema también en
   Archivo › Cuenta como en Office; arreglar los dos fallos que siguen a Windows.
5. **Áreas de trabajo por producto.** Writer: página oscura en Negro, botón «Cambiar modos» en Vista (nombre y colores del
   texto a comprobar en Word), sin afectar al archivo, a la impresión ni a la exportación. Calc: cuadrícula blanca siempre,
   barra de fórmulas y encabezados según el tema. Slides: diapositiva blanca. Notes, Mail, Diagram, Plan, Forms y Base:
   revisar sus colores fijos.
6. **Cierre.** Capturas lado a lado con Office en los cuatro aspectos, contraste (WCAG) y contraste alto de Windows, tiempo
   al cambiar de tema, varias ventanas a la vez, límites y documentación.

## 5. Límites previstos
- Sin el efecto Mica: colores sólidos (los medidos).
- Al quitar la barra nativa se pierde el menú de diseños de Windows 11 al pasar el ratón por maximizar (los atajos
  Windows + flechas y arrastrar a los bordes siguen).
- El tema de SuiteNova no se sincroniza con el de Office instalado ni con una cuenta.
- Colores de Diagram, Plan, Forms y Base: Office no tiene equivalente medido para todos; usan las mismas zonas.
- Las páginas HTML que exporta Forms siguen el modo del navegador de quien las abre (no son interfaz de SuiteNova).

## 6. Bitácora

### Medición previa (2026-11-25)
Capturas de Word, Excel y PowerPoint en los cinco temas y valores en `docs/office-temas/`. Forzar el tema por el registro no
funciona (Office lo reescribe), así que se cambió a mano. El tema de Office quedó como estaba (Gris oscuro).

### Fase 1 (hecha, 2026-11-25): modelo y colores
- **Modelo (`core-ui/theme.ts`):** `THEME_PREFERENCES` en el orden de Office, `normalizeThemePreference` (los valores
  antiguos `light`/`dark`/`contrast` se convierten al leerlos, sin reescribir lo guardado), `resolveTheme` (el contraste
  alto de Windows gana) y `zoneColors(app, tema)` con las variables `--nv-*` de cada zona.
- **Comprobado:** las variables van dentro del objeto tema de Fluent y llegan a los menús, montados fuera del marco. Antes
  `--nv-accent` era un estilo en línea y no llegaba (por eso había valores de reserva en las hojas de estilo).
- **Negro** es el tema oscuro de Fluent: sus neutros coinciden con los medidos. **Gris oscuro** parte del claro con
  neutros propios, ya medidos para cinta y menús (fondo, paso del ratón, texto, separadores y botón pulsado). Sus paneles,
  avisos y vista Archivo son oscuros en Office y **todavía no en SuiteNova** (fase 4).
- **Colores de aplicación:** Writer, Calc, Slides, Notes y Base usan los de Word, Excel, PowerPoint, OneNote y Access.
  Forms se oscureció un poco (`#6b7a1b`) para que el texto blanco de su barra de título se lea. Diagram y Plan conservan
  el suyo (Visio y Project mostraron el azul de Word y el verde de Excel) y Mail también (Outlook sin medir).
- **Interfaz:** menú Vista › Tema y Archivo › Opciones con los cinco temas; Opciones avisa si Windows impone el contraste
  alto. Slides no tenía el menú de temas en Vista y ahora sí. Las zonas del marco ya usan sus colores (formas y estados,
  en la fase 2).
- **Pruebas:** 7 nuevas en core-ui (31 en total), `e2e-app-theme.mjs` 18/18 y 19 e2e de productos sin fallos.
- **Calc** sigue oscureciendo la cuadrícula en Negro hasta la fase 5.
- **Segunda medición (2026-11-25):** Word en los cuatro temas y en «Sistema» con Windows en claro, que resultó igual a
  Blanco y no a Multicolor (corregido). Ratón y teclado automatizados; el tema lo cambió el usuario a mano. Office quedó en
  Gris oscuro y Windows en oscuro, como estaban.
- **Para las fases 2 y 4:** pestaña al pasar el ratón solo con subrayado gris; botones de la barra de título; paneles, avisos
  y vista Archivo oscuros en Gris oscuro; paneles casi negros en Negro.
