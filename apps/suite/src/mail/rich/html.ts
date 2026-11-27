/**
 * What is written in the editor, as it is sent: HTML with every style written inline (mail programs ignore style sheets and
 * classes) and the same content as plain text. Pictures travel as inline parts referred to by `cid:`.
 */
import { decodeBase64, type OutgoingAttachment } from '@suitenova/mail-core';
import { bakeFormulas } from '@suitenova/notes-core';
import { isSafeHref, isStyledTable, paletteOfDoc, parseMath, tableLooks, writerSchema } from '@suitenova/writer-core';
import { toUnicodeMath } from '@suitenova/math-core';
import { parseNumber, type CellLook } from '@suitenova/table-core';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { TableMap } from 'prosemirror-tables';

export interface Rendered {
  html: string;
  text: string;
  inline: OutgoingAttachment[];
  /** It has formatting, so it has to go as HTML; plain paragraphs are sent as text only. */
  rich: boolean;
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Runs of spaces are kept: HTML would join them. */
const spaces = (s: string): string => esc(s).replace(/ {2}/g, ' &nbsp;').replace(/^ /, '&nbsp;').replace(/ $/, '&nbsp;').replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');

/** `data:image/png;base64,…` as bytes; null for anything else. */
export function dataUrlBytes(src: string): { mime: string; data: Uint8Array } | null {
  const m = /^data:(image\/[a-z0-9+.-]+);base64,(.*)$/is.exec(src);
  return m ? { mime: m[1]!.toLowerCase(), data: decodeBase64(m[2]!) } : null;
}

const HEADINGS: Record<string, { tag: string; css: string }> = {
  Title: { tag: 'h1', css: "font-size:28pt;font-weight:normal;font-family:'Calibri Light',Calibri,sans-serif" },
  Heading1: { tag: 'h1', css: 'font-size:16pt;color:#2f5496' },
  Heading2: { tag: 'h2', css: 'font-size:13pt;color:#2f5496' },
  Heading3: { tag: 'h3', css: 'font-size:12pt;color:#1f3763' },
};

/** What the marks of a run of text say, from the outside in. */
function markHtml(marks: readonly Mark[], inner: string): { html: string; rich: boolean } {
  const css: string[] = [];
  let html = inner;
  let rich = false;
  const wrap = (open: string, close: string) => {
    html = `<${open}>${html}</${close}>`;
    rich = true;
  };
  for (const m of marks) {
    const v = m.attrs.value as string | number | undefined;
    switch (m.type.name) {
      case 'strong':
        wrap('b', 'b');
        break;
      case 'em':
        wrap('i', 'i');
        break;
      case 'underline':
        wrap('u', 'u');
        break;
      case 'strike':
      case 'dstrike':
        wrap('s', 's');
        break;
      case 'superscript':
        wrap('sup', 'sup');
        break;
      case 'subscript':
        wrap('sub', 'sub');
        break;
      case 'color':
        css.push(`color:${v}`);
        break;
      case 'highlight':
        css.push(`background-color:${v}`);
        break;
      case 'fontFamily':
        css.push(`font-family:'${String(v).replace(/['";]/g, '')}',sans-serif`);
        break;
      case 'fontSize':
        css.push(`font-size:${Number(v)}pt`);
        break;
      case 'caps':
        css.push(v === 'small' ? 'font-variant:small-caps' : 'text-transform:uppercase');
        break;
      case 'spacing':
        css.push(`letter-spacing:${Number(v)}pt`);
        break;
    }
  }
  if (css.length) wrap(`span style="${esc(css.join(';'))}"`, 'span');
  const link = marks.find((m) => m.type.name === 'link');
  const href = link ? String(link.attrs.href) : '';
  if (link && isSafeHref(href)) wrap(`a href="${esc(href)}"`, 'a');
  return { html, rich };
}

interface Out {
  html: string;
  text: string;
}

/** The plain text of what is written: cheap enough for every keystroke (the pictures are not decoded). */
export const textOf = (doc: PMNode): string => renderMail(doc, 'es', true).text;

export function renderMail(input: PMNode, locale: 'es' | 'en' = 'es', textOnly = false): Rendered {
  // table formulas are sent as their results
  const doc = writerSchema.nodeFromJSON(bakeFormulas(input.toJSON(), locale));
  const inline: OutgoingAttachment[] = [];
  const pictures = new Map<string, string>();
  const palette = paletteOfDoc(doc);
  let rich = false;

  const picture = (node: PMNode): Out => {
    const a = node.attrs as { src: string; alt?: string; width?: number | null; height?: number | null; edits?: { name?: string } | null };
    const name = a.edits?.name;
    const label = `[Imagen: ${a.alt || name || 'imagen'}]`;
    const found = textOnly ? null : dataUrlBytes(a.src);
    // only pictures that travel with the message: a remote one would tell its server when the message is read
    if (!found) return { html: esc(label), text: label };
    rich = true;
    let cid = pictures.get(a.src);
    if (!cid) {
      cid = `nova-${inline.length + 1}-${found.data.length.toString(36)}@suitenova`;
      pictures.set(a.src, cid);
      const ext = found.mime.split('/')[1]!.replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      inline.push({ filename: name || `imagen${inline.length + 1}.${ext}`, contentType: found.mime, data: found.data, contentId: cid });
    }
    const size = `${a.width ? ` width="${Math.round(a.width)}"` : ''}`;
    return { html: `<img src="cid:${cid}" alt="${esc(a.alt ?? '')}"${size} style="max-width:100%;height:auto">`, text: label };
  };

  const inlineContent = (node: PMNode): Out => {
    let html = '';
    let text = '';
    node.forEach((child) => {
      if (child.isText) {
        const done = markHtml(child.marks, spaces(child.text!));
        rich ||= done.rich;
        html += done.html;
        const link = child.marks.find((m) => m.type.name === 'link');
        const href = link ? String(link.attrs.href).replace(/^mailto:/i, '') : '';
        text += href && !href.includes(child.text!) && !child.text!.includes(href) ? `${child.text} <${href}>` : child.text;
      } else if (child.type.name === 'hard_break') {
        html += '<br>';
        text += '\n';
      } else if (child.type.name === 'image') {
        const p = picture(child);
        html += p.html;
        text += p.text;
      } else if (child.type.name === 'math') {
        let linear = String(child.attrs.tex ?? '');
        try {
          linear = toUnicodeMath(parseMath(linear));
        } catch {
          /* as it was written */
        }
        html += esc(linear);
        text += linear;
      } else {
        html += esc(child.textContent);
        text += child.textContent;
      }
    });
    return { html, text };
  };

  const paragraph = (node: PMNode, tight: boolean): Out => {
    const a = node.attrs as { style?: string | null; align?: string | null; indentLeft?: number; shade?: string | null };
    const heading = a.style ? HEADINGS[a.style] : undefined;
    const css = ['margin:0'];
    if (heading) css.push(heading.css);
    // left is how a line already reads: it is not formatting
    if (a.align && a.align !== 'left') css.push(`text-align:${a.align}`);
    if (a.indentLeft) css.push(`margin-left:${a.indentLeft}pt`);
    if (a.shade) css.push(`background-color:${a.shade}`);
    if (css.length > 1) rich = true;
    const c = inlineContent(node);
    const body = c.html || '<br>';
    const tag = heading?.tag ?? 'p';
    // inside a list item or a cell, a plain line needs no paragraph of its own
    return { html: tight && css.length === 1 ? body : `<${tag} style="${esc(css.join(';'))}">${body}</${tag}>`, text: c.text };
  };

  const list = (node: PMNode, ordered: boolean): Out => {
    rich = true;
    const start = ordered ? Number(node.attrs.start ?? 1) : 1;
    const format = String(node.attrs.format ?? 'decimal');
    const kind = ({ decimal: 'decimal', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman' } as Record<string, string>)[format] ?? 'decimal';
    const items: Out[] = [];
    node.forEach((item, _o, i) => {
      const parts = blocks(item, true);
      const mark = ordered ? `${start + i}. ` : '• ';
      items.push({ html: `<li>${parts.map((p) => p.html).join('')}</li>`, text: mark + parts.map((p) => p.text).join('\n').replace(/\n/g, `\n${' '.repeat(mark.length)}`) });
    });
    const tag = ordered ? 'ol' : 'ul';
    const attrs = ordered ? ` start="${start}" style="margin:0;padding-left:28px;list-style-type:${kind}"` : ' style="margin:0;padding-left:28px"';
    return { html: `<${tag}${attrs}>${items.map((i) => i.html).join('')}</${tag}>`, text: items.map((i) => i.text).join('\n') };
  };

  const table = (node: PMNode): Out => {
    rich = true;
    const map = TableMap.get(node);
    const looks: Map<number, CellLook> = isStyledTable(node) ? tableLooks(node, palette) : new Map();
    const rows: string[] = [];
    const cells: string[][] = [];
    node.forEach((row, rowOffset) => {
      const tds: string[] = [];
      const line: string[] = [];
      row.forEach((cell, cellOffset) => {
        const offset = rowOffset + 1 + cellOffset;
        const parts = blocks(cell, true);
        const words = parts.map((p) => p.text).join(' ').replace(/\n/g, ' ');
        line.push(words);
        const look = looks.get(offset);
        const numeric = words.trim() !== '' && parseNumber(words) !== null && /^[^A-Za-z]*$/.test(words);
        const css = ['padding:4px 8px', 'vertical-align:top'];
        if (look) {
          for (const side of ['t', 'r', 'b', 'l'] as const) {
            const b = look.borders[side];
            const name = { t: 'top', r: 'right', b: 'bottom', l: 'left' }[side];
            css.push(`border-${name}:${b && b.style !== 'none' ? `${Math.max(1, Math.round((b.width * 96) / 72))}px ${b.style === 'single' ? 'solid' : b.style} ${b.color}` : 'none'}`);
          }
          if (look.fill) css.push(`background-color:${look.fill}`);
          if (look.color) css.push(`color:${look.color}`);
          if (look.bold) css.push('font-weight:bold');
        } else css.push(node.attrs.borders === false ? 'border:none' : 'border:1px solid #999999');
        if (cell.attrs.background && !look) css.push(`background-color:${cell.attrs.background}`);
        if (numeric) css.push('text-align:right');
        const width = (cell.attrs.colwidth as number[] | null)?.reduce((a, b) => a + b, 0);
        if (width) css.push(`width:${width}px`);
        const tag = cell.type.name === 'table_header' ? 'th' : 'td';
        const span = `${cell.attrs.colspan > 1 ? ` colspan="${cell.attrs.colspan}"` : ''}${cell.attrs.rowspan > 1 ? ` rowspan="${cell.attrs.rowspan}"` : ''}`;
        tds.push(`<${tag}${span} style="${esc(css.join(';'))}">${parts.map((p) => p.html).join('') || '&nbsp;'}</${tag}>`);
      });
      rows.push(`<tr>${tds.join('')}</tr>`);
      cells.push(line);
    });
    // as text: columns padded to the same width, numbers to the right
    const widths = Array.from({ length: map.width }, (_x, c) => Math.max(1, ...cells.map((r) => [...(r[c] ?? '')].length)));
    const lines = cells.map((r) =>
      r
        .map((v, c) => {
          const gap = ' '.repeat(Math.max(0, widths[c]! - [...v].length));
          return /^[^A-Za-z]*\d[^A-Za-z]*$/.test(v) ? gap + v : v + gap;
        })
        .join(' | ')
        .trimEnd(),
    );
    return { html: `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tbody>${rows.join('')}</tbody></table>`, text: lines.join('\n') };
  };

  const block = (node: PMNode, tight: boolean): Out => {
    switch (node.type.name) {
      case 'paragraph':
        return paragraph(node, tight);
      case 'bullet_list':
        return list(node, false);
      case 'ordered_list':
        return list(node, true);
      case 'table':
        return table(node);
      case 'generated': {
        // the signature, and anything else that is a box of blocks
        const parts = blocks(node, false);
        const mark = node.attrs.kind === 'signature' ? ' data-nova-signature="1"' : '';
        return { html: `<div${mark}>${parts.map((p) => p.html).join('')}</div>`, text: parts.map((p) => p.text).join('\n') };
      }
      default: {
        if (!node.childCount) return { html: '', text: node.textContent };
        const parts = blocks(node, false);
        return { html: parts.map((p) => p.html).join(''), text: parts.map((p) => p.text).join('\n') };
      }
    }
  };

  function blocks(parent: PMNode, tight: boolean): Out[] {
    const out: Out[] = [];
    // a cell or an item with more than one line keeps them as paragraphs
    const lone = tight && parent.childCount === 1;
    parent.forEach((child) => void out.push(block(child, lone)));
    return out;
  }

  const parts = blocks(doc, false);
  return { html: parts.map((p) => p.html).join(''), text: parts.map((p) => p.text).join('\n'), inline, rich };
}
