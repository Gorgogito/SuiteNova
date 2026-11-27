/**
 * Asks before a window with unsaved changes is closed, however it is closed (title bar, Alt+F4, File › Close, reloading in
 * the browser). One question, in one place. A program may have something more to ask first (`question`): what stops
 * happening when it is closed.
 */
import { t } from '@suitenova/core-ui';
import { useEffect, useRef } from 'react';
import { isTauri } from './platform';

export function useCloseGuard(hasChanges: () => boolean, question?: () => string | null): void {
  const latest = useRef(hasChanges);
  latest.current = hasChanges;
  const asks = useRef(question);
  asks.current = question;

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      const pending = !!asks.current?.();
      if (latest.current() || pending) e.preventDefault();
    };
    window.addEventListener('beforeunload', before);
    let unlisten: (() => void) | undefined;
    let stopped = false;
    if (isTauri()) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        const off = await getCurrentWindow().onCloseRequested((e) => {
          const pending = asks.current?.();
          if (pending && !window.confirm(pending)) return e.preventDefault();
          if (latest.current() && !window.confirm(t('Hay cambios sin guardar. ¿Cerrar y descartarlos?'))) e.preventDefault();
        });
        if (stopped) off();
        else unlisten = off;
      });
    }
    return () => {
      stopped = true;
      window.removeEventListener('beforeunload', before);
      unlisten?.();
    };
  }, []);
}
