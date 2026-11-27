import { isTauri } from '../platform';

/* Notices of the system (the one Windows shows by the clock). They exist in the desktop application on Windows. */

export interface SystemNotice {
  id: string;
  title: string;
  body: string;
  /** Buttons of the notice; pressing the notice itself is the action `open`. */
  actions?: { id: string; label: string }[];
}
export interface Pressed {
  id: string;
  action: string;
}
export interface Notifier {
  show: (notice: SystemNotice) => Promise<void>;
  listen: (pressed: (p: Pressed) => void) => () => void;
}

let custom: Notifier | null = null;
/** Only for tests (linked to `window.__novaMail` in development). */
export function setNotifier(n: Notifier | null): void {
  custom = n;
}

export const systemNotices = (): boolean => !!custom || (isTauri() && navigator.userAgent.includes('Windows'));

export async function showNotice(notice: SystemNotice): Promise<void> {
  if (custom) return custom.show(notice);
  if (!systemNotices()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('notify_show', { id: notice.id, title: notice.title, body: notice.body, actions: notice.actions ?? [] });
}

/** What is pressed in a notice that this window asked for. Returns how to stop listening. */
export function onNoticePressed(pressed: (p: Pressed) => void): () => void {
  if (custom) return custom.listen(pressed);
  if (!isTauri()) return () => undefined;
  let off: (() => void) | undefined;
  let stopped = false;
  void import('@tauri-apps/api/webviewWindow').then(async ({ getCurrentWebviewWindow }) => {
    const stop = await getCurrentWebviewWindow().listen<Pressed>('nova-notification', (e) => pressed(e.payload));
    if (stopped) stop();
    else off = stop;
  });
  return () => {
    stopped = true;
    off?.();
  };
}
