/**
 * The window of the desktop app. Windows are created without the title bar of Windows and hidden: this gives the frame its
 * window buttons and shows the window once the page has been drawn, so no blank window is seen first.
 */
import { fluentTheme, normalizeThemePreference, resolveTheme, settings, setWindowHost, SETTING_THEME, type WindowHost } from '@suitenova/core-ui';
import { isTauri } from './platform';

declare global {
  interface Window {
    /** Development only: lets the browser tests stand in for the desktop window. */
    __novaWindowHost?: WindowHost;
  }
}

/** Colour of the frame in the theme the window is going to show. */
export function bootColor(appId: string, saved: unknown, dark: boolean, contrast: boolean): string {
  // a light contrast theme of Windows paints the page white
  if (contrast && !dark) return '#ffffff';
  return fluentTheme(resolveTheme(normalizeThemePreference(saved), dark, contrast), appId)['nv-tabs-bg'];
}

/** Before the first render: the colour behind the page and, in a window without title bar, its host. */
export async function prepareWindow(appId: string): Promise<void> {
  if (import.meta.env.DEV && window.__novaWindowHost) setWindowHost(window.__novaWindowHost);
  if (!isTauri()) return;
  const media = (q: string) => window.matchMedia(q).matches;
  document.documentElement.style.background = bootColor(appId, settings.get(SETTING_THEME, 'system'), media('(prefers-color-scheme: dark)'), media('(forced-colors: active)'));
  const [{ getCurrentWindow }, { getCurrentWebviewWindow }] = await Promise.all([import('@tauri-apps/api/window'), import('@tauri-apps/api/webviewWindow')]);
  const win = getCurrentWindow();
  // the presenter's window keeps the title bar of Windows
  if (await win.isDecorated()) return;
  const report = (e: unknown) => console.error('ventana:', e);
  setWindowHost({
    minimize: () => void win.minimize().catch(report),
    toggleMaximize: () => void win.toggleMaximize().catch(report),
    close: () => void win.close().catch(report),
    isMaximized: () => win.isMaximized(),
    onResize: (callback) => {
      let off: (() => void) | undefined;
      let stopped = false;
      void win.onResized(() => callback()).then((u) => (stopped ? u() : (off = u)), report);
      return () => {
        stopped = true;
        off?.();
      };
    },
    setBackground: (color) => {
      document.documentElement.style.background = color;
      void getCurrentWebviewWindow().setBackgroundColor(color as `#${string}`).catch(report);
    },
  });
}

/** After the first render. The Rust side shows the window anyway after a few seconds, in case the page fails. */
export async function showWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  if (await win.isVisible()) return;
  await win.show();
  await win.setFocus();
}
