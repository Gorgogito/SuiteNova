import { printFormula } from './formula';
import { parseFormula } from './parser';

export type FormulaLocale = 'en' | 'es';

/** English (canonical) -> Spanish function names, following Excel's Spanish localisation. */
export const ES_FUNCTIONS: Record<string, string> = {
  SUM: 'SUMA', AVERAGE: 'PROMEDIO', IF: 'SI', COUNT: 'CONTAR', COUNTA: 'CONTARA', COUNTBLANK: 'CONTAR.BLANCO',
  COUNTIF: 'CONTAR.SI', COUNTIFS: 'CONTAR.SI.CONJUNTO', SUMIF: 'SUMAR.SI', SUMIFS: 'SUMAR.SI.CONJUNTO',
  AVERAGEIF: 'PROMEDIO.SI', AVERAGEIFS: 'PROMEDIO.SI.CONJUNTO', MAXIFS: 'MAX.SI.CONJUNTO', MINIFS: 'MIN.SI.CONJUNTO',
  ROUND: 'REDONDEAR', ROUNDUP: 'REDONDEAR.MAS', ROUNDDOWN: 'REDONDEAR.MENOS', SQRT: 'RAIZ', POWER: 'POTENCIA',
  MOD: 'RESIDUO', INT: 'ENTERO', TRUNC: 'TRUNCAR', PRODUCT: 'PRODUCTO', SUMPRODUCT: 'SUMAPRODUCTO', SUMSQ: 'SUMA.CUADRADOS',
  AND: 'Y', OR: 'O', NOT: 'NO', XOR: 'XO', TRUE: 'VERDADERO', FALSE: 'FALSO', IFERROR: 'SI.ERROR', IFNA: 'SI.ND',
  IFS: 'SI.CONJUNTO', SWITCH: 'CAMBIAR', CHOOSE: 'ELEGIR', VLOOKUP: 'BUSCARV', HLOOKUP: 'BUSCARH', LOOKUP: 'BUSCAR',
  MATCH: 'COINCIDIR', INDEX: 'INDICE', XLOOKUP: 'BUSCARX', XMATCH: 'COINCIDIRX', OFFSET: 'DESREF', INDIRECT: 'INDIRECTO',
  ROW: 'FILA', COLUMN: 'COLUMNA', ROWS: 'FILAS', COLUMNS: 'COLUMNAS', TRANSPOSE: 'TRANSPONER', UNIQUE: 'UNICOS',
  SORT: 'ORDENAR', SORTBY: 'ORDENARPOR', FILTER: 'FILTRAR', SEQUENCE: 'SECUENCIA', RANDARRAY: 'MATRIZALEAT',
  TAKE: 'TOMAR', DROP: 'EXCLUIR', VSTACK: 'APILARV', HSTACK: 'APILARH', TOCOL: 'ENCOL', TOROW: 'ENFILA',
  CHOOSECOLS: 'ELEGIRCOLS', CHOOSEROWS: 'ELEGIRFILAS', ADDRESS: 'DIRECCION',
  LEN: 'LARGO', LEFT: 'IZQUIERDA', RIGHT: 'DERECHA', MID: 'EXTRAE', UPPER: 'MAYUSC', LOWER: 'MINUSC', PROPER: 'NOMPROPIO',
  TRIM: 'ESPACIOS', CLEAN: 'LIMPIAR', CONCATENATE: 'CONCATENAR', TEXTJOIN: 'UNIRCADENAS', FIND: 'ENCONTRAR',
  SEARCH: 'HALLAR', SUBSTITUTE: 'SUSTITUIR', REPLACE: 'REEMPLAZAR', REPT: 'REPETIR', EXACT: 'IGUAL', VALUE: 'VALOR',
  TEXT: 'TEXTO', CHAR: 'CARACTER', CODE: 'CODIGO', UNICHAR: 'UNICAR', TEXTBEFORE: 'TEXTOANTES', TEXTAFTER: 'TEXTODESPUES',
  TEXTSPLIT: 'DIVIDIRTEXTO', DOLLAR: 'MONEDA', FIXED: 'DECIMAL', NUMBERVALUE: 'VALOR.NUMERO',
  TODAY: 'HOY', NOW: 'AHORA', DATE: 'FECHA', YEAR: 'AÑO', MONTH: 'MES', DAY: 'DIA', HOUR: 'HORA', MINUTE: 'MINUTO',
  SECOND: 'SEGUNDO', TIME: 'NSHORA', WEEKDAY: 'DIASEM', WEEKNUM: 'NUM.DE.SEMANA', ISOWEEKNUM: 'ISO.NUM.DE.SEMANA',
  EDATE: 'FECHA.MES', EOMONTH: 'FIN.MES', DATEDIF: 'SIFECHA', DAYS: 'DIAS', NETWORKDAYS: 'DIAS.LAB', WORKDAY: 'DIA.LAB',
  DATEVALUE: 'FECHANUMERO', TIMEVALUE: 'HORANUMERO', YEARFRAC: 'FRAC.AÑO',
  ISBLANK: 'ESBLANCO', ISERROR: 'ESERROR', ISERR: 'ESERR', ISNA: 'ESNOD', ISNUMBER: 'ESNUMERO', ISTEXT: 'ESTEXTO',
  ISNONTEXT: 'ESNOTEXTO', ISLOGICAL: 'ESLOGICO', ISEVEN: 'ES.PAR', ISODD: 'ES.IMPAR', ISREF: 'ESREF', NA: 'NOD', TYPE: 'TIPO',
  MEDIAN: 'MEDIANA', MODE: 'MODA', 'MODE.SNGL': 'MODA.UNO', LARGE: 'K.ESIMO.MAYOR', SMALL: 'K.ESIMO.MENOR', RANK: 'JERARQUIA',
  'RANK.EQ': 'JERARQUIA.EQV', STDEV: 'DESVEST', 'STDEV.S': 'DESVEST.M', 'STDEV.P': 'DESVEST.P', STDEVP: 'DESVESTP',
  'VAR.S': 'VAR.S', 'VAR.P': 'VAR.P', VARP: 'VARP', PERCENTILE: 'PERCENTIL', 'PERCENTILE.INC': 'PERCENTIL.INC',
  'PERCENTILE.EXC': 'PERCENTIL.EXC', QUARTILE: 'CUARTIL', 'QUARTILE.INC': 'CUARTIL.INC', CORREL: 'COEF.DE.CORREL',
  SLOPE: 'PENDIENTE', INTERCEPT: 'INTERSECCION.EJE', FORECAST: 'PRONOSTICO', 'FORECAST.LINEAR': 'PRONOSTICO.LINEAL',
  PMT: 'PAGO', IPMT: 'PAGOINT', PPMT: 'PAGOPRIN', FV: 'VF', PV: 'VA', NPV: 'VNA', IRR: 'TIR', RATE: 'TASA', SLN: 'SLN',
  RAND: 'ALEATORIO', RANDBETWEEN: 'ALEATORIO.ENTRE', SIGN: 'SIGNO', FACT: 'FACT', GCD: 'M.C.D', LCM: 'M.C.M',
  CEILING: 'MULTIPLO.SUPERIOR', FLOOR: 'MULTIPLO.INFERIOR', MROUND: 'REDOND.MULT', EVEN: 'REDONDEA.PAR', ODD: 'REDONDEA.IMPAR',
  SIN: 'SENO', ASIN: 'ASENO', ATAN2: 'ATAN2', DEGREES: 'GRADOS', RADIANS: 'RADIANES', QUOTIENT: 'COCIENTE',
  SUBTOTAL: 'SUBTOTALES', SHEET: 'HOJA', SHEETS: 'HOJAS',
};

// Statistical distributions, database, engineering, cube and other functions added later.
Object.assign(ES_FUNCTIONS, {
  'NORM.DIST': 'DISTR.NORM.N', 'NORM.INV': 'INV.NORM', 'NORM.S.DIST': 'DISTR.NORM.ESTAND.N', 'NORM.S.INV': 'INV.NORM.ESTAND',
  NORMDIST: 'DISTR.NORM', NORMINV: 'DISTR.NORM.INV', NORMSDIST: 'DISTR.NORM.ESTAND', NORMSINV: 'DISTR.NORM.ESTAND.INV',
  'LOGNORM.DIST': 'DISTR.LOGNORM', 'LOGNORM.INV': 'INV.LOGNORM', LOGNORMDIST: 'DISTR.LOG.NORM', LOGINV: 'DISTR.LOG.INV',
  STANDARDIZE: 'NORMALIZACION', PHI: 'FI',
  'T.DIST': 'DISTR.T.N', 'T.DIST.2T': 'DISTR.T.2C', 'T.DIST.RT': 'DISTR.T.CD', 'T.INV': 'INV.T', 'T.INV.2T': 'INV.T.2C', TDIST: 'DISTR.T', TINV: 'DISTR.T.INV',
  'T.TEST': 'PRUEBA.T.N', TTEST: 'PRUEBA.T',
  'CHISQ.DIST': 'DISTR.CHICUAD', 'CHISQ.DIST.RT': 'DISTR.CHICUAD.CD', 'CHISQ.INV': 'INV.CHICUAD', 'CHISQ.INV.RT': 'INV.CHICUAD.CD', 'CHISQ.TEST': 'PRUEBA.CHICUAD',
  CHIDIST: 'DISTR.CHI', CHIINV: 'PRUEBA.CHI.INV', CHITEST: 'PRUEBA.CHI',
  'F.DIST': 'DISTR.F.N', 'F.DIST.RT': 'DISTR.F.CD', 'F.INV': 'INV.F', 'F.INV.RT': 'INV.F.CD', 'F.TEST': 'PRUEBA.F.N', FDIST: 'DISTR.F', FINV: 'DISTR.F.INV', FTEST: 'PRUEBA.F',
  'BINOM.DIST': 'DISTR.BINOM.N', 'BINOM.DIST.RANGE': 'DISTR.BINOM.SERIE', 'BINOM.INV': 'INV.BINOM', BINOMDIST: 'DISTR.BINOM', CRITBINOM: 'BINOM.CRIT',
  'NEGBINOM.DIST': 'NEGBINOM.DIST', NEGBINOMDIST: 'NEGBINOMDIST', 'POISSON.DIST': 'POISSON.DIST', POISSON: 'POISSON',
  'HYPGEOM.DIST': 'DISTR.HIPERGEOM.N', HYPGEOMDIST: 'DISTR.HIPERGEOM',
  'EXPON.DIST': 'DISTR.EXP.N', EXPONDIST: 'DISTR.EXP', 'GAMMA.DIST': 'DISTR.GAMMA.N', GAMMADIST: 'DISTR.GAMMA', 'GAMMA.INV': 'INV.GAMMA', GAMMAINV: 'DISTR.GAMMA.INV',
  GAMMA: 'GAMMA', GAMMALN: 'GAMMA.LN', 'GAMMALN.PRECISE': 'GAMMA.LN.EXACTO',
  'BETA.DIST': 'DISTR.BETA.N', BETADIST: 'DISTR.BETA', 'BETA.INV': 'INV.BETA.N', BETAINV: 'DISTR.BETA.INV',
  'WEIBULL.DIST': 'DISTR.WEIBULL', WEIBULL: 'DIST.WEIBULL', 'Z.TEST': 'PRUEBA.Z.N', ZTEST: 'PRUEBA.Z',
  'CONFIDENCE.NORM': 'INTERVALO.CONFIANZA.NORM', CONFIDENCE: 'INTERVALO.CONFIANZA', 'CONFIDENCE.T': 'INTERVALO.CONFIANZA.T',
  FISHER: 'FISHER', FISHERINV: 'PRUEBA.FISHER.INV',
  'COVARIANCE.P': 'COVARIANZA.P', 'COVARIANCE.S': 'COVARIANZA.M', COVAR: 'COVAR', PEARSON: 'PEARSON', RSQ: 'COEFICIENTE.R2', STEYX: 'ERROR.TIPICO.XY',
  SUMX2MY2: 'SUMAX2MENOSY2', SUMX2PY2: 'SUMAX2MASY2', SUMXMY2: 'SUMAXMENOSY2',
  GEOMEAN: 'MEDIA.GEOM', HARMEAN: 'MEDIA.ARMO', DEVSQ: 'DESVIA2', AVEDEV: 'DESVPROM', SKEW: 'COEFICIENTE.ASIMETRIA', 'SKEW.P': 'COEFICIENTE.ASIMETRIA.P',
  KURT: 'CURTOSIS', TRIMMEAN: 'MEDIA.ACOTADA', AVERAGEA: 'PROMEDIOA', MAXA: 'MAXA', MINA: 'MINA', STDEVA: 'DESVESTA', STDEVPA: 'DESVESTPA', VARA: 'VARA', VARPA: 'VARPA',
  PERCENTRANK: 'RANGO.PERCENTIL', 'PERCENTRANK.INC': 'RANGO.PERCENTIL.INC', 'PERCENTRANK.EXC': 'RANGO.PERCENTIL.EXC', PROB: 'PROBABILIDAD', FREQUENCY: 'FRECUENCIA',
  'MODE.MULT': 'MODA.VARIOS', LINEST: 'ESTIMACION.LINEAL', LOGEST: 'ESTIMACION.LOGARITMICA', TREND: 'TENDENCIA', GROWTH: 'CRECIMIENTO',
  MMULT: 'MMULT', MINVERSE: 'MINVERSA', MDETERM: 'MDETERM', MUNIT: 'M.UNIDAD',
  COMBIN: 'COMBINAT', COMBINA: 'COMBINA', PERMUT: 'PERMUTACIONES', PERMUTATIONA: 'PERMUTACIONES.A', FACTDOUBLE: 'FACT.DOBLE', MULTINOMIAL: 'MULTINOMIAL', SQRTPI: 'RAIZ2PI',
  ACOSH: 'ACOSH', ASINH: 'ASENOH', ATANH: 'ATANH', COT: 'COT', COTH: 'COTH', CSC: 'CSC', CSCH: 'CSCH', SEC: 'SEC', SECH: 'SECH', ACOT: 'ACOT', ACOTH: 'ACOTH',
  ROMAN: 'NUMERO.ROMANO', ARABIC: 'NUMERO.ARABE', BASE: 'BASE', DECIMAL: 'CONV.DECIMAL', SERIESSUM: 'SUMA.SERIES',
  HYPERLINK: 'HIPERVINCULO', AREAS: 'AREAS', FORMULATEXT: 'FORMULATEXTO', ISFORMULA: 'ESFORMULA',
  DSUM: 'BDSUMA', DAVERAGE: 'BDPROMEDIO', DCOUNT: 'BDCONTAR', DCOUNTA: 'BDCONTARA', DGET: 'BDEXTRAER', DMAX: 'BDMAX', DMIN: 'BDMIN', DPRODUCT: 'BDPRODUCTO',
  DSTDEV: 'BDDESVEST', DSTDEVP: 'BDDESVESTP', DVAR: 'BDVAR', DVARP: 'BDVARP',
  BIN2DEC: 'BIN.A.DEC', BIN2HEX: 'BIN.A.HEX', BIN2OCT: 'BIN.A.OCT', DEC2BIN: 'DEC.A.BIN', DEC2HEX: 'DEC.A.HEX', DEC2OCT: 'DEC.A.OCT',
  HEX2BIN: 'HEX.A.BIN', HEX2DEC: 'HEX.A.DEC', HEX2OCT: 'HEX.A.OCT', OCT2BIN: 'OCT.A.BIN', OCT2DEC: 'OCT.A.DEC', OCT2HEX: 'OCT.A.HEX',
  BITAND: 'BIT.Y', BITOR: 'BIT.O', BITXOR: 'BIT.XO', BITLSHIFT: 'BIT.DESPLIZQDA', BITRSHIFT: 'BIT.DESPLDCHA',
  DELTA: 'DELTA', GESTEP: 'MAYOR.O.IGUAL', ERF: 'FUN.ERROR', 'ERF.PRECISE': 'FUN.ERROR.EXACTO', ERFC: 'FUN.ERROR.COMPL', 'ERFC.PRECISE': 'FUN.ERROR.COMPL.EXACTO',
  BESSELI: 'BESSELI', BESSELJ: 'BESSELJ', BESSELK: 'BESSELK', BESSELY: 'BESSELY', CONVERT: 'CONVERTIR',
  COMPLEX: 'COMPLEJO', IMREAL: 'IM.REAL', IMAGINARY: 'IMAGINARIO', IMABS: 'IM.ABS', IMARGUMENT: 'IM.ANGULO', IMCONJUGATE: 'IM.CONJUGADA',
  IMSUM: 'IM.SUM', IMSUB: 'IM.SUSTR', IMPRODUCT: 'IM.PRODUCT', IMDIV: 'IM.DIV', IMPOWER: 'IM.POT', IMSQRT: 'IM.RAIZ2', IMEXP: 'IM.EXP', IMLN: 'IM.LN',
  IMLOG10: 'IM.LOG10', IMLOG2: 'IM.LOG2', IMSIN: 'IM.SENO', IMCOS: 'IM.COS', IMTAN: 'IM.TAN', IMSEC: 'IM.SEC', IMCSC: 'IM.CSC', IMCOT: 'IM.COT',
  IMSINH: 'IM.SENOH', IMCOSH: 'IM.COSH', IMSECH: 'IM.SECH', IMCSCH: 'IM.CSCH',
  CUBEVALUE: 'VALORCUBO', CUBEMEMBER: 'MIEMBROCUBO', CUBESET: 'CONJUNTOCUBO', CUBESETCOUNT: 'RECUENTOCONJUNTOCUBO', CUBERANKEDMEMBER: 'MIEMBROCUBORANGO',
  CUBEKPIMEMBER: 'MIEMBROKPICUBO', CUBEMEMBERPROPERTY: 'PROPIEDADMIEMBROCUBO', GETPIVOTDATA: 'IMPORTARDATOSDINAMICOS',
});

const EN_FROM_ES =new Map<string, string>(Object.entries(ES_FUNCTIONS).map(([en, es]) => [es.toUpperCase(), en]));

export const localizedFunctionName = (en: string, loc: FormulaLocale): string => (loc === 'es' ? (ES_FUNCTIONS[en] ?? en) : en);
export const canonicalFunctionName = (name: string, loc: FormulaLocale): string => {
  const up = name.toUpperCase();
  return loc === 'es' ? (EN_FROM_ES.get(up) ?? up) : up;
};

/** Canonical formula body (no "=") -> text in the display locale. Unparseable input is returned unchanged. */
export function localizeFormula(text: string, loc: FormulaLocale): string {
  if (loc === 'en') return text;
  try {
    return printFormula(parseFormula(text), { sep: ';', dec: ',', fn: (n) => localizedFunctionName(n, 'es'), bool: ['VERDADERO', 'FALSO'] });
  } catch {
    return text;
  }
}

const IDENT_START = /[A-Za-z_$À-￿]/;
const IDENT_PART = /[A-Za-z0-9_.$À-￿]/;

/** Text typed in the display locale (without "=") -> canonical English syntax. */
export function canonicalFormula(text: string, loc: FormulaLocale): string {
  if (loc === 'en') return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "'") {
      let j = i + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '#') {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9/!?¡¿]/.test(text[j]!)) j++;
      out += text.slice(i, j);
      i = j;
    } else if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENT_PART.test(text[j]!)) j++;
      const word = text.slice(i, j);
      if (text[j] === '(') out += canonicalFunctionName(word, loc);
      else if (word.toUpperCase() === 'VERDADERO') out += 'TRUE';
      else if (word.toUpperCase() === 'FALSO') out += 'FALSE';
      else out += word;
      i = j;
    } else if (/[0-9]/.test(ch) || (ch === ',' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let j = i;
      while (j < text.length && /[0-9]/.test(text[j]!)) j++;
      let num = text.slice(i, j);
      if (text[j] === ',' && /[0-9]/.test(text[j + 1] ?? '')) {
        j++;
        const k = j;
        while (j < text.length && /[0-9]/.test(text[j]!)) j++;
        num += '.' + text.slice(k, j);
      } else if (num === '' && text[i] === ',') {
        // ",5" -> ".5"
        j = i + 1;
        const k = j;
        while (j < text.length && /[0-9]/.test(text[j]!)) j++;
        num = '.' + text.slice(k, j);
      }
      out += num;
      i = j;
    } else if (ch === ';') {
      out += ',';
      i++;
    } else if (ch === '\\') {
      out += ',';
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
