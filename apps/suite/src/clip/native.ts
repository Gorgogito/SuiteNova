import { invoke } from '@tauri-apps/api/core';
import type { Rect } from '@suitenova/clip-core';

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
  return pngToCanvas(await invoke<ArrayBuffer>('clip_capture', { monitor: opts.monitor ?? null, hide: opts.hide ?? true }));
}

async function pngToCanvas(bytes: ArrayBuffer): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const cv = document.createElement('canvas');
  cv.width = bmp.width;
  cv.height = bmp.height;
  cv.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return cv;
}

/**
 * Like Office: the program hides, every monitor is frozen and the person drags the area right on the real screen. Resolves with the capture of the
 * monitor where it was chosen and the area (null = the whole screen, when Enter was pressed), or null if the person cancelled.
 */
export async function pickNativeZone(): Promise<{ canvas: HTMLCanvasElement; zone: Rect | null } | null> {
  const r = await invoke<{ monitor: number; rect: { x: number; y: number; w: number; h: number } | null } | null>('clip_pick');
  if (!r) {
    await invoke('clip_release').catch(() => undefined);
    return null;
  }
  try {
    return { canvas: await pngToCanvas(await invoke<ArrayBuffer>('clip_shot', { monitor: r.monitor })), zone: r.rect };
  } finally {
    await invoke('clip_release').catch(() => undefined);
  }
}
