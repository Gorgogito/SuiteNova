import { setCellBorders, setCellShading, setTableOption, setTableStyle, tableStyleInfo } from '@suitenova/writer-core';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { TableHost } from './host';

/**
 * The table controls on a ProseMirror editor (Writer and Notes): they change the style, the options, the shading and the borders of the table
 * under the cursor with the commands of `writer-core`. `insert` is the product's own way to put a new table in.
 */
export function pmTableHost(opts: { view: () => EditorView | null | undefined; useRefresh: () => void; insert: (rows: number, cols: number) => void }): TableHost {
  const exec = (cmd: Command) => {
    const v = opts.view();
    if (!v) return;
    cmd(v.state, v.dispatch, v);
    v.focus();
  };
  return {
    useRefresh: opts.useRefresh,
    info: () => {
      const v = opts.view();
      const i = v ? tableStyleInfo(v.state) : null;
      return i ? { styleId: i.styleId, options: i.options } : null;
    },
    setStyle: (id) => exec(setTableStyle(id)),
    setOption: (name, value) => exec(setTableOption(name, value)),
    setShading: (color) => exec(setCellShading(color)),
    setBorders: (mode, border) => exec(setCellBorders(mode, border)),
    insert: opts.insert,
  };
}
