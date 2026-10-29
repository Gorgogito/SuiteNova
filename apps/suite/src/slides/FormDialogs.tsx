import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { applyHeaderFooter, docText, headerFooterOf, newChart, newTable, SAMPLE_CHART, updateElement, type ChartModel, type ChartSeries, type Hyperlink, type HeaderFooterSpec, type SlideElement } from '@suitenova/slides-core';
import { useMemo, useState } from 'react';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { applyRun } from './textcmds';

type P = { ui: SlidesUI; onClose: () => void; arg?: unknown };

// ------------------------------------------------------------------------------------------------ hyperlink

type Kind = 'web' | 'slide' | 'mail';

const SPECIAL: { id: string; label: string }[] = [
  { id: 'next', label: 'Diapositiva siguiente' },
  { id: 'prev', label: 'Diapositiva anterior' },
  { id: 'first', label: 'Primera diapositiva' },
  { id: 'last', label: 'Última diapositiva' },
  { id: 'end', label: 'Finalizar la presentación' },
];

function initialLink(ui: SlidesUI): Hyperlink | undefined {
  const c = ui.ctl;
  if (c.editor) return ui.runProps().hlink;
  const el = c.selected[0] as (SlideElement & { hlink?: Hyperlink }) | undefined;
  if (!el) return undefined;
  return el.hlink ?? (el.kind === 'shape' ? ui.runProps().hlink : undefined);
}

export function HyperlinkDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const cur = useMemo(() => initialLink(ui), []); // eslint-disable-line react-hooks/exhaustive-deps
  const startKind: Kind = cur?.slide ? 'slide' : cur?.url?.startsWith('mailto:') ? 'mail' : 'web';
  const [kind, setKind] = useState<Kind>(startKind);
  const [url, setUrl] = useState(cur?.url && !cur.url.startsWith('mailto:') ? cur.url : '');
  const mailParts = cur?.url?.startsWith('mailto:') ? cur.url.slice(7).split('?subject=') : ['', ''];
  const [mail, setMail] = useState(decodeURIComponent(mailParts[0] ?? ''));
  const [subject, setSubject] = useState(decodeURIComponent(mailParts[1] ?? ''));
  const [slide, setSlide] = useState(cur?.slide ?? 'next');
  const [tip, setTip] = useState(cur?.tooltip ?? '');
  const editorEmpty = !!c.editor && c.editor.state.selection.empty;
  const [label, setLabel] = useState('');

  const target = (): Hyperlink | null => {
    const base = tip ? { tooltip: tip } : {};
    if (kind === 'web') {
      const u = url.trim();
      if (!u) return null;
      return { url: /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`, ...base };
    }
    if (kind === 'mail') {
      const m = mail.trim();
      if (!m) return null;
      return { url: `mailto:${encodeURIComponent(m).replace(/%40/g, '@')}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`, ...base };
    }
    return { slide, ...base };
  };
  const ok = target() !== null;

  const apply = (h: Hyperlink | null) => {
    if (c.editor) {
      const view = c.editor;
      if (h && editorEmpty) {
        // no text selected: the link text is what the dialog asks for (or the address)
        const text = label.trim() || h.url?.replace(/^mailto:/, '') || t('Enlace');
        const mark = view.state.schema.marks.run!.create({ r: { hlink: h } });
        view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text(text, [mark]), false));
        view.focus();
      } else applyRun(c, (r) => ({ ...r, hlink: h ?? undefined }), 'Hipervínculo');
    } else if (c.selected.length) {
      const el = c.selected[0]!;
      // a shape with text: the link goes on its text; any other object (or an empty shape) takes the link itself
      if (el.kind === 'shape' && el.text && docText(el.text.doc).trim()) applyRun(c, (r) => ({ ...r, hlink: h ?? undefined }), 'Hipervínculo');
      else c.patchSelected('Hipervínculo', (e) => ({ ...e, hlink: h ?? undefined }) as SlideElement);
    }
    onClose();
  };

  return (
    <Modal
      title={t('Insertar hipervínculo')}
      onClose={onClose}
      actions={
        <>
          {cur && <Button onClick={() => apply(null)}>{t('Quitar vínculo')}</Button>}
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={() => apply(target())}>{t('Aceptar')}</Button>
        </>
      }
    >
      <form className="sl-form" onSubmit={(e) => (e.preventDefault(), ok && apply(target()))}>
        <div role="radiogroup" aria-label={t('Vincular a')} className="sl-form__row">
          {([['web', 'Página web o archivo'], ['slide', 'Lugar de este documento'], ['mail', 'Correo electrónico']] as const).map(([k, l]) => (
            <label key={k} className="sl-check">
              <input type="radio" name="hl-kind" checked={kind === k} onChange={() => setKind(k)} />
              {t(l)}
            </label>
          ))}
        </div>
        {editorEmpty && (
          <label className="sl-field">
            <span>{t('Texto para mostrar')}</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        )}
        {kind === 'web' && (
          <label className="sl-field">
            <span>{t('Dirección')}</span>
            <input autoFocus value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
          </label>
        )}
        {kind === 'mail' && (
          <>
            <label className="sl-field">
              <span>{t('Dirección de correo')}</span>
              <input autoFocus type="email" value={mail} onChange={(e) => setMail(e.target.value)} />
            </label>
            <label className="sl-field">
              <span>{t('Asunto')}</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
          </>
        )}
        {kind === 'slide' && (
          <label className="sl-field">
            <span>{t('Ir a')}</span>
            <select value={slide} onChange={(e) => setSlide(e.target.value)} aria-label={t('Ir a')}>
              <optgroup label={t('Posición')}>
                {SPECIAL.map((s) => (
                  <option key={s.id} value={s.id}>{t(s.label)}</option>
                ))}
              </optgroup>
              <optgroup label={t('Títulos de diapositiva')}>
                {c.deck.slides.map((s, i) => (
                  <option key={s.id} value={s.id}>{i + 1}. {titleOfSlide(s) || t('(sin título)')}</option>
                ))}
              </optgroup>
            </select>
          </label>
        )}
        <label className="sl-field">
          <span>{t('Información en pantalla')}</span>
          <input value={tip} onChange={(e) => setTip(e.target.value)} />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function titleOfSlide(s: { shapes: SlideElement[] }): string {
  for (const e of s.shapes) if (e.kind === 'shape' && e.ph && (e.ph.type === 'title' || e.ph.type === 'ctrTitle') && e.text) return docText(e.text.doc).slice(0, 50);
  return '';
}

// ------------------------------------------------------------------------------------------------ table

export function TableDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(4);
  const ok = rows >= 1 && rows <= 50 && cols >= 1 && cols <= 30;
  const insert = () => {
    const w = c.deck.size.w * 0.8;
    const rowH = Math.min(37, (c.deck.size.h * 0.7) / rows);
    const tb = newTable(rows, cols, (c.deck.size.w - w) / 2, c.deck.size.h * 0.3, w, rowH);
    c.addElement(tb);
    onClose();
  };
  return (
    <Modal
      title={t('Insertar tabla')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={insert}>{t('Aceptar')}</Button>
        </>
      }
    >
      <form className="sl-form" onSubmit={(e) => (e.preventDefault(), ok && insert())}>
        <label className="sl-field">
          <span>{t('Número de columnas')}</span>
          <input type="number" min={1} max={30} value={cols} autoFocus onChange={(e) => setCols(Math.round(Number(e.target.value)))} />
        </label>
        <label className="sl-field">
          <span>{t('Número de filas')}</span>
          <input type="number" min={1} max={50} value={rows} onChange={(e) => setRows(Math.round(Number(e.target.value)))} />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ chart

const CHART_TYPES: { id: string; label: string; kind: string; barDir?: 'col' | 'bar'; grouping?: string }[] = [
  { id: 'col', label: 'Columnas agrupadas', kind: 'bar', barDir: 'col', grouping: 'clustered' },
  { id: 'colStack', label: 'Columnas apiladas', kind: 'bar', barDir: 'col', grouping: 'stacked' },
  { id: 'bar', label: 'Barras agrupadas', kind: 'bar', barDir: 'bar', grouping: 'clustered' },
  { id: 'barStack', label: 'Barras apiladas', kind: 'bar', barDir: 'bar', grouping: 'stacked' },
  { id: 'line', label: 'Líneas', kind: 'line', grouping: 'standard' },
  { id: 'area', label: 'Áreas', kind: 'area', grouping: 'standard' },
  { id: 'pie', label: 'Circular', kind: 'pie' },
  { id: 'doughnut', label: 'Anillos', kind: 'doughnut' },
  { id: 'radar', label: 'Radial', kind: 'radar' },
  { id: 'scatter', label: 'Dispersión (XY)', kind: 'scatter' },
];

const typeIdOf = (m: ChartModel): string => CHART_TYPES.find((x) => x.kind === m.kind.replace(/3D$/, '') && (x.kind !== 'bar' || (x.barDir === (m.barDir ?? 'col') && x.grouping === (m.grouping === 'stacked' || m.grouping === 'percentStacked' ? 'stacked' : 'clustered'))))?.id ?? 'col';

/** The data of a chart as a sheet: first column categories (or X values), then one column per series. */
function toGrid(m: ChartModel): string[][] {
  const scatter = m.kind === 'scatter';
  const n = Math.max(m.categories.length, ...m.series.map((s) => s.values.length), scatter ? Math.max(0, ...m.series.map((s) => s.xValues?.length ?? 0)) : 0);
  const head = ['', ...m.series.map((s) => s.name)];
  const rows: string[][] = [];
  for (let i = 0; i < n; i++) rows.push([scatter ? String(m.series[0]?.xValues?.[i] ?? '') : (m.categories[i] ?? ''), ...m.series.map((s) => (s.values[i] === null || s.values[i] === undefined ? '' : String(s.values[i])))]);
  return [head, ...rows];
}

function fromGrid(base: ChartModel, grid: string[][], kind: string): { cats: string[]; series: ChartSeries[] } {
  const [head, ...rows] = grid;
  const num = (s: string): number | null => {
    const v = Number(s.replace(',', '.'));
    return s.trim() === '' || !Number.isFinite(v) ? null : v;
  };
  const used = rows.filter((r) => r.some((x) => x.trim() !== ''));
  const series: ChartSeries[] = head!.slice(1).map((name, j) => {
    const old = base.series[j];
    return { ...(old ?? {}), name: name || `Serie ${j + 1}`, values: used.map((r) => num(r[j + 1] ?? '')), ...(kind === 'scatter' ? { xValues: used.map((r) => num(r[0] ?? '')) } : { xValues: undefined }) };
  });
  return { cats: used.map((r) => r[0] ?? ''), series };
}

export function ChartDialog({ ui, onClose, arg }: P) {
  const c = ui.ctl;
  const existing = typeof arg === 'string' ? (c.element(arg) as Extract<SlideElement, { kind: 'chart' }> | null) : null;
  const base: ChartModel = existing?.chart ?? SAMPLE_CHART;
  const [type, setType] = useState(typeIdOf(base));
  const [grid, setGrid] = useState<string[][]>(() => toGrid(base));
  const [title, setTitle] = useState(base.title ?? '');
  const [legend, setLegend] = useState<string>(base.legend === undefined ? 'b' : (base.legend ?? 'none'));

  const setCell = (r: number, k: number, v: string) => setGrid((g) => g.map((row, i) => (i === r ? row.map((x, j) => (j === k ? v : x)) : row)));
  const addRow = () => setGrid((g) => [...g, g[0]!.map(() => '')]);
  const addCol = () => setGrid((g) => g.map((row, i) => [...row, i === 0 ? `Serie ${row.length}` : '']));
  const delRow = () => setGrid((g) => (g.length > 2 ? g.slice(0, -1) : g));
  const delCol = () => setGrid((g) => (g[0]!.length > 2 ? g.map((row) => row.slice(0, -1)) : g));

  const ct = CHART_TYPES.find((x) => x.id === type)!;
  const ok = grid.length > 1 && grid[0]!.length > 1;
  const commit = () => {
    const { cats, series } = fromGrid(base, grid, ct.kind);
    const model: ChartModel = {
      ...base,
      kind: ct.kind,
      barDir: ct.barDir,
      grouping: ct.grouping,
      categories: cats,
      series,
      title: title || undefined,
      legend: legend === 'none' ? null : (legend as ChartModel['legend']),
      varyColors: ct.kind === 'pie' || ct.kind === 'doughnut' ? true : base.varyColors,
    };
    if (existing) c.apply('Cambiar gráfico', (d) => updateElement(d, c.slide.id, existing.id, (e) => ({ ...e, chart: model, raw: undefined }) as SlideElement));
    else {
      const w = c.deck.size.w * 0.7;
      const h = c.deck.size.h * 0.65;
      c.addElement(newChart(model, (c.deck.size.w - w) / 2, c.deck.size.h * 0.25, w, h));
    }
    onClose();
  };

  return (
    <Modal
      wide
      title={existing ? t('Editar el gráfico') : t('Insertar gráfico')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={commit}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Tipo de gráfico')}</span>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('Tipo de gráfico')}>
              {CHART_TYPES.map((x) => (
                <option key={x.id} value={x.id}>{t(x.label)}</option>
              ))}
            </select>
          </label>
          <label className="sl-field">
            <span>{t('Título del gráfico')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="sl-field">
            <span>{t('Leyenda')}</span>
            <select value={legend} onChange={(e) => setLegend(e.target.value)} aria-label={t('Leyenda')}>
              <option value="none">{t('Sin leyenda')}</option>
              <option value="b">{t('Abajo')}</option>
              <option value="t">{t('Arriba')}</option>
              <option value="r">{t('A la derecha')}</option>
              <option value="l">{t('A la izquierda')}</option>
            </select>
          </label>
        </div>
        <div className="sl-sheet" role="grid" aria-label={t('Datos del gráfico')}>
          <table>
            <thead>
              <tr>
                <th aria-hidden="true" />
                {grid[0]!.map((h, k) => (
                  <th key={k}>
                    {k === 0 ? (
                      <span>{ct.kind === 'scatter' ? t('Valores X') : t('Categorías')}</span>
                    ) : (
                      <input aria-label={t('Nombre de la serie {n}', { n: k })} value={h} onChange={(e) => setCell(0, k, e.target.value)} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.slice(1).map((row, i) => (
                <tr key={i}>
                  <th scope="row">{i + 1}</th>
                  {row.map((v, k) => (
                    <td key={k}>
                      <input aria-label={t('Fila {r}, columna {c}', { r: i + 1, c: k + 1 })} value={v} inputMode={k === 0 && ct.kind !== 'scatter' ? 'text' : 'decimal'} onChange={(e) => setCell(i + 1, k, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sl-form__row">
          <Button size="small" onClick={addRow}>{t('Agregar fila')}</Button>
          <Button size="small" onClick={delRow} disabled={grid.length <= 2}>{t('Quitar la última fila')}</Button>
          <Button size="small" onClick={addCol}>{t('Agregar serie')}</Button>
          <Button size="small" onClick={delCol} disabled={grid[0]!.length <= 2}>{t('Quitar la última serie')}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ header and footer

export function HeaderFooterDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const cur = useMemo(() => headerFooterOf(c.slide), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [useDate, setUseDate] = useState(cur.dt !== null);
  const [dateKind, setDateKind] = useState<'auto' | 'fixed'>(cur.dt && 'fixed' in cur.dt ? 'fixed' : 'auto');
  const [autoFmt, setAutoFmt] = useState(cur.dt && 'auto' in cur.dt ? cur.dt.auto : 'datetime1');
  const [fixed, setFixed] = useState(cur.dt && 'fixed' in cur.dt ? cur.dt.fixed : '');
  const [num, setNum] = useState(cur.sldNum);
  const [useFtr, setUseFtr] = useState(cur.ftr !== null);
  const [ftr, setFtr] = useState(cur.ftr ?? '');
  const [skip, setSkip] = useState(false);

  const spec = (): HeaderFooterSpec => ({
    sldNum: num,
    ftr: useFtr ? ftr : null,
    dt: useDate ? (dateKind === 'auto' ? { auto: autoFmt } : { fixed }) : null,
    skipTitle: skip,
  });
  const apply = (all: boolean) => {
    const ids = all ? c.deck.slides.map((s) => s.id) : c.selSlides;
    c.apply('Encabezado y pie de página', (d) => applyHeaderFooter(d, ids, spec()));
    onClose();
  };
  const today = new Date();
  return (
    <Modal
      title={t('Encabezado y pie de página')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button onClick={() => apply(false)}>{t('Aplicar')}</Button>
          <Button appearance="primary" onClick={() => apply(true)}>{t('Aplicar a todas')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <label className="sl-check">
          <input type="checkbox" checked={useDate} onChange={(e) => setUseDate(e.target.checked)} />
          {t('Fecha y hora')}
        </label>
        <div className="sl-indent">
          <label className="sl-check">
            <input type="radio" name="hf-date" disabled={!useDate} checked={dateKind === 'auto'} onChange={() => setDateKind('auto')} />
            {t('Actualizar automáticamente')}
          </label>
          <select disabled={!useDate || dateKind !== 'auto'} value={autoFmt} onChange={(e) => setAutoFmt(e.target.value)} aria-label={t('Formato de fecha')}>
            <option value="datetime1">{today.toLocaleDateString()}</option>
            <option value="datetime4">{today.toLocaleDateString(undefined, { dateStyle: 'long' })}</option>
          </select>
          <label className="sl-check">
            <input type="radio" name="hf-date" disabled={!useDate} checked={dateKind === 'fixed'} onChange={() => setDateKind('fixed')} />
            {t('Fija')}
          </label>
          <input disabled={!useDate || dateKind !== 'fixed'} value={fixed} onChange={(e) => setFixed(e.target.value)} aria-label={t('Fecha fija')} />
        </div>
        <label className="sl-check">
          <input type="checkbox" checked={num} onChange={(e) => setNum(e.target.checked)} />
          {t('Número de diapositiva')}
        </label>
        <label className="sl-check">
          <input type="checkbox" checked={useFtr} onChange={(e) => setUseFtr(e.target.checked)} />
          {t('Pie de página')}
        </label>
        <div className="sl-indent">
          <input disabled={!useFtr} value={ftr} onChange={(e) => setFtr(e.target.value)} aria-label={t('Texto del pie de página')} />
        </div>
        <label className="sl-check">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          {t('No mostrar en la diapositiva de título')}
        </label>
      </div>
    </Modal>
  );
}
