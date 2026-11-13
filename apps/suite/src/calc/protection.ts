/**
 * Protección de hojas y del libro en la capa de documento: decide si una acción del usuario se puede hacer y avisa si no.
 * La protección no es seguridad (como en Excel): impide cambios por descuido, no los de quien lee el archivo con otras herramientas.
 */
import { DEFAULT_ALLOW, checkPassword, makePasswordHash, type ProtectAction, type Rect, type Sheet } from '@suitenova/calc-engine';
import { MAX_COLS } from '@suitenova/calc-engine';
import type { CalcDoc } from './doc';

export const MSG_SHEET = 'La celda o el gráfico que intenta cambiar está en una hoja protegida. Para modificarlo, desproteja la hoja (pestaña Revisar).';
export const MSG_BOOK = 'La estructura del libro está protegida. Para añadir, borrar, mover, copiar, renombrar u ocultar hojas, desproteja el libro (pestaña Revisar).';

const ACTION_LABEL: Partial<Record<ProtectAction, string>> = {
  formatCells: 'dar formato a celdas',
  formatColumns: 'cambiar columnas',
  formatRows: 'cambiar filas',
  insertColumns: 'insertar columnas',
  insertRows: 'insertar filas',
  insertHyperlinks: 'insertar hipervínculos',
  deleteColumns: 'eliminar columnas',
  deleteRows: 'eliminar filas',
  sort: 'ordenar',
  autoFilter: 'usar el autofiltro',
  pivotTables: 'usar tablas dinámicas',
  objects: 'modificar objetos',
};

export class ProtectionGuard {
  constructor(private readonly d: CalcDoc) {}

  private sheet(id?: number): Sheet {
    return this.d.wb.sheet(id ?? this.d.activeSheetId);
  }

  isProtected(sheetId?: number): boolean {
    return Boolean(this.sheet(sheetId).protection);
  }

  /** ¿Se permite la acción en la hoja? Si no, avisa en la barra de estado. */
  allowed(action: ProtectAction, sheetId?: number, quiet = false): boolean {
    const p = this.sheet(sheetId).protection;
    if (!p || p.allow[action]) return true;
    if (quiet) return false;
    const what = ACTION_LABEL[action];
    this.d.setNotice(`La hoja está protegida: no se permite ${what ?? 'esta acción'}. Para hacerlo, desproteja la hoja (pestaña Revisar).`);
    return false;
  }

  /** ¿Están todas las celdas de estos rangos desbloqueadas (o la hoja sin proteger)? Si no, avisa. */
  canEdit(rects: Rect[], sheetId?: number, quiet = false): boolean {
    const sheet = this.sheet(sheetId);
    if (!sheet.protection) return true;
    for (const r of rects) {
      const r1 = Math.min(r.r1, r.r2);
      const r2 = Math.max(r.r1, r.r2);
      const c1 = Math.min(r.c1, r.c2);
      const c2 = Math.max(r.c1, r.c2);
      const area = (r2 - r1 + 1) * (c2 - c1 + 1);
      let unlocked = 0;
      if (area <= sheet.cells.size) {
        for (let row = r1; row <= r2; row++) for (let col = c1; col <= c2; col++) if (this.unlocked(sheet, row, col)) unlocked++;
      } else {
        for (const [k, c] of sheet.cells) {
          const row = Math.floor(k / MAX_COLS);
          const col = k % MAX_COLS;
          if (row >= r1 && row <= r2 && col >= c1 && col <= c2 && this.d.wb.styles.get(c.style).locked === false) unlocked++;
        }
      }
      if (unlocked < area) {
        if (!quiet) this.d.setNotice(MSG_SHEET);
        return false;
      }
    }
    return true;
  }

  private unlocked(sheet: Sheet, row: number, col: number): boolean {
    const c = sheet.cells.get(row * MAX_COLS + col);
    return c !== undefined && this.d.wb.styles.get(c.style).locked === false;
  }

  /** ¿Hay en estas filas o columnas alguna celda con datos bloqueada? (para eliminarlas) */
  hasLockedCells(rects: Rect[], sheetId?: number): boolean {
    const sheet = this.sheet(sheetId);
    if (!sheet.protection) return false;
    for (const [k, c] of sheet.cells) {
      if (this.d.wb.styles.get(c.style).locked === false) continue;
      const row = Math.floor(k / MAX_COLS);
      const col = k % MAX_COLS;
      if (rects.some((r) => row >= Math.min(r.r1, r.r2) && row <= Math.max(r.r1, r.r2) && col >= Math.min(r.c1, r.c2) && col <= Math.max(r.c1, r.c2))) {
        this.d.setNotice(MSG_SHEET);
        return true;
      }
    }
    return false;
  }

  /** La estructura del libro (hojas) se puede cambiar. Si no, avisa. */
  structureOpen(): boolean {
    if (!this.d.wb.protection?.structure) return true;
    this.d.setNotice(MSG_BOOK);
    return false;
  }

  /** ¿La fórmula de esta celda está oculta (celda «oculta» en una hoja protegida)? */
  formulaHidden(sheetId: number, row: number, col: number): boolean {
    if (!this.sheet(sheetId).protection) return false;
    return this.d.wb.getStyle(sheetId, row, col).hidden === true;
  }

  // ------------------------------------------------------------------ proteger y desproteger
  protectSheet(id: number, allow: Partial<Record<ProtectAction, boolean>> | undefined, password: string | null): void {
    const sheet = this.sheet(id);
    sheet.protection = { allow: { ...(allow ?? DEFAULT_ALLOW) }, hash: makePasswordHash(password) };
    this.d.dirty = true;
    this.d.touch();
  }

  /** Quita la protección; devuelve false si la contraseña no es la correcta. */
  unprotectSheet(id: number, password: string): boolean {
    const sheet = this.sheet(id);
    if (!sheet.protection) return true;
    if (!checkPassword(sheet.protection, password)) return false;
    sheet.protection = undefined;
    this.d.dirty = true;
    this.d.touch();
    return true;
  }

  protectWorkbook(password: string | null): void {
    this.d.wb.protection = { structure: true, hash: makePasswordHash(password) };
    this.d.dirty = true;
    this.d.touch();
  }

  unprotectWorkbook(password: string): boolean {
    const p = this.d.wb.protection;
    if (!p) return true;
    if (!checkPassword(p, password)) return false;
    this.d.wb.protection = undefined;
    this.d.dirty = true;
    this.d.touch();
    return true;
  }
}
