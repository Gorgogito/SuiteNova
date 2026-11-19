# Diseño: Diccionario de sinónimos (componente compartido `thesaurus-core`)

## 1. Cómo es en Office
Es parte de las herramientas de lenguaje (Proofing Tools), **compartido** por Word, PowerPoint, Outlook y OneNote; Excel no lo tiene (ofrece «Investigar»). Se invoca con el menú contextual (Sinónimos, lista corta), con Revisar › Sinónimos (Mayús+F7: panel con los significados por categoría gramatical, «Insertar», «Copiar», «Buscar») y usa el idioma del texto seleccionado. Si la palabra está flexionada busca su forma de base.

## 2. Arquitectura
Igual que el corrector: motor sin interfaz + interfaz compartida.
- `packages/thesaurus-core`: `Thesaurus` (búsqueda binaria sobre texto ordenado, sin crear un objeto por entrada), `lemmaCandidates` (formas de base de palabras flexionadas), `matchCase` (conserva mayúscula inicial o sostenida), `thesaurusLangFor` (es, es-MX y es-PE usan el mismo tesauro).
- Datos (`packages/thesaurus-core/data/th-es.txt`, `th-en.txt`) generados por `scripts/build-thesaurus.mjs` desde los tesauros MyThes de LibreOffice: español = OpenThesaurus es (LGPL 2.1); inglés = WordNet (licencia WordNet, en `data/WordNet_license.txt`). Formato: una entrada por línea, `palabra<TAB>significado<TAB>…`, cada significado `categoría|sinónimo;~parecido;!antónimo`. Se descartan los hiperónimos («generic term»).
- Idiomas: es (es-ES, es-MX, es-PE) y en. Decisión del usuario.

## 3. Plan por fases
1. **Motor y datos (hecha).**
2. **Interfaz compartida (hecha):** panel «Sinónimos», submenú contextual, Mayús+F7, «Insertar», «Copiar», «Buscar».
3. **Writer, Notes y Slides (hecha):** panel, Mayús+F7, botón en la cinta y menú del botón derecho sobre cualquier palabra, en los tres; idioma por texto.
4. **Mail, Plan, Forms y Base:** campos de texto.
5. **Cierre:** documentación, límites y comparación con Word real por COM (`Range.SynonymInfo`).

## 4. Bitácora
### Fase 1 (hecha, 2026-11-18): motor y datos
- `thesaurus-core`: 10 pruebas. Español 21 794 entradas (2,8 MB), inglés 117 666 (6,2 MB). Los `.dat` originales se descargan a `data/src/` (ignorado por git) al ejecutar el script.
- `lookup` devuelve la entrada directa si existe; si no, prueba formas de base (plural, femenino, infinitivo en español; plural, `-ed`, `-ing`, comparativos, irregulares frecuentes en inglés). `lemma` indica si se usó una forma de base.
- **Límites:** (1) una forma flexionada que es entrada por sí misma (`running`, `quickly`) usa esa entrada, no la del verbo; (2) la flexión inversa (devolver el sinónimo conjugado como la palabra escrita) no está: se devuelven formas de base; (3) el español de OpenThesaurus (2012) es más pobre que el inglés (sin categoría gramatical, 22 mil entradas) y sin léxico regional de México y Perú; (4) la lematización es por reglas, sin diccionario morfológico: los verbos irregulares en español no se resuelven.

### Fase 2 (hecha, 2026-11-18): interfaz compartida
- **`apps/suite/src/spell/`:** `thesaurus.ts` (carga perezosa de los dos archivos de datos, `useSynonyms`, `findSynonyms` con palabras parecidas del corrector cuando la palabra no está, `wordAtSelection`), `ThesaurusPane.tsx` (panel «Sinónimos»: significados por categoría, términos relacionados y antónimos; «Insertar» conserva la mayúscula, «Copiar», «Buscar sinónimos» para seguir, «Anterior»; sigue al cursor del documento) y `pmThesaurusHost` (adaptador de cualquier `ReviewHost` de ProseMirror). El menú contextual del corrector (`ReviewMenu`) ofrece hasta 5 sinónimos y «Sinónimos…» si la palabra marcada está en el tesauro.
- **Writer como producto de referencia:** comando `writer.spell.thesaurus` (Mayús+F7), botón «Sinónimos» en Revisar (keytip `SN`) y panel a un lado.
- **Pruebas:** e2e nueva `scripts/e2e-thesaurus.mjs` (10: abrir con Mayús+F7, insertar con mayúscula, palabra flexionada, buscar y volver, palabra ausente con parecidas, inglés, copiar y cerrar, cinta, menú contextual); regresión: aplicación 380, Writer 19/19, Writer ortografía 19.
- **Límites:** (1) el menú del botón derecho solo sale sobre palabras subrayadas por el corrector (las de ortografía no, porque no están en el tesauro): sobre una palabra cualquiera sigue el menú del navegador; el menú sobre cualquier palabra queda para la fase 3. (2) El panel usa el idioma del documento, no el del texto seleccionado (fase 3). (3) El panel sigue al cursor cada medio segundo. (4) Las palabras aparecen repetidas si están en varios significados.

### Fase 3 (hecha, 2026-11-18): Writer, Notes y Slides
- **Menú del botón derecho sobre cualquier palabra** (`spell/WordMenu.tsx`, `wordUnderPointer`): Cortar, Copiar, Pegar (con formato si el portapapeles lo trae; si no, texto) y, si el tesauro conoce la palabra, hasta 5 sinónimos y «Sinónimos…». Las palabras subrayadas conservan el menú del corrector. Sobre un espacio o fuera del texto sigue el menú del navegador.
- **Idioma por texto:** el panel y el menú buscan en el idioma propio del texto (marca `lang` en Writer y Notes, `lang` del tramo en Slides) y, si no tiene, en el del documento (`langAtPos`).
- **Notes y Slides:** comando `notes.spell.thesaurus` / `slides.review.thesaurus` (Mayús+F7), botón «Sinónimos» (keytip `SN`) en Revisar, panel a un lado (Slides lo muestra mientras se edita un texto). Slides no tiene panel «Editor», pero sí este.
- **Pruebas:** `e2e-thesaurus` 14 (Writer: menú sobre cualquier palabra, idioma por texto; Notes; Slides); regresión: aplicación 380, Writer 19/19, Writer ortografía, Notes 23/23 y 35/35, Slides 26/26.
- **Límites:** (1) el menú propio sustituye al del navegador sobre las palabras: no tiene «Seleccionar todo», «Deshacer» ni las opciones de pegado de Office. (2) Pegar con formato depende de que el navegador dé permiso de lectura del portapapeles; si no, pega texto. (3) El panel de Slides solo sigue al texto cuando se está editando una forma. (4) La flexión inversa sigue sin hacerse (se insertan formas de base).
