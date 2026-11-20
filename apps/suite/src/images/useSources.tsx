import { useRef, useState, type ReactNode } from 'react';
import { IconPickerDialog } from './IconPickerDialog';
import { clipboardImage, screenshot, SourceError } from './sources';

export interface ImageSources {
  fromClipboard(): Promise<void>;
  fromScreen(): Promise<void>;
  openIcons(): void;
  /** Render this once in the app: it is the icon picker while it is open. */
  dialog: ReactNode;
}

/** The three non-file sources of a picture, wired to the product's own way to insert a File. */
export function useImageSources(insert: (file: File) => void | Promise<void>): ImageSources {
  const [icons, setIcons] = useState(false);
  const ins = useRef(insert);
  ins.current = insert;
  const run = async (get: () => Promise<File | null>) => {
    try {
      const f = await get();
      if (f) await ins.current(f);
    } catch (e) {
      window.alert(e instanceof SourceError ? e.message : (e as Error).message);
    }
  };
  return {
    fromClipboard: () => run(clipboardImage),
    fromScreen: () => run(screenshot),
    openIcons: () => setIcons(true),
    dialog: icons ? <IconPickerDialog onPick={(f) => void run(async () => f)} onClose={() => setIcons(false)} /> : null,
  };
}
