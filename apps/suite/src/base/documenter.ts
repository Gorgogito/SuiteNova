import type { BaseCtl } from './ctl';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DocOptions {
  tables: boolean;
  queries: boolean;
  forms: boolean;
  reports: boolean;
  code: boolean;
}

/** An HTML document that describes the database: its tables (fields, keys, rules, indexes, relations) and its saved objects. */
export function documentDatabase(ctl: BaseCtl, o: DocOptions): string {
  const db = ctl.db!;
  const parts: string[] = [];
  const name = ctl.fileName ?? 'Base de datos';
  const names = db.tableNames();
  const rels = db.relations();
  parts.push(`<h1>${esc(name)}</h1><p class="meta">Documentación generada por Nova Base el ${esc(new Date().toLocaleString())}. ${names.length} tablas, ${db.objects('query').length} consultas, ${db.objects('form').length} formularios, ${db.objects('report').length} informes, ${db.objects('macro').length} macros y ${db.objects('module').length} módulos.</p>`);
  if (o.tables) {
    parts.push('<h2>Tablas</h2>');
    for (const tb of names) {
      const meta = db.getMeta(tb);
      const cols = db.columns(tb);
      parts.push(`<h3>${esc(tb)}</h3>`);
      parts.push(`<p>${esc(meta.description ?? '')}${meta.description ? ' · ' : ''}${db.rowCount(tb)} registros</p>`);
      parts.push('<table><thead><tr><th>Campo</th><th>Tipo</th><th>Propiedades</th><th>Descripción</th></tr></thead><tbody>');
      for (const c of cols) {
        const m = meta.fields[c.name];
        const props = [
          c.primaryKey ? 'clave principal' : '',
          c.autoIncrement ? 'autonumérico' : '',
          c.notNull && !c.primaryKey ? 'requerido' : '',
          c.unique && !c.primaryKey ? 'único' : '',
          c.defaultValue ? `predeterminado ${c.defaultValue}` : '',
          c.references ? `relacionado con ${c.references.table}.${c.references.column}` : '',
          m?.kind ? `tipo ${m.kind}` : '',
          m?.format ? `formato ${m.format}` : '',
          m?.inputMask ? `máscara ${m.inputMask}` : '',
          m?.rule ? `regla: ${m.rule}` : '',
          m?.lookup ? (m.lookup.kind === 'list' ? `búsqueda: ${m.lookup.items.join(', ')}` : `búsqueda: ${m.lookup.table}.${m.lookup.displayCol}`) : '',
        ].filter(Boolean);
        parts.push(`<tr><td>${esc(m?.caption ? `${c.name} (${m.caption})` : c.name)}</td><td>${esc(c.type)}</td><td>${esc(props.join('; '))}</td><td>${esc(m?.description ?? '')}</td></tr>`);
      }
      parts.push('</tbody></table>');
      if (meta.rule) parts.push(`<p>Regla de la tabla: <code>${esc(meta.rule)}</code>${meta.ruleText ? ` — «${esc(meta.ruleText)}»` : ''}</p>`);
      const idx = db.indexes(tb).filter((i) => !i.auto);
      if (idx.length) parts.push(`<p>Índices: ${idx.map((i) => `${esc(i.name)} (${esc(i.columns.map((c) => c ?? 'expresión').join(', '))}${i.unique ? ', sin duplicados' : ''})`).join('; ')}</p>`);
      const mine = rels.filter((r) => r.child === tb);
      if (mine.length) parts.push(`<p>Relaciones: ${mine.map((r) => `${esc(r.childCols.join(', '))} → ${esc(r.parent)}.${esc(r.parentCols.join(', '))} (al eliminar: ${esc(r.onDelete)}, al cambiar: ${esc(r.onUpdate)})`).join('; ')}</p>`);
    }
  }
  if (o.queries) {
    const list = db.objects('query');
    parts.push(`<h2>Consultas (${list.length})</h2>`);
    for (const n of list) {
      let sql = '';
      try {
        sql = ctl.sqlOfQuery(n);
      } catch {
        sql = '(no se pudo generar el SQL)';
      }
      parts.push(`<h3>${esc(n)}</h3><pre>${esc(sql)}</pre>`);
    }
  }
  if (o.forms) {
    const list = db.objects('form');
    parts.push(`<h2>Formularios (${list.length})</h2><ul>`);
    for (const n of list) {
      const f = db.getObject<{ table?: string; layout?: { controls?: unknown[] } }>('form', n);
      parts.push(`<li>${esc(n)}${f?.table ? ` — tabla ${esc(f.table)}` : ''}${f?.layout?.controls ? `, ${f.layout.controls.length} controles` : ''}</li>`);
    }
    parts.push('</ul>');
  }
  if (o.reports) {
    const list = db.objects('report');
    parts.push(`<h2>Informes (${list.length})</h2><ul>`);
    for (const n of list) {
      const r = db.getObject<{ table?: string; kind?: string }>('report', n);
      parts.push(`<li>${esc(n)}${r?.table ? ` — tabla ${esc(r.table)}` : ''}</li>`);
    }
    parts.push('</ul>');
  }
  if (o.code) {
    parts.push(`<h2>Macros (${db.objects('macro').length}) y módulos (${db.objects('module').length})</h2><ul>`);
    for (const n of db.objects('macro')) parts.push(`<li>Macro ${esc(n)}</li>`);
    for (const n of db.objects('module')) {
      const code = db.getObject<{ code?: string } | string>('module', n);
      const text = typeof code === 'string' ? code : (code?.code ?? '');
      parts.push(`<li>Módulo ${esc(n)} — ${text ? text.split('\n').length : 0} líneas</li>`);
    }
    parts.push('</ul>');
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(name)} — documentación</title><style>body{font:13px Calibri,Arial,sans-serif;margin:28px;color:#222}h1{margin-bottom:2px}h2{margin-top:28px;border-bottom:2px solid #999;padding-bottom:3px}h3{margin:18px 0 4px}.meta{color:#666}table{border-collapse:collapse;margin:6px 0}th,td{border:1px solid #bbb;padding:3px 8px;text-align:left;vertical-align:top}th{background:#eee}pre{background:#f4f4f4;padding:8px;white-space:pre-wrap}code{background:#f4f4f4;padding:1px 4px}</style></head><body>${parts.join('\n')}</body></html>`;
}
