import type { CommandDef } from '@suitenova/core-ui';
import { ARTISTIC, unionBox, visualBox, type PicEl, type Slide, type SlideElement } from '@suitenova/slides-core';
import { saveBytes } from '../fileio';
import { canvasBlob, slideToCanvas } from './export/raster';
import type { SlidesUI } from './commands';
import { bakePicture, canvasFromPixels, readPixels } from './picfx';

/** Picture tools that change pixels (remove background, artistic effects, compress), icons, album, screenshot and save as picture. */
export function pictureCommands2(ui: SlidesUI): CommandDef[] {
  const c = ui.ctl;
  const pics = () => c.selected.filter((e): e is PicEl => e.kind === 'pic' && !!c.deck.assets[e.src]);
  const defs: CommandDef[] = [];
  defs.push({ id: 'slides.pic.removeBg', label: 'Quitar fondo…', icon: 'eraser', description: 'Quita el fondo liso que toca los bordes de la imagen.', enabled: () => c.selected.length === 1 && pics().length === 1, run: () => ui.openDialog('removeBg') });
  for (const fx of ARTISTIC)
    defs.push({
      id: `slides.pic.artistic.${fx.id}`,
      label: fx.name,
      icon: 'sparkles',
      description: 'Cambia los píxeles de la imagen (se puede deshacer).',
      enabled: () => pics().length > 0,
      run: async () => {
        c.say('Aplicando el efecto…');
        for (const p of pics()) await bakePicture(c, p, 'Efecto artístico', (cv) => canvasFromPixels(fx.run(readPixels(cv))));
        c.say('');
      },
    });
  defs.push({ id: 'slides.pic.compress', label: 'Comprimir imágenes…', icon: 'image', description: 'Reduce el tamaño de las imágenes de la presentación.', run: () => ui.openDialog('compress') });
  defs.push({ id: 'slides.insert.icons', label: 'Iconos…', icon: 'sparkles', description: 'Inserta un icono como imagen.', run: () => ui.openDialog('icons') });
  defs.push({ id: 'slides.insert.album', label: 'Álbum de fotografías…', icon: 'image', description: 'Crea diapositivas con varias imágenes.', run: () => ui.openDialog('album') });
  defs.push({ id: 'slides.insert.screenshot', label: 'Captura de pantalla', icon: 'monitor', description: 'Elige una pantalla o una ventana y la inserta como imagen.', run: () => void ui.captureScreen() });
  defs.push({
    id: 'slides.saveAsPicture',
    label: 'Guardar como imagen…',
    icon: 'image',
    description: 'Guarda los objetos seleccionados como un archivo PNG (con fondo transparente).',
    enabled: () => c.selected.length > 0,
    run: async () => {
      const els = c.selected;
      const box = unionBox(els.map((e) => visualBox(c.xfrmOf(e))));
      const pad = 8;
      const tmp: Slide = { ...c.slide, id: 'tmp-save', shapes: els as SlideElement[], showMasterSp: false, transition: undefined, timing: undefined, notes: undefined };
      const k = 3;
      const cv = await slideToCanvas(c.deck, tmp, c.urls, c.index, c.deck.size.w * k, true);
      const x = Math.max(0, Math.floor((box.x - pad) * k));
      const y = Math.max(0, Math.floor((box.y - pad) * k));
      const w = Math.min(cv.width - x, Math.ceil((box.w + pad * 2) * k));
      const h = Math.min(cv.height - y, Math.ceil((box.h + pad * 2) * k));
      const out = document.createElement('canvas');
      out.width = Math.max(1, w);
      out.height = Math.max(1, h);
      out.getContext('2d')!.drawImage(cv, x, y, w, h, 0, 0, w, h);
      const data = await canvasBlob(out, 'image/png');
      const saved = await saveBytes('Imagen.png', data, [{ name: 'Imagen PNG', extensions: ['png'] }]);
      if (saved) c.say('Imagen guardada.');
    },
  });
  return defs;
}
