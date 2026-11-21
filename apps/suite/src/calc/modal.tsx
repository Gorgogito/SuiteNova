import { Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { useEffect, type ReactNode } from 'react';

/** Dialogs restore focus to their trigger when they close; take it back once that has happened. */
export function focusGridSoon() {
  setTimeout(() => window.dispatchEvent(new Event('nova:focus-grid')), 80);
}

export function Modal({ title, onClose, children, actions, width = 480 }: { title: string; onClose: () => void; children: ReactNode; actions: ReactNode; width?: number }) {
  // Fluent hides the rest of the page from assistive technology while a modal is open and restores it when the dialog finishes closing. When a
  // dialog is unmounted by its parent while open (or another opens right after), the page, or this very dialog, can be left hidden: give the
  // dialogs that are open back their visibility and, once none is left, the page. Looks a little later too because Fluent restores after its own cleanup.
  useEffect(() => {
    const fix = () => {
      const open = [...document.querySelectorAll('[role=dialog]')];
      for (const d of open) for (let e: Element | null = d; e; e = e.parentElement) if (e.getAttribute('aria-hidden') === 'true') e.removeAttribute('aria-hidden');
      if (open.length) return;
      for (const el of document.querySelectorAll('body > [aria-hidden=true], #root[aria-hidden=true]')) el.removeAttribute('aria-hidden');
      document.querySelectorAll('body > [inert]').forEach((el) => el.removeAttribute('inert'));
    };
    const ids = [0, 150, 600].map((ms) => setTimeout(fix, ms));
    // Fluent can hide this dialog later too (when another one that was unmounted open finishes "closing"): keep it visible while it is open
    const watch = new MutationObserver(() => {
      for (const d of document.querySelectorAll('[role=dialog]')) for (let e: Element | null = d; e; e = e.parentElement) if (e.getAttribute('aria-hidden') === 'true') e.removeAttribute('aria-hidden');
    });
    watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-hidden'] });
    return () => {
      watch.disconnect();
      ids.forEach(clearTimeout);
      for (const ms of [0, 120, 500]) setTimeout(fix, ms);
    };
  }, []);
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
