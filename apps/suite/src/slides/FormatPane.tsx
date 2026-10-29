import { t } from '@suitenova/core-ui';
import { resolveLook, type BodyProps, type Effects, type Fill, type Ln, type RunProps, type ShapeEl, type SlideElement, type TextEffects, type Xfrm } from '@suitenova/slides-core';
import { useState, useSyncExternalStore } from 'react';
import type { SlidesUI } from './commands';
import { ColorInput, EffectsEditor, FillEditor, LineEditor, Row, type EditorEnv } from './editors';
import { currentRunProps, applyRun } from './textcmds';
import { withPh } from './render/paint';

type Tab = 'fill' | 'effects' | 'size' | 'text';

export function useEditorEnv(ui: SlidesUI): EditorEnv | null {
  const ctx = ui.canvasCtx();
  if (!ctx) return null;
  return { cc: ctx.env.cc, assetUrl: (id) => ui.ctl.urls.url(id), pickPicture: () => ui.pickAsset('image') };
}

const ARROWS = (el: SlideElement) => el.kind === 'cxn' || (el.kind === 'shape' && !!el.geom && 'prst' in el.geom && /^(line|arc|curvedConnector|bentConnector|straightConnector|rightArrow|leftArrow)/.test(el.geom.prst));

export function FormatPane({ ui }: { ui: SlidesUI }) {
  const c = ui.ctl;
  useSyncExternalStore(c.subscribe, c.getVersion);
  const [tab, setTab] = useState<Tab>('fill');
  const env = useEditorEnv(ui);
  const el = c.selected[0];
  if (!env || !el) {
    return (
      <aside className="sl-pane" aria-label={t('Formato de forma')}>
        <h2>{t('Formato de forma')}</h2>
        <p className="sl-note">{t('Selecciona una forma, una imagen o un cuadro de texto para darle formato.')}</p>
      </aside>
    );
  }
  const ctx = ui.canvasCtx()!;
  const look = resolveLook(ctx.chain, el, true);
  const withFill = el.kind === 'shape' || el.kind === 'group';
  const x: Xfrm = c.xfrmOf(el);
  const ids = c.selection;
  const setFill = (f: Fill) => c.patch(ids, 'Relleno', (e) => ({ ...e, fill: f }) as SlideElement);
  const setLn = (l: Ln) => c.patch(ids, 'Contorno', (e) => ({ ...e, ln: l }) as SlideElement);
  const setFx = (fx: Effects) => c.patch(ids, 'Efectos', (e) => ({ ...e, effects: fx }) as SlideElement);
  const fillShown: Fill = (el as { fill?: Fill }).fill && (el as { fill?: Fill }).fill!.t !== 'inherit' ? (el as { fill: Fill }).fill : look.fill;
  const lnShown: Ln | undefined = look.ln ? { ...look.ln } : (el as { ln?: Ln }).ln;
  const fxShown: Effects = (el as { effects?: Effects }).effects ?? look.effects;
  void withPh;
  return (
    <aside className="sl-pane" aria-label={t('Formato de forma')}>
      <h2>{t('Formato de forma')}</h2>
      <div role="tablist" className="sl-ptabs">
        {([['fill', 'Relleno y línea'], ['effects', 'Efectos'], ['size', 'Tamaño y propiedades'], ['text', 'Opciones de texto']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
            {t(l)}
          </button>
        ))}
      </div>
      <div className="sl-pbody">
        {tab === 'fill' && (
          <>
            {withFill && (
              <section aria-label={t('Relleno')}>
                <h3>{t('Relleno')}</h3>
                <FillEditor fill={fillShown} env={env} onChange={setFill} />
              </section>
            )}
            {el.kind !== 'table' && el.kind !== 'chart' && (
              <section aria-label={t('Línea')}>
                <h3>{t('Línea')}</h3>
                <LineEditor ln={lnShown} env={env} onChange={setLn} arrows={ARROWS(el)} />
              </section>
            )}
          </>
        )}
        {tab === 'effects' && el.kind !== 'table' && el.kind !== 'chart' && <EffectsEditor fx={fxShown} env={env} onChange={setFx} />}
        {tab === 'size' && <SizePanel ui={ui} el={el} x={x} />}
        {tab === 'text' && <TextPanel ui={ui} env={env} el={el} />}
      </div>
    </aside>
  );
}

function SizePanel({ ui, el, x }: { ui: SlidesUI; el: SlideElement; x: Xfrm }) {
  const c = ui.ctl;
  const [lock, setLock] = useState(el.kind === 'pic');
  const set = (p: Partial<Xfrm>) => c.setXfrm(el.id, p);
  const n = (label: string, v: number, apply: (n: number) => void, o: { min?: number; max?: number; step?: number } = {}) => (
    <Row label={label}>
      <input type="number" aria-label={label} step={o.step ?? 1} min={o.min} max={o.max} value={Math.round(v * 100) / 100} onChange={(e) => apply(Number(e.target.value))} />
    </Row>
  );
  const ratio = x.w / (x.h || 1);
  return (
    <>
      <h3>{t('Tamaño')}</h3>
      {n(t('Alto (pt)'), x.h, (v) => set(lock ? { h: v, w: v * ratio } : { h: v }), { min: 0 })}
      {n(t('Ancho (pt)'), x.w, (v) => set(lock ? { w: v, h: v / ratio } : { w: v }), { min: 0 })}
      {n(t('Giro (°)'), x.rot ?? 0, (v) => set({ rot: ((v % 360) + 360) % 360 }), { min: 0, max: 360 })}
      <label className="sl-check">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> {t('Bloquear relación de aspecto')}
      </label>
      <h3>{t('Posición')}</h3>
      {n(t('Horizontal (pt)'), x.x, (v) => set({ x: v }))}
      {n(t('Vertical (pt)'), x.y, (v) => set({ y: v }))}
      <h3>{t('Texto alternativo')}</h3>
      <Row label={t('Título')}>
        <input aria-label={t('Título del texto alternativo')} value={el.title ?? ''} onChange={(e) => c.patch([el.id], 'Texto alternativo', (q) => ({ ...q, title: e.target.value }))} />
      </Row>
      <Row label={t('Descripción')}>
        <textarea aria-label={t('Descripción del texto alternativo')} rows={3} value={el.descr ?? ''} onChange={(e) => c.patch([el.id], 'Texto alternativo', (q) => ({ ...q, descr: e.target.value }))} />
      </Row>
      <Row label={t('Nombre')}>
        <input aria-label={t('Nombre del objeto')} value={el.name ?? ''} onChange={(e) => c.patch([el.id], 'Nombre', (q) => ({ ...q, name: e.target.value }))} />
      </Row>
    </>
  );
}

function TextPanel({ ui, env, el }: { ui: SlidesUI; env: EditorEnv; el: SlideElement }) {
  const c = ui.ctl;
  const r: RunProps = currentRunProps(c, ui.canvasCtx());
  const fx: TextEffects = r.fx ?? {};
  const setFx = (p: Partial<TextEffects>) => applyRun(c, (x) => ({ ...x, fx: { ...x.fx, ...p } }), 'Efectos de texto');
  const body: BodyProps = el.kind === 'shape' ? (el.text?.body ?? {}) : {};
  const setBody = (p: Partial<BodyProps>) => c.patch([el.id], 'Opciones de texto', (q) => (q.kind === 'shape' ? ({ ...q, text: { body: { ...q.text?.body, ...p }, lst: q.text?.lst, doc: q.text?.doc ?? { type: 'doc', content: [{ type: 'paragraph', attrs: { lvl: 0, p: {}, end: {} } }] } } } as ShapeEl) : q));
  const fill: Fill = fx.fill ?? (r.color ? { t: 'solid', c: r.color } : { t: 'solid', c: { scheme: 'tx1' } });
  return (
    <>
      <h3>{t('Relleno del texto')}</h3>
      <FillEditor
        fill={fill}
        env={env}
        onChange={(f) => (f.t === 'solid' ? applyRun(c, (x) => ({ ...x, color: f.c, fx: x.fx ? { ...x.fx, fill: undefined } : undefined }), 'Color de texto') : setFx({ fill: f }))}
      />
      <h3>{t('Contorno del texto')}</h3>
      <LineEditor ln={fx.ln} env={env} arrows={false} onChange={(l) => setFx({ ln: l })} />
      <h3>{t('Efectos de texto')}</h3>
      <EffectsEditor fx={fx.effects} env={env} onChange={(e) => setFx({ effects: e })} />
      {el.kind === 'shape' && (
        <>
          <h3>{t('Cuadro de texto')}</h3>
          <Row label={t('Alineación vertical')}>
            <select className="nv-select" aria-label={t('Alineación vertical')} value={body.anchor ?? 't'} onChange={(e) => setBody({ anchor: e.target.value as BodyProps['anchor'] })}>
              <option value="t">{t('Superior')}</option>
              <option value="ctr">{t('Medio')}</option>
              <option value="b">{t('Inferior')}</option>
              <option value="just">{t('Justificada')}</option>
            </select>
          </Row>
          <Row label={t('Dirección del texto')}>
            <select className="nv-select" aria-label={t('Dirección del texto')} value={body.vert ?? 'horz'} onChange={(e) => setBody({ vert: e.target.value === 'horz' ? undefined : (e.target.value as BodyProps['vert']) })}>
              <option value="horz">{t('Horizontal')}</option>
              <option value="vert">{t('Girar todo el texto 90°')}</option>
              <option value="vert270">{t('Girar todo el texto 270°')}</option>
              <option value="eaVert">{t('Apilado')}</option>
            </select>
          </Row>
          <Row label={t('Ajuste automático')}>
            <select className="nv-select" aria-label={t('Ajuste automático')} value={body.fit?.t ?? 'none'} onChange={(e) => setBody({ fit: e.target.value === 'none' ? { t: 'none' } : e.target.value === 'shape' ? { t: 'shape' } : { t: 'norm' } })}>
              <option value="none">{t('No ajustar automáticamente')}</option>
              <option value="norm">{t('Reducir texto al desbordar')}</option>
              <option value="shape">{t('Cambiar el tamaño de la forma para ajustarla al texto')}</option>
            </select>
          </Row>
          <label className="sl-check">
            <input type="checkbox" checked={body.wrap !== 'none'} onChange={(e) => setBody({ wrap: e.target.checked ? 'square' : 'none' })} /> {t('Ajustar texto en la forma')}
          </label>
          {([['lIns', 'Margen izquierdo'], ['rIns', 'Margen derecho'], ['tIns', 'Margen superior'], ['bIns', 'Margen inferior']] as [keyof BodyProps, string][]).map(([k, l]) => (
            <Row key={k} label={t(l)}>
              <input type="number" step={0.5} min={0} aria-label={t(l)} value={(body[k] as number | undefined) ?? (k === 'lIns' || k === 'rIns' ? 7.2 : 3.6)} onChange={(e) => setBody({ [k]: Number(e.target.value) })} /> pt
            </Row>
          ))}
          <Row label={t('Columnas')}>
            <input type="number" min={1} max={16} aria-label={t('Número de columnas')} value={body.numCol ?? 1} onChange={(e) => setBody({ numCol: Number(e.target.value) })} />
            <input type="number" min={0} aria-label={t('Espacio entre columnas')} value={body.spcCol ?? 0} onChange={(e) => setBody({ spcCol: Number(e.target.value) })} /> pt
          </Row>
        </>
      )}
      <ColorInput label={t('Color rápido')} value={r.color} env={env} onChange={(col) => applyRun(c, (x) => ({ ...x, color: col }))} />
    </>
  );
}

