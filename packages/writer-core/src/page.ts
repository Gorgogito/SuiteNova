/** Page geometry in points (1 pt = 1/72 in). */
export interface PageSetup {
  width: number;
  height: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** distance from the page edge to the header / footer */
  headerDistance: number;
  footerDistance: number;
}

export const PAGE_SIZES: Record<string, { label: string; width: number; height: number }> = {
  a4: { label: 'A4 (21 × 29,7 cm)', width: 595.3, height: 841.9 },
  letter: { label: 'Carta (21,6 × 27,9 cm)', width: 612, height: 792 },
  legal: { label: 'Legal (21,6 × 35,6 cm)', width: 612, height: 1008 },
  a5: { label: 'A5 (14,8 × 21 cm)', width: 419.5, height: 595.3 },
  a3: { label: 'A3 (29,7 × 42 cm)', width: 841.9, height: 1190.6 },
};

export const MARGIN_PRESETS: Record<string, { label: string; top: number; right: number; bottom: number; left: number }> = {
  normal: { label: 'Normal (2,54 cm)', top: 72, right: 72, bottom: 72, left: 72 },
  narrow: { label: 'Estrecho (1,27 cm)', top: 36, right: 36, bottom: 36, left: 36 },
  moderate: { label: 'Moderado', top: 72, right: 54, bottom: 72, left: 54 },
  wide: { label: 'Ancho', top: 72, right: 144, bottom: 72, left: 144 },
};

export const defaultPage = (): PageSetup => ({ width: 595.3, height: 841.9, marginTop: 72, marginRight: 72, marginBottom: 72, marginLeft: 72, headerDistance: 35.4, footerDistance: 35.4 });

export const PT_TO_PX = 96 / 72;
export const ptToPx = (pt: number): number => pt * PT_TO_PX;
export const pxToPt = (px: number): number => px / PT_TO_PX;

export const isLandscape = (p: PageSetup): boolean => p.width > p.height;

export function rotatePage(p: PageSetup): PageSetup {
  return { ...p, width: p.height, height: p.width, marginTop: p.marginLeft, marginRight: p.marginTop, marginBottom: p.marginRight, marginLeft: p.marginBottom };
}

/** Content area in px. */
export function contentBox(p: PageSetup): { width: number; height: number } {
  return { width: ptToPx(p.width - p.marginLeft - p.marginRight), height: ptToPx(p.height - p.marginTop - p.marginBottom) };
}
