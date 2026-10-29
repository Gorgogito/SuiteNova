/** True when running inside the Tauri shell (as opposed to a plain browser during development). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let counter = 0;

/** A window size that fits the usable area of the screen (title bar and taskbar included in the margin). */
export function fitToScreen(width: number, height: number): { width: number; height: number } {
  const aw = window.screen?.availWidth || width;
  const ah = window.screen?.availHeight || height;
  return { width: Math.max(640, Math.min(width, aw - 40)), height: Math.max(420, Math.min(height, ah - 90)) };
}

/** Open a module in its own window. */
export async function openModuleWindow(moduleId: string, title: string, openPath?: string): Promise<void> {
  const extra = openPath ? `&open=${encodeURIComponent(openPath)}` : '';
  const url = `index.html?app=${encodeURIComponent(moduleId)}${extra}`;
  if (isTauri()) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const label = `${moduleId}-${Date.now().toString(36)}-${counter++}`;
    const win = new WebviewWindow(label, { url, title, ...fitToScreen(1280, 800), center: true, minWidth: 640, minHeight: 420 });
    await new Promise<void>((resolve, reject) => {
      void win.once('tauri://created', () => resolve());
      void win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
    });
  } else {
    window.open(`/?app=${encodeURIComponent(moduleId)}${extra}`, '_blank', 'noopener');
  }
}

export async function closeThisWindow(): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}

/** Open a window on the same app with an arbitrary query (the speaker's window of a show). */
export async function openWindowQuery(query: string, title: string, label: string): Promise<void> {
  if (isTauri()) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const win = new WebviewWindow(label, { url: `index.html?${query}`, title, ...fitToScreen(1280, 800), center: true });
    await new Promise<void>((resolve, reject) => {
      void win.once('tauri://created', () => resolve());
      void win.once('tauri://error', (e) => reject(new Error(String(e.payload))));
    });
  } else {
    window.open(`/?${query}`, label, 'popup,width=1200,height=760');
  }
}
