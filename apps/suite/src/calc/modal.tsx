import { Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import type { ReactNode } from 'react';

/** Dialogs restore focus to their trigger when they close; take it back once that has happened. */
export function focusGridSoon() {
  setTimeout(() => window.dispatchEvent(new Event('nova:focus-grid')), 80);
}

export function Modal({ title, onClose, children, actions, width = 480 }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode; width?: number }) {
  return (
    <Dialog open modalType="modal" onOpenChange={(_e, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: width, width: '92vw' }}>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{children}</DialogContent>
          <DialogActions>{actions}</DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

export const field: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 10 };
export const row2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
