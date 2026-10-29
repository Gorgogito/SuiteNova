import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { applyTemplate, COLOR_SCHEMES, currentThemeId, FONT_SCHEMES, isDark, readTemplateFile, setDarkVariant, setThemeColors, setThemeFonts, type Deck, type Hyperlink, type SlideElement, type Xfrm } from '@suitenova/slides-core';
import { useState } from 'react';
import { pickAndRead } from '../fileio';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { useUi } from './ribbonParts';

type P = { ui: SlidesUI; onClose: () => void };

// ------------------------------------------------------------------------------------------------ themes and templates

export function ThemesDialog({ ui, onClose }: P) {
  const c = useUi(ui);
  const [tpl, setTpl] = useState<{ name: string; deck: Deck; themeOnly: boolean } | null>(null);
  const [mode, setMode] = useState<'theme' | 'template'>('template');
  const [error, setError] = useState('');
  const themeId = currentThemeId(c.deck, c.index);
  const theme = c.deck.themes.find((x) => x.id === themeId);
  const colorId = COLOR_SCHEMES.find((s) => theme && Object.entries(s.colors).every(([k, v]) => theme.colors[k as keyof typeof theme.colors]?.toLowerCase() === v))?.id;
  const fontId = FONT_SCHEMES.find((s) => theme && s.fonts.major.latin === theme.fonts.major.latin && s.fonts.minor.latin === theme.fonts.minor.latin)?.id ?? '';

  const open = async () => {
    setError('');
    const f = await pickAndRead([{ name: 'Plantilla o tema de PowerPoint', extensions: ['potx', 'pptx', 'ppsx', 'thmx'] }]);
    if (!f) return;
    try {
      const r = await readTemplateFile(f.data);
      setTpl({ name: f.name, ...r });
      setMode(r.themeOnly ? 'theme' : 'template');
    } catch (e) {
      setTpl(null);
      setError(t('No se pudo leer «{name}»: {why}', { name: f.name, why: (e as Error).message }));
    }
  };
  const applyTpl = () => {
    if (!tpl) return;
    c.apply(mode === 'theme' ? 'Aplicar tema' : 'Aplicar plantilla', (d) => applyTemplate(d, tpl.deck, mode));
    onClose();
  };

  return (
    <Modal title={t('Temas y plantillas')} onClose={onClose} wide>
      <div className="sl-form">
        <fieldset className="sl-fieldset">
          <legend>{t('Colores')}</legend>
          <div className="sl-themegrid" role="group" aria-label={t('Combinaciones de colores')}>
            {COLOR_SCHEMES.map((s) => (
              <button key={s.id} type="button" className={colorId === s.id ? 'is-on' : ''} aria-pressed={colorId === s.id} onClick={() => c.apply('Colores del tema', (d) => setThemeColors(d, themeId, s.colors))}>
                <span className="sl-themegrid__sw">
                  {(['dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((k) => <i key={k} style={{ background: s.colors[k] }} />)}
                </span>
                {t(s.name)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Fuentes del tema')}</span>
            <select aria-label={t('Fuentes del tema')} value={fontId} onChange={(e) => c.apply('Fuentes del tema', (d) => setThemeFonts(d, themeId, FONT_SCHEMES.find((s) => s.id === e.target.value)!.fonts))}>
              {!fontId && <option value="">{theme ? `${theme.fonts.major.latin} / ${theme.fonts.minor.latin}` : ''}</option>}
              {FONT_SCHEMES.map((s) => <option key={s.id} value={s.id}>{t(s.name)} — {s.fonts.major.latin} / {s.fonts.minor.latin}</option>)}
            </select>
          </label>
          <label className="sl-check">
            <input type="checkbox" checked={isDark(c.deck)} onChange={(e) => c.apply('Variante del tema', (d) => setDarkVariant(d, e.target.checked))} /> {t('Fondo oscuro')}
          </label>
        </div>
        <fieldset className="sl-fieldset">
          <legend>{t('Desde un archivo')}</legend>
          <div className="sl-form__row">
            <Button onClick={() => void open()}>{t('Abrir tema o plantilla…')}</Button>
            {tpl && <span className="sl-note">{tpl.name}</span>}
          </div>
          {error && <p role="alert" className="sl-note">{error}</p>}
          {tpl && (
            <>
              {!tpl.themeOnly && (
                <div role="radiogroup" aria-label={t('Qué aplicar')}>
                  <label className="sl-check"><input type="radio" name="tpl-mode" checked={mode === 'template'} onChange={() => setMode('template')} /> {t('Plantilla completa (patrón, diseños y tema)')}</label>
                  <label className="sl-check"><input type="radio" name="tpl-mode" checked={mode === 'theme'} onChange={() => setMode('theme')} /> {t('Solo colores y fuentes del tema')}</label>
                </div>
              )}
              <div className="sl-form__row"><Button appearance="primary" onClick={applyTpl}>{t('Aplicar')}</Button></div>
            </>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ size and position

const PT_PER_CM = 72 / 2.54;
const cm = (pt: number) => Math.round((pt / PT_PER_CM) * 100) / 100;
const pt = (v: number) => Math.round(v * PT_PER_CM * 100) / 100;

export function PositionDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const els = c.selected;
  const single = els.length === 1;
  const x0: Xfrm = c.xfrmOf(els[0]!);
  const [w, setW] = useState(cm(x0.w));
  const [h, setH] = useState(cm(x0.h));
  const [rot, setRot] = useState(x0.rot ?? 0);
  const [x, setX] = useState(cm(x0.x));
  const [y, setY] = useState(cm(x0.y));
  const [lock, setLock] = useState(els[0]!.kind === 'pic');
  const ratio = x0.w / (x0.h || 1);
  const [flipH, setFlipH] = useState(!!x0.flipH);
  const [flipV, setFlipV] = useState(!!x0.flipV);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const mark = (...k: string[]) => setTouched((o) => new Set([...o, ...k]));
  const ok = w > 0 && h > 0;

  const apply = () => {
    const map: Record<string, Xfrm> = {};
    for (const el of els) {
      const cur = c.xfrmOf(el);
      const n: Xfrm = { ...cur };
      if (touched.has('w')) n.w = pt(w);
      if (touched.has('h')) n.h = pt(h);
      if (touched.has('rot')) n.rot = ((rot % 360) + 360) % 360 || undefined;
      if (single && touched.has('x')) n.x = pt(x);
      if (single && touched.has('y')) n.y = pt(y);
      if (touched.has('flipH')) n.flipH = flipH || undefined;
      if (touched.has('flipV')) n.flipV = flipV || undefined;
      map[el.id] = n;
    }
    c.setXfrms(map, 'Tamaño y posición');
    onClose();
  };
  const num = (label: string, v: number, set: (n: number) => void, k: string, min?: number, disabled?: boolean) => (
    <label className="sl-field">
      <span>{label}</span>
      <input type="number" step={0.01} min={min} disabled={disabled} aria-label={label} value={v} onChange={(e) => (set(Number(e.target.value)), mark(k))} />
    </label>
  );
  return (
    <Modal
      title={t('Tamaño y posición')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!ok} onClick={apply}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <fieldset className="sl-fieldset">
          <legend>{t('Tamaño')}</legend>
          <div className="sl-form__row">
            {num(t('Alto (cm)'), h, (v) => (setH(v), lock && (setW(Math.round(v * ratio * 100) / 100), mark('w'))), 'h', 0.01)}
            {num(t('Ancho (cm)'), w, (v) => (setW(v), lock && (setH(Math.round((v / ratio) * 100) / 100), mark('h'))), 'w', 0.01)}
            {num(t('Giro (°)'), rot, setRot, 'rot')}
          </div>
          <label className="sl-check"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> {t('Bloquear relación de aspecto')}</label>
          <div className="sl-form__row">
            <label className="sl-check"><input type="checkbox" checked={flipH} onChange={(e) => (setFlipH(e.target.checked), mark('flipH'))} /> {t('Voltear horizontalmente')}</label>
            <label className="sl-check"><input type="checkbox" checked={flipV} onChange={(e) => (setFlipV(e.target.checked), mark('flipV'))} /> {t('Voltear verticalmente')}</label>
          </div>
        </fieldset>
        <fieldset className="sl-fieldset">
          <legend>{t('Posición (desde la esquina superior izquierda)')}</legend>
          <div className="sl-form__row">
            {num(t('Horizontal (cm)'), x, setX, 'x', undefined, !single)}
            {num(t('Vertical (cm)'), y, setY, 'y', undefined, !single)}
          </div>
          {!single && <p className="sl-note">{t('Con varios objetos solo se cambian el tamaño, el giro y el volteo; para moverlos usa Alinear o Distribuir.')}</p>}
        </fieldset>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ alternative text

export function AltTextDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const el = c.selected[0]!;
  const [name, setName] = useState(el.name ?? '');
  const [title, setTitle] = useState(el.title ?? '');
  const [descr, setDescr] = useState(el.descr ?? '');
  const apply = () => {
    c.patch(c.selection.slice(0, 1), 'Texto alternativo', (e) => ({ ...e, name: name || undefined, title: title || undefined, descr: descr || undefined }) as SlideElement);
    onClose();
  };
  return (
    <Modal
      title={t('Texto alternativo')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={apply}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <p className="sl-note">{t('Describe el objeto para quien no lo puede ver: lo leen los lectores de pantalla y se guarda en el archivo.')}</p>
        <label className="sl-field">
          <span>{t('Nombre del objeto')}</span>
          <input aria-label={t('Nombre del objeto')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="sl-field">
          <span>{t('Título')}</span>
          <input aria-label={t('Título del texto alternativo')} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="sl-field">
          <span>{t('Descripción')}</span>
          <textarea rows={4} aria-label={t('Descripción del texto alternativo')} value={descr} onChange={(e) => setDescr(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ action settings

type Act = 'none' | 'next' | 'prev' | 'first' | 'last' | 'end' | 'slide' | 'url';
const ACTS: [Act, string][] = [['none', 'Ninguna'], ['next', 'Ir a la diapositiva siguiente'], ['prev', 'Ir a la diapositiva anterior'], ['first', 'Ir a la primera diapositiva'], ['last', 'Ir a la última diapositiva'], ['end', 'Finalizar la presentación'], ['slide', 'Ir a la diapositiva…'], ['url', 'Abrir la página web…']];

export function ActionDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const el = c.selected[0]!;
  const cur = el.hlink;
  const kind0: Act = !cur ? 'none' : cur.url ? 'url' : cur.slide && ['next', 'prev', 'first', 'last', 'end'].includes(cur.slide) ? (cur.slide as Act) : cur.slide ? 'slide' : 'none';
  const [act, setAct] = useState<Act>(kind0);
  const [slide, setSlide] = useState(cur?.slide && !['next', 'prev', 'first', 'last', 'end'].includes(cur.slide) ? cur.slide : c.deck.slides[0]!.id);
  const [url, setUrl] = useState(cur?.url ?? '');
  const [tip, setTip] = useState(cur?.tooltip ?? '');
  const target = (): Hyperlink | null | undefined => {
    const base = tip ? { tooltip: tip } : {};
    if (act === 'none') return null;
    if (act === 'url') {
      const u = url.trim();
      return u ? { url: /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`, ...base } : undefined;
    }
    return { slide: act === 'slide' ? slide : act, ...base };
  };
  const h = target();
  const apply = () => {
    if (h === undefined) return;
    c.patchSelected('Configuración de la acción', (e) => ({ ...e, hlink: h ?? undefined }) as SlideElement);
    onClose();
  };
  return (
    <Modal
      title={t('Configuración de la acción')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={h === undefined} onClick={apply}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <p className="sl-note">{t('Al hacer clic en el objeto durante la presentación:')}</p>
        <div role="radiogroup" aria-label={t('Acción al hacer clic')}>
          {ACTS.map(([k, l]) => (
            <label key={k} className="sl-check"><input type="radio" name="act" checked={act === k} onChange={() => setAct(k)} /> {t(l)}</label>
          ))}
        </div>
        {act === 'slide' && (
          <label className="sl-field">
            <span>{t('Diapositiva')}</span>
            <select aria-label={t('Diapositiva de destino')} value={slide} onChange={(e) => setSlide(e.target.value)}>
              {c.deck.slides.map((s, i) => <option key={s.id} value={s.id}>{t('Diapositiva {n}', { n: i + 1 })}</option>)}
            </select>
          </label>
        )}
        {act === 'url' && (
          <label className="sl-field">
            <span>{t('Dirección')}</span>
            <input aria-label={t('Dirección web')} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </label>
        )}
        {act !== 'none' && (
          <label className="sl-field">
            <span>{t('Información en pantalla')}</span>
            <input aria-label={t('Información en pantalla')} value={tip} onChange={(e) => setTip(e.target.value)} />
          </label>
        )}
      </div>
    </Modal>
  );
}
