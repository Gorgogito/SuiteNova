# SuiteNova

Suite ofimática libre (MPL-2.0), sin suscripciones. Referencia funcional y visual: Microsoft Office 2024; código, marca y recursos propios.

## Estado: Fase 11 – Nova Notes con lienzo libre (beta) · Forms · Diagram · Plan · Mail · Base · Slides · Writer · Calc (beta)

| Módulo | Estado |
|---|---|
| Núcleo de UI (`packages/core-ui`) | Cinta, pestañas contextuales, colapso de grupos, KeyTips (Alt), "Buscar comandos" (Alt+Q), Backstage, barra de estado con zoom, temas claro/oscuro/alto contraste, i18n es/en |
| Motor de cálculo (`packages/calc-engine`) | Análisis de fórmulas, recálculo incremental con grafo de dependencias, 205 nombres de función, matrices dinámicas con derrame, formatos de número/fecha, localización es/en, deshacer, gráficos como modelo |
| XLSX (`packages/xlsx-io`) | Lectura y escritura de libros `.xlsx` (valores, fórmulas, estilos, hojas, combinaciones, paneles inmovilizados, nombres, matrices dinámicas, gráficos, autofiltro, formato condicional) |
| **Nova Calc** (`apps/suite/src/calc`) | Rejilla en canvas, edición con barra de fórmulas, autocompletado de funciones, apuntar celdas con el ratón, copiar/cortar/pegar, autorrelleno, ordenar, **autofiltro**, **formato condicional** (valores, texto, duplicados, top/bottom, promedio, fórmula, escalas de color, barras de datos, iconos), quitar duplicados, buscar/reemplazar, nombres, hojas, gráficos, importación y exportación CSV |
| Documentos (`packages/writer-core`) | Esquema ProseMirror del documento (secciones, columnas, notas, campos, ecuaciones, formas, controles de contenido…) y lectura/escritura de `.docx`/`.dotx` (con comentarios, cambios controlados, notas, tabla de contenido, citas, protección), `.rtf` y `.odt`, lectura de `.doc`, cifrado con contraseña (OOXML ágil + contenedor CFB), firma digital propia, combinación de correspondencia |
| **Nova Writer** (`apps/suite/src/writer`) | Páginas reales con secciones, columnas, regla, vistas (impresión, web, esquema, borrador) y encabezado/pie editables sobre la página; comentarios y control de cambios; notas al pie y finales, tabla de contenido, índice, citas y referencias cruzadas; ecuaciones, formas y cuadros de texto; marcas de agua; controles de contenido y formularios; sobres, etiquetas y combinación de correspondencia; plantillas; revisión ortográfica propia (español e inglés); firma digital y contraseña de apertura; macros en Nova Basic con el modelo de objetos de Word; abre `.docx`, `.dotx`, `.doc`, `.rtf`, `.odt`, TXT y HTML y guarda `.docx`, `.dotx`, `.rtf`, `.odt`, TXT y HTML; imprimir o guardar como PDF |
| Presentaciones (`packages/slides-core`) | Modelo de presentación y lectura/escritura de `.pptx` (diseños y patrón, temas, formas libres, tablas con estilos, imágenes con recorte, NovaArt, SmartArt, transiciones y animaciones, guías), `.odp` (con pérdidas avisadas) y texto de `.ppt` |
| **Nova Slides** (`apps/suite/src/slides`) | Editor de presentaciones: formas y puntos de edición, tablas, imágenes y ecuaciones, patrón y diseños editables, temas, vistas Normal, Esquema, Clasificador, Notas y Lectura, presentación con vista de moderador, ensayo, comentarios, ortografía; abrir `.pptx`, `.ppsx`, `.potx`, `.odp` y `.ppt` (solo texto); exportar `.pptx`, `.ppsx`, `.potx`, `.odp`, imágenes PNG/JPEG, vídeo WebM e imprimir a PDF |
| Hub | Lanza cada módulo en su ventana; lista de recientes |
| Motor de datos (`packages/base-core`) | SQLite (sql.js, WebAssembly): tablas con tipos y restricciones, rediseño de tablas conservando datos, índices, vistas y disparadores, relaciones, deshacer, compilador de consultas (totales, parámetros, referencias cruzadas, unión, acción), expresiones, paginación y dibujo de informes, e **intérprete de Nova Basic** y de macros; todo guardado dentro del propio archivo `.sqlite` |
| **Nova Base** (`apps/suite/src/base`) | Panel de objetos, hoja de datos virtualizada con edición en celda y validación de tipos, **deshacer/rehacer de datos y estructura**, diseño de tablas (claves, autonumérico, relaciones con acciones en cascada) que **conserva vistas, disparadores e índices al rediseñar**, **ventana de relaciones**, consultas (SQL y diseñador con totales, parámetros, referencias cruzadas, unión y consultas de acción), **diseñador de formularios** (controles libres, listas desplegables, subformularios, campos calculados, eventos), **diseñador de informes** (secciones, grupos, gráficos, subinformes, etiquetas, numeración de páginas), **macros y módulos en Nova Basic** (subconjunto de VBA) con ventana inmediato y barra de seguridad, importar CSV y Excel, exportar CSV |
| Libretas (`packages/notes-core`) | Modelo de libreta con **páginas de lienzo libre** (cuadros de texto, imágenes y grabaciones en cualquier punto, tinta y formas), subpáginas, grupos de secciones, papelera, plantillas, reglas de página, historial de versiones con diferencias, 28 etiquetas y propias, tablas con fórmulas (motor de Nova Calc), **cifrado AES-256-GCM** de páginas y secciones (incluidas sus imágenes y grabaciones), combinación de libretas compartidas, búsqueda sin acentos (también el texto leído de las imágenes), exportación a Markdown, archivo `.novanotes` v2 con validación y migración de la v1 |
| **Nova Notes** (`apps/suite/src/notes`) | **Lienzo libre como OneNote** (clic en cualquier punto para escribir; cuadros de texto, imágenes, audio y vídeo que se mueven y redimensionan), **tinta y dibujo** (lápiz, marcador, formas, tinta a forma, borrador, selección), **grabación de audio y vídeo**, **OCR** con Tesseract incluido y **búsqueda dentro de las imágenes**, **páginas y secciones con contraseña**, libretas compartidas (combinación por páginas sobre una carpeta sincronizada), historial de versiones, papelera, subpáginas, grupos de secciones, plantillas, reglas y color de página, vínculos entre páginas, **enviar por correo** (`.eml`), tablas con fórmulas, ecuaciones LaTeX, 28 etiquetas y propias, importar de Word/texto/HTML, exportar a Markdown, página web y Word |
| Correo (`packages/mail-core`) | Lectura y escritura de mensajes RFC 5322/MIME (cabeceras codificadas, charsets, multipart, adjuntos, imágenes `cid:`), `.mbox`, iCalendar (eventos, tareas, recordatorios, repeticiones, zonas horarias), vCard 2.1/3.0/4.0 y CSV de contactos, y el almacén de datos (`.novamail`) |
| **Nova Mail** (`apps/suite/src/mail`) | Correo (carpetas, lista virtualizada, búsqueda sin acentos, panel de lectura seguro con contenido remoto bloqueado, responder/reenviar, borradores, adjuntos), calendario (día/semana/mes, repeticiones, recordatorios), contactos y tareas; importar/exportar `.eml`, `.mbox`, `.ics`, `.vcf`, `.csv`. **Cuentas en la aplicación de escritorio: IMAP, POP3, JMAP y Exchange (EWS)**, con contraseña u **OAuth 2.0** (Google, Microsoft u otro proveedor); **todas las carpetas con sus subcarpetas**, sincronización automática, y eliminar/archivar/mover/marcar **también en el servidor** (con cambios pendientes si no hay conexión) y copia en Enviados. **Abre archivos de Outlook (`.msg`, `.pst`, `.ost`)** |
| Planificación (`packages/plan-core`) | Calendario laboral (días y horas, excepciones), planificador por camino crítico (vínculos FC/CC/FF/CF con retraso y adelanto, restricciones, resúmenes, hitos), costes, recursos y sobreasignación, línea base; `.novaplan`, XML de Microsoft Project (MSPDI) y CSV |
| **Nova Plan** (`apps/suite/src/plan`) | Gantt con horas del día, duraciones transcurridas, divisiones y programación manual; calendarios por proyecto, tarea y recurso; trabajo y costos reales, tipos de tarea y esfuerzo; 11 líneas base y valor ganado; subproyectos, campos personalizados con fórmulas, filtros y agrupaciones; diagrama de red (PERT); hoja, uso y gráfico de recursos; informes visuales (exportables a CSV y HTML); «lo más tarde posible», nivelación de recursos con prioridades, zona horaria, valor ganado por reparto y subproyectos con vínculo vivo. XML de Project (MSPDI) y `.novaplan`. **No abre `.mpp`** (ver docs/LIMITACIONES.md) |
| Dibujo (`packages/diagram-core`) | Modelo de páginas, formas y conectores, 64 formas propias (básicas, diagrama de flujo, UML, redes, BPMN), enrutado de conectores, exportación SVG, `.novadiagram` y lectura/escritura de `.vsdx` |
| **Nova Diagram** (`apps/suite/src/diagram`) | Lienzo con selección, mover/redimensionar/girar, conectores pegados a puntos de conexión, texto, alinear/distribuir, páginas, cuadrícula; exportar SVG, PNG, PDF (imprimir) y Visio (`.vsdx`) Incluye grupos, capas, contenedores y carriles que se redimensionan solos, diseño automático, imágenes, hipervínculos, datos de forma, reflejar y conectores repartidos en un mismo punto. |
| Formularios (`packages/forms-core`) | Modelo de formulario (11 tipos de pregunta, condiciones, cuestionarios con puntos), validación, resumen de resultados, CSV, archivo `.novaforms`, importación de respuestas con comprobación, y la página web autónoma (un solo `.html`) |
| **Nova Forms** (`apps/suite/src/forms`) | Diseñador, vista previa, rellenar y guardar respuestas, resultados (resumen con barras y respuestas individuales), exportar página web y CSV, importar respuestas, **importar formularios de Google Forms (página guardada) y de Microsoft/Google Forms (hoja de respuestas)**. **No tiene servidor**: las respuestas vuelven como archivos |

Consulta [docs/LIMITACIONES.md](docs/LIMITACIONES.md) para lo que está verificado, lo que no, y lo que todavía no se soporta.

## Requisitos
Node 20+, pnpm 12, Rust estable, WebView2 y Visual Studio Build Tools (Windows).

## Comandos
```
pnpm install
pnpm dev            # solo frontend en http://localhost:1420  (?app=calc, writer, slides, base, notes, mail, plan, diagram, forms)
pnpm tauri dev      # aplicación de escritorio (usa el puerto 1420; cierra antes `pnpm dev`)
pnpm test           # pruebas unitarias (927); cd apps/suite/src-tauri && cargo test: 21 más de Rust
pnpm typecheck
pnpm tauri build    # instaladores NSIS/MSI
node scripts/e2e-calc.mjs --shots dir        # pruebas de extremo a extremo en Edge (necesita `pnpm dev`)
node scripts/e2e-filter-cf.mjs --shots dir   # ídem para autofiltro y formato condicional
node scripts/e2e-writer.mjs --shots dir      # ídem para Nova Writer (19 comprobaciones, incluye el PDF); también e2e-writer-{layout,review,refs,objects,mail,spell,security,formats,macros}.mjs
node scripts/e2e-slides.mjs --shots dir      # ídem para Nova Slides (25 comprobaciones)
node scripts/e2e-base.mjs --shots dir        # ídem para Nova Base (14 comprobaciones)
node scripts/e2e-base-design.mjs --shots dir # Base: deshacer, diseñador de consultas, relaciones, rediseño (13)
node scripts/e2e-base-designers.mjs --shots dir # Base: diseñadores de formularios e informes (12)
node scripts/e2e-base-code.mjs --shots dir   # Base: macros, módulos, eventos y barra de seguridad (11)
node scripts/e2e-notes.mjs --shots dir       # ídem para Nova Notes (23 comprobaciones; con OCR real y grabación simulada; tarda unos 4 min)
node scripts/e2e-mail.mjs --shots dir        # ídem para Nova Mail (18 comprobaciones; tarda unos 2 min)
node scripts/e2e-plan.mjs --shots dir        # ídem para Nova Plan (42 comprobaciones)
node scripts/e2e-diagram.mjs --shots dir     # ídem para Nova Diagram (27 comprobaciones)
node scripts/e2e-forms.mjs --shots dir       # ídem para Nova Forms (21 comprobaciones)
node scripts/e2e-mail-remote.mjs --shots dir # ídem para las cuentas de Nova Mail (OAuth, carpetas, cambios en el servidor, sincronización automática, archivos de Outlook) con un servidor simulado (17 comprobaciones; con NOVA_OUTLOOK_SAMPLES=carpeta también prueba .msg y .pst)
node scripts/tour-calc.mjs dir          # capturas para revisión visual
```

## Estructura
```
packages/core-ui     Cinta, comandos, atajos, keytips, backstage, temas, i18n
packages/calc-engine Libro, fórmulas, funciones, formatos, localización, gráficos (sin UI)
packages/xlsx-io     Lectura/escritura de .xlsx (JSZip + fast-xml-parser)
packages/writer-core Esquema del documento (ProseMirror), estilos, página y lectura/escritura de .docx
packages/slides-core Modelo de presentación y lectura/escritura de .pptx
packages/base-core   Motor de bases de datos (SQLite), diseñador de consultas, informes, CSV
packages/notes-core  Modelo de libretas (lienzo, tinta, versiones, cifrado, combinación), búsqueda, fórmulas, Markdown
apps/suite/public/ocr Motor de OCR (Tesseract, Apache-2.0) y datos de español e inglés que usa Nova Notes (ver NOTICE.txt)
packages/mail-core   Mensajes MIME, mbox, iCalendar, vCard, almacén de datos de correo
packages/forms-core  Formularios: preguntas, validación, resultados, página web autónoma
packages/plan-core   Planificador (camino crítico), calendario, costes, MSPDI, CSV
packages/diagram-core Formas, conectores, enrutado, SVG, .novadiagram, VSDX
apps/suite           Hub, módulos (React) y shell Tauri 2 (src-tauri)
scripts              Capturas y pruebas de extremo a extremo con el Edge del sistema
docs                 Limitaciones conocidas
```

Principios: todo control de la cinta se declara contra un `CommandRegistry` (una prueba verifica que no haya botones sin comando); el modelo de datos no depende de la interfaz; las bibliotecas del núcleo no tienen dependencias GPL.

## Instalar y probar (Windows)

Los instaladores se generan con `pnpm --filter @suitenova/suite tauri build` (unos 12 minutos la primera vez) y quedan en
`apps/suite/src-tauri/target/release/bundle/`. Una copia con sus sumas de comprobación está en `instaladores/`:

| Archivo | Para qué |
|---|---|
| `SuiteNova_0.0.8_x64-setup.exe` | Instalador normal (NSIS). Instala **solo para tu usuario**, sin permisos de administrador, y crea acceso directo y desinstalador. |
| `SuiteNova_0.0.8_x64_es-ES.msi` / `..._en-US.msi` | Paquete MSI (por ejemplo para despliegues). |

- **Aviso de Windows SmartScreen:** los instaladores **no están firmados** (no hay certificado de firma de código), así que
  Windows mostrará «Windows protegió su PC»: *Más información → Ejecutar de todas formas*. Los hashes de `instaladores/SHA256.txt`
  permiten comprobar que el archivo es el generado aquí.
- Necesita **Microsoft Edge WebView2**, que ya viene con Windows 10/11 actualizados.
- Todo el código es de este repositorio; los instaladores se generaron sin cambios en el entorno donde se desarrolló.
- **Abrir archivos desde el Explorador:** los tipos propios (`.novanotes`, `.novamail`, `.novaplan`, `.novadiagram`, `.novaforms`)
  se asocian al instalar (doble clic). También funciona «Abrir con → SuiteNova» para `.docx`, `.xlsx`, `.pptx`, `.eml`, `.ics`,
  `.vcf`, `.csv`, `.vsdx`, etc., pero **no se asocian por defecto** para no quitarle esos tipos a tus programas actuales.
- Datos de la aplicación: las cuentas de correo (sin contraseñas) en la carpeta de datos de la aplicación
  (`%APPDATA%\org.suitenova.app`); las contraseñas, en el Administrador de credenciales de Windows. Desinstalar
  desde *Configuración → Aplicaciones* no toca tus documentos.
- Sin actualizaciones automáticas: para actualizar se instala la versión nueva encima.
