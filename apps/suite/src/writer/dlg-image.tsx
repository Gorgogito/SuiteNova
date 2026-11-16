import { Button, Checkbox, Input, Select, Textarea } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { useState } from 'react';
import type { WriterUI } from './commands';
import { patchImage, selectedImage } from './commands-image';
import { wrapPatch } from './image-objects';
import { Modal, field, focusDocSoon } from './dialogs';

const PX_CM = 2.54 / 96;
const cm = (px: number) => String(Math.round(px * PX_CM * 100) / 100);
const toPx = (s: string, fallback: number) => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? Math.max(8, Math.round(v / PX_CM)) : fallback;
};
const pct = (s: string) => {
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? Math.min(90, Math.max(0, v)) : 0;
};

export function ImageFormatDialog({ ui, onClose }: { ui: WriterUI; onClose: () => void }) {
  const sel = selectedImage(ui.ctl.mainState);
  const a = sel?.attrs ?? {};
  const crop0 = (a.crop as { l: number; t: number; r: number; b: number } | null) ?? { l: 0, t: 0, r: 0, b: 0 };
  const w0: number = a.width ?? 200;
  const h0: number = a.height ?? 150;
  const [alt, setAlt] = useState<string>(a.alt ?? '');
  const [w, setW] = useState(cm(w0));
  const [h, setH] = useState(cm(h0));
  const [sized, setSized] = useState(false);
  const [lock, setLock] = useState(true);
  const [crop, setCrop] = useState({ l: String(Math.round(crop0.l * 100)), t: String(Math.round(crop0.t * 100)), r: String(Math.round(crop0.r * 100)), b: String(Math.round(crop0.b * 100)) });
  const [rotate, setRotate] = useState(String(a.rotate ?? 0));
  const [flipH, setFlipH] = useState(!!a.flipH);
  const [flipV, setFlipV] = useState(!!a.flipV);
  const [border, setBorder] = useState<{ color: string; width: number } | null>(a.border ?? null);
  const [wrap, setWrap] = useState<string>(a.wrap ?? 'inline');
  if (!sel) return null;

  const ratio = w0 / h0;
  const setSize = (which: 'w' | 'h', v: string) => {
    setSized(true);
    if (which === 'w') {
      setW(v);
      if (lock) setH(cm(toPx(v, w0) / ratio));
    } else {
      setH(v);
      if (lock) setW(cm(toPx(v, h0) * ratio));
    }
  };
  const original = () => {
    const img = new Image();
    img.onload = () => {
      const kx = 1 - pct(crop.l) / 100 - pct(crop.r) / 100;
      const ky = 1 - pct(crop.t) / 100 - pct(crop.b) / 100;
      setW(cm(img.naturalWidth * kx));
      setH(cm(img.naturalHeight * ky));
      setSized(true);
    };
    img.src = a.src;
  };
  const accept = () => {
    const nc = { l: pct(crop.l) / 100, t: pct(crop.t) / 100, r: pct(crop.r) / 100, b: pct(crop.b) / 100 };
    // two opposite sides cannot cut away everything
    if (nc.l + nc.r > 0.95) nc.r = 0.95 - nc.l;
    if (nc.t + nc.b > 0.95) nc.b = 0.95 - nc.t;
    const has = nc.l || nc.t || nc.r || nc.b;
    let width: number;
    let height: number;
    if (sized) {
      width = toPx(w, w0);
      height = toPx(h, h0);
    } else {
      // changing the crop keeps the scale of the picture: the visible part gets smaller or bigger, it is not stretched
      const kx0 = 1 - crop0.l - crop0.r;
      const ky0 = 1 - crop0.t - crop0.b;
      width = Math.max(8, Math.round((w0 / kx0) * (1 - nc.l - nc.r)));
      height = Math.max(8, Math.round((h0 / ky0) * (1 - nc.t - nc.b)));
    }
    patchImage(ui, {
      alt,
      width,
      height,
      crop: has ? nc : null,
      rotate: ((Math.round(Number(rotate.replace(',', '.')) || 0) % 360) + 360) % 360,
      flipH,
      flipV,
      border: border ? { color: border.color, width: Math.min(20, Math.max(0.25, border.width)) } : null,
      // solo el ajuste y la posición: el tamaño es el que se acaba de elegir en el cuadro
      ...(({ wrap: wr, x, y }) => ({ wrap: wr, x, y }))(wrapPatch(ui.ctl.mainView!, sel.pos, wrap === 'inline' ? null : (wrap as 'left' | 'right' | 'top' | 'front' | 'behind')) as { wrap: unknown; x: unknown; y: unknown }),
    });
    onClose();
    focusDocSoon(ui);
  };
  const cropField = (id: string, label: string, k: 'l' | 't' | 'r' | 'b') => (
    <div style={field}>
      <label htmlFor={id}>{t(label)}</label>
      <Input id={id} type="number" min={0} max={90} step={1} value={crop[k]} onChange={(_e, v) => setCrop((x) => ({ ...x, [k]: v.value }))} />
    </div>
  );
  return (
    <Modal
      title={t('Formato de imagen')}
      onClose={onClose}
      width={520}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" onClick={accept}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div style={field}>
        <label htmlFor="img-alt">{t('Texto alternativo')}</label>
        <Textarea id="img-alt" rows={2} value={alt} onChange={(_e, v) => setAlt(v.value)} />
      </div>
      <fieldset style={{ border: '1px solid rgba(128,128,128,.4)', marginBottom: 10 }}>
        <legend>{t('Tamaño (cm)')}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={field}>
            <label htmlFor="img-w">{t('Ancho')}</label>
            <Input id="img-w" type="number" min={0.2} step={0.1} value={w} onChange={(_e, v) => setSize('w', v.value)} />
          </div>
          <div style={field}>
            <label htmlFor="img-h">{t('Alto')}</label>
            <Input id="img-h" type="number" min={0.2} step={0.1} value={h} onChange={(_e, v) => setSize('h', v.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Checkbox label={t('Mantener proporción')} checked={lock} onChange={(_e, v) => setLock(!!v.checked)} />
          <Button size="small" onClick={original}>
            {t('Tamaño original')}
          </Button>
        </div>
      </fieldset>
      <fieldset style={{ border: '1px solid rgba(128,128,128,.4)', marginBottom: 10 }}>
        <legend>{t('Recorte (%)')}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          {cropField('img-cl', 'Izquierda', 'l')}
          {cropField('img-ct', 'Arriba', 't')}
          {cropField('img-cr', 'Derecha', 'r')}
          {cropField('img-cb', 'Abajo', 'b')}
        </div>
      </fieldset>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={field}>
          <label htmlFor="img-rot">{t('Giro (grados)')}</label>
          <Input id="img-rot" type="number" step={1} value={rotate} onChange={(_e, v) => setRotate(v.value)} />
        </div>
        <div style={field}>
          <label htmlFor="img-wrap">{t('Ajuste del texto')}</label>
          <Select id="img-wrap" value={wrap} onChange={(_e, v) => setWrap(v.value)}>
            <option value="inline">{t('En línea con el texto')}</option>
            <option value="left">{t('A la izquierda, texto alrededor')}</option>
            <option value="right">{t('A la derecha, texto alrededor')}</option>
            <option value="top">{t('Arriba y abajo')}</option>
            <option value="front">{t('Delante del texto')}</option>
            <option value="behind">{t('Detrás del texto')}</option>
          </Select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <Checkbox label={t('Voltear horizontalmente')} checked={flipH} onChange={(_e, v) => setFlipH(!!v.checked)} />
        <Checkbox label={t('Voltear verticalmente')} checked={flipV} onChange={(_e, v) => setFlipV(!!v.checked)} />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
        <Checkbox label={t('Borde')} checked={!!border} onChange={(_e, v) => setBorder(v.checked ? { color: '#000000', width: 1 } : null)} />
        <input aria-label={t('Color del borde')} type="color" disabled={!border} value={border?.color ?? '#000000'} onChange={(e) => border && setBorder({ ...border, color: e.target.value })} />
        <Input aria-label={t('Grosor del borde (pt)')} style={{ width: 90 }} type="number" min={0.25} max={20} step={0.25} disabled={!border} value={String(border?.width ?? 1)} onChange={(_e, v) => border && setBorder({ ...border, width: Number(v.value) || 1 })} />
        <span>pt</span>
      </div>
    </Modal>
  );
}
