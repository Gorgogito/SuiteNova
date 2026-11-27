import { Dialog, DialogBody, DialogSurface } from '@fluentui/react-components';
import { useRef, type ReactNode } from 'react';

/**
 * A modal dialog that is never unmounted while it is open or closing.
 *
 * Fluent hides the rest of the page from assistive technology while a modal is open and restores it when the dialog
 * finishes closing. If the dialog is removed from the tree during that exit (for example because the component that
 * owned it is re-rendered with another key), the restoration never runs and the page stays hidden. Keeping the dialog
 * mounted at a stable place and only toggling `open` avoids it. The last content is kept while the dialog is closing.
 */
export function StickyDialog({ open, onClose, width = 520, forget = false, children }: { open: boolean; onClose: () => void; width?: number; /** The content has moved elsewhere: none is kept while closing. */ forget?: boolean; children: ReactNode }) {
  const last = useRef<ReactNode>(null);
  if (open) last.current = children;
  else if (forget) last.current = null;
  return (
    <Dialog open={open} modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width, width: '92vw' }}>
        <DialogBody>{open ? children : last.current}</DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
