import { docOf, nodeTypes, writerSchema } from '@suitenova/writer-core';
import { reviewDoc, type Issue, type ReviewCtx } from './review';

/**
 * Revisa un texto sin formato (un `<textarea>`, una celda): el mismo motor que los documentos, con una línea por párrafo. Las posiciones de
 * los problemas y de sus correcciones son desplazamientos dentro del texto.
 */
export function reviewPlainText(text: string, ctx: ReviewCtx): Issue[] {
  if (!text.trim()) return [];
  const lines = text.split('\n');
  const doc = docOf(lines.map((l) => nodeTypes.paragraph!.create(null, l ? writerSchema.text(l) : undefined)));
  // dónde empieza el contenido de cada párrafo en el documento y cada línea en el texto
  const starts: { doc: number; text: number; len: number }[] = [];
  // `docOf` puede envolver los párrafos en una sección: se parte de donde está el primero
  let d = 0;
  doc.descendants((n, pos) => {
    if (n.isTextblock && d === 0 && pos >= 0 && !starts.length) d = pos;
    return !n.isTextblock;
  });
  let t = 0;
  for (const l of lines) {
    starts.push({ doc: d + 1, text: t, len: l.length });
    d += l.length + 2;
    t += l.length + 1;
  }
  const back = (pos: number): number => {
    for (let i = starts.length - 1; i >= 0; i--) if (pos >= starts[i]!.doc) return starts[i]!.text + Math.min(pos - starts[i]!.doc, starts[i]!.len);
    return 0;
  };
  return reviewDoc(doc, ctx).map((i) => ({ ...i, from: back(i.from), to: back(i.to), fixes: i.fixes.map((f) => ({ ...f, from: back(f.from), to: back(f.to) })) }));
}

/** Aplica una corrección a un texto sin formato. */
export const applyFixToText = (text: string, f: { from: number; to: number; text: string }): string => text.slice(0, f.from) + f.text + text.slice(f.to);
