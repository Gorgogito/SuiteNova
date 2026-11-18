import { describe, expect, it } from 'vitest';
import { mathClipHtml, mathClipText, mathsFromHtml, replaceMathInHtml, WORD_OMML_NS } from './clip';

/** El fragmento que Word 15 puso en el portapapeles para `x=a/b` (recortado de estilos, no de estructura). */
const WORD_FRAGMENT =
  `<!--StartFragment--><!--[if gte msEquation 12]><m:oMathPara><m:oMath><i style='mso-bidi-font-style:normal'><span style='font-size:12.0pt;font-family:"Cambria Math",serif'>` +
  `<m:r>x</m:r><m:r>=</m:r></span></i><m:f><m:fPr><span style='font-style:italic'><m:ctrlPr></m:ctrlPr></span></m:fPr><m:num><i><span style='font-size:12.0pt'><m:r>a</m:r></span></i></m:num>` +
  `<m:den><i><span style='font-size:12.0pt'><m:r>b</m:r></span></i></m:den></m:f></m:oMath></m:oMathPara><![endif]-->` +
  `<![if !msEquation]><span style='font-size:12.0pt'><!--[if gte vml 1]><v:shapetype id="_x0000_t75"><v:stroke joinstyle="miter"/></v:shapetype><v:shape id="_x0000_i1025" type="#_x0000_t75"><v:imagedata src="file:///x.png"/></v:shape><![endif]-->` +
  `<![if !vml]><img width=39 height=36 src="data:image/png;base64,AAAA" v:shapes="_x0000_i1025"><![endif]></span><![endif]><!--EndFragment-->`;

describe('math clipboard', () => {
  it('writes the Word fragment with the OMML and a Nova span as the fallback, and reads it back', () => {
    const html = mathClipHtml({ tex: String.raw`x=\frac{a}{b}`, display: false });
    expect(html).toContain('<!--[if gte msEquation 12]>');
    expect(html).toContain(`xmlns:m="${WORD_OMML_NS}"`);
    expect(html).toContain('<m:f>');
    expect(html).toContain('<![if !msEquation]>');
    expect(html).toContain('class="nw-math"');
    expect(html).toContain('<math');
    const got = mathsFromHtml(`<p>antes ${html} después</p>`);
    expect(got).toHaveLength(1);
    expect(got[0]!.tex).toBe(String.raw`x=\frac{a}{b}`);
    expect(got[0]!.display).toBe(false);
  });

  it('keeps the display flag and the original OMML between Nova products', () => {
    const omml = '<m:oMath><m:r><a:rPr sz="3600"/><m:t>𝑎</m:t></m:r></m:oMath>';
    const h = mathClipHtml({ tex: 'a', display: true, omml, ommlTex: 'a' });
    const [c] = mathsFromHtml(h);
    expect(c!.display).toBe(true);
    expect(c!.omml).toBe(omml);
    expect(c!.ommlTex).toBe("a");
  });

  it('reads a fragment copied from real Word, ignoring its style wrappers and picture fallback', () => {
    const got = mathsFromHtml(`<p>a ${WORD_FRAGMENT} b</p>`);
    expect(got).toHaveLength(1);
    expect(got[0]!.tex).toBe(String.raw`x=\frac{a}{b}`);
    expect(got[0]!.display).toBe(true);
    const out = replaceMathInHtml(`<p>a ${WORD_FRAGMENT} b</p>`, (c) => `[${c.tex}]`);
    expect(out).toBe(String.raw`<p>a <!--StartFragment-->[x=\frac{a}{b}]<!--EndFragment--> b</p>`);
  });

  it('reads a bare MathML from a web page and a Nova span without the Word comment', () => {
    const ml = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><msup><mi>x</mi><mn>2</mn></msup></math>';
    const [a] = mathsFromHtml(`<p>${ml}</p>`);
    expect(a!.tex).toBe("x^2");
    expect(a!.display).toBe(true);
    const [b] = mathsFromHtml('<span class="nw-math" data-tex="a&lt;b" data-display="0">a&lt;b</span>');
    expect(b!.tex).toBe('a<b');
  });

  it('reads several equations and leaves the rest of the HTML alone', () => {
    const one = mathClipHtml({ tex: 'a+b', display: false });
    const two = mathClipHtml({ tex: String.raw`\sqrt{x}`, display: true });
    const html = `<p>1 ${one}</p><p>2 ${two}</p>`;
    expect(mathsFromHtml(html).map((c) => c.tex)).toEqual(['a+b', String.raw`\sqrt{x}`]);
    expect(replaceMathInHtml(html, () => '#')).toBe('<p>1 #</p><p>2 #</p>');
    expect(mathsFromHtml('<p>sin ecuaciones</p>')).toEqual([]);
    expect(mathsFromHtml(null)).toEqual([]);
  });

  it('gives the linear form of Word as the plain text', () => {
    expect(mathClipText({ tex: String.raw`\frac{a}{b}`, display: false })).toBe('a/b');
    expect(mathClipText({ tex: 'x^2', display: false })).toBe('x^2');
  });
});

describe('math clipboard (HTML re-serialized by the browser)', () => {
  it('reads the Nova fragment after Chromium turned its conditional markers into comments', () => {
    const html = mathClipHtml({ tex: 'a+b', display: false }).replace('<![if !msEquation]>', '<!--[if !msEquation]-->').replace('<![endif]>', '<!--[endif]-->');
    const got = mathsFromHtml(`<p>${html}</p>`);
    expect(got.map((c) => c.tex)).toEqual(['a+b']);
    expect(replaceMathInHtml(`<p>${html}</p>`, () => '#')).toBe('<p>#</p>');
  });
});
