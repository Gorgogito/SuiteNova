import { Button } from '@fluentui/react-components';
import { Workbook } from '@suitenova/calc-engine';
import { parseCsv, parseJson, toCsv, toHtml, toJson, toXml } from '@suitenova/base-core';
import { t } from '@suitenova/core-ui';
import { writeXlsx } from '@suitenova/xlsx-io';
import { useMemo, useState } from 'react';
import { pickAndRead, saveBytes } from '../fileio';
import type { BaseCtl } from './ctl';
import { Dlg } from './dlg-sheet';
import { documentDatabase, type DocOptions } from './documenter';

const closeX = (ctl: BaseCtl) => {
  ctl.xDialog = null;
  ctl.touch();
};
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Datos';
const enc = (s: string) => new TextEncoder().encode(s);

export type ExportFormat = 'xlsx' | 'csv' | 'tsv' | 'json' | 'xml' | 'html' | 'sql';
const FORMATS: [ExportFormat, string, string][] = [
  ['xlsx', 'Libro de Excel (.xlsx)', 'xlsx'],
  ['csv', 'Texto delimitado (.csv)', 'csv'],
  ['tsv', 'Texto con tabuladores (.txt)', 'txt'],
  ['json', 'JSON (.json)', 'json'],
  ['xml', 'XML (.xml)', 'xml'],
  ['html', 'Página HTML (.html)', 'html'],
  ['sql', 'Script SQL (.sql)', 'sql'],
];

/** What is exported: a table (all of it, or what the datasheet shows) or the result of the open query. */
function dataOf(ctl: BaseCtl, source: string, visibleOnly: boolean): { name: string; columns: string[]; rows: unknown[][]; numeric: boolean[] } {
  const db = ctl.db!;
  if (source.startsWith('query:')) {
    const id = source.slice(6);
    const r = ctl.results.get(id);
    const tab = ctl.tabs.find((x) => x.id === id);
    if (!r || !tab) throw new Error(t('Ejecuta la consulta antes de exportarla.'));
    return { name: tab.name, columns: r.columns, rows: r.rows, numeric: r.columns.map(() => false) };
  }
  const name = source.slice(6);
  const cols = db.columns(name);
  const tab = ctl.tabs.find((x) => x.kind === 'table' && x.name === name);
  const sheet = tab ? ctl.sheetOf(tab) : null;
  const opts = visibleOnly && sheet ? { sorts: sheet.sorts, filters: sheet.filterOn ? sheet.filters : [] } : {};
  const hidden = visibleOnly && sheet ? new Set(sheet.hidden) : new Set<string>();
  const r = db.browse(name, { ...opts, limit: 5_000_000 });
  const keep = cols.map((c, i) => ({ c, i })).filter(({ c }) => !hidden.has(c.name));
  return { name, columns: keep.map(({ c }) => c.name), rows: r.rows.map((row) => keep.map(({ i }) => row[i + 1])), numeric: keep.map(({ c }) => /^(INTEGER|REAL)$/i.test(c.type)) };
}

/** Export a table or a query result as Excel, text, JSON, XML, HTML or SQL. */
export function ExportDialog({ ctl, format: f0 }: { ctl: BaseCtl; format?: ExportFormat }) {
  const db = ctl.db!;
  const cur = ctl.tab;
  const tables = db.tableNames();
  const queries = ctl.tabs.filter((x) => x.kind === 'query' && ctl.results.get(x.id));
  const first = cur?.kind === 'table' || cur?.kind === 'design' ? `table:${cur.name}` : cur?.kind === 'query' && ctl.results.get(cur.id) ? `query:${cur.id}` : tables[0] ? `table:${tables[0]}` : '';
  const [source, setSource] = useState(first);
  const [format, setFormat] = useState<ExportFormat>(f0 ?? 'xlsx');
  const [delim, setDelim] = useState(',');
  const [header, setHeader] = useState(true);
  const [visible, setVisible] = useState(true);
  const [withData, setWithData] = useState(true);
  const [allTables, setAllTables] = useState(false);
  const [msg, setMsg] = useState('');
  const isTable = source.startsWith('table:');
  const run = async () => {
    setMsg('');
    try {
      const ext = FORMATS.find((x) => x[0] === format)![2];
      const label = FORMATS.find((x) => x[0] === format)![1];
      if (format === 'sql') {
        const names = allTables ? tables : isTable ? [source.slice(6)] : [];
        if (!names.length) throw new Error(t('El script SQL se hace de tablas.'));
        const out = await saveBytes(`${safe(allTables ? (ctl.fileName ?? 'base') : names[0]!)}.sql`, enc(db.dumpSql(names, withData)), [{ name: label, extensions: [ext] }]);
        if (out) setMsg(t('Se exportó «{name}».', { name: out.name }));
        return;
      }
      const d = dataOf(ctl, source, visible);
      let bytes: Uint8Array;
      if (format === 'xlsx') {
        const wb = new Workbook();
        const sh = wb.sheets[0]!;
        sh.name = d.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '_') || 'Datos';
        let r0 = 0;
        if (header) d.columns.forEach((c, j) => wb.setValue(sh.id, 0, j, c)), (r0 = 1);
        d.rows.forEach((row, i) => row.forEach((v, j) => v !== null && v !== undefined && wb.setValue(sh.id, r0 + i, j, v instanceof Uint8Array ? `[${v.length} bytes]` : (v as string | number))));
        bytes = await writeXlsx(wb);
      } else if (format === 'csv' || format === 'tsv') {
        const text = toCsv(d.columns, d.rows, format === 'tsv' ? '\t' : delim);
        bytes = enc('﻿' + (header ? text : text.split('\r\n').slice(1).join('\r\n')));
      } else if (format === 'json') bytes = enc(toJson(d.columns, d.rows));
      else if (format === 'xml') bytes = enc(toXml(d.name, d.columns, d.rows));
      else bytes = enc(toHtml(d.name, d.columns, d.rows, d.numeric));
      const out = await saveBytes(`${safe(d.name)}.${ext}`, bytes, [{ name: label, extensions: [ext] }]);
      if (out) setMsg(t('Se exportaron {n} registros en «{name}».', { n: d.rows.length, name: out.name }));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Dlg
      title={t('Exportar')}
      onClose={() => closeX(ctl)}
      actions={
        <>
          <Button onClick={() => closeX(ctl)}>{t('Cerrar')}</Button>
          <Button appearance="primary" disabled={!source && !allTables} onClick={() => void run()}>
            {t('Exportar')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        <label>
          {t('Qué exportar')}
          <select aria-label={t('Qué exportar')} value={source} onChange={(e) => setSource(e.target.value)}>
            <optgroup label={t('Tablas')}>
              {tables.map((n) => (
                <option key={n} value={`table:${n}`}>
                  {n}
                </option>
              ))}
            </optgroup>
            {queries.length > 0 && (
              <optgroup label={t('Resultado de consultas abiertas')}>
                {queries.map((q) => (
                  <option key={q.id} value={`query:${q.id}`}>
                    {q.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label>
          {t('Formato')}
          <select aria-label={t('Formato de exportación')} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {FORMATS.map(([k, l]) => (
              <option key={k} value={k}>
                {t(l)}
              </option>
            ))}
          </select>
        </label>
        {format === 'csv' && (
          <label>
            {t('Separador')}
            <select aria-label={t('Separador')} value={delim} onChange={(e) => setDelim(e.target.value)}>
              <option value=",">{t('Coma')}</option>
              <option value=";">{t('Punto y coma')}</option>
              <option value="|">{t('Barra vertical')}</option>
            </select>
          </label>
        )}
        {(format === 'xlsx' || format === 'csv' || format === 'tsv') && (
          <label className="bs-check">
            <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> {t('Incluir los nombres de campo')}
          </label>
        )}
        {format !== 'sql' && isTable && (
          <label className="bs-check">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> {t('Solo lo que se ve en la hoja de datos (filtro, orden y columnas visibles)')}
          </label>
        )}
        {format === 'sql' && (
          <>
            <label className="bs-check">
              <input type="checkbox" checked={withData} onChange={(e) => setWithData(e.target.checked)} /> {t('Incluir los datos')}
            </label>
            <label className="bs-check">
              <input type="checkbox" checked={allTables} onChange={(e) => setAllTables(e.target.checked)} /> {t('Todas las tablas')}
            </label>
          </>
        )}
        <p className="bs-note" role="status" aria-live="polite">{msg}</p>
        <p className="bs-note">{t('Se exporta lo guardado, sin el formato de presentación. Los campos Sí/No salen como 0 y 1.')}</p>
      </div>
    </Dlg>
  );
}

// ------------------------------------------------------------------------------------------------ import

type Source = { kind: 'text'; name: string; text: string } | { kind: 'json'; name: string; columns: string[]; rows: string[][] } | { kind: 'db'; name: string; bytes: Uint8Array; tables: { name: string; rows: number; columns: number }[] };

/** Import from a text or JSON file, from the clipboard, or tables of another database. */
export function ImportDialog({ ctl, start }: { ctl: BaseCtl; start?: 'file' | 'paste' }) {
  const db = ctl.db!;
  const [src, setSrc] = useState<Source | null>(null);
  const [delim, setDelim] = useState('');
  const [header, setHeader] = useState(true);
  const [name, setName] = useState('');
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [data, setData] = useState(true);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const load = async (kind: 'file' | 'paste') => {
    setMsg('');
    try {
      if (kind === 'paste') {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) throw new Error(t('El portapapeles no tiene texto.'));
        setSrc({ kind: 'text', name: 'Datos pegados', text });
        setName('Datos_pegados');
        return;
      }
      const f = await pickAndRead([{ name: 'Texto, JSON o base de datos', extensions: ['csv', 'tsv', 'txt', 'json', 'ndjson', 'sqlite', 'sqlite3', 'db'] }]);
      if (!f) return;
      const base = f.name.replace(/\.[^.]+$/, '');
      setName(base);
      if (/\.(sqlite3?|db)$/i.test(f.name)) {
        const tables = (await import('@suitenova/base-core')).BaseDb.peek(db.SQL, f.data);
        setSrc({ kind: 'db', name: f.name, bytes: f.data, tables });
        setPick(new Set(tables.map((x) => x.name)));
      } else if (/\.(json|ndjson)$/i.test(f.name)) {
        const j = parseJson(new TextDecoder('utf-8').decode(f.data));
        setSrc({ kind: 'json', name: f.name, ...j });
      } else setSrc({ kind: 'text', name: f.name, text: new TextDecoder('utf-8').decode(f.data) });
    } catch (e) {
      setSrc(null);
      setMsg((e as Error).message);
    }
  };
  if (start && !started) {
    setStarted(true);
    void load(start);
  }

  const text = useMemo(() => {
    if (src?.kind !== 'text') return null;
    try {
      return parseCsv(src.text, delim || undefined);
    } catch {
      return null;
    }
  }, [src, delim]);
  const rows: string[][] | null = src?.kind === 'text' ? text : src?.kind === 'json' ? [src.columns, ...src.rows] : null;
  const run = () => {
    try {
      if (src?.kind === 'db') {
        const r = db.importDatabase(src.bytes, [...pick], { data });
        ctl.touch();
        if (r.tables[0]) ctl.openTable(r.tables[0]);
        setDone([t('Se importaron {n} tablas y {r} registros.', { n: r.tables.length, r: r.rows }), ...Object.entries(r.renamed).map(([a, b]) => t('«{a}» ya existía: se llama «{b}».', { a, b })), ...r.notes].join(' '));
        return;
      }
      if (!rows) return;
      const r = db.importRows(name || 'Datos', rows, { header });
      ctl.touch();
      ctl.openTable(r.table);
      setDone(t('Se importaron {n} registros en «{table}».', { n: r.rows, table: r.table }));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Dlg
      title={t('Importar datos')}
      onClose={() => closeX(ctl)}
      actions={
        <>
          <Button onClick={() => closeX(ctl)}>{done ? t('Cerrar') : t('Cancelar')}</Button>
          {!done && (
            <Button appearance="primary" disabled={!src || (src.kind === 'db' && !pick.size)} onClick={run}>
              {t('Importar')}
            </Button>
          )}
        </>
      }
    >
      <div className="bs-dlgform">
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void load('file')}>{t('Elegir archivo…')}</Button>
          <Button onClick={() => void load('paste')}>{t('Pegar del portapapeles')}</Button>
        </div>
        {src && <p className="bs-note">{src.kind === 'db' ? t('Base de datos: {name}', { name: src.name }) : src.name}</p>}
        {src?.kind === 'text' && (
          <label>
            {t('Separador')}
            <select aria-label={t('Separador de campos')} value={delim} onChange={(e) => setDelim(e.target.value)}>
              <option value="">{t('Automático')}</option>
              <option value=",">{t('Coma')}</option>
              <option value=";">{t('Punto y coma')}</option>
              <option value={'\t'}>{t('Tabulador')}</option>
              <option value="|">{t('Barra vertical')}</option>
            </select>
          </label>
        )}
        {rows && (
          <>
            <label className="bs-check">
              <input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> {t('La primera fila tiene los nombres de campo')}
            </label>
            <label>
              {t('Nombre de la tabla')}
              <input aria-label={t('Nombre de la tabla nueva')} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div style={{ maxHeight: 180, overflow: 'auto' }}>
              <table className="bs-idxlist" aria-label={t('Vista previa')}>
                <tbody>
                  {rows.slice(0, 7).map((r, i) => (
                    <tr key={i} style={i === 0 && header ? { fontWeight: 600 } : undefined}>
                      {r.slice(0, 8).map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="bs-note">{t('{n} filas', { n: rows.length })}</p>
          </>
        )}
        {src?.kind === 'db' && (
          <>
            <div role="group" aria-label={t('Tablas del archivo')} style={{ maxHeight: 200, overflow: 'auto' }}>
              {src.tables.map((x) => (
                <label key={x.name} className="bs-check" style={{ display: 'flex' }}>
                  <input type="checkbox" checked={pick.has(x.name)} onChange={(e) => setPick((p) => { const n = new Set(p); e.target.checked ? n.add(x.name) : n.delete(x.name); return n; })} /> {x.name} <small style={{ marginLeft: 6 }}>({x.rows} {t('registros')}, {x.columns} {t('campos')})</small>
                </label>
              ))}
            </div>
            <label className="bs-check">
              <input type="checkbox" checked={data} onChange={(e) => setData(e.target.checked)} /> {t('Importar también los datos (si no, solo la estructura)')}
            </label>
          </>
        )}
        <p className="bs-note" role="alert">{msg}</p>
        {done && <p role="status" aria-live="polite">{done}</p>}
        <p className="bs-note">{t('Los tipos de los campos se deducen de los datos. De otra base de datos se traen tablas con sus índices; las consultas, formularios e informes no.')}</p>
      </div>
    </Dlg>
  );
}

// ------------------------------------------------------------------------------------------------ copy a table

/** Copy a table: structure and data, only the structure, or append its records to another table. */
export function CopyTableDialog({ ctl, table }: { ctl: BaseCtl; table: string }) {
  const db = ctl.db!;
  const others = db.tableNames().filter((n) => n !== table);
  const [mode, setMode] = useState<'all' | 'structure' | 'append'>('all');
  const [name, setName] = useState(`Copia de ${table}`);
  const [dest, setDest] = useState(others[0] ?? '');
  const [msg, setMsg] = useState('');
  const run = () => {
    try {
      const r = db.copyTable(table, mode === 'append' ? dest : name.trim(), mode);
      ctl.touch();
      ctl.openTable(r.table);
      closeX(ctl);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <Dlg
      title={`${t('Copiar la tabla')} ${table}`}
      onClose={() => closeX(ctl)}
      actions={
        <>
          <Button onClick={() => closeX(ctl)}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={mode === 'append' ? !dest : !name.trim()} onClick={run}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        <div role="radiogroup" aria-label={t('Opciones de pegado')}>
          {([['all', 'Estructura y datos'], ['structure', 'Solo la estructura'], ['append', 'Anexar los datos a una tabla que existe']] as const).map(([k, l]) => (
            <label key={k} className="bs-check" style={{ display: 'flex' }}>
              <input type="radio" name="copy-mode" checked={mode === k} disabled={k === 'append' && !others.length} onChange={() => setMode(k)} /> {t(l)}
            </label>
          ))}
        </div>
        {mode !== 'append' ? (
          <label>
            {t('Nombre de la tabla nueva')}
            <input aria-label={t('Nombre de la tabla nueva')} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        ) : (
          <label>
            {t('Anexar a')}
            <select aria-label={t('Tabla de destino')} value={dest} onChange={(e) => setDest(e.target.value)}>
              {others.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="bs-note" role="alert">{msg}</p>
        <p className="bs-note">{t('Al anexar, los campos se emparejan por nombre; los que no coinciden se dejan. Las propiedades de los campos (formato, reglas…) no se copian.')}</p>
      </div>
    </Dlg>
  );
}

// ------------------------------------------------------------------------------------------------ documenter

/** Describes the whole database as a document that can be saved, printed or copied. */
export function DocumenterDialog({ ctl }: { ctl: BaseCtl }) {
  const [o, setO] = useState<DocOptions>({ tables: true, queries: true, forms: true, reports: true, code: true });
  const [msg, setMsg] = useState('');
  const html = useMemo(() => documentDatabase(ctl, o), [ctl, o, ctl.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const labels: [keyof DocOptions, string][] = [['tables', 'Tablas'], ['queries', 'Consultas'], ['forms', 'Formularios'], ['reports', 'Informes'], ['code', 'Macros y módulos']];
  return (
    <Dlg
      title={t('Documentador')}
      onClose={() => closeX(ctl)}
      actions={
        <>
          <Button
            onClick={async () => {
              const out = await saveBytes(`${safe(ctl.fileName ?? 'Base de datos')}-documentacion.html`, enc(html), [{ name: 'HTML', extensions: ['html'] }]);
              if (out) setMsg(t('Se guardó «{name}».', { name: out.name }));
            }}
          >
            {t('Guardar como HTML…')}
          </Button>
          <Button
            onClick={() => {
              const frame = document.createElement('iframe');
              frame.setAttribute('aria-hidden', 'true');
              frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
              document.body.appendChild(frame);
              frame.contentDocument!.open();
              frame.contentDocument!.write(html);
              frame.contentDocument!.close();
              setTimeout(() => {
                frame.contentWindow?.focus();
                frame.contentWindow?.print();
                setTimeout(() => frame.remove(), 60_000);
              }, 300);
            }}
          >
            {t('Imprimir')}
          </Button>
          <Button appearance="primary" onClick={() => closeX(ctl)}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <div className="bs-dlgform">
        <div role="group" aria-label={t('Qué se documenta')} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {labels.map(([k, l]) => (
            <label key={k} className="bs-check">
              <input type="checkbox" checked={o[k]} onChange={(e) => setO({ ...o, [k]: e.target.checked })} /> {t(l)}
            </label>
          ))}
        </div>
        <iframe title={t('Vista previa de la documentación')} srcDoc={html} style={{ width: '100%', height: 320, border: '1px solid rgba(128,128,128,.4)', background: '#fff' }} />
        <p className="bs-note" role="status" aria-live="polite">{msg}</p>
      </div>
    </Dlg>
  );
}
