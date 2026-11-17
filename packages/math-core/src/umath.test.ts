import { describe, expect, it } from 'vitest';
import { ommlXml, parseMath, parseOmmlXml, parseUnicodeMath, toMathML, toTex, toUnicodeMath, type MNode } from './index';
import { parseXml } from './xml';

const j = (n: MNode) => JSON.stringify(n);
const r = String.raw;

describe('formato lineal de Word (UnicodeMath)', () => {
  it('fracciones, escrituras y raíces', () => {
    expect(toTex(parseUnicodeMath('a/b')).trim()).toBe(r`\frac{a}{b}`);
    expect(toTex(parseUnicodeMath('(a+b)/c')).trim()).toBe(r`\frac{a+b}{c}`);
    expect(toTex(parseUnicodeMath('x^2+y_i^2'))).toBe(r`x^2+y_i^2`);
    expect(toTex(parseUnicodeMath('x^(n+1)'))).toBe(r`x^{n+1}`);
    expect(toTex(parseUnicodeMath('√(x+1)'))).toBe(r`\sqrt{x+1}`);
    expect(toTex(parseUnicodeMath('∛(8)'))).toBe(r`\sqrt[3]{8}`);
    expect(toTex(parseUnicodeMath('√(n&x)'))).toBe(r`\sqrt[n]{x}`);
    expect(toTex(parseUnicodeMath('ab/c'))).toBe(r`\frac{ab}{c}`);
  });

  it('sumatorias, integrales, funciones y letras griegas', () => {
    const sum = parseUnicodeMath('∑_(i=1)^n▒i^2');
    expect(j(sum)).toContain('"t":"nary"');
    expect(toTex(sum).replace(/\s+/g, '')).toBe(r`\sum_{i=1}^ni^2`);
    const int = parseUnicodeMath('∫_0^1 x dx');
    expect(j(int)).toContain('"op":"∫"');
    expect(j(int)).toContain('"limits":false');
    expect(toTex(parseUnicodeMath('sin x')).trim()).toBe(r`\sin x`);
    expect(toTex(parseUnicodeMath('lim_(x→0) f')).replace(/\s+/g, '')).toBe(r`\lim_{x\rightarrow0}f`);
    expect(toTex(parseUnicodeMath(r`\alpha + \beta`)).replace(/\s+/g, '')).toBe(r`\alpha+\beta`);
  });

  it('paréntesis, matrices, ecuaciones alineadas, acentos y recuadros', () => {
    const f = parseUnicodeMath('(a+b)^2');
    expect(j(f)).toContain('"t":"sup"');
    expect(j(f)).toContain('"t":"fenced"');
    const m = parseUnicodeMath('■(a&b@c&d)');
    expect(m).toMatchObject({ t: 'matrix', rows: [[{ t: 'id' }, { t: 'id' }], [{ t: 'id' }, { t: 'id' }]] });
    expect(parseUnicodeMath('█(x=1@y=2)')).toMatchObject({ t: 'eqarr' });
    expect(parseUnicodeMath('x̂')).toMatchObject({ t: 'acc', ch: '̂' });
    expect(parseUnicodeMath('[a,b)')).toMatchObject({ t: 'fenced', open: '[', close: ')' });
    expect(parseUnicodeMath('▭(x)')).toMatchObject({ t: 'box', border: true });
    expect(parseUnicodeMath('x┴y')).toMatchObject({ t: 'limit', top: true });
  });

  it('alfanuméricos matemáticos son letras con estilo', () => {
    expect(parseUnicodeMath('ℝ')).toMatchObject({ t: 'id', v: 'R', scr: 'double-struck' });
    expect(parseUnicodeMath('𝐱')).toMatchObject({ t: 'id', v: 'x', sty: 'b' });
    expect(parseUnicodeMath('𝒜')).toMatchObject({ t: 'id', v: 'A', scr: 'script' });
    expect(toUnicodeMath(parseMath(r`\mathbb{R}`))).toBe('ℝ');
    expect(toUnicodeMath(parseMath(r`\mathbf{x}`))).toBe('𝐱');
  });

  it('escribir y volver a leer da el mismo árbol (formas habituales)', () => {
    const CASES = [
      r`\frac{a+b}{c}`, r`x^2+y^2=z^2`, r`\sqrt[3]{x+1}`, r`\sum_{i=1}^{n} i^2`, r`\int_0^1 x\,dx`, r`\alpha+\beta\leq\gamma`,
      r`\left( \frac{1}{2} \right)`, r`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, r`\lim_{x \to 0} \frac{\sin x}{x}`,
      r`\hat{x}+\vec{v}`, r`e^{i\pi}+1=0`, r`x_{1}^{2}`, r`\begin{aligned} x &= 1 \\ y &= 2 \end{aligned}`, r`\mathbb{R}^n`, r`\boxed{x}`,
    ];
    const norm = (n: MNode) => toTex(n).replace(/\\[,:;!]/g, '').replace(/\s+/g, '');
    for (const src of CASES) {
      const tree = parseMath(src);
      const lin = toUnicodeMath(tree);
      expect(norm(parseUnicodeMath(lin)), `${src} → ${lin}`).toBe(norm(tree));
    }
  });
});

describe('estilos y nodos nuevos', () => {
  it('LaTeX: negrita, doble trazo, caligráfica y recuadro', () => {
    expect(parseMath(r`\mathbf{x}`)).toMatchObject({ t: 'row', c: [{ t: 'id', v: 'x', sty: 'b' }] });
    expect(j(parseMath(r`\mathbb{R}`))).toContain('"scr":"double-struck"');
    expect(j(parseMath(r`\mathcal{L}`))).toContain('"scr":"script"');
    expect(j(parseMath(r`\boxed{a}`))).toContain('"t":"box"');
    expect(j(parseMath(r`\begin{aligned} a &= b \\ c &= d \end{aligned}`))).toContain('"t":"eqarr"');
  });

  it('OMML: los estilos, las fracciones lineales, los prefijos y las ecuaciones alineadas hacen la ida y la vuelta', () => {
    const nodes: MNode[] = [
      { t: 'row', c: [{ t: 'id', v: 'R', scr: 'double-struck' }, { t: 'id', v: 'x', sty: 'b' }] },
      { t: 'frac', n: { t: 'id', v: 'a' }, d: { t: 'id', v: 'b' }, bar: true, kind: 'lin' },
      { t: 'frac', n: { t: 'id', v: 'a' }, d: { t: 'id', v: 'b' }, bar: true, kind: 'skw' },
      { t: 'pre', b: { t: 'id', v: 'C' }, sub: { t: 'num', v: '6' }, sup: { t: 'num', v: '14' } },
      { t: 'eqarr', rows: [{ t: 'row', c: [{ t: 'id', v: 'x' }, { t: 'op', v: '=' }, { t: 'num', v: '1' }] }, { t: 'id', v: 'y' }] },
      { t: 'box', c: { t: 'id', v: 'x' }, border: true },
      { t: 'func', name: 'lim', c: { t: 'id', v: 'f' }, sub: { t: 'id', v: 'x' } },
    ];
    const rt = (n: MNode) => parseOmmlXml(ommlXml(n))!.node;
    expect(rt(nodes[0]!)).toMatchObject({ t: 'row', c: [{ scr: 'double-struck', v: 'R' }, { sty: 'b', v: 'x' }] });
    expect(rt(nodes[1]!)).toMatchObject({ t: 'frac', kind: 'lin' });
    expect(rt(nodes[3]!)).toMatchObject({ t: 'pre' });
    expect(rt(nodes[4]!)).toMatchObject({ t: 'eqarr' });
    expect(rt(nodes[5]!)).toMatchObject({ t: 'box', border: true });
    expect(rt(nodes[6]!)).toMatchObject({ t: 'func', name: 'lim', sub: { t: 'id', v: 'x' } });
  });

  it('OMML como texto: en línea, en bloque y con las propiedades del producto', () => {
    const tree = parseMath('x^2');
    const inline = ommlXml(tree);
    expect(inline.startsWith('<m:oMath ')).toBe(true);
    expect(() => parseXml(inline.replace('<m:r>', '<m:r xmlns:w="w">'))).not.toThrow();
    expect(inline).toContain('Cambria Math');
    const block = ommlXml(tree, true);
    expect(block.startsWith('<m:oMathPara ')).toBe(true);
    expect(parseOmmlXml(block)).toMatchObject({ display: true });
    expect(parseOmmlXml(inline)).toMatchObject({ display: false });
    const ppt = ommlXml(tree, false, { rPr: '<a:rPr lang="es-ES"/>' });
    expect(ppt).toContain('<a:rPr lang="es-ES"/>');
    expect(ppt).not.toContain('Cambria');
    expect(ommlXml(tree)).toContain('Cambria Math'); // lo de un producto no se queda en el siguiente
    expect(parseOmmlXml('<a/>')).toBeNull();
  });

  it('MathML: estilos de letra, fracción lineal, prefijos y recuadros', () => {
    expect(toMathML(parseMath(r`\mathbb{R}`))).toContain('mathvariant="double-struck"');
    expect(toMathML(parseMath(r`\mathbf{x}`))).toContain('mathvariant="bold"');
    expect(toMathML({ t: 'pre', b: { t: 'id', v: 'C' }, sub: { t: 'num', v: '6' }, sup: { t: 'num', v: '14' } })).toContain('<mprescripts/>');
    expect(toMathML(parseMath(r`\boxed{x}`))).toContain('nm-box');
  });
});
