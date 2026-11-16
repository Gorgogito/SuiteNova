import { NS } from '../datamodel';

/*
 * Catálogo propio de diseños de SmartArt, escritos en el lenguaje `layoutDef` (los diseños incorporados de Office no se empaquetan).
 * Los identificadores son nuestros (`urn:suitenova/layout/…`): al abrir el archivo en PowerPoint se usa el diseño que lleva dentro.
 * Los diseños de varios niveles o con piezas por posición (jerarquía, pirámide, Venn, matriz) se generan con funciones.
 */

export interface CatalogLayout {
  id: string;
  name: string;
  description: string;
  category: 'list' | 'process' | 'cycle' | 'hierarchy' | 'relationship' | 'matrix' | 'pyramid';
  /** Texto de ejemplo para la galería: un nodo por línea, un tabulador por nivel. */
  sample: string;
  xml: string;
}

const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const head = (id: string, title: string, desc: string, cat: string, pri: number): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:layoutDef xmlns:dgm="${NS.dgm}" xmlns:a="${NS.a}" ${R} uniqueId="${id}"><dgm:title val="${title}"/><dgm:desc val="${desc}"/><dgm:catLst><dgm:cat type="${cat}" pri="${pri}"/></dgm:catLst>`;
const shape = (type?: string, adj?: [number, number]) => `<dgm:shape${type ? ` type="${type}"` : ''} r:blip=""><dgm:adjLst>${adj ? `<dgm:adj idx="${adj[0]}" val="${adj[1]}"/>` : ''}</dgm:adjLst></dgm:shape>`;
const marg = (f: number) => ['l', 'r', 't', 'b'].map((s) => `<dgm:constr type="${s}Marg" refType="primFontSz" fact="${f}"/>`).join('');
const dirChoose = (a: string, b: string) => `<dgm:choose name="dir"><dgm:if name="n" func="var" arg="dir" op="equ" val="norm">${a}</dgm:if><dgm:else name="r">${b}</dgm:else></dgm:choose>`;

// ---- lista de bloques (snake)
const blockList = (): string =>
  head('urn:suitenova/layout/blocklist', 'Lista de bloques', 'Bloques en filas, para información sin orden', 'list', 100) +
  `<dgm:layoutNode name="diagram"><dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>` +
  dirChoose('<dgm:alg type="snake"><dgm:param type="grDir" val="tL"/><dgm:param type="flowDir" val="row"/><dgm:param type="contDir" val="sameDir"/><dgm:param type="off" val="ctr"/></dgm:alg>', '<dgm:alg type="snake"><dgm:param type="grDir" val="tR"/><dgm:param type="flowDir" val="row"/><dgm:param type="contDir" val="sameDir"/><dgm:param type="off" val="ctr"/></dgm:alg>') +
  `${shape()}<dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="node" refType="w"/><dgm:constr type="h" for="ch" forName="node" refType="w" refFor="ch" refForName="node" fact="0.6"/><dgm:constr type="w" for="ch" forName="gap" refType="w" refFor="ch" refForName="node" fact="0.1"/><dgm:constr type="sp" refType="w" refFor="ch" refForName="gap"/><dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/></dgm:constrLst><dgm:ruleLst/>` +
  `<dgm:forEach name="each" axis="ch" ptType="node"><dgm:layoutNode name="node"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/>${shape('rect')}<dgm:presOf axis="desOrSelf" ptType="node"/><dgm:constrLst>${marg(0.3)}</dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode>` +
  `<dgm:forEach name="between" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="gap"><dgm:alg type="sp"/>${shape()}<dgm:presOf/></dgm:layoutNode></dgm:forEach></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`;

// ---- proceso básico (lin + flechas)
const process = (): string =>
  head('urn:suitenova/layout/process', 'Proceso básico', 'Pasos unidos por flechas', 'process', 100) +
  `<dgm:layoutNode name="diagram"><dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>` +
  dirChoose('<dgm:alg type="lin"/>', '<dgm:alg type="lin"><dgm:param type="linDir" val="fromR"/></dgm:alg>') +
  `${shape()}<dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="node" refType="w"/><dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/><dgm:constr type="w" for="ch" forName="arrow" refType="w" refFor="ch" refForName="node" fact="0.4"/></dgm:constrLst>` +
  `<dgm:forEach name="each" axis="ch" ptType="node"><dgm:layoutNode name="node"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/>${shape('roundRect', [1, 0.1])}<dgm:presOf axis="desOrSelf" ptType="node"/><dgm:constrLst><dgm:constr type="h" refType="w" fact="0.6"/>${marg(0.3)}</dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode>` +
  `<dgm:forEach name="between" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="arrow"><dgm:alg type="conn"/>${shape('conn')}<dgm:presOf axis="self"/><dgm:constrLst><dgm:constr type="h" refType="w" fact="0.62"/><dgm:constr type="connDist"/></dgm:constrLst></dgm:layoutNode></dgm:forEach></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`;

// ---- lista vertical (barras apiladas; los subniveles van dentro como viñetas)
const verticalList = (): string =>
  head('urn:suitenova/layout/vlist', 'Lista vertical', 'Barras apiladas; los subniveles salen como viñetas', 'list', 200) +
  `<dgm:layoutNode name="diagram"><dgm:varLst><dgm:animLvl val="lvl"/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:alg type="lin"><dgm:param type="linDir" val="fromT"/><dgm:param type="vertAlign" val="mid"/></dgm:alg>${shape()}<dgm:presOf/>` +
  `<dgm:constrLst><dgm:constr type="w" for="ch" forName="bar" refType="w"/><dgm:constr type="h" for="ch" forName="bar" refType="w" fact="0.16"/><dgm:constr type="w" for="ch" forName="gap" refType="w" fact="0.01"/><dgm:constr type="h" for="ch" forName="gap" refType="w" fact="0.012"/><dgm:constr type="primFontSz" for="ch" forName="bar" op="equ" val="65"/></dgm:constrLst>` +
  `<dgm:forEach name="each" axis="ch" ptType="node"><dgm:layoutNode name="bar"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/>${shape('roundRect', [1, 0.12])}<dgm:presOf axis="desOrSelf" ptType="node"/><dgm:constrLst>${marg(0.3)}</dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode>` +
  `<dgm:forEach name="between" axis="followSib" ptType="sibTrans" cnt="1"><dgm:layoutNode name="gap"><dgm:alg type="sp"/>${shape()}<dgm:presOf/></dgm:layoutNode></dgm:forEach></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`;

// ---- ciclo básico
const cycle = (): string =>
  head('urn:suitenova/layout/cycle', 'Ciclo básico', 'Pasos en círculo con flechas', 'cycle', 100) +
  `<dgm:layoutNode name="diagram"><dgm:varLst><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:varLst>` +
  `<dgm:choose name="dir"><dgm:if name="n" func="var" arg="dir" op="equ" val="norm"><dgm:choose name="few"><dgm:if name="m" func="cnt" axis="ch" ptType="node" op="gt" val="2"><dgm:alg type="cycle"><dgm:param type="stAng" val="0"/><dgm:param type="spanAng" val="360"/></dgm:alg></dgm:if><dgm:else name="f"><dgm:alg type="cycle"><dgm:param type="stAng" val="-90"/><dgm:param type="spanAng" val="360"/></dgm:alg></dgm:else></dgm:choose></dgm:if>` +
  `<dgm:else name="r"><dgm:choose name="few2"><dgm:if name="m2" func="cnt" axis="ch" ptType="node" op="gt" val="2"><dgm:alg type="cycle"><dgm:param type="stAng" val="0"/><dgm:param type="spanAng" val="-360"/></dgm:alg></dgm:if><dgm:else name="f2"><dgm:alg type="cycle"><dgm:param type="stAng" val="90"/><dgm:param type="spanAng" val="-360"/></dgm:alg></dgm:else></dgm:choose></dgm:else></dgm:choose>` +
  `${shape()}<dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="node" refType="w"/><dgm:constr type="w" for="ch" forName="arrow" refType="w" refFor="ch" refForName="node" fact="0.25"/><dgm:constr type="sibSp" refType="w" refFor="ch" refForName="node" fact="0.5"/><dgm:constr type="primFontSz" for="ch" forName="node" op="equ" val="65"/></dgm:constrLst>` +
  `<dgm:forEach name="each" axis="ch" ptType="node"><dgm:layoutNode name="node"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/>${shape('ellipse')}<dgm:presOf axis="desOrSelf" ptType="node"/><dgm:constrLst><dgm:constr type="h" refType="w"/>${['l', 'r', 't', 'b'].map((s) => `<dgm:constr type="${s}Marg" refType="primFontSz" fact="0.1"/>`).join('')}</dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode>` +
  `<dgm:choose name="more"><dgm:if name="m3" func="cnt" axis="par ch" ptType="doc node" op="gt" val="1"><dgm:forEach name="between" axis="followSib" ptType="sibTrans" cnt="1" hideLastTrans="0"><dgm:layoutNode name="arrow"><dgm:alg type="conn"/>${shape('conn')}<dgm:presOf axis="self"/><dgm:constrLst><dgm:constr type="h" refType="w" fact="1.35"/><dgm:constr type="connDist"/></dgm:constrLst></dgm:layoutNode></dgm:forEach></dgm:if></dgm:choose></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`;

// ---- jerarquía (organigrama): un nivel por función, hasta 4 niveles
function hierarchyLevel(l: number, last: number): string {
  const sfx = (k: number) => (k === 1 ? '' : String(k));
  const n = l === 1 ? '' : String(l);
  const lbl = l === 1 ? ' styleLbl="node0"' : '';
  const inner = `<dgm:layoutNode name="composite${n}"><dgm:alg type="composite"/>${shape()}<dgm:presOf/><dgm:constrLst><dgm:constr type="w" for="ch" forName="background${n}" refType="w" fact="0.9"/><dgm:constr type="h" for="ch" forName="background${n}" refType="w" refFor="ch" refForName="background${n}" fact="0.635"/><dgm:constr type="t" for="ch" forName="background${n}"/><dgm:constr type="l" for="ch" forName="background${n}"/><dgm:constr type="w" for="ch" forName="text${n}" refType="w" fact="0.9"/><dgm:constr type="h" for="ch" forName="text${n}" refType="w" refFor="ch" refForName="text${n}" fact="0.635"/><dgm:constr type="t" for="ch" forName="text${n}" refType="w" fact="0.095"/><dgm:constr type="l" for="ch" forName="text${n}" refType="w" fact="0.1"/></dgm:constrLst>` +
    `<dgm:layoutNode name="background${n}"${lbl}><dgm:alg type="sp"/>${shape('roundRect', [1, 0.1])}<dgm:presOf/></dgm:layoutNode>` +
    `<dgm:layoutNode name="text${n}" styleLbl="fgAcc${l === 1 ? 0 : l}"><dgm:varLst><dgm:chPref val="3"/></dgm:varLst><dgm:alg type="tx"/>${shape('roundRect', [1, 0.1])}<dgm:presOf axis="self"/><dgm:constrLst>${marg(0.3)}</dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode></dgm:layoutNode>`;
  const kids =
    l >= last
      ? ''
      : `<dgm:layoutNode name="hierChild${l + 1}"><dgm:alg type="hierChild"/>${shape()}<dgm:presOf/><dgm:forEach name="k${l + 1}" axis="ch" ptType="all"><dgm:forEach name="p${l + 1}" axis="self" ptType="parTrans" cnt="1"><dgm:layoutNode name="link${l + 1}"><dgm:alg type="conn"><dgm:param type="dim" val="1D"/><dgm:param type="endSty" val="noArr"/><dgm:param type="connRout" val="bend"/><dgm:param type="bendPt" val="end"/><dgm:param type="begPts" val="bCtr"/><dgm:param type="endPts" val="tCtr"/><dgm:param type="srcNode" val="background${sfx(l)}"/><dgm:param type="dstNode" val="background${sfx(l + 1)}"/></dgm:alg><dgm:shape type="conn" zOrderOff="-999" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/><dgm:constrLst><dgm:constr type="begPad"/><dgm:constr type="endPad"/></dgm:constrLst></dgm:layoutNode></dgm:forEach><dgm:forEach name="c${l + 1}" axis="self" ptType="node">${hierarchyLevel(l + 1, last)}</dgm:forEach></dgm:forEach></dgm:layoutNode>`;
  return `<dgm:layoutNode name="hierRoot${l}"><dgm:alg type="hierRoot"/>${shape()}<dgm:presOf/>${inner}${kids}</dgm:layoutNode>`;
}

const hierarchy = (): string => {
  const levels = 4;
  const sfx = (l: number) => (l === 1 ? '' : String(l));
  const cs: string[] = ['<dgm:constr type="primFontSz" for="des" ptType="node" op="equ" val="65"/>'];
  for (let l = 1; l <= levels; l++) {
    cs.push(
      l === 1
        ? '<dgm:constr type="w" for="des" forName="composite" refType="w"/><dgm:constr type="h" for="des" forName="composite" refType="w" refFor="des" refForName="composite" fact="0.667"/>'
        : `<dgm:constr type="w" for="des" forName="composite${sfx(l)}" refType="w" refFor="des" refForName="composite"/><dgm:constr type="h" for="des" forName="composite${sfx(l)}" refType="h" refFor="des" refForName="composite"/>`,
    );
  }
  cs.push('<dgm:constr type="sibSp" refType="w" refFor="des" refForName="composite" fact="0.1"/>');
  for (let l = 2; l <= levels; l++) cs.push(`<dgm:constr type="sibSp" for="des" forName="hierChild${l}" refType="sibSp"/>`);
  cs.push('<dgm:constr type="sp" for="des" forName="hierRoot1" refType="h" refFor="des" refForName="composite" fact="0.25"/>');
  for (let l = 2; l <= levels; l++) cs.push(`<dgm:constr type="sp" for="des" forName="hierRoot${l}" refType="sp" refFor="des" refForName="hierRoot1"/>`);
  return (
    head('urn:suitenova/layout/hierarchy', 'Organigrama', 'Jerarquía de arriba abajo con líneas de unión', 'hierarchy', 100) +
    `<dgm:layoutNode name="hierChild1"><dgm:varLst><dgm:chPref val="1"/><dgm:dir/><dgm:animOne val="branch"/><dgm:animLvl val="lvl"/></dgm:varLst><dgm:alg type="hierChild"/>${shape()}<dgm:presOf/><dgm:constrLst>${cs.join('')}</dgm:constrLst>` +
    `<dgm:forEach name="top" axis="ch" ptType="all"><dgm:forEach name="topNode" axis="self" ptType="node">${hierarchyLevel(1, levels)}</dgm:forEach></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`
  );
};

// ---- pirámide
const pyramid = (): string =>
  head('urn:suitenova/layout/pyramid', 'Pirámide básica', 'Niveles apilados, del vértice a la base', 'pyramid', 100) +
  `<dgm:layoutNode name="diagram"><dgm:varLst><dgm:animLvl val="lvl"/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:alg type="pyra"><dgm:param type="linDir" val="fromB"/></dgm:alg>${shape()}<dgm:presOf/>` +
  `<dgm:constrLst><dgm:constr type="primFontSz" for="des" forName="levelTx" op="equ"/></dgm:constrLst>` +
  `<dgm:forEach name="each" axis="ch" ptType="node"><dgm:layoutNode name="tier"><dgm:alg type="composite"/>${shape()}<dgm:presOf/>` +
  `<dgm:constrLst><dgm:constr type="ctrX" for="ch" forName="levelTx" refType="ctrX" refFor="ch" refForName="level"/><dgm:constr type="ctrY" for="ch" forName="levelTx" refType="ctrY" refFor="ch" refForName="level"/><dgm:constr type="w" for="ch" forName="levelTx" refType="w" refFor="ch" refForName="level" fact="0.65"/><dgm:constr type="h" for="ch" forName="levelTx" refType="h" refFor="ch" refForName="level"/></dgm:constrLst>` +
  `<dgm:layoutNode name="level"><dgm:alg type="sp"/>${shape('trapezoid')}<dgm:presOf axis="self"/></dgm:layoutNode>` +
  `<dgm:layoutNode name="levelTx"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/><dgm:shape type="rect" hideGeom="1" r:blip=""><dgm:adjLst/></dgm:shape><dgm:presOf axis="self"/><dgm:constrLst>${['l', 'r', 't', 'b'].map((s) => `<dgm:constr type="${s}Marg" refType="primFontSz" fact="0.1"/>`).join('')}<dgm:constr type="primFontSz" val="65"/></dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode></dgm:layoutNode></dgm:forEach></dgm:layoutNode></dgm:layoutDef>`;

// ---- Venn: de 1 a 5 círculos que se solapan, cada número con sus propias posiciones
const venn = (): string => {
  const algs: string[] = [];
  const cons: string[] = [];
  const nodes: string[] = [];
  for (let n = 1; n <= 5; n++) {
    const ar = n === 2 ? 1.6 : 1;
    const d = n <= 2 ? 0.9 : n === 3 ? 0.55 : n === 4 ? 0.5 : 0.46;
    const ring = n === 3 ? 0.2 : n === 4 ? 0.2 : n === 5 ? 0.22 : 0;
    const cond = `func="cnt" axis="ch" ptType="node" op="equ" val="${n}"`;
    algs.push(`<dgm:if name="a${n}" ${cond}><dgm:alg type="composite"><dgm:param type="ar" val="${ar}"/></dgm:alg></dgm:if>`);
    let cs = '';
    for (let i = 1; i <= n; i++) {
      const ang = -Math.PI / 2 + ((i - 1) * 2 * Math.PI) / n;
      const cx = n === 1 ? 0.5 : n === 2 ? (i === 1 ? 0.32 : 0.68) : 0.5 + ring * Math.cos(ang);
      const cy = n <= 2 ? 0.5 : 0.5 + ring * Math.sin(ang);
      // el diámetro se mide contra el alto: un círculo es tan ancho como alto
      cs += `<dgm:constr type="ctrX" for="ch" forName="circ${i}" refType="w" fact="${cx.toFixed(4)}"/><dgm:constr type="ctrY" for="ch" forName="circ${i}" refType="h" fact="${cy.toFixed(4)}"/><dgm:constr type="h" for="ch" forName="circ${i}" refType="h" fact="${d}"/><dgm:constr type="w" for="ch" forName="circ${i}" refType="h" fact="${d}"/>`;
    }
    cons.push(`<dgm:if name="p${n}" ${cond}><dgm:constrLst>${cs}<dgm:constr type="primFontSz" for="ch" op="equ" val="65"/></dgm:constrLst></dgm:if>`);
  }
  // cada círculo se define una sola vez (los nombres de nodo deben ser únicos); si no hay tantos datos, el forEach no da nada
  for (let i = 1; i <= 5; i++) {
    nodes.push(`<dgm:forEach name="c${i}" axis="ch" ptType="node" st="${i}" cnt="1"><dgm:layoutNode name="circ${i}" styleLbl="vennNode1"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/>${shape('ellipse')}<dgm:presOf axis="desOrSelf" ptType="node"/><dgm:constrLst>${['l', 'r', 't', 'b'].map((q) => `<dgm:constr type="${q}Marg" refType="primFontSz" fact="0.1"/>`).join('')}</dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode></dgm:forEach>`);
  }
  return (
    head('urn:suitenova/layout/venn', 'Venn básico', 'Círculos que se solapan (de 1 a 5)', 'relationship', 100) +
    `<dgm:layoutNode name="diagram"><dgm:varLst><dgm:chMax val="5"/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:choose name="alg">${algs.join('')}<dgm:else name="ae"><dgm:alg type="composite"><dgm:param type="ar" val="1"/></dgm:alg></dgm:else></dgm:choose>${shape()}<dgm:presOf/><dgm:choose name="cons">${cons.join('')}</dgm:choose>${nodes.join('')}</dgm:layoutNode></dgm:layoutDef>`
  );
};

// ---- matriz: hasta cuatro piezas en 2 x 2
const matrix = (): string => {
  const pos = [
    [0.02, 0.02],
    [0.52, 0.02],
    [0.02, 0.52],
    [0.52, 0.52],
  ];
  const cs: string[] = [];
  const tiles: string[] = [];
  pos.forEach(([x, y], i) => {
    const k = i + 1;
    cs.push(`<dgm:constr type="l" for="ch" forName="tile${k}" refType="w" fact="${x}"/><dgm:constr type="t" for="ch" forName="tile${k}" refType="h" fact="${y}"/><dgm:constr type="w" for="ch" forName="tile${k}" refType="w" fact="0.46"/><dgm:constr type="h" for="ch" forName="tile${k}" refType="h" fact="0.46"/>`);
    tiles.push(`<dgm:forEach name="t${k}" axis="ch" ptType="node" st="${k}" cnt="1"><dgm:layoutNode name="tile${k}"><dgm:varLst><dgm:bulletEnabled val="1"/></dgm:varLst><dgm:alg type="tx"/>${shape('roundRect', [1, 0.1])}<dgm:presOf axis="desOrSelf" ptType="node"/><dgm:constrLst>${marg(0.3)}</dgm:constrLst><dgm:ruleLst><dgm:rule type="primFontSz" val="5"/></dgm:ruleLst></dgm:layoutNode></dgm:forEach>`);
  });
  return (
    head('urn:suitenova/layout/matrix', 'Matriz básica', 'Hasta cuatro cuadros en dos filas', 'matrix', 100) +
    `<dgm:layoutNode name="diagram"><dgm:varLst><dgm:chMax val="4"/><dgm:resizeHandles val="exact"/></dgm:varLst><dgm:alg type="composite"/>${shape()}<dgm:presOf/><dgm:constrLst>${cs.join('')}<dgm:constr type="primFontSz" for="ch" op="equ" val="65"/></dgm:constrLst>${tiles.join('')}</dgm:layoutNode></dgm:layoutDef>`
  );
};

const mk = (id: string, name: string, description: string, category: CatalogLayout['category'], sample: string, xml: string): CatalogLayout => ({ id, name, description, category, sample, xml });

export const LAYOUT_CATALOG: CatalogLayout[] = [
  mk('urn:suitenova/layout/blocklist', 'Lista de bloques', 'Bloques en filas, para información sin orden', 'list', 'Uno\nDos\nTres\nCuatro\nCinco', blockList()),
  mk('urn:suitenova/layout/vlist', 'Lista vertical', 'Barras apiladas; los subniveles salen como viñetas', 'list', 'Uno\n\tdetalle\nDos\nTres', verticalList()),
  mk('urn:suitenova/layout/process', 'Proceso básico', 'Pasos unidos por flechas', 'process', 'Uno\nDos\nTres', process()),
  mk('urn:suitenova/layout/cycle', 'Ciclo básico', 'Pasos en círculo con flechas', 'cycle', 'Uno\nDos\nTres\nCuatro\nCinco', cycle()),
  mk('urn:suitenova/layout/hierarchy', 'Organigrama', 'Jerarquía de arriba abajo con líneas de unión', 'hierarchy', 'Uno\n\tDos\n\t\tTres\n\t\tCuatro\n\tCinco', hierarchy()),
  mk('urn:suitenova/layout/pyramid', 'Pirámide básica', 'Niveles apilados, del vértice a la base', 'pyramid', 'Uno\nDos\nTres', pyramid()),
  mk('urn:suitenova/layout/venn', 'Venn básico', 'Círculos que se solapan (de 1 a 5)', 'relationship', 'Uno\nDos\nTres', venn()),
  mk('urn:suitenova/layout/matrix', 'Matriz básica', 'Hasta cuatro cuadros en dos filas', 'matrix', 'Uno\nDos\nTres\nCuatro', matrix()),
];

export const layoutById = (id: string): CatalogLayout | undefined => LAYOUT_CATALOG.find((l) => l.id === id);
