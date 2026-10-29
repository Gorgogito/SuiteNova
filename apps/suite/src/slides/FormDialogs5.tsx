import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { buildDiagram, DIAGRAM_LAYOUTS, diagramArea, newNovaArt, parseDiagramText, NOVAART_STYLES, NOVAART_WARPS, novaArtStyle, warpOf, type BodyProps, type ShapeEl, type SlideElement } from '@suitenova/slides-core';
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
              <span style={ctx ? runStyle({ sz: 30, b: true, fx: s.fx }, ctx.env, 1) : undefined}>Abc</span>
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

// ------------------------------------------------------------------------------------------------ diagrams (SmartArt)

const SAMPLE = 'Planificar\nHacer\nVerificar\nActuar';
const SAMPLE_HIER = 'Dirección\n  Ventas\n    Norte\n    Sur\n  Producción\n  Soporte';

export function SmartArtDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [layout, setLayout] = useState('process');
  const [text, setText] = useState(SAMPLE);
  const [colour, setColour] = useState(0);
  const items = parseDiagramText(text);
  const pick = (id: string) => {
    setLayout(id);
    if (text === SAMPLE || text === SAMPLE_HIER) setText(id === 'hier' ? SAMPLE_HIER : SAMPLE);
  };
  const insert = () => {
    c.addElement(buildDiagram(layout, items, diagramArea(c.deck.size), colour), { select: true });
    onClose();
  };
  return (
    <Modal
      title={t('Insertar un diagrama (SmartArt)')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!items.length} onClick={insert}>{t('Insertar')}</Button>
        </>
      }
    >
      <div className="sl-form">
        <div className="sl-layouts" role="radiogroup" aria-label={t('Diseño del diagrama')}>
          {DIAGRAM_LAYOUTS.map((l) => (
            <label key={l.id} className={layout === l.id ? 'is-on' : ''}>
              <input type="radio" name="dg-layout" checked={layout === l.id} onChange={() => pick(l.id)} />
              <b>{t(l.name)}</b>
              <small>{t(l.description)}</small>
            </label>
          ))}
        </div>
        <label className="sl-field">
          <span>{t('Elementos (uno por línea; con sangría para los subniveles)')}</span>
          <textarea rows={7} aria-label={t('Elementos del diagrama')} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="sl-field">
          <span>{t('Color')}</span>
          <select aria-label={t('Color del diagrama')} value={colour} onChange={(e) => setColour(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n, i) => <option key={n} value={i}>{t('Énfasis {n}', { n })}</option>)}
          </select>
        </label>
        <p className="sl-note">{t('El diagrama se inserta como un grupo de formas que puedes editar una a una; no queda vinculado a la lista, así que para cambiarla se genera de nuevo.')}</p>
      </div>
    </Modal>
  );
}
