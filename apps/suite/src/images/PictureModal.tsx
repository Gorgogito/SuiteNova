import { Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { useEffect, type ReactNode } from 'react';
import './images.css';
import './messages';

/** The frame of the picture dialogs (with the page given back when it closes, as the other dialogs do). */
export function PictureModal({ title, onClose, children, actions, width = 560 }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode; width?: number }) {
  useEffect(
    () => () => {
      setTimeout(() => {
        if (document.querySelector('[role=dialog]')) return;
        for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
        document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
      }, 0);
    },
    [],
  );
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
