/*
 * Geometry types shared by every SuiteNova product that draws shapes. They follow DrawingML (ECMA-376): a shape is either one of the
 * 187 preset geometries (with its adjust values) or a custom geometry made of paths.
 */
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
