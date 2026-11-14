import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { checkSlidesAccessibility, compareDecks, importSlides, newId, newPicture, newTextBox, docFromText, readPptx, slideTitle, type A11yKind, type Deck, type SlideDiff, type SlideElement } from '@suitenova/slides-core';
import { diffWords } from '@suitenova/writer-core';
import { useEffect, useMemo, useState } from 'react';
import { pickAndRead } from '../fileio';
import { addComment, savedAuthor } from './comments';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { canvasBlob, slideToCanvas } from './export/raster';
import { AssetUrls } from './render/assets';

type P = { ui: SlidesUI; onClose: () => void };
const PPTX = [{ name: 'Presentación de PowerPoint', extensions: ['pptx', 'ppsx', 'potx'] }];

// ------------------------------------------------------------------------------------------------ properties

/** Title, author, subject, keywords, category and description of the file. */
export function DocPropsDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const p = c.realDeck.props;
  const [v, setV] = useState({ title: p.title ?? '', author: p.author ?? '', subject: p.subject ?? '', keywords: p.keywords ?? '', category: p.category ?? '', description: p.description ?? '' });
  const set = (k: keyof typeof v, x: string) => setV((o) => ({ ...o, [k]: x }));
  const apply = () => {
    c.applyReal('Propiedades de la presentación', (d) => ({ ...d, props: { ...d.props, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || undefined])) } }));
    onClose();
  };
  const f = (k: keyof typeof v, label: string, area = false) => (
    <label className="sl-field" key={k}>
      <span>{t(label)}</span>
      {area ? <textarea rows={3} aria-label={t(label)} value={v[k]} onChange={(e) => set(k, e.target.value)} /> : <input aria-label={t(label)} value={v[k]} onChange={(e) => set(k, e.target.value)} />}
    </label>
  );
  return (
    <Modal
      title={t('Propiedades de la presentación')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={apply}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        {f('title', 'Título')}
        {f('author', 'Autor')}
        {f('subject', 'Asunto')}
        {f('keywords', 'Palabras clave')}
        {f('category', 'Categoría')}
        {f('description', 'Comentarios', true)}
        <p className="sl-note">
          {t('Diapositivas')}: {c.realDeck.slides.length} · {t('Archivo')}: {c.fileName ?? t('(sin guardar)')}
        </p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ accessibility

const A11Y_TEXT: Record<A11yKind, string> = {
  noTitle: 'La diapositiva no tiene título: los lectores de pantalla no pueden anunciarla.',
  dupTitle: 'Otra diapositiva tiene el mismo título.',
  imageAlt: 'Falta el texto alternativo: un lector de pantalla no puede describir este objeto.',
  mediaAlt: 'El vídeo o el audio no tiene descripción.',
  tableHeader: 'La tabla no tiene fila de encabezado.',
  mergedCells: 'La tabla tiene celdas combinadas; los lectores de pantalla las recorren con dificultad.',
  smallText: 'Texto demasiado pequeño (menos de 12 pt).',
  contrast: 'Poco contraste entre el texto y el fondo.',
  readingOrder: 'El título no es lo primero que se lee: ponlo al principio del orden de lectura.',
  linkText: 'Texto de vínculo poco descriptivo.',
  noDocTitle: 'Falta el título en las propiedades de la presentación.',
};
const SEV: Record<string, string> = { error: 'Error', warning: 'Advertencia', tip: 'Sugerencia' };

/** Accessibility checker: lists what makes the presentation hard to use with a screen reader or low vision. */
export function AccessibilityDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [n, setN] = useState(0);
  const issues = useMemo(() => checkSlidesAccessibility(c.realDeck), [c, n]);
  const go = (slideId: string | null, elId?: string) => {
    if (!slideId) return ui.openDialog('docProps');
    const i = c.realDeck.slides.findIndex((s) => s.id === slideId);
    if (i < 0) return;
    onClose();
    c.goTo(i);
    if (elId) c.select([elId]);
  };
  return (
    <Modal
      title={t('Comprobar accesibilidad')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={() => setN((x) => x + 1)}>{t('Volver a comprobar')}</Button>
          <Button appearance="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <p role="status" aria-live="polite">{issues.length ? t('{n} problemas encontrados.', { n: issues.length }) : t('No se encontraron problemas de accesibilidad.')}</p>
        <ul className="sl-a11y" style={{ maxHeight: 340, overflow: 'auto', listStyle: 'none', padding: 0, margin: 0 }}>
          {issues.map((it, i) => {
            const s = it.slideId ? c.realDeck.slides.findIndex((x) => x.id === it.slideId) : -1;
            return (
              <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid rgba(128,128,128,.25)' }}>
                <b style={{ minWidth: 92, color: it.severity === 'error' ? '#b3261e' : it.severity === 'warning' ? '#8a6100' : '#555' }}>{t(SEV[it.severity]!)}</b>
                <span style={{ flex: 1 }}>
                  {s >= 0 && <i>{t('Diapositiva')} {s + 1}: </i>}
                  {t(A11Y_TEXT[it.kind])}
                </span>
                <Button size="small" onClick={() => go(it.slideId, it.elId)}>
                  {t('Ir')}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ compare

function DiffText({ a, b }: { a: string; b: string }) {
  const ops = diffWords(a, b);
  return (
    <span>
      {ops.map((o, i) =>
        o.type === 'eq' ? <span key={i}>{b.slice(o.bFrom, o.bTo)}</span> : o.type === 'ins' ? <ins key={i} style={{ background: '#d7f0d0' }}>{b.slice(o.bFrom, o.bTo)}</ins> : <del key={i} style={{ background: '#f8d3d0' }}>{a.slice(o.aFrom, o.aTo)}</del>,
      )}
    </span>
  );
}

/** Compares the open presentation with a file: which slides were added, removed or changed. Changes can be marked as comments. */
export function CompareDeckDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [file, setFile] = useState<{ name: string; deck: Deck } | null>(null);
  const [error, setError] = useState('');
  const diffs = useMemo(() => (file ? compareDecks(c.realDeck, file.deck) : []), [file, c]);
  const changes = diffs.filter((d) => d.kind !== 'same');
  const choose = async () => {
    setError('');
    const f = await pickAndRead(PPTX);
    if (!f) return;
    try {
      setFile({ name: f.name, deck: (await readPptx(f.data)).deck });
    } catch (e) {
      setError(t('No se pudo comparar: {error}', { error: (e as Error).message }));
    }
  };
  const mark = () => {
    if (!file) return;
    const author = savedAuthor(c) || t('Comparación');
    const slides = c.realDeck.slides;
    for (const [pos, d] of diffs.entries()) {
      if (d.kind === 'same') continue;
      // a slide that is only in the file is marked on the slide before it
      let prev = pos - 1;
      while (prev >= 0 && diffs[prev]!.a === undefined) prev--;
      const i = Math.min(slides.length - 1, d.a ?? Math.max(0, diffs[prev]?.a ?? 0));
      c.goTo(i);
      const text =
        d.kind === 'changed' ? t('Distinto en «{name}»: {text}', { name: file.name, text: d.textB.replace(/\n/g, ' / ').slice(0, 300) })
        : d.kind === 'removed' ? t('Esta diapositiva no está en «{name}».', { name: file.name })
        : t('En «{name}» hay aquí una diapositiva nueva: {text}', { name: file.name, text: (d.textB.split('\n')[0] ?? '').slice(0, 120) });
      addComment(c, text, author);
    }
    onClose();
  };
  return (
    <Modal
      title={t('Comparar presentaciones')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button disabled={!changes.length} onClick={mark}>
            {t('Marcar con comentarios')}
          </Button>
          <Button appearance="primary" onClick={onClose}>
            {t('Cerrar')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <div className="sl-form__row">
          <Button onClick={() => void choose()}>{t('Elegir archivo…')}</Button>
          <span>{file ? file.name : t('Se compara esta presentación con otra versión.')}</span>
        </div>
        <p role="alert">{error}</p>
        {file && (
          <>
            <p role="status">{changes.length ? t('{n} diferencias.', { n: changes.length }) : t('Las dos presentaciones tienen el mismo texto en todas las diapositivas.')}</p>
            <ul style={{ maxHeight: 320, overflow: 'auto', listStyle: 'none', padding: 0, margin: 0 }}>
              {changes.map((d: SlideDiff, i) => (
                <li key={i} style={{ padding: '4px 0', borderBottom: '1px solid rgba(128,128,128,.25)' }}>
                  <b>{d.kind === 'changed' ? t('Cambiada') : d.kind === 'added' ? t('Nueva en el archivo') : t('Solo en esta presentación')}</b>{' '}
                  <i>
                    {d.a !== undefined ? `${t('actual')} ${d.a + 1}` : ''}
                    {d.a !== undefined && d.b !== undefined ? ' · ' : ''}
                    {d.b !== undefined ? `${t('archivo')} ${d.b + 1}` : ''}
                  </i>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{d.kind === 'changed' ? <DiffText a={d.textA} b={d.textB} /> : (d.kind === 'added' ? d.textB : d.textA) || t('(sin texto)')}</div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="sl-note">{t('Solo se compara el texto de las diapositivas (no el formato ni las imágenes). Los cambios se pueden marcar como comentarios en esta presentación.')}</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ reuse slides

/** Inserts slides of another file, with the theme of this presentation. */
export function ReuseSlidesDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [file, setFile] = useState<{ name: string; deck: Deck } | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [error, setError] = useState('');
  const choose = async () => {
    setError('');
    const f = await pickAndRead(PPTX);
    if (!f) return;
    try {
      const deck = (await readPptx(f.data)).deck;
      setFile({ name: f.name, deck });
      setSel(new Set());
      setThumbs([]);
    } catch (e) {
      setError(t('No se pudo abrir «{name}»: {error}', { name: f.name, error: (e as Error).message }));
    }
  };
  useEffect(() => {
    if (!file) return;
    let live = true;
    const urls = new AssetUrls(() => file.deck);
    void (async () => {
      await new Promise((r) => setTimeout(r, 0)); // outside the effect: drawing a slide flushes React
      const out: string[] = [];
      for (let i = 0; i < file.deck.slides.length; i++) {
        const cv = await slideToCanvas(file.deck, file.deck.slides[i]!, urls, i, 240);
        const data = await canvasBlob(cv, 'image/jpeg');
        out.push(URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/jpeg' })));
        if (live) setThumbs([...out]);
      }
    })();
    return () => {
      live = false;
    };
  }, [file]);
  const insert = () => {
    if (!file || !sel.size) return;
    const idx = [...sel].sort((a, b) => a - b);
    let ids: string[] = [];
    c.apply('Reutilizar diapositivas', (d) => {
      const r = importSlides(d, file.deck, idx, c.index);
      ids = r.ids;
      return r.deck;
    });
    if (ids.length) c.goTo(Math.min(c.deck.slides.length - 1, c.index + 1));
    onClose();
  };
  return (
    <Modal
      title={t('Reutilizar diapositivas')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!sel.size} onClick={insert}>
            {t('Insertar')} {sel.size ? `(${sel.size})` : ''}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <div className="sl-form__row">
          <Button onClick={() => void choose()}>{t('Elegir archivo…')}</Button>
          <span>{file ? `${file.name} · ${file.deck.slides.length}` : ''}</span>
          {file && (
            <Button size="small" onClick={() => setSel(new Set(file.deck.slides.map((_s, i) => i)))}>
              {t('Seleccionar todas')}
            </Button>
          )}
        </div>
        <p role="alert">{error}</p>
        <div role="group" aria-label={t('Diapositivas del archivo')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 150px)', gap: 8, maxHeight: 330, overflow: 'auto' }}>
          {file?.deck.slides.map((s, i) => (
            <label key={s.id} className="sl-check" style={{ display: 'block', border: sel.has(i) ? '2px solid var(--colorBrandStroke1, #c55a11)' : '1px solid rgba(128,128,128,.4)', padding: 3, cursor: 'pointer' }} title={slideTitle(s)}>
              <input type="checkbox" checked={sel.has(i)} aria-label={`${t('Diapositiva')} ${i + 1}: ${slideTitle(s)}`} onChange={(e) => setSel((o) => { const n = new Set(o); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
              {thumbs[i] ? <img src={thumbs[i]} alt="" style={{ width: '100%', display: 'block' }} /> : <div style={{ height: 80 }} />}
              <small>{i + 1}. {slideTitle(s) || t('(sin título)')}</small>
            </label>
          ))}
        </div>
        <p className="sl-note">{t('Las diapositivas se insertan después de la actual con el tema y los diseños de esta presentación (cada una toma el diseño que más se parece al suyo). No se conserva el formato de origen.')}</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ zoom

/** Summary zoom: a slide with a picture of each chosen slide that jumps to it; or one picture of a slide. */
export function ZoomDialog({ ui, onClose, single }: P & { single?: boolean }) {
  const c = ui.ctl;
  const slides = c.realDeck.slides;
  const [sel, setSel] = useState<Set<number>>(new Set(single ? [Math.min(slides.length - 1, c.index + 1)] : slides.map((_s, i) => i).filter((i) => i !== c.index)));
  const [busy, setBusy] = useState(false);
  const build = async () => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const idx = [...sel].sort((a, b) => a - b);
      const d0 = c.realDeck;
      const W = d0.size.w;
      const H = d0.size.h;
      const n = idx.length;
      const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
      const rows = Math.ceil(n / cols);
      const topPad = single ? 30 : 90;
      const gap = 24;
      const cw = (W - gap * (cols + 1)) / cols;
      const ch = (H - topPad - gap * (rows + 1)) / rows;
      const k = Math.min(cw / W, ch / H);
      const w = W * k;
      const h = H * k;
      const assets: Deck['assets'] = {};
      const els: SlideElement[] = [];
      for (const [pos, i] of idx.entries()) {
        const cv = await slideToCanvas(d0, d0.slides[i]!, c.urls, i, Math.max(480, Math.round(w * 2)));
        const data = await canvasBlob(cv, 'image/png');
        const id = newId('a');
        assets[id] = { id, mime: 'image/png', data, name: `zoom-${i + 1}.png` };
        const col = pos % cols;
        const row = Math.floor(pos / cols);
        const pic = newPicture(id, gap + col * (cw + gap) + (cw - w) / 2, topPad + gap + row * (ch + gap) + (ch - h) / 2, w, h, `${t('Diapositiva')} ${i + 1}: ${slideTitle(d0.slides[i]!)}`);
        els.push({ ...pic, ln: { w: 1, fill: { t: 'solid' as const, c: { rgb: '#888888' } } }, hlink: { slide: d0.slides[i]!.id, tooltip: `${t('Ir a la diapositiva')} ${i + 1}` } });
      }
      if (!single) {
        const tb = newTextBox(40, 20, W - 80, 56);
        els.unshift({ ...tb, text: { ...tb.text!, doc: docFromText(t('Resumen'), { algn: 'ctr' }, { sz: 32, b: true }) } } as never);
      }
      const blank = c.deck.layouts.find((l) => l.type === 'blank') ?? c.deck.layouts[0]!;
      const sid = newId('s');
      c.apply(single ? 'Zoom de diapositiva' : 'Zoom de resumen', (d) => {
        const slidesNew = [...d.slides];
        const at = single ? c.index + 1 : c.index;
        slidesNew.splice(at, single ? 0 : 0, { id: sid, layoutId: blank.id, shapes: els as never });
        return { ...d, assets: { ...d.assets, ...assets }, slides: slidesNew };
      });
      c.goTo(single ? c.index + 1 : c.index);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={single ? t('Zoom de diapositiva') : t('Zoom de resumen')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!sel.size || busy} onClick={() => void build()}>
            {busy ? t('Preparando…') : t('Insertar')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <div role="group" aria-label={t('Diapositivas')} style={{ maxHeight: 260, overflow: 'auto' }}>
          {slides.map((s, i) => (
            <label key={s.id} className="sl-check" style={{ display: 'block' }}>
              <input
                type={single ? 'radio' : 'checkbox'}
                name="zoom-pick"
                checked={sel.has(i)}
                onChange={(e) => setSel((o) => (single ? new Set([i]) : (() => { const n = new Set(o); if (e.target.checked) n.add(i); else n.delete(i); return n; })()))}
              />{' '}
              {i + 1}. {slideTitle(s) || t('(sin título)')}
            </label>
          ))}
        </div>
        <p className="sl-note">{t('Se inserta una diapositiva con una imagen de cada diapositiva elegida; al hacer clic en ella durante la presentación se salta a esa diapositiva. Las imágenes son fijas (no se actualizan si cambias la diapositiva) y no hay animación de acercamiento ni vuelta automática, como en el zoom de PowerPoint.')}</p>
      </div>
    </Modal>
  );
}
