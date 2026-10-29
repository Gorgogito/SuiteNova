import { CalcError, Workbook, canonicalFormula, colToName, generalText, type FormulaLocale, type Scalar } from '@suitenova/calc-engine';
import type { Node as PMNode } from 'prosemirror-model';

/*
 * Fórmulas en las tablas de una página. Una celda cuyo texto empieza por «=» es una fórmula; las celdas de la tabla se
 * llaman como en una hoja de cálculo (A1 es la primera columna de la primera fila) y se calculan con el motor de Nova Calc,
 * así que valen sus funciones (SUMA/SUM, PROMEDIO/AVERAGE, SI/IF, MAX, MIN, CONTAR…). Además, como en Word, SUMA(ARRIBA)
 * suma los números que hay encima de la celda y SUMA(IZQUIERDA) los de su izquierda.
 */

export interface CellResult {
  /** Fila y columna de la celda (de 0). */
  row: number;
  col: number;
  formula: string;
  /** Lo que se muestra. */
  text: string;
  error: boolean;
}

const ABOVE = /^(ARRIBA|ABOVE)$/i;

/** Sustituye ARRIBA / IZQUIERDA (como argumento de una función) por el rango de números contiguos que hay encima o a la izquierda. */
function expandDirections(formula: string, rows: string[][], r: number, c: number, numeric: (t: string) => boolean): string {
  return formula.replace(/\(\s*(ARRIBA|ABOVE|IZQUIERDA|LEFT)\s*\)/gi, (_m, dir: string) => {
    if (ABOVE.test(dir)) {
      let top = r;
      while (top > 0 && numeric(rows[top - 1]?.[c] ?? '')) top--;
      return top === r ? '(0)' : `(${colToName(c)}${top + 1}:${colToName(c)}${r})`;
    }
    let left = c;
    while (left > 0 && numeric(rows[r]?.[left - 1] ?? '')) left--;
    return left === c ? '(0)' : `(${colToName(left)}${r + 1}:${colToName(c - 1)}${r + 1})`;
  });
}

function show(v: Scalar, locale: FormulaLocale): { text: string; error: boolean } {
  if (v === null || v === undefined) return { text: '', error: false };
  if (v instanceof CalcError) return { text: v.code, error: true };
  if (typeof v === 'number') return { text: generalText(v, locale === 'es' ? 'es' : 'en'), error: false };
  if (typeof v === 'boolean') return { text: locale === 'es' ? (v ? 'VERDADERO' : 'FALSO') : v ? 'TRUE' : 'FALSE', error: false };
  return { text: String(v), error: false };
}

/** Calcula las fórmulas de una tabla. `rows` es el texto de cada celda; solo se devuelven las celdas que son fórmulas. */
export function evaluateTable(rows: string[][], locale: FormulaLocale = 'es'): CellResult[] {
  const wb = new Workbook();
  const sheet = wb.sheets[0] ?? wb.addSheet('T');
  const decimalComma = locale === 'es';
  const isNumber = (t: string) => {
    const s = t.trim();
    if (!s || s.startsWith('=')) return false;
    const n = decimalComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(n);
  };
  const formulas: { r: number; c: number; text: string }[] = [];
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      const t = cell.trim();
      if (!t) return;
      if (t.startsWith('=') && t.length > 1) {
        formulas.push({ r, c, text: t });
        return;
      }
      // números con el formato del idioma (1.234,5); el resto, como texto
      if (isNumber(t)) wb.setInput(sheet.id, r, c, decimalComma ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
      else wb.setInput(sheet.id, r, c, `'${t}`);
    }),
  );
  for (const f of formulas) {
    try {
      wb.setInput(sheet.id, f.r, f.c, canonicalFormula(expandDirections(f.text, rows, f.r, f.c, (t) => isNumber(t) || t.trim().startsWith('=')), locale));
    } catch {
      wb.setInput(sheet.id, f.r, f.c, '=NA()');
    }
  }
  return formulas.map((f) => {
    let v: Scalar = null;
    try {
      v = wb.getValue(sheet.id, f.r, f.c);
    } catch {
      v = CalcError.of('#VALUE!');
    }
    const s = show(v, locale);
    return { row: f.r, col: f.c, formula: f.text, ...s };
  });
}

export interface TableCell {
  /** Posición del contenido de la celda en el documento (después de la apertura de la celda) y su final. */
  from: number;
  to: number;
  result: CellResult;
}

/** El texto de cada celda de una tabla, por filas (las celdas combinadas ocupan su primera columna). */
function tableRows(table: PMNode): { rows: string[][]; at: { from: number; to: number }[][] } {
  const rows: string[][] = [];
  const at: { from: number; to: number }[][] = [];
  table.forEach((row, rowOffset) => {
    const texts: string[] = [];
    const places: { from: number; to: number }[] = [];
    row.forEach((cell, cellOffset) => {
      const span = (cell.attrs.colspan as number) || 1;
      const start = rowOffset + 1 + cellOffset + 1 + 1;
      texts.push(cell.textContent);
      places.push({ from: start, to: start + cell.content.size });
      for (let i = 1; i < span; i++) {
        texts.push('');
        places.push({ from: -1, to: -1 });
      }
    });
    rows.push(texts);
    at.push(places);
  });
  return { rows, at };
}

/** Todas las fórmulas de un documento con sus posiciones (para dibujar el resultado en la celda). */
export function documentFormulas(doc: PMNode, locale: FormulaLocale = 'es'): TableCell[] {
  const out: TableCell[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name !== 'table') return true;
    const { rows, at } = tableRows(n);
    if (rows.some((r) => r.some((c) => c.trim().startsWith('=')))) {
      for (const result of evaluateTable(rows, locale)) {
        const place = at[result.row]?.[result.col];
        if (place && place.from >= 0) out.push({ from: pos + place.from, to: pos + place.to, result });
      }
    }
    return false;
  });
  return out;
}

type J = { type?: string; text?: string; content?: J[]; attrs?: Record<string, unknown> };

const jsonText = (n: J): string => (n.text ?? '') + (n.content ?? []).map(jsonText).join('');

/**
 * Una copia del contenido de un cuadro de texto con el resultado en lugar de cada fórmula de sus tablas. Sirve para exportar
 * (Word, HTML, correo): el formato de destino no calcula.
 */
export function bakeFormulas(content: unknown, locale: FormulaLocale = 'es'): unknown {
  const root = JSON.parse(JSON.stringify(content)) as J;
  let changed = false;
  const walk = (n: J): void => {
    if (n.type === 'table') {
      const rowNodes = n.content ?? [];
      const grid: { cell: J; col: number }[][] = [];
      const rows: string[][] = rowNodes.map((row, r) => {
        const texts: string[] = [];
        grid[r] = [];
        (row.content ?? []).forEach((cell) => {
          grid[r]!.push({ cell, col: texts.length });
          texts.push(jsonText(cell));
          for (let i = 1; i < (((cell.attrs?.colspan as number) || 1)); i++) texts.push('');
        });
        return texts;
      });
      if (rows.some((r) => r.some((c) => c.trim().startsWith('=')))) {
        for (const res of evaluateTable(rows, locale)) {
          const cell = grid[res.row]?.find((g) => g.col === res.col)?.cell;
          if (!cell) continue;
          cell.content = [{ type: 'paragraph', content: res.text ? [{ type: 'text', text: res.text }] : [] }];
          changed = true;
        }
      }
      return;
    }
    (n.content ?? []).forEach(walk);
  };
  walk(root);
  return changed ? root : content;
}
