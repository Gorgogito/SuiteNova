import { Button, Checkbox, Input, Select } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { nodeTypes, parseMath, scaleGroupContent, toTex, type MNode } from '@suitenova/writer-core';
import { NodeSelection } from 'prosemirror-state';
import { outerGroupPos } from './shape-selection';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { EquationEditor } from '../math/EquationEditor';
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

export function EquationDialog({ ui, pos, onClose }: { ui: WriterUI; pos?: number; onClose: () => void }) {
  const ctl = ui.ctl;
  const existing = pos !== undefined ? ctl.mainView?.state.doc.nodeAt(pos) : null;
  const initial = existing && existing.type.name === 'math' ? (existing.attrs.tex as string) : (ctl.mainState && !ctl.mainState.selection.empty ? ctl.mainState.doc.textBetween(ctl.mainState.selection.from, ctl.mainState.selection.to, ' ') : '');
  const [tex, setTex] = useState(initial);
  const [tree, setTree] = useState<MNode>(() => parseMath(initial));
  const [display, setDisplay] = useState(existing && existing.type.name === 'math' ? !!existing.attrs.display : false);
  const setCode = (code: string) => {
    setTex(code);
    setTree(parseMath(code));
  };
  const accept = () => {
    const v = ctl.mainView;
    if (v) {
      const node = nodeTypes.math!.create({ tex: tex.trim(), display, ...(existing && existing.type.name === 'math' ? { omml: existing.attrs.omml, ommlTex: existing.attrs.ommlTex } : {}) });
      if (existing && pos !== undefined) v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, node.attrs));
      else v.dispatch(v.state.tr.replaceSelectionWith(node, false).scrollIntoView());
    }
    onClose();
    focusDocSoon(ui);
  };
  return (
    <Modal
      title={t('Ecuación')}
      width={720}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!tex.trim()} onClick={accept}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <EquationEditor
        value={tree}
        autoFocus
        onChange={(n) => {
          setTree(n);
          setTex(toTex(n).trim());
        }}
      />
      <div style={{ ...field, marginTop: 8 }}>
        <label htmlFor="nw-eq-src">{t('Código LaTeX (se actualiza solo; también se puede escribir aquí)')}</label>
        <textarea id="nw-eq-src" className="nw-card-edit" style={{ minHeight: 48, fontFamily: 'Consolas, monospace' }} value={tex} onChange={(e) => setCode(e.target.value)} />
      </div>
      <Checkbox checked={display} onChange={(_e, d) => setDisplay(!!d.checked)} label={t('Ecuación en su propia línea (centrada)')} />
      <div style={{ ...field, marginTop: 8 }}>
        <label htmlFor="nw-eq-sample">{t('Ecuaciones frecuentes')}</label>
        <Select id="nw-eq-sample" value="" onChange={(_e, d) => d.value && setCode(d.value)}>
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
  const isGroup = node?.type.name === 'shape_group';
  // una hija de un grupo solo cambia de aspecto: su sitio, tamaño y giro son los del grupo
  const inGroup = !!node && !!ctl.mainView && outerGroupPos(ctl.mainView.state, pos) !== null;
  const a = node?.type.name === 'shape' || isGroup ? node!.attrs : null;
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
              if (v && isGroup && node) {
                // un grupo no tiene relleno ni contorno propios; si cambia de tamaño, sus hijas lo siguen
                const resized = w !== a.width || h !== a.height ? scaleGroupContent(node, w, h) : node;
                const next = resized.type.create({ ...resized.attrs, rotation: rot, wrap, alt }, resized.content, resized.marks);
                const tr = v.state.tr.replaceWith(pos, pos + node.nodeSize, next);
                tr.setSelection(NodeSelection.create(tr.doc, pos)).setMeta('nw-no-track', true);
                v.dispatch(tr);
              } else if (v && inGroup) {
                const tr = v.state.tr.setNodeMarkup(pos, undefined, { ...a, fill: noFill ? '#ffffff' : fill, stroke, strokeWidth: sw, alt }).setMeta('nw-no-track', true);
                v.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
              } else if (v) v.dispatch(v.state.tr.setNodeMarkup(pos, undefined, { ...a, fill: noFill ? '#ffffff' : fill, stroke, strokeWidth: sw, width: w, height: h, rotation: rot, wrap, alt }).setMeta('nw-no-track', true));
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
        {!isGroup && (
        <div style={field}>
          <label htmlFor="nw-sh-fill">{t('Relleno')}</label>
          <input id="nw-sh-fill" type="color" value={fill} disabled={noFill} onChange={(e) => setFill(e.target.value)} />
          <Checkbox checked={noFill} onChange={(_e, d) => setNoFill(!!d.checked)} label={t('Sin relleno')} />
        </div>
        )}
        {!isGroup && (
        <div style={field}>
          <label htmlFor="nw-sh-stroke">{t('Contorno')}</label>
          <input id="nw-sh-stroke" type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} />
        </div>
        )}
        {!isGroup && (
        <div style={field}>
          <label htmlFor="nw-sh-sw">{t('Grosor del contorno (px, 0 = sin contorno)')}</label>
          <Input id="nw-sh-sw" type="number" min={0} max={20} value={String(sw)} onChange={(_e, d) => setSw(Math.max(0, Number(d.value) || 0))} />
        </div>
        )}
        {!inGroup && (
        <div style={field}>
          <label htmlFor="nw-sh-rot">{t('Rotación (grados)')}</label>
          <Input id="nw-sh-rot" type="number" value={String(rot)} onChange={(_e, d) => setRot(Number(d.value) || 0)} />
        </div>
        )}
        {!inGroup && (
        <>
        <div style={field}>
          <label htmlFor="nw-sh-w">{t('Ancho (px)')}</label>
          <Input id="nw-sh-w" type="number" min={8} value={String(w)} onChange={(_e, d) => setW(Number(d.value) || 8)} />
        </div>
        <div style={field}>
          <label htmlFor="nw-sh-h">{t('Alto (px)')}</label>
          <Input id="nw-sh-h" type="number" min={8} value={String(h)} onChange={(_e, d) => setH(Number(d.value) || 8)} />
        </div>
        </>
        )}
      </div>
      {!inGroup && (
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
      )}
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
