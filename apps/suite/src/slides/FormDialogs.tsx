import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { applyHeaderFooter, chainFor, clrCss, colorContext, docText, headerFooterOf, newChart, newTable, sampleChart, updateElement, type Hyperlink, type HeaderFooterSpec, type SlideElement } from '@suitenova/slides-core';
import type { ChartSpec } from '@suitenova/chart-core';
import { ChartEditor, useBuilt } from '../chart/ChartEditor';
import { draftOf, type ChartDraft } from '../chart/draft';
import { useMemo, useState } from 'react';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { applyRun } from './textcmds';

const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

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

/** Puts a new table of `rows` × `cols` on the slide, 80 % of its width, in the lower part. */
export function insertTable(c: SlidesUI['ctl'], rows: number, cols: number): void {
  const w = c.deck.size.w * 0.8;
  const rowH = Math.min(37, (c.deck.size.h * 0.7) / rows);
  c.addElement(newTable(rows, cols, (c.deck.size.w - w) / 2, c.deck.size.h * 0.3, w, rowH));
}

export function TableDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(4);
  const ok = rows >= 1 && rows <= 50 && cols >= 1 && cols <= 30;
  const insert = () => {
    insertTable(c, rows, cols);
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

export function ChartDialog({ ui, onClose, arg }: P) {
  const c = ui.ctl;
  const existing = typeof arg === 'string' ? (c.element(arg) as Extract<SlideElement, { kind: 'chart' }> | null) : null;
  const sample = useMemo(() => sampleChart(), []);
  const base = existing?.chart ?? sample.chart;
  const [draft, setDraft] = useState<ChartDraft>(() => draftOf(base, existing?.grid ?? sample.grid));
  const [fmt, setFmt] = useState<ChartSpec | undefined>(existing?.chart);
  const built = useBuilt(draft, fmt);
  const accents = useMemo(() => ACCENTS.map((k) => clrCss({ scheme: k }, colorContext(chainFor(c.deck, c.slide)))), []); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    if (typeof built === 'string') return;
    if (existing) c.apply('Cambiar gráfico', (d) => updateElement(d, c.slide.id, existing.id, (e) => ({ ...e, chart: built.spec, grid: built.grid }) as SlideElement));
    else {
      const w = c.deck.size.w * 0.7;
      const h = c.deck.size.h * 0.65;
      c.addElement(newChart(built.spec, built.grid, (c.deck.size.w - w) / 2, c.deck.size.h * 0.25, w, h));
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
          <Button appearance="primary" disabled={typeof built === 'string'} onClick={commit}>{t('Aceptar')}</Button>
        </>
      }
    >
      <ChartEditor draft={draft} onChange={setDraft} base={fmt} onBase={setFmt} accents={accents} />
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
