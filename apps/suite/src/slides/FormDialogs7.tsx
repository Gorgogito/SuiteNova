import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { parseMath, toTex, type MNode } from '@suitenova/math-core';
import { newMathBox, type PicEl, type ShapeEl } from '@suitenova/slides-core';
import { useEffect, useState } from 'react';
import { EquationEditor } from '../math/EquationEditor';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { EQUATION_EXAMPLES, EQUATION_NAME, EQUATION_SIZE, mathml, renderEquation } from './equation';

type P = { ui: SlidesUI; onClose: () => void };

// ------------------------------------------------------------------------------------------------ equation

export function EquationDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const sel = c.selected.length === 1 ? c.selected[0]! : null;
  // una ecuación es un cuadro con la fórmula; las de versiones anteriores eran una imagen y se convierten al editarlas
  const box = sel && sel.kind === 'shape' && sel.math ? (sel as ShapeEl) : null;
  const legacy = sel && sel.kind === 'pic' && sel.name === EQUATION_NAME ? (sel as PicEl) : null;
  const start = box?.math?.tex || legacy?.descr || 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}';
  const [latex, setLatex] = useState(start);
  const [tree, setTree] = useState<MNode>(() => parseMath(start));
  const [size, setSize] = useState(box?.math?.size ?? EQUATION_SIZE);
  const [error, setError] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const editing = box ?? legacy;

  useEffect(() => {
    try {
      setHtml(latex.trim() ? mathml(latex) : '');
      setError('');
    } catch (e) {
      setHtml('');
      setError((e as Error).message.replace(/^KaTeX parse error: /, ''));
    }
  }, [latex]);

  const apply = async () => {
    setBusy(true);
    try {
      const pt = Math.min(200, Math.max(6, size || EQUATION_SIZE));
      const img = await renderEquation(latex, '#000000', pt);
      const id = ui.addAsset(img.bytes, 'image/png', 'ecuacion.png');
      if (box) {
        // the formula changes, the box keeps its place; the original OMML is kept only while neither formula nor size change
        const old = box.math!;
        const same = old.tex === latex && (old.size ?? EQUATION_SIZE) === pt;
        const x = c.xfrmOf(box);
        c.patch([box.id], 'Editar ecuación', (e) => ({
          ...(e as ShapeEl),
          descr: latex,
          math: { ...old, tex: latex, size: pt, fallback: same ? old.fallback : id, ...(same ? {} : { omml: undefined, ommlTex: undefined }) },
          xfrm: same ? x : { ...x, x: x.x + (x.w - img.w) / 2, y: x.y + (x.h - img.h) / 2, w: img.w, h: img.h },
        }));
      } else {
        const math = { tex: latex, display: true, size: pt, fallback: id };
        const at = legacy ? c.xfrmOf(legacy) : undefined;
        const el = newMathBox(math, at ? at.x + (at.w - img.w) / 2 : (c.deck.size.w - img.w) / 2, at ? at.y + (at.h - img.h) / 2 : (c.deck.size.h - img.h) / 2, img.w, img.h);
        if (legacy) c.deleteSelected();
        c.addElement(el, { select: true });
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Ecuación')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!html || busy} onClick={() => void apply()}>{editing ? t('Aplicar') : t('Insertar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <div className="sl-layouts" role="group" aria-label={t('Ejemplos')}>
          {EQUATION_EXAMPLES.map((e) => (
            <button key={e.name} type="button" className="sl-chip" onClick={() => { setLatex(e.latex); setTree(parseMath(e.latex)); }}>{t(e.name)}</button>
          ))}
        </div>
        <EquationEditor value={tree} autoFocus onChange={(n) => setLatex(toTex(n).trim())} />
        <label className="sl-field">
          <span>{t('Código LaTeX (se actualiza solo; también se puede escribir aquí)')}</span>
          <textarea rows={2} aria-label={t('Fórmula en LaTeX')} value={latex} onChange={(e) => { setLatex(e.target.value); setTree(parseMath(e.target.value)); }} spellCheck={false} />
        </label>
        <div className="sl-eqprev" aria-label={t('Vista previa de la fórmula')} data-testid="eq-preview">
          {error ? <span role="alert" className="sl-eqerr">{error}</span> : <span dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
        <label className="sl-field">
          <span>{t('Tamaño de la ecuación (pt)')}</span>
          <input type="number" min={6} max={200} step={1} aria-label={t('Tamaño de la ecuación (pt)')} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <p className="sl-note">{t('La ecuación se guarda como texto de ecuación (PowerPoint la edita como cualquier ecuación) con una imagen de respaldo para los programas que no la entienden.')}</p>
      </div>
    </Modal>
  );
}
