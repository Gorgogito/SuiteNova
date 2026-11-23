import { useEffect } from 'react';

/**
 * Fluent leaves `aria-hidden` on the page when the parent unmounts a dialog that is still open (the page stays invisible to screen readers and
 * to automation). When the dialog goes away this gives the page back, unless another dialog is still open. Same fix as the product dialogs have.
 */
export function useRestorePage(): void {
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
}
