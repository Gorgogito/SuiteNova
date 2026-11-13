/** Protección de hoja y de libro en XLSX (`sheetProtection`, `workbookProtection`). */
import { PROTECT_ACTIONS, type ProtectAction, type SheetProtection, type WorkbookProtection } from '@suitenova/calc-engine';
import { attr, type XNode } from './xml';

/** Nombre del atributo y valor por defecto (1 = prohibido) de cada acción, según el esquema de Office. */
const ATTRS: Record<ProtectAction, [string, 0 | 1]> = {
  selectLocked: ['selectLockedCells', 0],
  selectUnlocked: ['selectUnlockedCells', 0],
  formatCells: ['formatCells', 1],
  formatColumns: ['formatColumns', 1],
  formatRows: ['formatRows', 1],
  insertColumns: ['insertColumns', 1],
  insertRows: ['insertRows', 1],
  insertHyperlinks: ['insertHyperlinks', 1],
  deleteColumns: ['deleteColumns', 1],
  deleteRows: ['deleteRows', 1],
  sort: ['sort', 1],
  autoFilter: ['autoFilter', 1],
  pivotTables: ['pivotTables', 1],
  objects: ['objects', 0],
  scenarios: ['scenarios', 0],
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function sheetProtectionXml(p: SheetProtection | undefined): string {
  if (!p) return '';
  const flags = PROTECT_ACTIONS.filter((a) => a !== 'objects' && a !== 'scenarios').map((a) => {
    const [name, dflt] = ATTRS[a];
    const prohibited = p.allow[a] ? 0 : 1;
    return prohibited === dflt ? '' : ` ${name}="${prohibited}"`;
  }).join('');
  // en los hash de hoja los atributos son algorithmName, hashValue, saltValue y spinCount
  const h = p.hash;
  const pw = h
    ? ` algorithmName="${h.algorithm}" hashValue="${esc(h.hash)}" saltValue="${esc(h.salt)}" spinCount="${h.spin}"`
    : p.legacy
      ? ` password="${esc(p.legacy)}"`
      : '';
  return `<sheetProtection sheet="1" objects="${p.allow.objects ? 0 : 1}" scenarios="${p.allow.scenarios ? 0 : 1}"${flags}${pw}/>`;
}

export function parseSheetProtection(n: XNode | undefined): SheetProtection | undefined {
  if (n === undefined || n === null) return undefined;
  const on = attr(n, 'sheet');
  if (on !== '1' && on !== 'true') return undefined;
  const allow: Partial<Record<ProtectAction, boolean>> = {};
  for (const a of PROTECT_ACTIONS) {
    const [name, dflt] = ATTRS[a];
    const v = attr(n, name);
    const prohibited = v === undefined ? dflt === 1 : v === '1' || v === 'true';
    if (!prohibited) allow[a] = true;
  }
  const out: SheetProtection = { allow };
  const hashValue = attr(n, 'hashValue');
  const salt = attr(n, 'saltValue');
  if (hashValue && salt) out.hash = { algorithm: attr(n, 'algorithmName') ?? 'SHA-512', hash: hashValue, salt, spin: Number(attr(n, 'spinCount') ?? 100000) };
  else if (attr(n, 'password')) out.legacy = String(attr(n, 'password'));
  return out;
}

export function workbookProtectionXml(p: WorkbookProtection | undefined): string {
  if (!p || !p.structure) return '';
  const h = p.hash;
  const pw = h
    ? ` workbookAlgorithmName="${h.algorithm}" workbookHashValue="${esc(h.hash)}" workbookSaltValue="${esc(h.salt)}" workbookSpinCount="${h.spin}"`
    : p.legacy
      ? ` workbookPassword="${esc(p.legacy)}"`
      : '';
  return `<workbookProtection lockStructure="1"${pw}/>`;
}

export function parseWorkbookProtection(n: XNode | undefined): WorkbookProtection | undefined {
  if (n === undefined || n === null) return undefined;
  const lock = attr(n, 'lockStructure');
  if (lock !== '1' && lock !== 'true') return undefined;
  const out: WorkbookProtection = { structure: true };
  const hashValue = attr(n, 'workbookHashValue');
  const salt = attr(n, 'workbookSaltValue');
  if (hashValue && salt) out.hash = { algorithm: attr(n, 'workbookAlgorithmName') ?? 'SHA-512', hash: hashValue, salt, spin: Number(attr(n, 'workbookSpinCount') ?? 100000) };
  else if (attr(n, 'workbookPassword')) out.legacy = String(attr(n, 'workbookPassword'));
  return out;
}

