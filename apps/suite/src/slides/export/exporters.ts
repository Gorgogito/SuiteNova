import { writeOdp, writePptx } from '@suitenova/slides-core';
import { saveBytes } from '../../fileio';
import type { SlidesCtl } from '../ctl';

const baseName = (c: SlidesCtl) => (c.fileName ?? c.deck.props.title ?? 'Presentación').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'Presentación';

export async function exportDeck(c: SlidesCtl, kind: 'pdf' | 'pptx' | 'ppsx' | 'potx' | 'odp' | 'png' | 'video'): Promise<void> {
  c.endEdit();
  if (kind === 'pptx') {
    const r = await writePptx(c.realDeck);
    await saveBytes(`${baseName(c)}.pptx`, r.data, [{ name: 'Presentación de PowerPoint', extensions: ['pptx'] }]);
  } else if (kind === 'ppsx') {
    const r = await writePptx(c.realDeck, { slideshow: true });
    await saveBytes(`${baseName(c)}.ppsx`, r.data, [{ name: 'Presentación con diapositivas de PowerPoint', extensions: ['ppsx'] }]);
  } else if (kind === 'potx') {
    const r = await writePptx(c.realDeck, { template: true });
    await saveBytes(`${baseName(c)}.potx`, r.data, [{ name: 'Plantilla de PowerPoint', extensions: ['potx'] }]);
  } else if (kind === 'odp') {
    const r = await writeOdp(c.realDeck);
    await saveBytes(`${baseName(c)}.odp`, r.data, [{ name: 'Presentación OpenDocument', extensions: ['odp'] }]);
    if (r.warnings.length) c.say(`Guardado como .odp con pérdidas: ${r.warnings.join(' ')}`);
  } else if (kind === 'pdf') printDeck(c);
}

export function printDeck(c: SlidesCtl): void {
  void c;
  window.print();
}
