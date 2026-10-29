import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { nodeTypes, parseMath, toMathML } from '@suitenova/writer-core';
import { useMemo, useRef, useState } from 'react';
import type { WriterUI } from './commands';
import { Modal, field, focusDocSoon } from './dialogs';
import { formatDatePattern, type ControlType } from './forms';

export const EQUATION_SAMPLES: { label: string; tex: string }[] = [
  { label: 'Teorema de Pitágoras', tex: String.raw`a^{2}+b^{2}=c^{2}` },
  { label: 'Fórmula cuadrática', tex: String.raw`x=\frac{-b \pm \sqrt{b^{2}-4ac}}{2a}` },
  { label: 'Área del círculo', tex: String.raw`A=\pi r^{2}` },
  { label: 'Binomio de Newton', tex: String.raw`(a+b)^{n}=\sum_{k=0}^{n} \binom{n}{k} a^{n-k} b^{k}` },
  { label: 'Serie de Taylor', tex: String.raw`e^{x}=\sum_{n=0}^{\infty} \frac{x^{n}}{n!}` },
  { label: 'Identidad de Euler', tex: String.raw`e^{i\pi}+1=0` },
  { label: 'Integral definida', tex: String.raw`\int_{a}^{b} f(x)\,dx=F(b)-F(a)` },
  { label: 'Límite', tex: String.raw`\lim_{x \to 0} \frac{\sin x}{x}=1` },
];

const PALETTE: { name: string; items: { label: string; tex: string; caret?: number }[] }[] = [
  {
    name: 'Estructuras',
    items: [
      { label: 'a/b', tex: String.raw`\frac{a}{b}` },
      { label: '√x', tex: String.raw`\sqrt{x}` },
      { label: 'ⁿ√x', tex: String.raw`\sqrt[n]{x}` },
      { label: 'xⁿ', tex: 'x^{n}' },
      { label: 'xᵢ', tex: 'x_{i}' },
      { label: 'xᵢⁿ', tex: 'x_{i}^{n}' },
      { label: '∑', tex: String.raw`\sum_{i=1}^{n} ` },
      { label: '∏', tex: String.raw`\prod_{i=1}^{n} ` },
      { label: '∫', tex: String.raw`\int_{a}^{b} f(x)\,dx` },
      { label: 'lím', tex: String.raw`\lim_{x \to 0} ` },
      { label: '( )', tex: String.raw`\left( x \right)` },
      { label: '[ ]', tex: String.raw`\left[ x \right]` },
      { label: '(ⁿₖ)', tex: String.raw`\binom{n}{k}` },
      { label: 'Matriz', tex: String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}` },
      { label: 'Sistema', tex: String.raw`\begin{cases} x+y=1 \\ x-y=0 \end{cases}` },
      { label: 'hat', tex: String.raw`\hat{x}` },
      { label: 'vec', tex: String.raw`\vec{x}` },
      { label: 'bar', tex: String.raw`\overline{x}` },
    ],
  },
  {
    name: 'Griegas',
    items: 'α β γ δ ε ζ η θ ι κ λ μ ν ξ π ρ σ τ υ φ χ ψ ω Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω'.split(' ').map((g) => ({
      label: g,
      tex: '\\' + ({ α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega', Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega' } as Record<string, string>)[g] + ' ',
    })),
  },
  {
    name: 'Operadores',
    items: [
      ['±', 'pm'], ['×', 'times'], ['÷', 'div'], ['·', 'cdot'], ['≤', 'leq'], ['≥', 'geq'], ['≠', 'neq'], ['≈', 'approx'], ['≡', 'equiv'], ['∞', 'infty'], ['∂', 'partial'], ['∇', 'nabla'], ['∈', 'in'], ['∉', 'notin'], ['⊂', 'subset'], ['∪', 'cup'], ['∩', 'cap'], ['→', 'to'], ['⇒', 'Rightarrow'], ['⇔', 'Leftrightarrow'], ['∀', 'forall'], ['∃', 'exists'], ['…', 'ldots'], ['°', 'degree'],
    ].map(([label, cmd]) => ({ label: label!, tex: `\\${cmd} ` })),
  },
  {
    name: 'Funciones',
    items: ['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'max', 'min', 'det'].map((f) => ({ label: f, tex: `\\${f} ` })),
  },
];

export function EquationDialog({ ui, pos, onClose }: { ui: WriterUI; pos?: number; onClose: () => void }) {
  const ctl = ui.ctl;
  const existing = pos !== undefined ? ctl.mainView?.state.doc.nodeAt(pos) : null;
  const initial = existing && existing.type.name === 'math' ? (existing.attrs.tex as string) : (ctl.mainState && !ctl.mainState.selection.empty ? ctl.mainState.doc.textBetween(ctl.mainState.selection.from, ctl.mainState.selection.to, ' ') : '');
  const [tex, setTex] = useState(initial);
  const [display, setDisplay] = useState(existing && existing.type.name === 'math' ? !!existing.attrs.display : false);
  const [tab, setTab] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => {
    try {
      return tex.trim() ? toMathML(parseMath(tex), display) : '';
    } catch {
      return '';
    }
  }, [tex, display]);
  const insertAt = (snippet: string) => {
    const el = area.current;
    const a = el?.selectionStart ?? tex.length;
    const b = el?.selectionEnd ?? tex.length;
    const next = tex.slice(0, a) + snippet + tex.slice(b);
    setTex(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(a + snippet.length, a + snippet.length);
    });
  };
  return (
    <Modal
      title={t('Ecuación')}
      width={680}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={!tex.trim()}
            onClick={() => {
              const v = ctl.mainView;
              if (v) {
                const node = nodeTypes.math!.create({ tex: tex.trim(), display });
                if (existing && pos !== undefined) v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, node.attrs));
                else v.dispatch(v.state.tr.replaceSelectionWith(node, false).scrollIntoView());
              }
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }} role="tablist">
        {PALETTE.map((g, i) => (
          <Button key={g.name} size="small" appearance={tab === i ? 'primary' : 'secondary'} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}>
            {t(g.name)}
          </Button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minHeight: 64, marginBottom: 8 }}>
        {PALETTE[tab]!.items.map((it) => (
          <Button key={it.label + it.tex} size="small" onClick={() => insertAt(it.tex)} title={it.tex}>
            {it.label}
          </Button>
        ))}
      </div>
      <div style={field}>
        <label htmlFor="nw-eq-src">{t('Ecuación (escriba en formato LaTeX o use los botones)')}</label>
        <textarea id="nw-eq-src" ref={area} className="nw-card-edit" style={{ minHeight: 70, fontFamily: 'Consolas, monospace' }} value={tex} autoFocus onChange={(e) => setTex(e.target.value)} />
      </div>
      <div className="nw-eq-preview" aria-label={t('Vista previa')} dangerouslySetInnerHTML={{ __html: preview || `<span style="color:#888">${t('Vista previa')}</span>` }} />
      <Checkbox checked={display} onChange={(_e, d) => setDisplay(!!d.checked)} label={t('Ecuación en su propia línea (centrada)')} />
      <div style={{ ...field, marginTop: 8 }}>
        <label htmlFor="nw-eq-sample">{t('Ecuaciones frecuentes')}</label>
        <Select id="nw-eq-sample" value="" onChange={(_e, d) => d.value && setTex(d.value)}>
          <option value="">—</option>
          {EQUATION_SAMPLES.map((s) => (
            <option key={s.label} value={s.tex}>
              {t(s.label)}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ shape format

export function ShapeDialog({ ui, pos, onClose }: { ui: WriterUI; pos: number; onClose: () => void }) {
  const ctl = ui.ctl;
  const node = ctl.mainView?.state.doc.nodeAt(pos);
  const a = node?.type.name === 'shape' ? node.attrs : null;
  const [fill, setFill] = useState<string>(a?.fill ?? '#ffffff');
  const [noFill, setNoFill] = useState(a?.kind === 'textbox' && a.fill === '#ffffff');
  const [stroke, setStroke] = useState<string>(a?.stroke ?? '#000000');
  const [sw, setSw] = useState<number>(a?.strokeWidth ?? 1);
  const [w, setW] = useState<number>(a?.width ?? 120);
  const [h, setH] = useState<number>(a?.height ?? 80);
  const [rot, setRot] = useState<number>(a?.rotation ?? 0);
  const [wrap, setWrap] = useState<string>(a?.wrap ?? 'inline');
  const [alt, setAlt] = useState<string>(a?.alt ?? '');
  if (!a) return null;
  return (
    <Modal
      title={t('Formato de forma')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            disabled={w < 8 || h < 8}
            onClick={() => {
              const v = ctl.mainView;
              if (v) v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...a, fill: noFill ? '#ffffff' : fill, stroke, strokeWidth: sw, width: w, height: h, rotation: rot, wrap, alt }).setMeta('nw-no-track', true));
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
        <div style={field}>
          <label htmlFor="nw-sh-fill">{t('Relleno')}</label>
          <input id="nw-sh-fill" type="color" value={fill} disabled={noFill} onChange={(e) => setFill(e.target.value)} />
          <Checkbox checked={noFill} onChange={(_e, d) => setNoFill(!!d.checked)} label={t('Sin relleno')} />
        </div>
        <div style={field}>
          <label htmlFor="nw-sh-stroke">{t('Contorno')}</label>
          <input id="nw-sh-stroke" type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} />
        </div>
        <div style={field}>
          <label htmlFor="nw-sh-sw">{t('Grosor del contorno (px, 0 = sin contorno)')}</label>
          <Input id="nw-sh-sw" type="number" min={0} max={20} value={String(sw)} onChange={(_e, d) => setSw(Math.max(0, Number(d.value) || 0))} />
        </div>
        <div style={field}>
          <label htmlFor="nw-sh-rot">{t('Rotación (grados)')}</label>
          <Input id="nw-sh-rot" type="number" value={String(rot)} onChange={(_e, d) => setRot(Number(d.value) || 0)} />
        </div>
        <div style={field}>
          <label htmlFor="nw-sh-w">{t('Ancho (px)')}</label>
          <Input id="nw-sh-w" type="number" min={8} value={String(w)} onChange={(_e, d) => setW(Number(d.value) || 8)} />
        </div>
        <div style={field}>
          <label htmlFor="nw-sh-h">{t('Alto (px)')}</label>
          <Input id="nw-sh-h" type="number" min={8} value={String(h)} onChange={(_e, d) => setH(Number(d.value) || 8)} />
        </div>
      </div>
      <div style={field}>
        <label htmlFor="nw-sh-wrap">{t('Ajuste del texto')}</label>
        <Select id="nw-sh-wrap" value={wrap} onChange={(_e, d) => setWrap(d.value)}>
          <option value="inline">{t('En línea con el texto')}</option>
          <option value="left">{t('Cuadrado, a la izquierda')}</option>
          <option value="right">{t('Cuadrado, a la derecha')}</option>
          <option value="topBottom">{t('Arriba y abajo')}</option>
          <option value="front">{t('Delante del texto')}</option>
          <option value="behind">{t('Detrás del texto')}</option>
        </Select>
      </div>
      <div style={field}>
        <label htmlFor="nw-sh-alt">{t('Texto alternativo')}</label>
        <Input id="nw-sh-alt" value={alt} onChange={(_e, d) => setAlt(d.value)} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ content control properties

export function ControlDialog({ ui, pos, onClose }: { ui: WriterUI; pos: number; onClose: () => void }) {
  const ctl = ui.ctl;
  const node = ctl.mainView?.state.doc.nodeAt(pos);
  const a = node?.type.name === 'content_control' || node?.type.name === 'content_control_block' ? node.attrs : null;
  const [title, setTitle] = useState<string>(a?.title ?? '');
  const [tag, setTag] = useState<string>(a?.tag ?? '');
  const [placeholder, setPlaceholder] = useState<string>(a?.placeholder ?? '');
  const [lock, setLock] = useState<string>(a?.lock ?? '');
  const [items, setItems] = useState<string>(((a?.items as { label: string; value: string }[] | null) ?? []).map((i) => (i.label === i.value ? i.label : `${i.label}=${i.value}`)).join('\n'));
  const [fmt, setFmt] = useState<string>(a?.dateFormat ?? 'dd/MM/yyyy');
  if (!a) return null;
  const type = a.type as ControlType | undefined;
  return (
    <Modal
      title={t('Propiedades del control de contenido')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button
            appearance="primary"
            onClick={() => {
              const v = ctl.mainView;
              if (v) {
                const next: Record<string, unknown> = { ...a, title, tag, lock: lock || null };
                if (type) {
                  next.placeholder = placeholder;
                  if (type === 'dropdown' || type === 'combo') next.items = items.split('\n').filter((l) => l.trim()).map((l) => (l.includes('=') ? { label: l.split('=')[0]!.trim(), value: l.split('=').slice(1).join('=').trim() } : { label: l.trim(), value: l.trim() }));
                  if (type === 'date') next.dateFormat = fmt;
                }
                v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, next).setMeta('nw-no-track', true).setMeta('nw-allow', true));
              }
              onClose();
              focusDocSoon(ui);
            }}
          >
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="nw-cc-title">{t('Título')}</label>
        <Input id="nw-cc-title" value={title} onChange={(_e, d) => setTitle(d.value)} autoFocus />
      </div>
      <div style={field}>
        <label htmlFor="nw-cc-tag">{t('Etiqueta')}</label>
        <Input id="nw-cc-tag" value={tag} onChange={(_e, d) => setTag(d.value)} />
      </div>
      {type && type !== 'checkbox' && (
        <div style={field}>
          <label htmlFor="nw-cc-ph">{t('Texto de ayuda')}</label>
          <Input id="nw-cc-ph" value={placeholder} onChange={(_e, d) => setPlaceholder(d.value)} />
        </div>
      )}
      {(type === 'dropdown' || type === 'combo') && (
        <div style={field}>
          <label htmlFor="nw-cc-items">{t('Elementos de la lista (uno por línea; "texto=valor" opcional)')}</label>
          <textarea id="nw-cc-items" className="nw-card-edit" value={items} onChange={(e) => setItems(e.target.value)} />
        </div>
      )}
      {type === 'date' && (
        <div style={field}>
          <label htmlFor="nw-cc-fmt">{t('Formato de fecha')}</label>
          <Select id="nw-cc-fmt" value={fmt} onChange={(_e, d) => setFmt(d.value)}>
            {['dd/MM/yyyy', 'd/M/yyyy', 'yyyy-MM-dd', 'd \'de\' MMMM \'de\' yyyy', 'dddd, d \'de\' MMMM \'de\' yyyy', 'MM/dd/yyyy'].map((f) => (
              <option key={f} value={f}>
                {formatDatePattern(new Date(), f.replace(/'([^']*)'/g, '$1'))}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div style={field}>
        <label htmlFor="nw-cc-lock">{t('Bloqueo')}</label>
        <Select id="nw-cc-lock" value={lock} onChange={(_e, d) => setLock(d.value)}>
          <option value="">{t('El control se puede eliminar y su contenido editar')}</option>
          <option value="sdtLocked">{t('El control no se puede eliminar')}</option>
          <option value="contentLocked">{t('El contenido no se puede editar')}</option>
          <option value="sdtContentLocked">{t('No se puede eliminar ni editar')}</option>
        </Select>
      </div>
    </Modal>
  );
}
