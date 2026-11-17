/** OMML como texto XML: para los productos que no tienen su propio lector de `m:oMath` (Slides, Calc, Notes). */
import { fromOMML, OMML_NS, toOMML, type MNode, type OmmlOptions } from './math';
import { attrOf, kidsOf, parseXml, tagOf, textOfNode, rootOf, type XNode } from './xml';

const ommlTree = (kids: XNode[]): MNode => fromOMML(kids, tagOf, kidsOf, (n, a) => attrOf(n, a), textOfNode);

/**
 * Lee una ecuación de un fragmento de XML: un `m:oMath` o un `m:oMathPara` (con uno o varios `m:oMath`).
 * Devuelve el árbol y si venía en bloque (`m:oMathPara`).
 */
export function parseOmmlXml(xml: string): { node: MNode; display: boolean } | null {
  const doc = parseXml(xml);
  const para = rootOf(doc, 'oMathPara');
  if (para) {
    const maths = kidsOf(para).filter((k) => tagOf(k) === 'oMath');
    if (!maths.length) return null;
    return { node: ommlTree(maths.flatMap((m) => kidsOf(m))), display: true };
  }
  const m = rootOf(doc, 'oMath');
  return m ? { node: ommlTree(kidsOf(m)), display: false } : null;
}

/**
 * Escribe la ecuación como `m:oMath` (en línea) o `m:oMathPara` (en bloque), con el espacio de nombres `m:` declarado.
 * `rPr` son las propiedades de texto de cada carácter del producto (`w:rPr` en Word, `a:rPr` en PowerPoint).
 */
export function ommlXml(node: MNode, display = false, opts: OmmlOptions = {}): string {
  const inner = `<m:oMath>${toOMML(node, opts)}</m:oMath>`;
  return display ? `<m:oMathPara ${OMML_NS}>${inner}</m:oMathPara>` : inner.replace('<m:oMath>', `<m:oMath ${OMML_NS}>`);
}

// ------------------------------------------------------------------------------------------ OMML original como texto

/** Los elementos del espacio de nombres `m:` (el análisis quita los prefijos; se vuelven a poner por el nombre). */
const M_NAMES = new Set(
  'acc accPr aln alnScr argPr argSz bar barPr baseJc begChr borderBox borderBoxPr box boxPr brk chr count cGp cGpRule cSp ctrlPr d defJc deg degHide den diff dispDef dPr e endChr eqArr eqArrPr f fName fPr func funcPr gc groupChr groupChrPr grow hideBot hideLeft hideRight hideTop interSp intLim intraSp lim limLoc limLow limLowPr limUpp limUppPr lit lMargin m maxDist mc mcJc mcPr mcs mPr mr nary naryLim naryPr noBreak nor num oMath oMathPara oMathParaPr opEmu phant phantPr plcHide pos postSp preSp r rad radPr rMargin rPr rSp rSpRule rSty scr sepChr show shp smallFrac sPre sPrePr sSub sSubPr sSubSup sSubSupPr sSup sSupPr strikeBLTR strikeH strikeTLBR strikeV sty sub subHide sup supHide t transp type vertJc wrapIndent wrapRight zeroAsc zeroDesc zeroWid'.split(' '),
);
const M_RPR = new Set(['lit', 'nor', 'scr', 'sty', 'brk', 'aln']);

const xesc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const aesc = (s: string) => xesc(s).replace(/"/g, '&quot;');

/** Escribe un nodo de OMML tal como estaba (con sus propiedades de texto, fuentes y tamaños), devolviendo los prefijos `m:` y `w:`. */
export function ommlString(n: XNode): string {
  if (n['#text'] !== undefined) return xesc(String(n['#text']));
  const tag = tagOf(n);
  const kids = kidsOf(n);
  // `rPr` existe en los dos espacios: el de matemáticas solo lleva sty, scr, nor, lit, brk y aln
  const prefix = M_NAMES.has(tag) && !(tag === 'rPr' && kids.some((k) => !M_RPR.has(tagOf(k)))) ? 'm' : 'w';
  const attrs = Object.entries((n[':@'] ?? {}) as Record<string, string>)
    .map(([k, v]) => ` ${k.slice(2) === 'space' ? 'xml:space' : `${prefix}:${k.slice(2)}`}="${aesc(String(v))}"`)
    .join('');
  const inner = kids.map((k) => (prefix === 'w' && k['#text'] === undefined ? wString(k) : ommlString(k))).join('');
  return inner ? `<${prefix}:${tag}${attrs}>${inner}</${prefix}:${tag}>` : `<${prefix}:${tag}${attrs}/>`;
}

/** Dentro de un elemento de Word, todo es de Word. */
function wString(n: XNode): string {
  const tag = tagOf(n);
  const attrs = Object.entries((n[':@'] ?? {}) as Record<string, string>)
    .map(([k, v]) => ` ${k.slice(2) === 'space' ? 'xml:space' : `w:${k.slice(2)}`}="${aesc(String(v))}"`)
    .join('');
  const inner = kidsOf(n).map((k) => (k['#text'] !== undefined ? xesc(String(k['#text'])) : wString(k))).join('');
  return inner ? `<w:${tag}${attrs}>${inner}</w:${tag}>` : `<w:${tag}${attrs}/>`;
}
