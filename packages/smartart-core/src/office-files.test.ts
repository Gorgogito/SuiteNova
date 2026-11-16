import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { dataModelToTree, flatten, layoutNodes, parseDataModel, parseDrawing, parseSmartArt, treeToDataModel, writeDataModel, writeDrawing, counterIds } from './index';

/*
 * Validación con archivos REALES de Office. No se guardan en el repositorio (los diseños de Office son contenido de Microsoft):
 * se generan en el equipo (por ejemplo, con PowerPoint) y se indican con la variable SMARTART_FILES, una lista de archivos .pptx,
 * .docx o .xlsx separados por «;». Sin la variable, la prueba se omite.
 *   $env:SMARTART_FILES="C:\ruta\muestras.pptx"; pnpm --filter @suitenova/smartart-core test
 */
const files = (process.env.SMARTART_FILES ?? '').split(';').filter(Boolean);

describe.skipIf(!files.length)('SmartArt de archivos reales de Office', () => {
  const require = createRequire(new URL('../../../apps/suite/package.json', import.meta.url));
  const JSZip = require('jszip') as { loadAsync(b: Buffer): Promise<{ files: Record<string, unknown>; file(n: string): { async(t: 'string'): Promise<string> } | null }> };

  it('lee las cinco partes y las vuelve a escribir sin pérdidas', async () => {
    let count = 0;
    for (const f of files) {
      const zip = await JSZip.loadAsync(fs.readFileSync(f));
      for (const dp of Object.keys(zip.files).filter((n) => /diagrams\/data\d*\.xml$/.test(n))) {
        const dir = dp.replace(/data\d*\.xml$/, '');
        const k = /data(\d*)\.xml$/.exec(dp)![1]!;
        const part = async (name: string) => (await zip.file(`${dir}${name}${k}.xml`)?.async('string')) ?? undefined;
        const parts = { data: await zip.file(dp)!.async('string'), layout: (await part('layout'))!, style: (await part('quickStyle'))!, colors: (await part('colors'))!, drawing: await part('drawing') };
        expect(parts.layout && parts.style && parts.colors, `${dp}: faltan partes`).toBeTruthy();
        const sa = parseSmartArt(parts);
        expect(parseDataModel(writeDataModel(sa.data)), `${dp}: datos`).toEqual(sa.data);
        if (sa.drawing) expect(parseDrawing(writeDrawing(sa.drawing)), `${dp}: dibujo`).toEqual(sa.drawing);
        // el árbol sale y vuelve al modelo de datos conservando los nodos y su texto
        const tree = dataModelToTree(sa.data);
        const back = dataModelToTree(parseDataModel(writeDataModel(treeToDataModel(tree, sa.data, counterIds()))));
        expect(flatten(back).map((n) => `${n.level}:${n.text}`), `${dp}: árbol`).toEqual(flatten(tree).map((n) => `${n.level}:${n.text}`));
        // eslint-disable-next-line no-console
        console.log(`  ${f.split(/[\\/]/).pop()} ${dp}: ${sa.layout.uniqueId.split('/').pop()} · ${flatten(tree).length} nodos · ${sa.drawing?.length ?? 0} formas · ${layoutNodes(sa.layout).length} nodos de diseño`);
        count++;
      }
    }
    expect(count).toBeGreaterThan(0);
  });
});
