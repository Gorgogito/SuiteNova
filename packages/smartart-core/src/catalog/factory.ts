import { parseDataModel, setDrawingRelId } from '../datamodel';
import { render, renderSmartArt } from '../engine';
import { dataModelToTree, newGuid, newTree, outlineToTree, treeToDataModel, type SmartTree } from '../model';
import { parseSmartArt, type SmartArt } from '../parts';
import { colorsById, COLORS_CATALOG, STYLE_CATALOG, styleById } from './styles';
import { layoutById } from './layouts';

export * from './layouts';
export * from './styles';

export const DEFAULT_STYLE = STYLE_CATALOG[0]!.id;
export const DEFAULT_COLORS = COLORS_CATALOG[0]!.id;

export interface NewSmartArt {
  layout: string;
  /** Texto del panel (un nodo por línea, un tabulador por nivel) o un árbol ya hecho. */
  text: string | SmartTree;
  style?: string;
  colors?: string;
  /** Tamaño del dibujo en puntos. */
  width: number;
  height: number;
  ids?: () => string;
}

/** Marca el dibujo en caché con un identificador de relación provisional; el anfitrión lo sustituye al guardar. */
const PLACEHOLDER_REL = 'rId1';

/** Un SmartArt nuevo del catálogo con su dibujo calculado. */
export function newSmartArt(o: NewSmartArt): SmartArt {
  const layout = layoutById(o.layout);
  const style = styleById(o.style ?? DEFAULT_STYLE);
  const colors = colorsById(o.colors ?? DEFAULT_COLORS);
  if (!layout || !style || !colors) throw new Error('Diseño, estilo o colores desconocidos.');
  const ids = o.ids ?? newGuid;
  const base = newTree({ layout: layout.id, style: style.id, colors: colors.id, layoutCat: layout.category }, ids);
  const tree = typeof o.text === 'string' ? outlineToTree(o.text, base, ids) : { ...o.text, docPr: { ...o.text.docPr, loTypeId: layout.id, qsTypeId: style.id, csTypeId: colors.id } };
  const data = treeToDataModel(tree, undefined, ids);
  const empty = parseSmartArt({ data: '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst/><dgm:cxnLst/></dgm:dataModel>', layout: layout.xml, style: style.xml, colors: colors.xml });
  const sa: SmartArt = { ...empty, data };
  sa.drawing = renderSmartArt(sa, { width: o.width, height: o.height });
  setDrawingRelId(sa.data, PLACEHOLDER_REL);
  return sa;
}

type Size = { width: number; height: number };

/** Pone al día un SmartArt: datos desde el árbol y dibujo vuelto a calcular. */
export function refresh(sa: SmartArt, tree: SmartTree, size: Size, ids: () => string = newGuid): SmartArt {
  const data = treeToDataModel(tree, sa.data, ids);
  const next: SmartArt = { ...sa, data };
  next.drawing = render(sa.layout, tree, { ...size, style: sa.style, colors: sa.colors });
  setDrawingRelId(next.data, PLACEHOLDER_REL);
  return next;
}

/** El árbol de nodos de un SmartArt. */
export const treeOf = (sa: SmartArt): SmartTree => dataModelToTree(sa.data);

/** Cambia el diseño conservando el texto. */
export function changeLayout(sa: SmartArt, layoutId: string, size: Size): SmartArt {
  const l = layoutById(layoutId);
  if (!l) throw new Error('Diseño desconocido.');
  const next = parseSmartArt({ data: '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst/><dgm:cxnLst/></dgm:dataModel>', layout: l.xml, style: sa.styleXml, colors: sa.colorsXml });
  const tree = treeOf(sa);
  tree.docPr = { ...tree.docPr, loTypeId: l.id, loCatId: l.category };
  return refresh({ ...sa, layout: next.layout, layoutXml: l.xml }, tree, size);
}

/** Cambia el estilo rápido. */
export function changeStyle(sa: SmartArt, styleId: string, size: Size): SmartArt {
  const s = styleById(styleId);
  if (!s) throw new Error('Estilo desconocido.');
  const next = parseSmartArt({ data: '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst/><dgm:cxnLst/></dgm:dataModel>', layout: sa.layoutXml, style: s.xml, colors: sa.colorsXml });
  const tree = treeOf(sa);
  tree.docPr = { ...tree.docPr, qsTypeId: s.id };
  return refresh({ ...sa, style: next.style, styleXml: s.xml }, tree, size);
}

/** Cambia el conjunto de colores. */
export function changeColors(sa: SmartArt, colorsId: string, size: Size): SmartArt {
  const c = colorsById(colorsId);
  if (!c) throw new Error('Colores desconocidos.');
  const next = parseSmartArt({ data: '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:ptLst/><dgm:cxnLst/></dgm:dataModel>', layout: sa.layoutXml, style: sa.styleXml, colors: c.xml });
  const tree = treeOf(sa);
  tree.docPr = { ...tree.docPr, csTypeId: c.id };
  return refresh({ ...sa, colors: next.colors, colorsXml: c.xml }, tree, size);
}

/** Cambia el tamaño del dibujo (los nodos se vuelven a colocar). */
export const resize = (sa: SmartArt, size: Size): SmartArt => refresh(sa, treeOf(sa), size);

/** Lee un SmartArt de las partes de un archivo. */
export { parseSmartArt as readSmartArt, parseDataModel as readDataModel };
