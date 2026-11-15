import type { NotesCtl } from './ctl';

/** El texto leído (OCR) de la imagen seleccionada, o null si no hay imagen seleccionada o aún no se ha leído. */
export function ocrTextFor(ctl: NotesCtl): string | null {
  const c = ctl.selectedContainer;
  if (!c || c.kind !== 'image') return null;
  const text = ctl.ocrTextOf(c).trim();
  return text || null;
}
