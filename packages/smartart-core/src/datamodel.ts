import { attr, el, kid, kidsOf, parseXml, serializeXml, xmlDocument, type El } from './xml';

/*
 * `dgm:dataModel`: los puntos (`dgm:pt`) y las conexiones (`dgm:cxn`) de un SmartArt. Los puntos de tipo `node` y `asst` son el contenido
 * que escribe el usuario; `doc` es la raíz; `parTrans` y `sibTrans` son las transiciones entre padre e hijo y entre hermanos; `pres`
 * son los puntos de presentación que genera el motor al ejecutar el diseño (cada forma dibujada). Se conserva todo tal cual para que
 * un archivo de Office vuelva a escribirse sin pérdidas.
 */

export const NS = {
  dgm: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  dsp: 'http://schemas.microsoft.com/office/drawing/2008/diagram',
} as const;

export type PtType = 'node' | 'asst' | 'doc' | 'pres' | 'parTrans' | 'sibTrans';
export type CxnType = 'parOf' | 'presOf' | 'presParOf' | 'unknownRelationship';

export interface Pt {
  modelId: string;
  /** `node` si falta en el archivo. */
  type: PtType;
  /** Los atributos de `dgm:prSet` (`presAssocID`, `presName`, `loTypeId`, `phldr`…). */
  prSet?: Record<string, string>;
  /** Los hijos de `dgm:prSet` (variables `presLayoutVars`, `style`). */
  prSetKids?: El[];
  spPr?: El;
  /** El cuerpo de texto `dgm:t` (`a:bodyPr`, `a:lstStyle`, `a:p`…). */
  t?: El;
  /** Atributos de `dgm:pt` distintos de `modelId` y `type` (`cxnId`). */
  extra?: Record<string, string>;
}

export interface Cxn {
  modelId: string;
  /** `parOf` si falta en el archivo. */
  type: CxnType;
  srcId: string;
  destId: string;
  srcOrd: number;
  destOrd: number;
  parTransId?: string;
  sibTransId?: string;
  presId?: string;
}

export interface DataModel {
  pts: Pt[];
  cxns: Cxn[];
  bg?: El;
  whole?: El;
  /** `a:extLst` (guarda, entre otras cosas, el `relId` del dibujo en caché). */
  extLst?: El;
  /** Atributos y declaraciones de espacios de nombres del elemento raíz. */
  rootAttrs: Record<string, string>;
}

export const emptyDataModel = (): DataModel => ({ pts: [], cxns: [], rootAttrs: { 'xmlns:dgm': NS.dgm, 'xmlns:a': NS.a } });

const intOr = (v: string | undefined, d: number) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export function parseDataModel(xml: string): DataModel {
  const root = parseXml(xml);
  const dm: DataModel = { pts: [], cxns: [], rootAttrs: { ...root.attrs } };
  for (const p of kidsOf(kid(root, 'ptLst'), 'pt')) {
    const { modelId, type, ...extra } = p.attrs;
    const pr = kid(p, 'prSet');
    const pt: Pt = { modelId: modelId ?? '', type: (type as PtType | undefined) ?? 'node' };
    if (pr) {
      pt.prSet = { ...pr.attrs };
      if (pr.kids.length) pt.prSetKids = pr.kids;
    }
    const sp = kid(p, 'spPr');
    if (sp) pt.spPr = sp;
    const t = kid(p, 't');
    if (t) pt.t = t;
    if (Object.keys(extra).length) pt.extra = extra;
    dm.pts.push(pt);
  }
  for (const c of kidsOf(kid(root, 'cxnLst'), 'cxn')) {
    const a = c.attrs;
    const cx: Cxn = {
      modelId: a.modelId ?? '',
      type: (a.type as CxnType | undefined) ?? 'parOf',
      srcId: a.srcId ?? '',
      destId: a.destId ?? '',
      srcOrd: intOr(a.srcOrd, 0),
      destOrd: intOr(a.destOrd, 0),
    };
    if (a.parTransId) cx.parTransId = a.parTransId;
    if (a.sibTransId) cx.sibTransId = a.sibTransId;
    if (a.presId) cx.presId = a.presId;
    dm.cxns.push(cx);
  }
  const bg = kid(root, 'bg');
  if (bg) dm.bg = bg;
  const whole = kid(root, 'whole');
  if (whole) dm.whole = whole;
  const ext = kid(root, 'extLst');
  if (ext) dm.extLst = ext;
  return dm;
}

export function dataModelEl(dm: DataModel): El {
  const pts = dm.pts.map((p) => {
    const attrs: Record<string, string> = { modelId: p.modelId };
    if (p.type !== 'node') attrs.type = p.type;
    Object.assign(attrs, p.extra ?? {});
    const kids: El[] = [];
    if (p.prSet) kids.push(el('dgm:prSet', p.prSet, p.prSetKids ?? []));
    kids.push(p.spPr ?? el('dgm:spPr'));
    if (p.t) kids.push(p.t);
    return el('dgm:pt', attrs, kids);
  });
  const cxns = dm.cxns.map((c) => {
    const attrs: Record<string, string> = { modelId: c.modelId };
    if (c.type !== 'parOf') attrs.type = c.type;
    attrs.srcId = c.srcId;
    attrs.destId = c.destId;
    attrs.srcOrd = String(c.srcOrd);
    attrs.destOrd = String(c.destOrd);
    if (c.parTransId) attrs.parTransId = c.parTransId;
    if (c.sibTransId) attrs.sibTransId = c.sibTransId;
    if (c.presId) attrs.presId = c.presId;
    return el('dgm:cxn', attrs);
  });
  const kids: El[] = [el('dgm:ptLst', {}, pts), el('dgm:cxnLst', {}, cxns), dm.bg ?? el('dgm:bg'), dm.whole ?? el('dgm:whole')];
  if (dm.extLst) kids.push(dm.extLst);
  return el('dgm:dataModel', dm.rootAttrs, kids);
}

export const writeDataModel = (dm: DataModel): string => xmlDocument(dataModelEl(dm));
export const dataModelXml = (dm: DataModel): string => serializeXml(dataModelEl(dm));

/** El `relId` del dibujo en caché, si el archivo lo declara (`dsp:dataModelExt`). */
export function drawingRelId(dm: DataModel): string | undefined {
  const find = (e: El): string | undefined => {
    if (e.name.endsWith('dataModelExt')) return attr(e, 'relId');
    for (const k of e.kids) {
      const r = find(k);
      if (r) return r;
    }
    return undefined;
  };
  return dm.extLst ? find(dm.extLst) : undefined;
}

/** Declara (o cambia) el `relId` del dibujo en caché. */
export function setDrawingRelId(dm: DataModel, relId: string | null): void {
  if (relId === null) {
    delete dm.extLst;
    return;
  }
  dm.rootAttrs['xmlns:a'] ??= NS.a;
  dm.extLst = el('dgm:extLst', {}, [
    el('a:ext', { uri: 'http://schemas.microsoft.com/office/drawing/2008/diagram' }, [el('dsp:dataModelExt', { 'xmlns:dsp': NS.dsp, relId, minVer: 'http://schemas.openxmlformats.org/drawingml/2006/diagram' })]),
  ]);
}
