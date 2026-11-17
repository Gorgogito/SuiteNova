import { XMLBuilder, XMLParser } from 'fast-xml-parser';

/*
 * Reescribir un gráfico que viene de otro programa sin perder lo que Nova no entiende (estilos de Office, efectos, diseños manuales,
 * extensiones, formato de cada punto…). Es una fusión de tres vías del XML de la parte del gráfico:
 *
 *   O  el XML original, tal cual lo guardó el otro programa;
 *   G0 lo que Nova genera desde el modelo tal como se leyó de O (sin cambios);
 *   G1 lo que Nova genera ahora, con los cambios de la persona.
 *
 * Un elemento donde G1 = G0 no lo tocó nadie: se conserva el de O, con todo lo suyo. Donde G1 ≠ G0 manda G1, pero lo de dentro que
 * Nova no modela (está en O y no sale ni en G0 ni en G1) se conserva. Lo que está en G0 y falta en G1 es lo que la persona quitó.
 * Los valores guardados en caché (`numCache`, `strCache`…) salen siempre de G1: son los datos de ahora.
 */

type PNode = Record<string, unknown> & { ':@'?: Record<string, string> };

const OPTS = { ignoreAttributes: false, attributeNamePrefix: '@_', preserveOrder: true, parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: false, commentPropName: '#comment' } as const;
const parser = new XMLParser(OPTS);
const builder = new XMLBuilder({ ...OPTS, format: false, suppressEmptyNode: true });

/** Elementos cuyo contenido es siempre el de ahora. */
const ALWAYS_NEW = new Set(['numCache', 'strCache', 'multiLvlStrCache', 'lvl']);
/**
 * Grupos de elementos de los que el esquema permite uno solo (`xsd:choice`): si G1 trae uno, el de O que sea de otro miembro del
 * mismo grupo no se conserva (un relleno sólido y uno de degradado a la vez, o dos colores en un mismo relleno, no son válidos).
 */
const CHOICES: string[][] = [
  ['srgbClr', 'schemeClr', 'prstClr', 'sysClr', 'hslClr', 'scrgbClr'],
  ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'],
  ['prstGeom', 'custGeom'],
  ['effectLst', 'effectDag'],
  ['prstDash', 'custDash'],
  ['round', 'bevel', 'miter'],
  ['strRef', 'strLit'],
  ['numRef', 'numLit'],
];
const choiceOf = (tag: string): string[] | undefined => CHOICES.find((g) => g.includes(local(tag)));

/** Elementos al final de su contenedor, que no se mueven. */
const LAST = new Set(['extLst']);

const tagOf = (n: PNode): string => Object.keys(n).find((k) => k !== ':@') ?? '';
const kidsOf = (n: PNode): PNode[] => (n[tagOf(n)] as PNode[]) ?? [];
const local = (t: string): string => t.slice(t.indexOf(':') + 1);
const isText = (n: PNode): boolean => tagOf(n) === '#text';
const canon = (n: PNode | PNode[]): string => JSON.stringify(n);

/** La clave que identifica un hijo repetido (la serie, el eje, el punto), o null si vale su posición. */
function keyOf(n: PNode): string | null {
  const t = local(tagOf(n));
  const find = (name: string): string | null => {
    for (const k of kidsOf(n)) if (local(tagOf(k)) === name) return k[':@']?.['@_val'] ?? null;
    return null;
  };
  if (t === 'ser' || t === 'dPt' || t === 'dLbl' || t === 'trendline') return find('idx') ?? find('order');
  // los ejes se alinean por posición: cada programa numera sus `axId` a su manera
  return null;
}

/** Los hijos con su clave (etiqueta y clave propia o posición entre los de su etiqueta), sin texto ni comentarios. */
function entries(kids: PNode[]): [string, PNode][] {
  const seen = new Map<string, number>();
  const out: [string, PNode][] = [];
  for (const k of kids) {
    if (isText(k) || tagOf(k) === '#comment') continue;
    const t = tagOf(k);
    const n = seen.get(t) ?? 0;
    seen.set(t, n + 1);
    out.push([`${t}#${keyOf(k) ?? `@${n}`}`, k]);
  }
  return out;
}

function merge3(o: PNode, g0: PNode, g1: PNode): PNode {
  const tag = tagOf(g1);
  const ok = kidsOf(o);
  const k0 = kidsOf(g0);
  const k1 = kidsOf(g1);
  const result: PNode = { [tag]: [] as PNode[] };
  // los atributos: los de O, salvo los que G1 cambió respecto de G0 o añadió (y se quitan los que G1 quitó)
  const a1 = g1[':@'] ?? {};
  const a0 = g0[':@'] ?? {};
  const ao = o[':@'] ?? {};
  const attrs: Record<string, string> = { ...ao };
  for (const [k, v] of Object.entries(a1)) if (a0[k] !== v || !(k in ao)) attrs[k] = v;
  for (const k of Object.keys(a0)) if (!(k in a1)) delete attrs[k];
  if (Object.keys(attrs).length) result[':@'] = attrs;

  // contenido de solo texto: el de O si G1 no cambió respecto de G0
  if ((k1.length === 0 || k1.every(isText)) && (ok.length === 0 || ok.every(isText))) {
    result[tag] = ok.length && canon(k1) === canon(k0) ? ok : k1;
    return result;
  }

  const eo = new Map(entries(ok));
  const e0 = new Map(entries(k0));
  const out: PNode[] = [];
  const outByKey = new Map<string, PNode>();
  const e1 = entries(k1);
  const keyed = new Set(e1.map(([key]) => key));
  // el esqueleto es el de G1 (es el orden que el esquema pide): cada hijo, de O si nadie lo tocó, fusionado si lo tocaron
  let at1 = 0;
  for (const c1 of k1) {
    if (isText(c1) || tagOf(c1) === '#comment') {
      out.push(c1);
      continue;
    }
    const [key] = e1[at1++]!;
    const co = eo.get(key);
    const c0 = e0.get(key);
    let node: PNode;
    if (ALWAYS_NEW.has(local(tagOf(c1))) || !co || !c0) node = c1;
    else if (canon(c1) === canon(c0)) node = co;
    else node = merge3(co, c0, c1);
    out.push(node);
    outByKey.set(key, node);
  }
  // lo que Nova no modela (está en O y ni en G0 ni en G1) se conserva, detrás del hermano que tenía delante en O
  let prev: PNode | null = null;
  const tail: PNode[] = [];
  for (const [key, node] of entries(ok)) {
    const placed = outByKey.get(key);
    if (placed) {
      prev = placed;
      continue;
    }
    if (keyed.has(key) || e0.has(key)) continue; // lo quitó la persona
    const group = choiceOf(tagOf(node));
    if (group && [...e1, ...e0].some(([, n]) => group.includes(local(tagOf(n))))) continue; // G1 eligió otro miembro del grupo
    if (LAST.has(local(tagOf(node)))) {
      tail.push(node);
      continue;
    }
    const at = prev ? out.indexOf(prev) : -1;
    out.splice(at + 1, 0, node);
    prev = node;
  }
  const ext = out.filter((n) => !isText(n) && LAST.has(local(tagOf(n))));
  result[tag] = [...out.filter((n) => !ext.includes(n)), ...ext, ...tail];
  return result;
}

/** El gráfico de `edited` con lo que `original` tenía y Nova no entiende (véase el comentario del archivo). */
export function mergeChartXml(original: string, generatedFromOriginal: string, edited: string): string {
  const o = parser.parse(original) as PNode[];
  const g0 = parser.parse(generatedFromOriginal) as PNode[];
  const g1 = parser.parse(edited) as PNode[];
  const root = (xs: PNode[]) => xs.find((x) => !tagOf(x).startsWith('?') && !isText(x));
  const ro = root(o);
  const r0 = root(g0);
  const r1 = root(g1);
  if (!ro || !r0 || !r1 || tagOf(ro) !== tagOf(r1) || tagOf(r0) !== tagOf(r1)) return edited;
  const merged = merge3(ro, r0, r1);
  // los espacios de nombres de O (c14, mc…) se conservan en la raíz junto a los de G1
  const decl = o.filter((x) => tagOf(x).startsWith('?'));
  return builder.build([...decl, merged]) as string;
}

/** ¿Hay diferencia entre lo generado antes y ahora? (si no, el gráfico original se escribe tal cual). */
export const sameXml = (a: string, b: string): boolean => canon(parser.parse(a) as PNode[]) === canon(parser.parse(b) as PNode[]);
