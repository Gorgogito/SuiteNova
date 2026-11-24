import JSZip from 'jszip';
import { officeTheme } from './catalog';
import { DEFAULT_FMT_XML } from './fmt';
import { SCHEME_SLOTS, type DocTheme, type FontFace, type SchemeSlot, type ThemeColors } from './types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The first element `<a:name …>…</a:name>` (or `<a:name …/>`) of a text, with its attributes and what it holds. */
function element(xml: string, name: string): { attrs: string; inner: string; whole: string } | null {
  const open = new RegExp(`<(?:a:)?${name}(\\s[^>]*?)?(/?)>`).exec(xml);
  if (!open) return null;
  if (open[2] === '/') return { attrs: open[1] ?? '', inner: '', whole: open[0] };
  const close = new RegExp(`</(?:a:)?${name}>`).exec(xml.slice(open.index + open[0].length));
  if (!close) return null;
  const innerStart = open.index + open[0].length;
  const innerEnd = innerStart + close.index;
  return { attrs: open[1] ?? '', inner: xml.slice(innerStart, innerEnd), whole: xml.slice(open.index, innerEnd + close[0].length) };
}

const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? unesc(m[1]!) : undefined;
};

/** A colour element: `srgbClr` or the `lastClr` of a `sysClr`. */
function colorOf(inner: string): string | undefined {
  const s = /<(?:a:)?srgbClr\s+val="([0-9a-fA-F]{6})"/.exec(inner);
  if (s) return `#${s[1]!.toLowerCase()}`;
  const y = /<(?:a:)?sysClr\b[^>]*?lastClr="([0-9a-fA-F]{6})"/.exec(inner);
  return y ? `#${y[1]!.toLowerCase()}` : undefined;
}

const SYS_COLOR: Partial<Record<SchemeSlot, [string, string]>> = { dk1: ['windowText', '000000'], lt1: ['window', 'ffffff'] };

/** Reads a `theme1.xml`. Colours, fonts and the format scheme are taken; the rest (object defaults, extra colour schemes) is kept as it is. */
export function readThemeXml(xml: string): DocTheme {
  const base = officeTheme();
  const theme = element(xml, 'theme');
  if (!theme) throw new Error('El archivo no contiene un tema reconocible.');
  const els = element(theme.inner, 'themeElements');
  if (!els) throw new Error('El archivo no contiene un tema reconocible.');
  const out: DocTheme = { ...base, name: attr(theme.attrs, 'name') ?? base.name, colors: { ...base.colors }, fonts: { major: { ...base.fonts.major }, minor: { ...base.fonts.minor } } };

  const cs = element(els.inner, 'clrScheme');
  if (cs) {
    out.colorsName = attr(cs.attrs, 'name') ?? out.colorsName;
    for (const slot of SCHEME_SLOTS) {
      const e = element(cs.inner, slot);
      const c = e && colorOf(e.inner);
      if (c) out.colors[slot] = c;
    }
  }
  const fs = element(els.inner, 'fontScheme');
  if (fs) {
    out.fontsName = attr(fs.attrs, 'name') ?? out.fontsName;
    const face = (k: 'majorFont' | 'minorFont', fallback: FontFace): FontFace => {
      const f = element(fs.inner, k);
      if (!f) return fallback;
      const l = (t: string) => {
        const e = element(f.inner, t);
        return e ? attr(e.attrs, 'typeface') : undefined;
      };
      return { latin: l('latin') || fallback.latin, ...(l('ea') ? { ea: l('ea') } : {}), ...(l('cs') ? { cs: l('cs') } : {}) };
    };
    out.fonts = { major: face('majorFont', base.fonts.major), minor: face('minorFont', base.fonts.minor) };
  }
  const fm = element(els.inner, 'fmtScheme');
  if (fm) {
    out.fmtXml = fm.whole;
    out.effectsName = attr(fm.attrs, 'name') ?? out.effectsName;
  }
  const after = theme.inner.slice(theme.inner.indexOf(els.whole) + els.whole.length).trim();
  if (after) out.tail = after;
  return out;
}

const NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function writeFace(tag: 'majorFont' | 'minorFont', f: FontFace): string {
  return `<a:${tag}><a:latin typeface="${esc(f.latin)}"/><a:ea typeface="${esc(f.ea ?? '')}"/><a:cs typeface="${esc(f.cs ?? '')}"/></a:${tag}>`;
}

/** The `theme1.xml` of a theme. */
export function writeThemeXml(t: DocTheme): string {
  const slots = SCHEME_SLOTS.map((s) => {
    const sys = SYS_COLOR[s];
    const hex = t.colors[s].replace('#', '').toLowerCase();
    // black and white stay system colours (text and window) when they are, as Office writes them
    if (sys && hex === sys[1]) return `<a:${s}><a:sysClr val="${sys[0]}" lastClr="${hex}"/></a:${s}>`;
    return `<a:${s}><a:srgbClr val="${hex}"/></a:${s}>`;
  }).join('');
  const fmt = t.fmtXml || DEFAULT_FMT_XML;
  const fmtNamed = fmt.replace(/<a:fmtScheme(\s[^>]*)?>/, `<a:fmtScheme name="${esc(t.effectsName)}">`);
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<a:theme xmlns:a="${NS}" name="${esc(t.name)}"><a:themeElements>` +
    `<a:clrScheme name="${esc(t.colorsName)}">${slots}</a:clrScheme>` +
    `<a:fontScheme name="${esc(t.fontsName)}">${writeFace('majorFont', t.fonts.major)}${writeFace('minorFont', t.fonts.minor)}</a:fontScheme>` +
    `${fmtNamed}</a:themeElements>${t.tail ?? '<a:objectDefaults/><a:extraClrSchemeLst/>'}</a:theme>`
  );
}

const CT = 'application/vnd.openxmlformats-officedocument';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** A `.thmx` file: the theme in a package that Word, Excel and PowerPoint open. */
export async function writeThmx(t: DocTheme): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/theme/theme/themeManager.xml" ContentType="${CT}.themeManager+xml"/><Override PartName="/theme/theme/theme1.xml" ContentType="${CT}.theme+xml"/></Types>`,
  );
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="theme/theme/themeManager.xml"/></Relationships>`);
  zip.file('theme/theme/themeManager.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:themeManager xmlns:a="${NS}"/>`);
  zip.file('theme/theme/_rels/themeManager.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/theme" Target="theme1.xml"/></Relationships>`);
  zip.file('theme/theme/theme1.xml', writeThemeXml(t));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Reads a `.thmx` file. */
export async function readThmx(data: Uint8Array): Promise<DocTheme> {
  const zip = await JSZip.loadAsync(data);
  const f = zip.file(/^theme\/theme\/theme\d*\.xml$/i)[0];
  if (!f) throw new Error('El archivo no contiene un tema reconocible.');
  return readThemeXml(await f.async('string'));
}

export type { ThemeColors };

// ------------------------------------------------------------------------------------------------ colour and font schemes alone

const slotXml = (s: SchemeSlot, color: string): string => {
  const sys = SYS_COLOR[s];
  const hex = color.replace('#', '').toLowerCase();
  return sys && hex === sys[1] ? `<a:${s}><a:sysClr val="${sys[0]}" lastClr="${hex}"/></a:${s}>` : `<a:${s}><a:srgbClr val="${hex}"/></a:${s}>`;
};

/** A colour scheme as a file of its own (what Office keeps in «Theme Colors» and what «Customize colours» saves). */
export function writeColorSchemeXml(name: string, colors: ThemeColors): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:clrScheme xmlns:a="${NS}" name="${esc(name)}">${SCHEME_SLOTS.map((s) => slotXml(s, colors[s])).join('')}</a:clrScheme>`;
}

export function readColorSchemeXml(xml: string): { name: string; colors: ThemeColors } {
  const cs = element(xml, 'clrScheme');
  if (!cs) throw new Error('El archivo no contiene colores de tema.');
  const colors = { ...officeTheme().colors };
  for (const slot of SCHEME_SLOTS) {
    const e = element(cs.inner, slot);
    const c = e && colorOf(e.inner);
    if (c) colors[slot] = c;
  }
  return { name: attr(cs.attrs, 'name') ?? 'Personalizado', colors };
}

/** A font scheme as a file of its own (what Office keeps in «Theme Fonts»). */
export function writeFontSchemeXml(name: string, fonts: { major: FontFace; minor: FontFace }): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:fontScheme xmlns:a="${NS}" name="${esc(name)}">${writeFace('majorFont', fonts.major)}${writeFace('minorFont', fonts.minor)}</a:fontScheme>`;
}

export function readFontSchemeXml(xml: string): { name: string; fonts: { major: FontFace; minor: FontFace } } {
  const fs = element(xml, 'fontScheme');
  if (!fs) throw new Error('El archivo no contiene fuentes de tema.');
  const base = officeTheme().fonts;
  const face = (k: 'majorFont' | 'minorFont', fallback: FontFace): FontFace => {
    const f = element(fs.inner, k);
    const l = (t: string) => {
      const e = f && element(f.inner, t);
      return e ? attr(e.attrs, 'typeface') : undefined;
    };
    return { latin: l('latin') || fallback.latin, ...(l('ea') ? { ea: l('ea') } : {}), ...(l('cs') ? { cs: l('cs') } : {}) };
  };
  return { name: attr(fs.attrs, 'name') ?? 'Personalizado', fonts: { major: face('majorFont', base.major), minor: face('minorFont', base.minor) } };
}
