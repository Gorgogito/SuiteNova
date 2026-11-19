import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { COMPRESS_TARGETS, NO_CROP, cropPixels, isCropped, moveMarks, planCompress, resample } from '@suitenova/image-core';
import { addSlide, newId, newPicture, newTextBox, docFromText, frameOf, updateElement, type Deck, type PicEl, type SlideElement } from '@suitenova/slides-core';
import { useEffect, useState } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canvasFromPixels, decodePixels, encode, hasAlpha } from '../images/canvas';
import { originalOf, remakePicture } from './pichost';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';

type P = { ui: SlidesUI; onClose: () => void };

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ------------------------------------------------------------------------------------------------ compress

/**
 * «Comprimir imágenes»: every picture keeps the resolution asked for (pixels per inch at the size it has on the slide), never gets more, and
 * can lose the areas its crop hides. A picture with edits is shrunk from its original and made again, so its edits stay changeable.
 */
export function CompressDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [target, setTarget] = useState('web');
  const [cropped, setCropped] = useState(true);
  const [all, setAll] = useState(!c.selected.some((e) => e.kind === 'pic'));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const run = async () => {
    setBusy(true);
    try {
      const ppi = COMPRESS_TARGETS.find((x) => x.id === target)!.ppi;
      const targets: { slideId: string; pic: PicEl }[] = [];
      for (const s of c.deck.slides) for (const e of s.shapes) if (e.kind === 'pic' && e.xfrm && c.deck.assets[originalOf(e)] && (all || c.selection.includes(e.id))) targets.push({ slideId: s.id, pic: e });
      let before = 0;
      let after = 0;
      const assets: Deck['assets'] = {};
      const patches: { slideId: string; id: string; patch: Partial<PicEl>; drop?: boolean }[] = [];
      for (const { slideId, pic } of targets) {
        const a = c.deck.assets[originalOf(pic)]!;
        if (!/^image\/(png|jpeg|gif|bmp|webp)$/.test(a.mime)) continue;
        const px = await decodePixels(a.data, a.mime);
        const crop = frameOf(pic).crop ?? NO_CROP;
        const plan = planCompress({ w: px.w, h: px.h }, crop, { w: pic.xfrm!.w / 72, h: pic.xfrm!.h / 72 }, ppi, cropped);
        if (plan.skip) continue;
        const kept = plan.keep.w === px.w && plan.keep.h === px.h ? px : cropPixels(px, plan.keep);
        const res = resample(kept, plan.size.w, plan.size.h);
        const jpeg = !hasAlpha(res);
        const data = await encode(canvasFromPixels(res), jpeg ? 'image/jpeg' : 'image/png', 0.82);
        before += a.data.length;
        // keep the original when the result is not smaller and nothing was cut away
        if (data.length >= a.data.length && kept === px) {
          after += a.data.length;
          continue;
        }
        after += data.length;
        const id = newId('a');
        const asset = { id, mime: jpeg ? 'image/jpeg' : 'image/png', data, name: (a.name ?? 'Imagen').replace(/\.[^.]+$/, '') + (jpeg ? '.jpg' : '.png') };
        assets[id] = asset;
        const k = res.w / kept.w;
        const made = await remakePicture({ ...c.deck, assets: { ...c.deck.assets, ...assets } }, pic, id, moveMarks(pic.edits, plan.keep.x, plan.keep.y, k));
        if (made) patches.push({ slideId, id: pic.id, patch: made.patch, drop: !isCropped(plan.crop) && isCropped(crop) });
        if (made?.asset) assets[made.asset.id] = made.asset;
      }
      if (!patches.length) {
        setResult(t('Las imágenes ya están todo lo comprimidas que permiten estos ajustes.'));
        return;
      }
      c.apply('Comprimir imágenes', (d) => {
        let out: Deck = { ...d, assets: { ...d.assets, ...assets } };
        for (const p of patches)
          out = updateElement(out, p.slideId, p.id, (e: SlideElement) => {
            const q = { ...(e as PicEl), ...p.patch } as PicEl & Record<string, unknown>;
            for (const key of Object.keys(q)) if (q[key] === undefined) delete q[key];
            if (p.drop) delete q.srcRect;
            return q as PicEl;
          });
        return out;
      });
      setResult(t('Imágenes comprimidas: de {a} a {b}.', { a: kb(before), b: kb(after) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Comprimir imágenes')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cerrar')}</Button>
          <Button appearance="primary" disabled={busy} onClick={() => void run()}>
            {t('Comprimir')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <div role="radiogroup" aria-label={t('Resolución')}>
          {COMPRESS_TARGETS.map((x) => (
            <label key={x.id} className="sl-check" style={{ display: 'block' }}>
              <input type="radio" name="cmp-level" checked={target === x.id} onChange={() => setTarget(x.id)} /> {t(x.name)}
            </label>
          ))}
        </div>
        <label className="sl-check">
          <input type="checkbox" checked={cropped} onChange={(e) => setCropped(e.target.checked)} /> {t('Eliminar las áreas recortadas de las imágenes')}
        </label>
        <label className="sl-check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t('Aplicar a todas las imágenes de la presentación')}
        </label>
        <p className="sl-note">{t('Cada imagen se queda con esa resolución al tamaño que tiene en la diapositiva (nunca se agranda). Las imágenes sin transparencia pasan a JPEG. Se puede deshacer.')}</p>
        <p className="sl-note" aria-live="polite">{result}</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ icons

/** Icons of the Lucide set, drawn to a picture in the chosen colour. */
export function IconsDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [all, setAll] = useState<Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> | null>(null);
  const [q, setQ] = useState('');
  const [color, setColor] = useState('#1f4e79');
  const [picked, setPicked] = useState('');
  useEffect(() => {
    void import('lucide-react').then((m) => setAll((m as unknown as { icons: NonNullable<typeof all> }).icons));
  }, []);
  const names = all ? Object.keys(all).filter((n) => n.toLowerCase().includes(q.trim().toLowerCase().replace(/\s+/g, ''))).slice(0, 150) : [];
  const insert = async () => {
    if (!all || !picked) return;
    const svg = renderToStaticMarkup(createElement(all[picked]!, { size: 512, color, strokeWidth: 1.75 }));
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    cv.getContext('2d')!.drawImage(img, 0, 0, 512, 512);
    URL.revokeObjectURL(url);
    const data = await encode(cv, 'image/png');
    const id = newId('a');
    const s = 96;
    const el = newPicture(id, (c.deck.size.w - s) / 2, (c.deck.size.h - s) / 2, s, s, picked.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
    c.apply('Insertar icono', (d) => ({ ...d, assets: { ...d.assets, [id]: { id, mime: 'image/png', data, name: `${picked}.png` } }, slides: d.slides.map((sl) => (sl.id === c.slide.id ? { ...sl, shapes: [...sl.shapes, el] } : sl)) }), { selection: [el.id] });
    onClose();
  };
  return (
    <Modal
      title={t('Iconos')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!picked} onClick={() => void insert()}>
            {t('Insertar')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <div className="sl-form__row">
          <label className="sl-field">
            <span>{t('Buscar (en inglés)')}</span>
            <input aria-label={t('Buscar icono')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="arrow, user, chart…" />
          </label>
          <label className="sl-field">
            <span>{t('Color')}</span>
            <input type="color" aria-label={t('Color del icono')} value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
        {!all ? (
          <p className="sl-note">{t('Cargando iconos…')}</p>
        ) : (
          <div role="listbox" aria-label={t('Iconos')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 48px)', gap: 4, maxHeight: 280, overflow: 'auto' }}>
            {names.map((n) => {
              const I = all[n]!;
              return (
                <button key={n} type="button" role="option" aria-selected={picked === n} aria-label={n} title={n} onClick={() => setPicked(n)} onDoubleClick={() => (setPicked(n), void 0)} style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', background: 'transparent', cursor: 'pointer', border: picked === n ? '2px solid var(--colorBrandStroke1, #c55a11)' : '1px solid rgba(128,128,128,.3)' }}>
                  <I size={26} color={color} />
                </button>
              );
            })}
          </div>
        )}
        <p className="sl-note" aria-live="polite">{picked ? picked : names.length ? t('Elige un icono.') : t('Ningún icono coincide.')}</p>
        <p className="sl-note">{t('El icono se inserta como una imagen (PNG) del color elegido; para cambiar el color hay que insertarlo de nuevo.')}</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ photo album

/** Creates slides from several pictures, 1, 2 or 4 per slide, optionally with their names as captions. */
export function AlbumDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [files, setFiles] = useState<File[]>([]);
  const [per, setPer] = useState(2);
  const [caps, setCaps] = useState(true);
  const [busy, setBusy] = useState(false);
  const build = async () => {
    setBusy(true);
    try {
      const W = c.deck.size.w;
      const H = c.deck.size.h;
      const cols = per === 1 ? 1 : 2;
      const rows = per === 4 ? 2 : 1;
      const pad = 30;
      const capH = caps ? 26 : 0;
      const cw = (W - pad * (cols + 1)) / cols;
      const ch = (H - pad * (rows + 1)) / rows - capH;
      const assets: Deck['assets'] = {};
      const loaded: { id: string; w: number; h: number; name: string }[] = [];
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const url = URL.createObjectURL(f);
        const im = new Image();
        im.src = url;
        await im.decode().catch(() => undefined);
        URL.revokeObjectURL(url);
        if (!im.naturalWidth) continue;
        const id = newId('a');
        assets[id] = { id, mime: f.type || 'image/png', data: bytes, name: f.name };
        loaded.push({ id, w: im.naturalWidth, h: im.naturalHeight, name: f.name.replace(/\.[^.]+$/, '') });
      }
      if (!loaded.length) return;
      const blank = c.deck.layouts.find((l) => l.type === 'blank') ?? c.deck.layouts[0]!;
      c.apply('Álbum de fotografías', (d0) => {
        let d: Deck = { ...d0, assets: { ...d0.assets, ...assets } };
        let at = c.index;
        for (let i = 0; i < loaded.length; i += per) {
          const r = addSlide(d, blank.id, at);
          d = r.deck;
          at++;
          const shapes: SlideElement[] = [];
          loaded.slice(i, i + per).forEach((p, k) => {
            const col = k % cols;
            const row = Math.floor(k / cols);
            const x0 = pad + col * (cw + pad);
            const y0 = pad + row * (ch + capH + pad);
            const s = Math.min(cw / p.w, ch / p.h);
            const w = p.w * s;
            const h = p.h * s;
            shapes.push(newPicture(p.id, x0 + (cw - w) / 2, y0 + (ch - h) / 2, w, h, p.name));
            if (caps) {
              const tb = newTextBox(x0, y0 + ch + 2, cw, capH);
              shapes.push({ ...tb, text: { ...tb.text!, body: { ...tb.text!.body, anchor: 'ctr' }, doc: docFromText(p.name, { algn: 'ctr' }, { sz: 14 }) } });
            }
          });
          d = { ...d, slides: d.slides.map((s2) => (s2.id === r.slide.id ? { ...s2, shapes: [...s2.shapes, ...shapes] } : s2)) };
        }
        return d;
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Álbum de fotografías')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!files.length || busy} onClick={() => void build()}>
            {t('Crear')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <label className="sl-field">
          <span>{t('Imágenes')}</span>
          <input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" aria-label={t('Elegir imágenes')} onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        </label>
        <p className="sl-note" aria-live="polite">{files.length ? t('{n} imágenes elegidas.', { n: files.length }) : t('Elige una o varias imágenes.')}</p>
        <label className="sl-field">
          <span>{t('Imágenes por diapositiva')}</span>
          <select aria-label={t('Imágenes por diapositiva')} value={per} onChange={(e) => setPer(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="sl-check">
          <input type="checkbox" checked={caps} onChange={(e) => setCaps(e.target.checked)} /> {t('Poner el nombre del archivo como pie de foto')}
        </label>
        <p className="sl-note">{t('Se añaden diapositivas en blanco después de la actual, con las imágenes ajustadas sin deformarse.')}</p>
      </div>
    </Modal>
  );
}
