import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { newPicture, withAdjust, type PicEl } from '@suitenova/slides-core';
import { useEffect, useState } from 'react';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { EQUATION_EXAMPLES, EQUATION_NAME, mathml, renderEquation } from './equation';

type P = { ui: SlidesUI; onClose: () => void };

// ------------------------------------------------------------------------------------------------ equation

export function EquationDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const sel = c.selected.length === 1 ? c.selected[0]! : null;
  const editing = sel && sel.kind === 'pic' && sel.name === EQUATION_NAME ? sel : null;
  const [latex, setLatex] = useState(editing?.descr || 'x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}');
  const [error, setError] = useState('');
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);

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
      const img = await renderEquation(latex);
      const id = ui.addAsset(img.bytes, 'image/png', 'ecuacion.png');
      if (editing) {
        // the formula changes, the picture keeps its place and its width
        const el = editing as PicEl;
        const x = c.xfrmOf(el);
        c.patch([el.id], 'Editar ecuación', (e) => ({ ...(e as PicEl), src: id, descr: latex, xfrm: { ...x, h: (x.w * img.h) / img.w } }));
      } else {
        const pic = newPicture(id, (c.deck.size.w - img.w) / 2, (c.deck.size.h - img.h) / 2, img.w, img.h, latex);
        c.addElement({ ...pic, name: EQUATION_NAME }, { select: true });
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
            <button key={e.name} type="button" className="sl-chip" onClick={() => setLatex(e.latex)}>{t(e.name)}</button>
          ))}
        </div>
        <label className="sl-field">
          <span>{t('Fórmula (LaTeX)')}</span>
          <textarea rows={3} aria-label={t('Fórmula en LaTeX')} value={latex} onChange={(e) => setLatex(e.target.value)} spellCheck={false} />
        </label>
        <div className="sl-eqprev" aria-label={t('Vista previa de la fórmula')} data-testid="eq-preview">
          {error ? <span role="alert" className="sl-eqerr">{error}</span> : <span dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
        <p className="sl-note">{t('La ecuación se guarda como una imagen con la fórmula como texto alternativo; en PowerPoint no se puede editar como ecuación.')}</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ picture corrections

export function PictureCorrectionsDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const pics = c.selected.filter((e): e is PicEl => e.kind === 'pic');
  const a = pics[0]?.adjust;
  const [bright, setBright] = useState(a?.bright ?? 0);
  const [contrast, setContrast] = useState(a?.contrast ?? 0);
  const [alpha, setAlpha] = useState(a?.alpha ?? 100);
  const apply = () => {
    c.patch(pics.map((p) => p.id), 'Correcciones de imagen', (e) => ({ ...(e as PicEl), adjust: withAdjust((e as PicEl).adjust, { bright, contrast, alpha }) }));
    onClose();
  };
  const slider = (label: string, v: number, set: (n: number) => void, min: number, max: number) => (
    <label className="sl-field">
      <span>{label}: {v} %</span>
      <input type="range" min={min} max={max} step={1} aria-label={label} value={v} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
  return (
    <Modal
      title={t('Correcciones de imagen')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={() => (setBright(0), setContrast(0), setAlpha(100))}>{t('Restablecer')}</Button>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={apply}>{t('Aceptar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        {slider(t('Brillo'), bright, setBright, -100, 100)}
        {slider(t('Contraste'), contrast, setContrast, -100, 100)}
        {slider(t('Transparencia'), 100 - alpha, (v) => setAlpha(100 - v), 0, 100)}
      </div>
    </Modal>
  );
}
