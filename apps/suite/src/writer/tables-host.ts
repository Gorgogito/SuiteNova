import { ptToPx } from '@suitenova/writer-core';
import { useSyncExternalStore } from 'react';
import { pmTableHost } from '../tables';
import type { WriterUI } from './commands';
import { createTable, insertBlockAfterCursor } from './editing';

/** The shared table controls (style gallery, shading, borders, size picker) on the Writer editor. */
export function writerTableHost(ui: WriterUI) {
  return pmTableHost({
    view: () => ui.ctl.view,
    useRefresh: () => void useSyncExternalStore(ui.ctl.subscribe, ui.ctl.getVersion),
    insert: (rows, cols) => {
      const v = ui.ctl.view;
      if (!v) return;
      const width = ptToPx(ui.ctl.page.width - ui.ctl.page.marginLeft - ui.ctl.page.marginRight);
      insertBlockAfterCursor(createTable(rows, cols, width))(v.state, v.dispatch);
      v.focus();
    },
  });
}
