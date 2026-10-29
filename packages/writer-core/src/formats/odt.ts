import JSZip from 'jszip';
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import { attrOf, esc, findKid, findKids, kidsOf, parseXml, rootOf, tagOf, textOfNode, type XNode } from '../docx/xml';
import { emptyWriterDoc, makeSection, type ReadResult, type WriteResult, type WriterDoc } from '../docx/model';
import { noteBodyOf } from '../notes';
import { defaultPage, type PageSetup } from '../page';
import { defaultSection, newSectionId, type SectionProps } from '../sections';
import { nodeTypes, writerSchema, type ListFormat } from '../schema';
import { DEFAULT_DOC_DEFAULTS } from '../styles';
import { toBase64 } from '../crypto/sha512';

const MIME = 'application/vnd.oasis.opendocument.text';

// ================================================================================================ helpers

/** A length such as `2.54cm`, `1in`, `12pt`, `10mm`, `3pc`, `16px` in points. */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(-?[\d.]+)\s*(cm|mm|in|pt|pc|px|em)?$/.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]!);
  switch (m[2]) {
    case 'cm': return (n / 2.54) * 72;
    case 'mm': return (n / 25.4) * 72;
    case 'in': return n * 72;
    case 'pc': return n * 12;
    case 'px': return (n * 72) / 96;
    case 'em': return n * 11;
    default: return n;
  }
}
const pt = (n: number) => `${Math.round(n * 100) / 100}pt`;
const unName = (s: string) => s.replace(/_20_/g, ' ');

interface StyleDef {
  family: string;
  parent: string | null;
  tp: Record<string, string>;
  pp: Record<string, string>;
  sp: Record<string, string>;
  displayName: string;
  master: string | null;
  list: string | null;
}

const attrsOf = (n: XNode | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  const a = n?.[':@'] as Record<string, string> | undefined;
  if (a) for (const [k, v] of Object.entries(a)) out[k.slice(2)] = v;
  return out;
};

// ================================================================================================ reading

export async function readOdt(data: Uint8Array): Promise<ReadResult> {
  const zip = await JSZip.loadAsync(data);
  const mime = await zip.file('mimetype')?.async('string');
  if (mime && !mime.startsWith(MIME)) throw new Error('El archivo no es un documento de texto OpenDocument.');
  const contentXml = await zip.file('content.xml')?.async('string');
  if (!contentXml) throw new Error('El archivo ODT no tiene content.xml.');
  const stylesXml = (await zip.file('styles.xml')?.async('string')) ?? '';
  const metaXml = (await zip.file('meta.xml')?.async('string')) ?? '';
  const warnings: string[] = [];
  const doc = emptyWriterDoc({ ...DEFAULT_DOC_DEFAULTS });

  const styles = new Map<string, StyleDef>();
  const listStyles = new Map<string, (ListFormat | 'bullet')[]>();
  const pageLayouts = new Map<string, Partial<PageSetup> & { cols?: number; colGap?: number }>();
  const masters = new Map<string, { layout: string; header: PMNode[] | null; footer: PMNode[] | null; headerFirst: PMNode[] | null; footerFirst: PMNode[] | null }>();
  const colWidths = new Map<string, number>();
  const sectionCols = new Map<string, { count: number; gap: number }>();

  const readStyles = (root: XNode | undefined) => {
    if (!root) return;
    for (const s of kidsOf(root)) {
      const t = tagOf(s);
      if (t === 'style') {
        const a = attrsOf(s);
        const name = a['name'];
        if (!name) continue;
        const def: StyleDef = { family: a['family'] ?? 'paragraph', parent: a['parent-style-name'] ?? null, tp: {}, pp: {}, sp: {}, displayName: unName(a['display-name'] ?? name), master: a['master-page-name'] ?? null, list: a['list-style-name'] ?? null };
        for (const k of kidsOf(s)) {
          const kt = tagOf(k);
          if (kt === 'text-properties') def.tp = attrsOf(k);
          else if (kt === 'paragraph-properties') def.pp = attrsOf(k);
          else if (kt === 'section-properties') {
            const c = findKid(k, 'columns');
            const n = Number(attrOf(c ?? {}, 'column-count') ?? 1);
            if (c && n > 1) sectionCols.set(name, { count: n, gap: parseLength(attrOf(c, 'column-gap')) ?? 36 });
          } else if (kt === 'table-column-properties') {
            const w = parseLength(attrsOf(k)['column-width']);
            if (w !== null) colWidths.set(name, w);
          }
        }
        styles.set(name, def);
      } else if (t === 'list-style') {
        const name = attrOf(s, 'name');
        if (!name) continue;
        const levels: (ListFormat | 'bullet')[] = [];
        for (const l of kidsOf(s)) {
          const lt = tagOf(l);
          const lvl = Number(attrOf(l, 'level') ?? 1) - 1;
          if (lt === 'list-level-style-bullet') levels[lvl] = 'bullet';
          else if (lt === 'list-level-style-number') {
            const f = attrOf(l, 'num-format') ?? '1';
            levels[lvl] = f === 'a' ? 'lowerLetter' : f === 'A' ? 'upperLetter' : f === 'i' ? 'lowerRoman' : f === 'I' ? 'upperRoman' : f === '' ? 'bullet' : 'decimal';
          }
        }
        listStyles.set(name, levels);
      } else if (t === 'page-layout') {
        const name = attrOf(s, 'name')!;
        const p = findKid(s, 'page-layout-properties');
        const a = attrsOf(p);
        const out: Partial<PageSetup> & { cols?: number; colGap?: number } = {};
        const w = parseLength(a['page-width']);
        const h = parseLength(a['page-height']);
        if (w) out.width = w;
        if (h) out.height = h;
        const mt = parseLength(a['margin-top']);
        const mb = parseLength(a['margin-bottom']);
        const ml = parseLength(a['margin-left']);
        const mr = parseLength(a['margin-right']);
        if (mt !== null) out.marginTop = mt;
        if (mb !== null) out.marginBottom = mb;
        if (ml !== null) out.marginLeft = ml;
        if (mr !== null) out.marginRight = mr;
        pageLayouts.set(name, out);
      } else if (t === 'master-page') {
        const name = attrOf(s, 'name')!;
        const blocksOf = (tag: string) => {
          const n = findKid(s, tag);
          return n ? blocks(kidsOf(n)) : null;
        };
        masters.set(name, { layout: attrOf(s, 'page-layout-name') ?? '', header: blocksOf('header'), footer: blocksOf('footer'), headerFirst: blocksOf('header-first'), footerFirst: blocksOf('footer-first') });
      }
    }
  };

  const resolve = (name: string | undefined): StyleDef => {
    const out: StyleDef = { family: 'paragraph', parent: null, tp: {}, pp: {}, sp: {}, displayName: '', master: null, list: null };
    const chain: StyleDef[] = [];
    let n = name;
    for (let i = 0; n && i < 20; i++) {
      const d = styles.get(n);
      if (!d) break;
      chain.unshift(d);
      n = d.parent ?? undefined;
    }
    for (const d of chain) {
      Object.assign(out.tp, d.tp);
      Object.assign(out.pp, d.pp);
      out.displayName = d.displayName || out.displayName;
      out.master = d.master ?? out.master;
      out.list = d.list ?? out.list;
    }
    return out;
  };
  const chainNames = (name: string | undefined): string[] => {
    const out: string[] = [];
    let n = name;
    for (let i = 0; n && i < 20; i++) {
      const d = styles.get(n);
      out.push(d?.displayName ?? unName(n));
      n = d?.parent ?? undefined;
    }
    return out;
  };

  const defaultSize = DEFAULT_DOC_DEFAULTS.fontSize;
  const marksFor = (tp: Record<string, string>): Mark[] => {
    const M = writerSchema.marks;
    const m: Mark[] = [];
    if (tp['font-weight'] === 'bold' || Number(tp['font-weight']) >= 600) m.push(M.strong!.create());
    if (tp['font-style'] === 'italic' || tp['font-style'] === 'oblique') m.push(M.em!.create());
    if (tp['text-underline-style'] && tp['text-underline-style'] !== 'none') m.push(M.underline!.create());
    if (tp['text-line-through-style'] && tp['text-line-through-style'] !== 'none') m.push(M.strike!.create());
    const pos = tp['text-position'];
    if (pos && !pos.startsWith('0%')) m.push((pos.startsWith('sub') || pos.startsWith('-') ? M.subscript! : M.superscript!).create());
    if (tp['text-transform'] === 'uppercase') m.push(M.caps!.create({ value: 'all' }));
    if (tp['color'] && /^#[0-9a-f]{6}$/i.test(tp['color'])) m.push(M.color!.create({ value: tp['color'] }));
    if (tp['background-color'] && /^#[0-9a-f]{6}$/i.test(tp['background-color'])) m.push(M.highlight!.create({ value: tp['background-color'] }));
    const fs = parseLength(tp['font-size']);
    if (fs && Math.abs(fs - defaultSize) > 0.01) m.push(M.fontSize!.create({ value: Math.round(fs * 2) / 2 }));
    const fam = (tp['font-family'] ?? tp['font-name'] ?? '').replace(/['"]/g, '');
    if (fam && fam !== DEFAULT_DOC_DEFAULTS.fontFamily) m.push(M.fontFamily!.create({ value: fam }));
    return m;
  };

  const ws = (t: string) => t.replace(/[ \t\r\n]+/g, ' ');
  let imageCount = 0;
  const imageCache = new Map<string, string>();
  const imagePending: Promise<void>[] = [];

  const inlines = (kids: XNode[], marks: Mark[]): PMNode[] => {
    const out: PMNode[] = [];
    const text = (t: string, m: Mark[]) => {
      if (t) out.push(writerSchema.text(t, m));
    };
    for (const k of kids) {
      const t = tagOf(k);
      if (k['#text'] !== undefined) text(ws(String(k['#text'])), marks);
      else if (t === 'span') {
        const d = resolve(attrOf(k, 'style-name'));
        const own = marksFor(d.tp);
        out.push(...inlines(kidsOf(k), [...marks.filter((x) => !own.some((o) => o.type === x.type)), ...own]));
      } else if (t === 'a') {
        const href = attrOf(k, 'href');
        const link = href && /^(https?:|mailto:|#)/i.test(href) ? writerSchema.marks.link!.create({ href }) : null;
        out.push(...inlines(kidsOf(k), link ? [...marks, link] : marks));
      } else if (t === 's') text(' '.repeat(Number(attrOf(k, 'c') ?? 1)), marks);
      else if (t === 'tab') text('\t', marks);
      else if (t === 'line-break') out.push(nodeTypes.hard_break!.create());
      else if (t === 'page-number') out.push(nodeTypes.field!.create({ kind: 'page' }));
      else if (t === 'page-count') out.push(nodeTypes.field!.create({ kind: 'pages' }));
      else if (t === 'note') {
        const body = findKid(k, 'note-body');
        const paras = body ? blocks(kidsOf(body)) : [];
        out.push(nodeTypes.footnote!.create({ kind: attrOf(k, 'note-class') === 'endnote' ? 'endnote' : 'footnote', id: `fn${Math.random().toString(36).slice(2, 8)}`, body: noteBodyOf(paras) }));
      } else if (t === 'frame') {
        const img = findKid(k, 'image');
        const href = img ? attrOf(img, 'href') : undefined;
        if (href && !href.startsWith('http')) {
          const w = parseLength(attrOf(k, 'width'));
          const h = parseLength(attrOf(k, 'height'));
          const placeholder = nodeTypes.image!.create({ src: `nova-pending:${href}`, alt: '', width: w ? Math.round((w * 96) / 72) : null, height: h ? Math.round((h * 96) / 72) : null });
          out.push(placeholder);
          imagePending.push(
            (async () => {
              if (!imageCache.has(href)) {
                const f = zip.file(href);
                if (f) {
                  const bytes = await f.async('uint8array');
                  const ext = href.split('.').pop()!.toLowerCase();
                  const mimeType = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : '';
                  if (mimeType) imageCache.set(href, `data:${mimeType};base64,${toBase64(bytes)}`);
                  else warnings.push(`Una imagen ${ext.toUpperCase()} no se pudo importar.`);
                }
              }
              imageCount++;
            })(),
          );
        }
      } else if (t === 'annotation' || t === 'bookmark' || t === 'bookmark-start' || t === 'bookmark-end' || t === 'soft-page-break' || t === 'sequence-decls') continue;
      else if (t === 'date' || t === 'title' || t === 'author-name' || t === 'file-name' || t === 'time') text(textOfNode(k), marks);
      else if (t !== '' && kidsOf(k).length) out.push(...inlines(kidsOf(k), marks));
    }
    return out;
  };

  const paragraph = (n: XNode, forceHeading: number | null): PMNode => {
    const styleName = attrOf(n, 'style-name');
    const d = resolve(styleName);
    const names = chainNames(styleName);
    const pp = d.pp;
    const attrs: Record<string, unknown> = {};
    const al = pp['text-align'];
    if (al === 'center') attrs.align = 'center';
    else if (al === 'end' || al === 'right') attrs.align = 'right';
    else if (al === 'justify') attrs.align = 'justify';
    const ml = parseLength(pp['margin-left']);
    const mr = parseLength(pp['margin-right']);
    const ti = parseLength(pp['text-indent']);
    if (ml) attrs.indentLeft = ml;
    if (mr) attrs.indentRight = mr;
    if (ti) attrs.indentFirst = ti;
    const mt = parseLength(pp['margin-top']);
    const mb = parseLength(pp['margin-bottom']);
    if (mt !== null) attrs.spaceBefore = mt;
    if (mb !== null) attrs.spaceAfter = mb;
    const lh = pp['line-height'];
    if (lh?.endsWith('%')) attrs.lineHeight = Math.round((parseFloat(lh) / 100) * 100) / 100;
    if (pp['break-before'] === 'page' || d.master) attrs.pageBreakBefore = pp['break-before'] === 'page';
    if (pp['keep-with-next'] === 'always') attrs.keepNext = true;
    let style: string | null = null;
    const level = forceHeading ?? (names.map((x) => /^Heading (\d)$/.exec(x)?.[1]).find(Boolean) ? Number(names.map((x) => /^Heading (\d)$/.exec(x)?.[1]).find(Boolean)) : null);
    if (level) style = `Heading${Math.min(6, level)}`;
    else if (names.includes('Title')) style = 'Title';
    else if (names.includes('Subtitle')) style = 'Subtitle';
    else if (names.includes('Quotations') || names.includes('Quote')) style = 'Quote';
    else if (names.includes('Caption') || names.includes('Illustration') || names.includes('Table') || names.includes('Text')) style = names.includes('Caption') ? 'Caption' : null;
    if (style) attrs.style = style;
    return nodeTypes.paragraph!.create(attrs, inlines(kidsOf(n), marksFor(d.tp).filter((m) => m.type.name !== 'fontSize' || true)));
  };

  const list = (n: XNode, inherited: string | null, level: number): PMNode => {
    const name = attrOf(n, 'style-name') ?? inherited;
    const kinds = (name && listStyles.get(name)) || [];
    const kind = kinds[level] ?? 'bullet';
    const items: PMNode[] = [];
    for (const li of findKids(n, 'list-item')) {
      const content: PMNode[] = [];
      for (const c of kidsOf(li)) {
        const t = tagOf(c);
        if (t === 'p' || t === 'h') content.push(paragraph(c, t === 'h' ? Number(attrOf(c, 'outline-level') ?? 1) : null));
        else if (t === 'list') content.push(list(c, name, level + 1));
      }
      if (!content.length || content[0]!.type.name !== 'paragraph') content.unshift(nodeTypes.paragraph!.create());
      items.push(nodeTypes.list_item!.create(null, content));
    }
    if (!items.length) items.push(nodeTypes.list_item!.create(null, [nodeTypes.paragraph!.create()]));
    return kind === 'bullet' ? nodeTypes.bullet_list!.create(null, items) : nodeTypes.ordered_list!.create({ format: kind, start: 1 }, items);
  };

  const table = (n: XNode): PMNode => {
    const widths: number[] = [];
    for (const c of kidsOf(n)) {
      if (tagOf(c) === 'table-column') {
        const w = colWidths.get(attrOf(c, 'style-name') ?? '') ?? 100;
        for (let i = 0; i < Number(attrOf(c, 'number-columns-repeated') ?? 1); i++) widths.push(Math.round((w * 96) / 72));
      }
    }
    const rows: PMNode[] = [];
    const collect = (parent: XNode) => {
      for (const r of kidsOf(parent)) {
        const rt = tagOf(r);
        if (rt === 'table-header-rows' || rt === 'table-rows') collect(r);
        else if (rt === 'table-row') {
          const cells: PMNode[] = [];
          let col = 0;
          for (const c of kidsOf(r)) {
            const ct = tagOf(c);
            if (ct === 'covered-table-cell') {
              col++;
              continue;
            }
            if (ct !== 'table-cell') continue;
            const inner = blocks(kidsOf(c));
            const span = Number(attrOf(c, 'number-columns-spanned') ?? 1);
            const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0) || 100;
            col += span;
            cells.push(nodeTypes.table_cell!.create({ colwidth: [w], colspan: span }, inner.length ? inner : [nodeTypes.paragraph!.create()]));
          }
          if (cells.length) rows.push(nodeTypes.table_row!.create(null, cells));
        }
      }
    };
    collect(n);
    return nodeTypes.table!.create({ borders: true }, rows.length ? rows : [nodeTypes.table_row!.create(null, [nodeTypes.table_cell!.create(null, [nodeTypes.paragraph!.create()])])]);
  };

  function blocks(kids: XNode[]): PMNode[] {
    const out: PMNode[] = [];
    for (const k of kids) {
      const t = tagOf(k);
      if (t === 'p') out.push(paragraph(k, null));
      else if (t === 'h') out.push(paragraph(k, Number(attrOf(k, 'outline-level') ?? 1)));
      else if (t === 'list') out.push(list(k, null, 0));
      else if (t === 'table') out.push(table(k));
      else if (t === 'section') out.push(...blocks(kidsOf(k)));
      else if (t === 'table-of-content' || t === 'illustration-index' || t === 'alphabetical-index' || t === 'bibliography') {
        const body = findKid(k, 'index-body');
        if (body) out.push(...blocks(kidsOf(body).filter((x) => tagOf(x) !== 'index-title')));
      }
    }
    return out;
  }

  const stylesDoc = stylesXml ? parseXml(stylesXml) : [];
  const stylesRoot = rootOf(stylesDoc, 'document-styles');
  readStyles(findKid(stylesRoot, 'styles'));
  readStyles(findKid(stylesRoot, 'automatic-styles'));
  readStyles(findKid(stylesRoot, 'master-styles'));
  const contentDoc = parseXml(contentXml);
  const contentRoot = rootOf(contentDoc, 'document-content');
  if (!contentRoot) throw new Error('content.xml no es un documento de texto.');
  readStyles(findKid(contentRoot, 'automatic-styles'));
  const text = findKid(findKid(contentRoot, 'body'), 'text');
  if (!text) throw new Error('El documento ODT no tiene texto.');

  // sections are the runs of paragraphs between master page changes
  type Run = { master: string; blocks: PMNode[]; cols?: { count: number; gap: number }; continuous?: boolean };
  const runs: Run[] = [];
  const firstMaster = [...masters.keys()][0] ?? 'Standard';
  let cur: Run = { master: masters.has('Standard') ? 'Standard' : firstMaster, blocks: [] };
  const walk = (kids: XNode[], cols?: { count: number; gap: number }) => {
    for (const k of kids) {
      const t = tagOf(k);
      if (t === 'sequence-decls' || t === 'tracked-changes' || t === 'forms') continue;
      if (t === 'section') {
        const c = sectionCols.get(attrOf(k, 'style-name') ?? '');
        if (c) {
          if (cur.blocks.length) {
            runs.push(cur);
            cur = { master: cur.master, blocks: [], continuous: true };
          }
          cur.cols = c;
          walk(kidsOf(k), c);
          runs.push(cur);
          cur = { master: cur.master, blocks: [], continuous: true };
        } else walk(kidsOf(k), cols);
        continue;
      }
      const sn = attrOf(k, 'style-name');
      const m = sn ? resolve(sn).master : null;
      if ((t === 'p' || t === 'h') && m && m !== cur.master) {
        if (cur.blocks.length) {
          runs.push(cur);
          cur = { master: m, blocks: [] };
          if (cols) cur.cols = cols;
        } else {
          cur.master = m;
          cur.continuous = false;
        }
      }
      cur.blocks.push(...blocks([k]));
    }
  };
  walk(kidsOf(text));
  if (!cur.blocks.length && runs.length) cur = runs.pop()!;
  runs.push(cur);
  await Promise.all(imagePending);
  const fillImages = (n: PMNode): PMNode => {
    if (n.type.name === 'image' && String(n.attrs.src).startsWith('nova-pending:')) {
      const src = imageCache.get(String(n.attrs.src).slice('nova-pending:'.length));
      return src ? nodeTypes.image!.create({ ...n.attrs, src }) : writerSchema.text('');
    }
    if (n.isLeaf) return n;
    const kids: PMNode[] = [];
    n.content.forEach((c) => {
      const r = fillImages(c);
      if (!(r.isText && !r.text)) kids.push(r);
    });
    return n.copy(Fragment.from(kids));
  };
  void imageCount;

  const parts: Record<string, PMNode> = {};
  const secs: PMNode[] = [];
  runs.forEach((run, idx) => {
    const m = masters.get(run.master);
    const layout = { ...defaultPage(), ...(pageLayouts.get(m?.layout ?? '') ?? {}) };
    const props: SectionProps = { ...defaultSection(), id: newSectionId(), start: idx > 0 && run.continuous ? 'continuous' : 'nextPage', page: layout };
    if (run.cols) props.cols = { count: run.cols.count, space: run.cols.gap, sep: false, widths: null };
    const mk = (kind: 'header' | 'footer', variant: 'default' | 'first', bl: PMNode[] | null) => {
      if (!bl || !bl.length) return;
      const id = `${kind}-${variant}-${newSectionId()}`;
      parts[id] = nodeTypes.doc!.create(null, bl);
      props[kind] = { ...props[kind], [variant]: id };
    };
    if (m) {
      mk('header', 'default', m.header);
      mk('footer', 'default', m.footer);
      if (m.headerFirst || m.footerFirst) {
        props.titlePg = true;
        mk('header', 'first', m.headerFirst);
        mk('footer', 'first', m.footerFirst);
      }
    }
    const content = (run.blocks.length ? run.blocks : [nodeTypes.paragraph!.create()]).map(fillImages);
    secs.push(makeSection(content, props));
  });
  doc.body = nodeTypes.doc!.create(null, secs);
  doc.parts = parts;
  const metaRoot = metaXml ? rootOf(parseXml(metaXml), 'document-meta') : undefined;
  const meta = findKid(metaRoot, 'meta');
  const title = meta ? findKid(meta, 'title') : undefined;
  const creator = meta ? findKid(meta, 'initial-creator') ?? findKid(meta, 'creator') : undefined;
  if (title) doc.title = textOfNode(title);
  if (creator) doc.author = textOfNode(creator);
  return { doc: doc as WriterDoc, warnings: [...new Set(warnings)] };
}

// ================================================================================================ writing

export async function writeOdt(d: WriterDoc): Promise<WriteResult> {
  const warnings: string[] = [];
  const zip = new JSZip();
  zip.file('mimetype', MIME, { compression: 'STORE' });
  const pictures: { name: string; data: Uint8Array; mime: string }[] = [];

  const textStyles = new Map<string, string>();
  const textStyleXml: string[] = [];
  const paraStyles = new Map<string, string>();
  const paraStyleXml: string[] = [];
  const listStyles = new Map<string, string>();
  const listStyleXml: string[] = [];
  const colStyles = new Map<number, string>();
  const colStyleXml: string[] = [];
  const sectStyleXml: string[] = [];
  let noteN = 0;

  const textStyleFor = (marks: readonly Mark[]): string | null => {
    const props: string[] = [];
    for (const m of marks) {
      const a = m.attrs;
      switch (m.type.name) {
        case 'strong': props.push('fo:font-weight="bold"'); break;
        case 'em': props.push('fo:font-style="italic"'); break;
        case 'underline': props.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"'); break;
        case 'strike': props.push('style:text-line-through-style="solid"'); break;
        case 'superscript': props.push('style:text-position="super 58%"'); break;
        case 'subscript': props.push('style:text-position="sub 58%"'); break;
        case 'caps': props.push(a.value === 'small' ? 'fo:font-variant="small-caps"' : 'fo:text-transform="uppercase"'); break;
        case 'color': if (/^#[0-9a-f]{6}$/i.test(a.value)) props.push(`fo:color="${a.value}"`); break;
        case 'highlight': if (/^#[0-9a-f]{6}$/i.test(a.value)) props.push(`fo:background-color="${a.value}"`); break;
        case 'fontFamily': props.push(`style:font-name="${esc(a.value)}" fo:font-family="${esc(a.value)}"`); break;
        case 'fontSize': props.push(`fo:font-size="${a.value}pt"`); break;
      }
    }
    if (!props.length) return null;
    const key = props.join(' ');
    let name = textStyles.get(key);
    if (!name) {
      name = `T${textStyles.size + 1}`;
      textStyles.set(key, name);
      textStyleXml.push(`<style:style style:name="${name}" style:family="text"><style:text-properties ${key}/></style:style>`);
    }
    return name;
  };

  const paraStyleFor = (p: PMNode, master: string | null): string | null => {
    const a = p.attrs;
    const pp: string[] = [];
    if (a.align) pp.push(`fo:text-align="${a.align === 'right' ? 'end' : a.align === 'justify' ? 'justify' : a.align}"`);
    if (a.indentLeft) pp.push(`fo:margin-left="${pt(a.indentLeft)}"`);
    if (a.indentRight) pp.push(`fo:margin-right="${pt(a.indentRight)}"`);
    if (a.indentFirst) pp.push(`fo:text-indent="${pt(a.indentFirst)}"`);
    if (a.spaceBefore !== null) pp.push(`fo:margin-top="${pt(a.spaceBefore)}"`);
    if (a.spaceAfter !== null) pp.push(`fo:margin-bottom="${pt(a.spaceAfter)}"`);
    if (a.lineHeight) pp.push(`fo:line-height="${Math.round(a.lineHeight * 100)}%"`);
    if (a.pageBreakBefore) pp.push('fo:break-before="page"');
    if (a.keepNext) pp.push('fo:keep-with-next="always"');
    const parent = /^Heading\d$/.test(a.style ?? '') ? `Heading_20_${a.style.slice(7)}` : a.style === 'Title' || a.style === 'Subtitle' || a.style === 'Quote' || a.style === 'Caption' ? (a.style === 'Quote' ? 'Quotations' : a.style) : null;
    if (!pp.length && !master && !parent) return null;
    const key = `${parent ?? ''}|${master ?? ''}|${pp.join(' ')}`;
    let name = paraStyles.get(key);
    if (!name) {
      name = `P${paraStyles.size + 1}`;
      paraStyles.set(key, name);
      paraStyleXml.push(`<style:style style:name="${name}" style:family="paragraph"${parent ? ` style:parent-style-name="${parent}"` : ''}${master ? ` style:master-page-name="${master}"` : ''}>${pp.length ? `<style:paragraph-properties ${pp.join(' ')}/>` : ''}</style:style>`);
    }
    return name;
  };

  const listStyleFor = (kind: 'bullet' | ListFormat): string => {
    let name = listStyles.get(kind);
    if (!name) {
      name = `L${listStyles.size + 1}`;
      listStyles.set(kind, name);
      const fmt = { decimal: '1', lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I' } as const;
      const levels = Array.from({ length: 6 }, (_v, i) =>
        kind === 'bullet'
          ? `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="•"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${0.5 * (i + 1)}in" fo:text-indent="-0.25in" fo:margin-left="${0.5 * (i + 1)}in"/></style:list-level-properties></text:list-level-style-bullet>`
          : `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${fmt[kind]}"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${0.5 * (i + 1)}in" fo:text-indent="-0.25in" fo:margin-left="${0.5 * (i + 1)}in"/></style:list-level-properties></text:list-level-style-number>`,
      ).join('');
      listStyleXml.push(`<text:list-style style:name="${name}">${levels}</text:list-style>`);
    }
    return name;
  };

  const colStyleFor = (px: number): string => {
    let name = colStyles.get(px);
    if (!name) {
      name = `Col${colStyles.size + 1}`;
      colStyles.set(px, name);
      colStyleXml.push(`<style:style style:name="${name}" style:family="table-column"><style:table-column-properties style:column-width="${pt((px * 72) / 96)}"/></style:style>`);
    }
    return name;
  };

  const inline = (n: PMNode): string => {
    switch (n.type.name) {
      case 'text': {
        let body = esc(n.text!).replace(/\t/g, '</text:span><text:tab/><text:span>').replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
        body = body.includes('<text:tab/>') ? body.replace(/^/, '<text:span>').replace(/$/, '</text:span>').replace(/<text:span><\/text:span>/g, '') : body;
        const style = textStyleFor(n.marks);
        const link = n.marks.find((m) => m.type.name === 'link');
        let out = style ? `<text:span text:style-name="${style}">${body}</text:span>` : body;
        if (link) out = `<text:a xlink:type="simple" xlink:href="${esc(link.attrs.href)}">${out}</text:a>`;
        return out;
      }
      case 'hard_break': return '<text:line-break/>';
      case 'field': return n.attrs.kind === 'page' ? '<text:page-number text:select-page="current">1</text:page-number>' : n.attrs.kind === 'pages' ? '<text:page-count>1</text:page-count>' : esc(String(n.attrs.result ?? ''));
      case 'image': {
        const m = /^data:image\/(png|jpeg|gif);base64,(.*)$/.exec(String(n.attrs.src));
        if (!m) {
          warnings.push('Una imagen que no estaba incrustada no se guardó en el ODT.');
          return '';
        }
        const bin = atob(m[2]!);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        const name = `Pictures/image${pictures.length + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
        pictures.push({ name, data, mime: `image/${m[1]}` });
        const w = pt(((n.attrs.width ?? 100) * 72) / 96);
        const h = pt(((n.attrs.height ?? 100) * 72) / 96);
        return `<draw:frame draw:name="Imagen${pictures.length}" text:anchor-type="as-char" svg:width="${w}" svg:height="${h}"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`;
      }
      case 'footnote': {
        let body = '';
        try {
          writerSchema.nodeFromJSON(n.attrs.body as never).forEach((p) => (body += `<text:p text:style-name="Footnote">${esc(p.textContent)}</text:p>`));
        } catch {
          body = '<text:p/>';
        }
        noteN++;
        return `<text:note text:id="ftn${noteN}" text:note-class="${n.attrs.kind === 'endnote' ? 'endnote' : 'footnote'}"><text:note-citation>${noteN}</text:note-citation><text:note-body>${body}</text:note-body></text:note>`;
      }
      case 'math': return esc(String(n.attrs.tex));
      case 'shape': case 'content_control': {
        let out = '';
        n.forEach((c) => (out += c.isBlock ? `${inlineOf(c)}<text:line-break/>` : inline(c)));
        return out;
      }
      default: return esc(n.textContent);
    }
  };
  const inlineOf = (p: PMNode): string => {
    let out = '';
    p.forEach((c) => (out += inline(c)));
    return out;
  };
  const para = (p: PMNode, master: string | null = null): string => {
    const style = paraStyleFor(p, master);
    const hm = /^Heading(\d)$/.exec(p.attrs.style ?? '');
    const tag = hm ? `text:h text:outline-level="${hm[1]}"` : 'text:p';
    return `<${tag}${style ? ` text:style-name="${style}"` : ''}>${inlineOf(p)}</${tag.split(' ')[0]}>`;
  };
  const block = (n: PMNode, master: string | null = null): string => {
    switch (n.type.name) {
      case 'paragraph': return para(n, master);
      case 'page_break': return `<text:p text:style-name="${paraStyleFor(nodeTypes.paragraph!.create({ pageBreakBefore: true }), null)}"/>`;
      case 'bullet_list':
      case 'ordered_list': {
        const kind = n.type.name === 'bullet_list' ? 'bullet' : ((n.attrs.format as ListFormat) ?? 'decimal');
        const render = (list: PMNode, top: boolean): string => {
          let out = `<text:list${top ? ` text:style-name="${listStyleFor(kind)}"` : ''}>`;
          list.forEach((li) => {
            out += '<text:list-item>';
            li.forEach((c) => (out += c.type.name === 'bullet_list' || c.type.name === 'ordered_list' ? render(c, false) : block(c)));
            out += '</text:list-item>';
          });
          return out + '</text:list>';
        };
        return render(n, true);
      }
      case 'table': {
        const first = n.firstChild;
        const widths: number[] = [];
        first?.forEach((c) => {
          const w = (c.attrs.colwidth as number[] | null)?.[0] ?? 100;
          for (let i = 0; i < (c.attrs.colspan ?? 1); i++) widths.push(Math.round(w / (c.attrs.colspan ?? 1)));
        });
        let out = `<table:table table:name="Tabla${Math.random().toString(36).slice(2, 6)}" table:style-name="Tbl">`;
        out += widths.map((w) => `<table:table-column table:style-name="${colStyleFor(w)}"/>`).join('');
        n.forEach((row) => {
          out += '<table:table-row>';
          row.forEach((cell) => {
            out += `<table:table-cell table:style-name="${n.attrs.borders ? 'TblCellB' : 'TblCell'}" office:value-type="string"${cell.attrs.colspan > 1 ? ` table:number-columns-spanned="${cell.attrs.colspan}"` : ''}>`;
            cell.forEach((c) => (out += block(c)));
            out += '</table:table-cell>';
            for (let i = 1; i < (cell.attrs.colspan ?? 1); i++) out += '<table:covered-table-cell/>';
          });
          out += '</table:table-row>';
        });
        return out + '</table:table>';
      }
      case 'generated': case 'content_control_block': {
        let out = '';
        n.forEach((c) => (out += block(c)));
        return out;
      }
      default: return `<text:p>${esc(n.textContent)}</text:p>`;
    }
  };

  // sections -> master pages and page layouts
  const layouts: string[] = [];
  const masterXml: string[] = [];
  let body = '';
  const partXml = (id: string | null): string => {
    const part = id ? d.parts[id] : null;
    if (!part) return '';
    let out = '';
    part.forEach((c) => (out += block(c)));
    return out;
  };
  d.body.forEach((sec, i) => {
    const a = sec.attrs;
    const p: PageSetup = a.page ?? defaultPage();
    const lay = `PL${i + 1}`;
    layouts.push(`<style:page-layout style:name="${lay}"><style:page-layout-properties fo:page-width="${pt(p.width)}" fo:page-height="${pt(p.height)}" style:print-orientation="${p.width > p.height ? 'landscape' : 'portrait'}" fo:margin-top="${pt(p.marginTop)}" fo:margin-bottom="${pt(p.marginBottom)}" fo:margin-left="${pt(p.marginLeft)}" fo:margin-right="${pt(p.marginRight)}"/><style:header-style/><style:footer-style/></style:page-layout>`);
    const h = a.header ?? {};
    const f = a.footer ?? {};
    const mname = i === 0 ? 'Standard' : `MP${i + 1}`;
    masterXml.push(
      `<style:master-page style:name="${mname}" style:page-layout-name="${lay}">${partXml(h.default) ? `<style:header>${partXml(h.default)}</style:header>` : ''}${partXml(f.default) ? `<style:footer>${partXml(f.default)}</style:footer>` : ''}${a.titlePg && partXml(h.first) ? `<style:header-first>${partXml(h.first)}</style:header-first>` : ''}${a.titlePg && partXml(f.first) ? `<style:footer-first>${partXml(f.first)}</style:footer-first>` : ''}</style:master-page>`,
    );
    const cols = a.cols as { count: number; space: number } | null;
    const colsOn = cols && cols.count > 1;
    let secBody = '';
    let first = true;
    sec.forEach((c) => {
      secBody += c.type.name === 'paragraph' && first && i > 0 ? block(c, mname) : block(c);
      first = false;
    });
    if (i > 0 && sec.firstChild && sec.firstChild.type.name !== 'paragraph') secBody = `<text:p text:style-name="${paraStyleFor(nodeTypes.paragraph!.create(), mname)}"/>` + secBody;
    if (colsOn) {
      sectStyleXml.push(`<style:style style:name="Sect${i + 1}" style:family="section"><style:section-properties text:dont-balance-text-columns="false"><style:columns fo:column-count="${cols.count}" fo:column-gap="${pt(cols.space)}"/></style:section-properties></style:style>`);
      secBody = `<text:section text:style-name="Sect${i + 1}" text:name="Seccion${i + 1}">${secBody}</text:section>`;
    }
    body += secBody;
  });

  const NS =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"';
  const df = d.defaults;
  const named = (name: string, display: string, extra: string, tp = '') => `<style:style style:name="${name}" style:display-name="${display}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties ${extra}/>${tp ? `<style:text-properties ${tp}/>` : ''}</style:style>`;
  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS} office:version="1.3">` +
    `<office:font-face-decls><style:font-face style:name="${esc(df.fontFamily)}" svg:font-family="${esc(df.fontFamily)}"/></office:font-face-decls>` +
    `<office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="${pt(df.spaceAfter)}" fo:line-height="${Math.round(df.lineHeight * 100)}%"/><style:text-properties style:font-name="${esc(df.fontFamily)}" fo:font-family="${esc(df.fontFamily)}" fo:font-size="${df.fontSize}pt"/></style:default-style>` +
    `<style:style style:name="Standard" style:family="paragraph" style:class="text"/>` +
    [1, 2, 3, 4, 5, 6].map((n) => named(`Heading_20_${n}`, `Heading ${n}`, `fo:margin-top="${n === 1 ? 12 : 2}pt" fo:margin-bottom="0pt" fo:keep-with-next="always"`, `fo:font-size="${[16, 13, 12, 11, 11, 11][n - 1]}pt" fo:color="${n === 1 || n === 2 ? '#2f5496' : '#1f3763'}"`)).join('') +
    named('Title', 'Title', 'fo:margin-bottom="6pt"', 'fo:font-size="28pt"') +
    named('Subtitle', 'Subtitle', 'fo:margin-bottom="8pt"', 'fo:font-size="14pt" fo:color="#595959"') +
    named('Quotations', 'Quotations', 'fo:margin-left="43pt" fo:text-align="center"', 'fo:font-style="italic" fo:color="#404040"') +
    named('Caption', 'Caption', 'fo:margin-bottom="10pt"', 'fo:font-size="9pt" fo:font-style="italic" fo:color="#44546a"') +
    named('Footnote', 'Footnote', 'fo:margin-bottom="0pt"', 'fo:font-size="10pt"') +
    `</office:styles><office:automatic-styles>${layouts.join('')}</office:automatic-styles><office:master-styles>${masterXml.join('')}</office:master-styles></office:document-styles>`;

  const contentXml =
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.3"><office:automatic-styles>${textStyleXml.join('')}${paraStyleXml.join('')}${listStyleXml.join('')}${colStyleXml.join('')}${sectStyleXml.join('')}` +
    `<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="100%" table:align="margins"/></style:style>` +
    `<style:style style:name="TblCellB" style:family="table-cell"><style:table-cell-properties fo:padding="0.05in" fo:border="0.5pt solid #000000"/></style:style>` +
    `<style:style style:name="TblCell" style:family="table-cell"><style:table-cell-properties fo:padding="0.05in" fo:border="none"/></style:style>` +
    `</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS} office:version="1.3"><office:meta>${d.title ? `<dc:title>${esc(d.title)}</dc:title>` : ''}${d.author ? `<meta:initial-creator>${esc(d.author)}</meta:initial-creator><dc:creator>${esc(d.author)}</dc:creator>` : ''}<meta:generator>Nova Writer</meta:generator></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>${pictures.map((p) => `<manifest:file-entry manifest:full-path="${p.name}" manifest:media-type="${p.mime}"/>`).join('')}</manifest:manifest>`;
  zip.file('content.xml', contentXml);
  zip.file('styles.xml', stylesXml);
  zip.file('meta.xml', meta);
  zip.file('META-INF/manifest.xml', manifest);
  for (const p of pictures) zip.file(p.name, p.data);
  if (d.comments.length) warnings.push('Los comentarios no se guardan en ODT.');
  if (d.watermark) warnings.push('La marca de agua no se guarda en ODT.');
  return { data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), warnings };
}
