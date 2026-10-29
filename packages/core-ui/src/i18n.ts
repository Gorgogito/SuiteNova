import { useSyncExternalStore } from 'react';

export type Locale = 'es' | 'en';
type Messages = Record<string, string>;

const dictionaries: Record<Locale, Messages> = { es: {}, en: {} };
let current: Locale = 'es';
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  listeners.forEach((l) => l());
}

export function registerMessages(locale: Locale, messages: Messages): void {
  Object.assign(dictionaries[locale], messages);
  notify();
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  notify();
}

export function getLocale(): Locale {
  return current;
}

/** Translate a key. Unknown keys are returned as-is, so literals work as fallback. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let text = dictionaries[current][key] ?? dictionaries.es[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Re-render on locale or dictionary changes. */
export function useLocale(): Locale {
  useSyncExternalStore(subscribe, () => version);
  return current;
}
