import { attrOf, findKid, findKids, kidsOf, parseXml, rootOf, tagOf, type XNode } from '@suitenova/writer-core';
import { officeTheme } from '../defaults';
import type { Effects, Fill, Ln, SchemeSlot, TableStyleDef, TableStylePart, Theme } from '../types';
import { readClr, readEffects, readFill, readLn, readRunProps, type DmlCtx } from './dml';

const noCtx: DmlCtx = { blip: () => undefined, link: () => undefined, warn: () => undefined };

const SLOTS: SchemeSlot[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

export function readTheme(xml: string, id: string, ctx: DmlCtx = noCtx): Theme {
  const base = officeTheme();
  const root = rootOf(parseXml(xml), 'theme');
  const els = findKid(root, 'themeElements');
  const out: Theme = { ...base, id, name: attrOf(root ?? {}, 'name') ?? base.name };
  const cs = findKid(els, 'clrScheme');
  if (cs) {
    const colors = { ...base.colors };
    for (const slot of SLOTS) {
      const n = findKid(cs, slot);
      const c = readClr(n);
      if (c?.rgb) colors[slot] = c.rgb;
    }
    out.colors = colors;
  }
  const fs = findKid(els, 'fontScheme');
  if (fs) {
    const face = (k: string) => {
      const f = findKid(fs, k);
      const l = (t: string) => attrOf(findKid(f, t) ?? {}, 'typeface');
      return { latin: l('latin') || base.fonts.major.latin, ea: l('ea') || undefined, cs: l('cs') || undefined };
    };
    out.fonts = { major: face('majorFont'), minor: face('minorFont') };
    const minor = out.fonts.minor.latin;
    if (!out.fonts.major.latin) out.fonts.major.latin = minor;
  }
  const fm = findKid(els, 'fmtScheme');
  if (fm) {
    const fills = kidsOf(findKid(fm, 'fillStyleLst') ?? {}).filter((k) => tagOf(k) !== '#text').map((k) => readFillStyle(k, ctx));
    const lns = findKids(findKid(fm, 'lnStyleLst'), 'ln').map((l) => readLn(l, ctx) ?? {});
    const effs: Effects[] = findKids(findKid(fm, 'effectStyleLst'), 'effectStyle').map((e) => readEffects(findKid(e, 'effectLst')) ?? {});
    const bgs = kidsOf(findKid(fm, 'bgFillStyleLst') ?? {}).filter((k) => tagOf(k) !== '#text').map((k) => readFillStyle(k, ctx));
    out.fmt = { fills: fills.length ? fills : base.fmt.fills, lns: lns.length ? lns : base.fmt.lns, effects: effs.length ? effs : base.fmt.effects, bgFills: bgs.length ? bgs : base.fmt.bgFills };
  }
  return out;
}

function readFillStyle(n: XNode, ctx: DmlCtx): Fill {
  // readFill looks at the children of a parent; wrap the style element
  return readFill({ x: [n] } as unknown as XNode, ctx) ?? { t: 'none' };
}

// ------------------------------------------------------------------------------------------------ table styles

function part(n: XNode | undefined, ctx: DmlCtx): TableStylePart | undefined {
  if (!n) return undefined;
  const out: TableStylePart = {};
  // the cell part of a table style is `a:tcStyle` (an older reading looked for `a:tcPr`, which never exists there)
  const tcPr = findKid(n, 'tcStyle') ?? findKid(n, 'tcPr');
  const tcTx = findKid(n, 'tcTxStyle');
  if (tcPr) {
    const f = readFill(findKid(tcPr, 'fill'), ctx);
    if (f) out.fill = f;
    const b = findKid(tcPr, 'tcBdr');
    if (b) {
      const ln = (k: string) => {
        const e = findKid(b, k);
        return e ? readLn(findKid(e, 'ln'), ctx) : undefined;
      };
      out.ln = { l: ln('left'), r: ln('right'), t: ln('top'), b: ln('bottom'), insideH: ln('insideH'), insideV: ln('insideV') };
    }
  }
  if (tcTx) {
    const rp = readRunProps({ x: [], ':@': tcTx[':@'] } as unknown as XNode, ctx);
    const color = readClr(tcTx);
    const fontRef = findKid(tcTx, 'fontRef');
    if (color) rp.color = color;
    if (attrOf(tcTx, 'b') === 'on') rp.b = true;
    if (attrOf(tcTx, 'i') === 'on') rp.i = true;
    void fontRef;
    out.rPr = rp;
  }
  return out;
}

export function readTableStyles(xml: string, ctx: DmlCtx = noCtx): { styles: TableStyleDef[]; def?: string } {
  const root = rootOf(parseXml(xml), 'tblStyleLst');
  const styles: TableStyleDef[] = [];
  for (const s of findKids(root, 'tblStyle')) {
    const d: TableStyleDef = { id: attrOf(s, 'styleId') ?? '', name: attrOf(s, 'styleName') ?? '' };
    for (const k of ['wholeTbl', 'band1H', 'band2H', 'band1V', 'band2V', 'firstRow', 'lastRow', 'firstCol', 'lastCol', 'neCell', 'nwCell', 'seCell', 'swCell'] as const) {
      const p = part(findKid(s, k), ctx);
      if (p) d[k] = p;
    }
    styles.push(d);
  }
  return { styles, def: attrOf(root ?? {}, 'def') };
}

export type { Ln };
