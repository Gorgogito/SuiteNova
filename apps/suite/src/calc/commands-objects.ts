import { hasPassword, type ChartSeries, type ErrorKind, type ShapeKind, type TrendType } from '@suitenova/calc-engine';
import { supportsErrorBars, supportsTrend } from './dlg-chartfit';
import { PIVOT_STYLE_NAMES, TABLE_STYLE_NAMES, normRect, rotateShapes, safeUrl, shapesBounds, type PageSetup } from '@suitenova/calc-engine';
import type { CommandDef } from '@suitenova/core-ui';
import { CHART_PRESETS, presetOf } from './chartPresets';
import type { CalcUI } from './commands';
import { slicerSource } from './dlg-table';

/** Commands of the objects a sheet can hold: validation, links, notes, pictures, tables, sparklines, pivots, slicers, printing, macros. */
export function objectCommands(ui: CalcUI): CommandDef[] {
  const d = ui.doc;
  const x = d.x;
  const cmds: CommandDef[] = [];
  const add = (c: CommandDef) => cmds.push(c);
  const editing = () => !!d.edit;
  const alertErr = (e: string | null | undefined) => {
    if (e) window.alert(e);
  };

  // ---- data validation
  add({ id: 'calc.validation', label: 'Validación de datos…', icon: 'validation', description: 'Limita lo que se puede escribir en las celdas seleccionadas y muestra mensajes.', enabled: () => !editing(), run: () => ui.openDialog('validation') });
  add({ id: 'calc.validation.clear', label: 'Borrar validación de datos', icon: 'eraser', enabled: () => !editing() && d.sheet.validations.length > 0, run: () => x.clearValidation() });
  add({ id: 'calc.circleInvalid', label: 'Rodear con un círculo datos no válidos', icon: 'circleData', description: 'Marca las celdas con valores que no cumplen su regla de validación.', checked: () => x.circleInvalid, enabled: () => d.sheet.validations.length > 0 || x.circleInvalid, run: () => x.toggleCircleInvalid() });

  // ---- links
  add({ id: 'calc.link', label: 'Vínculo…', icon: 'link', shortcut: 'Ctrl+K', enabled: () => !editing(), description: 'Inserta un hipervínculo a una página web, un lugar del libro o una dirección de correo.', run: () => ui.openDialog('hyperlink') });
  add({ id: 'calc.link.open', label: 'Abrir hipervínculo', icon: 'link', enabled: () => !!x.hyperlinkAtActive(), run: () => {
    const h = x.hyperlinkAtActive();
    if (h) alertErr(x.followHyperlink(h, ui.openUrl));
  } });
  add({ id: 'calc.link.remove', label: 'Quitar hipervínculo', icon: 'unlink', enabled: () => !editing() && !!x.hyperlinkAtActive(), run: () => x.removeHyperlink() });

  // ---- notes
  add({ id: 'calc.note.new', label: 'Nueva nota', icon: 'noteAdd', shortcut: 'Shift+F2', enabled: () => !editing(), run: () => ui.openDialog('note') });
  add({ id: 'calc.note.delete', label: 'Eliminar nota', icon: 'noteOff', enabled: () => !editing() && !!x.commentAtActive(), run: () => x.deleteComments() });
  add({ id: 'calc.note.toggle', label: 'Mostrar u ocultar nota', icon: 'note', enabled: () => !!x.commentAtActive(), checked: () => !!x.commentAtActive()?.visible, run: () => x.toggleCommentVisible(d.sel.active.row, d.sel.active.col) });
  add({ id: 'calc.note.showAll', label: 'Mostrar todas las notas', icon: 'note', enabled: () => d.sheet.comments.length > 0, run: () => x.setAllCommentsVisible(true) });
  add({ id: 'calc.note.hideAll', label: 'Ocultar todas las notas', icon: 'note', enabled: () => d.sheet.comments.length > 0, run: () => x.setAllCommentsVisible(false) });
  add({ id: 'calc.note.prev', label: 'Nota anterior', icon: 'prev', enabled: () => d.sheet.comments.length > 0, run: () => void x.goToComment(-1) });
  add({ id: 'calc.note.next', label: 'Nota siguiente', icon: 'next', enabled: () => d.sheet.comments.length > 0, run: () => void x.goToComment(1) });

  // ---- trendlines and error bars (all series of the selected chart)
  const chartSel = () => d.chartById(d.selectedChart);
  const trendOk = () => { const c = chartSel(); return !!c && supportsTrend(c); };
  const errOk = () => { const c = chartSel(); return !!c && supportsErrorBars(c); };
  const setAllSeries = (patch: (s: ChartSeries) => Partial<ChartSeries>, label: string) => {
    const c = chartSel();
    if (c) d.updateChart(c.id, { series: c.series.map((s) => ({ ...s, ...patch(s) })) }, label);
  };
  const trendLabels: [TrendType, string][] = [['linear', 'Lineal'], ['exp', 'Exponencial'], ['log', 'Logarítmica'], ['poly', 'Polinómica'], ['power', 'Potencial'], ['movingAvg', 'Media móvil']];
  for (const [type, label] of trendLabels) {
    add({ id: `calc.trend.${type}`, label, icon: 'chartLine', enabled: trendOk, checked: () => !!chartSel()?.series.length && chartSel()!.series.every((s) => s.trendlines?.some((tl) => tl.type === type)),
      run: () => {
        const on = !!chartSel()?.series.every((s) => s.trendlines?.some((tl) => tl.type === type));
        setAllSeries((s) => {
          const rest = (s.trendlines ?? []).filter((tl) => tl.type !== type);
          const list = on ? rest : [...rest, { type, ...(type === 'poly' ? { order: 2 } : {}), ...(type === 'movingAvg' ? { period: 2 } : {}) }];
          return { trendlines: list.length ? list : undefined };
        }, 'Línea de tendencia');
      } });
  }
  add({ id: 'calc.trend.clear', label: 'Quitar líneas de tendencia', icon: 'eraser', enabled: () => !!chartSel()?.series.some((s) => s.trendlines?.length), run: () => setAllSeries(() => ({ trendlines: undefined }), 'Quitar líneas de tendencia') });
  const errLabels: [ErrorKind, string][] = [['stderr', 'Error estándar'], ['percent', 'Porcentaje (5 %)'], ['stdev', 'Desviación estándar'], ['fixed', 'Valor fijo (1)']];
  for (const [kind, label] of errLabels) {
    add({ id: `calc.err.${kind}`, label, icon: 'sigma', enabled: errOk, checked: () => !!chartSel()?.series.length && chartSel()!.series.every((s) => s.errY?.kind === kind),
      run: () => {
        const on = !!chartSel()?.series.every((s) => s.errY?.kind === kind);
        setAllSeries(() => ({ errY: on ? undefined : { kind, direction: 'both', ...(kind === 'percent' ? { value: 5 } : kind === 'stdev' || kind === 'fixed' ? { value: 1 } : {}) } }), 'Barras de error');
      } });
  }
  add({ id: 'calc.err.clear', label: 'Quitar barras de error', icon: 'eraser', enabled: () => !!chartSel()?.series.some((s) => s.errY || s.errX), run: () => setAllSeries(() => ({ errY: undefined, errX: undefined }), 'Quitar barras de error') });

  // ---- protection
  const sheetProtected = () => d.prot.isProtected();
  const bookProtected = () => !!d.wb.protection?.structure;
  add({ id: 'calc.protectSheet', label: 'Proteger hoja…', icon: 'lock', description: 'Impide cambiar las celdas bloqueadas de la hoja, con una contraseña opcional.', enabled: () => !editing() && !sheetProtected(), run: () => ui.openDialog('protectSheet') });
  add({ id: 'calc.unprotectSheet', label: 'Quitar protección de la hoja', icon: 'lockOpen', enabled: () => !editing() && sheetProtected(), run: () => {
    const p = d.sheet.protection;
    if (p && hasPassword(p)) ui.openDialog('unprotectSheet');
    else d.prot.unprotectSheet(d.activeSheetId, '');
  } });
  add({ id: 'calc.protectBook', label: 'Proteger libro…', icon: 'lock', description: 'Impide añadir, eliminar, mover, copiar, renombrar u ocultar hojas.', enabled: () => !editing() && !bookProtected(), run: () => ui.openDialog('protectBook') });
  add({ id: 'calc.unprotectBook', label: 'Quitar protección del libro', icon: 'lockOpen', enabled: () => !editing() && bookProtected(), run: () => {
    const p = d.wb.protection;
    if (p && hasPassword(p)) ui.openDialog('unprotectBook');
    else d.prot.unprotectWorkbook('');
  } });
  add({ id: 'calc.lockCells', label: 'Bloquear celda', icon: 'lock', description: 'Marca o desmarca las celdas seleccionadas como bloqueadas. Solo surte efecto con la hoja protegida.', enabled: () => !editing() && !sheetProtected(), checked: () => d.currentStyle().locked !== false, run: () => d.applyStyle({ locked: d.currentStyle().locked === false ? undefined : false }, 'Bloquear celda') });

  // ---- shapes and text boxes
  const shapeKinds: [ShapeKind, string][] = [['rect', 'Rectángulo'], ['roundRect', 'Rectángulo redondeado'], ['ellipse', 'Elipse'], ['triangle', 'Triángulo'], ['diamond', 'Rombo'], ['rightArrow', 'Flecha derecha'], ['leftArrow', 'Flecha izquierda'], ['line', 'Línea']];
  for (const [kind, label] of shapeKinds) add({ id: `calc.shape.${kind}`, label, icon: kind === 'line' ? 'ruler' : 'shapes', enabled: () => !editing(), run: () => void x.insertShape(kind) });
  add({ id: 'calc.textbox', label: 'Cuadro de texto', icon: 'textbox', description: 'Inserta un cuadro para escribir texto sobre la hoja. Doble clic para editar el texto.', enabled: () => !editing(), run: () => void x.insertShape('textBox') });
  add({ id: 'calc.shape.format', label: 'Formato de forma…', icon: 'settings', enabled: () => !!x.selectedShape, run: () => ui.openDialog('shapeFormat') });
  const turnShape = (by: number) => {
    const group = d.sheet.shapes.filter((o) => x.selectedShapes.includes(o.id));
    if (group.length > 1) {
      const b = shapesBounds(group);
      x.updateShapes(rotateShapes(group, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, by), 'Girar formas');
      return;
    }
    const s = x.selectedShape ? d.sheet.shapes.find((o) => o.id === x.selectedShape) : undefined;
    if (s) x.updateShape(s.id, { rotation: ((((s.rotation ?? 0) + by) % 360) + 360) % 360 || undefined }, 'Girar forma');
  };
  add({ id: 'calc.shape.rotateRight', label: 'Girar a la derecha', icon: 'redo', description: 'Gira la forma 90° en el sentido de las agujas del reloj.', enabled: () => !!x.selectedShape, run: () => turnShape(90) });
  add({ id: 'calc.shape.rotateLeft', label: 'Girar a la izquierda', icon: 'undo', description: 'Gira la forma 90° en sentido contrario a las agujas del reloj.', enabled: () => !!x.selectedShape, run: () => turnShape(-90) });
  add({ id: 'calc.shape.delete', label: 'Eliminar forma', icon: 'trash', hint: 'Supr', enabled: () => !!x.selectedShape, run: () => x.deleteSelectedShapes() });
  add({ id: 'calc.shape.group', label: 'Agrupar', icon: 'shapes', description: 'Une las formas seleccionadas (Ctrl+clic para elegir varias) para moverlas, cambiar su tamaño y girarlas como un bloque.', enabled: () => x.selectedShapes.length > 1, run: () => x.groupSelectedShapes() });
  add({ id: 'calc.shape.ungroup', label: 'Desagrupar', icon: 'shapes', description: 'Separa el grupo de formas seleccionado en formas independientes.', enabled: () => x.selectionHasGroup, run: () => x.ungroupSelectedShapes() });

  add({ id: 'calc.wordart.format', label: 'Formato de WordArt…', icon: 'wordart', description: 'Cambia el relleno, el contorno, la sombra, el resplandor, el reflejo y la transformación del texto de la forma.', enabled: () => !!x.selectedShape && !editing(), run: () => ui.openDialog('wordartFormat') });
  add({ id: 'calc.wordart.clear', label: 'Quitar WordArt', icon: 'close', description: 'Devuelve el texto de la forma a su aspecto normal.', enabled: () => !!x.selectedShape && !!d.sheet.shapes.find((o) => o.id === x.selectedShape)?.wordart, run: () => x.setWordArt(null) });

  // ---- pictures
  add({ id: 'calc.picture', label: 'Imagen…', icon: 'picture', description: 'Inserta una imagen (PNG, JPG, GIF, BMP, WebP o SVG) de un archivo.', enabled: () => !editing(), run: () => void ui.insertPicture() });
  add({ id: 'calc.picture.delete', label: 'Eliminar imagen', icon: 'trash', enabled: () => !!x.selectedImage, run: () => x.selectedImage && x.deleteImage(x.selectedImage) });
  add({ id: 'calc.picture.alt', label: 'Texto alternativo…', icon: 'note', enabled: () => !!x.selectedImage, run: () => {
    const img = d.sheet.images.find((i) => i.id === x.selectedImage);
    if (!img) return;
    const alt = window.prompt('Texto alternativo de la imagen (lo leen los lectores de pantalla):', img.alt ?? '');
    if (alt !== null) x.updateImage(img.id, { alt: alt.trim() || undefined }, 'Texto alternativo');
  } });
  add({ id: 'calc.picture.original', label: 'Tamaño original', icon: 'picture', enabled: () => !!x.selectedImage, run: () => void ui.restorePictureSize() });

  // ---- tables
  const table = () => x.tableAtActive()?.table;
  add({ id: 'calc.table.create', label: 'Tabla', icon: 'tableGrid', shortcut: 'Ctrl+T', description: 'Convierte el rango en una tabla con filtros, filas con bandas y referencias estructuradas.', enabled: () => !editing(), run: () => ui.openDialog('tableCreate') });
  add({ id: 'calc.table.totals', label: 'Fila de totales', icon: 'sigma', enabled: () => !!table(), checked: () => !!table()?.totals, run: () => table() && x.setTableTotals(table()!.id, !table()!.totals) });
  const toggles: [string, string, 'rowStripes' | 'colStripes' | 'firstCol' | 'lastCol' | 'filterButtons'][] = [
    ['calc.table.rowStripes', 'Filas con bandas', 'rowStripes'],
    ['calc.table.colStripes', 'Columnas con bandas', 'colStripes'],
    ['calc.table.firstCol', 'Primera columna', 'firstCol'],
    ['calc.table.lastCol', 'Última columna', 'lastCol'],
    ['calc.table.filter', 'Botón de filtro', 'filterButtons'],
  ];
  for (const [id, label, key] of toggles) {
    add({ id, label, icon: 'tableGrid', enabled: () => !!table(), checked: () => !!table()?.[key], run: () => table() && x.editTable(table()!.id, label, (t) => void (t[key] = !t[key])) });
  }
  for (const name of TABLE_STYLE_NAMES) {
    add({ id: `calc.table.style.${name}`, label: name.replace('TableStyle', '').replace(/(\D+)(\d+)/, '$1 $2'), icon: 'tableGrid', enabled: () => !!table(), checked: () => table()?.style === name, run: () => table() && x.editTable(table()!.id, 'Estilo de tabla', (t) => void (t.style = name)) });
  }
  add({ id: 'calc.table.resize', label: 'Cambiar tamaño de la tabla…', icon: 'tableProps', enabled: () => !!table(), run: () => ui.openDialog('tableResize') });
  add({ id: 'calc.table.toRange', label: 'Convertir en rango', icon: 'tableGrid', description: 'Deja los datos y quita la tabla; las fórmulas pasan a usar referencias normales.', enabled: () => !!table(), run: () => {
    if (table() && window.confirm('¿Convertir la tabla en un rango normal?')) x.convertTableToRange(table()!.id);
  } });
  add({ id: 'calc.table.slicer', label: 'Insertar segmentación', icon: 'slicer', enabled: () => !!table(), run: () => ui.openDialog('slicer') });
  add({ id: 'calc.table.pivot', label: 'Resumir con tabla dinámica', icon: 'pivot', enabled: () => !!table(), run: () => ui.openDialog('pivotCreate') });

  // ---- sparklines
  add({ id: 'calc.spark.line', label: 'Línea', icon: 'sparkline', enabled: () => !editing(), description: 'Minigráfico de líneas en una celda.', run: () => ui.openDialog('sparkline', 'line') });
  add({ id: 'calc.spark.column', label: 'Columna', icon: 'chartColumn', enabled: () => !editing(), run: () => ui.openDialog('sparkline', 'column') });
  add({ id: 'calc.spark.winloss', label: 'Ganancia o pérdida', icon: 'chartBar', enabled: () => !editing(), run: () => ui.openDialog('sparkline', 'winloss') });
  const spark = () => {
    const { row, col } = d.sel.active;
    return d.sheet.sparklines.find((g) => g.items.some((i) => i.row === row && i.col === col));
  };
  const types: [string, string, 'line' | 'column' | 'winloss'][] = [
    ['calc.sparkType.line', 'Línea', 'line'],
    ['calc.sparkType.column', 'Columna', 'column'],
    ['calc.sparkType.winloss', 'Ganancia o pérdida', 'winloss'],
  ];
  for (const [id, label, type] of types) add({ id, label, icon: 'sparkline', enabled: () => !!spark(), checked: () => spark()?.type === type, run: () => spark() && x.editSparklineGroup(spark()!.id, { type }) });
  const flags: [string, string, 'showHigh' | 'showLow' | 'showNegative' | 'showFirst' | 'showLast' | 'showMarkers' | 'showAxis' | 'rightToLeft'][] = [
    ['calc.spark.high', 'Punto alto', 'showHigh'],
    ['calc.spark.low', 'Punto bajo', 'showLow'],
    ['calc.spark.negative', 'Puntos negativos', 'showNegative'],
    ['calc.spark.first', 'Primer punto', 'showFirst'],
    ['calc.spark.last', 'Último punto', 'showLast'],
    ['calc.spark.markers', 'Marcadores', 'showMarkers'],
    ['calc.spark.axis', 'Mostrar eje', 'showAxis'],
    ['calc.spark.rtl', 'Trazar datos de derecha a izquierda', 'rightToLeft'],
  ];
  for (const [id, label, key] of flags) add({ id, label, icon: 'sparkline', enabled: () => !!spark(), checked: () => !!spark()?.[key], run: () => spark() && x.editSparklineGroup(spark()!.id, { [key]: !spark()![key] }) });
  for (const [id, label, color] of [['blue', 'Azul', '#376092'], ['green', 'Verde', '#4e8f2f'], ['orange', 'Naranja', '#e8833a'], ['red', 'Rojo', '#c00000'], ['gray', 'Gris', '#595959'], ['purple', 'Morado', '#7030a0']] as const) {
    add({ id: `calc.spark.color.${id}`, label, icon: 'sparkline', enabled: () => !!spark(), checked: () => spark()?.color === color, run: () => spark() && x.editSparklineGroup(spark()!.id, { color }) });
  }
  add({ id: 'calc.spark.scale', label: 'Misma escala vertical para todo el grupo', icon: 'sparkline', enabled: () => !!spark(), checked: () => spark()?.minType === 'group', run: () => spark() && x.editSparklineGroup(spark()!.id, spark()!.minType === 'group' ? { minType: 'auto', maxType: 'auto' } : { minType: 'group', maxType: 'group' }) });
  add({ id: 'calc.spark.clear', label: 'Borrar minigráficos seleccionados', icon: 'eraser', enabled: () => !!spark(), run: () => x.clearSparklines() });
  add({ id: 'calc.spark.clearGroup', label: 'Borrar el grupo de minigráficos', icon: 'trash', enabled: () => !!spark(), run: () => x.clearSparklines(normRect(d.activeRange), true) });

  // ---- pivot tables
  const pivot = () => x.pivotAtActive()?.pivot ?? x.pivotById(x.pivotPane)?.pivot;
  add({ id: 'calc.pivot.create', label: 'Tabla dinámica', icon: 'pivot', description: 'Resume los datos con filas, columnas, filtros y valores que se pueden reordenar.', enabled: () => !editing(), run: () => ui.openDialog('pivotCreate') });
  add({ id: 'calc.pivot.refresh', label: 'Actualizar', icon: 'refresh', enabled: () => !!pivot(), run: () => pivot() && alertErr(x.refreshPivot(pivot()!.id)) });
  add({ id: 'calc.pivot.refreshAll', label: 'Actualizar todo', icon: 'refresh', enabled: () => d.wb.sheets.some((s) => s.pivots.length > 0), run: () => alertErr(x.refreshAllPivots()) });
  add({ id: 'calc.pivot.fieldList', label: 'Lista de campos', icon: 'panel', enabled: () => !!x.pivotAtActive() || !!x.pivotPane, checked: () => !!x.pivotPane, run: () => {
    const p = x.pivotAtActive()?.pivot;
    x.pivotPane = x.pivotPane && (!p || p.id === x.pivotPane) ? null : (p?.id ?? x.pivotPane);
    d.touch();
  } });
  add({ id: 'calc.pivot.options', label: 'Opciones de tabla dinámica…', icon: 'tableProps', enabled: () => !!pivot(), run: () => pivot() && ui.openDialog('pivotOptions', pivot()!.id) });
  add({ id: 'calc.pivot.slicer', label: 'Insertar segmentación', icon: 'slicer', enabled: () => !!x.pivotAtActive(), run: () => ui.openDialog('slicer') });
  add({ id: 'calc.pivot.delete', label: 'Eliminar tabla dinámica', icon: 'trash', enabled: () => !!x.pivotAtActive(), run: () => {
    const p = x.pivotAtActive()?.pivot;
    if (p && window.confirm(`¿Eliminar la tabla dinámica "${p.name}" y las celdas que ocupa?`)) x.deletePivot(p.id);
  } });
  for (const layout of ['compact', 'outline', 'tabular'] as const) {
    add({ id: `calc.pivot.layout.${layout}`, label: layout === 'compact' ? 'Mostrar en formato compacto' : layout === 'outline' ? 'Mostrar en formato de esquema' : 'Mostrar en formato tabular', icon: 'pivot', enabled: () => !!pivot(), checked: () => pivot()?.layout === layout, run: () => pivot() && alertErr(x.updatePivot(pivot()!.id, 'Diseño de tabla dinámica', (p) => void (p.layout = layout))) });
  }
  const pToggles: [string, string, 'grandRows' | 'grandCols' | 'subtotals' | 'repeatLabels' | 'blankRowAfterItem'][] = [
    ['calc.pivot.grandRows', 'Totales generales de filas', 'grandRows'],
    ['calc.pivot.grandCols', 'Totales generales de columnas', 'grandCols'],
    ['calc.pivot.subtotals', 'Subtotales', 'subtotals'],
    ['calc.pivot.repeat', 'Repetir todas las etiquetas de elementos', 'repeatLabels'],
    ['calc.pivot.blank', 'Línea en blanco después de cada elemento', 'blankRowAfterItem'],
  ];
  for (const [id, label, key] of pToggles) add({ id, label, icon: 'pivot', enabled: () => !!pivot(), checked: () => !!pivot()?.[key], run: () => pivot() && alertErr(x.updatePivot(pivot()!.id, label, (p) => void (p[key] = !p[key]))) });
  for (const name of PIVOT_STYLE_NAMES) {
    add({ id: `calc.pivot.style.${name}`, label: name.replace('PivotStyle', '').replace(/(\D+)(\d+)/, '$1 $2'), icon: 'pivot', enabled: () => !!pivot(), checked: () => pivot()?.style === name, run: () => pivot() && alertErr(x.updatePivot(pivot()!.id, 'Estilo de tabla dinámica', (p) => void (p.style = name))) });
  }

  // ---- slicers
  add({ id: 'calc.slicer', label: 'Segmentación', icon: 'slicer', description: 'Botones para filtrar una tabla o una tabla dinámica.', enabled: () => !editing() && slicerSource(ui) !== null, run: () => ui.openDialog('slicer') });
  const slicer = () => d.sheet.slicers.find((s) => s.id === x.selectedSlicer);
  add({ id: 'calc.slicer.clear', label: 'Borrar filtro', icon: 'eraser', enabled: () => !!slicer() && slicer()!.selected !== null, run: () => slicer() && x.setSlicer(slicer()!.id, null) });
  add({ id: 'calc.slicer.delete', label: 'Eliminar segmentación', icon: 'trash', enabled: () => !!slicer(), run: () => slicer() && x.deleteSlicer(slicer()!.id) });
  add({ id: 'calc.slicer.columns', label: 'Columnas del botón…', icon: 'columns', enabled: () => !!slicer(), run: () => {
    const s = slicer();
    if (!s) return;
    const n = Number(window.prompt('Número de columnas de botones:', String(s.columns)));
    if (Number.isFinite(n) && n >= 1 && n <= 8) x.updateSlicer(s.id, { columns: Math.round(n) }, 'Columnas de la segmentación');
  } });
  add({ id: 'calc.slicer.caption', label: 'Título…', icon: 'note', enabled: () => !!slicer(), run: () => {
    const s = slicer();
    const c = s ? window.prompt('Título de la segmentación:', s.caption) : null;
    if (s && c !== null && c.trim()) x.updateSlicer(s.id, { caption: c.trim() }, 'Título de la segmentación');
  } });

  // ---- page layout and printing
  const page = () => d.sheet.print.page;
  add({ id: 'calc.page.setup', label: 'Configurar página…', icon: 'tableProps', run: () => ui.openDialog('pageSetup') });
  add({ id: 'calc.print', label: 'Imprimir / guardar como PDF…', icon: 'print', shortcut: 'Ctrl+P', description: 'Muestra la vista previa con las páginas tal como saldrán.', run: () => ui.openDialog('printPreview') });
  add({ id: 'calc.page.areaSet', label: 'Establecer área de impresión', icon: 'print', enabled: () => !editing(), run: () => x.setPrintArea(false) });
  add({ id: 'calc.page.areaAdd', label: 'Agregar al área de impresión', icon: 'print', enabled: () => !editing(), run: () => x.setPrintArea(true) });
  add({ id: 'calc.page.areaClear', label: 'Borrar área de impresión', icon: 'eraser', enabled: () => d.sheet.print.areas.length > 0, run: () => x.clearPrintArea() });
  add({ id: 'calc.page.portrait', label: 'Vertical', icon: 'print', checked: () => page().orientation === 'portrait', run: () => x.setPage({ orientation: 'portrait' }, 'Orientación') });
  add({ id: 'calc.page.landscape', label: 'Horizontal', icon: 'print', checked: () => page().orientation === 'landscape', run: () => x.setPage({ orientation: 'landscape' }, 'Orientación') });
  for (const paper of ['A4', 'A3', 'A5', 'Letter', 'Legal'] as PageSetup['paper'][]) add({ id: `calc.page.paper.${paper}`, label: paper, icon: 'print', checked: () => page().paper === paper, run: () => x.setPage({ paper }, 'Tamaño del papel') });
  const margins: [string, string, PageSetup['margins']][] = [
    ['normal', 'Normal', { top: 1.9, bottom: 1.9, left: 1.8, right: 1.8 }],
    ['wide', 'Ancho', { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 }],
    ['narrow', 'Estrecho', { top: 1.9, bottom: 1.9, left: 0.64, right: 0.64 }],
  ];
  for (const [id, label, m] of margins) add({ id: `calc.page.margins.${id}`, label, icon: 'print', checked: () => JSON.stringify(page().margins) === JSON.stringify(m), run: () => x.setPage({ margins: m }, 'Márgenes') });
  add({ id: 'calc.page.fitWidth', label: 'Ajustar todas las columnas en una página', icon: 'print', checked: () => page().fitWidth === 1 && page().fitHeight === 0, run: () => x.setPage({ fitWidth: 1, fitHeight: 0 }, 'Ajustar a una página de ancho') });
  add({ id: 'calc.page.fitAll', label: 'Ajustar la hoja en una página', icon: 'print', checked: () => page().fitWidth === 1 && page().fitHeight === 1, run: () => x.setPage({ fitWidth: 1, fitHeight: 1 }, 'Ajustar a una página') });
  add({ id: 'calc.page.fitNone', label: 'Tamaño real', icon: 'print', checked: () => page().fitWidth === 0 && page().fitHeight === 0, run: () => x.setPage({ fitWidth: 0, fitHeight: 0, scale: 100 }, 'Tamaño real') });
  add({ id: 'calc.page.gridlines', label: 'Imprimir líneas de cuadrícula', icon: 'gridlines', checked: () => page().gridlines, run: () => x.setPage({ gridlines: !page().gridlines }, 'Líneas de cuadrícula') });
  add({ id: 'calc.page.headings', label: 'Imprimir encabezados', icon: 'gridlines', checked: () => page().headings, run: () => x.setPage({ headings: !page().headings }, 'Encabezados de impresión') });
  add({ id: 'calc.page.break', label: 'Insertar o quitar salto de página', icon: 'print', enabled: () => !editing(), run: () => x.togglePageBreaks() });
  add({ id: 'calc.page.breakClear', label: 'Restablecer saltos de página', icon: 'eraser', enabled: () => d.sheet.print.rowBreaks.length + d.sheet.print.colBreaks.length > 0, run: () => x.clearPageBreaks() });
  add({ id: 'calc.page.titles', label: 'Imprimir títulos…', icon: 'tableProps', run: () => ui.openDialog('pageSetup') });

  // ---- code
  add({ id: 'calc.macros', label: 'Macros…', icon: 'run', shortcut: 'Alt+F8', description: 'Ejecuta una macro (un Sub de Nova Basic) del libro.', run: () => ui.openDialog('macros') });
  add({ id: 'calc.macroEditor', label: 'Editor de código…', icon: 'code', shortcut: 'Alt+F11', description: 'Escribe módulos de Nova Basic: macros y funciones para usar en las celdas.', run: () => ui.openDialog('macroEditor') });
  add({ id: 'calc.macroEnable', label: 'Habilitar contenido', icon: 'run', enabled: () => !d.contentEnabled, description: 'Permite que las macros y funciones del archivo se ejecuten.', run: () => d.enableContent() });

  // ---- charts: one command per kind
  for (const p of CHART_PRESETS) {
    add({
      id: `calc.chart.${p.id}`,
      label: p.label,
      icon: p.icon,
      description: 'Crea un gráfico con los datos seleccionados.',
      run: () => alertErr(d.insertChart(p.id)),
    });
    add({ id: `calc.chartType.${p.id}`, label: p.label, icon: p.icon, checked: () => !!d.chartById(d.selectedChart) && presetOf(d.chartById(d.selectedChart)!) === p.id, enabled: () => !!d.selectedChart, run: () => alertErr(d.convertChart(p.id)) });
  }
  add({ id: 'calc.chartFormat', label: 'Formato del gráfico…', icon: 'settings', enabled: () => !!d.chartById(d.selectedChart), run: () => ui.openDialog('chartFormat') });

  void safeUrl;
  return cmds;
}
