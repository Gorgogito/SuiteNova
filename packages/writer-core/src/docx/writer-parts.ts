import type { Node as PMNode } from 'prosemirror-model';
import { noteDoc } from '../notes';
import { writerSchema } from '../schema';
import type { CommentData, Source, Watermark, WriterDoc } from './model';
import { W_NS, XML_HEAD, hex, hex8 } from './shared';
import { esc } from './xml';

export interface NoteOut {
  id: number;
  node: PMNode;
  seq: number;
}

interface CtxLike {
  commentNum: Map<string, number>;
  replies: Map<string, string[]>;
  comments: CommentData[];
  footnotes: NoteOut[];
  endnotes: NoteOut[];
  warn(m: string): void;
  docPrId: number;
  rev(author: string, date: string): string;
}

const paraBase = (i: number): number => 0x10000000 + i * 0x1000;

const normDate = (d: string): string => (d && /^\d{4}-\d\d-\d\dT/.test(d) ? d.replace(/\.\d+Z$/, 'Z') : new Date().toISOString().replace(/\.\d+Z$/, 'Z'));

export function commentsXml(comments: CommentData[], ctx: CtxLike): string {
  void ctx;
  let out = `${XML_HEAD}<w:comments ${W_NS}>`;
  comments.forEach((c, i) => {
    const paras = (c.text || '').split('\n');
    out += `<w:comment w:id="${i}" w:author="${esc(c.author || 'Autor')}" w:date="${esc(normDate(c.date))}" w:initials="${esc(c.initials || '')}">`;
    paras.forEach((line, j) => {
      out += `<w:p w14:paraId="${hex8(paraBase(i) + j)}"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>`;
      if (j === 0) out += '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>';
      out += line ? `<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>` : '';
      out += '</w:p>';
    });
    out += '</w:comment>';
  });
  return out + '</w:comments>';
}

export function commentsExtendedXml(comments: CommentData[], ctx: CtxLike): string {
  const index = new Map(comments.map((c, i) => [c.id, i]));
  let out = `${XML_HEAD}<w15:commentsEx ${W_NS}>`;
  comments.forEach((c, i) => {
    const last = Math.max(0, (c.text || '').split('\n').length - 1);
    const parent = c.parent !== null && index.has(c.parent) ? index.get(c.parent)! : null;
    const parentLast = parent !== null ? Math.max(0, (comments[parent]!.text || '').split('\n').length - 1) : 0;
    out += `<w15:commentEx w15:paraId="${hex8(paraBase(i) + last)}"${parent !== null ? ` w15:paraIdParent="${hex8(paraBase(parent) + parentLast)}"` : ''} w15:done="${c.done ? 1 : 0}"/>`;
  });
  void ctx;
  return out + '</w15:commentsEx>';
}

type BlocksFn = (doc: PMNode, ctx: never, part: never, rels: never) => string;
type ParaFn = (p: PMNode, ctx: never, part: never, rels: never) => string;

export function footnotesXml(list: NoteOut[], ctx: CtxLike, part: unknown, rels: unknown, kind: 'footnote' | 'endnote', blocksXml: BlocksFn, paragraphXml: ParaFn): string {
  void blocksXml;
  const tag = kind === 'footnote' ? 'footnote' : 'endnote';
  const root = kind === 'footnote' ? 'footnotes' : 'endnotes';
  const style = kind === 'footnote' ? 'FootnoteText' : 'EndnoteText';
  const refStyle = kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  let out = `${XML_HEAD}<w:${root} ${W_NS}>`;
  out += `<w:${tag} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${tag}>`;
  out += `<w:${tag} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${tag}>`;
  for (const n of list) {
    const body = noteDoc(n.node.attrs.body) ?? writerSchema.nodes.doc!.create(null, [writerSchema.nodes.paragraph!.create()]);
    out += `<w:${tag} w:id="${n.id}">`;
    body.forEach((p, _o, i) => {
      if (p.type.name !== 'paragraph') return;
      const styled = p.type.create({ ...p.attrs, style: p.attrs.style ?? style }, p.content, p.marks);
      let xml = paragraphXml(styled, ctx as never, part as never, rels as never);
      if (i === 0) {
        const ref = `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:${tag}Ref/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>`;
        xml = xml.replace(/^<w:p>(<w:pPr>.*?<\/w:pPr>)?/s, (m) => m + ref);
      }
      out += xml;
    });
    out += `</w:${tag}>`;
  }
  return out + `</w:${root}>`;
}

export function settingsXml(doc: WriterDoc, ctx: CtxLike): string {
  let out = '';
  if (doc.trackChanges) out += '<w:trackRevisions/>';
  const p = doc.protection;
  if (p) {
    const crypt = p.hash ? ` w:cryptProviderType="rsaAES" w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="14" w:cryptSpinCount="${p.hash.spin}" w:hash="${p.hash.hash}" w:salt="${p.hash.salt}"` : '';
    out += `<w:documentProtection w:edit="${p.mode}" w:enforcement="1"${crypt}/>`;
  }
  out += '<w:defaultTabStop w:val="720"/>';
  if (doc.evenAndOdd) out += '<w:evenAndOddHeaders/>';
  const fmt = (f: string) => (f === 'symbols' ? 'chicago' : f);
  if (ctx.footnotes.length || doc.notes.footnoteFormat !== 'decimal' || doc.notes.footnoteRestart !== 'continuous') {
    out += `<w:footnotePr><w:numFmt w:val="${fmt(doc.notes.footnoteFormat)}"/><w:numRestart w:val="${doc.notes.footnoteRestart === 'section' ? 'eachSect' : 'continuous'}"/><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>`;
  }
  if (ctx.endnotes.length || doc.notes.endnoteFormat !== 'lowerRoman') {
    out += `<w:endnotePr><w:numFmt w:val="${fmt(doc.notes.endnoteFormat)}"/><w:endnote w:id="-1"/><w:endnote w:id="0"/></w:endnotePr>`;
  }
  out += '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>';
  return `${XML_HEAD}<w:settings ${W_NS}>${out}</w:settings>`;
}

const SHAPETYPE =
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';

interface RelLike {
  media(name: string, part: never): string;
}

/** The header paragraph that holds a watermark (a VML WordArt shape, as Word writes it). */
export function watermarkParagraph(wm: Watermark, ctx: CtxLike, part: unknown, rels: unknown, index: number, addMediaFn?: (src: string) => string | null): string {
  const id = `PowerPlusWaterMarkObject${100000 + index}`;
  const rotation = wm.layout === 'diagonal' ? 'rotation:315;' : '';
  const alpha = wm.semitransparent ? '<v:fill opacity=".5"/>' : '';
  if (wm.image && addMediaFn) {
    const name = addMediaFn(wm.image);
    if (name) {
      const rid = (rels as RelLike).media(name, part as never);
      const w = Math.round(450 * (wm.scale / 100));
      return `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype><v:shape id="${id}" o:spid="_x0000_s20${index}" type="#_x0000_t75" style="position:absolute;margin-left:0;margin-top:0;width:${w}pt;height:${w}pt;z-index:-251658240;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f"><v:imagedata r:id="${rid}" o:title="watermark"${wm.semitransparent ? ' gain="19661f" blacklevel="22938f"' : ''}/></v:shape></w:pict></w:r></w:p>`;
    }
  }
  const text = esc(wm.text ?? '');
  const size = wm.size > 0 ? wm.size : Math.max(36, Math.min(120, Math.round(480 / Math.max(3, (wm.text ?? '').length) * 1.6)));
  const width = Math.round(Math.max(60, (wm.text ?? '').length * size * 0.6));
  void ctx;
  return (
    `<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:rPr><w:noProof/></w:rPr><w:pict>${SHAPETYPE}` +
    `<v:shape id="${id}" o:spid="_x0000_s20${index}" type="#_x0000_t136" style="position:absolute;margin-left:0;margin-top:0;width:${width}pt;height:${Math.round(size * 1.1)}pt;${rotation}z-index:-251658752;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" o:allowincell="f" fillcolor="#${hex(wm.color)}" stroked="f">` +
    `${alpha}<v:textpath style="font-family:&quot;${esc(wm.font)}&quot;;font-size:1pt" string="${text}"/><w10:wrap anchorx="margin" anchory="margin"/></v:shape></w:pict></w:r></w:p>`
  );
}

// ---------------------------------------------------------------------------------------------------- custom XML

export interface CustomPart {
  file: string;
  xml: string;
  props?: string;
  propsFile?: string;
}

const BIB_TYPE: Record<Source['type'], string> = { book: 'Book', bookSection: 'BookSection', article: 'JournalArticle', conference: 'ConferenceProceedings', report: 'Report', web: 'InternetSite', website: 'DocumentFromInternetSite', film: 'Film', interview: 'Interview', other: 'Misc' };

function person(name: string): string {
  const n = name.trim();
  if (n.includes(',')) {
    const [last, first] = n.split(',').map((s) => s.trim());
    return `<b:Person><b:Last>${esc(last ?? '')}</b:Last><b:First>${esc(first ?? '')}</b:First></b:Person>`;
  }
  const parts = n.split(/\s+/);
  const last = parts.pop() ?? '';
  return `<b:Person><b:Last>${esc(last)}</b:Last><b:First>${esc(parts.join(' '))}</b:First></b:Person>`;
}

export function sourcesXml(sources: Source[], style: string): string {
  const styleName: Record<string, string> = { apa: 'APA', mla: 'MLA', chicago: 'Chicago', ieee: 'IEEE 2006', iso690: 'ISO 690 - Numerical Reference' };
  const body = sources
    .map(
      (s) =>
        `<b:Source><b:Tag>${esc(s.tag)}</b:Tag><b:SourceType>${BIB_TYPE[s.type] ?? 'Misc'}</b:SourceType>` +
        (s.authors.length ? `<b:Author><b:Author><b:NameList>${s.authors.map(person).join('')}</b:NameList></b:Author></b:Author>` : '') +
        `<b:Title>${esc(s.title)}</b:Title><b:Year>${esc(s.year)}</b:Year><b:City>${esc(s.city)}</b:City><b:Publisher>${esc(s.publisher)}</b:Publisher>` +
        `<b:JournalName>${esc(s.journal)}</b:JournalName><b:Volume>${esc(s.volume)}</b:Volume><b:Issue>${esc(s.issue)}</b:Issue><b:Pages>${esc(s.pages)}</b:Pages><b:URL>${esc(s.url)}</b:URL><b:Edition>${esc(s.edition)}</b:Edition><b:DOI>${esc(s.doi)}</b:DOI></b:Source>`,
    )
    .join('');
  return `${XML_HEAD}<b:Sources SelectedStyle="\\${(styleName[style] ?? 'APA').replace(/ .*/, '')}.XSL" StyleName="${styleName[style] ?? 'APA'}" xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography" xmlns="http://schemas.openxmlformats.org/officeDocument/2006/bibliography">${body}</b:Sources>`;
}

const cdata = (s: string): string => `<![CDATA[${s.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

/** Parts that carry what Word has no place for (macros, mail merge data, signature) and the bibliography sources. */
export async function customXmlParts(doc: WriterDoc): Promise<CustomPart[]> {
  const out: CustomPart[] = [];
  if (doc.sources.length) {
    out.push({
      file: 'item1.xml',
      xml: sourcesXml(doc.sources, doc.citeStyle),
      propsFile: 'itemProps1.xml',
      props: `${XML_HEAD}<ds:datastoreItem ds:itemID="{B0CB7C95-3D5A-4E55-9F5C-5A1D1C3B7E01}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"/></ds:schemaRefs></ds:datastoreItem>`,
    });
  }
  const nova: Record<string, unknown> = {};
  if (doc.macros.length) nova.macros = doc.macros;
  if (doc.mailMerge) nova.mailMerge = doc.mailMerge;
  if (doc.signature) nova.signature = doc.signature;
  if (doc.citeStyle !== 'apa') nova.citeStyle = doc.citeStyle;
  if (doc.watermark) nova.watermark = doc.watermark;
  nova.notes = doc.notes;
  if (doc.sources.length) nova.sources = doc.sources;
  if (Object.keys(nova).length > 1 || doc.macros.length || doc.mailMerge || doc.signature || doc.watermark || doc.sources.length || doc.citeStyle !== 'apa') {
    out.push({ file: 'novaWriter.xml', xml: `${XML_HEAD}<nova:doc xmlns:nova="urn:suitenova:writer:1" version="1"><nova:json>${cdata(JSON.stringify(nova))}</nova:json></nova:doc>` });
  }
  return out;
}

void hex8;
