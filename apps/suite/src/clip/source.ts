import { t } from '@suitenova/core-ui';
import './messages';
import { captureNativeCanvas, hasNativeClip } from './native';

/** Something went wrong taking the capture (the message is for the person). */
export class ClipError extends Error {}

/**
 * Takes the capture to clip. In the desktop app the program hides itself and captures the screen it is on (like Office); anywhere else, or if
 * that fails, the person picks a screen, window or tab in the browser's own picker. Returns null if the person cancels.
 */
export async function captureScreenCanvas(): Promise<HTMLCanvasElement | null> {
  if (hasNativeClip()) {
    try {
      return await captureNativeCanvas();
    } catch (e) {
      console.warn('Recorte nativo no disponible, se usa el selector del navegador:', e);
    }
  }
  return captureWithPicker();
}

/** The capture of a screen, window or tab the person chooses (the browser's own picker) drawn on a canvas. Returns null if the person cancels. */
export async function captureWithPicker(): Promise<HTMLCanvasElement | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new ClipError(t('Este sistema no permite capturar la pantalla desde el programa.'));
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (e) {
    if ((e as Error).name === 'NotAllowedError' || (e as Error).name === 'AbortError') return null;
    throw new ClipError(t('No se pudo capturar la pantalla.'));
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 250));
    if (!video.videoWidth || !video.videoHeight) throw new ClipError(t('No se pudo capturar la pantalla.'));
    const cv = document.createElement('canvas');
    cv.width = video.videoWidth;
    cv.height = video.videoHeight;
    cv.getContext('2d')!.drawImage(video, 0, 0);
    return cv;
  } finally {
    stream.getTracks().forEach((tr) => tr.stop());
  }
}

/** The part of a canvas as a PNG. */
export function cropToPng(cv: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const out = document.createElement('canvas');
  out.width = box.w;
  out.height = box.h;
  out.getContext('2d')!.drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return new Promise((ok, fail) => out.toBlob((b) => (b ? ok(b) : fail(new ClipError(t('No se pudo capturar la pantalla.')))), 'image/png'));
}
