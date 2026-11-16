import type { CommandDef } from '@suitenova/core-ui';
import { nodeTypes } from '@suitenova/writer-core';
import { wordArtStyle } from '@suitenova/wordart-core';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, type EditorState } from 'prosemirror-state';
import type { WordArtValue } from '../wordart/WordArtUi';
import type { WriterUI } from './commands';

/** La forma de texto sobre la que actúan los comandos: elegida como objeto, o con el cursor dentro de su texto. */
export function wordArtTarget(state: EditorState | null | undefined): { pos: number; node: PMNode } | null {
  if (!state) return null;
  const s = state.selection;
  if (s instanceof NodeSelection && s.node.type.name === 'shape') return { pos: s.from, node: s.node };
  const $f = s.$from;
  for (let d = $f.depth; d > 0; d--) {
    const n = $f.node(d);
    if (n.type.name === 'shape') return { pos: $f.before(d), node: n };
  }
  return null;
}

const clone = <T>(x: T): T => structuredClone(x);

/** Pone (o quita, con `null`) el WordArt de una forma. Si estaba elegida como objeto, sigue elegida. */
export function setWordArt(ui: WriterUI, pos: number, next: WordArtValue | null): void {
  const v = ui.ctl.mainView;
  const node = v?.state.doc.nodeAt(pos);
  if (!v || !node || node.type.name !== 'shape') return;
  const wasNode = v.state.selection instanceof NodeSelection;
  const tr = v.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, wordart: next }).setMeta('nw-no-track', true);
  if (wasNode) tr.setSelection(NodeSelection.create(tr.doc, pos));
  v.dispatch(tr);
  v.focus();
}

/** Aplica un estilo de la galería a la forma de texto elegida (conserva su transformación). */
export function applyWordArtStyle(ui: WriterUI, styleId: string): void {
  const t = wordArtTarget(ui.ctl.mainState);
  if (!t) return;
  const cur = t.node.attrs.wordart as WordArtValue | null;
  setWordArt(ui, t.pos, { fx: clone(wordArtStyle(styleId).fx), warp: cur?.warp ?? null });
}

/** Aplica (o quita, con `null`) la transformación de texto; si la forma no tenía WordArt, empieza con texto negro liso. */
export function applyWordArtWarp(ui: WriterUI, prst: string | null): void {
  const t = wordArtTarget(ui.ctl.mainState);
  if (!t) return;
  const cur = t.node.attrs.wordart as WordArtValue | null;
  setWordArt(ui, t.pos, { fx: cur?.fx ?? clone(wordArtStyle('tx1').fx), warp: prst ? { prst } : null });
}

/** Inserta un cuadro de WordArt con el estilo dado en la posición del cursor. */
export function insertWordArt(ui: WriterUI, styleId: string): void {
  const v = ui.ctl.mainView;
  if (!v) return;
  const marks = v.state.schema.marks;
  const text = v.state.schema.text('Su texto aquí', [marks.fontSize!.create({ value: 48 }), marks.strong!.create()]);
  const par = nodeTypes.paragraph!.create({ align: 'center' }, text);
  const node = nodeTypes.shape!.create(
    { kind: 'textbox', width: 440, height: 120, fill: '#ffffff', stroke: '#000000', strokeWidth: 0, wrap: 'inline', id: `wordart-${Date.now().toString(36)}`, wordart: { fx: clone(wordArtStyle(styleId).fx), warp: null } },
    [par],
  );
  const from = v.state.selection.from;
  const tr = v.state.tr.replaceSelectionWith(node, false);
  tr.setSelection(NodeSelection.create(tr.doc, from)).setMeta('nw-no-track', true);
  v.dispatch(tr);
  v.focus();
}

export function wordArtCommands(ui: WriterUI): CommandDef[] {
  const c = ui.ctl;
  const ready = () => !!c.mainView && !c.readOnly;
  const target = () => wordArtTarget(c.mainState);
  return [
    { id: 'writer.wordart.format', label: 'Formato de WordArt…', icon: 'wordart', description: 'Cambia el relleno, el contorno, la sombra, el resplandor, el reflejo y la transformación del texto de la forma.', enabled: () => ready() && !!target(), run: () => { const t = target(); if (t) ui.openDialog('wordart', { pos: t.pos }); } },
    { id: 'writer.wordart.clear', label: 'Quitar WordArt', icon: 'close', description: 'Devuelve el texto de la forma a su aspecto normal.', enabled: () => ready() && !!target()?.node.attrs.wordart, run: () => { const t = target(); if (t) setWordArt(ui, t.pos, null); } },
  ];
}
