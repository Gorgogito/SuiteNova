import type { CommandDef } from '@suitenova/core-ui';
import { LAYOUT_CATALOG } from '@suitenova/smartart-core';
import { docToDiagramText, newSmartArtGroup, parseDiagramText, updateSlide, type BodyProps, type CaseMode, type ShapeEl, type SlideElement } from '@suitenova/slides-core';
import type { SlidesUI } from './commands';
import { applyCase, applyPara, applyRun, canFormatText } from './textcmds';

/** Text tools of the Home tab that PowerPoint has next to the paragraph: spacing, direction, vertical alignment, autofit, case, SmartArt. */
export function textCommands2(ui: SlidesUI): CommandDef[] {
  const c = ui.ctl;
  const text = () => canFormatText(c);
  const shapesSel = () => (c.editing ? [c.element(c.editing)] : c.selected).filter((e): e is ShapeEl => !!e && e.kind === 'shape');
  const hasShape = () => shapesSel().length > 0;
  const body = (): BodyProps => shapesSel()[0]?.text?.body ?? {};
  const patchBody = (p: Partial<BodyProps>) =>
    c.patch(
      shapesSel().map((e) => e.id),
      'Opciones de texto',
      (q) => (q.kind === 'shape' ? ({ ...q, text: { body: { ...q.text?.body, ...p }, lst: q.text?.lst, doc: q.text?.doc ?? { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} } }] } } } as ShapeEl) : q),
    );
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);

  // line spacing
  const sp = (): number => {
    const l = ui.paraProps().lnSpc;
    return l && 'pct' in l ? l.pct / 100000 : 1;
  };
  for (const [id, v, label] of [['10', 1, '1,0'], ['15', 1.5, '1,5'], ['20', 2, '2,0'], ['25', 2.5, '2,5'], ['30', 3, '3,0']] as const)
    add({ id: `slides.lineSp.${id}`, label, icon: 'lineSpacing', enabled: text, checked: () => Math.abs(sp() - v) < 0.001, run: () => applyPara(c, (p) => ({ p: { ...p, lnSpc: { pct: Math.round(v * 100000) } } }), 'Interlineado') });
  add({ id: 'slides.lineSp.options', label: 'Opciones de interlineado…', icon: 'lineSpacing', enabled: text, run: () => ui.openDialog('paragraphDialog') });

  // text direction, vertical alignment and autofit (of the shape's text box)
  for (const [id, v, label] of [['horz', undefined, 'Horizontal'], ['vert', 'vert', 'Girar todo el texto 90°'], ['vert270', 'vert270', 'Girar todo el texto 270°'], ['eaVert', 'eaVert', 'Apilado']] as const)
    add({ id: `slides.dir.${id}`, label, icon: 'textDirection', enabled: hasShape, checked: () => (body().vert ?? 'horz') === (v ?? 'horz'), run: () => patchBody({ vert: v }) });
  for (const [id, v, label, icon] of [['t', 't', 'Superior', 'anchorTop'], ['ctr', 'ctr', 'Medio', 'anchorMiddle'], ['b', 'b', 'Inferior', 'anchorBottom']] as const)
    add({ id: `slides.anchor.${id}`, label, icon, enabled: hasShape, checked: () => (body().anchor ?? 't') === v, run: () => patchBody({ anchor: v }) });
  for (const [id, label, fit] of [
    ['none', 'No ajustar automáticamente', { t: 'none' }],
    ['norm', 'Reducir texto al desbordar', { t: 'norm' }],
    ['shape', 'Cambiar el tamaño de la forma para ajustarla al texto', { t: 'shape' }],
  ] as const)
    add({ id: `slides.autofit.${id}`, label, icon: 'autofit', enabled: hasShape, checked: () => (body().fit?.t ?? 'none') === id, run: () => patchBody({ fit: fit as BodyProps['fit'] }) });

  // character spacing
  for (const [id, v, label] of [['vtight', -3, 'Muy estrecho'], ['tight', -1.5, 'Estrecho'], ['normal', 0, 'Normal'], ['loose', 3, 'Holgado'], ['vloose', 6, 'Muy holgado']] as const)
    add({ id: `slides.charSp.${id}`, label, icon: 'charSpacing', enabled: text, checked: () => (ui.runProps().spc ?? 0) === v, run: () => applyRun(c, (r) => ({ ...r, spc: v || undefined }), 'Espaciado entre caracteres') });
  add({ id: 'slides.charSp.options', label: 'Más espaciado…', icon: 'charSpacing', enabled: text, run: () => ui.openDialog('fontDialog') });

  // change case
  for (const [mode, label] of [['sentence', 'Tipo oración'], ['lower', 'minúsculas'], ['upper', 'MAYÚSCULAS'], ['title', 'Poner en mayúscula cada palabra'], ['toggle', 'aLTERNAR mayús/minús']] as [CaseMode, string][])
    add({ id: `slides.case.${mode}`, label, icon: 'changeCase', enabled: text, run: () => applyCase(c, mode) });

  // symbol and fields (they go where the cursor is)
  const editing = () => !!c.editor;
  add({ id: 'slides.insert.symbol', label: 'Símbolo…', icon: 'omega', description: 'Inserta un símbolo o carácter especial donde está el cursor.', enabled: editing, run: () => ui.openDialog('symbol') });
  const field = (ftype: string, text: string) => {
    const v = c.editor;
    if (!v) return;
    v.dispatch(v.state.tr.replaceSelectionWith(v.state.schema.nodes.field!.create({ ftype, text, r: {} }), false));
    v.focus();
  };
  add({ id: 'slides.insert.dateShort', label: 'Fecha y hora: corta (se actualiza)', icon: 'calendar', description: 'Inserta la fecha de hoy; se actualiza cada vez que se abre la presentación.', enabled: editing, run: () => field('datetime1', new Date().toLocaleDateString()) });
  add({ id: 'slides.insert.dateLong', label: 'Fecha y hora: larga (se actualiza)', icon: 'calendar', enabled: editing, run: () => field('datetime4', new Date().toLocaleDateString(undefined, { dateStyle: 'long' })) });
  add({ id: 'slides.insert.slideNumber', label: 'Insertar el n.º de diapositiva', icon: 'hash', description: 'Inserta el número de la diapositiva donde está el cursor.', enabled: editing, run: () => field('slidenum', '‹#›') });

  // text to SmartArt
  const convertible = () => {
    const e = c.selected;
    return e.length === 1 && e[0]!.kind === 'shape' && !!e[0]!.text && parseDiagramText(docToDiagramText(e[0]!.text.doc)).length > 0 && !(e[0] as ShapeEl).ph;
  };
  for (const l of LAYOUT_CATALOG)
    add({
      id: `slides.toSmartArt.${l.id.split('/').pop()}`,
      label: l.name,
      icon: 'smartart',
      description: l.description,
      enabled: convertible,
      run: () => {
        const el = c.selected[0] as ShapeEl;
        const x = c.xfrmOf(el);
        const text = docToDiagramText(el.text!.doc);
        const g = newSmartArtGroup({ layout: l.id, text }, { x: x.x, y: x.y, w: x.w, h: x.h });
        c.apply('Convertir en SmartArt', (d) => updateSlide(d, c.slide.id, (s) => ({ ...s, shapes: s.shapes.map((e): SlideElement => (e.id === el.id ? g : e)) })), { selection: [g.id] });
      },
    });
  add({ id: 'slides.fonts.replace', label: 'Reemplazar fuentes…', icon: 'type', description: 'Cambia una fuente de toda la presentación por otra.', run: () => ui.openDialog('replaceFonts') });
  return defs;
}
