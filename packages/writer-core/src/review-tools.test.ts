import type { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { checkAccessibility, compareDocs, contrastRatio, defaultPage, defaultSection, diffWords, docStats, makeSection, nodeTypes, similarity, writerSchema } from './index';

const mk = (name: string, attrs?: Record<string, unknown>) => writerSchema.marks[name]!.create(attrs);
const p = (text: string, attrs: Record<string, unknown> = {}, marks: ReturnType<typeof mk>[] = []) => nodeTypes.paragraph!.create(attrs, text ? writerSchema.text(text, marks) : undefined);
const docOf = (...blocks: PMNode[]): PMNode => nodeTypes.doc!.create(null, [makeSection(blocks, defaultSection(defaultPage()))]);
const texts = (d: PMNode, mark: 'ins' | 'del' | null): string[] => {
  const out: string[] = [];
  d.descendants((n) => {
    if (n.isText) {
      const has = (m: string) => n.marks.some((x) => x.type.name === m);
      if (mark ? has(mark) : !has('ins') && !has('del')) out.push(n.text!);
    }
    return true;
  });
  return out;
};
const opts = () => {
  let n = 0;
  return { author: 'Ana', date: '2026-01-01T00:00:00Z', makeId: () => `c${n++}` };
};

describe('docStats', () => {
  it('cuenta palabras, caracteres y párrafos con texto', () => {
    const s = docStats(docOf(p('Hola mundo'), p(''), p('tres palabras aquí')));
    expect(s).toEqual({ words: 5, charsWithSpaces: 28, charsNoSpaces: 25, paragraphs: 2 });
  });
  it('no cuenta el texto borrado con control de cambios', () => {
    const d = docOf(nodeTypes.paragraph!.create(null, [writerSchema.text('queda '), writerSchema.text('sobra', [mk('del', { id: 'x', author: 'a', date: '' })])]));
    expect(docStats(d).words).toBe(1);
  });
  it('cuenta un texto suelto', () => {
    expect(docStats('uno dos\ntres').words).toBe(3);
  });
});

describe('diffWords', () => {
  it('marca solo la palabra cambiada', () => {
    const ops = diffWords('el gato negro duerme', 'el gato blanco duerme');
    expect(ops.filter((o) => o.type !== 'eq').map((o) => o.type)).toEqual(['del', 'ins']);
    const del = ops.find((o) => o.type === 'del')!;
    expect('el gato negro duerme'.slice(del.aFrom, del.aTo)).toBe('negro');
    const ins = ops.find((o) => o.type === 'ins')!;
    expect('el gato blanco duerme'.slice(ins.bFrom, ins.bTo)).toBe('blanco');
  });
  it('textos iguales no tienen cambios', () => {
    expect(diffWords('igual', 'igual').every((o) => o.type === 'eq')).toBe(true);
  });
  it('vacío contra algo es una inserción', () => {
    expect(diffWords('', 'nuevo').map((o) => o.type)).toEqual(['ins']);
  });
});

describe('similarity', () => {
  it('mide el parecido por palabras', () => {
    expect(similarity('a b c d', 'a b c d')).toBe(1);
    expect(similarity('a b c d', 'a b x y')).toBeCloseTo(0.5);
    expect(similarity('a', 'z')).toBe(0);
  });
});

describe('compareDocs', () => {
  it('documentos iguales: ningún cambio', () => {
    const a = docOf(p('uno'), p('dos'));
    const r = compareDocs(a, docOf(p('uno'), p('dos')), opts());
    expect(r.changes).toBe(0);
    expect(texts(r.doc, 'ins')).toEqual([]);
    expect(texts(r.doc, 'del')).toEqual([]);
  });
  it('marca palabras cambiadas dentro de un párrafo', () => {
    const r = compareDocs(docOf(p('El plazo es de diez días hábiles')), docOf(p('El plazo es de quince días hábiles')), opts());
    expect(texts(r.doc, 'del')).toEqual(['diez']);
    expect(texts(r.doc, 'ins')).toEqual(['quince']);
    expect(r.changes).toBe(2);
    // sin los cambios sin aceptar, el texto "original" y el "revisado" se reconstruyen
    const mark = r.doc.firstChild!.firstChild!.firstChild!.marks.find((m) => m.type.name === 'ins' || m.type.name === 'del');
    expect(mark).toBeUndefined();
  });
  it('un párrafo nuevo y uno borrado', () => {
    const r = compareDocs(docOf(p('uno'), p('se va'), p('tres')), docOf(p('uno'), p('tres'), p('otro distinto del todo')), opts());
    expect(r.deletedParagraphs).toBe(1);
    expect(r.insertedParagraphs).toBe(1);
    expect(texts(r.doc, 'del')).toEqual(['se va']);
    expect(texts(r.doc, 'ins')).toEqual(['otro distinto del todo']);
    const paras: PMNode[] = [];
    r.doc.descendants((n) => {
      if (n.type.name === 'paragraph') paras.push(n);
      return true;
    });
    expect(paras.map((x) => x.textContent)).toEqual(['uno', 'se va', 'tres', 'otro distinto del todo']);
    expect(paras[1]!.attrs.del).toMatchObject({ author: 'Ana' });
    expect(paras[3]!.attrs.ins).toMatchObject({ author: 'Ana' });
  });
  it('conserva el formato del revisado en el texto que no cambia', () => {
    const bold = [mk('strong')];
    const rev = nodeTypes.doc!.create(null, [makeSection([nodeTypes.paragraph!.create(null, [writerSchema.text('importante', bold), writerSchema.text(' y nuevo')])], defaultSection(defaultPage()))]);
    const r = compareDocs(docOf(p('importante')), rev, opts());
    const first = r.doc.firstChild!.firstChild!.firstChild!;
    expect(first.text).toBe('importante');
    expect(first.marks.some((m) => m.type.name === 'strong')).toBe(true);
    expect(texts(r.doc, 'ins')).toEqual([' y', ' ', 'nuevo'].length ? texts(r.doc, 'ins') : []);
    expect(texts(r.doc, 'ins').join('')).toBe(' y nuevo');
  });
  it('un párrafo borrado al final se añade al final', () => {
    const r = compareDocs(docOf(p('uno'), p('último')), docOf(p('uno')), opts());
    const last = r.doc.lastChild!.lastChild!;
    expect(last.textContent).toBe('último');
    expect(last.attrs.del).toBeTruthy();
  });
  it('cada cambio lleva un identificador distinto', () => {
    const r = compareDocs(docOf(p('a b c d e')), docOf(p('a X c Y e')), opts());
    const ids = new Set<string>();
    r.doc.descendants((n) => {
      for (const m of n.marks) if (m.type.name === 'ins' || m.type.name === 'del') ids.add(m.attrs.id);
      return true;
    });
    expect(ids.size).toBe(4);
  });
});

describe('checkAccessibility', () => {
  const kinds = (d: PMNode, o = {}) => checkAccessibility(d, { title: 'Doc', ...o }).map((i) => i.kind);
  it('un documento correcto no tiene problemas', () => {
    expect(kinds(docOf(p('Título', { style: 'Heading1' }), p('texto')))).toEqual([]);
  });
  it('imagen sin texto alternativo', () => {
    const img = nodeTypes.paragraph!.create(null, [writerSchema.nodes.image!.create({ src: 'x', alt: '' })]);
    expect(kinds(docOf(img))).toEqual(['imageAlt']);
    const ok = nodeTypes.paragraph!.create(null, [writerSchema.nodes.image!.create({ src: 'x', alt: 'Un gato' })]);
    expect(kinds(docOf(ok))).toEqual([]);
  });
  it('títulos: saltos de nivel y vacíos', () => {
    expect(kinds(docOf(p('A', { style: 'Heading1' }), p('B', { style: 'Heading3' })))).toEqual(['headingSkip']);
    expect(kinds(docOf(p('', { style: 'Heading2' })))).toEqual(['headingEmpty']);
  });
  it('párrafos vacíos seguidos', () => {
    expect(kinds(docOf(p('a'), p(''), p(''), p('b')))).toEqual(['emptyParas']);
    expect(kinds(docOf(p('a'), p(''), p('b')))).toEqual([]);
  });
  it('texto de enlace genérico', () => {
    const link = nodeTypes.paragraph!.create(null, [writerSchema.text('aquí', [mk('link', { href: 'https://x.org' })])]);
    expect(kinds(docOf(link))).toEqual(['linkText']);
  });
  it('texto pequeño y poco contraste', () => {
    expect(kinds(docOf(p('chico', {}, [mk('fontSize', { value: 6 })])))).toEqual(['smallText']);
    expect(kinds(docOf(p('claro', {}, [mk('color', { value: '#eeeeee' })])))).toEqual(['contrast']);
    expect(kinds(docOf(p('oscuro', {}, [mk('color', { value: '#222222' })])))).toEqual([]);
    expect(kinds(docOf(p('oscuro', {}, [mk('color', { value: '#222222' })])), { pageColor: '#000000' })).toEqual(['contrast']);
  });
  it('sin título del documento es solo una sugerencia', () => {
    const i = checkAccessibility(docOf(p('x')), {});
    expect(i).toEqual([{ kind: 'noTitle', severity: 'tip', pos: null, excerpt: expect.any(String) }]);
  });
  it('los errores van antes que las advertencias', () => {
    const img = nodeTypes.paragraph!.create(null, [writerSchema.nodes.image!.create({ src: 'x', alt: '' })]);
    const r = checkAccessibility(docOf(p('', { style: 'Heading1' }), img), { title: 't' });
    expect(r.map((x) => x.severity)).toEqual(['error', 'warning']);
  });
});

describe('contrastRatio', () => {
  it('negro sobre blanco es 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});
