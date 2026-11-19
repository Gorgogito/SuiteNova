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
(sin fases hechas)
