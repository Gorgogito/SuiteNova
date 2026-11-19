# Diseño: Autocorrección (componente compartido en `spell-core`)

## 1. Cómo es en Office
Es un componente **compartido** de Office, con matices:
- **La lista de reemplazos y las excepciones son compartidas** entre Word, Excel, PowerPoint, Outlook y OneNote (archivos `.acl` de usuario, uno por idioma).
- **El cuadro es el mismo**, pero cada programa enseña las pestañas que le aplican: Autocorrección (reemplazar texto mientras escribe, con «Excepciones…»), Autocorrección matemática (su propia lista, para las ecuaciones), Autoformato mientras escribe (listas, vínculos, rayas, ordinales, `*negrita*`, bordes) y Acciones (solo Word y Outlook).
- **Las casillas son por programa.**
- **Excepciones («Excepciones de Autocorrección»):** primeras letras (abreviaturas tras las que no se pone mayúscula), DOs MAyúsculas permitidas y otras correcciones (palabras que no se corrigen nunca).
- **La lista es por idioma**; lo que se escribe con mayúscula inicial o todo en mayúsculas da el reemplazo con la misma mayúscula.

## 2. Qué había en SuiteNova
Desde la fase 5 del corrector: lógica común en `spell-core` (comillas, símbolos, fracciones, rayas, mayúscula inicial, dos mayúsculas, reemplazos propios), **una sola lista** de reemplazos (`nova.writer.autocorrect`) y un solo cuadro; aplicada en Writer, Notes, Mail, Calc, Forms, Plan y Base. Sin: excepciones editables (las abreviaturas estaban fijas en el código), lista por idioma, ordinales, `*negrita*`, líneas de borde, Slides, autocorrección matemática, importar y exportar.

## 3. Decisiones (del usuario)
- **Lista de reemplazos y excepciones por idioma** (español e inglés), como Office. La lista anterior pasa a ser la del español. es, es-MX y es-PE comparten la del español.
- **La autocorrección matemática entra** como lista editable (pestaña del cuadro) y se conecta con Ecuaciones.

## 4. Plan por fases
1. **Motor (hecha).** Lista y excepciones por idioma, reemplazos de fábrica, mayúscula de lo escrito, ordinales, detección de `*negrita*`/`_cursiva_`, líneas de borde y migración de lo guardado.
2. **Cuadro único:** pestañas Autocorrección (con «Excepciones…»), Autoformato, Matemática; importar y exportar (formato propio de texto/CSV; el `.acl` de Office es binario y propietario); idioma de la lista.
3. **Writer, Notes y Slides:** Slides recibe autocorrección; los tres reciben `*negrita*`, `_cursiva_`, ordinales con superíndice y líneas de borde; idioma por texto.
4. **Calc, Mail, Plan, Forms y Base:** excepciones y lista por idioma del campo; opciones por producto.
5. **Cierre:** documentación, límites y comparación con Word real por COM (`AutoCorrect.Entries` y escribiendo con `TypeText`).

## 5. Bitácora
### Fase 1 (hecha, 2026-11-18): motor
- **Dónde:** `packages/spell-core/src/autocorrect.ts` y `autocorrect-data.ts` (datos de fábrica).
- **Modelo.** `AutoFlags` (casillas, comunes a todos los idiomas, ahora con `ordinals` y `markup`), `AutoCorrectOptions` (casillas + `lang` + `exceptions` + `custom`, ya resueltas para un idioma) y `AutoCorrectStore` (lo que se guarda: casillas y, por idioma, lista y excepciones; lo que falta vale lo de fábrica). La clave de almacenamiento no cambia (`nova.writer.autocorrect`); `parseAutoCorrectStore` lee también el formato anterior (la lista propia pasa a ser la del español, **más** la de fábrica). `loadAutoCorrectFrom(store, lang)` y `saveAutoCorrectTo(store, opciones)` conservan su firma (con `lang` opcional): guardar un idioma no pisa el otro, y las casillas valen para ambos. `autoLangOf` lleva un idioma de revisión o etiqueta BCP 47 al de autocorrección.
- **Reemplazos de fábrica** (`defaultReplacements`): 22 en español (`tambien` → `también`, `porfavor` → `por favor`, `talvez` → `tal vez`…) y 23 en inglés (`teh` → `the`, `definately` → `definitely`, `dont` → `don't`…). Solo errores claros: se evitan entradas que sean palabras válidas (`cant`, `wont`, `aun`).
- **Mayúscula de lo escrito** (`replacementFor`): si se escribe `Teh` o `TEH` el resultado es `The` o `THE`, como en Office; solo para entradas escritas en minúsculas.
- **Excepciones** (`AutoExceptions`): `firstLetter` (abreviaturas; de fábrica `sr`, `dr`, `etc`, `mr`, `e.g`… por idioma, y se pueden quitar todas), `twoInitialCaps` y `other` (palabras que no se corrigen por ninguna regla). `startsSentence(before, abreviaturas?)` recibe la lista.
- **Ordinales** (`ordinalOf`): español `1.o` → `1.º`, `2.a` → `2.ª`; inglés `1st`/`2nd`/`3rd`/`4th`/`11th` con las letras en superíndice (`Correction.sup`), que solo puede aplicar quien tenga formato (en campos de texto plano el ordinal inglés se deja como está; si la terminación no corresponde, `2st`, no se toca).
- **Marcado** (`findMarkup`): al cerrar `*hola*` o `_hola mundo_` devuelve dónde están los marcadores y el texto; el de apertura debe ir pegado a la primera letra y precedido de inicio, espacio o signo de apertura (no `2 * 3 *`, ni `a*b*`).
- **Bordes** (`ruleLineKind`): `---` fina, `___` gruesa, `===` doble, `***` punteada, `~~~` ondulada, `###` triple.
- **Pruebas:** `spell-core` 66 (+13); aplicación 380 (sin cambios); e2e: Writer autocorrección (la aserción sobre lo guardado pasa al formato nuevo), proof-fields 8/8, Notes 35/35, Writer 19/19, Writer ortografía, Calc.
- **Límites:** (1) los reemplazos de fábrica son pocos (Office trae cientos); (2) los dos idiomas son español e inglés, el resto de idiomas usa la del español; (3) los ordinales en español solo en singular (`1.o`, `2.a`); (4) todavía ningún producto aplica `*negrita*`, ordinales con superíndice ni líneas de borde (fase 3), ni hay interfaz para las excepciones ni para el idioma de la lista (fase 2); (5) las listas de fábrica ya están activas: al escribir `tambien` en cualquier producto se corrige a `también`.
