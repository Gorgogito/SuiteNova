import { Button } from '@fluentui/react-components';
import { t } from '@suitenova/core-ui';
import { addSlide, newId, newPicture, newTextBox, docFromText, removeBackground, type Deck, type PicEl, type Slide, type SlideElement } from '@suitenova/slides-core';
import { useEffect, useRef, useState } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assetToCanvas, bakePicture, canvasFromPixels, encode, hasAlpha, readPixels } from './picfx';
import type { SlidesUI } from './commands';
import { Modal } from './Dialogs';

type P = { ui: SlidesUI; onClose: () => void };

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ------------------------------------------------------------------------------------------------ remove background

/** Removes the plain background around the subject of the selected picture, with a live preview. */
export function RemoveBackgroundDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const pic = c.selected.find((e): e is PicEl => e.kind === 'pic');
  const [tol, setTol] = useState(40);
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [info, setInfo] = useState('');
  const view = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const a = pic && c.deck.assets[pic.src];
    if (!a) return;
    void assetToCanvas(a.data, a.mime).then((cv) => {
      const k = Math.min(1, 460 / Math.max(cv.width, cv.height));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(cv.width * k));
      small.height = Math.max(1, Math.round(cv.height * k));
      small.getContext('2d')!.drawImage(cv, 0, 0, small.width, small.height);
      setSrc(small);
    });
  }, [pic, c]);
  useEffect(() => {
    if (!src || !view.current) return;
    const p = readPixels(src);
    const { pixels, removed } = removeBackground(p, tol);
    setInfo(removed ? t('Se quita el {n} % de la imagen.', { n: Math.round((removed / (p.w * p.h)) * 100) }) : t('No se encontró un fondo liso en los bordes: la imagen no cambia.'));
    const out = view.current;
    out.width = p.w;
    out.height = p.h;
    const g = out.getContext('2d')!;
    // chessboard under the transparent parts
    for (let y = 0; y < p.h; y += 10) for (let x = 0; x < p.w; x += 10) ((g.fillStyle = (x / 10 + y / 10) % 2 ? '#ddd' : '#fff'), g.fillRect(x, y, 10, 10));
    const tmp = canvasFromPixels(pixels);
    g.drawImage(tmp, 0, 0);
  }, [src, tol]);
  const apply = async () => {
    if (!pic) return;
    await bakePicture(c, pic, 'Quitar fondo', (cv) => canvasFromPixels(removeBackground(readPixels(cv), tol).pixels));
    onClose();
  };
  return (
    <Modal
      title={t('Quitar fondo')}
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>{t('Cancelar')}</Button>
          <Button appearance="primary" disabled={!src} onClick={() => void apply()}>
            {t('Aceptar')}
          </Button>
        </>
      }
    >
      <div className="sl-form">
        <p className="sl-note">{t('Quita el fondo de un solo color que toca los bordes de la imagen. No reconoce personas ni objetos: con fondos con degradado, sombras o del mismo color que el sujeto, el resultado es peor.')}</p>
        <div style={{ textAlign: 'center' }}>
          <canvas ref={view} aria-label={t('Vista previa')} style={{ maxWidth: '100%', border: '1px solid rgba(128,128,128,.4)' }} />
        </div>
        <label className="sl-field">
          <span>{t('Tolerancia de color')}: {tol}</span>
          <input type="range" min={5} max={160} value={tol} aria-label={t('Tolerancia de color')} onChange={(e) => setTol(Number(e.target.value))} />
        </label>
        <p className="sl-note" aria-live="polite">{info}</p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ compress

const LEVELS: [string, number, string][] = [
  ['print', 1920, 'Impresión (hasta 1920 px)'],
  ['screen', 1280, 'Pantalla (hasta 1280 px)'],
  ['web', 960, 'Correo electrónico (hasta 960 px)'],
  ['none', 0, 'Conservar el tamaño en píxeles'],
];

/** Shrinks pictures: fewer pixels, JPEG when there is no transparency, and optionally without the cropped-away areas. */
export function CompressDialog({ ui, onClose }: P) {
  const c = ui.ctl;
  const [level, setLevel] = useState('screen');
  const [cropped, setCropped] = useState(true);
  const [all, setAll] = useState(!c.selected.some((e) => e.kind === 'pic'));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const run = async () => {
    setBusy(true);
    try {
      const max = LEVELS.find((l) => l[0] === level)![1];
      const targets: { slideId: string; pic: PicEl }[] = [];
      for (const s of c.deck.slides) for (const e of s.shapes) if (e.kind === 'pic' && c.deck.assets[e.src] && (all || c.selection.includes(e.id))) targets.push({ slideId: s.id, pic: e });
      let before = 0;
      let after = 0;
      const assets: Deck['assets'] = {};
      const edits = new Map<string, { src: string; srcRect?: PicEl['srcRect'] | null }>();
      for (const { pic } of targets) {
        const a = c.deck.assets[pic.src]!;
        if (!/^image\/(png|jpeg|gif|bmp|webp)$/.test(a.mime)) continue;
        let cv = await assetToCanvas(a.data, a.mime);
        const cut = cropped && pic.srcRect && (pic.srcRect.l || pic.srcRect.t || pic.srcRect.r || pic.srcRect.b) ? pic.srcRect : null;
        if (cut) {
          const x = Math.round((cv.width * cut.l) / 100000);
          const y = Math.round((cv.height * cut.t) / 100000);
          const w = Math.max(1, Math.round(cv.width * (1 - (cut.l + cut.r) / 100000)));
          const h = Math.max(1, Math.round(cv.height * (1 - (cut.t + cut.b) / 100000)));
          const n = document.createElement('canvas');
          n.width = w;
          n.height = h;
          n.getContext('2d')!.drawImage(cv, x, y, w, h, 0, 0, w, h);
          cv = n;
        }
        const k = max && Math.max(cv.width, cv.height) > max ? max / Math.max(cv.width, cv.height) : 1;
        if (k < 1) {
          const n = document.createElement('canvas');
          n.width = Math.max(1, Math.round(cv.width * k));
          n.height = Math.max(1, Math.round(cv.height * k));
          const g = n.getContext('2d')!;
          g.imageSmoothingQuality = 'high';
          g.drawImage(cv, 0, 0, n.width, n.height);
          cv = n;
        }
        const jpeg = !hasAlpha(readPixels(cv));
        const data = await encode(cv, jpeg ? 'image/jpeg' : 'image/png', 0.82);
        before += a.data.length;
        // keep the original when the result is not smaller and nothing was cut away
        if (data.length >= a.data.length && !cut) {
          after += a.data.length;
          continue;
        }
        after += data.length;
        const id = newId('a');
        assets[id] = { id, mime: jpeg ? 'image/jpeg' : 'image/png', data, name: (a.name ?? 'Imagen').replace(/\.[^.]+$/, '') + (jpeg ? '.jpg' : '.png') };
        edits.set(pic.id, { src: id, ...(cut ? { srcRect: null } : {}) });
      }
      if (!edits.size) {
        setResult(t('Las imágenes ya están todo lo comprimidas que permiten estos ajustes.'));
        return;
      }
      c.apply('Comprimir imágenes', (d) => {
        const slides = d.slides.map((s): Slide => ({
          ...s,
          shapes: s.shapes.map((e): SlideElement => {
            const ed = e.kind === 'pic' ? edits.get(e.id) : undefined;
            if (!ed || e.kind !== 'pic') return e;
            const { srcRect: _s, ...rest } = e;
            void _s;
            return ed.srcRect === null ? { ...rest, src: ed.src } : { ...e, src: ed.src };
          }),
        }));
        const used = new Set(slides.flatMap((s) => s.shapes.flatMap((e) => (e.kind === 'pic' ? [e.src] : []))));
        const kept = Object.fromEntries(Object.entries(d.assets).filter(([id]) => used.has(id) || !targets.some((x) => x.pic.src === id)));
        return { ...d, slides, assets: { ...kept, ...assets } };
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
          {LEVELS.map(([id, , label]) => (
            <label key={id} className="sl-check" style={{ display: 'block' }}>
              <input type="radio" name="cmp-level" checked={level === id} onChange={() => setLevel(id)} /> {t(label)}
            </label>
          ))}
        </div>
        <label className="sl-check">
          <input type="checkbox" checked={cropped} onChange={(e) => setCropped(e.target.checked)} /> {t('Eliminar las áreas recortadas de las imágenes')}
        </label>
        <label className="sl-check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t('Aplicar a todas las imágenes de la presentación')}
        </label>
        <p className="sl-note">{t('Las imágenes sin transparencia pasan a JPEG. Si la imagen ya es pequeña no se agranda ni se cambia. Se puede deshacer.')}</p>
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
