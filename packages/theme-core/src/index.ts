/*
 * Document themes shared by Writer, Calc and Slides: the 12 colours, the two fonts and the effect scheme of Office's `theme1.xml` and `.thmx`,
 * the colour gallery with its tints, and the themes the person saves.
 */
export { SCHEME_SLOTS, type CustomThemes, type DocTheme, type FontFace, type NamedColors, type NamedFonts, type SchemeSlot, type ThemeColors, type ThemeFonts } from './types';
export { quantizeTint, refFromWord, refToWord, refsEqual, resolveRef, type ColorRef, type RefSlot } from './ref';
export { GALLERY_TINTS, MAP_TO_SLOT, hslToRgb, modColor, paletteOf, parseHex, rgbToHsl, seriesColors, themeColor, themeGallery, tintColor, toHex, type GalleryColumn, type MapSlot, type Rgb } from './color';
export { COLOR_SCHEMES, EFFECT_SCHEMES, FONT_SCHEMES, cloneFonts, officeTheme, themeCatalog, type ColorScheme, type FontScheme } from './catalog';
export { DEFAULT_FMT_XML, type EffectScheme } from './fmt';
export { readColorSchemeXml, readFontSchemeXml, readThemeXml, readThmx, writeColorSchemeXml, writeFontSchemeXml, writeThemeXml, writeThmx } from './xml';
export { emptyCustom, parseCustom, removeCustom, sameColors, sameFonts, saveColors, saveFonts, saveTheme, stringifyCustom, withColors, withEffects, withFonts } from './edit';
