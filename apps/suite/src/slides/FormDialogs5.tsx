import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { newNovaArt, NOVAART_STYLES, NOVAART_WARPS, novaArtStyle, warpOf, type BodyProps, type ShapeEl, type SlideElement } from '@suitenova/slides-core';
import { useState } from 'react';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';
import { runStyle } from './render/TextView';
import { applyRun } from './textcmds';

type P = { ui: SlidesUI; onClose: () => void };

// ------------------------------------------------------------------------------------------------ NovaArt (WordArt)

export function NovaArtDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const ctx = ui.canvasCtx();
  const [style, setStyle] = useState(NOVAART_STYLES[0]!.id);
  const [warp, setWarp] = useState('textPlain');
  const [text, setText] = useState(t('Su texto aquí'));
  const hasText = !!c.editor || c.selected.some((e) => e.kind === 'shape');

  const insert = () => {
    c.addElement(newNovaArt(style, text.trim() || 'NovaArt', warp, c.deck.size), { select: true });
    onClose();
  };
  const applySel = () => {
    const fx = structuredClone(novaArtStyle(style).fx);
    applyRun(c, (r) => ({ ...r, b: true, color: undefined, fx }), 'Estilo NovaArt');
    if (!c.editor)
      c.patchSelected('Transformación del texto', (el: SlideElement) => {
        if (el.kind !== 'shape') return el;
        const body: BodyProps = { ...el.text?.body, wrap: 'none' };
        const w = warpOf(warp);
        if (w) body.warp = w;
        else delete body.warp;
        return { ...el, text: { ...el.text!, body } } as ShapeEl;
      });
    onClose();
  };
  return (
    <Modal
      title={t('NovaArt')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          {hasText && <Button onClick={applySel}>{t('Aplicar al texto seleccionado')}</Button>}
          <Button appearance="primary" onClick={insert}>{t('Insertar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <div className="sl-artgrid" role="radiogroup" aria-label={t('Estilos de NovaArt')}>
          {NOVAART_STYLES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={style === s.id} aria-label={t(s.name)} title={t(s.name)} className={style === s.id ? 'is-on' : ''} onClick={() => setStyle(s.id)}>
              <span aria-hidden="true" style={ctx ? runStyle({ sz: 30, b: true, fx: s.fx }, ctx.env, 1) : undefined}>Abc</span>
            </button>
          ))}
        </div>
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Texto')}</span>
            <input aria-label={t('Texto de NovaArt')} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="sl-field">
            <span>{t('Transformar')}</span>
            <select aria-label={t('Transformar el texto')} value={warp} onChange={(e) => setWarp(e.target.value)}>
              {NOVAART_WARPS.map((w) => <option key={w.prst} value={w.prst}>{t(w.name)}</option>)}
            </select>
          </label>
        </div>
        <p className="sl-note">{t('NovaArt guarda el texto como WordArt de PowerPoint: relleno, contorno, sombra, reflejo, resplandor y transformación se conservan en el archivo.')}</p>
      </div>
    </Modal>
  );
}
