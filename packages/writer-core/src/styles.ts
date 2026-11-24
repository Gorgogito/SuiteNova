import { resolveRef, type DocTheme } from '@suitenova/theme-core';
import { BODY_FONT, DEFAULT_FONT_SIZE, DEFAULT_LINE_HEIGHT, DEFAULT_SPACE_AFTER, PARAGRAPH_STYLES, styleClass, type ParagraphStyleDef } from './schema';

/** Document-wide defaults (Word's "docDefaults"). */
export interface DocDefaults {
  fontFamily: string;
  /** points */
  fontSize: number;
  lineHeight: number;
  spaceAfter: number;
  /** The font is the theme's body (`minor`) or headings (`major`) one: `fontFamily` is what it is for the theme of the moment. */
  fontTheme?: 'major' | 'minor';
}

export const DEFAULT_DOC_DEFAULTS: DocDefaults = { fontFamily: BODY_FONT, fontTheme: 'minor', fontSize: DEFAULT_FONT_SIZE, lineHeight: DEFAULT_LINE_HEIGHT, spaceAfter: DEFAULT_SPACE_AFTER };

export type StyleTable = ParagraphStyleDef[];

export const defaultStyles = (): StyleTable => PARAGRAPH_STYLES.map((s) => ({ ...s }));

export const styleById = (styles: StyleTable, id: string | null | undefined): ParagraphStyleDef | undefined => styles.find((s) => s.id === (id ?? 'Normal'));

/** CSS for a document's style table, scoped to `.nw-doc` so several documents never clash. */
export function styleCss(styles: StyleTable, defaults: DocDefaults = DEFAULT_DOC_DEFAULTS, theme?: DocTheme | null): string {
  const face = (family: string | undefined, which: 'major' | 'minor' | undefined): string | undefined => (which && theme ? theme.fonts[which].latin : family);
  const root = `.nw-doc{font-family:'${face(defaults.fontFamily, defaults.fontTheme)}', Carlito, 'Segoe UI', sans-serif;font-size:${defaults.fontSize}pt;line-height:${defaults.lineHeight}}\n.nw-doc .nw-p{margin:0 0 ${defaults.spaceAfter}pt 0}`;
  const rules = styles.map((s) => {
    const d: string[] = [];
    const family = face(s.fontFamily, s.fontTheme);
    if (family) d.push(`font-family:'${family}', Carlito, 'Segoe UI', sans-serif`);
    if (s.fontSize) d.push(`font-size:${s.fontSize}pt`);
    if (s.bold) d.push('font-weight:700');
    if (s.italic) d.push('font-style:italic');
    const color = s.colorRef && theme ? resolveRef(theme, s.colorRef) : s.color;
    if (color) d.push(`color:${color}`);
    if (s.spaceBefore !== undefined) d.push(`margin-top:${s.spaceBefore}pt`);
    if (s.spaceAfter !== undefined) d.push(`margin-bottom:${s.spaceAfter}pt`);
    if (s.lineHeight) d.push(`line-height:${s.lineHeight}`);
    if (s.align) d.push(`text-align:${s.align}`);
    if (s.indentLeft) d.push(`margin-left:${s.indentLeft}pt`);
    return d.length ? `.nw-doc .${styleClass(s.id)}{${d.join(';')}}` : '';
  });
  return [root, ...rules].filter(Boolean).join('\n');
}
