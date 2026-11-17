import type { CommandDef } from '@suitenova/core-ui';
import { insertStructure, STRUCTURES, SYMBOL_GROUPS, typeText, type EditState } from '@suitenova/math-core';
import { nodeTypes } from '@suitenova/writer-core';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, type EditorState } from 'prosemirror-state';
import '../math/messages';
import type { WriterUI } from './commands';
import { activeMathEditing, startMathEdit } from './nodeviews';

/** La ecuación elegida como objeto, con su posición. */
export function mathTarget(state: EditorState | null | undefined): { pos: number; node: PMNode } | null {
  const s = state?.selection;
  return s instanceof NodeSelection && s.node.type.name === 'math' ? { pos: s.from, node: s.node } : null;
}

/** Las órdenes de la cinta «Ecuación»: una por estructura y una por símbolo. */
export const SYMBOL_COMMANDS = SYMBOL_GROUPS.flatMap((g, gi) => g.items.map((s, i) => ({ id: `writer.math.sym.${gi}.${i}`, ch: s.ch, title: s.title })));

export function mathCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const ready = () => !!c.mainView && !c.readOnly;
  /** Aplica una operación al editor de la ecuación; si solo está elegida, empieza a editarla primero. */
  const withEditor = (fn: (st: EditState) => EditState) => {
    let core = activeMathEditing();
    const t = mathTarget(c.mainState);
    if (!core && t && c.mainView) {
      startMathEdit(c.mainView, t.pos);
      core = activeMathEditing();
    }
    core?.run(fn);
  };
  const usable = () => ready() && (!!activeMathEditing() || !!mathTarget(c.mainState));

  const defs: CommandDef[] = [
    {
      id: 'writer.equation.new',
      label: 'Nueva ecuación',
      icon: 'sigma',
      description: 'Inserta una ecuación en el documento y la edita allí mismo: «/» hace una fracción, «^» y «_» índices, «\\alpha» y espacio una letra griega.',
      enabled: ready,
      run: () => {
        const v = c.mainView;
        if (!v) return;
        const pos = v.state.selection.from;
        v.dispatch(v.state.tr.replaceSelectionWith(nodeTypes.math!.create({ tex: '', display: false }), false));
        if (!startMathEdit(v, pos)) v.focus();
      },
    },
    {
      id: 'writer.equation.editInline',
      label: 'Editar en el documento',
      icon: 'sigma',
      description: 'Edita la ecuación elegida en su sitio (también con Intro o doble clic).',
      enabled: () => ready() && !!mathTarget(c.mainState),
      run: () => {
        const t = mathTarget(c.mainState);
        if (t && c.mainView) startMathEdit(c.mainView, t.pos);
      },
    },
    {
      id: 'writer.equation.display',
      label: 'Ecuación en su propia línea',
      icon: 'sigma',
      description: 'Pone la ecuación centrada en su propia línea (en bloque) o junto al texto (en línea).',
      enabled: () => ready() && !!mathTarget(c.mainState),
      checked: () => !!mathTarget(c.mainState)?.node.attrs.display,
      run: () => {
        const t = mathTarget(c.mainState);
        const v = c.mainView;
        if (!t || !v) return;
        const tr = v.state.tr.setNodeMarkup(t.pos, undefined, { ...t.node.attrs, display: !t.node.attrs.display });
        tr.setSelection(NodeSelection.create(tr.doc, t.pos));
        v.dispatch(tr);
      },
    },
  ];

  for (const d of STRUCTURES) {
    defs.push({ id: `writer.math.struct.${d.id}`, label: d.label, icon: 'sigma', enabled: usable, run: () => withEditor((st) => insertStructure(st, d.id)) });
  }
  for (const s of SYMBOL_COMMANDS) {
    defs.push({ id: s.id, label: s.title ? `${s.ch}  ${s.title}` : s.ch, icon: 'sigma', enabled: usable, run: () => withEditor((st) => typeText(st, s.ch)) });
  }
  return defs;
}
