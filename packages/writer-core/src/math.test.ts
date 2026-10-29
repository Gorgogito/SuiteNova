import { describe, expect, it } from 'vitest';
import { attrOf, kidsOf, parseXml, tagOf, textOfNode, rootOf } from './docx/xml';
import { fromOMML, OMML_NS, parseMath, toMathML, toOMML, toTex, type MNode } from './math';

const r = String.raw;
const CASES = [
  r`x^2+y^2=z^2`,
  r`\frac{a+b}{c}`,
  r`\sqrt{x}`,
  r`\sqrt[3]{x+1}`,
  r`\sum_{i=1}^{n} i^2`,
  r`\int_0^1 x\,dx`,
  r`\alpha + \beta \leq \gamma`,
  r`\left( \frac{1}{2} \right)`,
  r`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`,
  r`\lim_{x \to 0} \frac{\sin x}{x}`,
  r`\hat{x} + \vec{v}`,
  r`e^{i\pi} + 1 = 0`,
  r`x_{1}^{2}`,
];

describe('ecuaciones', () => {
  it('la forma lineal es estable al analizarla y volver a escribirla', () => {
    for (const src of CASES) {
      const once = toTex(parseMath(src));
      const twice = toTex(parseMath(once));
      expect(twice, src).toBe(once);
    }
  });
  it('entiende fracciones, raíces, sumatorios, matrices y funciones', () => {
    const t = (s: string) => parseMath(s);
    expect(JSON.stringify(t(r`\frac{1}{2}`))).toContain('"t":"frac"');
    expect(JSON.stringify(t(r`\sqrt[3]{8}`))).toContain('"deg"');
    const sum = JSON.stringify(t(r`\sum_{i=1}^{n} i`));
    expect(sum).toContain('"t":"nary"');
    expect(sum).toContain('"op":"∑"');
    expect(JSON.stringify(t(r`\begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}`))).toContain('"t":"matrix"');
    expect(JSON.stringify(t(r`\sin x`))).toContain('"t":"func"');
    expect(toTex(t(r`\alpha`)).trim()).toBe(r`\alpha`);
  });
  it('genera MathML bien formado', () => {
    for (const src of CASES) {
      const ml = toMathML(parseMath(src));
      expect(() => parseXml(ml), src).not.toThrow();
      expect(ml.startsWith('<math'), src).toBe(true);
    }
    expect(toMathML(parseMath(r`\frac{a}{b}`))).toContain('<mfrac>');
    expect(toMathML(parseMath('x^2'))).toContain('<msup>');
    expect(toMathML(parseMath(r`\sum_{i=1}^{n} i`))).toContain('<munderover>');
  });
  it('ida y vuelta por OMML', () => {
    for (const src of CASES) {
      const node = parseMath(src);
      const xml = `<m:oMath ${OMML_NS} xmlns:w="w">${toOMML(node)}</m:oMath>`;
      const root = rootOf(parseXml(xml), 'oMath')!;
      const back = fromOMML(kidsOf(root), tagOf, kidsOf, attrOf, textOfNode) as MNode;
      const norm = (x: string) => x.replace(/\\[,:;!]/g, '').replace(/\s+/g, '');
      expect(norm(toTex(back)), src).toBe(norm(toTex(node)));
    }
  });
  it('lo que no entiende se conserva como texto', () => {
    const tex = toTex(parseMath(r`\unknowncmd + 1`));
    expect(tex).toContain('unknowncmd');
  });
});
