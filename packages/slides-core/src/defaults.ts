import { DEFAULT_CLRMAP, rgb, scheme } from './color';
import { docFromText, emptyDocJson, makeDoc } from './text';
import type { Deck, Fill, Layout, ListStyle, Master, ParaProps, PhType, ShapeEl, SlideElement, Theme, Xfrm } from './types';

let counter = 0;
export const newId = (prefix = 'e'): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const SLIDE_16_9 = { w: 960, h: 540, type: 'custom' };
export const SLIDE_4_3 = { w: 720, h: 540, type: 'screen4x3' };

/** The "Office" theme: colours, fonts and format scheme of current PowerPoint. */
export function officeTheme(): Theme {
  const sol = (c: ReturnType<typeof scheme>): Fill => ({ t: 'solid', c });
  const ph = scheme('phClr');
  const mods = (...m: [string, number][]) => scheme('phClr', m.map(([t, v]) => ({ t: t as never, v })));
  return {
    id: 'theme-office',
    name: 'Tema de Office',
    colors: { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1', folHlink: '#954f72' },
    fonts: { major: { latin: 'Calibri Light' }, minor: { latin: 'Calibri' } },
    fmt: {
      fills: [
        sol(ph),
        {
          t: 'grad',
          lin: { ang: 5400000 / 60000, scaled: false },
          stops: [
            { pos: 0, c: mods(['lumMod', 110000], ['satMod', 105000], ['tint', 67000]) },
            { pos: 50000, c: mods(['lumMod', 105000], ['satMod', 103000], ['tint', 73000]) },
            { pos: 100000, c: mods(['lumMod', 105000], ['satMod', 109000], ['tint', 81000]) },
          ],
        },
        {
          t: 'grad',
          lin: { ang: 5400000 / 60000, scaled: false },
          stops: [
            { pos: 0, c: mods(['satMod', 103000], ['lumMod', 102000], ['tint', 94000]) },
            { pos: 50000, c: mods(['satMod', 110000], ['lumMod', 100000], ['shade', 100000]) },
            { pos: 100000, c: mods(['lumMod', 99000], ['satMod', 120000], ['shade', 78000]) },
          ],
        },
      ],
      lns: [
        { w: 0.5, fill: sol(ph), dash: 'solid', cap: 'flat', join: 'round', cmpd: 'sng' },
        { w: 1, fill: sol(ph), dash: 'solid', cap: 'flat', join: 'round', cmpd: 'sng' },
        { w: 1.5, fill: sol(ph), dash: 'solid', cap: 'flat', join: 'round', cmpd: 'sng' },
      ],
      effects: [{}, {}, { outer: { blur: 4, dist: 3, dir: 90, c: { rgb: '#000000', mods: [{ t: 'alpha', v: 38000 }] }, algn: 'ctr', rotWithShape: false } }],
      bgFills: [sol(ph), sol(mods(['tint', 95000], ['satMod', 170000])), sol(mods(['shade', 95000], ['satMod', 170000]))],
    },
  };
}

const pt = (n: number) => n;

/** Paragraph defaults of the Office master's body text. */
function bodyLevels(): ListStyle {
  const lvl = (n: number, marL: number, sz: number): { pPr: ParaProps; rPr: object } => ({
    pPr: { marL: pt(marL), indent: -18, lnSpc: { pct: 90000 }, spcBef: { pts: n === 0 ? 10 : 5 }, bullet: { kind: 'char', char: '•', font: 'Arial' }, algn: 'l' },
    rPr: { sz, color: scheme('tx1'), latin: '+mn-lt', ea: '+mn-ea', cs: '+mn-cs' },
  });
  return { lvl: [lvl(0, 18, 28), lvl(1, 54, 24), lvl(2, 90, 20), lvl(3, 126, 18), lvl(4, 162, 18), lvl(5, 198, 18), lvl(6, 234, 18), lvl(7, 270, 18), lvl(8, 306, 18)] };
}

export function officeTextStyles(): Master['txStyles'] {
  return {
    title: { lvl: [{ pPr: { algn: 'l', lnSpc: { pct: 90000 }, spcBef: { pct: 0 }, bullet: { kind: 'none' } }, rPr: { sz: 44, color: scheme('tx1'), latin: '+mj-lt', ea: '+mj-ea', cs: '+mj-cs' } }] },
    body: bodyLevels(),
    other: { def: { pPr: { algn: 'l', marL: 0, defTabSz: 72 }, rPr: { sz: 18, color: scheme('tx1'), latin: '+mn-lt' } } },
  };
}

// ------------------------------------------------------------------------------------------------ placeholders

export function placeholder(type: PhType, idx: number | undefined, xfrm: Xfrm | undefined, prompt: string, opts: Partial<ShapeEl> = {}): ShapeEl {
  const bodyish = type === 'body' || type === 'obj' || type === 'subTitle';
  const doc = prompt ? (bodyish && type !== 'subTitle' ? docFromText(prompt) : docFromText(prompt)) : emptyDocJson();
  return {
    kind: 'shape',
    id: newId(),
    name: prompt || type,
    ph: { type, ...(idx !== undefined ? { idx } : {}) },
    ...(xfrm ? { xfrm } : {}),
    text: { body: {}, doc },
    ...opts,
  };
}

const X = (x: number, y: number, w: number, h: number): Xfrm => ({ x, y, w, h });
const EMU = 12700;
const e = (x: number, y: number, w: number, h: number): Xfrm => X(x / EMU, y / EMU, w / EMU, h / EMU);

export function officeMaster(themeId: string): Master {
  const master: Master = {
    id: 'master-1',
    name: 'Tema de Office',
    themeId,
    bg: { ref: { idx: 1001, c: scheme('bg1') } },
    clrMap: { ...DEFAULT_CLRMAP },
    layoutIds: [],
    txStyles: officeTextStyles(),
    shapes: [],
    hf: { sldNum: true, ftr: true, dt: true },
  };
  const lvlDoc = makeDoc([
    { text: 'Haga clic para modificar los estilos de texto del patrón', lvl: 0 },
    { text: 'Segundo nivel', lvl: 1 },
    { text: 'Tercer nivel', lvl: 2 },
    { text: 'Cuarto nivel', lvl: 3 },
    { text: 'Quinto nivel', lvl: 4 },
  ]).toJSON();
  master.shapes = [
    placeholder('title', undefined, e(838200, 365125, 10515600, 1325563), 'Haga clic para modificar el estilo de título del patrón', { text: { body: { anchor: 'ctr', fit: { t: 'norm' } }, doc: docFromText('Haga clic para modificar el estilo de título del patrón') } }),
    placeholder('body', 1, e(838200, 1825625, 10515600, 4351338), '', { text: { body: { fit: { t: 'norm' } }, doc: lvlDoc } }),
    placeholder('dt', 2, e(838200, 6356350, 2743200, 365125), '', {
      text: { body: { anchor: 'ctr' }, lst: { lvl: [{ pPr: { algn: 'l' }, rPr: { sz: 12, color: scheme('tx1', [{ t: 'tint', v: 75000 }]) } }] }, doc: makeDoc([{ runs: [{ field: { ftype: 'datetime1', text: '27/10/2026' } }] }]).toJSON() },
    }),
    placeholder('ftr', 3, e(4038600, 6356350, 4114800, 365125), '', { text: { body: { anchor: 'ctr' }, lst: { lvl: [{ pPr: { algn: 'ctr' }, rPr: { sz: 12, color: scheme('tx1', [{ t: 'tint', v: 75000 }]) } }] }, doc: emptyDocJson() } }),
    placeholder('sldNum', 4, e(8610600, 6356350, 2743200, 365125), '', {
      text: { body: { anchor: 'ctr' }, lst: { lvl: [{ pPr: { algn: 'r' }, rPr: { sz: 12, color: scheme('tx1', [{ t: 'tint', v: 75000 }]) } }] }, doc: makeDoc([{ runs: [{ field: { ftype: 'slidenum', text: '‹#›' } }] }]).toJSON() },
    }),
  ];
  return master;
}

const ctrStyle = (sz: number, bold?: boolean): ListStyle => ({ lvl: [{ pPr: { algn: 'ctr' }, rPr: { sz, ...(bold ? { b: true } : {}) } }] });
const noBullet = (sz: number, extra: object = {}, algn?: 'ctr'): ListStyle => ({
  def: undefined,
  lvl: [0, 1, 2, 3, 4].map((i) => ({ pPr: { marL: i * 36, indent: 0, bullet: { kind: 'none' as const }, ...(algn ? { algn } : {}) }, rPr: { sz: i === 0 ? sz : Math.max(12, sz - 4 * i), ...extra } })),
});

function layoutShapes(spec: string): ShapeEl[] {
  const p = placeholder;
  const prompt = {
    title: 'Haga clic para modificar el título',
    sub: 'Haga clic para modificar el estilo de subtítulo del patrón',
    text: 'Haga clic para modificar el estilo de texto del patrón',
  };
  const tit = (xfrm?: Xfrm, body: object = {}, lst?: ListStyle) => p('title', undefined, xfrm, prompt.title, { text: { body, lst, doc: docFromText(prompt.title) } });
  const bod = (idx: number, type: PhType, xfrm?: Xfrm, body: object = {}, lst?: ListStyle, text = prompt.text) => p(type, idx, xfrm, text, { text: { body, lst, doc: docFromText(text) } });
  const common = (): ShapeEl[] => [p('dt', 10, undefined, '', { text: { body: {}, doc: makeDoc([{ runs: [{ field: { ftype: 'datetime1', text: '27/10/2026' } }] }]).toJSON() } }), p('ftr', 11, undefined, '', { text: { body: {}, doc: emptyDocJson() } }), p('sldNum', 12, undefined, '', { text: { body: {}, doc: makeDoc([{ runs: [{ field: { ftype: 'slidenum', text: '‹#›' } }] }]).toJSON() } })];
  switch (spec) {
    case 'title':
      return [
        p('ctrTitle', undefined, e(1524000, 1122363, 9144000, 2387600), 'Haga clic para modificar el título', { text: { body: { anchor: 'b' }, lst: ctrStyle(60), doc: docFromText('Haga clic para modificar el título') } }),
        bod(1, 'subTitle', e(1524000, 3602038, 9144000, 1655762), {}, noBullet(24, {}, 'ctr'), prompt.sub),
        ...common(),
      ];
    case 'obj':
      return [tit(), bod(1, 'obj'), ...common()];
    case 'secHead':
      return [
        tit(e(831850, 1709738, 10515600, 2852737), { anchor: 'b' }, { lvl: [{ rPr: { sz: 60 } }] }),
        bod(1, 'body', e(831850, 4589463, 10515600, 1500187), {}, { lvl: [0, 1, 2, 3, 4].map((i) => ({ pPr: { marL: i * 36, indent: 0, bullet: { kind: 'none' as const } }, rPr: { sz: [24, 20, 18, 18, 18][i], color: scheme('tx1', [{ t: 'tint', v: 75000 }]) } })) }),
        ...common(),
      ];
    case 'twoObj':
      return [tit(), bod(1, 'obj', e(838200, 1825625, 5181600, 4351338), {}, { lvl: [{ rPr: { sz: 28 } }, { rPr: { sz: 24 } }, { rPr: { sz: 20 } }, { rPr: { sz: 18 } }, { rPr: { sz: 18 } }] }), bod(2, 'obj', e(6172200, 1825625, 5181600, 4351338), {}, { lvl: [{ rPr: { sz: 28 } }, { rPr: { sz: 24 } }, { rPr: { sz: 20 } }, { rPr: { sz: 18 } }, { rPr: { sz: 18 } }] }), ...common()];
    case 'twoTxTwoObj':
      return [
        tit(e(839788, 365125, 10515600, 1325563)),
        bod(1, 'body', e(839788, 1681163, 5157787, 823912), { anchor: 'b' }, noBullet(24, { b: true })),
        bod(2, 'obj', e(839788, 2505075, 5157787, 3684588)),
        bod(3, 'body', e(6172200, 1681163, 5183188, 823912), { anchor: 'b' }, noBullet(24, { b: true })),
        bod(4, 'obj', e(6172200, 2505075, 5183188, 3684588)),
        ...common(),
      ];
    case 'titleOnly':
      return [tit(), ...common()];
    case 'blank':
      return common();
    case 'objTx':
      return [
        tit(e(839788, 457200, 3932237, 1600200), { anchor: 'b' }, { lvl: [{ rPr: { sz: 32 } }] }),
        bod(1, 'obj', e(5183188, 987425, 6172200, 4873625), {}, { lvl: [{ rPr: { sz: 32 } }, { rPr: { sz: 28 } }, { rPr: { sz: 24 } }, { rPr: { sz: 20 } }, { rPr: { sz: 20 } }] }),
        bod(2, 'body', e(839788, 2057400, 3932237, 3811588), {}, noBullet(16)),
        ...common(),
      ];
    case 'picTx':
      return [
        tit(e(839788, 457200, 3932237, 1600200), { anchor: 'b' }, { lvl: [{ rPr: { sz: 32 } }] }),
        p('pic', 1, e(5183188, 987425, 6172200, 4873625), 'Haga clic en el icono para agregar una imagen', { text: { body: {}, lst: { lvl: [{ pPr: { marL: 0, indent: 0, bullet: { kind: 'none' } }, rPr: { sz: 32 } }] }, doc: docFromText('Haga clic en el icono para agregar una imagen') } }),
        bod(2, 'body', e(839788, 2057400, 3932237, 3811588), {}, noBullet(16)),
        ...common(),
      ];
    case 'vertTx':
      return [tit(), bod(1, 'body', undefined, { vert: 'eaVert' }), ...common()];
    case 'vertTitleAndTx':
      return [p('title', undefined, e(8724900, 365125, 2628900, 5811838), prompt.title, { text: { body: { vert: 'eaVert' }, doc: docFromText(prompt.title) } }), bod(1, 'body', e(838200, 365125, 7734300, 5811838), { vert: 'eaVert' }), ...common()];
    default:
      return [];
  }
}

const LAYOUTS: [string, string, string][] = [
  ['title', 'Diapositiva de título', 'title'],
  ['obj', 'Título y objetos', 'obj'],
  ['secHead', 'Encabezado de sección', 'secHead'],
  ['twoObj', 'Dos objetos', 'twoObj'],
  ['twoTxTwoObj', 'Comparación', 'twoTxTwoObj'],
  ['titleOnly', 'Solo el título', 'titleOnly'],
  ['blank', 'En blanco', 'blank'],
  ['objTx', 'Contenido con título', 'objTx'],
  ['picTx', 'Imagen con título', 'picTx'],
  ['vertTx', 'Título y texto vertical', 'vertTx'],
  ['vertTitleAndTx', 'Título vertical y texto', 'vertTitleAndTx'],
];

export function officeLayouts(masterId: string): Layout[] {
  return LAYOUTS.map(([type, name, spec]) => ({ id: `layout-${type}`, name, type, masterId, shapes: layoutShapes(spec), showMasterSp: true }));
}

export function newSlideFromLayout(layout: Layout, deckLayouts?: Layout[]): { shapes: SlideElement[] } {
  void deckLayouts;
  const shapes: SlideElement[] = [];
  for (const s of layout.shapes) {
    if (s.kind !== 'shape' || !s.ph) continue;
    // date, footer and slide number placeholders are added only through "Header and footer"
    if (s.ph.type === 'dt' || s.ph.type === 'ftr' || s.ph.type === 'sldNum') continue;
    shapes.push({ kind: 'shape', id: newId(), ph: { ...s.ph }, name: s.name, text: { body: {}, doc: emptyDocJson() } });
  }
  return { shapes };
}

export function newDeck(): Deck {
  const theme = officeTheme();
  const master = officeMaster(theme.id);
  const layouts = officeLayouts(master.id);
  master.layoutIds = layouts.map((l) => l.id);
  const first = layouts[0]!;
  const deck: Deck = {
    size: { ...SLIDE_16_9 },
    themes: [theme],
    masters: [master],
    layouts,
    slides: [],
    sections: [],
    assets: {},
    commentAuthors: [],
    props: {},
    show: {},
    defaultText: { def: { pPr: { marL: 0, algn: 'l', defTabSz: 72, bullet: { kind: 'none' } }, rPr: { sz: 18 } }, lvl: [] },
  };
  deck.slides.push({ id: newId('s'), layoutId: first.id, shapes: newSlideFromLayout(first).shapes });
  return deck;
}

export { rgb };
