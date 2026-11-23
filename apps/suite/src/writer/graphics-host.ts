import { parseIconSvg, restyleSvg, svgDataUri, svgFromUri, type IconLook } from '@suitenova/icon-core';
import { NodeSelection } from 'prosemirror-state';
import type { GraphicsHost } from '../icons/GraphicsMenus';
import { svgToPng } from '../icons/raster';
import type { WriterUI } from './commands';
import { selectedImage } from './commands-image';

/** The look of an image when it is an icon of the gallery (SVG as the picture), or null. */
export function iconLookOf(attrs: Record<string, any> | undefined): Required<IconLook> | null {
  const svg = attrs && typeof attrs.src === 'string' ? svgFromUri(attrs.src) : null;
  const p = svg ? parseIconSvg(svg) : null;
  return p ? { fill: p.fill, opacity: p.opacity, stroke: p.stroke } : null;
}

/** Writer's side of the graphics menus: the selected image, painted by changing its SVG (and the PNG that goes in the file with it). */
export function writerGraphicsHost(ui: WriterUI): GraphicsHost {
  const sel = () => selectedImage(ui.ctl.mainState);
  const patch = (pos: number, attrs: Record<string, unknown>) => {
    const v = ui.ctl.mainView;
    const node = v?.state.doc.nodeAt(pos);
    if (!v || !node || node.type.name !== 'image') return;
    const tr = v.state.tr.setNodeMarkup(pos, null, { ...node.attrs, ...attrs });
    v.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
  };
  const restyle = async (look: IconLook): Promise<void> => {
    const s = sel();
    const svg = s && typeof s.attrs.src === 'string' ? svgFromUri(s.attrs.src) : null;
    const next = svg ? restyleSvg(svg, look) : null;
    if (!s || !next) return;
    const png = await svgToPng(restyleSvg(next, {})!.replace(/width="\d+" height="\d+"/, 'width="256" height="256"'), 256);
    // the picture may have been changed or deleted while the PNG was being made
    const now = ui.ctl.mainView?.state.doc.nodeAt(s.pos);
    if (now?.type.name === 'image' && now.attrs.src === s.attrs.src) patch(s.pos, { src: svgDataUri(next), png, edits: null, orig: null, ocr: null });
  };
  return {
    look: () => iconLookOf(sel()?.attrs),
    setLook: (look) => restyle(look),
    fx: () => (sel()?.attrs.fx as Record<string, any> | null) ?? null,
    setFx: (fx) => {
      const s = sel();
      if (s) patch(s.pos, { fx });
    },
    setStyle: async (look, fx) => {
      await restyle(look);
      const s = sel();
      if (s) patch(s.pos, { fx });
    },
  };
}
