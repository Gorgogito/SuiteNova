import { useSyncExternalStore } from 'react';

/**
 * What the frame needs from a window that has no title bar of its own. The desktop shell provides it; in a browser there is
 * none, and the frame shows no window buttons.
 */
export interface WindowHost {
  minimize(): void;
  /** Maximizes the window, or restores it when it already is. */
  toggleMaximize(): void;
  /** Asks to close: unsaved changes are still asked about. */
  close(): void;
  isMaximized(): Promise<boolean>;
  /** Calls back when the window changes size (maximize, restore, snap). Returns how to stop listening. */
  onResize(callback: () => void): () => void;
  /** Colour painted by the window itself while the page is not drawn yet (opening, resizing). */
  setBackground?(color: string): void;
}

let host: WindowHost | null = null;
const listeners = new Set<() => void>();

export function setWindowHost(next: WindowHost | null): void {
  host = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useWindowHost(): WindowHost | null {
  return useSyncExternalStore(subscribe, () => host);
}
