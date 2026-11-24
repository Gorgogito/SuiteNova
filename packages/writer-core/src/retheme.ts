import { resolveRef, type DocTheme } from '@suitenova/theme-core';
import { Fragment, type Mark, type Node as PMNode } from 'prosemirror-model';
import type { Transform } from 'prosemirror-transform';

/*
 * What a document shows for the colours and fonts that point at its theme: when the theme changes, the marks and shadings that
 * point at it get the value they have for the new one (the ones with a fixed colour or font stay as they are).
 */

/** The mark with the value it has for `theme`, or null when it does not point at the theme or already has it. */
export function themedMark(m: Mark, theme: DocTheme): Mark | null {
  if (m.type.name === 'color' && m.attrs.ref) {
    const v = resolveRef(theme, m.attrs.ref);
    return v === m.attrs.value ? null : m.type.create({ ...m.attrs, value: v });
  }
  if (m.type.name === 'fontFamily' && m.attrs.theme) {
    const v = theme.fonts[m.attrs.theme as 'major' | 'minor'].latin;
    return v === m.attrs.value ? null : m.type.create({ ...m.attrs, value: v });
  }
  return null;
}

/** The shading of a paragraph for `theme`, or null when it does not point at it or already has it. */
export function themedShade(attrs: Record<string, unknown>, theme: DocTheme): string | null {
  const ref = attrs.shadeRef as Parameters<typeof resolveRef>[1] | null | undefined;
  if (!ref) return null;
  const v = resolveRef(theme, ref);
  return v === attrs.shade ? null : v;
}

/** Writes the new theme in the document and gives every colour and font that points at it the value it has for it; one step of the undo. */
export function applyThemeTo<T extends Transform>(tr: T, theme: DocTheme): T {
  const marks: { from: number; to: number; old: Mark; next: Mark }[] = [];
  const shades: { pos: number; value: string }[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.isText) {
      for (const m of node.marks) {
        const next = themedMark(m, theme);
        if (next) marks.push({ from: pos, to: pos + node.nodeSize, old: m, next });
      }
    } else {
      const v = themedShade(node.attrs, theme);
      if (v) shades.push({ pos, value: v });
    }
  });
  // none of these changes the size of anything, so the positions stay as they were
  for (const x of marks) tr.removeMark(x.from, x.to, x.old).addMark(x.from, x.to, x.next);
  for (const x of shades) tr.setNodeAttribute(x.pos, 'shade', x.value);
  tr.setDocAttribute('theme', theme);
  return tr;
}

/** The same content with the values of the theme (for headers, footers and other parts that are not in the history). */
export function rethemeNode(node: PMNode, theme: DocTheme): PMNode {
  if (node.isText) {
    const marks = node.marks.map((m) => themedMark(m, theme) ?? m);
    return marks.some((m, i) => m !== node.marks[i]) ? node.mark(marks) : node;
  }
  const shade = themedShade(node.attrs, theme);
  const kids: PMNode[] = [];
  node.content.forEach((c) => kids.push(rethemeNode(c, theme)));
  return node.type.create(shade ? { ...node.attrs, shade } : node.attrs, Fragment.fromArray(kids), node.marks);
}
