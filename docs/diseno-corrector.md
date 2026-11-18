# Diseño: Corrector ortográfico y gramatical (componente compartido `spell-core`)

## 1. Cómo es en Office
El corrector es un **componente compartido** de Office (herramientas de lenguaje / «Editor»), no uno por programa:
- **Motor y diccionarios compartidos:** Word, Excel, PowerPoint, Outlook y OneNote usan el mismo corrector; los diccionarios de cada idioma se instalan una vez.
- **Diccionario personal y lista de Autocorrección compartidos** (`CUSTOM.DIC`, `.acl`): lo que se agrega en Word vale en Outlook y PowerPoint.
- **Comportamiento por producto:** Word, PowerPoint, Outlook y OneNote subrayan mientras se escribe; Excel solo revisa a petición (F7). La gramática y el estilo van sobre todo en Word y Outlook. Cada producto tiene su casilla de opciones («Revisión»).
- **Idioma por texto:** cada párrafo o selección lleva su idioma y hay una marca «no revisar». Panel «Editor» con las sugerencias (ortografía, gramática, claridad) y menú contextual con correcciones, «Omitir», «Agregar al diccionario» y «Autocorrección».

## 2. Qué había en SuiteNova
| Producto | Estado antes de este trabajo |
|---|---|
| Writer | Revisión mientras se escribe (subrayado), menú contextual, cuadro F7, diccionario personal; **un solo idioma por documento**; español de España e inglés. |
| Slides y Notes | Cuadro F7 de ortografía, usando el motor de Writer (importaban `writer/spell`). |
| Calc, Mail, Plan, Forms, Base | Nada. |
| Gramática y estilo | Nada. |

## 3. Arquitectura
Igual que Ecuaciones: **un motor compartido y una interfaz compartida**.
- **`packages/spell-core`** (sin interfaz ni dependencias; `nspell` y los diccionarios solo para pruebas): `SpellEngine` (diccionario + palabras omitidas/agregadas, trabaja sobre texto plano), `findWords`/`skipWord` (siglas, direcciones, identificadores), registro de **idiomas** (`SPELL_LANGS`, `langForTag`), **diccionario personal** (`UserDictionary`, uno para todos los productos, idiomas y documentos). Más adelante: reglas de gramática y estilo, lista de Autocorrección.
- **`apps/suite/src/spell/`:** carga de diccionarios (archivos aparte, se piden al usarlos), adaptador de ProseMirror (`DocSpellEngine`: palabras mal escritas de un documento; complemento que subraya), y más adelante la interfaz compartida (panel «Editor», cuadro F7, menú contextual, opciones).
- Cada producto adapta el motor a su modelo (ProseMirror en Writer y Notes, diapositivas en Slides, celdas en Calc, campo de texto en Mail).

### Idiomas
| Id | Etiqueta | Diccionario |
|---|---|---|
| `es` | Español (España) | `dictionary-es` |
| `es-MX` | Español (México) | `dictionary-es-mx` |
| `es-PE` | Español (Perú) | `dictionary-es-pe` |
| `en` | English | `dictionary-en` |
`langForTag` lleva una etiqueta BCP 47 al diccionario más cercano (`es-AR` → `es`, `en-GB` → `en`), para leer el idioma que traen `.docx`, `.pptx` y HTML. Los diccionarios son de la familia Hunspell/LibreOffice (licencia GPL/LGPL/MPL, compatible con el MPL-2.0 del proyecto) y pesan unos 0,9 MB cada uno.

## 4. Plan por fases
1. **Motor compartido (hecha).** Paquete `spell-core`, idiomas es-ES, es-MX, es-PE y en, diccionario personal único, Writer, Slides y Notes migrados.
2. **Gramática y estilo (motor) (hecha).** Reglas sobre texto plano, con identificador, mensaje, sugerencia y posibilidad de desactivarlas: mayúscula inicial tras punto, palabras repetidas, dobles espacios, espacio antes de la puntuación y falta después, signos de apertura (¿ ¡), paréntesis y comillas sin pareja, concordancia básica (artículo–sustantivo y sustantivo–adjetivo en género y número, a partir de las marcas del diccionario), algunos errores frecuentes (`a nivel de`, `haber`/`a ver`, `sino`/`si no`) y de estilo (mayúsculas sostenidas, frases muy largas).
3. **Interfaz compartida (hecha).** Panel «Editor» (ortografía y gramática con sus sugerencias), cuadro F7 único, menú contextual (sugerencias, omitir, agregar, no revisar), opciones de revisión («ignorar MAYÚSCULAS», «ignorar direcciones», reglas de gramática que se activan), administración del diccionario personal.
4. **Writer, Slides y Notes (hecha).** Idioma **por texto** (marca de idioma en el texto; `w:lang` en `.docx`, `lang` en `.pptx`), subrayado de ortografía (rojo) y de gramática y estilo (azul), panel «Editor».
5. **Calc, Mail y otros.** Calc: F7 sobre celdas, como Excel (a petición). Mail: subrayado en el cuerpo del mensaje. Plan, Forms y Base: campos de texto largos. **Autocorrección compartida** (la lista de reemplazos que hoy es de Writer).
6. **Cierre.** Documentación, límites, regresión y comparación con Word real (`SpellingErrors`, `GrammarErrors` por COM) para contrastar el criterio.

## 5. Decisiones
- **Un solo diccionario personal** para toda la suite (la clave de almacenamiento no cambia, así no se pierde lo guardado).
- **Ortografía: nspell + diccionarios Hunspell** (sin dependencias nuevas de motor); **gramática: reglas propias**, explicables y desactivables, no un modelo de lenguaje. No será tan completa como el Editor de Microsoft 365 (que usa servicios en la nube); se documentan sus límites.
- **Idioma por texto**, no por documento (como Office).

## 6. Bitácora
### Fase 1 (hecha, 2026-11-17): motor compartido
- **Paquete `packages/spell-core`:** `words.ts` (`findWords`, `skipWord`), `engine.ts` (`SpellEngine`: `isCorrect`, `suggest`, `ignore`, `add`, `check(texto)`), `languages.ts` (`SPELL_LANGS`, `isSpellLang`, `langForTag`, `spellLangTag`), `userdict.ts` (`UserDictionary` sobre cualquier almacén clave-valor, con la clave de siempre `nova.writer.userDictionary`). 12 pruebas con los diccionarios reales (`dicts.ts` solo para pruebas en Node).
- **Idiomas nuevos:** `dictionary-es-mx` y `dictionary-es-pe` (2.0.0). El de España rechaza `chévere` y `cholo` y los dos latinoamericanos los aceptan; los tres aceptan `casa`, `canción` y sugieren `canción` para `cancion`.
- **App (`apps/suite/src/spell/`):** `engine.ts` (adaptador de ProseMirror: `DocSpellEngine.inBlock/inDoc`), `pm.ts` (complemento que subraya, `setSpell`, `misspellings`), `load.ts` (carga perezosa de los 4 diccionarios, diccionario personal), `index.ts`. Se eliminaron `writer/spell.ts` y `writer/spell-core.ts`; Writer, Slides y Notes importan de `../spell`. La cinta «Revisar › Ortografía» de Writer ofrece los 4 idiomas; los cuadros F7 de Slides y Notes también.
- **Pruebas:** `spell-core` 12; aplicación 362 (3 pruebas de palabras pasaron al paquete); e2e de Writer (7, con una nueva de es-MX y es-PE), Slides (25), Notes (23 y 31).
- **Límites:** los diccionarios latinoamericanos son los de la familia RLA-ES: son completos pero comparten gran parte del léxico con el de España y no cubren todo el léxico regional (por ejemplo `ceviche`, `chompa` o `aguachile` figuran como erróneas en los tres). El idioma sigue siendo uno solo por documento (fase 4).

### Fase 2 (hecha, 2026-11-17): gramática y estilo (motor)
- **Dónde:** `packages/spell-core/src/grammar/` (`types.ts`, `rules-common.ts`, `rules-es.ts`, `rules-en.ts`, `lexicon-es.ts`, `index.ts`). Sin diccionario ni interfaz; trabaja sobre texto plano, así que sirve igual a Writer, Slides, Notes, Calc y Mail.
- **API:** `checkGrammar(texto, { lang, disabled?, enabled?, startOfText?, longSentenceWords? })` devuelve `GrammarIssue[]` ordenados: `rule`, `category` (`grammar`, `punctuation`, `style`), `start`/`end` (lo subrayado), `message` y `fixes` (cada una con su propio tramo y texto: puede sustituir, quitar o insertar). `GRAMMAR_RULES` es el catálogo (etiqueta, descripción, idioma, si está activa por omisión) para las opciones; `defaultRules(lang)` da las activas. Las reglas de `es`, `es-MX` y `es-PE` son las mismas.
- **Reglas (20):**
  - *Todos los idiomas:* palabras repetidas (con excepciones como «ja ja», «muy muy», «that that»), mayúscula inicial (comienzo del texto y tras `.`, `?`, `!`, con abreviaturas, iniciales, números, puntos suspensivos, marcas como «a)», direcciones y nombres como «iPhone» exceptuados), espacios dobles, espacio antes de la puntuación, espacio junto a paréntesis y signos de apertura, falta de espacio tras `, ; : ? !` y tras un punto entre palabras, signos sin pareja (`( ) [ ] « » “ ”`, y en español `¿ ?` y `¡ !`, con la corrección de poner el signo que falta), frases muy largas y mayúsculas sostenidas (opcionales).
  - *Español:* concordancia de género y número (determinante + sustantivo, sustantivo + adjetivo; el agua / la agua con «a» tónica), dequeísmo, queísmo, «haber» impersonal («habían muchos»), «a ver» / «haber», «ha hecho» / «ha echo», y de estilo «a nivel de», «en base a», «de acuerdo a».
  - *Inglés:* «a» / «an» y el pronombre «I».
- **Precisión antes que alcance:** la concordancia solo se comprueba con palabras de género seguro (unos 200 sustantivos frecuentes, terminaciones como -ción, -dad, -miento, -aje, y 30 adjetivos de cuatro formas); lo que no está en el léxico no se toca. Los sustantivos que también son formas de verbo («los casa», «la cuenta») no se marcan con «la/las/los». Las direcciones, rutas, parámetros y código (`a=b`, `x/y`, `Sistema.Texto.Json`) quedan fuera de las reglas de puntuación.
- **Pruebas:** 29 nuevas (41 en `spell-core`): cada regla con su caso positivo, su corrección, y los casos que no deben marcarse (abreviaturas, decimales, horas, direcciones, caritas `:)`, listas `a)`, verbos que parecen sustantivos, repeticiones válidas); rendimiento (un texto de ~180 000 caracteres en unos 70 ms).
- **Límites:** no hay concordancia sujeto–verbo, tiempos verbales, laísmo/leísmo, ni «sino/si no», «porque/porqué», «tan bien/también»; no entiende el contexto, solo patrones, así que puede dejar pasar errores (falso negativo) y, en frases poco corrientes, marcar de más; la lista de abreviaturas y de excepciones es finita; el inglés solo tiene dos reglas propias.
- **Pendiente de esta fase:** la comparación con Word real (`GrammarErrors`, `SpellingErrors` por COM). El primer intento dejó una instancia de Word sin ventana detenida en un cuadro de diálogo (`CheckGrammar` abre uno) y no se pudo cerrar desde aquí; se rehará, sin `CheckGrammar`, en la fase de cierre.

### Fase 3 (hecha, 2026-11-18): interfaz compartida
- **Opciones de revisión únicas** (`spell-core/src/options.ts`): `ReviewOptions` (omitir MAYÚSCULAS, omitir palabras con números, omitir direcciones y rutas, revisar gramática, reglas activadas o desactivadas a mano, límite de «frase muy larga»), guardadas en `nova.review.options` y leídas con valores por omisión si falta o es inválido lo guardado. `skipWordWith` aplica las tres casillas por separado; `grammarOptionsOf` las traduce a las de `checkGrammar`.
- **Revisión unificada** (`apps/suite/src/spell/review.ts`): `reviewDoc(doc, {engine, lang, options})` junta ortografía y gramática en una lista de `Issue` (`kind`: ortografía, gramática, puntuación o estilo; posiciones del documento; correcciones). Se calcula por bloque y se guarda en el propio bloque de ProseMirror: al escribir solo se vuelve a revisar el párrafo que cambió. Los enlaces, el código y los tramos que atraviesan un objeto (imagen, salto) no se corrigen. «Omitir una vez» se identifica por regla, texto y contexto, no por posición, así que sobrevive a lo que se escribe después.
- **Subrayado:** ortografía en rojo ondulado, gramática y puntuación en azul doble, estilo en verde discontinuo (`nw-misspelled`, `nw-grammar`, `nw-style`). Sin el diccionario cargado no se subraya nada.
- **Componentes compartidos** (`spell/ui.tsx`, sobre un `ReviewHost` que cada producto rellena con su idioma y sus vistas): menú contextual (mensaje, correcciones, omitir, agregar, «no volver a marcar esta regla»), cuadro **F7 único** (recorre ortografía y gramática; cambiar, cambiar todas, omitir una vez/todo, agregar), panel **«Editor»** (pestañas Ortografía, Gramática y puntuación, Estilo, con corrección a un clic), **opciones de revisión** y **diccionario personal** (se agregan palabras a mano y se quitan; ambos cambios valen en el acto en todos los diccionarios cargados).
- **Productos:** Writer (menú contextual, F7, panel «Editor», opciones y diccionario en Revisar › Ortografía y gramática; el idioma `es-MX`/`es-PE` ya no se pierde al recargar) y Notes (mismo cuadro F7 sobre los cuadros de texto de la página). Slides conserva su cuadro de ortografía pero respeta las opciones de omisión. Se eliminaron `writer/SpellUI.tsx` y el cuadro propio de Notes.
- **Pruebas:** `spell-core` 46 (+5 de opciones); aplicación 372 (+10 de revisión: posiciones, formatos, enlaces, objetos, opciones, omitir una vez, palabra agregada, rendimiento); e2e de Writer 16 (+9: subrayados por categoría, menú de gramática, omitir una vez, F7 con gramática, panel «Editor», opciones, gramática apagada, diccionario a mano, idioma tras recargar), Notes 23 y 31, Slides 25, autocorrección de Writer.
- **Límites:** la gramática solo se ve en Writer; Notes tiene el cuadro F7 pero no subrayado en el texto, y Slides no tiene gramática (fase 4). El panel «Editor» se refresca cada 1,5 s, no al instante. El idioma sigue siendo uno por documento hasta la fase 4. No hay puntuación de claridad ni de «corrección» como en el Editor de Microsoft 365.


### Fase 4 (hecha, 2026-11-18): idioma por texto y subrayado en Writer, Slides y Notes
- **Idioma por texto.** Cada tramo se revisa con el diccionario y las reglas de su propio idioma (`reviewDoc` parte el párrafo en tramos del mismo idioma; la gramática de cada tramo usa las reglas de su idioma). El idioma del documento (el que se elige en «Ortografía y gramática») vale para el texto que no dice otro. Una etiqueta sin diccionario (`fr-FR`) hace que ese tramo no se revise. Si el diccionario de un tramo aún no está cargado, se pide y se vuelve a subrayar al llegar; mientras tanto ese tramo no se marca.
- **Formato de archivo.** Writer: marca `lang` (ya existía, `w:lang`) y nueva `noproof` (`w:noProof`, colocada en su orden del esquema de `w:rPr`); el lector y el escritor de .docx las conservan. Slides: `RunProps.lang` ya existía y se añade `noProof` (atributos `lang` y `noProof` de `a:rPr`). Notes comparte el esquema de Writer.
- **Comandos.** Writer: «Idioma del texto» (en Revisar), con el idioma de la selección, «el del documento» y «No revisar la ortografía ni la gramática»; Notes: «Idioma y opciones»; Slides: «Idioma» (idioma de la presentación y de la selección, y «No revisar»). Sin selección, valen para lo que se escriba a continuación.
- **Subrayado.** Notes: ortografía, gramática y estilo en los cuadros de texto, con menú contextual y panel «Editor» (F7 ya compartido). Slides: ortografía subrayada en el editor de texto de una forma, con menú contextual. Se apagó el corrector nativo del navegador (`spellcheck="false"`) en Writer, Notes y Slides para que no se superponga al propio.
- **Slides, F7:** el cuadro propio de Slides respeta ahora el idioma de cada tramo y «No revisar»; solo revisa ortografía.
- **Pruebas:** `writer-core` 172 (+1: `w:lang` y `w:noProof` en su orden), `slides-core` 108 (+1: `lang` y `noProof`), aplicación 377 (+5: idioma por texto, francés sin revisar, «no revisar», gramática por idioma, diccionario ausente); e2e Writer 19 (+3), Notes 34 (+3), Slides 26 (+1).
- **Límites:** (1) El idioma por omisión de un .docx (el de `w:docDefaults` y de los estilos) no se lee: el idioma del documento lo elige la persona; solo se leen los idiomas de cada tramo. (2) Slides no tiene gramática ni panel «Editor», y su subrayado solo existe mientras se edita el texto de una forma (no en tablas, notas ni la vista de esquema). (3) La detección automática de idioma no existe: el idioma lo pone la persona. (4) No se ha comprobado con Word ni PowerPoint reales que el idioma y «no revisar» guardados se vean igual allí (fase 6). (5) En Writer solo se revisa el cuerpo (no encabezados, pies ni notas).
