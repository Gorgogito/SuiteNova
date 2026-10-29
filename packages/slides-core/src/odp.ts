import { attrOf, esc, findKid, findKids, kidsOf, parseXml, rootOf, tagOf, textOfNode, type XNode } from '@suitenova/writer-core';
import JSZip from 'jszip';
import { parseHex, resolveClr, toHex, type ColorContext } from './color';
import { newId, newDeck } from './defaults';
import { newPicture, newShape, newTextBox, newLine } from './factory';
import { geometryToPaths, pathsToCust, pathsToSvg, svgToPaths } from './freeform';
import { chainFor, colorContext, effectiveXfrm, levelStyle, mergeR, resolveLook, textContext } from './resolve';
import { docNode, makeDoc, type ParaSpec } from './text';
import type { Clr, Deck, Fill, Ln, ParaProps, RunProps, ShapeEl, Slide, SlideElement, TableEl, TextBody, Xfrm } from './types';

/*
 * OpenDocument Presentation (.odp). Written and read for the common content: slide size and background, text boxes and shapes with
 * their text, lines, pictures, tables, notes and hidden slides. Placeholders become ordinary shapes (the file carries one plain master
 * page); gradients are written as their first colour; charts, SmartArt, media, effects and animations are not carried. Every loss is
 * returned as a warning.
 */

const MIME = 'application/vnd.oasis.opendocument.presentation';
const cm = (pt: number) => `${Math.round((pt / 72) * 2.54 * 1000) / 1000}cm`;
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"';

const PRST_TO_ODF: Record<string, string> = {
  rect: 'rectangle', roundRect: 'round-rectangle', ellipse: 'ellipse', triangle: 'isosceles-triangle', rtTriangle: 'right-triangle', diamond: 'diamond',
  parallelogram: 'parallelogram', trapezoid: 'trapezoid', hexagon: 'hexagon', octagon: 'octagon', pentagon: 'pentagon', star4: 'star4', star5: 'star5', star6: 'star6',
  rightArrow: 'right-arrow', leftArrow: 'left-arrow', upArrow: 'up-arrow', downArrow: 'down-arrow', can: 'can', cube: 'cube', heart: 'heart', cloud: 'cloud', smileyFace: 'smiley', plus: 'cross', donut: 'ring',
};
const ODF_TO_PRST: Record<string, string> = Object.fromEntries(Object.entries(PRST_TO_ODF).map(([k, v]) => [v, k]));

// ================================================================================================ writing

class Styles {
  private maps = { gr: new Map<string, string>(), P: new Map<string, string>(), T: new Map<string, string>(), dp: new Map<string, string>() };
  add(kind: 'gr' | 'P' | 'T' | 'dp', xml: (name: string) => string): string {
    const probe = xml('§');
    const hit = this.maps[kind].get(probe);
    if (hit) return hit;
    const name = `${kind}${this.maps[kind].size + 1}`;
    this.maps[kind].set(probe, name);
    return name;
  }
  xml(): string {
    let out = '';
    for (const m of Object.values(this.maps)) for (const [probe, name] of m) out += probe.replace(/§/g, name);
    return out;
  }
}

export async function writeOdp(deck: Deck): Promise<{ data: Uint8Array; warnings: string[] }> {
  const warnings = new Set<string>();
  const st = new Styles();
  const zip = new JSZip();
  const pics: [string, Uint8Array][] = [];
  zip.file('mimetype', MIME, { compression: 'STORE' });

  const slidesXml = deck.slides.map((slide, si) => {
    const ch = chainFor(deck, slide);
    const cc = colorContext(ch);
    const hex = (c: Clr | undefined, phc?: Clr): string => {
      const cx: ColorContext = phc ? { ...cc, phClr: resolveClr(phc, { ...cc, phClr: undefined }) } : cc;
      const r = resolveClr(c, cx);
      return toHex(r);
    };
    const fillAttrs = (f: Fill, phc?: Clr): string => {
      if (f.t === 'solid') return `draw:fill="solid" draw:fill-color="${hex(f.c, phc)}"`;
      if (f.t === 'grad' && f.stops[0]) {
        warnings.add('Los degradados se guardan como un color liso.');
        return `draw:fill="solid" draw:fill-color="${hex(f.stops[0].c, phc)}"`;
      }
      if (f.t === 'patt' || f.t === 'blip') warnings.add('Los rellenos de trama y de imagen no se guardan.');
      return 'draw:fill="none"';
    };
    const lnAttrs = (ln: Ln | undefined, phc?: Clr): string => {
      if (!ln || !ln.fill || ln.fill.t === 'none') return 'draw:stroke="none"';
      if (ln.fill.t !== 'solid') return 'draw:stroke="solid"';
      return `draw:stroke="${ln.dash && ln.dash !== 'solid' ? 'dash' : 'solid'}" svg:stroke-color="${hex(ln.fill.c, phc)}" svg:stroke-width="${cm(ln.w ?? 0.75)}"`;
    };

    const paragraphs = (tb: TextBody | undefined, el: ShapeEl | null): string => {
      if (!tb) return '';
      const tc = el ? textContext(deck, ch, el, true) : null;
      const doc = docNode(tb.doc);
      let out = '';
      let inList = false;
      doc.forEach((p) => {
        const lvl = (p.attrs.lvl as number) ?? 0;
        const base = tc ? levelStyle(tc, lvl) : { pPr: {} as ParaProps, rPr: {} as RunProps };
        const pp: ParaProps = { ...base.pPr, ...(p.attrs.p as ParaProps) };
        const bulleted = pp.bullet && (pp.bullet.kind === 'char' || pp.bullet.kind === 'auto');
        const attrs = [
          pp.algn ? `fo:text-align="${pp.algn === 'ctr' ? 'center' : pp.algn === 'r' ? 'end' : pp.algn === 'just' ? 'justify' : 'start'}"` : '',
          pp.marL !== undefined && !bulleted ? `fo:margin-left="${cm(pp.marL)}"` : bulleted ? `fo:margin-left="${cm(Math.max(0, (pp.marL ?? 18) - 18) + lvl * 18)}"` : '',
          pp.indent !== undefined && !bulleted ? `fo:text-indent="${cm(pp.indent)}"` : '',
          pp.lnSpc && 'pct' in pp.lnSpc ? `fo:line-height="${Math.round(pp.lnSpc.pct)}%"` : '',
          pp.spcBef && 'pts' in pp.spcBef ? `fo:margin-top="${cm(pp.spcBef.pts)}"` : '',
          pp.spcAft && 'pts' in pp.spcAft ? `fo:margin-bottom="${cm(pp.spcAft.pts)}"` : '',
        ].filter(Boolean).join(' ');
        const pn = st.add('P', (n) => `<style:style style:name="${n}" style:family="paragraph"><style:paragraph-properties ${attrs}/></style:style>`);
        let inner = '';
        p.forEach((c) => {
          if (c.type.name === 'hard_break') return void (inner += '<text:line-break/>');
          const txt = c.type.name === 'field' ? (c.attrs.text as string) : (c.text ?? '');
          if (!txt) return;
          const own = (c.marks.find((m) => m.type.name === 'run')?.attrs.r as RunProps | undefined) ?? (c.attrs.r as RunProps | undefined);
          const r = mergeR(base.rPr, own);
          const ta = [
            r.b ? 'fo:font-weight="bold"' : '',
            r.i ? 'fo:font-style="italic"' : '',
            r.u && r.u !== 'none' ? 'style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"' : '',
            r.strike ? 'style:text-line-through-style="solid"' : '',
            r.sz ? `fo:font-size="${Math.round(r.sz * 100) / 100}pt"` : '',
            r.color ? `fo:color="${hex(r.color)}"` : '',
            r.latin && !r.latin.startsWith('+') ? `style:font-name="${esc(r.latin)}" fo:font-family="${esc(r.latin)}"` : '',
            r.baseline ? `style:text-position="${r.baseline > 0 ? 'super 58%' : 'sub 58%'}"` : '',
          ].filter(Boolean).join(' ');
          const tn = st.add('T', (n) => `<style:style style:name="${n}" style:family="text"><style:text-properties ${ta}/></style:style>`);
          inner += `<text:span text:style-name="${tn}">${esc(txt).replace(/ {2,}/g, (s) => ` <text:s text:c="${s.length - 1}"/>`)}</text:span>`;
        });
        const para = `<text:p text:style-name="${pn}">${inner}</text:p>`;
        if (bulleted && !inList) {
          out += '<text:list>';
          inList = true;
        } else if (!bulleted && inList) {
          out += '</text:list>';
          inList = false;
        }
        out += bulleted ? `<text:list-item>${para}</text:list-item>` : para;
      });
      if (inList) out += '</text:list>';
      return out;
    };

    const place = (x: Xfrm): { pos: string; transform: string } => {
      if (!x.rot) return { pos: `svg:x="${cm(x.x)}" svg:y="${cm(x.y)}" svg:width="${cm(x.w)}" svg:height="${cm(x.h)}"`, transform: '' };
      const th = (x.rot * Math.PI) / 180;
      const c = { x: x.x + x.w / 2, y: x.y + x.h / 2 };
      // draw:transform = rotate(-θ) translate(t): the frame is moved by t, then turned about the page origin
      const tx = c.x * Math.cos(-th) - c.y * Math.sin(-th) - x.w / 2;
      const ty = c.x * Math.sin(-th) + c.y * Math.cos(-th) - x.h / 2;
      return { pos: `svg:width="${cm(x.w)}" svg:height="${cm(x.h)}"`, transform: ` draw:transform="rotate (${Math.round(-th * 1e6) / 1e6}) translate (${cm(tx)} ${cm(ty)})"` };
    };

    const element = (el: SlideElement, map?: (x: Xfrm) => Xfrm): string => {
      if (el.hidden) return '';
      const raw = effectiveXfrm(ch, el, true);
      const x = map ? map(raw) : raw;
      const { pos, transform } = place(x);
      if (x.flipH || x.flipV) if (el.kind !== 'cxn') warnings.add('Los volteos de formas no se conservan.');
      if (el.kind === 'shape') {
        const empty = !el.text || !/"text"/.test(JSON.stringify(el.text.doc));
        if (el.ph && empty) return '';
        const look = resolveLook(ch, el, true);
        const phc = look.fillClr?.c;
        const b = el.text?.body ?? {};
        const anchor = b.anchor === 'ctr' ? 'middle' : b.anchor === 'b' ? 'bottom' : 'top';
        const gs = st.add('gr', (n) => `<style:style style:name="${n}" style:family="graphic"><style:graphic-properties ${fillAttrs(look.fill, phc)} ${lnAttrs(look.ln, look.lnClr?.c)} draw:textarea-vertical-align="${anchor}" fo:padding-left="${cm(b.lIns ?? 7.2)}" fo:padding-right="${cm(b.rIns ?? 7.2)}" fo:padding-top="${cm(b.tIns ?? 3.6)}" fo:padding-bottom="${cm(b.bIns ?? 3.6)}"${b.wrap === 'none' ? ' fo:wrap-option="no-wrap"' : ''}/></style:style>`);
        const text = paragraphs(el.text, el);
        const name = esc(el.name ?? '');
        const prst = el.geom && 'prst' in el.geom ? el.geom.prst : undefined;
        if (el.isTextBox || (prst === 'rect' && look.fill.t === 'none' && (!look.ln || look.ln.fill?.t === 'none') && !el.ph?.type?.startsWith('dt'))) {
          return `<draw:frame draw:style-name="${gs}" draw:name="${name}" ${pos}${transform}><draw:text-box>${text}</draw:text-box></draw:frame>`;
        }
        const odf = prst ? PRST_TO_ODF[prst] : undefined;
        if (odf) return `<draw:custom-shape draw:style-name="${gs}" draw:name="${name}" ${pos}${transform}>${text}<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="${odf}"/></draw:custom-shape>`;
        const paths = geometryToPaths(el.geom, x.w, x.h);
        if (paths.length) {
          warnings.add('Las formas sin equivalente en OpenDocument se guardan como trazados.');
          return `<draw:path draw:style-name="${gs}" draw:name="${name}" ${pos}${transform} svg:viewBox="0 0 ${Math.round(x.w * 100)} ${Math.round(x.h * 100)}" svg:d="${pathsToSvg(scalePaths(paths, 100))}">${text}</draw:path>`;
        }
        return `<draw:frame draw:style-name="${gs}" ${pos}${transform}><draw:text-box>${text}</draw:text-box></draw:frame>`;
      }
      if (el.kind === 'cxn') {
        const look = resolveLook(ch, el, true);
        const gs = st.add('gr', (n) => `<style:style style:name="${n}" style:family="graphic"><style:graphic-properties ${lnAttrs(look.ln, look.lnClr?.c)}/></style:style>`);
        const x1 = x.flipH ? x.x + x.w : x.x;
        const x2 = x.flipH ? x.x : x.x + x.w;
        const y1 = x.flipV ? x.y + x.h : x.y;
        const y2 = x.flipV ? x.y : x.y + x.h;
        if (look.ln?.head?.type !== undefined || look.ln?.tail?.type !== undefined) warnings.add('Las puntas de flecha no se guardan.');
        return `<draw:line draw:style-name="${gs}" svg:x1="${cm(x1)}" svg:y1="${cm(y1)}" svg:x2="${cm(x2)}" svg:y2="${cm(y2)}"/>`;
      }
      if (el.kind === 'pic') {
        const a = deck.assets[el.src];
        if (!a) return '';
        const ext = a.mime.includes('png') ? 'png' : a.mime.includes('jpeg') ? 'jpg' : a.mime.includes('svg') ? 'svg' : a.mime.includes('gif') ? 'gif' : 'png';
        const path = `Pictures/${el.src}.${ext}`;
        if (!pics.some(([p]) => p === path)) pics.push([path, a.data]);
        if (el.srcRect && (el.srcRect.l || el.srcRect.r || el.srcRect.t || el.srcRect.b)) warnings.add('El recorte de las imágenes no se conserva (la imagen se guarda entera).');
        const gs = st.add('gr', () => '');
        void gs;
        const alt = el.descr ? `<svg:title>${esc(el.name ?? '')}</svg:title><svg:desc>${esc(el.descr)}</svg:desc>` : '';
        return `<draw:frame draw:name="${esc(el.name ?? '')}" ${pos}${transform}><draw:image xlink:href="${path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${alt}</draw:frame>`;
      }
      if (el.kind === 'table') return tableXml(el, x);
      if (el.kind === 'group') {
        const sx = el.chExt.w ? x.w / el.chExt.w : 1;
        const sy = el.chExt.h ? x.h / el.chExt.h : 1;
        const inner = (c: Xfrm): Xfrm => {
          const m = { ...c, x: x.x + (c.x - el.chOff.x) * sx, y: x.y + (c.y - el.chOff.y) * sy, w: c.w * sx, h: c.h * sy };
          return map ? map(m) : m;
        };
        return el.children.map((c) => element(c, (q) => inner(q))).join('');
      }
      warnings.add(el.kind === 'chart' ? 'Los gráficos no se guardan en OpenDocument.' : el.kind === 'media' ? 'El vídeo y el audio no se guardan en OpenDocument.' : 'Algunos objetos (OLE) no se guardan en OpenDocument.');
      return '';
    };

    const tableXml = (el: TableEl, x: Xfrm): string => {
      warnings.add('Los estilos de tabla no se guardan: solo el relleno propio de cada celda.');
      let s = `<draw:frame draw:name="${esc(el.name ?? 'Tabla')}" svg:x="${cm(x.x)}" svg:y="${cm(x.y)}" svg:width="${cm(el.cols.reduce((a, b) => a + b, 0))}" svg:height="${cm(el.rows.reduce((a, r) => a + r.h, 0))}"><table:table>`;
      for (const w of el.cols) s += `<table:table-column table:style-name="${st.add('gr', (n) => `<style:style style:name="${n}" style:family="table-column"><style:table-column-properties style:column-width="${cm(w)}"/></style:style>`)}"/>`;
      el.rows.forEach((row) => {
        const rs = st.add('gr', (n) => `<style:style style:name="${n}" style:family="table-row"><style:table-row-properties style:row-height="${cm(row.h)}"/></style:style>`);
        s += `<table:table-row table:style-name="${rs}">`;
        row.cells.forEach((cell) => {
          if (cell.hMerge || cell.vMerge) return void (s += '<table:covered-table-cell/>');
          const cs = cell.fill && cell.fill.t === 'solid' ? st.add('gr', (n) => `<style:style style:name="${n}" style:family="table-cell"><style:table-cell-properties fo:background-color="${hex(cell.fill!.t === 'solid' ? cell.fill!.c : undefined)}"/></style:style>`) : '';
          s += `<table:table-cell${cs ? ` table:style-name="${cs}"` : ''}${cell.gridSpan ? ` table:number-columns-spanned="${cell.gridSpan}"` : ''}${cell.rowSpan ? ` table:number-rows-spanned="${cell.rowSpan}"` : ''} office:value-type="string">${paragraphs(cell.text ?? undefined, null)}</table:table-cell>`;
        });
        s += '</table:table-row>';
      });
      return `${s}</table:table></draw:frame>`;
    };

    const bg = slide.bg ?? ch.layout?.bg ?? ch.master?.bg;
    const bgFill: Fill | undefined = bg && 'fill' in bg ? bg.fill : bg && 'ref' in bg ? ch.theme.fmt.bgFills[Math.max(0, bg.ref.idx - 1001)] : undefined;
    const dp = st.add('dp', (n) => `<style:style style:name="${n}" style:family="drawing-page"><style:drawing-page-properties presentation:background-visible="true" presentation:background-objects-visible="true" ${bgFill ? fillAttrs(bgFill, bg && 'ref' in bg ? bg.ref.c : undefined) : 'draw:fill="solid" draw:fill-color="#ffffff"'}${slide.hidden ? ' presentation:visibility="hidden"' : ''}/></style:style>`);
    const shapes = slide.shapes.map((e) => element(e)).join('');
    const notes = slide.notes && /"text"/.test(JSON.stringify(slide.notes.doc)) ? `<presentation:notes><draw:frame presentation:class="notes" svg:x="1cm" svg:y="14cm" svg:width="19cm" svg:height="10cm"><draw:text-box>${paragraphs(slide.notes, null)}</draw:text-box></draw:frame></presentation:notes>` : '';
    return `<draw:page draw:name="page${si + 1}" draw:style-name="${dp}" draw:master-page-name="Default">${shapes}${notes}</draw:page>`;
  }).join('');

  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.3"><office:automatic-styles>${st.xml()}</office:automatic-styles><office:body><office:presentation>${slidesXml}</office:presentation></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS} office:version="1.3"><office:automatic-styles><style:page-layout style:name="PM1"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="${cm(deck.size.w)}" fo:page-height="${cm(deck.size.h)}" style:print-orientation="landscape"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles></office:document-styles>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pics.map(([p]) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="${p.endsWith('png') ? 'image/png' : p.endsWith('jpg') ? 'image/jpeg' : p.endsWith('gif') ? 'image/gif' : 'image/svg+xml'}"/>`).join('')}</manifest:manifest>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS} office:version="1.3"><office:meta><dc:title>${esc(deck.props.title ?? '')}</dc:title><meta:generator xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0">Nova Slides</meta:generator></office:meta></office:document-meta>`;
  zip.file('content.xml', content);
  zip.file('styles.xml', styles);
  zip.file('meta.xml', meta);
  zip.file('META-INF/manifest.xml', manifest);
  for (const [p, d] of pics) zip.file(p, d);
  return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), warnings: [...warnings] };
}

function scalePaths(paths: ReturnType<typeof geometryToPaths>, k: number): ReturnType<typeof geometryToPaths> {
  const s = (p: { x: number; y: number }) => ({ ...p, x: p.x * k, y: p.y * k });
  return paths.map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n, x: n.x * k, y: n.y * k, ...(n.hin ? { hin: s(n.hin) } : {}), ...(n.hout ? { hout: s(n.hout) } : {}) })) }));
}

// ================================================================================================ reading

type Props = Record<string, string>;
const attrsOf = (n: XNode | undefined): Props => {
  const out: Props = {};
  const a = n?.[':@'] as Record<string, string> | undefined;
  if (a) for (const [k, v] of Object.entries(a)) out[k.slice(2)] = v;
  return out;
};

/** A length such as `2.54cm`, `10mm`, `1in`, `12pt` in points. */
function len(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  switch (m[2]) {
    case 'cm': return (n / 2.54) * 72;
    case 'mm': return (n / 25.4) * 72;
    case 'in': return n * 72;
    case 'pc': return n * 12;
    case 'px': return (n * 72) / 96;
    default: return n;
  }
}

interface StyleDef {
  parent?: string;
  gfx: Props;
  para: Props;
  text: Props;
}

function collectStyles(roots: (XNode | undefined)[]): Map<string, StyleDef> {
  const out = new Map<string, StyleDef>();
  for (const root of roots) {
    for (const group of kidsOf(root ?? {})) {
      const t = tagOf(group);
      if (t !== 'automatic-styles' && t !== 'styles') continue;
      for (const s of findKids(group, 'style')) {
        const a = attrsOf(s);
        const name = a.name;
        if (!name) continue;
        const def: StyleDef = { parent: a['parent-style-name'], gfx: {}, para: {}, text: {} };
        for (const k of kidsOf(s)) {
          const kt = tagOf(k);
          if (kt === 'graphic-properties' || kt === 'drawing-page-properties' || kt === 'table-cell-properties') Object.assign(def.gfx, attrsOf(k));
          else if (kt === 'paragraph-properties') Object.assign(def.para, attrsOf(k));
          else if (kt === 'text-properties') Object.assign(def.text, attrsOf(k));
        }
        out.set(name, def);
      }
    }
  }
  return out;
}

function resolveStyle(styles: Map<string, StyleDef>, name: string | undefined): StyleDef {
  const chain: StyleDef[] = [];
  for (let n = name, i = 0; n && i < 8; i++) {
    const d = styles.get(n);
    if (!d) break;
    chain.unshift(d);
    n = d.parent;
  }
  return { gfx: Object.assign({}, ...chain.map((d) => d.gfx)), para: Object.assign({}, ...chain.map((d) => d.para)), text: Object.assign({}, ...chain.map((d) => d.text)) };
}

const colorOf = (v: string | undefined): Clr | undefined => (v && /^#[0-9a-f]{6}$/i.test(v) ? { rgb: toHex(parseHex(v)) } : undefined);

export async function readOdp(data: Uint8Array): Promise<{ deck: Deck; warnings: string[] }> {
  const zip = await JSZip.loadAsync(data);
  const mime = await zip.file('mimetype')?.async('string');
  if (mime && !mime.startsWith(MIME)) throw new Error('El archivo no es una presentación OpenDocument.');
  const contentXml = await zip.file('content.xml')?.async('string');
  if (!contentXml) throw new Error('El archivo ODP no tiene content.xml.');
  const stylesXml = await zip.file('styles.xml')?.async('string');
  const content = rootOf(parseXml(contentXml), 'document-content');
  const stylesRoot = stylesXml ? rootOf(parseXml(stylesXml), 'document-styles') : undefined;
  const styles = collectStyles([stylesRoot, content]);
  const warnings = new Set<string>();

  const deck = newDeck();
  deck.slides = [];
  // slide size from the page layout of the first master page
  const layouts = findKids(findKid(stylesRoot, 'automatic-styles'), 'page-layout');
  const mp = findKid(findKid(stylesRoot, 'master-styles'), 'master-page');
  const pl = layouts.find((l) => attrOf(l, 'name') === attrOf(mp ?? {}, 'page-layout-name')) ?? layouts[0];
  const plp = attrsOf(findKid(pl, 'page-layout-properties'));
  const pw = len(plp['page-width']);
  const ph = len(plp['page-height']);
  if (pw && ph) deck.size = { w: Math.round(pw * 100) / 100, h: Math.round(ph * 100) / 100 };
  const blank = deck.layouts.find((l) => l.type === 'blank') ?? deck.layouts[deck.layouts.length - 1]!;

  const mimeOf = (p: string) => (/\.png$/i.test(p) ? 'image/png' : /\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.gif$/i.test(p) ? 'image/gif' : /\.svg$/i.test(p) ? 'image/svg+xml' : /\.bmp$/i.test(p) ? 'image/bmp' : 'image/png');
  const assetIds = new Map<string, string>();
  const addImage = async (href: string): Promise<string | null> => {
    const hit = assetIds.get(href);
    if (hit) return hit;
    const f = zip.file(href);
    if (!f) {
      warnings.add('Hay imágenes enlazadas que no están dentro del archivo.');
      return null;
    }
    const id = newId('a');
    deck.assets[id] = { id, mime: mimeOf(href), data: await f.async('uint8array'), name: href.split('/').pop() ?? href };
    assetIds.set(href, id);
    return id;
  };

  const runOf = (def: StyleDef): RunProps => {
    const t = def.text;
    const r: RunProps = {};
    if (t['font-weight'] === 'bold' || Number(t['font-weight']) >= 600) r.b = true;
    if (t['font-style'] === 'italic') r.i = true;
    if (t['text-underline-style'] && t['text-underline-style'] !== 'none') r.u = 'sng';
    if (t['text-line-through-style'] && t['text-line-through-style'] !== 'none') r.strike = 'sng';
    const sz = len(t['font-size']);
    if (sz) r.sz = sz;
    const c = colorOf(t.color);
    if (c) r.color = c;
    const f = t['font-name'] ?? t['font-family']?.replace(/['"]/g, '');
    if (f) r.latin = f;
    if (t['text-position']?.startsWith('super')) r.baseline = 30;
    else if (t['text-position']?.startsWith('sub')) r.baseline = -25;
    return r;
  };

  /** The paragraphs of a text container (text boxes, shapes, cells, notes) as a text document. */
  const readText = (n: XNode, body: TextBody['body'] = {}): TextBody => {
    const specs: ParaSpec[] = [];
    const para = (p: XNode, lvl: number, bullet: boolean) => {
      const pa = attrsOf(p);
      const ps = resolveStyle(styles, pa['style-name']);
      const pp: ParaProps = {};
      const al = ps.para['text-align'];
      if (al) pp.algn = al === 'center' ? 'ctr' : al === 'end' || al === 'right' ? 'r' : al === 'justify' ? 'just' : 'l';
      const ml = len(ps.para['margin-left']);
      if (ml !== undefined) pp.marL = ml;
      const ind = len(ps.para['text-indent']);
      if (ind !== undefined) pp.indent = ind;
      const lh = ps.para['line-height'];
      if (lh?.endsWith('%')) pp.lnSpc = { pct: parseFloat(lh) };
      const sb = len(ps.para['margin-top']);
      if (sb) pp.spcBef = { pts: sb };
      const sa = len(ps.para['margin-bottom']);
      if (sa) pp.spcAft = { pts: sa };
      if (bullet) {
        pp.bullet = { kind: 'char', char: '•' };
        pp.marL = 18 + lvl * 18;
        pp.indent = -18;
      }
      const runs: NonNullable<ParaSpec['runs']> = [];
      const walk = (kids: XNode[], inherited: StyleDef) => {
        for (const k of kids) {
          if (k['#text'] !== undefined) {
            const t = String(k['#text']);
            if (t) runs.push({ text: t, r: runOf(inherited) });
            continue;
          }
          const t = tagOf(k);
          if (t === 'span' || t === 'a') {
            const d = resolveStyle(styles, attrsOf(k)['style-name']);
            walk(kidsOf(k), { gfx: {}, para: {}, text: { ...inherited.text, ...d.text } });
          } else if (t === 's') runs.push({ text: ' '.repeat(Number(attrsOf(k).c ?? 1)), r: runOf(inherited) });
          else if (t === 'tab') runs.push({ text: '\t', r: runOf(inherited) });
          else if (t === 'line-break') runs.push({ br: true });
        }
      };
      walk(kidsOf(p), { gfx: {}, para: {}, text: ps.text });
      specs.push({ runs, lvl, p: pp });
    };
    const walkBlock = (kids: XNode[], depth: number, inList: boolean) => {
      for (const k of kids) {
        const t = tagOf(k);
        if (t === 'p' || t === 'h') para(k, Math.max(0, depth - 1), inList);
        else if (t === 'list') walkBlock(kidsOf(k), depth + 1, true);
        else if (t === 'list-item' || t === 'list-header') walkBlock(kidsOf(k), depth, inList);
      }
    };
    walkBlock(kidsOf(n), 0, false);
    return { body, doc: makeDoc(specs.length ? specs : [{}]).toJSON() };
  };

  const pos = (a: Props, def?: { w: number; h: number }): Xfrm => {
    let x = len(a.x) ?? 0;
    let y = len(a.y) ?? 0;
    const w = len(a.width) ?? def?.w ?? 100;
    const h = len(a.height) ?? def?.h ?? 50;
    let rot: number | undefined;
    const tr = a.transform;
    if (tr) {
      const rm = /rotate\s*\(\s*(-?[\d.eE+-]+)\s*\)/.exec(tr);
      const tm = /translate\s*\(\s*(-?[\d.]+\w*)\s+(-?[\d.]+\w*)\s*\)/.exec(tr);
      if (rm) {
        const th = -parseFloat(rm[1]!);
        const tx = len(tm?.[1]) ?? 0;
        const ty = len(tm?.[2]) ?? 0;
        // centre = R(θ)·(t + size/2)
        const cx = (tx + w / 2) * Math.cos(th) - (ty + h / 2) * Math.sin(th);
        const cy = (tx + w / 2) * Math.sin(th) + (ty + h / 2) * Math.cos(th);
        x = cx - w / 2;
        y = cy - h / 2;
        rot = Math.round((((th * 180) / Math.PI) % 360 + 360) % 360 * 10) / 10 || undefined;
      } else if (tm) {
        x += len(tm[1]) ?? 0;
        y += len(tm[2]) ?? 0;
      }
    }
    return { x, y, w, h, ...(rot ? { rot } : {}) };
  };

  const styleShape = (el: ShapeEl, ga: Props, gs: StyleDef): void => {
    const g = gs.gfx;
    el.fill = g.fill === 'solid' && colorOf(g['fill-color']) ? { t: 'solid', c: colorOf(g['fill-color'])! } : { t: 'none' };
    if (g.stroke && g.stroke !== 'none' && colorOf(g['stroke-color'] ?? '#000000')) el.ln = { w: len(g['stroke-width']) ?? 0.75, fill: { t: 'solid', c: colorOf(g['stroke-color'] ?? '#000000')! }, ...(g.stroke === 'dash' ? { dash: 'dash' as const } : {}) };
    else el.ln = { fill: { t: 'none' } };
    delete (el as { style?: unknown }).style;
    void ga;
  };
  const bodyOf = (gs: StyleDef): TextBody['body'] => {
    const g = gs.gfx;
    const b: TextBody['body'] = { wrap: g['wrap-option'] === 'no-wrap' ? 'none' : 'square' };
    const v = g['textarea-vertical-align'];
    if (v) b.anchor = v === 'middle' ? 'ctr' : v === 'bottom' ? 'b' : 't';
    const l = len(g['padding-left']);
    const r = len(g['padding-right']);
    const t = len(g['padding-top']);
    const bo = len(g['padding-bottom']);
    if (l !== undefined) b.lIns = l;
    if (r !== undefined) b.rIns = r;
    if (t !== undefined) b.tIns = t;
    if (bo !== undefined) b.bIns = bo;
    return b;
  };

  const readShapes = async (kids: XNode[]): Promise<SlideElement[]> => {
    const out: SlideElement[] = [];
    for (const n of kids) {
      const t = tagOf(n);
      const a = attrsOf(n);
      const gs = resolveStyle(styles, a['style-name']);
      if (t === 'frame') {
        const tb = findKid(n, 'text-box');
        const im = findKid(n, 'image');
        const tbl = findKid(n, 'table');
        if (tb) {
          const el = newTextBox(0, 0, 0, 0);
          el.xfrm = pos(a);
          el.name = a.name || el.name;
          styleShape(el, a, gs);
          el.text = readText(tb, bodyOf(gs));
          if (a.class === 'title' || a['presentation:class'] === 'title') el.name = a.name ?? 'Título';
          out.push(el);
        } else if (im) {
          const href = attrsOf(im).href;
          const id = href ? await addImage(href) : null;
          if (id) {
            const x = pos(a);
            const pic = newPicture(id, x.x, x.y, x.w, x.h, textOfNode(findKid(n, 'desc') ?? {}) || '');
            pic.xfrm = x;
            if (gs.gfx.clip) warnings.add('El recorte de las imágenes no se conserva.');
            out.push(pic);
          }
        } else if (tbl) {
          out.push(await readTable(tbl, pos(a)));
        } else if (findKid(n, 'object') || findKid(n, 'object-ole') || findKid(n, 'plugin')) warnings.add('Hay objetos incrustados (gráficos, OLE, multimedia) que no se han importado.');
      } else if (t === 'custom-shape' || t === 'rect' || t === 'ellipse' || t === 'circle' || t === 'path' || t === 'polygon') {
        const x = pos(a);
        let prst = t === 'ellipse' || t === 'circle' ? 'ellipse' : 'rect';
        const eg = findKid(n, 'enhanced-geometry');
        if (eg) {
          const ty = attrsOf(eg).type ?? '';
          prst = ODF_TO_PRST[ty] ?? 'rect';
          if (!ODF_TO_PRST[ty] && ty) warnings.add(`Algunas formas (${ty}) se han importado como rectángulos.`);
        }
        const el = newShape(prst, x.x, x.y, x.w, x.h);
        el.xfrm = x;
        el.name = a.name || el.name;
        if (t === 'path' && a.d) {
          const vb = (a.viewBox ?? '').split(/\s+/).map(Number);
          const paths = svgToPaths(a.d);
          const sx = vb[2] ? x.w / vb[2]! : 1;
          const sy = vb[3] ? x.h / vb[3]! : 1;
          const sc = paths.map((sp) => ({ ...sp, nodes: sp.nodes.map((nd) => ({ ...nd, x: nd.x * sx, y: nd.y * sy, ...(nd.hin ? { hin: { x: nd.hin.x * sx, y: nd.hin.y * sy } } : {}), ...(nd.hout ? { hout: { x: nd.hout.x * sx, y: nd.hout.y * sy } } : {}) })) }));
          el.geom = { cust: [pathsToCust(sc, x.w, x.h)] } as never;
        }
        styleShape(el, a, gs);
        el.text = readText(n, { ...bodyOf(gs), anchor: bodyOf(gs).anchor ?? 'ctr' });
        out.push(el);
      } else if (t === 'line' || t === 'connector') {
        const x1 = len(a.x1) ?? 0;
        const y1 = len(a.y1) ?? 0;
        const x2 = len(a.x2) ?? 0;
        const y2 = len(a.y2) ?? 0;
        const ln = newLine('line', x1, y1, x2, y2);
        const g = gs.gfx;
        ln.ln = { w: len(g['stroke-width']) ?? 0.75, fill: { t: 'solid', c: colorOf(g['stroke-color'] ?? '#000000') ?? { rgb: '#000000' } }, ...(g.stroke === 'dash' ? { dash: 'dash' as const } : {}) };
        delete (ln as { style?: unknown }).style;
        out.push(ln);
      } else if (t === 'g') out.push(...(await readShapes(kidsOf(n))));
      else if (t === 'page-thumbnail' || t === 'notes' || t === 'event-listeners' || t === 'title' || t === 'desc') continue;
      else if (t === 'caption' || t === 'measure' || t === 'control' || t === 'polyline') warnings.add('Algunos objetos de dibujo no se han importado.');
    }
    return out;
  };

  const readTable = async (tbl: XNode, x: Xfrm): Promise<TableEl> => {
    const cols: number[] = [];
    for (const c of findKids(tbl, 'table-column')) {
      const w = len(resolveStyle(styles, attrsOf(c)['style-name']).gfx['column-width']) ?? 72;
      for (let i = 0; i < Number(attrsOf(c)['number-columns-repeated'] ?? 1); i++) cols.push(w);
    }
    const rows: TableEl['rows'] = [];
    const rowNodes = [...findKids(tbl, 'table-row'), ...findKids(findKid(tbl, 'table-rows'), 'table-row'), ...findKids(findKid(tbl, 'table-header-rows'), 'table-row')];
    for (const r of rowNodes) {
      const h = len(resolveStyle(styles, attrsOf(r)['style-name']).gfx['row-height']) ?? 28;
      const cells: TableEl['rows'][number]['cells'] = [];
      for (const c of kidsOf(r)) {
        const ct = tagOf(c);
        if (ct === 'covered-table-cell') cells.push({ text: null, hMerge: true });
        else if (ct === 'table-cell') {
          const a = attrsOf(c);
          const bg = colorOf(resolveStyle(styles, a['style-name']).gfx['background-color']);
          const cs = Number(a['number-columns-spanned'] ?? 1);
          const rs = Number(a['number-rows-spanned'] ?? 1);
          cells.push({ text: readText(c), ...(cs > 1 ? { gridSpan: cs } : {}), ...(rs > 1 ? { rowSpan: rs } : {}), ...(bg ? { fill: { t: 'solid' as const, c: bg } } : {}) });
        }
      }
      rows.push({ h, cells });
    }
    // covered cells below a row span are vertically merged
    rows.forEach((row, ri) => row.cells.forEach((c, ci) => {
      if (c.rowSpan) for (let k = 1; k < c.rowSpan; k++) {
        const below = rows[ri + k]?.cells[ci];
        if (below && !below.text) below.vMerge = true;
      }
    }));
    const w = cols.reduce((a, b) => a + b, 0) || x.w;
    return { kind: 'table', id: newId(), name: 'Tabla', xfrm: { x: x.x, y: x.y, w, h: rows.reduce((a, r) => a + r.h, 0) }, cols: cols.length ? cols : [w], rows, styleId: '{2D5ABB26-0587-4C30-8999-92F81FD0307C}' };
  };

  const pres = findKid(findKid(content, 'body'), 'presentation');
  for (const page of findKids(pres, 'page')) {
    const a = attrsOf(page);
    const ps = resolveStyle(styles, a['style-name']);
    const slide: Slide = { id: newId('s'), layoutId: blank.id, shapes: [], showMasterSp: false };
    const bgc = ps.gfx.fill === 'solid' ? colorOf(ps.gfx['fill-color']) : undefined;
    if (bgc) slide.bg = { fill: { t: 'solid', c: bgc } };
    if (ps.gfx.visibility === 'hidden') slide.hidden = true;
    slide.shapes = await readShapes(kidsOf(page));
    const notes = findKid(page, 'notes');
    const nb = findKid(findKid(notes, 'frame'), 'text-box');
    if (nb) {
      const tb = readText(nb);
      if (/"text"/.test(JSON.stringify(tb.doc))) slide.notes = tb;
    }
    deck.slides.push(slide);
  }
  if (!deck.slides.length) throw new Error('La presentación OpenDocument no tiene diapositivas.');
  const title = textOfNode(findKid(findKid(rootOf(parseXml((await zip.file('meta.xml')?.async('string')) ?? '<a/>'), 'document-meta'), 'meta') ?? {}, 'title') ?? {});
  if (title) deck.props.title = title;
  warnings.add('El archivo se ha importado como diapositivas con formas libres: los diseños y el patrón de OpenDocument no se conservan.');
  return { deck, warnings: [...warnings] };
}
