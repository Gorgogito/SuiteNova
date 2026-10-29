import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { updateSlide, type Background, type BodyProps, type Fill, type ParaProps, type RunProps, type ShapeEl, type SlideElement, type Spacing, type Tab } from '@suitenova/slides-core';
import { useMemo, useState } from 'react';
import { FONT_NAMES, FONT_SIZES, type SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { ColorInput, FillEditor, type EditorEnv } from './editors';
import { useEditorEnv } from './FormatPane';
import { applyPara, applyRun } from './textcmds';

type P = { ui: SlidesUI; onClose: () => void };

const Actions = ({ onClose, onOk, ok = true, label }: { onClose: () => void; onOk: () => void; ok?: boolean; label?: string }) => (
  <>
    <Button onClick={onClose}>{t('Cancelar')}</Button>
    <Button appearance="primary" disabled={!ok} onClick={onOk}>{label ?? t('Aceptar')}</Button>
  </>
);

// ------------------------------------------------------------------------------------------------ background

const bgFill = (b: Background | undefined): Fill | undefined => (b && 'fill' in b ? b.fill : undefined);

export function BackgroundDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const env = useEditorEnv(ui);
  const slide = c.slide;
  const layout = c.deck.layouts.find((l) => l.id === slide.layoutId);
  const master = c.deck.masters.find((m) => m.id === layout?.masterId);
  const inherited = bgFill(slide.bg) ?? bgFill(layout?.bg) ?? bgFill(master?.bg) ?? ({ t: 'solid', c: { scheme: 'bg1' } } as Fill);
  const [fill, setFill] = useState<Fill>(inherited);
  const [hideGfx, setHideGfx] = useState(slide.showMasterSp === false);
  if (!env) return null;

  const setThis = () => {
    c.apply('Formato del fondo', (d) => updateSlide(d, slide.id, (s) => ({ ...s, bg: { fill }, showMasterSp: hideGfx ? false : undefined })));
    onClose();
  };
  const setAll = () => {
    c.apply('Fondo de todas las diapositivas', (d) => {
      const mid = d.layouts.find((l) => l.id === d.slides[c.index]?.layoutId)?.masterId;
      const targets = new Set(d.masters.filter((m) => !mid || m.id === mid).map((m) => m.id));
      return {
        ...d,
        masters: d.masters.map((m) => (targets.has(m.id) ? { ...m, bg: { fill } } : m)),
        layouts: d.layouts.map((l) => (targets.has(l.masterId) ? { ...l, bg: undefined } : l)),
        slides: d.slides.map((s) => ({ ...s, bg: undefined })),
      };
    });
    onClose();
  };
  const reset = () => {
    c.apply('Restablecer el fondo', (d) => updateSlide(d, slide.id, (s) => ({ ...s, bg: undefined, showMasterSp: undefined })));
    onClose();
  };
  return (
    <Modal
      title={t('Formato del fondo')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={reset}>{t('Restablecer el fondo')}</Button>
          {!c.inMaster && <Button onClick={setAll}>{t('Aplicar a todo')}</Button>}
          <Button appearance="primary" onClick={setThis}>{c.inMaster ? t('Aplicar') : t('Aplicar a esta diapositiva')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <FillEditor fill={fill} env={env} noInherit onChange={setFill} />
        <label className="sl-check">
          <input type="checkbox" checked={hideGfx} onChange={(e) => setHideGfx(e.target.checked)} /> {t('Ocultar los gráficos de fondo')}
        </label>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ font

const UNDERLINES: [string, string][] = [['', 'Ninguno'], ['sng', 'Sencillo'], ['dbl', 'Doble'], ['heavy', 'Grueso'], ['dotted', 'Punteado'], ['dash', 'Guiones'], ['wavy', 'Ondulado']];
type FontStyle = 'regular' | 'b' | 'i' | 'bi';

export function FontDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const env = useEditorEnv(ui);
  const r0: RunProps = ui.runProps();
  const [v, setV] = useState<RunProps>(r0);
  const [touched, setTouched] = useState<Set<keyof RunProps>>(new Set());
  const set = <K extends keyof RunProps>(k: K, val: RunProps[K]) => {
    setV((o) => ({ ...o, [k]: val }));
    setTouched((o) => new Set(o).add(k));
  };
  const theme = ui.canvasCtx()?.chain.theme.fonts;
  const font = v.latin && !v.latin.startsWith('+') ? v.latin : (theme?.minor.latin ?? 'Calibri');
  const names = useMemo(() => [...new Set([theme?.major.latin, theme?.minor.latin, ...FONT_NAMES].filter((n): n is string => !!n))], [theme]);
  const style: FontStyle = v.b ? (v.i ? 'bi' : 'b') : v.i ? 'i' : 'regular';
  const setStyle = (s: FontStyle) => {
    setV((o) => ({ ...o, b: s === 'b' || s === 'bi' ? true : undefined, i: s === 'i' || s === 'bi' ? true : undefined }));
    setTouched((o) => new Set(o).add('b').add('i'));
  };
  const pos = v.baseline && v.baseline > 0;
  const sub = v.baseline && v.baseline < 0;

  const apply = () => {
    applyRun(c, (x) => {
      const o: Record<string, unknown> = { ...x };
      for (const k of touched) {
        const val = v[k];
        if (val === undefined || val === '' || val === false || (k === 'baseline' && val === 0) || (k === 'spc' && val === 0)) delete o[k];
        else o[k] = val;
      }
      return o as RunProps;
    }, 'Fuente');
    onClose();
  };
  if (!env) return null;
  const sampleCss = {
    fontFamily: font,
    fontSize: Math.min(v.sz ?? 18, 40),
    fontWeight: v.b ? 700 : 400,
    fontStyle: v.i ? 'italic' : 'normal',
    textDecoration: [v.u ? 'underline' : '', v.strike ? 'line-through' : ''].join(' ').trim() || 'none',
    textTransform: v.cap === 'all' ? ('uppercase' as const) : ('none' as const),
    fontVariant: v.cap === 'small' ? 'small-caps' : 'normal',
    letterSpacing: v.spc ? `${v.spc}pt` : undefined,
    verticalAlign: v.baseline ? (v.baseline > 0 ? 'super' : 'sub') : 'baseline',
    color: v.color?.rgb ?? 'inherit',
  };
  return (
    <Modal title={t('Fuente')} onClose={onClose} actions={<Actions onClose={onClose} onOk={apply} />}>
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Fuente')}</span>
            <input list="sl-font-list" aria-label={t('Fuente del texto')} value={font} onChange={(e) => set('latin', e.target.value)} />
            <datalist id="sl-font-list">
              {names.map((n) => <option key={n} value={n} />)}
            </datalist>
          </label>
          <label className="sl-field">
            <span>{t('Estilo de fuente')}</span>
            <select value={style} aria-label={t('Estilo de fuente')} onChange={(e) => setStyle(e.target.value as FontStyle)}>
              <option value="regular">{t('Normal')}</option>
              <option value="b">{t('Negrita')}</option>
              <option value="i">{t('Cursiva')}</option>
              <option value="bi">{t('Negrita cursiva')}</option>
            </select>
          </label>
          <label className="sl-field">
            <span>{t('Tamaño')}</span>
            <input list="sl-size-list" type="number" min={1} max={999} step={0.5} aria-label={t('Tamaño de fuente')} value={v.sz ?? 18} onChange={(e) => set('sz', Number(e.target.value) || undefined)} />
            <datalist id="sl-size-list">
              {FONT_SIZES.map((n) => <option key={n} value={n} />)}
            </datalist>
          </label>
        </div>
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Estilo de subrayado')}</span>
            <select value={v.u ?? ''} aria-label={t('Estilo de subrayado')} onChange={(e) => set('u', e.target.value || undefined)}>
              {UNDERLINES.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
          </label>
          <div className="sl-field">
            <span>{t('Color de fuente')}</span>
            <ColorInput label={t('Color de fuente')} value={v.color} env={env as EditorEnv} onChange={(col) => set('color', col)} />
          </div>
        </div>
        <fieldset className="sl-fieldset">
          <legend>{t('Efectos')}</legend>
          <label className="sl-check"><input type="checkbox" checked={v.strike === 'sng'} onChange={(e) => set('strike', e.target.checked ? 'sng' : undefined)} /> {t('Tachado')}</label>
          <label className="sl-check"><input type="checkbox" checked={v.strike === 'dbl'} onChange={(e) => set('strike', e.target.checked ? 'dbl' : undefined)} /> {t('Doble tachado')}</label>
          <label className="sl-check"><input type="checkbox" checked={!!pos} onChange={(e) => set('baseline', e.target.checked ? 30 : undefined)} /> {t('Superíndice')}</label>
          <label className="sl-check"><input type="checkbox" checked={!!sub} onChange={(e) => set('baseline', e.target.checked ? -25 : undefined)} /> {t('Subíndice')}</label>
          <label className="sl-check"><input type="checkbox" checked={v.cap === 'small'} onChange={(e) => set('cap', e.target.checked ? 'small' : undefined)} /> {t('Versalitas')}</label>
          <label className="sl-check"><input type="checkbox" checked={v.cap === 'all'} onChange={(e) => set('cap', e.target.checked ? 'all' : undefined)} /> {t('Todo en mayúsculas')}</label>
        </fieldset>
        <label className="sl-field">
          <span>{t('Espaciado entre caracteres (pt)')}</span>
          <input type="number" step={0.1} aria-label={t('Espaciado entre caracteres')} value={v.spc ?? 0} onChange={(e) => set('spc', Number(e.target.value))} />
        </label>
        <div className="sl-sample" aria-label={t('Vista previa')}>
          <span style={sampleCss}>AaBbCc áéíóú 123</span>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ paragraph

type LineKind = 'single' | 'onehalf' | 'double' | 'multiple' | 'exact';
const lineKind = (s: Spacing | undefined): { k: LineKind; n: number } => {
  if (!s) return { k: 'single', n: 1 };
  if ('pts' in s) return { k: 'exact', n: s.pts };
  const m = s.pct / 100000;
  if (Math.abs(m - 1) < 0.005) return { k: 'single', n: 1 };
  if (Math.abs(m - 1.5) < 0.005) return { k: 'onehalf', n: 1.5 };
  if (Math.abs(m - 2) < 0.005) return { k: 'double', n: 2 };
  return { k: 'multiple', n: m };
};
const spaceVal = (s: Spacing | undefined): { n: number; unit: 'pt' | '%' } => (!s ? { n: 0, unit: 'pt' } : 'pts' in s ? { n: s.pts, unit: 'pt' } : { n: Math.round(s.pct / 1000), unit: '%' });
const spaceOf = (n: number, unit: 'pt' | '%'): Spacing | undefined => (unit === 'pt' ? (n ? { pts: n } : undefined) : n ? { pct: Math.round(n * 1000) } : undefined);

function SpaceField({ label, value, onChange }: { label: string; value: Spacing | undefined; onChange: (s: Spacing | undefined) => void }) {
  const { n, unit } = spaceVal(value);
  return (
    <label className="sl-field">
      <span>{label}</span>
      <span className="sl-inline">
        <input type="number" min={0} step={unit === 'pt' ? 1 : 5} aria-label={label} value={n} onChange={(e) => onChange(spaceOf(Math.max(0, Number(e.target.value)), unit))} />
        <select aria-label={`${label}: ${t('unidad')}`} value={unit} onChange={(e) => onChange(spaceOf(n, e.target.value as 'pt' | '%'))}>
          <option value="pt">pt</option>
          <option value="%">%</option>
        </select>
      </span>
    </label>
  );
}

export function ParagraphDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const p0 = ui.paraProps();
  const [p, setP] = useState<ParaProps>({ algn: p0.algn, marL: p0.marL, indent: p0.indent, lnSpc: p0.lnSpc, spcBef: p0.spcBef, spcAft: p0.spcAft, rtl: p0.rtl });
  const [lvl, setLvl] = useState(p0.lvl);
  const [touched, setTouched] = useState<Set<keyof ParaProps | 'lvl'>>(new Set());
  const set = <K extends keyof ParaProps>(k: K, val: ParaProps[K]) => {
    setP((o) => ({ ...o, [k]: val }));
    setTouched((o) => new Set(o).add(k));
  };
  const ln = lineKind(p.lnSpc);
  const special = (p.indent ?? 0) > 0 ? 'first' : (p.indent ?? 0) < 0 ? 'hang' : 'none';
  const setLine = (k: LineKind, n: number) => set('lnSpc', k === 'single' ? undefined : k === 'onehalf' ? { pct: 150000 } : k === 'double' ? { pct: 200000 } : k === 'multiple' ? { pct: Math.round(n * 100000) } : { pts: n });
  const apply = () => {
    applyPara(c, (q, l) => {
      const o: Record<string, unknown> = { ...q };
      for (const k of touched) {
        if (k === 'lvl') continue;
        const val = p[k];
        if (val === undefined || val === false) delete o[k];
        else o[k] = val;
      }
      return { p: o as ParaProps, lvl: touched.has('lvl') ? lvl : l };
    }, 'Párrafo');
    onClose();
  };
  return (
    <Modal title={t('Párrafo')} onClose={onClose} actions={<Actions onClose={onClose} onOk={apply} />}>
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Alineación')}</span>
            <select aria-label={t('Alineación del párrafo')} value={p.algn ?? 'l'} onChange={(e) => set('algn', e.target.value as ParaProps['algn'])}>
              <option value="l">{t('Izquierda')}</option>
              <option value="ctr">{t('Centrada')}</option>
              <option value="r">{t('Derecha')}</option>
              <option value="just">{t('Justificada')}</option>
              <option value="dist">{t('Distribuida')}</option>
            </select>
          </label>
          <label className="sl-field">
            <span>{t('Nivel de esquema')}</span>
            <select aria-label={t('Nivel del párrafo')} value={lvl} onChange={(e) => (setLvl(Number(e.target.value)), setTouched((o) => new Set(o).add('lvl')))}>
              {Array.from({ length: 9 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
            </select>
          </label>
          <label className="sl-check">
            <input type="checkbox" checked={!!p.rtl} onChange={(e) => set('rtl', e.target.checked || undefined)} /> {t('De derecha a izquierda')}
          </label>
        </div>
        <fieldset className="sl-fieldset">
          <legend>{t('Sangría')}</legend>
          <div className="sl-form__row">
            <label className="sl-field">
              <span>{t('Antes del texto (pt)')}</span>
              <input type="number" min={0} step={1} aria-label={t('Sangría antes del texto')} value={p.marL ?? 0} onChange={(e) => set('marL', Math.max(0, Number(e.target.value)))} />
            </label>
            <label className="sl-field">
              <span>{t('Especial')}</span>
              <select aria-label={t('Sangría especial')} value={special} onChange={(e) => set('indent', e.target.value === 'none' ? undefined : e.target.value === 'first' ? 18 : -18)}>
                <option value="none">{t('(ninguna)')}</option>
                <option value="first">{t('Primera línea')}</option>
                <option value="hang">{t('Francesa')}</option>
              </select>
            </label>
            <label className="sl-field">
              <span>{t('En (pt)')}</span>
              <input type="number" min={0} step={1} aria-label={t('Valor de la sangría especial')} disabled={special === 'none'} value={Math.abs(p.indent ?? 0)} onChange={(e) => set('indent', (special === 'hang' ? -1 : 1) * Math.max(0, Number(e.target.value)))} />
            </label>
          </div>
        </fieldset>
        <fieldset className="sl-fieldset">
          <legend>{t('Espaciado')}</legend>
          <div className="sl-form__row">
            <SpaceField label={t('Antes')} value={p.spcBef} onChange={(s) => set('spcBef', s)} />
            <SpaceField label={t('Después')} value={p.spcAft} onChange={(s) => set('spcAft', s)} />
            <label className="sl-field">
              <span>{t('Interlineado')}</span>
              <select aria-label={t('Interlineado')} value={ln.k} onChange={(e) => setLine(e.target.value as LineKind, e.target.value === 'exact' ? 24 : 1.2)}>
                <option value="single">{t('Sencillo')}</option>
                <option value="onehalf">{t('1,5 líneas')}</option>
                <option value="double">{t('Doble')}</option>
                <option value="multiple">{t('Múltiple')}</option>
                <option value="exact">{t('Exacto')}</option>
              </select>
            </label>
            <label className="sl-field">
              <span>{ln.k === 'exact' ? t('En (pt)') : t('En (líneas)')}</span>
              <input type="number" min={ln.k === 'exact' ? 1 : 0.1} step={ln.k === 'exact' ? 1 : 0.1} aria-label={t('Valor del interlineado')} disabled={ln.k !== 'multiple' && ln.k !== 'exact'} value={Math.round(ln.n * 100) / 100} onChange={(e) => setLine(ln.k, Number(e.target.value))} />
            </label>
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ tabs

const TAB_ALIGN: [Tab['algn'], string][] = [['l', 'Izquierda'], ['ctr', 'Centrada'], ['r', 'Derecha'], ['dec', 'Decimal']];

export function TabsDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const p0 = ui.paraProps();
  const [tabs, setTabs] = useState<Tab[]>([...(p0.tabs ?? [])].sort((a, b) => a.pos - b.pos));
  const [def, setDef] = useState(p0.defTabSz ?? 72);
  const [pos, setPos] = useState(72);
  const [algn, setAlgn] = useState<Tab['algn']>('l');
  const add = () => setTabs((l) => [...l.filter((x) => Math.abs(x.pos - pos) > 0.05), { pos, algn }].sort((a, b) => a.pos - b.pos));
  const apply = () => {
    applyPara(c, (q) => ({ p: { ...q, tabs: tabs.length ? tabs : undefined, defTabSz: def === 72 ? undefined : def } }), 'Tabulaciones');
    onClose();
  };
  return (
    <Modal title={t('Tabulaciones')} onClose={onClose} actions={<Actions onClose={onClose} onOk={apply} />}>
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Posición (pt)')}</span>
            <input type="number" min={0} step={1} aria-label={t('Posición de la tabulación')} value={pos} onChange={(e) => setPos(Math.max(0, Number(e.target.value)))} />
          </label>
          <label className="sl-field">
            <span>{t('Alineación')}</span>
            <select aria-label={t('Alineación de la tabulación')} value={algn} onChange={(e) => setAlgn(e.target.value as Tab['algn'])}>
              {TAB_ALIGN.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
            </select>
          </label>
          <Button onClick={add}>{t('Establecer')}</Button>
        </div>
        <ul className="sl-tablist" aria-label={t('Tabulaciones del párrafo')}>
          {!tabs.length && <li className="sl-note">{t('No hay tabulaciones personalizadas.')}</li>}
          {tabs.map((x) => (
            <li key={x.pos}>
              <span>{Math.round(x.pos * 100) / 100} pt — {t(TAB_ALIGN.find(([k]) => k === x.algn)![1])}</span>
              <button type="button" aria-label={t('Borrar la tabulación en {p} pt', { p: x.pos })} onClick={() => setTabs((l) => l.filter((q) => q !== x))}>×</button>
            </li>
          ))}
        </ul>
        <div className="sl-form__row">
          <Button disabled={!tabs.length} onClick={() => setTabs([])}>{t('Borrar todas')}</Button>
          <label className="sl-field">
            <span>{t('Tabulación predeterminada (pt)')}</span>
            <input type="number" min={1} step={1} aria-label={t('Tabulación predeterminada')} value={def} onChange={(e) => setDef(Math.max(1, Number(e.target.value)))} />
          </label>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ columns

export function ColumnsDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const first = c.selected.find((e): e is ShapeEl => e.kind === 'shape');
  const b0: BodyProps = first?.text?.body ?? {};
  const [n, setN] = useState(b0.numCol ?? 1);
  const [gap, setGap] = useState(b0.spcCol ?? 18);
  const [rtl, setRtl] = useState(!!b0.rtlCol);
  const apply = () => {
    c.patchSelected('Columnas de texto', (el: SlideElement) => {
      if (el.kind !== 'shape') return el;
      const body: BodyProps = { ...el.text?.body };
      if (n > 1) Object.assign(body, { numCol: n, spcCol: gap, rtlCol: rtl || undefined });
      else (delete body.numCol, delete body.spcCol, delete body.rtlCol);
      return { ...el, text: { body, lst: el.text?.lst, doc: el.text?.doc ?? { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} } }] } } } as ShapeEl;
    });
    onClose();
  };
  return (
    <Modal title={t('Columnas')} onClose={onClose} actions={<Actions onClose={onClose} onOk={apply} ok={n >= 1 && n <= 16} />}>
      <div className="sl-form">
        <div className="sl-form__row">
          {[1, 2, 3].map((k) => (
            <label key={k} className="sl-check">
              <input type="radio" name="sl-cols" checked={n === k} onChange={() => setN(k)} /> {k === 1 ? t('Una') : k === 2 ? t('Dos') : t('Tres')}
            </label>
          ))}
        </div>
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Número de columnas')}</span>
            <input type="number" min={1} max={16} aria-label={t('Número de columnas')} value={n} onChange={(e) => setN(Math.min(16, Math.max(1, Math.round(Number(e.target.value)))))} />
          </label>
          <label className="sl-field">
            <span>{t('Espaciado (pt)')}</span>
            <input type="number" min={0} step={1} aria-label={t('Espaciado entre columnas')} disabled={n < 2} value={gap} onChange={(e) => setGap(Math.max(0, Number(e.target.value)))} />
          </label>
          <label className="sl-check">
            <input type="checkbox" disabled={n < 2} checked={rtl} onChange={(e) => setRtl(e.target.checked)} /> {t('De derecha a izquierda')}
          </label>
        </div>
      </div>
    </Modal>
  );
}
