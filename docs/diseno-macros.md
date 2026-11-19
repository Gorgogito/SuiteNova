# Macros (producto auxiliar compartido): diseño

## 1. Cómo es en Office
- **Compartido:** el lenguaje VBA y su editor (VBE, Alt+F11: explorador de proyectos, ventana inmediato, locales, depurador paso a paso, puntos de interrupción), la grabadora de macros, la seguridad (centro de confianza, lugares de confianza, firma digital).
- **Propio de cada producto:** el modelo de objetos (`Word.Application`, `Excel.Application`, `PowerPoint.Application`, `Outlook.Application`, `Access` con `DoCmd`, `Project`, `Visio`), el lugar donde se guardan las macros (dentro del archivo `.docm`/`.xlsm`/`.pptm`) y la **biblioteca global del producto** (`Normal.dotm` en Word, `Personal.xlsb` en Excel, `VbaProject.OTM` en Outlook, `Global.MPT` en Project, plantillas de Visio). Una macro de un producto no corre en otro; solo lo controla por automatización.

## 2. Decisiones (del usuario)
- **Biblioteca global: una por producto**, como Office.
- **Alcance: todos los productos que tienen macros en Office.** Writer (Word), Calc (Excel), Slides (PowerPoint), Base (Access), Mail (Outlook), Plan (Project) y Diagram (Visio). **Quedan fuera Notes y Forms**: sus equivalentes (OneNote y Microsoft Forms) no tienen macros en Office; añadirlas sería inventar una función que Office no tiene.

## 3. Estado de partida
- Motor compartido: `packages/base-core/src/basic/` (Nova Basic).
- Con macros hoy: Writer (`writer/macros.ts`, `dlg-macros.tsx`), Calc (`calc/macros.ts`, `dlg-macros.tsx`; los dos cuadros son casi copias) y Base (macros de acciones + módulos con `ModuleEditor`).
- Sin macros: Slides, Mail, Plan, Diagram. Sin grabadora, sin depurador paso a paso, sin biblioteca global, sin firma.
- Se mantiene: no se abre VBA real ni `.docm`/`.xlsm`/`.pptm`/`vbaProject.bin`; el código viaja en una parte propia del archivo que Office ignora; contenido deshabilitado al abrir hasta habilitarlo; límite de 20 millones de instrucciones o 20 s.

## 4. Plan por fases
1. **Núcleo y editor común:** un editor y un cuadro «Macros» compartidos (lista, crear, ejecutar, editar, eliminar, ventana inmediato, números de línea, comprobación de sintaxis), que Writer, Calc y Base pasan a usar; el intérprete gana pausa, paso a paso, puntos de interrupción y ventana de variables locales.
2. **Grabadora de macros:** cada producto declara sus acciones grabables y la grabadora las traduce a código Nova Basic. Primero Writer y Calc.
3. **Modelos de objetos nuevos:** Slides (`Presentation`, `Slide`, `Shape`, `TextRange`), Mail (`Application`, `MailItem`, carpetas, contactos y citas) y la grabadora para ellos.
4. **Plan y Diagram:** `Project`/`Task`/`Resource` y `Document`/`Page`/`Shape`/`Connector`.
5. **Biblioteca global por producto, seguridad y cierre:** biblioteca personal de cada producto, lugares de confianza y firma de macros; documentación, límites y comparación con Office real por COM (`VBProject`, ejecutar macros equivalentes).

Cada fase se hace producto por producto y se prueba antes de pasar a la siguiente.

## 5. Bitácora
### Fase 1 (hecha, 2026-11-19): núcleo, editor común y depurador
- **Intérprete** (`packages/base-core/src/basic/interp.ts`): la ejecución de sentencias pasa a generadores (`execListG`, `execCompound`, `callProcG`) para poder detenerse sin romper el intérprete sincrónico; todo lo demás (expresiones, funciones, eventos) sigue siendo síncrono y se ejecuta con `drive`. Nueva API `Interpreter.debug(nombre, args, {breakpoints, stopAtStart})` que devuelve una `DebugSession` (`step('into'|'over'|'out'|'continue')`, `stack()`, `locals(i)`, `evaluate(src, i)`, `setBreakpoints`, `stop`). El tiempo que se pasa detenido no cuenta para el límite de 20 s. Los parámetros ByRef se ven con el nombre del procedimiento.
- **Coste:** el intérprete es algo más lento (bucle de 3 millones de vueltas: 2,2 s → 3,0 s; Fibonacci recursivo(24): 145 ms → 207 ms). Las pruebas existentes (109 del intérprete) pasan sin cambios; 8 nuevas en `debug.test.ts` (base-core 326).
- **Núcleo compartido** (`apps/suite/src/macros/`): `runtime.ts` (`MacroRuntime`: carga, procedimientos, ejecución con la protección de deshacer del producto, ventana inmediato, consola, depuración; Writer y Calc lo extienden y ya no tienen copias), `debug.ts` (`DebugRun`, `reportError`), `CodeEditor.tsx` (números de línea, margen con puntos de interrupción, F9, línea actual resaltada, sangría con Tab), `DebugPanel.tsx` (Continuar, por instrucciones, por procedimientos, salir, detener; variables y pila), `Immediate.tsx`, `MacroDialogs.tsx` (cuadro «Macros» con «Paso a paso» y editor, sobre un `MacroProject` que describe al producto). Los cuadros de Writer y Calc son ahora delgados; el editor de módulos de Base usa los mismos componentes.
- **Teclas:** F5 ejecuta o continúa, F8 por instrucciones, Mayús+F8 por procedimientos, Ctrl+Mayús+F8 salir, F9 punto de interrupción. Con puntos de interrupción puestos, «Ejecutar» corre bajo el depurador y se detiene en ellos. Con la ejecución detenida, la ventana inmediato evalúa expresiones (`? x * 3`) y ejecuta instrucciones (`x = 7`) en el procedimiento seleccionado de la pila.
- **Pruebas:** base-core 326, app 380, `tsc` limpio; e2e nueva `scripts/e2e-macros-debug.mjs` (9: pasos, pila, variables, punto de interrupción, inmediato, detener, teclas, «Paso a paso» del cuadro Macros, error con línea, cerrar detenido, Base) y regresión (`e2e-writer-macros`, `e2e-calc-objects`, `e2e-base-code`).
- **Límites:** (1) solo se detiene en las sentencias de los procedimientos: lo que hace una función llamada **dentro de una expresión** (`x = F(2)`) se ejecuta entera, sin detenerse ni respetar puntos de interrupción; un procedimiento llamado como sentencia (`Dobla x`, `Call Dobla(x)`) sí se puede recorrer; (2) mientras está detenido el cuadro es modal (no se puede tocar el documento) y el código es de solo lectura; (3) una macro depurada deja un paso de deshacer por cada tramo ejecutado que cambió algo (no uno solo); (4) los puntos de interrupción no se guardan en el archivo; en Base duran lo que la base abierta; (5) no hay ventana de inspección, ni «establecer próxima instrucción», ni editar y continuar; (6) los eventos (`Document_Open`, `Worksheet_Change`) y las funciones de hoja no se depuran; (7) en Base, si la ejecución entra en otro módulo se abre su pestaña.

## 6. Estado
Fase 1 hecha.
