import { useRef, useState, type ReactNode } from 'react';
import { useScreenClip } from '../clip/useScreenClip';
import { IconsDialog } from '../icons/IconsDialog';
import { pickFile, type IconPick } from '../icons/raster';
import { clipboardImage, SourceError } from './sources';

export interface ImageSources {
  fromClipboard(): Promise<void>;
  fromScreen(): Promise<void>;
  openIcons(): void;
  /** Render this once in the app: it is the icon picker while it is open. */
  dialog: ReactNode;
}

/**
 * The non-file sources of a picture, wired to the product's own way to insert a File. A product that keeps icons as icons (SVG with its PNG
 * fallback) passes `insertIcons`; the others get each icon as a PNG file.
 */
export function useImageSources(insert: (file: File) => void | Promise<void>, insertIcons?: (picks: IconPick[]) => void | Promise<void>): ImageSources {
  const [icons, setIcons] = useState(false);
  const ins = useRef(insert);
  ins.current = insert;
  const insIcons = useRef(insertIcons);
  insIcons.current = insertIcons;
  const clip = useScreenClip((f) => ins.current(f));
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
    fromScreen: () => clip.start(),
    openIcons: () => setIcons(true),
    dialog: (
      <>
        {clip.dialog}
        {icons ? (
      <IconsDialog
        onPick={async (picks) => {
          if (insIcons.current) return void (await insIcons.current(picks));
          for (const p of picks) await run(() => pickFile(p));
        }}
        onClose={() => setIcons(false)}
      />
        ) : null}
      </>
    ),
  };
}
