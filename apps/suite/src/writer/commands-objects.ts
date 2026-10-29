import type { CommandDef } from '@suitenova/core-ui';
import { nodeTypes } from '@suitenova/writer-core';
import { NodeSelection } from 'prosemirror-state';
import type { WriterUI } from './commands';
import { EQUATION_SAMPLES } from './dlg-objects';
import { newControl, type ControlType } from './forms';

export const SHAPE_KINDS: { id: string; label: string }[] = [
  { id: 'rect', label: 'Rectángulo' },
  { id: 'roundRect', label: 'Rectángulo redondeado' },
  { id: 'ellipse', label: 'Elipse' },
  { id: 'triangle', label: 'Triángulo' },
  { id: 'rightTriangle', label: 'Triángulo rectángulo' },
  { id: 'diamond', label: 'Rombo' },
  { id: 'pentagon', label: 'Pentágono' },
  { id: 'hexagon', label: 'Hexágono' },
  { id: 'star5', label: 'Estrella' },
  { id: 'rightArrow', label: 'Flecha derecha' },
  { id: 'leftArrow', label: 'Flecha izquierda' },
  { id: 'upArrow', label: 'Flecha arriba' },
  { id: 'downArrow', label: 'Flecha abajo' },
  { id: 'line', label: 'Línea' },
  { id: 'callout', label: 'Llamada' },
  { id: 'cloud', label: 'Nube' },
  { id: 'heart', label: 'Corazón' },
];

export const CONTROL_KINDS: { type: ControlType; label: string; description: string }[] = [
  { type: 'text', label: 'Control de texto', description: 'Un espacio para escribir texto sin formato.' },
  { type: 'richText', label: 'Control de texto enriquecido', description: 'Un espacio para escribir texto con formato.' },
  { type: 'checkbox', label: 'Casilla de verificación', description: 'Una casilla que se marca y desmarca con un clic.' },
  { type: 'dropdown', label: 'Lista desplegable', description: 'Permite elegir un elemento de una lista fija.' },
  { type: 'combo', label: 'Cuadro combinado', description: 'Permite elegir un elemento de una lista o escribir otro.' },
  { type: 'date', label: 'Selector de fecha', description: 'Permite elegir una fecha en un calendario.' },
];

/** Equations, shapes and content controls. */
export function objectCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const defs: CommandDef[] = [];
  const add = (d: CommandDef) => defs.push(d);
  const ready = () => !!c.mainView && !c.readOnly;
  const selectedShape = (): { pos: number } | null => {
    const s = c.mainState?.selection;
    return s instanceof NodeSelection && s.node.type.name === 'shape' ? { pos: s.from } : null;
  };
  const selectedControl = (): { pos: number } | null => {
    const st = c.mainState;
    if (!st) return null;
    const { $from } = st.selection;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'content_control' || n.type.name === 'content_control_block') return { pos: $from.before(d) };
    }
    const s = st.selection;
    if (s instanceof NodeSelection && s.node.type.name === 'content_control') return { pos: s.from };
    // inline nodes are not in $from's ancestors: look at the node right around the caret
    const after = $from.nodeAfter;
    if (after?.type.name === 'content_control' && st.selection.empty) return { pos: $from.pos };
    return null;
  };

  // ---- equations
  add({ id: 'writer.equation.insert', label: 'Ecuación…', icon: 'sigma', description: 'Escribe una ecuación con símbolos, fracciones, raíces, sumatorias y matrices.', enabled: ready, run: () => ui.openDialog('equation', {}) });
  add({
    id: 'writer.equation.edit',
    label: 'Editar ecuación…',
    icon: 'sigma',
    enabled: () => {
      const s = c.mainState?.selection;
      return ready() && s instanceof NodeSelection && s.node.type.name === 'math';
    },
    run: () => {
      const s = c.mainState?.selection;
      if (s instanceof NodeSelection) ui.openDialog('equation', { pos: s.from });
    },
  });
  EQUATION_SAMPLES.forEach((s, i) =>
    add({
      id: `writer.equation.sample.${i}`,
      label: s.label,
      icon: 'sigma',
      enabled: ready,
      run: () => {
        const v = c.mainView;
        if (v) v.dispatch(v.state.tr.replaceSelectionWith(nodeTypes.math!.create({ tex: s.tex, display: false }), false).scrollIntoView());
        v?.focus();
      },
    }),
  );

  // ---- shapes
  const insertShape = (kind: string) => {
    const v = c.mainView;
    if (!v) return;
    const text = kind === 'textbox';
    const line = kind === 'line';
    const node = nodeTypes.shape!.create(
      {
        kind,
        width: text ? 200 : line ? 140 : 120,
        height: text ? 80 : line ? 40 : 90,
        fill: text ? '#ffffff' : '#bcd4f0',
        stroke: line ? '#2b6cb0' : text ? '#000000' : '#2b6cb0',
        strokeWidth: line ? 2 : 1,
        id: `shape-${Date.now().toString(36)}`,
      },
      text ? [nodeTypes.paragraph!.create()] : undefined,
    );
    v.dispatch(v.state.tr.replaceSelectionWith(node, false).scrollIntoView());
    v.focus();
  };
  add({ id: 'writer.shape.textbox', label: 'Cuadro de texto', icon: 'textbox', description: 'Dibuja un cuadro donde se puede escribir texto.', enabled: ready, run: () => insertShape('textbox') });
  for (const s of SHAPE_KINDS) add({ id: `writer.shape.${s.id}`, label: s.label, icon: 'shapes', enabled: ready, run: () => insertShape(s.id) });
  add({ id: 'writer.shape.format', label: 'Formato de forma…', icon: 'settings', enabled: () => ready() && !!selectedShape(), run: () => { const s = selectedShape(); if (s) ui.openDialog('shape', s); } });
  const wrapCmd = (id: string, label: string, wrap: string) =>
    add({
      id: `writer.shape.wrap.${id}`,
      label,
      icon: 'picture',
      enabled: () => ready() && !!selectedShape(),
      checked: () => {
        const s = selectedShape();
        return !!s && c.mainState!.doc.nodeAt(s.pos)?.attrs.wrap === wrap;
      },
      run: () => {
        const s = selectedShape();
        const v = c.mainView;
        if (s && v) v.dispatch(v.state.tr.setNodeMarkup(s.pos, undefined, { ...v.state.doc.nodeAt(s.pos)!.attrs, wrap }).setMeta('nw-no-track', true));
      },
    });
  wrapCmd('inline', 'En línea con el texto', 'inline');
  wrapCmd('left', 'Cuadrado, a la izquierda', 'left');
  wrapCmd('right', 'Cuadrado, a la derecha', 'right');
  wrapCmd('topBottom', 'Arriba y abajo', 'topBottom');
  wrapCmd('front', 'Delante del texto', 'front');
  wrapCmd('behind', 'Detrás del texto', 'behind');

  // ---- content controls
  for (const k of CONTROL_KINDS) {
    add({
      id: `writer.control.${k.type}`,
      label: k.label,
      icon: k.type === 'checkbox' ? 'checkbox' : k.type === 'date' ? 'calendarDay' : 'formInput',
      description: k.description,
      enabled: ready,
      run: () => {
        const v = c.mainView;
        if (!v) return;
        const id = `cc-${Date.now().toString(36)}`;
        const sel = v.state.selection;
        const selected = !sel.empty && (k.type === 'text' || k.type === 'richText') ? v.state.doc.textBetween(sel.from, sel.to, ' ') : '';
        const node = newControl(k.type, { id });
        const tr = v.state.tr;
        // a control never nests in another one: inside one, the new control goes right after it
        const $f = sel.$from;
        let outer = -1;
        for (let d = $f.depth; d > 0; d--) if ($f.node(d).type.name === 'content_control') outer = d;
        if (outer > 0) tr.insert($f.after(outer), node);
        else tr.replaceSelectionWith(node, false);
        if (selected && outer < 0) {
          // wrap the selected text: replace the placeholder with it
          const pos = tr.selection.from - node.nodeSize;
          tr.replaceWith(pos + 1, pos + 1 + node.content.size, v.state.schema.text(selected));
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, showing: false });
        }
        v.dispatch(tr.setMeta('nw-allow', true).scrollIntoView());
        v.focus();
      },
    });
  }
  add({ id: 'writer.control.properties', label: 'Propiedades del control…', icon: 'settings', enabled: () => ready() && !!selectedControl(), run: () => { const s = selectedControl(); if (s) ui.openDialog('control', s); } });
  add({
    id: 'writer.control.remove',
    label: 'Quitar control de contenido',
    icon: 'trash',
    description: 'Elimina el control y conserva su contenido.',
    enabled: () => ready() && !!selectedControl(),
    run: () => {
      const s = selectedControl();
      const v = c.mainView;
      if (!s || !v) return;
      const n = v.state.doc.nodeAt(s.pos)!;
      v.dispatch(v.state.tr.replaceWith(s.pos, s.pos + n.nodeSize, n.content).setMeta('nw-allow', true));
    },
  });
  return defs;
}
