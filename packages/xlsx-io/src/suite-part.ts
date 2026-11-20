import type { PivotDef, SlicerDef, Workbook } from '@suitenova/calc-engine';

/**
 * What Excel has no place for goes in one extra part of the package (customXml): pivot table definitions with every option of
 * this suite, slicers, and macro modules. Excel ignores the part; this suite reads it back so nothing is lost on the way.
 */
export interface SuitePart {
  v: 1;
  pivots: { sheet: number; def: PivotDef }[];
  slicers: { sheet: number; def: SlicerDef }[];
  macros: { name: string; code: string }[];
  /** The text read from the pictures (OCR), by the key of the picture in the media store (which comes from its content). */
  ocr?: Record<string, unknown>;
}

export function buildSuitePart(wb: Workbook): string | undefined {
  const part: SuitePart = { v: 1, pivots: [], slicers: [], macros: wb.macros.map((m) => ({ name: m.name, code: m.code })) };
  wb.sheets.forEach((s, i) => {
    for (const def of s.pivots) part.pivots.push({ sheet: i, def });
    for (const def of s.slicers) part.slicers.push({ sheet: i, def });
  });
  const ocr: Record<string, unknown> = {};
  for (const [key, m] of wb.media) if (m.ocr) ocr[key] = m.ocr;
  if (Object.keys(ocr).length) part.ocr = ocr;
  if (!part.pivots.length && !part.slicers.length && !part.macros.length && !part.ocr) return undefined;
  return JSON.stringify(part);
}

export function applySuitePart(wb: Workbook, json: string, warnings: string[]): void {
  let part: SuitePart;
  try {
    part = JSON.parse(json) as SuitePart;
  } catch {
    warnings.push('Los datos propios de SuiteNova del archivo están dañados y se ignoraron.');
    return;
  }
  if (part.v !== 1) return;
  for (const p of part.pivots ?? []) {
    const s = wb.sheets[p.sheet];
    if (s) s.pivots.push(p.def);
  }
  for (const p of part.slicers ?? []) {
    const s = wb.sheets[p.sheet];
    if (s) s.slicers.push(p.def);
  }
  wb.macros = (part.macros ?? []).map((m) => ({ name: String(m.name), code: String(m.code) }));
  for (const [key, ocr] of Object.entries(part.ocr ?? {})) {
    const m = wb.media.get(key);
    if (m && ocr && typeof (ocr as { text?: unknown }).text === 'string') m.ocr = ocr;
  }
}
