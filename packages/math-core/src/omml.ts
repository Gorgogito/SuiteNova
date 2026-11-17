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
