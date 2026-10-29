import { AlterLossError, type AlterOptions, type AlterReport } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';

const KIND = { index: 'índice', view: 'vista', trigger: 'disparador' } as const;

/** What a table redesign did to the indexes, views and triggers that depend on the table. */
export function describeReport(r: AlterReport): string {
  const parts: string[] = [];
  const kept = r.kept.indexes + r.kept.views + r.kept.triggers;
  if (kept) parts.push(t('Se conservaron {i} índices, {v} vistas y {g} disparadores.', { i: r.kept.indexes, v: r.kept.views, g: r.kept.triggers }));
  if (r.skipped.length) parts.push(t('No se pudieron conservar: {list}.', { list: r.skipped.map((s) => `${t(KIND[s.kind])} ${s.name}`).join(', ') }));
  return parts.join(' ');
}

/** Run a table rebuild; if the table has constraints that cannot be carried over, ask before going on. */
export function withLossConfirm(run: (opts: AlterOptions) => AlterReport): AlterReport | null {
  try {
    return run({});
  } catch (e) {
    if (!(e instanceof AlterLossError)) throw e;
    if (!window.confirm(t('{msg} ¿Continuar de todos modos?', { msg: e.message }))) return null;
    return run({ acceptLoss: true });
  }
}
