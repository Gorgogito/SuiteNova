/*
 * Document themes shared by the products: the 12 colours of the scheme, the two fonts (headings and body) and the effect scheme, as in the
 * DrawingML `theme1.xml` that Word, Excel and PowerPoint keep inside their files and the `.thmx` file they exchange.
 */

/** The 12 slots of a colour scheme, in the order of the file. */
export type SchemeSlot = 'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink';

export const SCHEME_SLOTS: SchemeSlot[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

/** `#rrggbb` for each slot. */
export type ThemeColors = Record<SchemeSlot, string>;

export interface FontFace {
  latin: string;
  ea?: string;
  cs?: string;
}

export interface ThemeFonts {
  /** Headings. */
  major: FontFace;
  /** Body. */
  minor: FontFace;
}

export interface DocTheme {
  /** Name of the theme («Tema de Office»). */
  name: string;
  colors: ThemeColors;
  colorsName: string;
  fonts: ThemeFonts;
  fontsName: string;
  /** The format scheme (fills, lines, effects) as the XML element `a:fmtScheme`, kept as it is so that a file goes back as it came. */
  fmtXml: string;
  effectsName: string;
  /** What follows the theme elements in the file (object defaults, extra colour schemes, extensions), kept as it is. */
  tail?: string;
}

/** Colours and fonts that the person named and saved. */
export interface NamedColors {
  name: string;
  colors: ThemeColors;
}
export interface NamedFonts {
  name: string;
  fonts: ThemeFonts;
}
export interface CustomThemes {
  colors: NamedColors[];
  fonts: NamedFonts[];
  themes: DocTheme[];
}
