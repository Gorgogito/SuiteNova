import { t } from '@suitenova/core-ui';
import { clipFileName } from '@suitenova/clip-core';
import { useRef, useState, type ReactNode } from 'react';
import { ClipDialog } from './ClipDialog';
import './messages';
import { captureScreenCanvas } from './source';

export interface ScreenClip {
  /** Asks which screen, window or tab to take and opens the clip dialog on it (nothing happens if the person cancels). */
  start(): Promise<void>;
  /** Render this once in the app: it is the clip dialog while it is open. */
  dialog: ReactNode;
}

/**
 * Insert › Screen Clipping for a product: the capture, the area and the marks are the shared dialog's; what to do with the PNG is the product's
 * (`insert` takes it as a file, the way every product already takes a picture).
 */
export function useScreenClip(insert: (file: File) => void | Promise<void>): ScreenClip {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const ins = useRef(insert);
  ins.current = insert;
  return {
    start: async () => {
      try {
        const cv = await captureScreenCanvas();
        if (cv) setCanvas(cv);
      } catch (e) {
        window.alert((e as Error).message);
      }
    },
    dialog: canvas ? (
      <ClipDialog
        canvas={canvas}
        onClose={() => setCanvas(null)}
        onInsert={async (png) => {
          setCanvas(null);
          try {
            await ins.current(new File([png], clipFileName(t('Recorte de pantalla')), { type: 'image/png' }));
          } catch (e) {
            window.alert((e as Error).message);
          }
        }}
      />
    ) : null,
  };
}
