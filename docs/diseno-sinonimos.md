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
2. **Interfaz compartida:** panel «Sinónimos», submenú contextual, Mayús+F7, «Insertar», «Copiar», «Buscar».
3. **Writer, Notes y Slides:** selección, mayúsculas, idioma por texto, deshacer.
4. **Mail, Plan, Forms y Base:** campos de texto.
5. **Cierre:** documentación, límites y comparación con Word real por COM (`Range.SynonymInfo`).

## 4. Bitácora
### Fase 1 (hecha, 2026-11-18): motor y datos
- `thesaurus-core`: 10 pruebas. Español 21 794 entradas (2,8 MB), inglés 117 666 (6,2 MB). Los `.dat` originales se descargan a `data/src/` (ignorado por git) al ejecutar el script.
- `lookup` devuelve la entrada directa si existe; si no, prueba formas de base (plural, femenino, infinitivo en español; plural, `-ed`, `-ing`, comparativos, irregulares frecuentes en inglés). `lemma` indica si se usó una forma de base.
- **Límites:** (1) una forma flexionada que es entrada por sí misma (`running`, `quickly`) usa esa entrada, no la del verbo; (2) la flexión inversa (devolver el sinónimo conjugado como la palabra escrita) no está: se devuelven formas de base; (3) el español de OpenThesaurus (2012) es más pobre que el inglés (sin categoría gramatical, 22 mil entradas) y sin léxico regional de México y Perú; (4) la lematización es por reglas, sin diccionario morfológico: los verbos irregulares en español no se resuelven.
