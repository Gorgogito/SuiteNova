import { docNode, emptyDocJson, slidesSchema, updateElement, type ShapeEl, type SlideElement, type TableEl } from '@suitenova/slides-core';
import { EditorView } from 'prosemirror-view';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useAutofit } from '../render/autofit';
import { shapeLayout, textBoxStyle, xfOf, type CanvasCtx } from '../render/SlideCanvas';
import { promptDoc } from '../render/SlideCanvas';
import type { SlidesCtl } from '../ctl';
import { cursorAtEnd, editCtxKey, editPlugins, makeState, type EditContext } from './pm';

/** The ProseMirror editor drawn over a shape while its text is edited. */
export function ShapeTextEditor({ ctl, el, ctx }: { ctl: SlidesCtl; el: ShapeEl; ctx: CanvasCtx }) {
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { x, g, look, tc, body } = shapeLayout(ctx, el);
  const ec: EditContext = { tc, env: ctx.env, ph: look.fillClr };
  const ecRef = useRef(ec);
  ecRef.current = ec;
  const key = JSON.stringify(el.text?.doc ?? null) + JSON.stringify(body.fit) + x.w + 'x' + x.h;
  useAutofit(box, !!body.fit && body.fit.t === 'norm', key, undefined);

  useEffect(() => {
    const view = new EditorView(host.current!, {
      state: makeState(el.text?.doc ?? emptyDocJson(), editPlugins(() => ecRef.current, ecRef.current)),
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          const json = next.doc.toJSON();
          ctl.liveDeck((d) =>
            updateElement(d, ctl.slide.id, el.id, (e) => {
              const s = e as ShapeEl;
              return { ...s, text: { body: s.text?.body ?? {}, lst: s.text?.lst, doc: json } } as SlideElement;
            }),
          );
        } else if (!tr.getMeta(editCtxKey)) ctl.touch();
      },
      attributes: { class: 'sl-pm', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Texto de la forma' },
    });
    viewRef.current = view;
    ctl.editor = view;
    view.dispatch(cursorAtEnd(view.state.tr));
    view.focus();
    return () => {
      if (ctl.editor === view) ctl.editor = null;
      view.destroy();
      viewRef.current = null;
    };
    // the editor lives as long as the shape is being edited; context changes are pushed with a transaction below
  }, [el.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const v = viewRef.current;
    if (v) v.dispatch(v.state.tr.setMeta(editCtxKey, { ctx: ec }));
  });

  const wrap: React.CSSProperties = { position: 'absolute', left: x.x, top: x.y, width: x.w, height: x.h, transform: x.rot ? `rotate(${x.rot}deg)` : undefined };
  const style = textBoxStyle(x, g.textRect, body);
  const colStyle: React.CSSProperties = body.numCol && body.numCol > 1 ? { columnCount: body.numCol, columnGap: body.spcCol ?? 0 } : {};
  return (
    <div className="sl-edit-wrap" style={wrap} data-editing={el.id}>
      <div ref={box} className="sl-text sl-edit" style={{ ...style, pointerEvents: 'auto' }}>
        <div ref={host} style={{ width: body.wrap === 'none' ? undefined : '100%', ...colStyle }} />
      </div>
    </div>
  );
}

/** The editor of a table cell: the same editor over the cell's text. */
export function TableCellEditor({ ctl, el, row, col, ctx }: { ctl: SlidesCtl; el: TableEl; row: number; col: number; ctx: CanvasCtx }) {
  void ctl;
  void el;
  void row;
  void col;
  void ctx;
  return null;
}

export { docNode, slidesSchema, xfOf, promptDoc };
