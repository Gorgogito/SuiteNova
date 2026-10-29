import JSZip from 'jszip';
import { ruleLabel } from '../mailmerge';
import { Node as PMNode, type Mark } from 'prosemirror-model';
import { PARAGRAPH_STYLES, writerSchema, type ListFormat } from '../schema';
import { esc } from './xml';
import { EMU_PER_PX, ptToTwips, sectionPropsOf, type CommentData, type WriteResult, type WriterDoc } from './model';
import { columnWidths, noRefs, type SectionProps } from '../sections';
import { resolvePart } from '../layout';
import { parseMath, toOMML } from '../math';
import { REL, SHAPE_PRST, W_NS, XML_HEAD, fieldInstr, hex, hex8, relsXml } from './shared';
import { commentsExtendedXml, commentsXml, customXmlParts, footnotesXml, settingsXml, watermarkParagraph, type NoteOut } from './writer-parts';

const NUM_FMT: Record<ListFormat, string> = { decimal: 'decimal', lowerLetter: 'lowerLetter', upperLetter: 'upperLetter', lowerRoman: 'lowerRoman', upperRoman: 'upperRoman' };
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/webp': 'webp' };

export interface PartCtx {
  rels: string[]; // relationship xml fragments for this part
  nextRel: number;
  hyperlinks: Map<string, string>;
}

export class Ctx {
  warnings = new Set<string>();
  media: { name: string; data: Uint8Array; ext: string }[] = [];
  mediaByKey = new Map<string, string>();
  docPrId = 1;
  nums: { numId: number; abstractId: number; kind: 'bullet' | ListFormat; start: number }[] = [];
  abstracts = new Map<string, number>(); // kind → abstractNumId
  revId = 1;
  bookmarkId = 1;
  sdtId = 100;
  comments: CommentData[] = [];
  /** w:id of each comment. */
  commentNum = new Map<string, number>();
  /** Order index of the first and last inline node covered by each comment. */
  commentSpan = new Map<string, { first: number; last: number }>();
  /** Replies of each root comment. */
  replies = new Map<string, string[]>();
  inlineCounter = 0;
  footnotes: NoteOut[] = [];
  endnotes: NoteOut[] = [];
  noteSeq = 0;
  warn(m: string) {
    this.warnings.add(m);
  }
  abstractFor(kind: 'bullet' | ListFormat): number {
    let id = this.abstracts.get(kind);
    if (id === undefined) {
      id = this.abstracts.size;
      this.abstracts.set(kind, id);
    }
    return id;
  }
  numFor(kind: 'bullet' | ListFormat, start: number): number {
    const abstractId = this.abstractFor(kind);
    const numId = this.nums.length + 1;
    this.nums.push({ numId, abstractId, kind, start });
    return numId;
  }
  rev(author: string, date: string): string {
    return `w:id="${this.revId++}" w:author="${esc(author || 'Autor')}" w:date="${esc(normDate(date))}"`;
  }
}

const normDate = (d: string): string => (d && /^\d{4}-\d\d-\d\dT/.test(d) ? d.replace(/\.\d+Z$/, 'Z') : new Date().toISOString().replace(/\.\d+Z$/, 'Z'));

export function newPart(): PartCtx {
  return { rels: [], nextRel: 1, hyperlinks: new Map() };
}

export class RelSink {
  media(name: string, part: PartCtx): string {
    const key = 'media/' + name;
    const existing = part.rels.findIndex((r) => r.includes(`Target="${key}"`));
    if (existing >= 0) return /Id="([^"]+)"/.exec(part.rels[existing]!)![1]!;
    const id = `rId${part.nextRel++}`;
    part.rels.push(`<Relationship Id="${id}" Type="${REL.image}" Target="${key}"/>`);
    return id;
  }
  link(href: string, part: PartCtx): string {
    const have = part.hyperlinks.get(href);
    if (have) return have;
    const id = `rId${part.nextRel++}`;
    part.hyperlinks.set(href, id);
    part.rels.push(`<Relationship Id="${id}" Type="${REL.hyperlink}" Target="${esc(href)}" TargetMode="External"/>`);
    return id;
  }
}

// ---------- runs ----------

function rPr(marks: readonly Mark[], extra = ''): string {
  let fonts = '', b = '', i = '', strike = '', color = '', sz = '', u = '', shd = '', va = '', style = '', caps = '', lang = '';
  for (const m of marks) {
    switch (m.type.name) {
      case 'strong': b = '<w:b/><w:bCs/>'; break;
      case 'em': i = '<w:i/><w:iCs/>'; break;
      case 'underline': u = '<w:u w:val="single"/>'; break;
      case 'strike': strike = '<w:strike/>'; break;
      case 'superscript': va = '<w:vertAlign w:val="superscript"/>'; break;
      case 'subscript': va = '<w:vertAlign w:val="subscript"/>'; break;
      case 'color': color = `<w:color w:val="${hex(m.attrs.value)}"/>`; break;
      case 'highlight': shd = `<w:shd w:val="clear" w:color="auto" w:fill="${hex(m.attrs.value)}"/>`; break;
      case 'fontFamily': fonts = `<w:rFonts w:ascii="${esc(m.attrs.value)}" w:hAnsi="${esc(m.attrs.value)}" w:cs="${esc(m.attrs.value)}"/>`; break;
      case 'fontSize': sz = `<w:sz w:val="${Math.round(m.attrs.value * 2)}"/><w:szCs w:val="${Math.round(m.attrs.value * 2)}"/>`; break;
      case 'link': style = '<w:rStyle w:val="Hyperlink"/>'; break;
      case 'caps': caps = m.attrs.value === 'small' ? '<w:smallCaps/>' : '<w:caps/>'; break;
      case 'lang': lang = `<w:lang w:val="${esc(m.attrs.value)}"/>`; break;
    }
  }
  // schema order of w:rPr: rStyle, rFonts, b, i, caps/smallCaps, strike, color, sz, highlight/shd, u, vertAlign, lang
  const inner = extra + style + fonts + b + i + caps + strike + color + sz + u + shd + va + lang;
  return inner ? `<w:rPr>${inner}</w:rPr>` : '';
}

function textRuns(text: string, props: string, deleted = false): string {
  const parts = text.split(/(\t)/);
  let out = '';
  const t = deleted ? 'w:delText' : 'w:t';
  for (const p of parts) {
    if (p === '') continue;
    if (p === '\t') out += `<w:r>${props}<w:tab/></w:r>`;
    else out += `<w:r>${props}<${t} xml:space="preserve">${esc(p)}</${t}></w:r>`;
  }
  return out;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Store an image data URI as a media file of the package; returns its name, or null when it cannot be embedded. */
export function addMedia(src: string, ctx: Ctx): string | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const ext = MIME_EXT[m[1]!.toLowerCase()];
  if (!ext) return null;
  const bytes = m[2] ? b64ToBytes(m[3]!) : new TextEncoder().encode(decodeURIComponent(m[3]!));
  let name = ctx.mediaByKey.get(src);
  if (!name) {
    name = `image${ctx.media.length + 1}.${ext}`;
    ctx.media.push({ name, data: bytes, ext });
    ctx.mediaByKey.set(src, name);
  }
  return name;
}

function imageXml(node: PMNode, ctx: Ctx, part: PartCtx, rels: RelSink, props: string): string {
  const src: string = node.attrs.src;
  if (!/^data:/.test(src)) {
    ctx.warn('Hay imágenes enlazadas desde internet; no se incrustan y se sustituyen por su texto alternativo.');
    return textRuns(node.attrs.alt ? `[${node.attrs.alt}]` : '[imagen]', props);
  }
  const name = addMedia(src, ctx);
  if (!name) {
    ctx.warn(`Formato de imagen no admitido en DOCX: ${/^data:([^;,]+)/.exec(src)?.[1] ?? '?'}.`);
    return textRuns('[imagen]', props);
  }
  const rid = rels.media(name, part);
  const w = Math.round((node.attrs.width ?? 200) * EMU_PER_PX);
  const h = Math.round((node.attrs.height ?? 150) * EMU_PER_PX);
  const id = ctx.docPrId++;
  const alt = esc(node.attrs.alt ?? '');
  return (
    `<w:r>${props}<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${id}" name="Imagen ${id}" descr="${alt}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/** A complex field: begin, instruction, separate, result, end. */
export function fieldRuns(instr: string, result: string, props: string): string {
  return (
    `<w:r>${props}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${props}<w:instrText xml:space="preserve">${esc(instr)}</w:instrText></w:r>` +
    `<w:r>${props}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${props}<w:t xml:space="preserve">${esc(result)}</w:t></w:r><w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

const FIELD_RESULT: Record<string, string> = { page: '1', pages: '1', numpages: '1', section: '1', sectionpages: '1', title: '', author: '', filename: '' };

function fieldXml(node: PMNode, marks: readonly Mark[], deleted: boolean): string {
  const a = node.attrs;
  const props = rPr(marks);
  void deleted;
  let result = a.result as string | null;
  if (result === null) {
    if (a.kind === 'date') result = new Date().toLocaleDateString('es-ES');
    else if (a.kind === 'time') result = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    else if (a.kind === 'mergefield') result = `«${a.arg ?? ''}»`;
    else if (a.kind === 'merge-rule') result = ruleLabel(String(a.arg), a.switches as string | null);
    else result = FIELD_RESULT[a.kind] ?? '';
  }
  if (a.kind === 'xe') return `<w:r>${props}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${props}<w:instrText xml:space="preserve">${esc(fieldInstr(a as never))}</w:instrText></w:r><w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`;
  return fieldRuns(fieldInstr(a as never), result, props);
}

function shapeXml(node: PMNode, ctx: Ctx, part: PartCtx, rels: RelSink): string {
  const a = node.attrs;
  const w = Math.round(a.width * EMU_PER_PX);
  const h = Math.round(a.height * EMU_PER_PX);
  const id = ctx.docPrId++;
  const prst = SHAPE_PRST[a.kind] ?? 'rect';
  const isText = a.kind === 'textbox';
  const fill = isText && a.fill === '#ffffff' ? '<a:noFill/>' : `<a:solidFill><a:srgbClr val="${hex(a.fill)}"/></a:solidFill>`;
  const line = isText && a.stroke === '#000000' && a.strokeWidth === 0 ? '<a:ln><a:noFill/></a:ln>' : `<a:ln w="${Math.round(a.strokeWidth * 9525)}"><a:solidFill><a:srgbClr val="${hex(a.stroke)}"/></a:solidFill></a:ln>`;
  let content = '';
  node.forEach((p) => {
    content += paragraphXml(p, ctx, part, rels);
  });
  const rot = a.rotation ? ` rot="${Math.round(a.rotation * 60000)}"` : '';
  const sp =
    `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr${isText ? ' txBox="1"' : ''}/><wps:spPr><a:xfrm${rot}><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${fill}${line}</wps:spPr>${content ? `<wps:txbx><w:txbxContent>${content}</w:txbxContent></wps:txbx>` : ''}<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>`;
  const docPr = `<wp:docPr id="${id}" name="${isText ? 'Cuadro de texto' : 'Forma'} ${id}" descr="${esc(a.alt ?? '')}"/>`;
  let drawing: string;
  if (a.wrap === 'inline') {
    drawing = `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/>${docPr}<wp:cNvGraphicFramePr/>${sp}</wp:inline>`;
  } else {
    const behind = a.wrap === 'behind';
    const x = Math.round((a.x ?? 0) * EMU_PER_PX);
    const y = Math.round((a.y ?? 0) * EMU_PER_PX);
    let posH = `<wp:positionH relativeFrom="column"><wp:posOffset>${x}</wp:posOffset></wp:positionH>`;
    let posV = `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${y}</wp:posOffset></wp:positionV>`;
    let wrap = '<wp:wrapNone/>';
    if (a.wrap === 'left' || a.wrap === 'right') {
      posH = `<wp:positionH relativeFrom="column"><wp:align>${a.wrap}</wp:align></wp:positionH>`;
      posV = '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>';
      wrap = '<wp:wrapSquare wrapText="bothSides"/>';
    } else if (a.wrap === 'topBottom') {
      posH = '<wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>';
      posV = '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>';
      wrap = '<wp:wrapTopAndBottom/>';
    }
    drawing =
      `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="${behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>${posH}${posV}` +
      `<wp:extent cx="${w}" cy="${h}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrap}${docPr}<wp:cNvGraphicFramePr/>${sp}</wp:anchor>`;
  }
  return `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${drawing}</w:drawing></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r>`;
}

// ---------- inline content ----------

interface Rev {
  ins?: Mark;
  del?: Mark;
}
const revOf = (marks: readonly Mark[]): Rev => ({ ins: marks.find((m) => m.type.name === 'ins'), del: marks.find((m) => m.type.name === 'del') });

function wrapRev(xml: string, rev: Rev, ctx: Ctx): string {
  let out = xml;
  if (rev.del) out = `<w:del ${ctx.rev(rev.del.attrs.author, rev.del.attrs.date)}>${out}</w:del>`;
  if (rev.ins) out = `<w:ins ${ctx.rev(rev.ins.attrs.author, rev.ins.attrs.date)}>${out}</w:ins>`;
  return out;
}

const commentIdsOf = (marks: readonly Mark[], ctx: Ctx): string[] => marks.filter((m) => m.type.name === 'comment' && ctx.commentNum.has(m.attrs.id)).map((m) => m.attrs.id as string);

/** Every id that must open or close together with a root comment (the comment and its replies). */
const groupOf = (id: string, ctx: Ctx): string[] => [id, ...(ctx.replies.get(id) ?? [])];

function inlineXml(parent: PMNode, ctx: Ctx, part: PartCtx, rels: RelSink): string {
  let out = '';
  let openLink: { href: string; xml: string } | null = null;
  const flush = () => {
    if (!openLink) return;
    const h = openLink.href;
    out += h.startsWith('#') ? `<w:hyperlink w:anchor="${esc(h.slice(1))}" w:history="1">${openLink.xml}</w:hyperlink>` : `<w:hyperlink r:id="${rels.link(h, part)}" w:history="1">${openLink.xml}</w:hyperlink>`;
    openLink = null;
  };
  const emit = (xml: string, link: Mark | undefined) => {
    if (link) {
      if (openLink && openLink.href !== link.attrs.href) flush();
      if (!openLink) openLink = { href: link.attrs.href, xml: '' };
      openLink.xml += xml;
    } else {
      flush();
      out += xml;
    }
  };
  parent.forEach((child) => {
    const k = ctx.inlineCounter++;
    const link = child.marks.find((m) => m.type.name === 'link');
    const rev = revOf(child.marks);
    const deleted = !!rev.del;
    const props = rPr(child.marks.filter((m) => m.type.name !== 'link' || false));
    const ids = commentIdsOf(child.marks, ctx);
    let before = '';
    let after = '';
    for (const id of ids) {
      const span = ctx.commentSpan.get(id);
      if (!span) continue;
      if (span.first === k) for (const g of groupOf(id, ctx)) before += `<w:commentRangeStart w:id="${ctx.commentNum.get(g)}"/>`;
      if (span.last === k) {
        for (const g of groupOf(id, ctx)) after += `<w:commentRangeEnd w:id="${ctx.commentNum.get(g)}"/>`;
        for (const g of groupOf(id, ctx)) after += `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${ctx.commentNum.get(g)}"/></w:r>`;
      }
    }
    let xml = '';
    const tn = child.type.name;
    if (child.isText) xml = wrapRev(textRuns(child.text!, rPr(child.marks), deleted), rev, ctx);
    else if (tn === 'hard_break') xml = wrapRev(`<w:r>${props}<w:br/></w:r>`, rev, ctx);
    else if (tn === 'image') xml = wrapRev(imageXml(child, ctx, part, rels, props), rev, ctx);
    else if (tn === 'field') xml = wrapRev(fieldXml(child, child.marks, deleted), rev, ctx);
    else if (tn === 'bookmark') {
      const id = ctx.bookmarkId++;
      xml = `<w:bookmarkStart w:id="${id}" w:name="${esc(child.attrs.name)}"/><w:bookmarkEnd w:id="${id}"/>`;
    } else if (tn === 'footnote') {
      const num = ++ctx.noteSeq;
      const list = child.attrs.kind === 'endnote' ? ctx.endnotes : ctx.footnotes;
      const id = list.length + 1;
      list.push({ id, node: child, seq: num });
      const style = child.attrs.kind === 'endnote' ? 'EndnoteReference' : 'FootnoteReference';
      xml = wrapRev(`<w:r><w:rPr><w:rStyle w:val="${style}"/></w:rPr><w:${child.attrs.kind === 'endnote' ? 'endnoteReference' : 'footnoteReference'} w:id="${id}"/></w:r>`, rev, ctx);
    } else if (tn === 'math') {
      const o = `<m:oMath>${toOMML(parseMath(child.attrs.tex))}</m:oMath>`;
      xml = child.attrs.display ? `<m:oMathPara>${o}</m:oMathPara>` : o;
    } else if (tn === 'shape') xml = shapeXml(child, ctx, part, rels);
    else if (tn === 'content_control') xml = contentControlXml(child, ctx, part, rels);
    else ctx.warn(`Elemento no exportable: ${tn}`);
    emit(before + xml + after, link);
  });
  flush();
  return out;
}

function contentControlXml(node: PMNode, ctx: Ctx, part: PartCtx, rels: RelSink): string {
  const a = node.attrs;
  let pr = '';
  if (a.title) pr += `<w:alias w:val="${esc(a.title)}"/>`;
  if (a.tag) pr += `<w:tag w:val="${esc(a.tag)}"/>`;
  pr += `<w:id w:val="${a.id && /^-?\d+$/.test(a.id) ? a.id : ctx.sdtId++}"/>`;
  if (a.lock) pr += `<w:lock w:val="${a.lock}"/>`;
  if (a.showing) pr += '<w:showingPlcHdr/>';
  switch (a.type) {
    case 'text': pr += '<w:text/>'; break;
    case 'richText': pr += '<w:richText/>'; break;
    case 'dropdown':
    case 'combo': {
      const tag = a.type === 'combo' ? 'comboBox' : 'dropDownList';
      const items = (a.items as { label: string; value: string }[] | null) ?? [];
      pr += `<w:${tag}>${items.map((i) => `<w:listItem w:displayText="${esc(i.label)}" w:value="${esc(i.value)}"/>`).join('')}</w:${tag}>`;
      break;
    }
    case 'date': pr += `<w:date><w:dateFormat w:val="${esc(a.dateFormat)}"/><w:lid w:val="es-ES"/><w:storeMappedDataAs w:val="dateTime"/><w:calendar w:val="gregorian"/></w:date>`; break;
    case 'checkbox': pr += `<w14:checkbox><w14:checked w14:val="${a.checked ? 1 : 0}"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`; break;
    default:
  }
  return `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${inlineXml(node, ctx, part, rels)}</w:sdtContent></w:sdt>`;
}

// ---------- paragraphs / lists / tables ----------

interface ListRef {
  numId: number;
  level: number;
}

export function paragraphXml(p: PMNode, ctx: Ctx, part: PartCtx, rels: RelSink, list?: ListRef): string {
  const a = p.attrs;
  let ppr = '';
  if (a.style && a.style !== 'Normal') ppr += `<w:pStyle w:val="${esc(a.style)}"/>`;
  if (a.keepNext) ppr += '<w:keepNext/>';
  if (a.pageBreakBefore) ppr += '<w:pageBreakBefore/>';
  if (list) ppr += `<w:numPr><w:ilvl w:val="${list.level}"/><w:numId w:val="${list.numId}"/></w:numPr>`;
  if (a.border) {
    const b = a.border as { width?: number; color?: string; space?: number };
    const side = (s: string) => `<w:${s} w:val="single" w:sz="${Math.round((b.width ?? 0.5) * 8)}" w:space="${Math.round(b.space ?? 1)}" w:color="${hex(b.color ?? '#000000')}"/>`;
    ppr += `<w:pBdr>${side('top')}${side('left')}${side('bottom')}${side('right')}</w:pBdr>`;
  }
  if (a.shade) ppr += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(a.shade)}"/>`;
  if (Array.isArray(a.tabs) && a.tabs.length) {
    ppr += '<w:tabs>' + (a.tabs as { pos: number; kind: string; leader?: string }[]).map((t) => `<w:tab w:val="${t.kind}"${t.leader && t.leader !== 'none' ? ` w:leader="${t.leader}"` : ''} w:pos="${ptToTwips(t.pos)}"/>`).join('') + '</w:tabs>';
  }
  const sp: string[] = [];
  if (a.spaceBefore !== null) sp.push(`w:before="${ptToTwips(a.spaceBefore)}"`);
  if (a.spaceAfter !== null) sp.push(`w:after="${ptToTwips(a.spaceAfter)}"`);
  if (a.lineHeight) sp.push(`w:line="${Math.round(a.lineHeight * 240)}" w:lineRule="auto"`);
  if (sp.length) ppr += `<w:spacing ${sp.join(' ')}/>`;
  if (!list) {
    const ind: string[] = [];
    if (a.indentLeft) ind.push(`w:left="${ptToTwips(a.indentLeft)}"`);
    if (a.indentRight) ind.push(`w:right="${ptToTwips(a.indentRight)}"`);
    if (a.indentFirst > 0) ind.push(`w:firstLine="${ptToTwips(a.indentFirst)}"`);
    else if (a.indentFirst < 0) ind.push(`w:hanging="${ptToTwips(-a.indentFirst)}"`);
    if (ind.length) ppr += `<w:ind ${ind.join(' ')}/>`;
  }
  if (a.align) ppr += `<w:jc w:val="${a.align === 'justify' ? 'both' : a.align}"/>`;
  if (a.ins || a.del) {
    ppr += '<w:rPr>';
    if (a.ins) ppr += `<w:ins ${ctx.rev(a.ins.author, a.ins.date)}/>`;
    if (a.del) ppr += `<w:del ${ctx.rev(a.del.author, a.del.date)}/>`;
    ppr += '</w:rPr>';
  }
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inlineXml(p, ctx, part, rels)}</w:p>`;
}

function listXml(list: PMNode, depth: number, ctx: Ctx, part: PartCtx, rels: RelSink): string {
  const kind: 'bullet' | ListFormat = list.type.name === 'bullet_list' ? 'bullet' : (list.attrs.format as ListFormat);
  const numId = ctx.numFor(kind, list.attrs.start ?? 1);
  let out = '';
  list.forEach((item) => {
    item.forEach((child, _o, idx) => {
      if (idx === 0 && child.type.name === 'paragraph') out += paragraphXml(child, ctx, part, rels, { numId, level: Math.min(depth, 8) });
      else out += blockXml(child, depth + 1, ctx, part, rels);
    });
  });
  return out;
}

function tableXml(t: PMNode, ctx: Ctx, part: PartCtx, rels: RelSink): string {
  // column widths (twips) from the first row's colwidth attributes
  const first = t.firstChild;
  const cols: number[] = [];
  if (first) {
    first.forEach((cell) => {
      const cw: number[] | null = cell.attrs.colwidth;
      for (let i = 0; i < cell.attrs.colspan; i++) cols.push(cw && cw[i] ? Math.round(cw[i]! * 15) : 0);
    });
  }
  const known = cols.filter(Boolean);
  const fallback = known.length ? Math.round(known.reduce((s, n) => s + n, 0) / known.length) : 2000;
  const grid = cols.map((w) => w || fallback);
  const borders = t.attrs.borders
    ? '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') + '</w:tblBorders>'
    : '';
  let out = `<w:tbl><w:tblPr>${t.attrs.borders ? '<w:tblStyle w:val="TableGrid"/>' : ''}<w:tblW w:w="0" w:type="auto"/>${borders}<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0"/></w:tblPr>`;
  out += `<w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const occ: { left: number; span: number }[] = [];
  t.forEach((row) => {
    out += '<w:tr>';
    let col = 0;
    const flushOcc = () => {
      while (occ[col] && occ[col]!.left > 0) {
        const o = occ[col]!;
        out += `<w:tc><w:tcPr><w:tcW w:w="${sum(grid, col, o.span)}" w:type="dxa"/>${o.span > 1 ? `<w:gridSpan w:val="${o.span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
        for (let k = 0; k < o.span; k++) occ[col + k] = { left: o.left - 1, span: o.span };
        col += o.span;
      }
    };
    row.forEach((cell) => {
      flushOcc();
      const span: number = cell.attrs.colspan;
      const rspan: number = cell.attrs.rowspan;
      let pr = `<w:tcW w:w="${sum(grid, col, span)}" w:type="dxa"/>`;
      if (span > 1) pr += `<w:gridSpan w:val="${span}"/>`;
      if (rspan > 1) pr += '<w:vMerge w:val="restart"/>';
      if (cell.attrs.background) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(cell.attrs.background)}"/>`;
      if (cell.attrs.vAlign) pr += `<w:vAlign w:val="${cell.attrs.vAlign === 'middle' ? 'center' : cell.attrs.vAlign}"/>`;
      let content = '';
      cell.forEach((b) => (content += blockXml(b, 0, ctx, part, rels)));
      if (!content.endsWith('</w:p>')) content += '<w:p/>';
      out += `<w:tc><w:tcPr>${pr}</w:tcPr>${content}</w:tc>`;
      if (rspan > 1) for (let k = 0; k < span; k++) occ[col + k] = { left: rspan - 1, span };
      col += span;
    });
    flushOcc();
    out += '</w:tr>';
  });
  return out + '</w:tbl>';
}

const sum = (g: number[], from: number, n: number): number => g.slice(from, from + n).reduce((s, v) => s + v, 0) || 2000;

/** A generated block (table of contents, figures, bibliography, index): its paragraphs inside the field that makes them. */
function generatedXml(node: PMNode, ctx: Ctx, part: PartCtx, rels: RelSink): string {
  const kind: string = node.attrs.kind;
  const opts = (node.attrs.opts ?? {}) as { instr?: string };
  const instr = opts.instr ?? (kind === 'bibliography' ? ' BIBLIOGRAPHY \\l 1033 ' : kind === 'index' ? ' INDEX \\c "2" ' : kind === 'tof' ? ' TOC \\h \\z \\c "Figura" ' : ' TOC \\o "1-3" \\h \\z \\u ');
  const paras: string[] = [];
  node.forEach((c) => paras.push(blockXml(c, 0, ctx, part, rels)));
  const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${esc(instr)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
  const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  // the field starts in the first paragraph that is not the title and ends in the last one
  let firstIdx = node.childCount ? 0 : -1;
  node.forEach((c, _o, i) => {
    if (firstIdx === 0 && i === 0 && c.attrs.style === 'TOCHeading' && node.childCount > 1) firstIdx = 1;
  });
  if (firstIdx < 0) return `<w:p>${begin}${end}</w:p>`;
  paras[firstIdx] = paras[firstIdx]!.replace(/^<w:p>(<w:pPr>.*?<\/w:pPr>)?/s, (m) => m + begin);
  const last = paras.length - 1;
  paras[last] = paras[last]!.replace(/<\/w:p>$/, `${end}</w:p>`);
  const body = paras.join('');
  const gallery = kind === 'toc' ? 'Table of Contents' : kind === 'bibliography' ? 'Bibliographies' : null;
  if (!gallery) return body;
  return `<w:sdt><w:sdtPr><w:id w:val="${ctx.sdtId++}"/><w:docPartObj><w:docPartGallery w:val="${gallery}"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>${body}</w:sdtContent></w:sdt>`;
}

function blockXml(n: PMNode, depth: number, ctx: Ctx, part: PartCtx, rels: RelSink): string {
  switch (n.type.name) {
    case 'paragraph': return paragraphXml(n, ctx, part, rels);
    case 'bullet_list':
    case 'ordered_list': return listXml(n, depth, ctx, part, rels);
    case 'table': return tableXml(n, ctx, part, rels) + '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
    case 'page_break': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    case 'generated': return generatedXml(n, ctx, part, rels);
    case 'content_control_block': {
      let inner = '';
      n.forEach((c) => (inner += blockXml(c, depth, ctx, part, rels)));
      const a = n.attrs;
      return `<w:sdt><w:sdtPr>${a.title ? `<w:alias w:val="${esc(a.title)}"/>` : ''}${a.tag ? `<w:tag w:val="${esc(a.tag)}"/>` : ''}<w:id w:val="${ctx.sdtId++}"/>${a.lock ? `<w:lock w:val="${a.lock}"/>` : ''}<w:richText/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
    }
    case 'section': {
      let inner = '';
      n.forEach((c) => (inner += blockXml(c, depth, ctx, part, rels)));
      return inner;
    }
    default:
      ctx.warn(`Elemento no exportable: ${n.type.name}`);
      return '';
  }
}

function blocksXml(doc: PMNode, ctx: Ctx, part: PartCtx, rels: RelSink): string {
  let out = '';
  doc.forEach((b) => (out += blockXml(b, 0, ctx, part, rels)));
  return out || '<w:p/>';
}

// ---------- parts ----------

function numberingXml(ctx: Ctx): string {
  const lvls = (kind: 'bullet' | ListFormat) =>
    Array.from({ length: 9 }, (_, i) => {
      const left = 720 * (i + 1);
      if (kind === 'bullet') {
        const ch = ['', 'o', ''][i % 3]!;
        const font = ['Symbol', 'Courier New', 'Wingdings'][i % 3]!;
        return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ch}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr></w:lvl>`;
      }
      return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${NUM_FMT[kind]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join('');
  let out = `${XML_HEAD}<w:numbering ${W_NS}>`;
  for (const [kind, id] of ctx.abstracts) out += `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(kind as 'bullet' | ListFormat)}</w:abstractNum>`;
  for (const n of ctx.nums) {
    const over = n.kind !== 'bullet' && n.start !== 1 ? Array.from({ length: 9 }, (_, i) => `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="${n.start}"/></w:lvlOverride>`).join('') : '';
    out += `<w:num w:numId="${n.numId}"><w:abstractNumId w:val="${n.abstractId}"/>${over}</w:num>`;
  }
  return out + '</w:numbering>';
}

function stylesXml(doc: WriterDoc): string {
  const d = doc.defaults;
  const font = esc(d.fontFamily);
  let out = `${XML_HEAD}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${Math.round(d.fontSize * 2)}"/><w:szCs w:val="${Math.round(d.fontSize * 2)}"/><w:lang w:val="es-ES" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`;
  out += `<w:pPrDefault><w:pPr><w:spacing w:after="${ptToTwips(d.spaceAfter)}" w:line="${Math.round(d.lineHeight * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`;
  for (const s of doc.styles ?? PARAGRAPH_STYLES) {
    const name = s.wordName ?? (s.heading ? `heading ${s.heading}` : s.id === 'Caption' ? 'caption' : s.id === 'Title' ? 'Title' : s.id === 'Normal' ? 'Normal' : s.name);
    let ppr = '';
    if (s.heading) ppr += '<w:keepNext/><w:keepLines/>';
    if (s.tabs?.length) ppr += '<w:tabs>' + s.tabs.map((t) => `<w:tab w:val="${t.kind}"${t.leader && t.leader !== 'none' ? ` w:leader="${t.leader}"` : ''} w:pos="${ptToTwips(t.pos)}"/>`).join('') + '</w:tabs>';
    const sp: string[] = [];
    if (s.spaceBefore !== undefined) sp.push(`w:before="${ptToTwips(s.spaceBefore)}"`);
    if (s.spaceAfter !== undefined) sp.push(`w:after="${ptToTwips(s.spaceAfter)}"`);
    if (s.lineHeight) sp.push(`w:line="${Math.round(s.lineHeight * 240)}" w:lineRule="auto"`);
    if (sp.length) ppr += `<w:spacing ${sp.join(' ')}/>`;
    if (s.indentLeft) ppr += `<w:ind w:left="${ptToTwips(s.indentLeft)}"${s.id === 'Quote' ? ` w:right="${ptToTwips(s.indentLeft)}"` : ''}/>`;
    if (s.align) ppr += `<w:jc w:val="${s.align}"/>`;
    if (s.heading) ppr += `<w:outlineLvl w:val="${s.heading - 1}"/>`;
    let rp = '';
    if (s.fontFamily) rp += `<w:rFonts w:ascii="${esc(s.fontFamily)}" w:hAnsi="${esc(s.fontFamily)}"/>`;
    if (s.bold) rp += '<w:b/>';
    if (s.italic) rp += '<w:i/>';
    if (s.color) rp += `<w:color w:val="${hex(s.color)}"/>`;
    if (s.fontSize) rp += `<w:sz w:val="${Math.round(s.fontSize * 2)}"/><w:szCs w:val="${Math.round(s.fontSize * 2)}"/>`;
    if (s.underline) rp += '<w:u w:val="single"/>';
    out += `<w:style w:type="paragraph" w:styleId="${s.id}"${s.id === 'Normal' ? ' w:default="1"' : ''}><w:name w:val="${esc(name)}"/>${s.id !== 'Normal' ? `<w:basedOn w:val="${s.basedOn ?? 'Normal'}"/>` : ''}${s.next ? `<w:next w:val="${s.next}"/>` : ''}${s.hidden ? '' : '<w:qFormat/>'}${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rp ? `<w:rPr>${rp}</w:rPr>` : ''}</w:style>`;
  }
  out += '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>';
  out += '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>';
  out += '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>';
  out += '<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>';
  out += '<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>';
  out += '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>';
  out += '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') + '</w:tblBorders></w:tblPr></w:style>';
  return out + '</w:styles>';
}

/** The `w:sectPr` of a section. `hf` maps header/footer part ids to the relationship ids of the main part. */
function sectPrXml(sec: SectionProps, hf: Map<string, string>): string {
  const pg = sec.page;
  let refs = '';
  for (const [tag, group] of [['header', sec.header], ['footer', sec.footer]] as const) {
    for (const t of ['default', 'first', 'even'] as const) {
      const id = group[t];
      const rid = id ? hf.get(id) : undefined;
      if (rid) refs += `<w:${tag}Reference w:type="${t}" r:id="${rid}"/>`;
    }
  }
  const type = sec.start === 'nextPage' ? '' : `<w:type w:val="${sec.start === 'continuous' ? 'continuous' : sec.start === 'evenPage' ? 'evenPage' : 'oddPage'}"/>`;
  let cols = '';
  if (sec.cols.count > 1) {
    const widths = columnWidths(pg, sec.cols);
    const equal = !sec.cols.widths;
    cols = `<w:cols w:num="${sec.cols.count}" w:space="${ptToTwips(sec.cols.space)}"${sec.cols.sep ? ' w:sep="1"' : ''}${equal ? ' w:equalWidth="1"/>' : ` w:equalWidth="0">${widths.map((w, i) => `<w:col w:w="${ptToTwips(w)}"${i < widths.length - 1 ? ` w:space="${ptToTwips(sec.cols.space)}"` : ''}/>`).join('')}</w:cols>`}`;
  }
  const pgNum = sec.pgNumStart !== null || sec.pgNumFmt !== 'decimal' ? `<w:pgNumType${sec.pgNumStart !== null ? ` w:start="${sec.pgNumStart}"` : ''}${sec.pgNumFmt !== 'decimal' ? ` w:fmt="${sec.pgNumFmt}"` : ''}/>` : '';
  return (
    `<w:sectPr>${refs}${type}<w:pgSz w:w="${ptToTwips(pg.width)}" w:h="${ptToTwips(pg.height)}"${pg.width > pg.height ? ' w:orient="landscape"' : ''}/>` +
    `<w:pgMar w:top="${ptToTwips(pg.marginTop)}" w:right="${ptToTwips(pg.marginRight)}" w:bottom="${ptToTwips(pg.marginBottom)}" w:left="${ptToTwips(pg.marginLeft)}" w:header="${ptToTwips(pg.headerDistance)}" w:footer="${ptToTwips(pg.footerDistance)}" w:gutter="0"/>${pgNum}${cols}${sec.titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`
  );
}

/** Blocks of every section; each section but the last ends with a paragraph that carries its `w:sectPr`. */
function bodyXml(doc: WriterDoc, secProps: SectionProps[], ctx: Ctx, part: PartCtx, rels: RelSink, hf: Map<string, string>): { xml: string; finalSect: string } {
  let out = '';
  const sections = doc.body.content.content;
  let finalSect = '';
  sections.forEach((sec, i) => {
    const sp = sectPrXml(secProps[i]!, hf);
    let xml = '';
    sec.forEach((b) => (xml += blockXml(b, 0, ctx, part, rels)));
    if (i === sections.length - 1) {
      finalSect = sp;
      out += xml || '<w:p/>';
      return;
    }
    const lastIsPara = xml.endsWith('</w:p>');
    const at = Math.max(xml.lastIndexOf('<w:p>'), xml.lastIndexOf('<w:p '));
    // the last paragraph must be a plain paragraph of the section (not the end of a field or a table cell)
    const tail = at >= 0 ? xml.slice(at) : '';
    if (lastIsPara && at >= 0 && !tail.includes('</w:tc>') && !tail.includes('<w:tbl>') && (tail.match(/<w:p[ >]/g) ?? []).length === 1) {
      const withPr = tail.startsWith('<w:p><w:pPr>') ? tail.replace('</w:pPr>', `${sp}</w:pPr>`) : tail.replace('<w:p>', `<w:p><w:pPr>${sp}</w:pPr>`);
      xml = xml.slice(0, at) + withPr;
    } else xml += `<w:p><w:pPr>${sp}</w:pPr></w:p>`;
    out += xml;
  });
  return { xml: out, finalSect };
}

/** Number every comment, find the nodes each one covers and gather replies under their parent. */
function prepareComments(doc: WriterDoc, ctx: Ctx): void {
  const known = new Set(doc.comments.map((c) => c.id));
  ctx.comments = doc.comments;
  doc.comments.forEach((c, i) => ctx.commentNum.set(c.id, i));
  for (const c of doc.comments) {
    if (c.parent && known.has(c.parent)) {
      const list = ctx.replies.get(c.parent) ?? [];
      list.push(c.id);
      ctx.replies.set(c.parent, list);
    }
  }
  let k = 0;
  const visit = (node: PMNode) => {
    node.forEach((child) => {
      if (child.type.name === 'footnote') {
        k++;
        return;
      }
      if (child.isInline) {
        for (const m of child.marks) {
          if (m.type.name !== 'comment' || !known.has(m.attrs.id)) continue;
          const s = ctx.commentSpan.get(m.attrs.id);
          if (s) s.last = k;
          else ctx.commentSpan.set(m.attrs.id, { first: k, last: k });
        }
        k++;
      }
      if (!child.isLeaf) visit(child);
    });
  };
  visit(doc.body);
  // a comment that covers no text is anchored at the very start
  for (const c of doc.comments) if (!c.parent && !ctx.commentSpan.has(c.id)) ctx.warn('Un comentario sin texto asociado se omite.');
}

export async function writeDocx(doc: WriterDoc): Promise<WriteResult> {
  const ctx = new Ctx();
  const rels = new RelSink();
  const zip = new JSZip();
  prepareComments(doc, ctx);

  // sections (copies, so that the watermark can add header parts without touching the document)
  const secProps: SectionProps[] = [];
  doc.body.forEach((sec) => secProps.push(sectionPropsOf(sec)));
  const parts: Record<string, PMNode> = { ...doc.parts };
  const wm = doc.watermark;
  if (wm) {
    for (let i = 0; i < secProps.length; i++) {
      const variants: ('default' | 'first' | 'even')[] = ['default'];
      if (secProps[i]!.titlePg) variants.push('first');
      if (doc.evenAndOdd) variants.push('even');
      for (const v of variants) {
        const resolved = resolvePart(secProps, i, 'header', v);
        if (!resolved) {
          const id = `wm-${i}-${v}`;
          parts[id] = writerSchema.nodes.doc!.create(null, [writerSchema.nodes.paragraph!.create({ style: 'Header' })]);
          secProps[i] = { ...secProps[i]!, header: { ...(secProps[i]!.header ?? noRefs()), [v]: id } };
        }
      }
    }
  }

  const used = new Set<string>();
  const kindOf = new Map<string, 'header' | 'footer'>();
  for (const p of secProps) {
    for (const id of [p.header.default, p.header.first, p.header.even]) if (id && parts[id]) (used.add(id), kindOf.set(id, 'header'));
    for (const id of [p.footer.default, p.footer.first, p.footer.even]) if (id && parts[id]) (used.add(id), kindOf.set(id, 'footer'));
  }
  const hfRel = new Map<string, string>();
  const hfFiles: { id: string; file: string; kind: 'header' | 'footer'; xml: string; part: PartCtx }[] = [];
  let hn = 0, fn = 0;
  for (const id of used) {
    const kind = kindOf.get(id) ?? 'header';
    const part = newPart();
    const tag = kind === 'header' ? 'hdr' : 'ftr';
    const file = kind === 'header' ? `header${++hn}.xml` : `footer${++fn}.xml`;
    let inner = blocksXml(parts[id]!, ctx, part, rels);
    if (kind === 'header' && wm) inner = watermarkParagraph(wm, ctx, part, rels, hfFiles.length + 1, (s) => addMedia(s, ctx)) + inner;
    hfFiles.push({ id, file, kind, xml: `${XML_HEAD}<w:${tag} ${W_NS}>${inner}</w:${tag}>`, part });
    hfRel.set(id, `rId${kind === 'header' ? 'Header' : 'Footer'}${kind === 'header' ? hn : fn}`);
  }

  const main = newPart();
  const { xml: bodyContent, finalSect } = bodyXml(doc, secProps, ctx, main, rels, hfRel);

  // notes
  const notesPart = newPart();
  const fnXml = ctx.footnotes.length ? footnotesXml(ctx.footnotes, ctx, notesPart, rels, 'footnote', blocksXml, paragraphXml) : null;
  const enXml = ctx.endnotes.length ? footnotesXml(ctx.endnotes, ctx, notesPart, rels, 'endnote', blocksXml, paragraphXml) : null;

  const mainRels: string[] = [
    `<Relationship Id="rIdStyles" Type="${REL.styles}" Target="styles.xml"/>`,
    `<Relationship Id="rIdNumbering" Type="${REL.numbering}" Target="numbering.xml"/>`,
    `<Relationship Id="rIdSettings" Type="${REL.settings}" Target="settings.xml"/>`,
  ];
  for (const p of hfFiles) {
    mainRels.push(`<Relationship Id="${hfRel.get(p.id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${p.kind}" Target="${p.file}"/>`);
    zip.file(`word/${p.file}`, p.xml);
    zip.file(`word/_rels/${p.file}.rels`, relsXml(p.part.rels));
  }
  mainRels.push(...main.rels);
  const overrides: [string, string][] = [];
  if (doc.comments.length) {
    zip.file('word/comments.xml', commentsXml(doc.comments, ctx));
    zip.file('word/commentsExtended.xml', commentsExtendedXml(doc.comments, ctx));
    mainRels.push(`<Relationship Id="rIdComments" Type="${REL.comments}" Target="comments.xml"/>`, `<Relationship Id="rIdCommentsEx" Type="${REL.commentsExtended}" Target="commentsExtended.xml"/>`);
    overrides.push(['/word/comments.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'], ['/word/commentsExtended.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml']);
  }
  if (fnXml) {
    zip.file('word/footnotes.xml', fnXml);
    mainRels.push(`<Relationship Id="rIdFootnotes" Type="${REL.footnotes}" Target="footnotes.xml"/>`);
    overrides.push(['/word/footnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml']);
  }
  if (enXml) {
    zip.file('word/endnotes.xml', enXml);
    mainRels.push(`<Relationship Id="rIdEndnotes" Type="${REL.endnotes}" Target="endnotes.xml"/>`);
    overrides.push(['/word/endnotes.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml']);
  }
  if (fnXml || enXml) zip.file('word/_rels/footnotes.xml.rels', relsXml(notesPart.rels)), (enXml && zip.file('word/_rels/endnotes.xml.rels', relsXml(notesPart.rels)));

  const custom = await customXmlParts(doc);
  custom.forEach((c, i) => {
    zip.file(`customXml/${c.file}`, c.xml);
    if (c.props) zip.file(`customXml/${c.propsFile}`, c.props);
    zip.file(`customXml/_rels/${c.file}.rels`, relsXml(c.props ? [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="${c.propsFile}"/>`] : []));
    mainRels.push(`<Relationship Id="rIdCustom${i + 1}" Type="${REL.customXml}" Target="../customXml/${c.file}"/>`);
    if (c.props) overrides.push([`/customXml/${c.propsFile}`, 'application/vnd.openxmlformats-officedocument.customXmlProperties+xml']);
  });

  zip.file('word/document.xml', `${XML_HEAD}<w:document ${W_NS}><w:body>${bodyContent}${finalSect}</w:body></w:document>`);
  zip.file('word/styles.xml', stylesXml(doc));
  zip.file('word/numbering.xml', numberingXml(ctx));
  zip.file('word/settings.xml', settingsXml(doc, ctx));
  zip.file('word/_rels/document.xml.rels', relsXml(mainRels));
  for (const m of ctx.media) zip.file(`word/media/${m.name}`, m.data);

  const exts = new Set(ctx.media.map((m) => m.ext));
  const defaults = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>', '<Default Extension="xml" ContentType="application/xml"/>'];
  const mimeFor: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };
  for (const e of exts) defaults.push(`<Default Extension="${e}" ContentType="${mimeFor[e]}"/>`);
  const allOverrides: [string, string][] = [
    ['/word/document.xml', doc.isTemplate ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
    ['/word/styles.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
    ['/word/numbering.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'],
    ['/word/settings.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
    ...hfFiles.map((p) => [`/word/${p.file}`, `application/vnd.openxmlformats-officedocument.wordprocessingml.${p.kind}+xml`] as [string, string]),
    ...overrides,
  ];
  zip.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults.join('')}${allOverrides.map(([p, c]) => `<Override PartName="${p}" ContentType="${c}"/>`).join('')}</Types>`);
  zip.file(
    '_rels/.rels',
    relsXml([
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    ]),
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file(
    'docProps/core.xml',
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.title ?? '')}</dc:title><dc:creator>${esc(doc.author ?? '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  zip.file('docProps/app.xml', `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Nova Writer</Application></Properties>`);

  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  void hex8;
  return { data, warnings: [...ctx.warnings] };
}
