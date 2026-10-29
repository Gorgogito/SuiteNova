import { mapNode, parseFormula, printFormula, type Node } from '@suitenova/calc-engine';

/** Functions Excel stores with the _xlfn. prefix (added after Excel 2007). */
const XLFN = new Set([
  'IFS', 'SWITCH', 'XLOOKUP', 'XMATCH', 'UNIQUE', 'SEQUENCE', 'RANDARRAY', 'SORTBY', 'TEXTJOIN', 'CONCAT', 'MAXIFS', 'MINIFS', 'IFNA', 'LET',
  'TEXTBEFORE', 'TEXTAFTER', 'TEXTSPLIT', 'TAKE', 'DROP', 'HSTACK', 'VSTACK', 'TOCOL', 'TOROW', 'CHOOSECOLS', 'CHOOSEROWS', 'NUMBERVALUE',
  'UNICHAR', 'UNICODE', 'ISOWEEKNUM', 'DAYS', 'STDEV.S', 'STDEV.P', 'VAR.S', 'VAR.P', 'MODE.SNGL', 'RANK.EQ', 'PERCENTILE.INC',
  'PERCENTILE.EXC', 'QUARTILE.INC', 'FORECAST.LINEAR', 'CEILING.MATH', 'FLOOR.MATH',
  'LAMBDA', 'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY',
  // statistics of Excel 2010
  'BINOM.DIST', 'BINOM.DIST.RANGE', 'BINOM.INV', 'CHISQ.DIST', 'CHISQ.DIST.RT', 'CHISQ.INV', 'CHISQ.INV.RT', 'CHISQ.TEST', 'CONFIDENCE.NORM', 'CONFIDENCE.T',
  'COVARIANCE.P', 'COVARIANCE.S', 'EXPON.DIST', 'F.DIST', 'F.DIST.RT', 'F.INV', 'F.INV.RT', 'F.TEST', 'GAMMA.DIST', 'GAMMA.INV', 'GAMMALN.PRECISE',
  'HYPGEOM.DIST', 'LOGNORM.DIST', 'LOGNORM.INV', 'MODE.MULT', 'NEGBINOM.DIST', 'NORM.DIST', 'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV', 'PERCENTRANK.EXC',
  'PERCENTRANK.INC', 'POISSON.DIST', 'QUARTILE.EXC', 'T.DIST', 'T.DIST.2T', 'T.DIST.RT', 'T.INV', 'T.INV.2T', 'T.TEST', 'WEIBULL.DIST', 'Z.TEST',
  'BETA.DIST', 'BETA.INV', 'ERF.PRECISE', 'ERFC.PRECISE', 'CEILING.PRECISE', 'FLOOR.PRECISE',
  // Excel 2013
  'GAMMA', 'GAUSS', 'PHI', 'SKEW.P', 'BITAND', 'BITOR', 'BITXOR', 'BITLSHIFT', 'BITRSHIFT', 'IMCOSH', 'IMCOT', 'IMCSC', 'IMCSCH', 'IMSEC', 'IMSECH', 'IMSINH', 'IMTAN',
  'ACOT', 'ACOTH', 'COT', 'COTH', 'CSC', 'CSCH', 'SEC', 'SECH', 'COMBINA', 'PERMUTATIONA', 'DECIMAL', 'BASE', 'ARABIC', 'FORMULATEXT', 'ISFORMULA', 'MUNIT',
]);
const XLWS = new Set(['FILTER', 'SORT']);

const fileName = (name: string): string => (XLWS.has(name) ? `_xlfn._xlws.${name}` : XLFN.has(name) ? `_xlfn.${name}` : name);

/** Names that LET and LAMBDA declare: Excel writes them with the _xlpm. prefix. */
function declaredNames(ast: Node): Set<string> {
  const names = new Set<string>();
  mapNode(ast, (n) => {
    if (n.t === 'call' && n.name === 'LET') {
      for (let i = 0; i < n.args.length - 1; i += 2) if (n.args[i]!.t === 'name') names.add((n.args[i] as { name: string }).name.toLowerCase());
    } else if (n.t === 'call' && n.name === 'LAMBDA') {
      for (const a of n.args.slice(0, -1)) if (a.t === 'name') names.add(a.name.toLowerCase());
    }
    return undefined;
  });
  return names;
}

function toFile(n: Node, names: Set<string>, table?: string): Node {
  return mapNode(n, (x) => {
    // Excel always writes the table's name, even for [@Col] inside the table
    if (x.t === 'tref' && x.table === undefined && table) return { ...x, table };
    if (x.t === 'call') return { ...x, name: fileName(x.name), args: x.args.map((a) => toFile(a, names, table)) };
    if (x.t === 'name' && names.has(x.name.toLowerCase())) return { ...x, name: `_xlpm.${x.name}` };
    // @ is stored as a call of SINGLE
    if (x.t === 'implicit') return { t: 'call', name: '_xlfn.SINGLE', args: [toFile(x.e, names, table)] };
    return undefined;
  });
}

/** Add the _xlfn./_xlws./_xlpm. prefixes Excel expects in files for post-2007 functions and LET/LAMBDA variables. */
export function toFileFormula(text: string, table?: string): string {
  let ast: Node;
  try {
    ast = parseFormula(text);
  } catch {
    return text;
  }
  return printFormula(toFile(ast, declaredNames(ast), table), { fileTables: true });
}
