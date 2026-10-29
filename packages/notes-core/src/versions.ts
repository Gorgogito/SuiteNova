import { bodyOf, newId, pageText, type Page, type PageBody, type Version } from './model';

/** Cuántas versiones se guardan por página (las manuales no se descartan por llegar al límite, salvo que todas lo sean). */
export const MAX_VERSIONS = 30;
/** Con cuánta separación se guarda una versión automática. */
export const AUTO_INTERVAL_MS = 10 * 60 * 1000;

const same = (a: PageBody, b: PageBody): boolean => JSON.stringify(a) === JSON.stringify(b);

/** El estado actual de la página como versión. */
export function snapshot(page: Page, label: string, manual: boolean, at = Date.now()): Version {
  return { id: newId('v'), at, label, manual, body: bodyOf(page) };
}

/** ¿Hace falta una versión automática? Si la página cambió desde la última y ya pasó el intervalo. */
export function versionDue(page: Page, now = Date.now()): boolean {
  if (page.vault) return false;
  const last = page.versions[page.versions.length - 1];
  const hasContent = pageText(page).trim() !== '' || page.ink.length > 0 || page.containers.some((c) => c.kind !== 'text');
  if (!last) return hasContent && now - page.created >= AUTO_INTERVAL_MS;
  return now - last.at >= AUTO_INTERVAL_MS && !same(last.body, bodyOf(page));
}

export function addVersion(page: Page, v: Version): Page {
  let versions = [...page.versions, v];
  while (versions.length > MAX_VERSIONS) {
    const i = versions.findIndex((x) => !x.manual);
    versions = versions.filter((_, k) => k !== (i >= 0 ? i : 0));
  }
  return { ...page, versions };
}

/** Guarda la versión que toque (manual o automática) si hay algo nuevo respecto de la última. */
export function recordVersion(page: Page, label: string, manual: boolean, now = Date.now()): Page {
  const last = page.versions[page.versions.length - 1];
  if (last && same(last.body, bodyOf(page))) return manual && !last.manual ? { ...page, versions: [...page.versions.slice(0, -1), { ...last, manual: true, label: label || last.label }] } : page;
  return addVersion(page, snapshot(page, label, manual, now));
}

/** Vuelve a una versión anterior. Lo que había antes de restaurar se guarda como una versión más (así se puede deshacer). */
export function restoreVersion(page: Page, id: string, now = Date.now()): Page {
  const v = page.versions.find((x) => x.id === id);
  if (!v) return page;
  const kept = addVersion(page, snapshot(page, 'Antes de restaurar', true, now));
  const body = bodyOf(v.body);
  return { ...kept, title: body.title, containers: body.containers, ink: body.ink, style: body.style, modified: now };
}

export function deleteVersion(page: Page, id: string): Page {
  return { ...page, versions: page.versions.filter((v) => v.id !== id) };
}

export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

/** Diferencias por líneas entre dos textos (la versión anterior frente a la actual). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return [...a.map((text): DiffLine => ({ kind: 'del', text })), ...b.map((text): DiffLine => ({ kind: 'add', text }))];
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: 'del', text: a[i++]! });
    else out.push({ kind: 'add', text: b[j++]! });
  }
  while (i < n) out.push({ kind: 'del', text: a[i++]! });
  while (j < m) out.push({ kind: 'add', text: b[j++]! });
  return out;
}

/** El texto de una versión (para compararla con la actual). */
export const versionText = (v: Version): string => pageText(v.body);
