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
3. **Interfaz compartida.** Panel «Editor» (ortografía y gramática con sus sugerencias), cuadro F7 único, menú contextual (sugerencias, omitir, agregar, no revisar), opciones de revisión («ignorar MAYÚSCULAS», «ignorar direcciones», reglas de gramática que se activan), administración del diccionario personal.
4. **Writer, Slides y Notes.** Idioma **por texto** (marca de idioma en el texto; `w:lang` en `.docx`, `lang` en `.pptx`), subrayado de ortografía (rojo) y de gramática y estilo (azul), panel «Editor».
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
