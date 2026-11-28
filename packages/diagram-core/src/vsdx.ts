import JSZip from 'jszip';
import { layersOf } from './layers';
import type { Diagram, Page } from './model';
import { escXml } from './svg';
import { attr, cell, inch, pageXml, pictureInfo, type PictureInfo } from './vsdx-write';

export { flattenPath, pictureInfo, type PictureInfo } from './vsdx-write';

/*
 * Writing Visio drawings (.vsdx, the Open Packaging format): the package and its parts. What each page holds is written
 * in `vsdx-write.ts`; reading drawings is in `vsdx-import.ts`. See docs/LIMITACIONES.md for what Visio keeps.
 */

const NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** How many pictures of the diagram cannot go to Visio (not PNG, JPEG or GIF): their shapes are exported without the picture. */
export function vsdxPicturesLost(d: Diagram): number {
  let n = 0;
  for (const p of d.pages) for (const s of p.shapes) if (s.image && !pictureInfo(s.image.src)) n++;
  return n;
}

const HEAD = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';

/** The date as Visio writes it: UTC, no «Z», no milliseconds. */
const visioDate = (iso: string): string => new Date(iso).toISOString().replace(/\.\d+Z$/, '');

/**
 * The comments of the drawing as Visio keeps them (`visio/comments.xml`): a list of people and a flat list of comments, each on a page and, if it is
 * about a shape, on that shape. Visio has **no replies and no «resolved»**: a conversation is written as one comment after another on the same
 * shape (in order) and reads back as a conversation.
 */
function commentsXml(d: Diagram, sheetIds: Map<string, number>[]): string {
  const people: string[] = [];
  const initialsOf = new Map<string, string>();
  const entries: string[] = [];
  let cid = 0;
  d.pages.forEach((page, pi) => {
    for (const t of page.threads ?? []) {
      let shapeAttr = '';
      if (t.shape) {
        const sid = sheetIds[pi]?.get(t.shape);
        if (sid === undefined) continue; // a shape that is no longer there
        shapeAttr = ` ShapeID="${sid}"`;
      }
      for (const m of t.messages) {
        if (!people.includes(m.author)) people.push(m.author);
        if (m.initials) initialsOf.set(m.author, m.initials);
        entries.push(`<CommentEntry AuthorID="${people.indexOf(m.author) + 1}" PageID="${pi}"${shapeAttr} Date="${visioDate(m.date)}" EditDate="${visioDate(m.edited ?? m.date)}" CommentID="${++cid}" AutoCommentType="0">${escXml(m.text)}</CommentEntry>`);
      }
    }
  });
  if (!entries.length) return '';
  const authors = people.map((a, i) => `<AuthorEntry Name="${escXml(a)}" Initials="${escXml(initialsOf.get(a) ?? initialsFor(a))}" ID="${i + 1}"/>`).join('');
  return `${HEAD}<Comments ShowCommentTags="1" xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><AuthorList>${authors}</AuthorList><CommentList>${entries.join('')}</CommentList></Comments>`;
}

const initialsFor = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => [...w][0]!.toUpperCase()).join('') || 'A';

/** A name for each of a list that no other has (Visio tells pages and layers apart by name, whatever the case). */
function distinct(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = raw.trim() || String(i + 1);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** The layers of a page, in the order the `LayerMember` cells of its shapes count them. */
function layerSheet(page: Page): string {
  if (!page.layers?.length) return '';
  const layers = layersOf(page);
  const names = distinct(layers.map((l) => l.name));
  const rows = layers.map((l, i) => {
    const name = names[i]!;
    return `<Row IX="${i}">${cell('Name', name)}${cell('Color', 255)}${cell('Status', 0)}${cell('Visible', l.visible ? 1 : 0)}${cell('Print', l.printable ? 1 : 0)}${cell('Active', page.activeLayer === l.id ? 1 : 0)}${cell('Lock', l.locked ? 1 : 0)}${cell('Snap', 1)}${cell('Glue', 1)}${cell('NameUniv', name)}${cell('ColorTrans', 0)}</Row>`;
  });
  return `<Section N="Layer">${rows.join('')}</Section>`;
}

export async function exportVsdx(d: Diagram): Promise<Uint8Array> {
  const zip = new JSZip();
  const mediaExts = new Set<PictureInfo['ext']>();
  let mediaCount = 0;
  let hasComments = false;
  // the types are written last, when it is known which picture formats the drawing uses
  const typesFor = () =>
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...mediaExts].map((e) => `<Default Extension="${e}" ContentType="image/${e}"/>`).join('')}<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>${hasComments ? '<Override PartName="/visio/comments.xml" ContentType="application/vnd.ms-visio.comments+xml"/>' : ''}${d.pages.map((_, i) => `<Override PartName="/visio/pages/page${i + 1}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`).join('')}</Types>`;
  zip.file('_rels/.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/></Relationships>`);
  zip.file('visio/document.xml', `${HEAD}<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0"/><Colors/><FaceNames/><StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style"><Cell N="LineWeight" V="0.01041666666666667"/><Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="FillForegnd" V="1"/><Cell N="FillPattern" V="1"/></StyleSheet></StyleSheets></VisioDocument>`);
  zip.file('visio/_rels/document.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/></Relationships>`);
  // Visio refuses a file without its window part ("faltan algunas partes"), even an empty drawing
  zip.file('visio/windows.xml', `${HEAD}<Windows ClientWidth="1200" ClientHeight="800" xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="0" WindowTop="0" WindowWidth="1200" WindowHeight="800" ContainerType="Page" Page="0" ViewScale="-1"><ShowRulers>1</ShowRulers><ShowGrid>1</ShowGrid><ShowPageBreaks>0</ShowPageBreaks><ShowGuides>1</ShowGuides><ShowConnectionPoints>1</ShowConnectionPoints></Window></Windows>`);
  const names = distinct(d.pages.map((p) => p.name));
  const pageNames = new Map(d.pages.map((p, i) => [p.id, names[i]!]));
  zip.file(
    'visio/pages/pages.xml',
    `${HEAD}<Pages xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">${d.pages
      .map((p, i) => `<Page ID="${i}" NameU="${attr(names[i]!)}" Name="${attr(names[i]!)}"><PageSheet>${cell('PageWidth', inch(p.width))}${cell('PageHeight', inch(p.height))}${cell('PageScale', 1)}${cell('DrawingScale', 1)}${layerSheet(p)}</PageSheet><Rel r:id="rId${i + 1}"/></Page>`)
      .join('')}</Pages>`,
  );
  zip.file('visio/pages/_rels/pages.xml.rels', `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${d.pages.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${i + 1}.xml"/>`).join('')}</Relationships>`);
  /** Visio's id of each shape, by page: the comments point at them. */
  const sheetIds: Map<string, number>[] = [];
  // every layer goes, hidden ones too: Visio hides them as Nova does
  d.pages.forEach((page, i) => {
    const rels: string[] = [];
    const written = pageXml(page, {
      pageNames,
      picture: (info) => {
        const name = `image${++mediaCount}.${info.ext}`;
        zip.file(`visio/media/${name}`, info.data);
        mediaExts.add(info.ext);
        rels.push(`<Relationship Id="rId${rels.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
        return `rId${rels.length}`;
      },
    });
    sheetIds[i] = written.sheetIds;
    if (rels.length) zip.file(`visio/pages/_rels/page${i + 1}.xml.rels`, `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    zip.file(`visio/pages/page${i + 1}.xml`, `${HEAD}<PageContents xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve"><Shapes>${written.shapes}</Shapes>${written.connects ? `<Connects>${written.connects}</Connects>` : ''}</PageContents>`);
  });
  const comments = commentsXml(d, sheetIds);
  if (comments) {
    // Visio keeps the comments in one part for the whole drawing, linked from the document
    zip.file('visio/comments.xml', comments);
    zip.file('visio/_rels/document.xml.rels', (await zip.file('visio/_rels/document.xml.rels')!.async('string')).replace('</Relationships>', '<Relationship Id="rId3" Type="http://schemas.microsoft.com/visio/2010/relationships/comments" Target="comments.xml"/></Relationships>'));
    hasComments = true;
  }
  zip.file('[Content_Types].xml', typesFor());
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.ms-visio.drawing' });
}
