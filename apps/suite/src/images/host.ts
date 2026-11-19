import type { FrameEdits, Pixels, PixelEdits } from '@suitenova/image-core';

/**
 * What the shared picture tools (the dialogs and galleries in this folder) need from a product. Each product keeps its pictures in its own
 * model; the host reads the edits of the selected picture from it and writes them back (making the edited image when pixels change) as
 * one step of the product's history. The tools never touch the product's model.
 */
export interface PictureHost {
  /** How many pictures are selected (the tools are disabled with none). */
  count(): number;
  /** What was done to the pixels of the first selected picture: its corrections, colour, effect and background removal. */
  pixelEdits(): PixelEdits;
  /**
   * Gives every selected picture these pixel edits, in one step. Each picture keeps its own background marks (they are points of its own
   * image), unless `next.background` is different from the first picture's.
   */
  setPixelEdits(next: PixelEdits, label: string): Promise<void>;
  /** The frame of the first selected picture: crop, shape, border and effects. */
  frame(): FrameEdits;
  /** Gives every selected picture this frame (a crop also moves the picture's box so that the image stays where it is). */
  setFrame(next: FrameEdits, label: string): void;
  /** The original image of the first selected picture (without any pixel edit), or null when it cannot be read. */
  original(): Promise<Pixels | null>;
  /** The size in pixels of the first selected picture's image, to work out crops. */
  naturalSize(): Promise<{ w: number; h: number } | null>;
  /** The accent colour of the document (for the recolors that use it). */
  accent(): string;
}
