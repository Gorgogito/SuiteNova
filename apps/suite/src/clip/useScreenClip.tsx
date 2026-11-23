import { t } from '@suitenova/core-ui';
import { clipFileName, type Rect } from '@suitenova/clip-core';
import { useRef, useState, type ReactNode } from 'react';
import { ClipDialog } from './ClipDialog';
import './messages';
import { captureForClip } from './source';

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
  const [cap, setCap] = useState<{ canvas: HTMLCanvasElement; zone: Rect | null } | null>(null);
  const ins = useRef(insert);
  ins.current = insert;
  return {
    start: async () => {
      try {
        const got = await captureForClip();
        if (got) setCap(got);
      } catch (e) {
        window.alert((e as Error).message);
      }
    },
    dialog: cap ? (
      <ClipDialog
        canvas={cap.canvas}
        initialZone={cap.zone}
        onClose={() => setCap(null)}
        onInsert={async (png) => {
          setCap(null);
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
