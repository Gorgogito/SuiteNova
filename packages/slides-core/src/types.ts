/*
 * Nova Slides document model (v2). Mirrors what PresentationML can say, in points and degrees, so that a .pptx can be read and
 * written without losing what PowerPoint wrote. Text bodies are ProseMirror documents (see text.ts).
 */

// ------------------------------------------------------------------------------------------------ colour

export type SchemeSlot = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink';
/** Names a colour may use in a shape: the master's colour map turns `bg1`, `tx1`… into scheme slots. */
export type ColorName = SchemeSlot | 'bg1' | 'bg2' | 'tx1' | 'tx2' | 'phClr';

export type ClrModKind = 'lumMod' | 'lumOff' | 'tint' | 'shade' | 'alpha' | 'alphaMod' | 'alphaOff' | 'satMod' | 'satOff' | 'hueMod' | 'hueOff' | 'sat' | 'lum' | 'hue' | 'comp' | 'inv' | 'gray' | 'red' | 'green' | 'blue' | 'redMod' | 'greenMod' | 'blueMod' | 'redOff' | 'greenOff' | 'blueOff' | 'gamma' | 'invGamma';
export interface ClrMod {
  t: ClrModKind;
  /** In 1/100000 (percentages) except hue (60000ths of a degree); absent for flag-like modifiers. */
  v?: number;
}
/** A colour: either an explicit RGB or a theme colour, with modifiers. */
export interface Clr {
  rgb?: string;
  scheme?: ColorName;
  /** `prstClr`/`sysClr` fall back to their RGB. */
  mods?: ClrMod[];
}

// ------------------------------------------------------------------------------------------------ fills, lines, effects

export interface GradStop {
  /** 0–100000 */
  pos: number;
  c: Clr;
}
export interface Rect4 {
  l: number;
  t: number;
  r: number;
  b: number;
}
export type Fill =
  | { t: 'none' }
  | { t: 'inherit' }
  | { t: 'solid'; c: Clr }
  | { t: 'grad'; stops: GradStop[]; lin?: { ang: number; scaled?: boolean }; path?: { kind: 'circle' | 'rect' | 'shape'; rect?: Rect4 }; rotWithShape?: boolean }
  | { t: 'patt'; prst: string; fg: Clr; bg: Clr }
  | { t: 'blip'; src: string; srcRect?: Rect4; stretch?: Rect4 | true; tile?: { tx: number; ty: number; sx: number; sy: number; flip?: string; algn?: string }; alpha?: number; rotWithShape?: boolean; duotone?: [Clr, Clr] }
  | { t: 'group' };

export type DashPreset = 'solid' | 'dot' | 'dash' | 'lgDash' | 'dashDot' | 'lgDashDot' | 'lgDashDotDot' | 'sysDash' | 'sysDot' | 'sysDashDot' | 'sysDashDotDot';
export interface LineEnd {
  type: 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';
  w?: 'sm' | 'med' | 'lg';
  len?: 'sm' | 'med' | 'lg';
}
export interface Ln {
  /** points */
  w?: number;
  fill?: Fill;
  dash?: DashPreset;
  /** custom dash: [dash, space, …] in 1/1000 % of the width */
  custDash?: number[];
  cap?: 'flat' | 'rnd' | 'sq';
  join?: 'round' | 'bevel' | 'miter';
  miterLim?: number;
  head?: LineEnd;
  tail?: LineEnd;
  cmpd?: 'sng' | 'dbl' | 'thickThin' | 'thinThick' | 'tri';
  algn?: 'ctr' | 'in';
}

export interface Shadow {
  blur: number;
  dist: number;
  /** degrees */
  dir: number;
  c: Clr;
  sx?: number;
  sy?: number;
  kx?: number;
  ky?: number;
  algn?: string;
  rotWithShape?: boolean;
}
export interface Reflection {
  blur: number;
  stA: number;
  stPos: number;
  endA: number;
  endPos: number;
  dist: number;
  dir: number;
  fadeDir: number;
  sx: number;
  sy: number;
  kx?: number;
  ky?: number;
  algn?: string;
  rotWithShape?: boolean;
}
export interface Effects {
  outer?: Shadow;
  inner?: Shadow;
  glow?: { rad: number; c: Clr };
  softEdge?: { rad: number };
  reflection?: Reflection;
  /** blur of the object itself (a:blur) */
  blur?: { rad: number; grow?: boolean };
}

/** `p:style`: indexes into the theme's format scheme. */
export interface StyleRef {
  ln?: { idx: number; c?: Clr };
  fill?: { idx: number; c?: Clr };
  effect?: { idx: number; c?: Clr };
  font?: { idx: 'major' | 'minor' | 'none'; c?: Clr };
}

// ------------------------------------------------------------------------------------------------ text

export interface Tab {
  /** points from the left of the text box */
  pos: number;
  algn: 'l' | 'ctr' | 'r' | 'dec';
}
export type BulletKind = 'inherit' | 'none' | 'char' | 'auto' | 'blip';
export interface Bullet {
  kind: BulletKind;
  char?: string;
  font?: string;
  /** autonumber scheme, e.g. `arabicPeriod`, `alphaLcParenR`, `romanUcPeriod` */
  auto?: string;
  startAt?: number;
  clr?: Clr | null;
  /** percent of the text size (100 = same) */
  szPct?: number;
  szPts?: number;
  src?: string;
}
export type Spacing = { pct: number } | { pts: number };

export interface ParaProps {
  algn?: 'l' | 'ctr' | 'r' | 'just' | 'dist' | 'justLow' | 'thaiDist';
  /** left margin and first-line indent, points */
  marL?: number;
  indent?: number;
  lnSpc?: Spacing;
  spcBef?: Spacing;
  spcAft?: Spacing;
  bullet?: Bullet;
  tabs?: Tab[];
  rtl?: boolean;
  defTabSz?: number;
  eaLnBrk?: boolean;
  latinLnBrk?: boolean;
  hangingPunct?: boolean;
  fontAlgn?: string;
}

export interface Hyperlink {
  /** external address */
  url?: string;
  /** internal target: `next`, `prev`, `first`, `last`, `end` or a slide id */
  slide?: string;
  tooltip?: string;
  action?: string;
}
export interface TextEffects {
  fill?: Fill;
  ln?: Ln;
  effects?: Effects;
}
/** Character properties (a:rPr). */
export interface RunProps {
  b?: boolean;
  i?: boolean;
  u?: string;
  strike?: 'sng' | 'dbl';
  /** points */
  sz?: number;
  latin?: string;
  ea?: string;
  cs?: string;
  sym?: string;
  color?: Clr;
  highlight?: Clr;
  /** percent: 30 = superscript, -25 = subscript */
  baseline?: number;
  cap?: 'none' | 'small' | 'all';
  /** letter spacing, points */
  spc?: number;
  kern?: number;
  lang?: string;
  /** text fill / outline / effects (WordArt) */
  fx?: TextEffects;
  hlink?: Hyperlink;
}

export interface LevelStyle {
  pPr?: ParaProps;
  rPr?: RunProps;
}
/** `a:lstStyle`: defaults per level (index 0 = level 1). */
export interface ListStyle {
  def?: LevelStyle;
  lvl?: (LevelStyle | undefined)[];
}

export type Autofit = { t: 'none' } | { t: 'shape' } | { t: 'norm'; fontScale?: number; lnSpcReduction?: number };
export interface TextWarp {
  prst: string;
  adj?: Record<string, number>;
}
export interface BodyProps {
  anchor?: 't' | 'ctr' | 'b' | 'just' | 'dist';
  anchorCtr?: boolean;
  wrap?: 'square' | 'none';
  /** insets in points */
  lIns?: number;
  tIns?: number;
  rIns?: number;
  bIns?: number;
  vert?: 'horz' | 'vert' | 'vert270' | 'wordArtVert' | 'eaVert' | 'mongolianVert' | 'wordArtVertRtl';
  rot?: number;
  numCol?: number;
  /** column spacing, points */
  spcCol?: number;
  rtlCol?: boolean;
  fit?: Autofit;
  upright?: boolean;
  compatLnSpc?: boolean;
  warp?: TextWarp;
}
export interface TextBody {
  body: BodyProps;
  lst?: ListStyle;
  /** ProseMirror document (slides schema) */
  doc: unknown;
}

// ------------------------------------------------------------------------------------------------ geometry

export type PathCmd = ['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Q', number, number, number, number] | ['A', number, number, number, number] | ['Z'];
export interface CustPath {
  w: number;
  h: number;
  cmds: PathCmd[];
  fill?: 'none' | 'norm' | 'lighten' | 'lightenLess' | 'darken' | 'darkenLess';
  stroke?: boolean;
}
/** custom geometry: the text rectangle is given by guide names (`r`, `b`, `hc`…) or numbers in EMU, kept as written */
export type Geometry = { prst: string; adj?: Record<string, number> } | { cust: CustPath[]; rect?: { l: string; t: string; r: string; b: string } };

// ------------------------------------------------------------------------------------------------ elements

export interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export type PhType = 'title' | 'ctrTitle' | 'subTitle' | 'body' | 'dt' | 'ftr' | 'sldNum' | 'obj' | 'chart' | 'tbl' | 'clipArt' | 'dgm' | 'media' | 'sldImg' | 'pic' | 'hdr';
export interface Placeholder {
  type: PhType;
  idx?: number;
  sz?: 'full' | 'half' | 'quarter';
  orient?: 'horz' | 'vert';
  hasCustomPrompt?: boolean;
}

interface Common {
  id: string;
  /** the shape's `id` attribute in the original file (animations, connectors and links refer to it) */
  srcId?: number;
  name?: string;
  descr?: string;
  title?: string;
  hidden?: boolean;
  /** a transform missing here means "inherit from the placeholder" */
  xfrm?: Xfrm;
  hlink?: Hyperlink;
  /** `p:nvPr` extras kept as they were (locks, custom data) */
  locked?: boolean;
}

export interface ShapeEl extends Common {
  kind: 'shape';
  geom?: Geometry;
  fill?: Fill;
  ln?: Ln;
  effects?: Effects;
  style?: StyleRef;
  text?: TextBody;
  ph?: Placeholder;
  isTextBox?: boolean;
  /** 3-D properties exist in the original and are not drawn */
  has3d?: boolean;
}
export interface PicEl extends Common {
  kind: 'pic';
  src: string;
  srcRect?: Rect4;
  geom?: Geometry;
  ln?: Ln;
  effects?: Effects;
  fill?: Fill;
  /** a:lum / a:alphaModFix / grayscale / biLevel */
  adjust?: { bright?: number; contrast?: number; alpha?: number; gray?: boolean; biLevel?: number; duotone?: [Clr, Clr] };
  ph?: Placeholder;
  /** frame with a picture that PowerPoint embedded for a video/audio/OLE object */
  poster?: boolean;
}
export interface GroupEl extends Common {
  kind: 'group';
  /** child coordinate space */
  chOff: { x: number; y: number };
  chExt: { w: number; h: number };
  children: SlideElement[];
  /** drawn from a SmartArt drawing part */
  smartart?: boolean;
  /** parts of the original SmartArt, written back untouched while the group is not edited */
  rawDiagram?: RawParts;
  effects?: Effects;
  fill?: Fill;
}
export interface ConnEl extends Common {
  kind: 'cxn';
  geom: Geometry;
  ln?: Ln;
  effects?: Effects;
  style?: StyleRef;
  start?: { id: number; idx: number };
  end?: { id: number; idx: number };
}
export interface TableCell {
  /** null = covered by a merged cell */
  text: TextBody | null;
  gridSpan?: number;
  rowSpan?: number;
  hMerge?: boolean;
  vMerge?: boolean;
  fill?: Fill;
  lnL?: Ln;
  lnR?: Ln;
  lnT?: Ln;
  lnB?: Ln;
  marL?: number;
  marR?: number;
  marT?: number;
  marB?: number;
  anchor?: 't' | 'ctr' | 'b';
  vert?: string;
}
export interface TableEl extends Common {
  kind: 'table';
  cols: number[];
  rows: { h: number; cells: TableCell[] }[];
  /** table style id and flags */
  styleId?: string;
  firstRow?: boolean;
  firstCol?: boolean;
  lastRow?: boolean;
  lastCol?: boolean;
  bandRow?: boolean;
  bandCol?: boolean;
}
export interface ChartEl extends Common {
  kind: 'chart';
  /** the chart in Nova Calc's chart model plus cached values (see chart.ts) */
  chart: ChartModel;
  /** original chart part(s), written back while the chart is not edited */
  raw?: RawParts;
}
export interface MediaEl extends Common {
  kind: 'media';
  media: 'video' | 'audio';
  src: string;
  /** poster / icon picture */
  poster?: string;
  mime?: string;
  loop?: boolean;
  autoplay?: boolean;
  volume?: number;
  mute?: boolean;
  hideWhenStopped?: boolean;
  /** trim, ms */
  trimStart?: number;
  trimEnd?: number;
  fullscreen?: boolean;
  rewind?: boolean;
  /** link to an external video (YouTube…) instead of an embedded file */
  linkUrl?: string;
}
export interface OleEl extends Common {
  kind: 'ole';
  progId?: string;
  poster?: string;
  raw?: RawParts;
}
export type SlideElement = ShapeEl | PicEl | GroupEl | ConnEl | TableEl | ChartEl | MediaEl | OleEl;

/** Bytes of untouched package parts, keyed by their path in the package. */
export type RawParts = Record<string, Uint8Array>;

// ------------------------------------------------------------------------------------------------ charts

export interface ChartSeries {
  name: string;
  /** category labels shared by the chart are in `categories`; values here */
  values: (number | null)[];
  /** for scatter/bubble */
  xValues?: (number | null)[];
  sizes?: (number | null)[];
  fill?: Fill;
  ln?: Ln;
  type?: string;
  secondary?: boolean;
  points?: { idx: number; fill?: Fill }[];
  labels?: { value?: boolean; percent?: boolean; category?: boolean; series?: boolean; pos?: string; numFmt?: string };
  smooth?: boolean;
  marker?: { symbol?: string; size?: number };
}
export interface ChartModel {
  kind: string;
  /** 'clustered' | 'stacked' | 'percent' */
  grouping?: string;
  barDir?: 'col' | 'bar';
  categories: string[];
  series: ChartSeries[];
  title?: string;
  legend?: 'r' | 't' | 'b' | 'l' | 'tr' | null;
  axes?: { cat?: { title?: string; delete?: boolean }; val?: { title?: string; min?: number; max?: number; delete?: boolean; numFmt?: string; gridlines?: boolean } };
  style?: number;
  holeSize?: number;
  firstSliceAng?: number;
  gapWidth?: number;
  overlap?: number;
  varyColors?: boolean;
  /** the workbook behind the chart, if the file has one */
  hasWorkbook?: boolean;
}

// ------------------------------------------------------------------------------------------------ theme, master, layout

export interface FontScheme {
  major: { latin: string; ea?: string; cs?: string };
  minor: { latin: string; ea?: string; cs?: string };
}
export interface FormatScheme {
  fills: Fill[];
  lns: Ln[];
  effects: Effects[];
  bgFills: Fill[];
}
export interface Theme {
  id: string;
  name: string;
  colors: Record<SchemeSlot, string>;
  fonts: FontScheme;
  fmt: FormatScheme;
}

export type Background = { fill: Fill } | { ref: { idx: number; c?: Clr } };

export interface ColorMap {
  bg1: SchemeSlot;
  tx1: SchemeSlot;
  bg2: SchemeSlot;
  tx2: SchemeSlot;
  accent1: SchemeSlot;
  accent2: SchemeSlot;
  accent3: SchemeSlot;
  accent4: SchemeSlot;
  accent5: SchemeSlot;
  accent6: SchemeSlot;
  hlink: SchemeSlot;
  folHlink: SchemeSlot;
}

export interface TextStyles {
  title: ListStyle;
  body: ListStyle;
  other: ListStyle;
}

export interface Master {
  id: string;
  name: string;
  themeId: string;
  bg?: Background;
  shapes: SlideElement[];
  txStyles: TextStyles;
  clrMap: ColorMap;
  layoutIds: string[];
  /** header/footer settings */
  hf?: { sldNum?: boolean; hdr?: boolean; ftr?: boolean; dt?: boolean };
}

export interface Layout {
  id: string;
  name: string;
  /** ST_SlideLayoutType: title, obj, secHead, twoObj, titleOnly, blank, … */
  type?: string;
  masterId: string;
  bg?: Background;
  shapes: SlideElement[];
  showMasterSp?: boolean;
  matchingName?: string;
  userDrawn?: boolean;
  /** colour map override */
  clrMapOvr?: Partial<ColorMap>;
  hf?: { sldNum?: boolean; hdr?: boolean; ftr?: boolean; dt?: boolean };
  transition?: Transition;
}

// ------------------------------------------------------------------------------------------------ transitions and animations

export interface Transition {
  /** e.g. fade, push, wipe, split, cut, random, circle, dissolve, checker, blinds, comb, cover, pull, randomBar, strips, wedge, wheel, zoom, vortex, ripple, glitter, honeycomb, flash, shred, switch, flip, gallery, conveyor, pan, ferris, flythrough, warp, prism, doors, window, reveal, curtains, wind, fall, airplane, origami */
  type: string;
  dir?: string;
  /** slow | med | fast */
  spd?: 'slow' | 'med' | 'fast';
  /** milliseconds */
  dur?: number;
  advClick?: boolean;
  /** advance after this many milliseconds */
  advTm?: number;
  thruBlk?: boolean;
  orient?: 'horz' | 'vert';
  spokes?: number;
  pattern?: string;
  sound?: { src: string; name?: string; loop?: boolean } | { stop: true };
  /** original XML, written back until the transition is edited */
  rawXml?: string;
}

export type AnimClass = 'entr' | 'exit' | 'emph' | 'path' | 'verb' | 'mediacall';
export type AnimTrigger = 'onClick' | 'withPrev' | 'afterPrev';
export interface AnimEffect {
  id: string;
  /** target element id (model id), optionally one paragraph (index range) of its text */
  target: string;
  para?: [number, number];
  cls: AnimClass;
  /** PowerPoint preset id (1 = appear, 10 = fade, 2 = fly in, 22 = wipe, …) */
  preset: number;
  subtype?: number;
  trigger: AnimTrigger;
  /** milliseconds */
  delay?: number;
  dur?: number;
  repeat?: number;
  rewind?: boolean;
  autoRev?: boolean;
  /** by paragraph, motion path, etc. */
  path?: string;
  /** for emphasis presets: colour, scale, angle… */
  value?: number | string;
  /** trigger shape for interactive sequences */
  triggerShape?: string;
  /** the effect's own time-node XML, kept for presets this model does not generate */
  rawXml?: string;
}
export interface Timing {
  effects: AnimEffect[];
  /** original `p:timing` XML written back while animations are not edited */
  rawXml?: string;
}

// ------------------------------------------------------------------------------------------------ slides and deck

export interface Comment {
  id: string;
  author: string;
  initials?: string;
  text: string;
  /** ms since epoch */
  at: number;
  /** position on the slide, points */
  x: number;
  y: number;
  resolved?: boolean;
  replyTo?: string;
}

export interface Slide {
  id: string;
  layoutId: string;
  bg?: Background;
  shapes: SlideElement[];
  /** notes: a text body (the notes placeholder) */
  notes?: TextBody;
  hidden?: boolean;
  showMasterSp?: boolean;
  transition?: Transition;
  timing?: Timing;
  comments?: Comment[];
  /** colour map override */
  clrMapOvr?: Partial<ColorMap>;
  /** timings recorded by rehearsal (ms on screen) */
  rehearsed?: number;
  hf?: { sldNum?: boolean; ftr?: boolean; dt?: boolean };
}

export interface Section {
  id: string;
  name: string;
  slideIds: string[];
}

export interface Asset {
  id: string;
  mime: string;
  data: Uint8Array;
  name?: string;
}

export interface SlideSize {
  w: number;
  h: number;
  /** screen4x3, screen16x9, custom… */
  type?: string;
}

export interface ShowProps {
  loop?: boolean;
  /** kiosk / browsed / presenter */
  mode?: 'presenter' | 'browsed' | 'kiosk';
  showNarration?: boolean;
  showAnimation?: boolean;
  useTimings?: boolean;
  range?: { from: number; to: number } | { show: string };
  penColor?: Clr;
  customShows?: { name: string; slideIds: string[] }[];
}

export interface Guide {
  id: string;
  orient: 'h' | 'v';
  /** points from the top / left */
  pos: number;
}

export interface Deck {
  size: SlideSize;
  themes: Theme[];
  masters: Master[];
  layouts: Layout[];
  slides: Slide[];
  sections: Section[];
  assets: Record<string, Asset>;
  commentAuthors: { name: string; initials: string }[];
  props: { title?: string; author?: string; created?: number; modified?: number; lastModifiedBy?: string };
  show: ShowProps;
  guides?: Guide[];
  /** text defaults of the presentation (`p:defaultTextStyle`) */
  defaultText?: ListStyle;
  /** first slide number */
  firstSlideNum?: number;
  /** table styles (`ppt/tableStyles.xml`) */
  tableStyles?: TableStyleDef[];
  defaultTableStyle?: string;
  /** package parts this model does not understand, written back as they were */
  raw?: RawParts;
  /** notes master (text styles and placeholders) */
  notesMaster?: Master;
  handoutMaster?: Master;
  /** protection and other presentation properties kept as XML */
  presPropsXml?: string;
}

export interface TableStylePart {
  fill?: Fill;
  ln?: { l?: Ln; r?: Ln; t?: Ln; b?: Ln; insideH?: Ln; insideV?: Ln };
  rPr?: RunProps;
}
export interface TableStyleDef {
  id: string;
  name: string;
  wholeTbl?: TableStylePart;
  band1H?: TableStylePart;
  band2H?: TableStylePart;
  band1V?: TableStylePart;
  band2V?: TableStylePart;
  firstRow?: TableStylePart;
  lastRow?: TableStylePart;
  firstCol?: TableStylePart;
  lastCol?: TableStylePart;
  neCell?: TableStylePart;
  nwCell?: TableStylePart;
  seCell?: TableStylePart;
  swCell?: TableStylePart;
}
