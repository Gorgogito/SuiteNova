import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * Mientras el cursor está dentro del texto de una forma con WordArt, esa forma lleva `data-editing`: se ve el texto normal para poder
 * editarlo y se oculta el dibujo deformado (que se vuelve a dibujar al salir). Es un atributo de decoración: `ShapeView` no tiene que
 * enterarse de los cambios de selección.
 */
export function wordArtEditingPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const $from = state.selection.$from;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === 'shape' && n.attrs.wordart) {
            const pos = $from.before(d);
            return DecorationSet.create(state.doc, [Decoration.node(pos, pos + n.nodeSize, { 'data-editing': '1' })]);
          }
        }
        return null;
      },
    },
  });
}
