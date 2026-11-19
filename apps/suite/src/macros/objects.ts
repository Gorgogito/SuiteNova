import { basic } from '@suitenova/base-core';

type BVal = basic.BVal;
type BObject = basic.BObject;
const { BasicError } = basic;

/** An object of the macro language, described by tables of properties and methods (names are case-insensitive). */
export interface ObjectDef {
  type: string;
  props?: Record<string, { get: () => BVal; set?: (v: BVal) => void }>;
  methods?: Record<string, (a: BVal[]) => BVal>;
  /** `obj(1)`, `obj("name")` and `obj.Item(1)`. */
  index?: (a: BVal[]) => BVal;
  items?: () => BVal[];
}

/** The error of a member the object does not have (438, as in VBA). */
export const noMember = (m: string): never => {
  throw new BasicError(438, `El objeto no admite la propiedad o el método: ${m}`);
};

/** Names of the arguments of the methods that take them by name (`Add Index:=1`), in order, by lower-case method name. */
export type ParamTable = Record<string, string[]>;

function withNamed(params: ParamTable, method: string, args: BVal[]): BVal[] {
  const named = (args as BVal[] & { named?: Record<string, BVal> }).named;
  const order = params[method];
  if (!named || !order || !Object.keys(named).length) return args;
  const out = [...args];
  for (const [k, v] of Object.entries(named)) {
    const i = order.indexOf(k.toLowerCase());
    if (i >= 0) out[i] = v;
  }
  return out;
}

/** Builds the object. A property that is a collection can be indexed in place: `Shapes(2)`, `Slides("Slide1")`. */
export function makeObject(def: ObjectDef, params: ParamTable = {}): BObject {
  return {
    typeName: def.type,
    get(member, args) {
      const m = member.toLowerCase();
      const fn = def.methods?.[m];
      if (fn) return fn(withNamed(params, m, args));
      const p = def.props?.[m];
      if (p) {
        const v = p.get();
        if (args.length && v && typeof v === 'object' && 'typeName' in v && (v as BObject).index) return (v as BObject).index!(args);
        return v;
      }
      if (m === 'item' && def.index) return def.index(args);
      return noMember(member);
    },
    set(member, _args, v) {
      const p = def.props?.[member.toLowerCase()];
      if (!p || !p.set) return noMember(member);
      p.set(v);
    },
    index: def.index,
    items: def.items,
  };
}

/** A fixed list of objects as a collection with `Count`, `Item`, indexing by number (or by name when `nameOf` is given) and `For Each`. */
export function collection(type: string, list: () => BObject[], nameOf?: (o: BObject) => string): BObject {
  const pick = (a: BVal[]): BVal => {
    const k = a[0];
    const all = list();
    if (typeof k === 'string' && nameOf) {
      const hit = all.find((o) => nameOf(o).toLowerCase() === k.toLowerCase());
      if (!hit) throw new BasicError(9, `No se encuentra «${k}».`);
      return hit;
    }
    const n = Math.trunc(Number(k));
    const o = all[n - 1];
    if (!o || !Number.isFinite(n)) throw new BasicError(9, 'El subíndice está fuera del intervalo.');
    return o;
  };
  return makeObject({ type, props: { count: { get: () => list().length } }, index: pick, items: () => list() });
}
