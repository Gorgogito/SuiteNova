import { nodeTypes, writerSchema } from '@suitenova/writer-core';
import { EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { buildCover, coverEnd, COVERS, insertCover, removeCover } from './cover';
import { numberLines } from './LineNumbers';

const text = { title: 'Informe', subtitle: 'Anual', author: 'Ana', date: '1 de enero' };
const state = (...t: string[]) =>
  EditorState.create({ schema: writerSchema, doc: nodeTypes.doc!.create(null, [nodeTypes.section!.create({ id: 's' }, t.map((x) => nodeTypes.paragraph!.create(null, x ? writerSchema.text(x) : undefined)))]) });
const run = (s: EditorState, cmd: (st: EditorState, d?: (tr: Transaction) => void) => boolean): EditorState => {
  let out = s;
  expect(cmd(s, (tr) => (out = s.apply(tr)))).toBe(true);
  return out;
};
const blocks = (s: EditorState) => {
  const out: string[] = [];
  s.doc.firstChild!.forEach((b) => out.push(b.type.name === 'page_break' ? '<salto>' : `${b.attrs.style ?? ''}:${b.textContent}`));
  return out;
};

describe('portadas', () => {
  it('cada diseño termina con un salto de página y usa los estilos de portada', () => {
    for (const cv of COVERS) {
      const b = buildCover(cv.id, text);
      expect(b[b.length - 1]!.type.name, cv.id).toBe('page_break');
      expect(b[0]!.attrs.style).toBe('CoverTitle');
      expect(b[0]!.textContent).toBe('Informe');
    }
  });
  it('se inserta al principio y sustituye a la portada anterior', () => {
    let s = run(state('Texto uno', 'Texto dos'), insertCover('classic', text));
    expect(blocks(s)).toEqual(['CoverTitle:Informe', 'CoverSubtitle:Anual', 'CoverMeta:Ana', 'CoverMeta:1 de enero', '<salto>', ':Texto uno', ':Texto dos']);
    expect(coverEnd(s)).not.toBeNull();
    s = run(s, insertCover('band', { ...text, title: 'Otro' }));
    expect(blocks(s).filter((x) => x.startsWith('CoverTitle'))).toEqual(['CoverTitle:Otro']);
    expect(blocks(s).slice(-2)).toEqual([':Texto uno', ':Texto dos']);
  });
  it('quitar la portada deja solo el texto; sin portada no hace nada', () => {
    const s = run(run(state('Cuerpo'), insertCover('modern', text)), removeCover);
    expect(blocks(s)).toEqual([':Cuerpo']);
    expect(removeCover(s)).toBe(false);
    expect(coverEnd(s)).toBeNull();
  });
  it('un documento que solo empieza con un título normal no se toma por portada', () => {
    const s = state('Título', 'Más');
    expect(coverEnd(s)).toBeNull();
  });
});

describe('números de línea', () => {
  const lines = (n: number, y0: number) => Array.from({ length: n }, (_x, i) => ({ top: y0 + i * 20, left: 100, height: 18 }));
  const pageOf = (top: number) => (top < 100 ? 0 : 1);
  const ln = (o: Partial<{ countBy: number; start: number; restart: 'newPage' | 'newSection' | 'continuous'; distance: number }> = {}) => ({ countBy: 1, start: 1, restart: 'newPage' as const, distance: 18, ...o });
  it('reinicia en cada página', () => {
    const m = numberLines([{ props: ln(), lines: [...lines(3, 10), ...lines(2, 110)] }], pageOf);
    expect(m.map((x) => x.text)).toEqual(['1', '2', '3', '1', '2']);
  });
  it('continuo, de cinco en cinco y empezando en otro número', () => {
    const m = numberLines([{ props: ln({ restart: 'continuous', countBy: 5, start: 3 }), lines: [...lines(4, 10), ...lines(4, 110)] }], pageOf);
    expect(m.map((x) => x.text)).toEqual(['5', '10']);
  });
  it('reinicia en cada sección y salta las que no numeran', () => {
    const m = numberLines(
      [
        { props: ln({ restart: 'newSection' }), lines: lines(2, 10) },
        { props: null, lines: lines(5, 60) },
        { props: ln({ restart: 'newSection' }), lines: lines(2, 110) },
      ],
      pageOf,
    );
    expect(m.map((x) => x.text)).toEqual(['1', '2', '1', '2']);
  });
});
