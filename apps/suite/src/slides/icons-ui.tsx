import { t } from '@suitenova/core-ui';
import { parseIconSvg, restyleSvg, svgFromUri, svgToFreeform, type GraphicFx, type IconLook } from '@suitenova/icon-core';
import { frameOf, newId, newPicture, withFrame, type Asset, type PicEl, type ShapeEl } from '@suitenova/slides-core';
import { GraphicFillItems, GraphicOutlineItems, GraphicStyleItems, type GraphicsHost } from '../icons/GraphicsMenus';
import { IconsDialog } from '../icons/IconsDialog';
import { svgToPng, type IconPick } from '../icons/raster';
import type { SlidesCtl } from './ctl';
import type { SlidesUI } from './commands';
import { Gallery, useUi } from './ribbonParts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const pngBytes = (uri: string): Uint8Array => Uint8Array.from(atob(uri.split(',')[1]!), (c) => c.charCodeAt(0));

/** The icons (pictures with an SVG) among the selected elements. */
export const selectedIcons = (c: SlidesCtl): PicEl[] => c.selected.filter((e): e is PicEl => e.kind === 'pic' && !!e.svg && !e.edits);

const svgOf = (c: SlidesCtl, p: PicEl): string | null => {
  const a = p.svg ? c.deck.assets[p.svg] : undefined;
  return a ? dec.decode(a.data) : null;
};

/** The shared icon gallery for Slides: each icon goes in as a picture (PNG) with its SVG, side by side in the middle of the slide. */
export function SlidesIconsDialog({ ui, onClose }: { ui: SlidesUI; onClose: () => void }) {
  const c = ui.ctl;
  const insert = (picks: IconPick[]) => {
    const size = 96;
    const gap = 16;
    const total = picks.length * size + (picks.length - 1) * gap;
    let x = (c.deck.size.w - total) / 2;
    const y = (c.deck.size.h - size) / 2;
    const assets: Record<string, Asset> = {};
    const els: PicEl[] = picks.map((p) => {
      const pid = newId('a');
      const sid = newId('a');
      assets[pid] = { id: pid, mime: 'image/png', data: pngBytes(p.png), name: `${p.name}.png` };
      assets[sid] = { id: sid, mime: 'image/svg+xml', data: enc.encode(svgOfUri(p.svg)), name: `${p.name}.svg` };
      const el: PicEl = { ...newPicture(pid, x, y, size, size, p.name), svg: sid };
      x += size + gap;
      return el;
    });
    c.apply('Insertar icono', (d) => ({
      ...d,
      assets: { ...d.assets, ...assets },
      slides: d.slides.map((sl) => (sl.id === c.slide.id ? { ...sl, shapes: [...sl.shapes, ...els] } : sl)),
    }), { selection: els.map((e) => e.id) });
  };
  return <IconsDialog onPick={insert} onClose={onClose} />;
}

const svgOfUri = (uri: string): string => svgFromUri(uri) ?? '';

/** Paints the selected icons another way: new SVG and PNG assets, in one undo step. */
async function restyleIcons(c: SlidesCtl, look: IconLook, label: string, fxOf?: GraphicFx | null): Promise<void> {
  const icons = selectedIcons(c);
  if (!icons.length) return;
  const assets: Record<string, Asset> = {};
  const patches = new Map<string, { src: string; svg: string }>();
  for (const p of icons) {
    const svg = svgOf(c, p);
    const next = svg ? restyleSvg(svg, look) : null;
    if (!next) continue;
    const png = await svgToPng(next.replace(/width="\d+" height="\d+"/, 'width="256" height="256"'), 256);
    const pid = newId('a');
    const sid = newId('a');
    const name = (c.deck.assets[p.svg!]?.name ?? 'icono.svg').replace(/\.svg$/, '');
    assets[pid] = { id: pid, mime: 'image/png', data: pngBytes(png), name: `${name}.png` };
    assets[sid] = { id: sid, mime: 'image/svg+xml', data: enc.encode(next), name: `${name}.svg` };
    patches.set(p.id, { src: pid, svg: sid });
  }
  if (!patches.size) return;
  c.apply(label, (d) => ({
    ...d,
    assets: { ...d.assets, ...assets },
    slides: d.slides.map((sl) => (sl.id !== c.slide.id ? sl : { ...sl, shapes: sl.shapes.map((e) => {
      const q = patches.get(e.id);
      if (!q || e.kind !== 'pic') return e;
      const out = { ...e, ...q } as PicEl;
      return fxOf !== undefined ? withFrame(out, { ...frameOf(out), fx: fxOf ?? undefined }) : out;
    }) })),
  }), { keepSelection: true });
}

/** Slides' side of the graphics menus: the selected icons (pictures with an SVG); the effects are the picture's own (shadow, glow). */
export function slidesGraphicsHost(c: SlidesCtl): GraphicsHost {
  return {
    look: () => {
      const p = selectedIcons(c)[0];
      const svg = p && svgOf(c, p);
      const q = svg ? parseIconSvg(svg) : null;
      return q ? { fill: q.fill, opacity: q.opacity, stroke: q.stroke } : null;
    },
    setLook: (look, label) => restyleIcons(c, look, label),
    fx: () => {
      const p = c.selected.find((e): e is PicEl => e.kind === 'pic');
      return p ? ((frameOf(p).fx as GraphicFx | undefined) ?? null) : null;
    },
    setFx: (fx, label) => {
      const ids = c.selected.filter((e) => e.kind === 'pic').map((e) => e.id);
      c.patch(ids, label, (e) => withFrame(e as PicEl, { ...frameOf(e as PicEl), fx: fx ?? undefined }));
    },
    setStyle: (look, fx, label) => restyleIcons(c, look, label, fx),
  };
}

/** «Convertir en forma»: each selected icon becomes a freeform shape (custom geometry) with its fill and outline, in the same place. */
export function iconsToShapes(c: SlidesCtl): void {
  const icons = selectedIcons(c);
  if (!icons.length) return;
  const made = new Map<string, ShapeEl>();
  for (const p of icons) {
    const svg = svgOf(c, p);
    const f = svg ? svgToFreeform(svg) : null;
    if (!f) continue;
    const w = p.xfrm?.w ?? 96;
    made.set(p.id, {
      kind: 'shape',
      id: p.id,
      name: p.name ?? 'Forma libre',
      descr: p.descr,
      xfrm: { ...p.xfrm! },
      geom: { cust: f.paths.map((q) => ({ w: q.w, h: q.h, cmds: q.cmds })) },
      fill: f.fill ? { t: 'solid', c: { rgb: f.fill, ...(f.opacity < 1 ? { mods: [{ t: 'alpha', v: Math.round(f.opacity * 100000) }] } : {}) } } : { t: 'none' },
      ln: f.stroke ? { w: Math.max(0.25, Math.round(f.stroke.width * (w / f.size) * 0.75 * 4) / 4), fill: { t: 'solid', c: { rgb: f.stroke.color } }, join: 'round' } : { fill: { t: 'none' } },
      ...(p.effects ? { effects: p.effects } : {}),
    } as ShapeEl);
  }
  if (!made.size) return;
  c.patch([...made.keys()], 'Convertir en forma', (e) => made.get(e.id) ?? e);
}

/** The ribbon buttons of the Graphics group: styles, fill and outline of the icon (the picture's own effects are in «Efectos»). */
export function GraphicStylesButton({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <Gallery label={t('Estilos de gráfico')} icon="sparkles" size="small" iconOnly disabled={!selectedIcons(c).length}>
      {(close) => <GraphicStyleItems host={slidesGraphicsHost(c)} close={close} />}
    </Gallery>
  );
}
export function GraphicFillButton({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <Gallery label={t('Relleno de gráfico')} icon="palette" size="small" iconOnly disabled={!selectedIcons(c).length}>
      {(close) => <GraphicFillItems host={slidesGraphicsHost(c)} close={close} />}
    </Gallery>
  );
}
export function GraphicOutlineButton({ ui }: { ui: SlidesUI }) {
  const c = useUi(ui);
  return (
    <Gallery label={t('Contorno de gráfico')} icon="pen" size="small" iconOnly disabled={!selectedIcons(c).length}>
      {(close) => <GraphicOutlineItems host={slidesGraphicsHost(c)} close={close} />}
    </Gallery>
  );
}
