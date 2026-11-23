import { useSyncExternalStore } from 'react';
import { pmTableHost } from '../tables';
import type { NotesUI } from './commands';
import { createTable, insertBlockAfterCursor } from './editing';

/** The shared table controls (style gallery, shading, borders, size picker) on the editor of a Notes text box. */
export function notesTableHost(ui: NotesUI) {
  return pmTableHost({
    view: () => ui.ctl.view,
    useRefresh: () => void useSyncExternalStore(ui.ctl.subscribe, ui.ctl.getVersion),
    insert: (rows, cols) => {
      const ctl = ui.ctl;
      ctl.run(insertBlockAfterCursor(createTable(rows, cols, Math.max(160, (ctl.page.containers.find((c) => c.id === ctl.activeId)?.w ?? 560) - 16))));
    },
  });
}
