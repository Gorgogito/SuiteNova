import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { CommandRegistry } from './commands';
import type { KeytipState } from './keytips';

export interface CoreContextValue {
  registry: CommandRegistry;
  keytips: KeytipState;
  /** Tip text for an element, or undefined when keytips are not showing it. */
  tipFor: (itemId: string) => string | undefined;
}

const CoreContext = createContext<CoreContextValue | null>(null);

export function CoreProvider({ value, children }: { value: CoreContextValue; children: ReactNode }) {
  return <CoreContext.Provider value={value}>{children}</CoreContext.Provider>;
}

export function useCore(): CoreContextValue {
  const ctx = useContext(CoreContext);
  if (!ctx) throw new Error('useCore must be used inside <AppFrame>');
  return ctx;
}

/** Subscribe to the registry so enabled/checked state re-renders. */
export function useCommandState(commandId: string) {
  const { registry } = useCore();
  useSyncExternalStore(registry.subscribe, registry.getVersion);
  return {
    def: registry.get(commandId),
    enabled: registry.isEnabled(commandId),
    checked: registry.isChecked(commandId),
    shortcut: registry.shortcutLabel(commandId),
  };
}
