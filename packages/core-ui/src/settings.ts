import { useSyncExternalStore } from 'react';

export interface KeyValueBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Small persisted settings store shared by every module. Backend is injectable for tests. */
export class SettingsStore {
  private cache = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private backend: KeyValueBackend | null,
    private prefix = 'suitenova.',
  ) {}

  get<T>(key: string, fallback: T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    let value = fallback;
    try {
      const raw = this.backend?.getItem(this.prefix + key);
      if (raw != null) value = JSON.parse(raw) as T;
    } catch {
      /* corrupt or unavailable storage: use fallback */
    }
    this.cache.set(key, value);
    return value;
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
    try {
      this.backend?.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable: keep in memory */
    }
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Drop the in-memory cache so values are re-read from the backend (e.g. after a `storage` event). */
  refresh(): void {
    this.cache.clear();
    this.version++;
    this.listeners.forEach((l) => l());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = (): number => this.version;
}

function browserBackend(): KeyValueBackend | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const settings = new SettingsStore(browserBackend());

// Keep several windows of the suite in sync.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', () => settings.refresh());
}

/** Reactive read of a setting. */
export function useSetting<T>(key: string, fallback: T): [T, (v: T) => void] {
  useSyncExternalStore(settings.subscribe, settings.getVersion);
  return [settings.get(key, fallback), (v: T) => settings.set(key, v)];
}
