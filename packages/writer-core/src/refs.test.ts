import { describe, expect, it } from 'vitest';
import { bibliographyEntry, citationText, emptySource, sortSources } from './citations';
import { buildBibliographyContent, buildIndexContent, buildTocContent, collectBookmarks, collectCaptions, collectHeadings, collectIndexEntries, computeFieldResults, defaultTocOptions, tocInstr, tocOptionsOf, type RefContext } from './refs';
import { defaultSection, makeSection, nodeTypes, plainText, writerSchema } from './index';

const t = (s: string) => writerSchema.text(s);
const p = (kids: any[] | string, attrs: Record<string, unknown> = {}) => nodeTypes.paragraph!.create(attrs, (Array.isArray(kids) ? kids : [kids]).map((k) => (typeof k === 'string' ? t(k) : k)));
const doc = (...blocks: any[]) => nodeTypes.doc!.create(null, [makeSection(blocks, defaultSection())]);
const field = (kind: string, arg: string | null = null, result: string | null = null, switches: string | null = null) => nodeTypes.field!.create({ kind, arg, result, switches });
const bm = (name: string) => nodeTypes.bookmark!.create({ name });
const ctx = (over: Partial<RefContext> = {}): RefContext => ({ pageOf: () => '1', textWidthPt: 451, sources: [], citeStyle: 'apa', noteLabel: () => null, ...over });

const SMITH = { ...emptySource('Smith2020'), authors: ['Smith, John'], title: 'Un libro importante', year: '2020', publisher: 'Editorial Uno', city: 'Madrid' };
const LOPEZ = { ...emptySource('Lopez2018'), type: 'article' as const, authors: ['López, Ana María', 'Pérez, Luis'], title: 'Un artículo', year: '2018', journal: 'Revista de Estudios', volume: '12', issue: '3', pages: '45-67', doi: '10.1000/xyz' };

describe('citas y bibliografía', () => {
  it('texto de la cita en cada estilo', () => {
    expect(citationText(SMITH, 'apa')).toBe('(Smith, 2020)');
    expect(citationText(SMITH, 'apa', { pages: '15' })).toBe('(Smith, 2020, p. 15)');
    expect(citationText(SMITH, 'apa', { pages: '15-20' })).toBe('(Smith, 2020, pp. 15-20)');
    expect(citationText(LOPEZ, 'apa')).toBe('(López y Pérez, 2018)');
    expect(citationText(SMITH, 'mla', { pages: '15' })).toBe('(Smith 15)');
    expect(citationText(SMITH, 'chicago')).toBe('(Smith 2020)');
    expect(citationText(SMITH, 'ieee', {}, 3)).toBe('[3]');
    expect(citationText(SMITH, 'apa', { suppressAuthor: true })).toBe('(2020)');
  });
  it('entradas de bibliografía', () => {
    expect(bibliographyEntry(SMITH, 'apa')).toBe('Smith, J. (2020). Un libro importante. Editorial Uno.');
    expect(bibliographyEntry(LOPEZ, 'apa')).toContain('López, A. M., & Pérez, L. (2018). Un artículo. Revista de Estudios, 12(3), 45-67. https://doi.org/10.1000/xyz');
    expect(bibliographyEntry(SMITH, 'mla')).toBe('Smith, John. Un libro importante. Editorial Uno, 2020.');
    expect(bibliographyEntry(SMITH, 'ieee', 2)).toBe('[2] J. Smith, “Un libro importante,” Madrid: Editorial Uno, 2020.');
    expect(bibliographyEntry(SMITH, 'iso690', 1)).toContain('SMITH, John. Un libro importante.');
  });
  it('orden: alfabético o por primera cita', () => {
    expect(sortSources([SMITH, LOPEZ], 'apa', []).map((s) => s.tag)).toEqual(['Lopez2018', 'Smith2020']);
    expect(sortSources([SMITH, LOPEZ], 'ieee', ['Smith2020', 'Lopez2018']).map((s) => s.tag)).toEqual(['Smith2020', 'Lopez2018']);
  });
});

describe('referencias', () => {
  const d = doc(
    p([bm('_Toc1'), t('Introducción')], { style: 'Heading1' }),
    p('Texto'),
    p([t('Capítulo dos')], { style: 'Heading1' }),
    p([t('Subtítulo')], { style: 'Heading2' }),
    p([bm('_Ref_fig1'), t('Figura '), field('seq', 'Figura', '9'), t(': Un gráfico')], { style: 'Caption' }),
    p([t('Véase '), field('ref', '_Ref_fig1', null, '\\n \\h'), t(' y '), field('ref', '_Toc1', null, '\\h'), t(' en la pág. '), field('pageref', '_Toc1')]),
    p([t('Otra '), field('seq', 'Figura'), t(' y una '), field('seq', 'Tabla')], { style: 'Caption' }),
  );

  it('títulos, marcadores y leyendas', () => {
    const h = collectHeadings(d, 1, 2);
    expect(h.map((x) => [x.level, x.text, x.bookmark])).toEqual([[1, 'Introducción', '_Toc1'], [1, 'Capítulo dos', null], [2, 'Subtítulo', null]]);
    expect(collectHeadings(d, 1, 1)).toHaveLength(2);
    expect(collectBookmarks(d).get('_Ref_fig1')!.text).toBe('Figura 9: Un gráfico');
    const caps = collectCaptions(d);
    expect(caps.map((c) => [c.label, c.number])).toEqual([['Figura', 1], ['Figura', 2], ['Tabla', 1]]);
    expect(collectCaptions(d, 'Tabla')).toHaveLength(1);
  });

  it('los campos recalculan su resultado', () => {
    const res = computeFieldResults(d, ctx({ pageOf: (pos) => (pos < 20 ? '1' : '3') }));
    const byKind = (kind: string): string[] => {
      const out: string[] = [];
      d.descendants((n, pos) => {
        if (n.type.name === 'field' && n.attrs.kind === kind) out.push(res.get(pos) ?? '∅');
        return true;
      });
      return out;
    };
    expect(byKind('seq')).toEqual(['1', '2', '1']);
    expect(byKind('ref')).toEqual(['Figura 1', 'Introducción']);
    expect(byKind('pageref')).toEqual(['1']);
  });

  it('una tabla de contenido con tabulación derecha, relleno y enlaces', () => {
    const entries = collectHeadings(d, 1, 2).map((h, i) => ({ ...h, bookmark: h.bookmark ?? `_Toc${i + 10}` }));
    const content = buildTocContent(entries, defaultTocOptions(), ctx({ pageOf: (pos) => String(1 + Math.floor(pos / 40)) }));
    expect(content[0]!.attrs.style).toBe('TOCHeading');
    expect(content).toHaveLength(4);
    const e = content[1]!;
    expect(e.attrs.style).toBe('TOC1');
    expect(e.attrs.tabs).toEqual([{ pos: 451, kind: 'right', leader: 'dot' }]);
    expect(e.textContent).toContain('Introducción\t');
    expect(e.firstChild!.marks[0]!.attrs.href).toBe('#_Toc1');
    expect(content[3]!.attrs.style).toBe('TOC2');
    const noPages = buildTocContent(entries, { ...defaultTocOptions(), pageNumbers: false, title: null }, ctx());
    expect(noPages[0]!.textContent).toBe('Introducción');
  });

  it('las opciones de la tabla viajan en la instrucción del campo', () => {
    const o = { ...defaultTocOptions(), minLevel: 2, maxLevel: 4, pageNumbers: false, hyperlinks: false };
    const back = tocOptionsOf({ opts: { instr: tocInstr(o) } });
    expect(back).toMatchObject({ minLevel: 2, maxLevel: 4, pageNumbers: false, hyperlinks: false });
  });

  it('bibliografía con las fuentes citadas y citas con varias fuentes', () => {
    const dd = doc(p([t('Según '), field('citation', 'Smith2020'), t(' y '), field('citation', 'Lopez2018;Smith2020')]));
    const c = ctx({ sources: [SMITH, LOPEZ], citeStyle: 'apa' });
    const res = computeFieldResults(dd, c);
    const texts: string[] = [];
    dd.descendants((n, pos) => {
      if (n.type.name === 'field') texts.push(res.get(pos)!);
      return true;
    });
    expect(texts).toEqual(['(Smith, 2020)', '(López y Pérez, 2018; Smith, 2020)']);
    const bib = buildBibliographyContent(dd, c);
    expect(bib[0]!.textContent).toBe('Referencias');
    expect(bib).toHaveLength(3);
    expect(bib[1]!.textContent.startsWith('López')).toBe(true);
    expect(bib[1]!.attrs.indentFirst).toBe(-36);
    const ieee = ctx({ sources: [SMITH, LOPEZ], citeStyle: 'ieee' });
    const numeric = computeFieldResults(dd, ieee);
    const nums: string[] = [];
    dd.descendants((n, pos) => {
      if (n.type.name === 'field') nums.push(numeric.get(pos)!);
      return true;
    });
    expect(nums).toEqual(['[1]', '[2, 1]']);
  });

  it('índice alfabético con subentradas y páginas agrupadas', () => {
    const dd = doc(
      p([t('uno '), field('xe', 'Gatos')]),
      p([t('dos '), field('xe', 'Gatos')]),
      p([t('tres '), field('xe', 'Gatos:Siameses')]),
      p([t('cuatro '), field('xe', 'Árboles')]),
      p([t('cinco '), field('xe', 'Perros', null, '\\t "Véase Canes"')]),
    );
    const pages = [1, 2, 3, 7, 9];
    const entries = collectIndexEntries(dd);
    expect(entries).toHaveLength(5);
    let k = 0;
    const content = buildIndexContent(entries, ctx({ pageOf: () => String(pages[k++ % 5]) }));
    const lines = content.map((n) => n.textContent);
    expect(lines).toContain('Gatos, 1, 2');
    expect(lines.some((l) => l.startsWith('Siameses, 3'))).toBe(true);
    expect(lines).toContain('Perros, Véase Canes');
    expect(lines.indexOf('Á')).toBeLessThan(lines.indexOf('G'));
    void plainText;
  });
});
