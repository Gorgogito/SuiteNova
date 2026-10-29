import { settings } from '@suitenova/core-ui';

export interface RecentFile {
  path: string;
  name: string;
  app: string;
  openedAt: number;
}

const KEY = 'recents';
const MAX = 12;

export function getRecents(): RecentFile[] {
  const list = settings.get<RecentFile[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

/** Remember a file (desktop only: browsers do not expose paths). */
export function addRecent(file: { path: string | null; name: string; app: string }): void {
  if (!file.path) return;
  const rest = getRecents().filter((r) => r.path !== file.path);
  settings.set(KEY, [{ path: file.path, name: file.name, app: file.app, openedAt: Date.now() }, ...rest].slice(0, MAX));
}

export function clearRecents(): void {
  settings.set(KEY, []);
}
