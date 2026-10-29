import type { Node as PMNode } from 'prosemirror-model';
import { contentNode, displayTitle, textContainers, type Page } from './model';
import { findTag, isDone, normalizeTag } from './tags';

const esc = (s: string) => s.replace(/([\\`*_{}[\]<>#|])/g, '\\$1');

function inline(p: PMNode): string {
  let out = '';
  p.forEach((c) => {
    if (c.type.name === 'hard_break') out += '  \n';
    else if (c.type.name === 'image') out += `![${esc(c.attrs.alt ?? '')}](${c.attrs.src.startsWith('data:') ? 'imagen-incrustada' : c.attrs.src})`;
    else if (c.isText) {
      let t = esc(c.text!);
      const has = (n: string) => c.marks.some((m) => m.type.name === n);
      const lead = /^\s*/.exec(t)![0];
      const trail = /\s*$/.exec(t)![0];
      let core = t.trim();
      if (!core) {
        out += t;
        return;
      }
      if (has('strong')) core = `**${core}**`;
      if (has('em')) core = `*${core}*`;
      if (has('strike')) core = `~~${core}~~`;
      const link = c.marks.find((m) => m.type.name === 'link');
      if (link) core = `[${core}](${link.attrs.href})`;
      t = lead + core + trail;
      out += t;
    }
  });
  return out;
}

const HEAD: Record<string, number> = { Title: 1, Heading1: 1, Heading2: 2, Heading3: 3, Heading4: 4, Heading5: 5, Heading6: 6 };

function block(n: PMNode, indent: string, lines: string[]): void {
  switch (n.type.name) {
    case 'paragraph': {
      const text = inline(n);
      const tag = normalizeTag(n.attrs.tag as string | null);
      const def = findTag(tag);
      const prefix = !tag ? '' : def?.checkbox ? (isDone(tag) ? '- [x] ' : '- [ ] ') : def ? `**(${def.symbol})** ` : '';
      const h = HEAD[n.attrs.style ?? ''];
      if (h && !prefix) lines.push(indent + '#'.repeat(h) + ' ' + text, '');
      else lines.push(indent + prefix + text, '');
      break;
    }
    case 'bullet_list':
    case 'ordered_list': {
      const ordered = n.type.name === 'ordered_list';
      let i = ordered ? (n.attrs.start as number) : 0;
      n.forEach((li) => {
        li.forEach((c, _o, idx) => {
          if (idx === 0 && c.type.name === 'paragraph') {
            const tag = normalizeTag(c.attrs.tag as string | null);
            const box = tag && findTag(tag)?.checkbox ? (isDone(tag) ? '[x] ' : '[ ] ') : '';
            lines.push(`${indent}${ordered ? `${i++}.` : '-'} ${box}${inline(c)}`);
          } else block(c, indent + '  ', lines);
        });
      });
      lines.push('');
      break;
    }
    case 'table': {
      const rows: string[][] = [];
      n.forEach((r) => {
        const cells: string[] = [];
        r.forEach((c) => cells.push(c.textContent.replace(/\|/g, '\\|').replace(/\n/g, ' ')));
        rows.push(cells);
      });
      if (!rows.length) break;
      const w = Math.max(...rows.map((r) => r.length));
      const pad = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`;
      lines.push(pad(rows[0]!), `|${' --- |'.repeat(w)}`, ...rows.slice(1).map(pad), '');
      break;
    }
    case 'page_break':
      lines.push('---', '');
      break;
  }
}

export function docToMarkdown(doc: PMNode): string {
  const lines: string[] = [];
  doc.forEach((n) => block(n, '', lines));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** La página en Markdown: sus cuadros de texto en orden de lectura. Las imágenes, la tinta y las grabaciones no caben en Markdown: se anotan. */
export function pageToMarkdown(page: Page): string {
  const parts = textContainers(page).map((c) => docToMarkdown(contentNode(c.content)).trim()).filter(Boolean);
  const other = page.containers.filter((c) => c.kind !== 'text').length + (page.ink.length ? 1 : 0);
  if (other) parts.push(`_(La página tiene ${other} elemento(s) que Markdown no admite: imágenes, tinta o grabaciones.)_`);
  return `# ${esc(displayTitle(page))}\n\n${parts.join('\n\n')}\n`;
}
