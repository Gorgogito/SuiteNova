import { Button, Checkbox, Input, Select, Tab, TabList, Textarea } from '@fluentui/react-components';
import { ES_FUNCTIONS, formatA1, formatValue, functionRegistry, normRect, parseA1, parseFormula, resolveRangeText, type Style } from '@suitenova/calc-engine';
import { t, type CommandRegistry } from '@suitenova/core-ui';
import { useMemo, useState } from 'react';
import { FONT_NAMES, FONT_SIZES, formatLabel, numberFormats, type CalcUI, type DialogKind } from './commands';
import { CFManagerDialog, CFRuleDialog, CustomFilterDialog, type CFPreset } from './cfDialogs';
import { FUNCTION_CATEGORIES, FUNCTION_DOCS } from './functionDocs';
import { Modal, field, focusGridSoon } from './modal';
import { ChartFormatDialog } from './dlg-chart';
import { EntryAlertDialog, HyperlinkDialog, NoteDialog, ValidationDialog } from './dlg-data';
import { MacroEditorDialog, MacroListDialog } from './dlg-macros';
import { PageSetupDialog, PrintPreviewDialog } from './dlg-page';
import { PivotCreateDialog, PivotFieldDialog, PivotOptionsDialog, ValueFieldDialog } from './dlg-pivot';
import { SlicerDialog, SparklineDialog, TableCreateDialog, TableResizeDialog } from './dlg-table';


// -------------------------------------------------------------------------------------------- find / replace
function FindDialog({ ui, replace, onClose }: { ui: CalcUI; replace: boolean; onClose: () => void }) {
  const d = ui.doc;
  const [query, setQuery] = useState('');
  const [rep, setRep] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const [inFormulas, setInFormulas] = useState(false);
  const [allSheets, setAllSheets] = useState(false);
  const [msg, setMsg] = useState('');
  const opts = { matchCase, wholeCell, inFormulas, allSheets };
  return (
    <Modal
      title={replace ? t('Reemplazar') : t('Buscar')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={() => setMsg(d.findNext(query, opts) ? '' : t('No se encontró el texto.'))}>{t('Buscar siguiente')}</Button>
          <Button onClick={() => setMsg(d.findNext(query, { ...opts, backwards: true }) ? '' : t('No se encontró el texto.'))}>{t('Buscar anterior')}</Button>
          {replace && (
            <Button
              onClick={() => {
                const n = d.replaceAll(query, rep, opts);
                setMsg(n ? t('Se reemplazaron {n} celdas.', { n }) : t('No se encontró el texto.'));
              }}
            >
              {t('Reemplazar todo')}
            </Button>
          )}
          <Button appearance="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="find-q">{t('Buscar')}</label>
        <Input id="find-q" autoFocus value={query} onChange={(_e, v) => setQuery(v.value)} onKeyDown={(e) => e.key === 'Enter' && setMsg(d.findNext(query, opts) ? '' : t('No se encontró el texto.'))} />
      </div>
      {replace && (
        <div style={field}>
          <label htmlFor="find-r">{t('Reemplazar con')}</label>
          <Input id="find-r" value={rep} onChange={(_e, v) => setRep(v.value)} />
        </div>
      )}
      <Checkbox label={t('Coincidir mayúsculas y minúsculas')} checked={matchCase} onChange={(_e, v) => setMatchCase(!!v.checked)} />
      <Checkbox label={t('Coincidir con el contenido de toda la celda')} checked={wholeCell} onChange={(_e, v) => setWholeCell(!!v.checked)} />
      <Checkbox label={t('Buscar en fórmulas')} checked={inFormulas} onChange={(_e, v) => setInFormulas(!!v.checked)} />
      <Checkbox label={t('En todas las hojas')} checked={allSheets} onChange={(_e, v) => setAllSheets(!!v.checked)} />
      <p role="status" style={{ minHeight: 20, color: 'var(--colorNeutralForeground3)' }}>
        {msg}
      </p>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- go to
function GoToDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const go = () => {
    if (ui.doc.goTo(text)) {
      onClose();
      focusGridSoon();
    } else setErr(t('La referencia no es válida.'));
  };
  const names = [...ui.doc.wb.names.values()];
  return (
    <Modal title={t('Ir a')} onClose={onClose} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" onClick={go}>{t('Aceptar')}</Button></>}>
      <div style={field}>
        <label htmlFor="goto">{t('Referencia (A1, B2:D9, Hoja2!C3 o un nombre)')}</label>
        <Input id="goto" autoFocus value={text} onChange={(_e, v) => { setText(v.value); setErr(''); }} onKeyDown={(e) => e.key === 'Enter' && go()} />
      </div>
      {err && <p role="alert" style={{ color: 'var(--colorPaletteRedForeground1)' }}>{err}</p>}
      {names.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {names.map((n) => (
            <li key={n.name}>
              <a href="#goto" onClick={(e) => { e.preventDefault(); setText(n.name); }}>{n.name}</a> – {n.text}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- format cells
const H_ALIGN = [['general', 'General'], ['left', 'Izquierda'], ['center', 'Centrar'], ['right', 'Derecha']] as const;
const V_ALIGN = [['top', 'Superior'], ['middle', 'Centrar'], ['bottom', 'Inferior']] as const;

function FormatDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const cur = d.currentStyle();
  const [tab, setTab] = useState('number');
  const [numFmt, setNumFmt] = useState(cur.numFmt ?? 'General');
  const [hAlign, setHAlign] = useState<string>(cur.hAlign ?? 'general');
  const [vAlign, setVAlign] = useState<string>(cur.vAlign ?? 'bottom');
  const [wrap, setWrap] = useState(!!cur.wrap);
  const [indent, setIndent] = useState(cur.indent ?? 0);
  const [fontName, setFontName] = useState(cur.fontName ?? d.wb.defaultFont.name);
  const [fontSize, setFontSize] = useState(cur.fontSize ?? d.wb.defaultFont.size);
  const [bold, setBold] = useState(!!cur.bold);
  const [italic, setItalic] = useState(!!cur.italic);
  const [underline, setUnderline] = useState(!!cur.underline);
  const [strike, setStrike] = useState(!!cur.strike);
  const [color, setColor] = useState(cur.color ?? '#000000');
  const [useColor, setUseColor] = useState(!!cur.color);
  const [bg, setBg] = useState(cur.bg ?? '#ffff00');
  const [useBg, setUseBg] = useState(!!cur.bg);

  const sample = d.wb.getValue(d.activeSheetId, d.sel.active.row, d.sel.active.col);
  const fmts = numberFormats(d.locale);
  const preview = formatValue(sample === null ? 1234.5 : sample, numFmt === 'General' ? undefined : numFmt, d.locale).text;

  const apply = () => {
    const patch: Partial<Record<keyof Style, unknown>> = {
      numFmt: numFmt === 'General' || numFmt === '' ? undefined : numFmt,
      hAlign: hAlign === 'general' ? undefined : hAlign,
      vAlign: vAlign === 'bottom' ? undefined : vAlign,
      wrap: wrap || undefined,
      indent: indent || undefined,
      fontName: fontName === d.wb.defaultFont.name ? undefined : fontName,
      fontSize: fontSize === d.wb.defaultFont.size ? undefined : fontSize,
      bold: bold || undefined,
      italic: italic || undefined,
      underline: underline || undefined,
      strike: strike || undefined,
      color: useColor ? color : undefined,
      bg: useBg ? bg : undefined,
    };
    d.applyStyle(patch, 'Formato de celdas');
    onClose();
    focusGridSoon();
  };

  return (
    <Modal title={t('Formato de celdas')} onClose={onClose} width={560} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" onClick={apply}>{t('Aceptar')}</Button></>}>
      <TabList selectedValue={tab} onTabSelect={(_e, v) => setTab(String(v.value))} style={{ marginBottom: 12 }}>
        <Tab value="number">{t('Número')}</Tab>
        <Tab value="align">{t('Alineación')}</Tab>
        <Tab value="font">{t('Fuente')}</Tab>
        <Tab value="fill">{t('Relleno')}</Tab>
      </TabList>
      {tab === 'number' && (
        <div>
          <div style={field}>
            <label htmlFor="fmt-cat">{t('Categoría')}</label>
            <Select id="fmt-cat" value={Object.entries(fmts).find(([, f]) => (f.code ?? 'General') === numFmt)?.[0] ?? '__custom'} onChange={(_e, v) => v.value !== '__custom' && setNumFmt(fmts[v.value]!.code ?? 'General')}>
              {Object.entries(fmts).map(([k, f]) => (
                <option key={k} value={k}>{t(f.label)}</option>
              ))}
              <option value="__custom">{t('Personalizada')}</option>
            </Select>
          </div>
          <div style={field}>
            <label htmlFor="fmt-code">{t('Código de formato')}</label>
            <Input id="fmt-code" value={numFmt} onChange={(_e, v) => setNumFmt(v.value)} />
            <small style={{ color: 'var(--colorNeutralForeground3)' }}>{t('Ejemplos: 0.00 · #,##0 · 0% · dd/mm/yyyy · "Total: "0')}</small>
          </div>
          <p>
            {t('Vista previa')}: <strong>{preview}</strong> <small>({t(formatLabel(numFmt === 'General' ? undefined : numFmt, d.locale))})</small>
          </p>
        </div>
      )}
      {tab === 'align' && (
        <div>
          <div style={field}>
            <label>{t('Horizontal')}</label>
            <Select value={hAlign} onChange={(_e, v) => setHAlign(v.value)}>
              {H_ALIGN.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </Select>
          </div>
          <div style={field}>
            <label>{t('Vertical')}</label>
            <Select value={vAlign} onChange={(_e, v) => setVAlign(v.value)}>
              {V_ALIGN.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </Select>
          </div>
          <div style={field}>
            <label htmlFor="indent">{t('Sangría')}</label>
            <Input id="indent" type="number" min={0} max={15} value={String(indent)} onChange={(_e, v) => setIndent(Math.max(0, Math.min(15, Number(v.value) || 0)))} />
          </div>
          <Checkbox label={t('Ajustar texto')} checked={wrap} onChange={(_e, v) => setWrap(!!v.checked)} />
        </div>
      )}
      {tab === 'font' && (
        <div>
          <div style={field}>
            <label>{t('Fuente')}</label>
            <Select value={fontName} onChange={(_e, v) => setFontName(v.value)}>
              {(FONT_NAMES.includes(fontName) ? FONT_NAMES : [fontName, ...FONT_NAMES]).map((n) => <option key={n}>{n}</option>)}
            </Select>
          </div>
          <div style={field}>
            <label>{t('Tamaño')}</label>
            <Select value={String(fontSize)} onChange={(_e, v) => setFontSize(Number(v.value))}>
              {(FONT_SIZES.includes(fontSize) ? FONT_SIZES : [...FONT_SIZES, fontSize].sort((a, b) => a - b)).map((s) => <option key={s}>{s}</option>)}
            </Select>
          </div>
          <Checkbox label={t('Negrita')} checked={bold} onChange={(_e, v) => setBold(!!v.checked)} />
          <Checkbox label={t('Cursiva')} checked={italic} onChange={(_e, v) => setItalic(!!v.checked)} />
          <Checkbox label={t('Subrayado')} checked={underline} onChange={(_e, v) => setUnderline(!!v.checked)} />
          <Checkbox label={t('Tachado')} checked={strike} onChange={(_e, v) => setStrike(!!v.checked)} />
          <div style={{ ...field, marginTop: 10 }}>
            <Checkbox label={t('Color de fuente')} checked={useColor} onChange={(_e, v) => setUseColor(!!v.checked)} />
            <input type="color" value={color} disabled={!useColor} onChange={(e) => setColor(e.target.value)} aria-label={t('Color de fuente')} />
          </div>
        </div>
      )}
      {tab === 'fill' && (
        <div style={field}>
          <Checkbox label={t('Color de relleno')} checked={useBg} onChange={(_e, v) => setUseBg(!!v.checked)} />
          <input type="color" value={bg} disabled={!useBg} onChange={(e) => setBg(e.target.value)} aria-label={t('Color de relleno')} />
        </div>
      )}
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- names
function NamesDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const [, bump] = useState(0);
  const sel = normRect(d.activeRange);
  const q = /^[A-Za-z_][\w.]*$/.test(d.sheet.name) ? d.sheet.name : `'${d.sheet.name.replace(/'/g, "''")}'`;
  const refText = `${q}!${formatA1(sel.r1, sel.c1, true, true)}${sel.r1 === sel.r2 && sel.c1 === sel.c2 ? '' : ':' + formatA1(sel.r2, sel.c2, true, true)}`;
  const [name, setName] = useState('');
  const [scope, setScope] = useState('wb');
  const [refers, setRefers] = useState(refText);
  const [err, setErr] = useState('');
  const rows = [
    ...[...d.wb.names.values()].map((n) => ({ name: n.name, text: n.text, scope: 'wb', label: t('Libro') })),
    ...d.wb.sheets.flatMap((s) => [...s.names.values()].map((n) => ({ name: n.name, text: n.text, scope: String(s.id), label: s.name }))),
  ];
  const save = (n: string, sc: string, text: string): string | null => {
    const sheetId = sc === 'wb' ? undefined : Number(sc);
    if (!/^[A-Za-z_À-￿][\w.À-￿]*$/.test(n) || parseA1(n) || functionRegistry.has(n.toUpperCase())) return t('El nombre no es válido.');
    try {
      parseFormula(text.replace(/^=/, ''));
    } catch {
      return t('La fórmula del nombre no es válida.');
    }
    d.wb.defineName(n, text, sheetId);
    d.dirty = true;
    d.touch();
    bump((x) => x + 1);
    return null;
  };
  return (
    <Modal title={t('Administrador de nombres')} onClose={onClose} width={680} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <th>{t('Nombre')}</th>
            <th>{t('Se refiere a')}</th>
            <th>{t('Ámbito')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: 'var(--colorNeutralForeground3)' }}>{t('Todavía no hay nombres definidos.')}</td>
            </tr>
          )}
          {rows.map((n) => (
            <tr key={`${n.scope}:${n.name}`}>
              <td>{n.name}</td>
              <td>
                <Input
                  size="small"
                  aria-label={t('Se refiere a: {name}', { name: n.name })}
                  defaultValue={`=${n.text}`}
                  onBlur={(e) => {
                    if (e.currentTarget.value === `=${n.text}`) return;
                    const problem = save(n.name, n.scope, e.currentTarget.value);
                    if (problem) setErr(problem);
                  }}
                />
              </td>
              <td>{n.label}</td>
              <td>
                <Button size="small" onClick={() => { d.wb.removeName(n.name, n.scope === 'wb' ? undefined : Number(n.scope)); d.dirty = true; d.touch(); bump((x) => x + 1); }}>{t('Eliminar')}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <fieldset style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, padding: 8 }}>
        <legend>{t('Nuevo nombre')}</legend>
        <div style={field}>
          <label htmlFor="nm">{t('Nombre')}</label>
          <Input id="nm" value={name} onChange={(_e, v) => { setName(v.value); setErr(''); }} />
        </div>
        <div style={field}>
          <label htmlFor="nm-scope">{t('Ámbito')}</label>
          <Select id="nm-scope" value={scope} onChange={(_e, v) => setScope(v.value)}>
            <option value="wb">{t('Libro')}</option>
            {d.wb.sheets.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div style={field}>
          <label htmlFor="nm-ref">{t('Se refiere a')}</label>
          <Input id="nm-ref" value={refers} onChange={(_e, v) => { setRefers(v.value); setErr(''); }} />
        </div>
        <Button
          onClick={() => {
            const problem = save(name.trim(), scope, refers);
            if (problem) setErr(problem);
            else {
              setName('');
              setErr('');
            }
          }}
        >
          {t('Definir')}
        </Button>
        {err && <small role="alert" style={{ color: 'var(--colorPaletteRedForeground1)', display: 'block' }}>{err}</small>}
      </fieldset>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- sort
function SortDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const r = d.activeRange;
  const single = r.r1 === r.r2 && r.c1 === r.c2;
  const rect = single ? (d.usedBlock() ?? r) : r;
  const [header, setHeader] = useState(d.looksLikeHeader(rect));
  const [col, setCol] = useState(Math.min(Math.max(d.sel.active.col, rect.c1), rect.c2));
  const [asc, setAsc] = useState(true);
  const cols = Array.from({ length: rect.c2 - rect.c1 + 1 }, (_x, i) => rect.c1 + i);
  const label = (c: number) => {
    const letter = (n: number) => { let s = ''; let x = n + 1; while (x > 0) { s = String.fromCharCode(65 + ((x - 1) % 26)) + s; x = Math.floor((x - 1) / 26); } return s; };
    const h = header ? d.wb.getValue(d.activeSheetId, rect.r1, c) : null;
    return typeof h === 'string' && h ? `${h} (${t('Columna')} ${letter(c)})` : `${t('Columna')} ${letter(c)}`;
  };
  return (
    <Modal title={t('Ordenar')} onClose={onClose} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" onClick={() => { d.sortRange(rect, col, asc, header); onClose(); }}>{t('Aceptar')}</Button></>}>
      <Checkbox label={t('Mis datos tienen encabezados')} checked={header} onChange={(_e, v) => setHeader(!!v.checked)} />
      <div style={{ ...field, marginTop: 10 }}>
        <label>{t('Ordenar por')}</label>
        <Select value={String(col)} onChange={(_e, v) => setCol(Number(v.value))}>
          {cols.map((c) => <option key={c} value={c}>{label(c)}</option>)}
        </Select>
      </div>
      <div style={field}>
        <label>{t('Criterio')}</label>
        <Select value={asc ? 'asc' : 'desc'} onChange={(_e, v) => setAsc(v.value === 'asc')}>
          <option value="asc">{t('De menor a mayor (A a Z)')}</option>
          <option value="desc">{t('De mayor a menor (Z a A)')}</option>
        </Select>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- insert function
function FunctionDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Todas');
  const all = useMemo(() => {
    return [...functionRegistry.keys()]
      .filter((n) => !n.includes('_'))
      .map((n) => ({ name: n, local: d.locale === 'es' ? (ES_FUNCTIONS[n] ?? n) : n, doc: FUNCTION_DOCS[n] }))
      .sort((a, b) => a.local.localeCompare(b.local));
  }, [d.locale]);
  const filtered = all.filter((f) => (cat === 'Todas' || f.doc?.[0] === cat) && (!q || f.local.toLowerCase().includes(q.toLowerCase()) || f.name.toLowerCase().includes(q.toLowerCase()) || (f.doc?.[2] ?? '').toLowerCase().includes(q.toLowerCase())));
  const [sel, setSel] = useState<string | null>(null);
  const picked = filtered.find((f) => f.name === sel) ?? filtered[0];
  const insert = () => {
    if (!picked) return;
    const text = `${picked.local}(`;
    if (d.edit) {
      const e = d.edit;
      const caret = e.caret ?? e.text.length;
      const base = e.text.startsWith('=') ? e.text : `=${e.text}`;
      d.setEditText(base.slice(0, caret + (e.text.startsWith('=') ? 0 : 1)) + text + base.slice(caret + (e.text.startsWith('=') ? 0 : 1)), caret + text.length + (e.text.startsWith('=') ? 0 : 1));
    } else d.beginEdit({ text: `=${text}`, mode: 'edit' });
    onClose();
    focusGridSoon();
  };
  return (
    <Modal title={t('Insertar función')} onClose={onClose} width={620} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" disabled={!picked} onClick={insert}>{t('Insertar')}</Button></>}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Input autoFocus placeholder={t('Buscar una función')} value={q} onChange={(_e, v) => setQ(v.value)} style={{ flex: 1 }} aria-label={t('Buscar una función')} />
        <Select value={cat} onChange={(_e, v) => setCat(v.value)} aria-label={t('Categoría')}>
          {FUNCTION_CATEGORIES.map((c) => <option key={c} value={c}>{t(c)}</option>)}
        </Select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 12, height: 260 }}>
        <ul role="listbox" aria-label={t('Funciones')} style={{ margin: 0, padding: 0, listStyle: 'none', overflow: 'auto', border: '1px solid var(--colorNeutralStroke2)', borderRadius: 4 }}>
          {filtered.map((f) => (
            <li key={f.name} role="option" aria-selected={picked?.name === f.name} onClick={() => setSel(f.name)} onDoubleClick={insert} style={{ padding: '4px 8px', cursor: 'pointer', background: picked?.name === f.name ? 'var(--colorBrandBackground2)' : undefined }}>
              {f.local}
            </li>
          ))}
        </ul>
        <div>
          {picked && (
            <>
              <h3 style={{ margin: '0 0 4px' }}>{picked.local}({picked.doc?.[1] ?? '…'})</h3>
              <p>{picked.doc?.[2] ?? t('Función de Nova Calc.')}</p>
              {picked.doc && <small style={{ color: 'var(--colorNeutralForeground3)' }}>{t(picked.doc[0])}</small>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- sizes
function SizeDialog({ ui, axis, onClose }: { ui: CalcUI; axis: 'row' | 'col'; onClose: () => void }) {
  const d = ui.doc;
  const first = axis === 'row' ? d.sel.active.row : d.sel.active.col;
  // Excel units: points for rows (15 = default), characters for columns (8.43 = default)
  const curPx = axis === 'row' ? d.wb.rowHeight(d.activeSheetId, first) : d.wb.colWidth(d.activeSheetId, first);
  const [v, setV] = useState(String(axis === 'row' ? Math.round((curPx * 72) / 96 * 100) / 100 : Math.round(((curPx - 5) / 7) * 100) / 100));
  const n = Number(v.replace(',', '.'));
  const ok = Number.isFinite(n) && n > 0 && n < (axis === 'row' ? 410 : 256);
  return (
    <Modal title={axis === 'row' ? t('Alto de fila') : t('Ancho de columna')} onClose={onClose} actions={<><Button onClick={onClose}>{t('Cancelar')}</Button><Button appearance="primary" disabled={!ok} onClick={() => {
      if (axis === 'row') d.setRowHeight(d.selectedRows(), (n * 96) / 72);
      else d.setColWidth(d.selectedCols(), n * 7 + 5);
      onClose();
    }}>{t('Aceptar')}</Button></>}>
      <div style={field}>
        <label htmlFor="size">{axis === 'row' ? t('Alto de fila (puntos)') : t('Ancho de columna (caracteres)')}</label>
        <Input id="size" autoFocus value={v} onChange={(_e, x) => setV(x.value)} onKeyDown={(e) => e.key === 'Enter' && ok && (axis === 'row' ? d.setRowHeight(d.selectedRows(), (n * 96) / 72) : d.setColWidth(d.selectedCols(), n * 7 + 5), onClose())} />
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- chart data
function ChartDataDialog({ ui, onClose }: { ui: CalcUI; onClose: () => void }) {
  const d = ui.doc;
  const chart = d.chartById(d.selectedChart);
  const [series, setSeries] = useState(() => (chart ? structuredClone(chart.series) : []));
  const [title, setTitle] = useState(chart?.title ?? '');
  if (!chart) return null;
  const sheetName = d.sheet.name;
  const q = /^[A-Za-z_][\w.]*$/.test(sheetName) ? sheetName : "'" + sheetName + "'";
  const valid = (ref: string | undefined) => !ref || resolveRangeText(d.wb, ref, d.activeSheetId) !== null;
  const allValid = series.length > 0 && series.every((s) => !!s.values && valid(s.values) && valid(s.categories) && valid(s.nameRef));
  const set = (i: number, patch: Partial<(typeof series)[number]>) => setSeries((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const empty = (v: string) => v.trim() || undefined;
  const fields = [
    ['nameRef', 'Nombre de la serie (celda)'],
    ['values', 'Valores (rango)'],
    ['categories', 'Etiquetas del eje (rango)'],
  ] as const;
  return (
    <Modal
      title={t('Seleccionar origen de datos')}
      onClose={onClose}
      width={640}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!allValid}
            onClick={() => {
              d.updateChart(chart.id, { series, title: title.trim() || undefined }, 'Datos del gráfico');
              onClose();
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="ct">{t('Título')}</label>
        <Input id="ct" value={title} onChange={(_e, v) => setTitle(v.value)} />
      </div>
      {series.map((s, i) => (
        <fieldset key={i} style={{ border: '1px solid var(--colorNeutralStroke2)', borderRadius: 6, marginBottom: 10, padding: 8 }}>
          <legend>
            {t('Serie')} {i + 1}
            {series.length > 1 && (
              <Button size="small" appearance="subtle" style={{ marginLeft: 8 }} onClick={() => setSeries((all) => all.filter((_x, j) => j !== i))}>
                {t('Quitar')}
              </Button>
            )}
          </legend>
          {fields.map(([key, label]) => (
            <div style={field} key={key}>
              <label>{t(label)}</label>
              <Input value={s[key] ?? ''} onChange={(_e, v) => set(i, { [key]: key === 'values' ? v.value : empty(v.value) })} placeholder={q + '!$A$1:$A$10'} aria-invalid={!valid(s[key])} />
              {!valid(s[key]) && <small style={{ color: 'var(--colorPaletteRedForeground1)' }}>{t('La referencia no es válida.')}</small>}
            </div>
          ))}
        </fieldset>
      ))}
      <Button onClick={() => setSeries((all) => [...all, { values: '' }])}>{t('Agregar serie')}</Button>
    </Modal>
  );
}

// -------------------------------------------------------------------------------------------- info
function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t('Acerca de Nova Calc')} onClose={onClose} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
      <p><strong>Nova Calc</strong> · SuiteNova 0.1</p>
      <p>{t('Hoja de cálculo libre (MPL-2.0). Lee y escribe archivos .xlsx (Office Open XML) y CSV.')}</p>
      <p style={{ color: 'var(--colorNeutralForeground3)' }}>{t('Las macros son de Nova Basic (un subconjunto de VBA): un proyecto de VBA de Excel no se importa. Las tablas dinámicas y las segmentaciones se guardan para Nova Calc; Excel muestra sus valores.')}</p>
    </Modal>
  );
}

function ShortcutsDialog({ registry, onClose }: { registry: CommandRegistry; onClose: () => void }) {
  const rows = registry
    .all()
    .map((c) => ({ c, sc: registry.shortcutLabel(c.id) }))
    .filter((r) => r.sc)
    .sort((a, b) => t(a.c.label).localeCompare(t(b.c.label)));
  return (
    <Modal title={t('Atajos de teclado')} onClose={onClose} width={560} actions={<Button appearance="primary" onClick={onClose}>{t('Cerrar')}</Button>}>
      <div style={{ maxHeight: 360, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {rows.map(({ c, sc }) => (
              <tr key={c.id}>
                <td style={{ padding: '3px 12px 3px 0' }}>{t(c.label)}</td>
                <td><kbd>{sc}</kbd></td>
              </tr>
            ))}
            <tr><td style={{ padding: '3px 12px 3px 0' }}>{t('Copiar / Cortar / Pegar')}</td><td><kbd>Ctrl+C / Ctrl+X / Ctrl+V</kbd></td></tr>
            <tr><td style={{ padding: '3px 12px 3px 0' }}>{t('Editar celda')}</td><td><kbd>F2</kbd></td></tr>
            <tr><td style={{ padding: '3px 12px 3px 0' }}>{t('Ir al borde de los datos')}</td><td><kbd>Ctrl+←↑→↓</kbd></td></tr>
            <tr><td style={{ padding: '3px 12px 3px 0' }}>{t('Navegar por la cinta')}</td><td><kbd>Alt</kbd></td></tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function DialogHost({ ui, registry, kind, arg, onClose }: { ui: CalcUI; registry: CommandRegistry; kind: DialogKind | null; arg?: unknown; onClose: () => void }) {
  // a typed value that breaks a validation rule waits for an answer, whatever else is open
  const alert = <EntryAlertDialog ui={ui} />;
  if (!kind) return alert;
  const close = () => {
    onClose();
    focusGridSoon();
  };
  switch (kind) {
    case 'find':
      return <FindDialog ui={ui} replace={false} onClose={close} />;
    case 'replace':
      return <FindDialog ui={ui} replace onClose={close} />;
    case 'goto':
      return <GoToDialog ui={ui} onClose={close} />;
    case 'format':
      return <FormatDialog ui={ui} onClose={close} />;
    case 'names':
      return <NamesDialog ui={ui} onClose={close} />;
    case 'sort':
      return <SortDialog ui={ui} onClose={close} />;
    case 'function':
      return <FunctionDialog ui={ui} onClose={close} />;
    case 'rowHeight':
      return <SizeDialog ui={ui} axis="row" onClose={close} />;
    case 'colWidth':
      return <SizeDialog ui={ui} axis="col" onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'chartData':
      return <ChartDataDialog ui={ui} onClose={close} />;
    case 'cfRule': {
      const a = (arg ?? {}) as { preset?: CFPreset; editId?: string };
      return <CFRuleDialog ui={ui} preset={a.preset} editId={a.editId} onClose={close} />;
    }
    case 'cfManager':
      return <CFManagerDialog ui={ui} onClose={close} onEdit={(id) => ui.openDialog('cfRule', { editId: id })} />;
    case 'customFilter':
      return <CustomFilterDialog ui={ui} col={Number(arg ?? 0)} onClose={close} />;
    case 'shortcuts':
      return <ShortcutsDialog registry={registry} onClose={close} />;
    case 'chartFormat':
      return <ChartFormatDialog ui={ui} onClose={close} />;
    case 'validation':
      return <ValidationDialog ui={ui} onClose={close} />;
    case 'hyperlink':
      return <HyperlinkDialog ui={ui} onClose={close} />;
    case 'note':
      return <NoteDialog ui={ui} onClose={close} />;
    case 'tableCreate':
      return <TableCreateDialog ui={ui} onClose={close} />;
    case 'tableResize':
      return <TableResizeDialog ui={ui} onClose={close} />;
    case 'sparkline':
      return <SparklineDialog ui={ui} type={(arg as 'line' | 'column' | 'winloss') ?? 'line'} onClose={close} />;
    case 'slicer':
      return <SlicerDialog ui={ui} onClose={close} />;
    case 'pivotCreate':
      return <PivotCreateDialog ui={ui} onClose={close} />;
    case 'pivotOptions':
      return <PivotOptionsDialog ui={ui} pivotId={String(arg)} onClose={close} />;
    case 'pivotValue': {
      const a = arg as { pivotId: string; index: number };
      return <ValueFieldDialog ui={ui} pivotId={a.pivotId} index={a.index} onClose={close} />;
    }
    case 'pivotField': {
      const a = arg as { pivotId: string; field: string };
      return <PivotFieldDialog ui={ui} pivotId={a.pivotId} fieldName={a.field} onClose={close} />;
    }
    case 'pageSetup':
      return <PageSetupDialog ui={ui} onClose={close} onPreview={() => ui.openDialog('printPreview')} />;
    case 'printPreview':
      return <PrintPreviewDialog ui={ui} onClose={close} onSetup={() => ui.openDialog('pageSetup')} />;
    case 'macros':
      return <MacroListDialog ui={ui} onClose={close} onEdit={() => ui.openDialog('macroEditor')} />;
    case 'macroEditor':
      return <MacroEditorDialog ui={ui} onClose={close} />;
  }
}

void Textarea;
