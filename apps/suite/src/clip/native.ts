import { invoke } from '@tauri-apps/api/core';

/** The monitors of the system as the desktop app reports them (physical pixels). */
export interface ClipMonitor {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  primary: boolean;
  name: string;
}

/** True in the desktop app (Tauri), where the program can hide itself and capture the real screen. */
export function hasNativeClip(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function nativeMonitors(): Promise<ClipMonitor[]> {
  return invoke<ClipMonitor[]>('clip_monitors');
}

/**
 * The capture of a monitor (the one the window is on when none is given) taken by the desktop app with its windows hidden, drawn on a canvas.
 * Rejects with the message of the system when it cannot capture.
 */
export async function captureNativeCanvas(opts: { monitor?: number; hide?: boolean } = {}): Promise<HTMLCanvasElement> {
  const bytes = await invoke<ArrayBuffer>('clip_capture', { monitor: opts.monitor ?? null, hide: opts.hide ?? true });
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  cv.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return cv;
}
