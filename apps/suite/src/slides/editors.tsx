import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { clrCss, parseHex, resolveClr, toHex, type Clr, type ColorContext, type DashPreset, type Effects, type Fill, type GradStop, type Ln, type Shadow } from '@suitenova/slides-core';
import { useRef, type ReactNode } from 'react';
import { patternNames, patternTile } from './render/patterns';

/*
 * Reusable editors for the properties of a shape: fills (solid, gradient, picture, pattern), outlines and effects. They are shown in
 * the format pane and in dialogs; each calls `onChange` with the new value.
 */

export interface EditorEnv {
  cc: ColorContext;
  /** URL of an asset to preview a picture fill */
  assetUrl(id: string): string;
  /** asks for a picture and returns the id of the asset */
  pickPicture(): Promise<string | null>;
}

const hexOf = (c: Clr | undefined, env: EditorEnv): string => toHex(resolveClr(c ?? { rgb: '#000000' }, env.cc));

export function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="sl-prow">
      <label htmlFor={htmlFor}>{label}</label>
      <div className="sl-prow__c">{children}</div>
    </div>
  );
}

export function ColorInput({ id, label, value, env, onChange, alpha }: { id?: string; label: string; value: Clr | undefined; env: EditorEnv; onChange: (c: Clr) => void; alpha?: boolean }) {
  const a = Math.round(resolveClr(value ?? { rgb: '#000000' }, env.cc).a * 100);
  return (
    <span className="sl-colorin">
      <input
        id={id}
        type="color"
        aria-label={label}
        value={hexOf(value, env)}
        onChange={(e) => {
          const mods = (value?.mods ?? []).filter((m) => m.t === 'alpha');
          onChange({ rgb: e.target.value, ...(mods.length ? { mods } : {}) });
        }}
      />
      {value?.scheme && <span className="sl-themetag" title={value.scheme}>◆</span>}
      {alpha && (
        <input
          type="range"
          min={0}
          max={100}
          aria-label={`${label}: ${t('transparencia')}`}
          value={100 - a}
          onChange={(e) => {
            const tr = Number(e.target.value);
            const base = { ...(value ?? { rgb: '#000000' }) };
            const mods = (base.mods ?? []).filter((m) => m.t !== 'alpha');
            if (tr > 0) mods.push({ t: 'alpha', v: (100 - tr) * 1000 });
            onChange({ ...base, mods });
          }}
        />
      )}
    </span>
  );
}

// ------------------------------------------------------------------------------------------------ fill

type FillKind = 'none' | 'solid' | 'grad' | 'blip' | 'patt';
const kindOf = (f: Fill | undefined): FillKind => (!f || f.t === 'inherit' || f.t === 'group' ? 'none' : (f.t === 'none' ? 'none' : f.t === 'solid' ? 'solid' : f.t === 'grad' ? 'grad' : f.t === 'blip' ? 'blip' : 'patt'));

const GRAD_PRESETS: { label: string; stops: GradStop[]; ang: number }[] = [
  { label: 'Azul claro', stops: [{ pos: 0, c: { rgb: '#cfe2f3' } }, { pos: 100000, c: { rgb: '#4472c4' } }], ang: 90 },
  { label: 'Atardecer', stops: [{ pos: 0, c: { rgb: '#ffd966' } }, { pos: 50000, c: { rgb: '#ed7d31' } }, { pos: 100000, c: { rgb: '#c00000' } }], ang: 90 },
  { label: 'Verde', stops: [{ pos: 0, c: { rgb: '#e2f0d9' } }, { pos: 100000, c: { rgb: '#548235' } }], ang: 45 },
  { label: 'Metal', stops: [{ pos: 0, c: { rgb: '#f2f2f2' } }, { pos: 50000, c: { rgb: '#a6a6a6' } }, { pos: 100000, c: { rgb: '#595959' } }], ang: 90 },
  { label: 'Radial', stops: [{ pos: 0, c: { rgb: '#ffffff' } }, { pos: 100000, c: { rgb: '#7030a0' } }], ang: 0 },
];

export function FillEditor({ fill, env, onChange, noInherit }: { fill: Fill | undefined; env: EditorEnv; onChange: (f: Fill) => void; noInherit?: boolean }) {
  const kind = kindOf(fill);
  void noInherit;
  const set = (k: FillKind) => {
    if (k === kind) return;
    if (k === 'none') onChange({ t: 'none' });
    else if (k === 'solid') onChange({ t: 'solid', c: fill && fill.t === 'solid' ? fill.c : { scheme: 'accent1' } });
    else if (k === 'grad') onChange({ t: 'grad', stops: GRAD_PRESETS[0]!.stops, lin: { ang: 90, scaled: false } });
    else if (k === 'patt') onChange({ t: 'patt', prst: 'pct25', fg: { rgb: '#4472c4' }, bg: { rgb: '#ffffff' } });
    else void env.pickPicture().then((src) => src && onChange({ t: 'blip', src, stretch: true }));
  };
  const idp = useRef(`f${Math.random().toString(36).slice(2, 7)}`).current;
  return (
    <div className="sl-filleditor">
      <div role="radiogroup" aria-label={t('Tipo de relleno')} className="sl-radios">
        {([['none', 'Sin relleno'], ['solid', 'Relleno sólido'], ['grad', 'Relleno degradado'], ['blip', 'Relleno con imagen o textura'], ['patt', 'Relleno con trama']] as [FillKind, string][]).map(([k, l]) => (
          <label key={k}>
            <input type="radio" name={idp} checked={kind === k} onChange={() => set(k)} /> {t(l)}
          </label>
        ))}
      </div>
      {fill && fill.t === 'solid' && (
        <Row label={t('Color')} htmlFor={`${idp}c`}>
          <ColorInput id={`${idp}c`} label={t('Color de relleno')} value={fill.c} env={env} alpha onChange={(c) => onChange({ t: 'solid', c })} />
        </Row>
      )}
      {fill && fill.t === 'grad' && <GradientEditor fill={fill} env={env} onChange={onChange} />}
      {fill && fill.t === 'patt' && (
        <>
          <div className="sl-patts" role="listbox" aria-label={t('Tramas')}>
            {patternNames().map((p) => (
              <button key={p} type="button" role="option" aria-selected={fill.prst === p} className={fill.prst === p ? 'is-on' : ''} title={p} onClick={() => onChange({ ...fill, prst: p })}>
                <PatternSwatch prst={p} fg={hexOf(fill.fg, env)} bg={hexOf(fill.bg, env)} />
              </button>
            ))}
          </div>
          <Row label={t('Primer plano')}>
            <ColorInput label={t('Color de primer plano')} value={fill.fg} env={env} onChange={(c) => onChange({ ...fill, fg: c })} />
          </Row>
          <Row label={t('Fondo')}>
            <ColorInput label={t('Color de fondo de la trama')} value={fill.bg} env={env} onChange={(c) => onChange({ ...fill, bg: c })} />
          </Row>
        </>
      )}
      {fill && fill.t === 'blip' && (
        <>
          <div className="sl-picprev">{env.assetUrl(fill.src) ? <img src={env.assetUrl(fill.src)} alt="" /> : null}</div>
          <Button size="small" onClick={() => void env.pickPicture().then((src) => src && onChange({ ...fill, src }))}>
            {t('Insertar imagen…')}
          </Button>
          <label className="sl-check">
            <input type="checkbox" checked={!!fill.tile} onChange={(e) => onChange(e.target.checked ? { ...fill, stretch: undefined, tile: { tx: 0, ty: 0, sx: 100, sy: 100 } } : { ...fill, tile: undefined, stretch: true })} /> {t('Colocar la imagen en mosaico como textura')}
          </label>
          <Row label={t('Transparencia')}>
            <input type="range" min={0} max={100} aria-label={t('Transparencia de la imagen')} value={100 - (fill.alpha ?? 100)} onChange={(e) => onChange({ ...fill, alpha: 100 - Number(e.target.value) })} />
          </Row>
        </>
      )}
    </div>
  );
}

function PatternSwatch({ prst, fg, bg }: { prst: string; fg: string; bg: string }) {
  const tile = patternTile(prst);
  return (
    <svg width={24} height={24} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      <rect width={8} height={8} fill={bg} />
      {tile.map((row, y) => [...row].map((c, x) => (c === '1' ? <rect key={`${x}${y}`} x={x} y={y} width={1} height={1} fill={fg} /> : null)))}
    </svg>
  );
}

function GradientEditor({ fill, env, onChange }: { fill: Extract<Fill, { t: 'grad' }>; env: EditorEnv; onChange: (f: Fill) => void }) {
  const stops = [...fill.stops].sort((a, b) => a.pos - b.pos);
  const css = fill.path ? `radial-gradient(circle, ${[...stops].reverse().map((s) => `${clrCss(s.c, env.cc)} ${(100000 - s.pos) / 1000}%`).join(',')})` : `linear-gradient(90deg, ${stops.map((s) => `${clrCss(s.c, env.cc)} ${s.pos / 1000}%`).join(',')})`;
  const setStop = (i: number, patch: Partial<GradStop>) => onChange({ ...fill, stops: stops.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  return (
    <div className="sl-grad">
      <div className="sl-gradbar" style={{ background: css }} aria-hidden="true" />
      <div className="sl-presets" role="group" aria-label={t('Degradados predefinidos')}>
        {GRAD_PRESETS.map((p, i) => (
          <button key={p.label} type="button" title={t(p.label)} aria-label={t(p.label)} style={{ background: i === 4 ? `radial-gradient(circle,#fff,#7030a0)` : `linear-gradient(90deg,${p.stops.map((s) => `${s.c.rgb} ${s.pos / 1000}%`).join(',')})` }} onClick={() => onChange(i === 4 ? { t: 'grad', stops: p.stops, path: { kind: 'circle', rect: { l: 50000, t: 50000, r: 50000, b: 50000 } } } : { t: 'grad', stops: p.stops, lin: { ang: p.ang, scaled: false } })} />
        ))}
      </div>
      <Row label={t('Tipo')}>
        <select className="nv-select" aria-label={t('Tipo de degradado')} value={fill.path ? fill.path.kind : 'linear'} onChange={(e) => onChange(e.target.value === 'linear' ? { ...fill, path: undefined, lin: { ang: 90, scaled: false } } : { ...fill, lin: undefined, path: { kind: e.target.value as 'circle' | 'rect' | 'shape', rect: { l: 50000, t: 50000, r: 50000, b: 50000 } } })}>
          <option value="linear">{t('Lineal')}</option>
          <option value="circle">{t('Radial')}</option>
          <option value="rect">{t('Rectangular')}</option>
          <option value="shape">{t('Trayectoria')}</option>
        </select>
      </Row>
      {!fill.path && (
        <Row label={t('Ángulo')}>
          <input type="number" aria-label={t('Ángulo del degradado')} min={0} max={359} value={Math.round(fill.lin?.ang ?? 0)} onChange={(e) => onChange({ ...fill, lin: { ang: Number(e.target.value), scaled: fill.lin?.scaled } })} />°
        </Row>
      )}
      {stops.map((s, i) => (
        <div key={i} className="sl-stop">
          <span>{t('Punto')} {i + 1}</span>
          <ColorInput label={`${t('Color del punto')} ${i + 1}`} value={s.c} env={env} alpha onChange={(c) => setStop(i, { c })} />
          <input type="number" aria-label={`${t('Posición del punto')} ${i + 1}`} min={0} max={100} value={Math.round(s.pos / 1000)} onChange={(e) => setStop(i, { pos: Number(e.target.value) * 1000 })} />%
          <Button size="small" disabled={stops.length <= 2} aria-label={`${t('Quitar el punto')} ${i + 1}`} onClick={() => onChange({ ...fill, stops: stops.filter((_, k) => k !== i) })}>
            ✕
          </Button>
        </div>
      ))}
      <Button size="small" onClick={() => onChange({ ...fill, stops: [...stops, { pos: 50000, c: { rgb: '#ffffff' } }] })}>
        {t('Agregar punto de degradado')}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ line

const DASHES: [DashPreset, string][] = [['solid', 'Continuo'], ['sysDot', 'Puntos redondos'], ['sysDash', 'Guiones cuadrados'], ['dash', 'Guión'], ['dashDot', 'Guión y punto'], ['lgDash', 'Guión largo'], ['lgDashDot', 'Guión largo y punto'], ['lgDashDotDot', 'Guión largo y dos puntos']];
const ENDS = [['none', 'Ninguna'], ['triangle', 'Triángulo'], ['stealth', 'Punta de flecha'], ['arrow', 'Flecha abierta'], ['diamond', 'Rombo'], ['oval', 'Óvalo']] as const;

export function LineEditor({ ln, env, onChange, arrows }: { ln: Ln | undefined; env: EditorEnv; onChange: (l: Ln) => void; arrows?: boolean }) {
  const has = !!ln && !!ln.fill && ln.fill.t !== 'none';
  const l = ln ?? {};
  const set = (p: Partial<Ln>) => onChange({ ...l, ...p });
  const idp = useRef(`l${Math.random().toString(36).slice(2, 7)}`).current;
  return (
    <div className="sl-lineeditor">
      <div role="radiogroup" aria-label={t('Tipo de línea')} className="sl-radios">
        <label>
          <input type="radio" name={idp} checked={!has} onChange={() => set({ fill: { t: 'none' } })} /> {t('Sin línea')}
        </label>
        <label>
          <input type="radio" name={idp} checked={has} onChange={() => set({ fill: l.fill && l.fill.t === 'solid' ? l.fill : { t: 'solid', c: { scheme: 'accent1', mods: [{ t: 'shade', v: 50000 }] } }, w: l.w ?? 1 })} /> {t('Línea continua')}
        </label>
      </div>
      {has && (
        <>
          <Row label={t('Color')}>
            <ColorInput label={t('Color de línea')} value={l.fill && l.fill.t === 'solid' ? l.fill.c : undefined} env={env} alpha onChange={(c) => set({ fill: { t: 'solid', c } })} />
          </Row>
          <Row label={t('Ancho')}>
            <input type="number" step={0.25} min={0} max={100} aria-label={t('Ancho de línea (pt)')} value={l.w ?? 0.75} onChange={(e) => set({ w: Number(e.target.value) })} /> pt
          </Row>
          <Row label={t('Tipo de guión')}>
            <select className="nv-select" aria-label={t('Tipo de guión')} value={l.dash ?? 'solid'} onChange={(e) => set({ dash: e.target.value as DashPreset, custDash: undefined })}>
              {DASHES.map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t('Tipo de remate')}>
            <select className="nv-select" aria-label={t('Tipo de remate')} value={l.cap ?? 'flat'} onChange={(e) => set({ cap: e.target.value as Ln['cap'] })}>
              <option value="flat">{t('Plano')}</option>
              <option value="rnd">{t('Redondo')}</option>
              <option value="sq">{t('Cuadrado')}</option>
            </select>
          </Row>
          <Row label={t('Tipo de combinación')}>
            <select className="nv-select" aria-label={t('Tipo de combinación')} value={l.join ?? 'round'} onChange={(e) => set({ join: e.target.value as Ln['join'] })}>
              <option value="round">{t('Redonda')}</option>
              <option value="bevel">{t('Biselada')}</option>
              <option value="miter">{t('Angular')}</option>
            </select>
          </Row>
          <Row label={t('Línea compuesta')}>
            <select className="nv-select" aria-label={t('Línea compuesta')} value={l.cmpd ?? 'sng'} onChange={(e) => set({ cmpd: e.target.value as Ln['cmpd'] })}>
              <option value="sng">{t('Sencilla')}</option>
              <option value="dbl">{t('Doble')}</option>
              <option value="thickThin">{t('Gruesa y fina')}</option>
              <option value="thinThick">{t('Fina y gruesa')}</option>
              <option value="tri">{t('Triple')}</option>
            </select>
          </Row>
          {arrows !== false && (
            <>
              <Row label={t('Inicio de la flecha')}>
                <select className="nv-select" aria-label={t('Tipo de inicio de flecha')} value={l.head?.type ?? 'none'} onChange={(e) => set({ head: { ...l.head, type: e.target.value as never } })}>
                  {ENDS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {t(v)}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label={t('Final de la flecha')}>
                <select className="nv-select" aria-label={t('Tipo de final de flecha')} value={l.tail?.type ?? 'none'} onChange={(e) => set({ tail: { ...l.tail, type: e.target.value as never } })}>
                  {ENDS.map(([k, v]) => (
                    <option key={k} value={k}>
                      {t(v)}
                    </option>
                  ))}
                </select>
              </Row>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ effects

export function EffectsEditor({ fx, env, onChange }: { fx: Effects | undefined; env: EditorEnv; onChange: (e: Effects) => void }) {
  const e = fx ?? {};
  const set = (p: Partial<Effects>) => onChange({ ...e, ...p });
  const shadow = e.outer;
  const num = (label: string, value: number, apply: (v: number) => void, o: { min?: number; max?: number; step?: number } = {}) => (
    <Row label={label}>
      <input type="number" aria-label={label} min={o.min ?? 0} max={o.max ?? 500} step={o.step ?? 1} value={Math.round(value * 100) / 100} onChange={(ev) => apply(Number(ev.target.value))} />
    </Row>
  );
  const sh = (s: Shadow) => (patch: Partial<Shadow>) => set({ outer: { ...s, ...patch } });
  return (
    <div className="sl-fxeditor">
      <fieldset>
        <legend>
          <label>
            <input type="checkbox" checked={!!shadow} onChange={(ev) => set({ outer: ev.target.checked ? { blur: 4, dist: 3, dir: 45, c: { rgb: '#000000', mods: [{ t: 'alpha', v: 40000 }] }, algn: 'tl', rotWithShape: false } : undefined })} /> {t('Sombra')}
          </label>
        </legend>
        {shadow && (
          <>
            <Row label={t('Color')}>
              <ColorInput label={t('Color de la sombra')} value={shadow.c} env={env} alpha onChange={(c) => sh(shadow)({ c })} />
            </Row>
            {num(t('Desenfoque (pt)'), shadow.blur, (v) => sh(shadow)({ blur: v }))}
            {num(t('Distancia (pt)'), shadow.dist, (v) => sh(shadow)({ dist: v }))}
            {num(t('Ángulo (°)'), shadow.dir, (v) => sh(shadow)({ dir: v }), { max: 359 })}
            {num(t('Tamaño (%)'), shadow.sx ?? 100, (v) => sh(shadow)({ sx: v, sy: v }), { min: 1, max: 300 })}
          </>
        )}
      </fieldset>
      <fieldset>
        <legend>
          <label>
            <input type="checkbox" checked={!!e.reflection} onChange={(ev) => set({ reflection: ev.target.checked ? { blur: 0.5, stA: 50, stPos: 0, endA: 0, endPos: 35, dist: 0, dir: 90, fadeDir: 90, sx: 100, sy: -100, algn: 'bl', rotWithShape: false } : undefined })} /> {t('Reflejo')}
          </label>
        </legend>
        {e.reflection && (
          <>
            {num(t('Transparencia inicial (%)'), 100 - e.reflection.stA, (v) => set({ reflection: { ...e.reflection!, stA: 100 - v } }), { max: 100 })}
            {num(t('Tamaño (%)'), e.reflection.endPos, (v) => set({ reflection: { ...e.reflection!, endPos: v } }), { max: 100 })}
            {num(t('Distancia (pt)'), e.reflection.dist, (v) => set({ reflection: { ...e.reflection!, dist: v } }))}
            {num(t('Desenfoque (pt)'), e.reflection.blur, (v) => set({ reflection: { ...e.reflection!, blur: v } }))}
          </>
        )}
      </fieldset>
      <fieldset>
        <legend>
          <label>
            <input type="checkbox" checked={!!e.glow} onChange={(ev) => set({ glow: ev.target.checked ? { rad: 8, c: { scheme: 'accent1', mods: [{ t: 'alpha', v: 60000 }] } } : undefined })} /> {t('Iluminado')}
          </label>
        </legend>
        {e.glow && (
          <>
            <Row label={t('Color')}>
              <ColorInput label={t('Color del iluminado')} value={e.glow.c} env={env} alpha onChange={(c) => set({ glow: { ...e.glow!, c } })} />
            </Row>
            {num(t('Tamaño (pt)'), e.glow.rad, (v) => set({ glow: { ...e.glow!, rad: v } }))}
          </>
        )}
      </fieldset>
      <fieldset>
        <legend>
          <label>
            <input type="checkbox" checked={!!e.softEdge} onChange={(ev) => set({ softEdge: ev.target.checked ? { rad: 5 } : undefined })} /> {t('Bordes suaves')}
          </label>
        </legend>
        {e.softEdge && num(t('Tamaño (pt)'), e.softEdge.rad, (v) => set({ softEdge: { rad: v } }))}
      </fieldset>
    </div>
  );
}

export { parseHex };
