import { Button, Checkbox, DialogActions, DialogContent, DialogTitle, Input } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { findInDiagram, type Hit } from '@suitenova/diagram-core';
import { packResult, unpackResult } from '@suitenova/ocr-core';
import { useMemo, useState } from 'react';
import { ImageTextBody } from '../ocr/ImageTextBody';
import type { DiagramCtl } from './ctl';

/** The text read from the selected picture: where it is, read it again (language, turn, zone) and copy it. */
export function ImageTextForm({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  const [, setRev] = useState(0);
  const s = ctl.selectedShapes();
  const shape = s.length === 1 && s[0]!.image ? s[0]! : null;
  if (!shape?.image) return null;
  return (
    <>
      <DialogTitle>{t('Texto de la imagen')}</DialogTitle>
      <DialogContent>
        <ImageTextBody
          src={shape.image.src}
          result={shape.image.ocr ? unpackResult(shape.image.ocr) : null}
          lang={ctl.imageOcr.lang}
          onLang={(l) => (ctl.imageOcr.lang = l)}
          onReading={(r) => {
            ctl.setShapeOcr(shape.id, packResult({ ...r, text: r.text.trim() }));
            setRev((n) => n + 1);
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button appearance="primary" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      </DialogActions>
    </>
  );
}

/** Find text in the shapes, the connectors and the pictures of every page; clicking a result goes to it. */
export function FindForm({ ctl, onClose }: { ctl: DiagramCtl; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [cur, setCur] = useState(-1);
  const hits = useMemo(() => findInDiagram(ctl.diagram, q, { matchCase, wholeWord: whole }), [ctl.diagram, q, matchCase, whole]);
  const go = (i: number) => {
    const h: Hit | undefined = hits[i];
    if (!h) return;
    setCur(i);
    ctl.goToPage(h.pageId);
    if (h.where === 'connector') ctl.setSelection([], [h.id]);
    else ctl.setSelection([h.id]);
  };
  const next = (d: 1 | -1) => hits.length && go(((cur < 0 ? (d === 1 ? -1 : 0) : cur) + d + hits.length) % hits.length);
  const label = (h: Hit) => (h.where === 'picture' ? t('imagen') : h.where === 'connector' ? t('línea') : t('forma'));
  return (
    <>
      <DialogTitle>{t('Buscar')}</DialogTitle>
      <DialogContent>
        <div className="dg-form">
          <label htmlFor="dg-find">{t('Buscar')}</label>
          <Input
            id="dg-find"
            autoFocus
            value={q}
            onChange={(_e, d) => {
              setQ(d.value);
              setCur(-1);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), next(e.shiftKey ? -1 : 1))}
          />
          <Checkbox label={t('Coincidir mayúsculas y minúsculas')} checked={matchCase} onChange={(_e, d) => setMatchCase(!!d.checked)} />
          <Checkbox label={t('Solo palabras completas')} checked={whole} onChange={(_e, d) => setWhole(!!d.checked)} />
          <p role="status" aria-live="polite" style={{ gridColumn: '1 / -1' }}>
            {q ? (hits.length ? t('{n} coincidencias', { n: hits.length }) : t('No se encontró «{q}».', { q })) : ''}
          </p>
          <ol aria-label={t('Resultados')} style={{ gridColumn: '1 / -1', maxHeight: 220, overflow: 'auto', margin: 0, paddingLeft: 20 }}>
            {hits.map((h, i) => (
              <li key={`${h.id}:${h.where}:${i}`}>
                <button type="button" aria-current={i === cur} onClick={() => go(i)} style={{ all: 'unset', cursor: 'pointer', fontWeight: i === cur ? 700 : 400 }}>
                  {h.pageName} · {label(h)} · {h.context.slice(0, 60)}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </DialogContent>
      <DialogActions>
        <Button disabled={!hits.length} onClick={() => next(-1)}>
          {t('Anterior')}
        </Button>
        <Button disabled={!hits.length} onClick={() => next(1)}>
          {t('Buscar siguiente')}
        </Button>
        <Button appearance="primary" onClick={onClose}>
          {t('Cerrar')}
        </Button>
      </DialogActions>
    </>
  );
}
